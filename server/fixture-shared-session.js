import { validSharedCount } from '../shared/population-limits.js';
import { randomUUID } from 'node:crypto';
import { RETINAL_ADAPTER, encodeRetinalRgb, readFixtureMotor } from './environment-adapter.js';
import { RuntimeError } from './runtime.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const frameKeys = ['version', 'individualId', 'sessionId', 'environmentEpoch', 'frameId', 'simTimeMs', 'capturedAtMs', 'camera', 'width', 'height', 'rgb'];
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
export const SHARED_SESSION_VERSIONS = Object.freeze([1, 2]);
export function validateSharedPose(pose) {
  if (!exact(pose, ['x', 'z', 'yaw']) || !Object.values(pose).every(Number.isFinite)
    || Math.abs(pose.x) > 2 || Math.abs(pose.z) > 2 || Math.abs(pose.yaw) > Math.PI) throw new RuntimeError('Invalid shared body pose.');
  return pose;
}

/** Synchronous fixture barrier. Runtimes remain the sole neural authority; tokens stage
 * transient steps without checkpoint restoration, input cancellation or neural exchange.
 *
 * Version 1 is the original contract: every member is active and every barrier advances
 * every member's neural clock by exactly 5 ms.
 *
 * Version 2 adds an explicit per-member `active | resting` mode. A resting member keeps its
 * frame slot (so the batch stays complete and attributable) but carries `rgb: null`, receives
 * no retinal current, runs no neural step and keeps its committed pose and zero motor. The
 * world barrier continues for the remaining active members. Rest is never penalized: no input
 * escalates, no baseline support is withdrawn and resuming needs only an explicit resume.
 * When every member rests, the session status becomes `resting` and `accept` refuses, so the
 * world can never silently advance with nobody running.
 *
 * Both versions support partial withdrawal at a committed boundary: `withdraw(individualId)`
 * rebuilds membership without touching the surviving members' sessions, records the boundary
 * in the bounded event ring, and refuses to drop below the two-member minimum (the caller
 * separates the whole session instead, so an individual is never trapped). Membership and
 * mode changes deliberately do NOT rotate the world epoch: a stale in-flight batch is already
 * refused by the exact frame-count, membership and per-member mode checks in `accept`, and
 * rotating would revoke the other members' unrelated, still valid controller state.
 */
