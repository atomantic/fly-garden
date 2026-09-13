import { validSharedCount } from '../shared/population-limits.js';
import { randomUUID } from 'node:crypto';
import { RETINAL_ADAPTER, encodeRetinalRgb, readFixtureMotor } from './environment-adapter.js';
import { RuntimeError } from './runtime.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const frameKeys = ['version', 'individualId', 'sessionId', 'environmentEpoch', 'frameId', 'simTimeMs', 'capturedAtMs', 'camera', 'width', 'height', 'rgb'];
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
export function validateSharedPose(pose) {
  if (!exact(pose, ['x', 'z', 'yaw']) || !Object.values(pose).every(Number.isFinite)
    || Math.abs(pose.x) > 2 || Math.abs(pose.z) > 2 || Math.abs(pose.yaw) > Math.PI) throw new RuntimeError('Invalid shared body pose.');
  return pose;
}

/** Synchronous fixture barrier. Runtimes remain the sole neural authority; tokens stage
 * transient steps without checkpoint restoration, input cancellation or neural exchange. */
export function createFixtureSharedSession(members, { tick: initialTick = 0, now = Date.now } = {}) {
  if (!Array.isArray(members) || !validSharedCount(members.length) || !integer(initialTick)
    || !Number.isSafeInteger(initialTick * 5)) throw new RuntimeError('Invalid shared fixture membership or clock.');
  const ids = new Set();
  const participants = members.map(({ runtime, pose }) => {
    const state = runtime.snapshot();
    if (ids.has(state.individualId) || state.source !== 'fixture') throw new RuntimeError('Shared members must be distinct fixtures.');
    ids.add(state.individualId);
    return { runtime, individualId: state.individualId, sessionId: state.sessionId, pose: structuredClone(validateSharedPose(pose)), motor: { forward: 0, yaw: 0 } };
  });
  const sharedId = randomUUID();
  let worldEpoch = randomUUID(), tick = initialTick, status = 'paused', reason = 'Explicit shared start required.', lastReceivedAtMs = null;
  let events = [{ type: 'join', tick }];
  const event = type => { events.push({ type, tick }); events = events.slice(-64); };
  function pause(message = 'Shared session paused.') {
    for (const p of participants) { p.runtime.control('pause'); p.motor = { forward: 0, yaw: 0 }; }
    status = 'paused'; reason = message; worldEpoch = randomUUID(); lastReceivedAtMs = null; event('pause');
  }
  function snapshot() {
    return { version: 1, sharedId, worldEpoch, tick, intervalMs: 5, worldTimeMs: tick * 5, status, reason, lastReceivedAtMs,
      participants: participants.map(p => { const state = p.runtime.snapshot(); return {
        individualId: p.individualId, sessionId: p.sessionId, dataset: state.dataset, simTimeMs: state.simTimeMs,
        status: state.status, pose: { ...p.pose }, motor: { ...p.motor },
      }; }), events: structuredClone(events),
      disclosure: 'Engineered shared fixture embodiment; controller-camera retinal input only. No full-connectome execution, biological sex comparison, learning or subjective-state inference.' };
  }
  function start() {
    // Validate all current sessions before changing any participant.
    for (const p of participants) {
      const state = p.runtime.snapshot();
      if (state.sessionId !== p.sessionId || state.status === 'fault') throw new RuntimeError('Shared member unavailable or faulted.', 409);
    }
    for (const p of participants) p.runtime.control('start');
    status = 'running'; reason = null; worldEpoch = randomUUID(); lastReceivedAtMs = now(); event('start');
  }
  function checkFreshness() {
    if (status !== 'running') return false;
    const time = now();
    if (participants.some(p => p.runtime.snapshot().status !== 'running' || p.runtime.snapshot().sessionId !== p.sessionId)
      || time < lastReceivedAtMs || time - lastReceivedAtMs > RETINAL_ADAPTER.maxAgeMs) {
      pause('Shared participant or controller observation unavailable; explicit shared start required.'); return false;
    }
    return true;
  }
  function accept(batch) {
    if (!exact(batch, ['worldEpoch', 'worldTick', 'frames']) || batch.worldEpoch !== worldEpoch || batch.worldTick !== tick
      || status !== 'running' || !Array.isArray(batch.frames) || batch.frames.length !== participants.length
      || !Number.isSafeInteger((tick + 1) * 5)) throw new RuntimeError('Invalid shared barrier epoch, clock or membership.', 409);
    const receivedAtMs = now(), frames = new Map();
    if (receivedAtMs < lastReceivedAtMs || receivedAtMs - lastReceivedAtMs > RETINAL_ADAPTER.maxAgeMs) {
      pause('Shared controller deadline elapsed; explicit shared start required.');
      throw new RuntimeError('Shared controller deadline elapsed; explicit shared start required.', 409);
    }
    // Complete validation before preparing any member; rejection changes no session state.
    for (const frame of batch.frames) {
      if (!exact(frame, frameKeys) || frame.version !== 1 || frame.camera !== 'controller' || frame.width !== 8 || frame.height !== 4
        || frame.environmentEpoch !== worldEpoch || frame.frameId !== tick || !integer(frame.capturedAtMs) || !integer(receivedAtMs)
        || frame.capturedAtMs > receivedAtMs || receivedAtMs - frame.capturedAtMs > RETINAL_ADAPTER.maxAgeMs
        || frames.has(frame.individualId) || !ids.has(frame.individualId)) throw new RuntimeError('Invalid, duplicate or stale shared retinal frame.', 409);
      frames.set(frame.individualId, { frame, currents: encodeRetinalRgb(frame.rgb) });
    }
    const staged = participants.map(p => {
      const state = p.runtime.snapshot(), { frame, currents } = frames.get(p.individualId);
      if (state.sessionId !== p.sessionId || frame.sessionId !== p.sessionId || state.status !== 'running'
        || frame.simTimeMs !== state.simTimeMs) throw new RuntimeError('Shared retinal recipient session/time mismatch.', 409);
      const token = p.runtime.prepareStep({ retinalCurrents: currents }), preview = p.runtime.previewStep(token);
      if (preview.kind !== 'ready' || preview.simTimeMs !== state.simTimeMs + 5) {
        pause('Shared numerical step unavailable; no participant advanced.');
        throw new RuntimeError('Shared numerical step unavailable; no participant advanced.', 409);
      }
      const motor = readFixtureMotor(preview), yaw = ((p.pose.yaw + motor.yaw * 0.005 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const pose = validateSharedPose({ x: clamp(p.pose.x + Math.sin(yaw) * motor.forward * 0.005, -2, 2),
        z: clamp(p.pose.z + Math.cos(yaw) * motor.forward * 0.005, -2, 2), yaw });
      return { p, token, motor, pose, trace: { individualId: p.individualId, sessionId: p.sessionId,
        environmentEpoch: worldEpoch, frameId: tick, inputSimTimeMs: state.simTimeMs, outputSimTimeMs: preview.simTimeMs,
        retinalCurrents: currents, motor, pose } };
    });
    // All runtimes revalidate before the synchronous no-callback/no-await commit loop.
    for (const item of staged) item.p.runtime.previewStep(item.token);
    for (const item of staged) item.p.runtime.commitStep(item.token);
    for (const item of staged) { item.p.pose = item.pose; item.p.motor = item.motor; }
    tick++; lastReceivedAtMs = receivedAtMs;
    return structuredClone({ sharedId, worldEpoch, worldTick: tick, traces: staged.map(item => item.trace) });
  }
  return { sharedId, snapshot, start, pause, accept, checkFreshness,
    memberIds: () => participants.map(p => p.individualId) };
}
