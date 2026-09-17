import { randomUUID } from 'node:crypto';
import { SENSORY_LIMITS } from './stimulus-policy.js';

export const RETINAL_ADAPTER = Object.freeze({ version: 1, width: 8, height: 4, channels: 3,
  maxAgeMs: 250, maxCurrent: SENSORY_LIMITS.maxCurrent, maxForwardSpeed: 0.12, maxYawSpeed: 0.8,
  disclosure: 'Engineered 8×4 controller-camera luminance currents and bilateral fixture rate readout. No biological receptor mapping, learning, or validated fly vision.' });
const keys = ['version', 'individualId', 'sessionId', 'environmentEpoch', 'frameId', 'simTimeMs', 'capturedAtMs', 'camera', 'width', 'height', 'rgb'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

export function encodeRetinalRgb(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 96 || !Array.from({ length: 96 }, (_, i) =>
    Object.hasOwn(rgb, i) && Number.isInteger(rgb[i]) && rgb[i] >= 0 && rgb[i] <= 255).every(Boolean)) throw new Error('Retinal RGB must contain exactly 96 integer bytes.');
  return Array.from({ length: 32 }, (_, i) => RETINAL_ADAPTER.maxCurrent
    * (0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]) / 255);
}

/** Rate readout is an engineered controller; no target coordinates or mental-state inference. */
export function readFixtureMotor(snapshot) {
  if (snapshot.status !== 'running') return { forward: 0, yaw: 0 };
  const neurons = snapshot.neural?.neurons;
  if (!Array.isArray(neurons) || neurons.length !== 32 || neurons.some((n, i) => n.id !== `fixture-${i}`
    || !Number.isFinite(n.rateHz) || n.rateHz < 0 || n.rateHz > 100)) throw new Error('Invalid fixture motor telemetry.');
  // Raster left/right halves, not the fixture's anatomical-sounding decorative region labels.
  const left = neurons.filter((_, i) => i % 8 < 4).reduce((sum, n) => sum + n.rateHz, 0) / 16;
  const right = neurons.filter((_, i) => i % 8 >= 4).reduce((sum, n) => sum + n.rateHz, 0) / 16;
  return { forward: RETINAL_ADAPTER.maxForwardSpeed * clamp(((left + right) / 2 - 10) / 30, 0, 1),
    yaw: RETINAL_ADAPTER.maxYawSpeed * clamp((right - left) / 20, -1, 1) };
}

/** One accepted frame advances exactly one fixture step. The supervisor must stop its
 * independent timer for an attached recipient, and call checkFreshness while awaiting frames.
 */
export function createEnvironmentAdapter(runtime, { now = Date.now, initialPose = { x: 0, z: 0, yaw: 0 } } = {}) {
  const initial = runtime.snapshot();
  const individualId = initial.individualId, sessionId = initial.sessionId;
  let environmentEpoch = randomUUID(), lastFrameId = -1, lastReceivedAtMs = null, lastTrace = null, awaitingSinceMs = null;
  let motor = { forward: 0, yaw: 0 };
  let pauseReason = 'Controller attached paused; explicitly run to begin.';
  if (!initialPose || Object.keys(initialPose).length !== 3 || !['x', 'z', 'yaw'].every(k => Number.isFinite(initialPose[k]))
    || Math.abs(initialPose.x) > 2 || Math.abs(initialPose.z) > 2 || Math.abs(initialPose.yaw) > Math.PI) throw new Error('Invalid initial body pose');
  let pose = { ...initialPose };
  function invalidate(reason = 'Environment session changed.') {
    pauseReason = reason;
    environmentEpoch = randomUUID(); lastFrameId = -1; lastReceivedAtMs = null; lastTrace = null; awaitingSinceMs = null;
    motor = { forward: 0, yaw: 0 };
    runtime.control('pause');
    return { environmentEpoch, reason };
  }
  function checkFreshness() {
    const state = runtime.snapshot();
    if (state.individualId !== individualId || state.sessionId !== sessionId) throw new Error('Runtime identity/session changed; recreate environment adapter.');
    if (state.status !== 'running') { motor = { forward: 0, yaw: 0 }; awaitingSinceMs = null; return false; }
    if (lastReceivedAtMs === null && awaitingSinceMs === null) awaitingSinceMs = now();
    const freshnessStart = lastReceivedAtMs ?? awaitingSinceMs;
    if (now() - freshnessStart > RETINAL_ADAPTER.maxAgeMs || now() < freshnessStart) {
      invalidate('Controller observation unavailable or stale; explicit resume and fresh epoch required.'); return false;
    }
    return true;
  }
  function accept(frame) {
    const state = runtime.snapshot(), receivedAtMs = now();
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).length !== keys.length
      || !keys.every(key => Object.hasOwn(frame, key)) || frame.version !== 1
      || frame.camera !== 'controller' || frame.width !== 8 || frame.height !== 4) throw new Error('Invalid controller retinal frame schema.');
    if (state.individualId !== individualId || state.sessionId !== sessionId || frame.individualId !== individualId
      || frame.sessionId !== sessionId || frame.environmentEpoch !== environmentEpoch) throw new Error('Retinal recipient, session or environment epoch mismatch.');
    if (state.status !== 'running') throw new Error('Explicitly run the fixture before sending controller observations.');
    if (!integer(frame.frameId) || frame.frameId <= lastFrameId || frame.simTimeMs !== state.simTimeMs) throw new Error('Duplicate, stale or future retinal frame sequence/time.');
    if (!integer(frame.capturedAtMs) || !integer(receivedAtMs) || frame.capturedAtMs > receivedAtMs
      || receivedAtMs - frame.capturedAtMs > RETINAL_ADAPTER.maxAgeMs) throw new Error('Controller retinal frame is stale or future-dated.');
    const currents = encodeRetinalRgb(frame.rgb);
    if (!checkFreshness()) throw new Error('Controller observation unavailable or stale; explicit resume and fresh epoch required.');
    runtime.step({ retinalCurrents: currents });
    const after = runtime.snapshot();
    // Faulting steps retain last valid state; do not manufacture a movement output.
    motor = readFixtureMotor(after);
    const elapsedSeconds = (after.simTimeMs - state.simTimeMs) / 1000;
    const yaw = ((pose.yaw + motor.yaw * elapsedSeconds + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    pose = { x: clamp(pose.x + Math.sin(yaw) * motor.forward * elapsedSeconds, -2, 2),
      z: clamp(pose.z + Math.cos(yaw) * motor.forward * elapsedSeconds, -2, 2), yaw };
    lastFrameId = frame.frameId; lastReceivedAtMs = receivedAtMs; pauseReason = null;
    lastTrace = { individualId, sessionId, environmentEpoch, frameId: frame.frameId,
      inputSimTimeMs: state.simTimeMs, outputSimTimeMs: after.simTimeMs,
      retinalCurrents: currents, motor: { ...motor }, pose: { ...pose } };
    return structuredClone(lastTrace);
  }
  return { accept, checkFreshness, invalidate,
    snapshot: () => structuredClone({ ...RETINAL_ADAPTER, individualId, sessionId, environmentEpoch,
      lastFrameId, lastReceivedAtMs, pauseReason, pose, posePersistence: 'Engineered body pose retained by explicit registry checkpoints; controller leases and sensory frames are never restored.', motor: runtime.snapshot().status === 'running' ? motor : { forward: 0, yaw: 0 }, lastTrace }) };
}