export function createFixtureSharedSession(members, { tick: initialTick = 0, now = Date.now, version = 1 } = {}) {
  if (!SHARED_SESSION_VERSIONS.includes(version)) throw new RuntimeError('Unsupported shared session version.');
  if (!Array.isArray(members) || !validSharedCount(members.length) || !integer(initialTick)
    || !Number.isSafeInteger(initialTick * 5)) throw new RuntimeError('Invalid shared fixture membership or clock.');
  const ids = new Set();
  let participants = members.map(({ runtime, pose, mode = 'active' }) => {
    const state = runtime.snapshot();
    if (!['active', 'resting'].includes(mode) || (version === 1 && mode !== 'active')
      || ids.has(state.individualId) || state.source !== 'fixture') throw new RuntimeError('Shared members must be distinct fixtures.');
    ids.add(state.individualId);
    return { runtime, mode, individualId: state.individualId, sessionId: state.sessionId, pose: structuredClone(validateSharedPose(pose)), motor: { forward: 0, yaw: 0 } };
  });
  if (version === 2 && participants.every(p => p.mode === 'resting')) throw new RuntimeError('A joined population cannot start with every member resting.');
  // A declared resting member's runtime must already hold the matching quiet state, including
  // on a joint restore that rebuilds fresh paused runtimes from a checkpointed mode.
  for (const p of participants) if (p.mode === 'resting') p.runtime.control('rest');
  const sharedId = randomUUID();
  let worldEpoch = randomUUID(), tick = initialTick, status = 'paused', reason = 'Explicit shared start required.', lastReceivedAtMs = null;
  let events = [{ type: 'join', tick }];
  const event = (type, extra = {}) => { events.push({ type, tick, ...extra }); events = events.slice(-64); };
  const quiet = p => p.runtime.control(p.mode === 'resting' ? 'rest' : 'pause');
  const expected = p => (p.mode === 'resting' ? 'resting' : 'running');
  const memberFor = individualId => {
    const member = participants.find(p => p.individualId === individualId);
    if (!member) throw new RuntimeError('Individual is not a member of this shared session.', 404);
    return member;
  };
  function pause(message = 'Shared session paused.') {
    for (const p of participants) { quiet(p); p.motor = { forward: 0, yaw: 0 }; }
    status = 'paused'; reason = message; worldEpoch = randomUUID(); lastReceivedAtMs = null; event('pause');
  }
  function snapshot() {
    return { version, sharedId, worldEpoch, tick, intervalMs: 5, worldTimeMs: tick * 5, status, reason, lastReceivedAtMs,
      participants: participants.map(p => { const state = p.runtime.snapshot(); return {
        individualId: p.individualId, sessionId: p.sessionId, dataset: state.dataset, simTimeMs: state.simTimeMs,
        ...(version === 2 ? { mode: p.mode } : {}),
        status: state.status, pose: { ...p.pose }, motor: { ...p.motor },
      }; }), events: structuredClone(events),
      disclosure: version === 2
        ? 'Engineered shared fixture embodiment with explicit per-member rest; a resting member freezes its own neural clock and pose while the others continue. Controller-camera retinal input only. No full-connectome execution, biological sex comparison, learning or subjective-state inference.'
        : 'Engineered shared fixture embodiment; controller-camera retinal input only. No full-connectome execution, biological sex comparison, learning or subjective-state inference.' };
  }
  function start() {
    // Validate all current sessions before changing any participant.
    for (const p of participants) {
      const state = p.runtime.snapshot();
      if (state.sessionId !== p.sessionId || state.status === 'fault') throw new RuntimeError('Shared member unavailable or faulted.', 409);
    }
    if (participants.every(p => p.mode === 'resting')) throw new RuntimeError('Every member is resting; explicitly resume one before starting the world.', 409);
    for (const p of participants) p.runtime.control(p.mode === 'resting' ? 'rest' : 'start');
    status = 'running'; reason = null; worldEpoch = randomUUID(); lastReceivedAtMs = now(); event('start');
  }
  function checkFreshness() {
    if (status !== 'running') return false;
    const time = now();
    if (participants.some(p => p.runtime.snapshot().status !== expected(p) || p.runtime.snapshot().sessionId !== p.sessionId)
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
      if (!exact(frame, version === 2 ? [...frameKeys, 'mode'] : frameKeys) || frame.version !== version || frame.camera !== 'controller'
        || frame.width !== 8 || frame.height !== 4
        || frame.environmentEpoch !== worldEpoch || frame.frameId !== tick || !integer(frame.capturedAtMs) || !integer(receivedAtMs)
        || frame.capturedAtMs > receivedAtMs || receivedAtMs - frame.capturedAtMs > RETINAL_ADAPTER.maxAgeMs
        || frames.has(frame.individualId) || !ids.has(frame.individualId)) throw new RuntimeError('Invalid, duplicate or stale shared retinal frame.', 409);
      const member = participants.find(p => p.individualId === frame.individualId);
      const resting = version === 2 && member.mode === 'resting';
      if (version === 2 && frame.mode !== member.mode) throw new RuntimeError('Shared member mode mismatch; re-render the batch for the committed membership.', 409);
      if (resting && frame.rgb !== null) throw new RuntimeError('A resting shared member receives no retinal input.', 409);
      frames.set(frame.individualId, { frame, currents: resting ? null : encodeRetinalRgb(frame.rgb) });
    }
    const staged = participants.map(p => {
      const state = p.runtime.snapshot(), { frame, currents } = frames.get(p.individualId);
      if (state.sessionId !== p.sessionId || frame.sessionId !== p.sessionId || state.status !== expected(p)
        || frame.simTimeMs !== state.simTimeMs) throw new RuntimeError('Shared retinal recipient session/time mismatch.', 409);
      const base = { individualId: p.individualId, sessionId: p.sessionId, ...(version === 2 ? { mode: p.mode } : {}),
        environmentEpoch: worldEpoch, frameId: tick, inputSimTimeMs: state.simTimeMs };
      // A resting member holds its neural clock, pose and motor; only world time advances for it.
      if (p.mode === 'resting') return { p, token: null, motor: { forward: 0, yaw: 0 }, pose: { ...p.pose },
        trace: { ...base, outputSimTimeMs: state.simTimeMs, retinalCurrents: null, motor: { forward: 0, yaw: 0 }, pose: { ...p.pose } } };
      const token = p.runtime.prepareStep({ retinalCurrents: currents }), preview = p.runtime.previewStep(token);
      if (preview.kind !== 'ready' || preview.simTimeMs !== state.simTimeMs + 5) {
        pause('Shared numerical step unavailable; no participant advanced.');
        throw new RuntimeError('Shared numerical step unavailable; no participant advanced.', 409);
      }
      const motor = readFixtureMotor(preview), yaw = ((p.pose.yaw + motor.yaw * 0.005 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const pose = validateSharedPose({ x: clamp(p.pose.x + Math.sin(yaw) * motor.forward * 0.005, -2, 2),
        z: clamp(p.pose.z + Math.cos(yaw) * motor.forward * 0.005, -2, 2), yaw });
      return { p, token, motor, pose, trace: { ...base, outputSimTimeMs: preview.simTimeMs, retinalCurrents: currents, motor, pose } };
    });
    // All runtimes revalidate before the synchronous no-callback/no-await commit loop.
    for (const item of staged) if (item.token) item.p.runtime.previewStep(item.token);
    for (const item of staged) if (item.token) item.p.runtime.commitStep(item.token);
    for (const item of staged) { item.p.pose = item.pose; item.p.motor = item.motor; }
    tick++; lastReceivedAtMs = receivedAtMs;
    return structuredClone({ sharedId, worldEpoch, worldTick: tick, traces: staged.map(item => item.trace) });
  }
  /** Freeze or resume exactly one member. Never changes another member's clock, pose or mode. */
  function memberControl(individualId, action) {
    if (version !== 2) throw new RuntimeError('Per-member rest requires an explicit version 2 shared session.', 409);
    if (!['rest', 'resume'].includes(action)) throw new RuntimeError('Unknown shared member action.');
    const member = memberFor(individualId), state = member.runtime.snapshot();
    if (state.sessionId !== member.sessionId || state.status === 'fault') throw new RuntimeError('Shared member unavailable or faulted.', 409);
    if ((action === 'rest') === (member.mode === 'resting')) throw new RuntimeError('Member is already in the requested mode.', 409);
    member.mode = action === 'rest' ? 'resting' : 'active';
    member.motor = { forward: 0, yaw: 0 };
    member.runtime.control(action === 'rest' ? 'rest' : status === 'running' ? 'start' : 'pause');
    if (participants.every(p => p.mode === 'resting')) {
      status = 'resting'; reason = 'Every member is resting; the world clock is frozen until a member explicitly resumes.'; lastReceivedAtMs = null;
    } else if (status === 'resting') {
      status = 'paused'; reason = 'A member resumed; explicit shared start required.'; lastReceivedAtMs = null;
    }
    event(action, { individualId });
    return snapshot();
  }
  /** Withdraw one member at the committed boundary; survivors keep their session and clock. */
  function withdraw(individualId) {
    const member = memberFor(individualId);
    if (!validSharedCount(participants.length - 1)) throw new RuntimeError('Withdrawal would drop the population below two members; separate the whole session instead.', 409);
    participants = participants.filter(p => p !== member);
    ids.delete(individualId);
    quiet(member); member.motor = { forward: 0, yaw: 0 };
    if (participants.every(p => p.mode === 'resting')) {
      status = 'resting'; reason = 'Every remaining member is resting; the world clock is frozen until a member explicitly resumes.'; lastReceivedAtMs = null;
    }
    event('withdraw', { individualId });
    return { individualId, sessionId: member.sessionId, mode: member.mode, pose: { ...member.pose } };
  }
  return { sharedId, version, snapshot, start, pause, accept, checkFreshness, memberControl, withdraw,
    memberIds: () => participants.map(p => p.individualId) };
}
