import { randomUUID } from 'node:crypto';
import { encodeRetinalRgb, readFixtureMotor } from './environment-adapter.js';
import { createManagedVisitorTransport, visitorFailure } from './managed-visitor-transport.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const scopeKeys = ['appId', 'individualId', 'individualSessionId', 'worldId', 'epoch'];
const common = ['version', 'sessionId', ...scopeKeys];
const poseValid = pose => exact(pose, ['x', 'z', 'yaw']) && Object.values(pose).every(Number.isFinite)
  && Math.abs(pose.x) <= 2 && Math.abs(pose.z) <= 2 && Math.abs(pose.yaw) <= Math.PI;
const failure = () => visitorFailure('invalid-response', 'Managed visitor response failed scope or protocol validation.');
const DISCLOSURE = 'Engineered gentle-patch spatial projection → bounded fixture luminance currents → bilateral rate motor readout. Not rendered retinal imagery, biological vision, learning or subjective-state evidence.';

/** The injected registry lease must exclusively own a resident fixture. Browser selection
 * never supplies runtime authority. No durable checkpoint is used for transient stepping. */
export function createManagedVisitorBridge({ authority, transport = createManagedVisitorTransport(), now = Date.now } = {}) {
  if (typeof authority?.claim !== 'function') throw visitorFailure('configuration', 'Visitor ownership adapter is required.');
  const visits = new Map();
  let pendingCapabilities = null;
  const readClock = now; let lastClock = null;
  now = () => {
    const value = readClock();
    if (!Number.isSafeInteger(value) || value < 0) throw visitorFailure('clock', 'Visitor clock is unavailable.');
    if (lastClock !== null && value < lastClock) {
      for (const r of visits.values()) if (r.owned) {
        r.cancelRequested = true; localQuiet(r); r.reason = 'Clock moved backwards; visitor authority revoked.';
      }
    }
    lastClock = Math.max(lastClock ?? value, value);
    return value;
  };
  const originalScope = r => ({ individualId: r.id, individualSessionId: r.runtimeSession, worldId: r.worldId });
  const scope = r => ({ ...originalScope(r), epoch: r.lease.epoch });
  const current = r => r.owned && r.handle.isCurrent() && r.handle.snapshot().individualId === r.id && r.handle.snapshot().sessionId === r.runtimeSession;
  function snapshot(id) {
    if (!validId(id)) throw visitorFailure('invalid-request', 'Invalid visitor individual ID.');
    const r = visits.get(id);
    return structuredClone({ version: 1, individualId: id, available: transport.enabled === true, phase: r?.phase ?? 'home',
      owned: r?.owned ?? false, running: r?.running ?? false, pending: r?.pending ?? null,
      reason: r?.reason ?? (transport.enabled ? 'Explicit visitor admission required.' : 'Local managed visitor bridge is disabled.'),
      worldId: r?.worldId ?? null, visitEpoch: r?.lease?.epoch ?? null, expiresAt: r?.lease?.expiresAt ?? r?.cleanupBound ?? null,
      individualSessionId: r?.runtimeSession ?? null, lastTrace: r?.lastTrace ?? null, disclosure: DISCLOSURE });
  }
  function localQuiet(r, action = r.returnAction ?? 'pause') {
    r.running = false;
    if (current(r)) r.handle.control(action);
  }
  function release(r) {
    if (r.pending === 'admission') return;
    localQuiet(r, r.returnAction ?? 'pause');
    r.handle.release(); r.owned = false; r.phase = 'home'; r.lease = null; r.cancelRequested = false; r.cleanupBound = null;
    r.reason = r.returnAction === 'rest' ? 'Remote authority ended; home fixture remains resting.' : 'Remote authority ended; home fixture is paused.';
  }
  function matches(r, value, lease = true) {
    return value?.version === 1 && value.appId === transport.appId
      && value.individualId === r.id && value.individualSessionId === r.runtimeSession && value.worldId === r.worldId
      && (!lease || value.sessionId === r.lease.sessionId && value.epoch === r.lease.epoch);
  }
  function validLease(r, value) {
    if (!exact(value, [...common, 'expiresAt', 'status', 'pose']) || !matches(r, value, false) || !validId(value.sessionId)
      || !validId(value.epoch) || value.status !== 'paused' || !integer(value.expiresAt) || value.expiresAt <= now()
      || value.expiresAt > now() + 30000 || !poseValid(value.pose)) throw failure();
    return structuredClone(value);
  }
  function validateAction(r, value, sequence, status) {
    if (!exact(value, [...common, 'expiresAt', 'sequence', 'status', 'pose']) || !matches(r, value)
      || value.sequence !== sequence || value.status !== status || value.expiresAt !== r.lease.expiresAt || !poseValid(value.pose)) throw failure();
    return value;
  }
  async function capabilities(id, worldId) {
    if (!transport.enabled) throw visitorFailure('disabled', 'Local managed visitor bridge is disabled.');
    if (!pendingCapabilities) {
      pendingCapabilities = Promise.resolve().then(() => transport.capabilities()).finally(() => { pendingCapabilities = null; });
    }
    const result = await pendingCapabilities, contract = result?.contract;
    if (result?.version !== 1 || result.appId !== transport.appId || typeof result.available !== 'boolean'
      || !Array.isArray(result.individualIds) || !Array.isArray(result.worldIds)) throw failure();
    if (!result.available) throw visitorFailure('unsupported', 'Managed host has not enabled the required nonhumanoid visitor protocol.');
    if (!result.individualIds.includes(id) || worldId !== undefined && !result.worldIds.includes(worldId)) throw visitorFailure('unauthorized', 'Individual or world is outside the owner-approved visitor scope.');
    if (contract?.version !== 1 || contract.expiryEnforced !== true || contract.admissionDeadline !== true
      || !Array.isArray(contract.bodies) || !contract.bodies.includes('fly-v1') || !Array.isArray(contract.actions)
      || !['start', 'pause', 'rest', 'move', 'leave'].every(action => contract.actions.includes(action))
      || contract.controllerRaster?.width !== 8 || contract.controllerRaster?.height !== 4 || contract.controllerRaster?.channels !== 3) throw failure();
    return { available: true, worldIds: result.worldIds.filter(validId), disclosure: DISCLOSURE };
  }
  function reconcile(r) {
    if (r.cleanupPromise) return r.cleanupPromise;
    const promise = performReconcile(r);
    r.cleanupPromise = promise.finally(() => { r.cleanupPromise = null; });
    return r.cleanupPromise;
  }
  async function performReconcile(r) {
    if (!r.owned) return snapshot(r.id);
    localQuiet(r, r.returnAction ?? 'pause'); r.phase = 'returning'; r.nextCleanupAt = now() + 1000;
    if (r.cleanupBound !== null && now() >= r.cleanupBound && r.pending !== 'admission') { release(r); return snapshot(r.id); }
    try {
      if (r.lease) {
        const result = await transport.leave(r.lease.sessionId, scope(r));
        if (!exact(result, [...common, 'status']) || !matches(r, result) || result.status !== 'left') throw failure();
        if (r.pending !== 'admission') release(r);
      } else {
        const result = await transport.cancel(originalScope(r));
        if (!exact(result, ['version', 'appId', 'individualId', 'individualSessionId', 'worldId', 'confirmed', 'pending', 'expiresAt'])
          || !matches(r, result, false) || typeof result.confirmed !== 'boolean' || typeof result.pending !== 'boolean'
          || result.expiresAt !== null && (!integer(result.expiresAt) || result.expiresAt > now() + 300000)
          || result.confirmed && result.pending) throw failure();
        r.cleanupBound = result.expiresAt;
        if (result.confirmed && r.pending !== 'admission') release(r);
      }
    } catch (error) { r.phase = error.code === 'timed-out' ? 'timed-out' : 'disconnected'; r.reason = 'Remote cleanup is unconfirmed; local ownership remains paused.'; }
    return snapshot(r.id);
  }
  async function admit(id, input) {
    if (!validId(id) || !exact(input, ['worldId']) || !validId(input.worldId)) throw visitorFailure('invalid-request', 'Invalid visitor admission request.');
    if (visits.get(id)?.owned) throw visitorFailure('already-owned', 'An admission or visitor return already owns this individual.');
    if (!transport.enabled) throw visitorFailure('disabled', 'Local managed visitor bridge is disabled.');
    if (visits.size >= 64 && !visits.has(id)) throw visitorFailure('capacity', 'Visitor bridge identity capacity reached.');
    const handle = authority.claim(id, randomUUID()), state = handle.snapshot();
    const r = { id, handle, owned: true, runtimeSession: state.sessionId, worldId: input.worldId, lease: null,
      phase: 'admission', reason: 'Requesting explicit paused admission.', pending: 'admission', running: false,
      cancelRequested: false, sequence: -1, frameId: -1, cleanupBound: null, nextCleanupAt: 0, returnAction: 'pause', lastTrace: null };
    visits.set(id, r); localQuiet(r);
    let attempted = false;
    try {
      if (state.source !== 'fixture' || !current(r)) throw visitorFailure('unsupported', 'Only an exclusively owned loaded fixture can visit.');
      await capabilities(id, input.worldId);
      if (!current(r) || r.cancelRequested) throw visitorFailure('canceled', 'Visitor admission canceled before departure.');
      attempted = true;
      const response = await transport.admit({ ...originalScope(r), body: 'fly-v1', ttlMs: 30000 });
      r.lease = validLease(r, response); r.cleanupBound = r.lease.expiresAt;
      if (!current(r) || r.cancelRequested) throw visitorFailure('canceled', 'Visitor admission superseded.');
      r.phase = 'visiting'; r.reason = 'Host acknowledged admission; visitor and local fixture remain paused.';
    } catch (error) {
      r.reason = error instanceof Error && ['disabled', 'unsupported', 'unauthorized', 'canceled'].includes(error.code) ? error.message : 'Visitor admission was not confirmed.';
      r.phase = error.code === 'timed-out' ? 'timed-out' : attempted ? 'disconnected' : 'blocked';
      r.cancelRequested = attempted;
      if (!attempted) { r.pending = null; release(r); r.phase = 'blocked'; }
    } finally { r.pending = null; }
    if (r.cancelRequested) await reconcile(r);
    return snapshot(id);
  }
  function record(id) { const r = visits.get(id); if (!r?.owned) throw visitorFailure('unavailable', 'No owned visitor session for this individual.'); return r; }
  async function control(id, action) {
    if (!['start', 'pause', 'rest', 'home'].includes(action)) throw visitorFailure('invalid-request', 'Unknown visitor control.');
    const r = record(id); now();
    if (action === 'home') { r.cancelRequested = true; r.returnAction = 'home'; return reconcile(r); }
    if (action !== 'start') { r.returnAction = action; localQuiet(r, action); }
    if (r.pending || r.cancelRequested || !r.lease || !current(r) || r.lease.expiresAt <= now()) {
      if (action === 'start') throw visitorFailure('unavailable', 'Visitor is not ready for explicit start.');
      r.cancelRequested = true; return reconcile(r);
    }
    r.pending = action;
    try {
      const sequence = r.sequence + 1, status = { start: 'running', pause: 'paused', rest: 'resting' }[action];
      const result = await transport.action(r.lease.sessionId, { ...scope(r), sequence, action: { type: action } });
      validateAction(r, result, sequence, status);
      if (!current(r) || r.cancelRequested || r.lease.expiresAt <= now()) throw failure();
      r.handle.control(action); r.running = action === 'start'; if (action === 'start') r.returnAction = 'pause'; r.sequence = sequence; r.reason = `Visitor ${status}.`;
    } catch { localQuiet(r); r.cancelRequested = true; r.reason = 'Visitor control was not confirmed; paused return required.'; }
    finally { r.pending = null; }
    if (r.cancelRequested) await reconcile(r);
    return snapshot(id);
  }
  async function tick(id) {
    const r = visits.get(id); if (!r?.owned || r.pending) return null;
    if (!current(r) || r.lease && r.lease.expiresAt <= now() || r.running && r.handle.snapshot().status !== 'running') {
      r.cancelRequested = true; localQuiet(r); r.reason = 'Visitor lifecycle or expiry changed; outward control stopped.';
    }
    if (r.cancelRequested) return now() >= r.nextCleanupAt ? reconcile(r) : null;
    if (!r.running || !r.lease) return null;
    r.pending = 'step';
    try {
      const before = r.handle.snapshot(), observation = await transport.observe(r.lease.sessionId, scope(r));
      if (!exact(observation, [...common, 'frameId', 'capturedAtMs', 'camera', 'width', 'height', 'rgb', 'pose', 'sensorySource'])
        || !matches(r, observation) || !integer(observation.frameId) || observation.frameId <= r.frameId
        || !integer(observation.capturedAtMs) || observation.capturedAtMs > now() || now() - observation.capturedAtMs > 250
        || observation.camera !== 'controller' || observation.width !== 8 || observation.height !== 4
        || observation.sensorySource !== 'engineered-gentle-patch-spatial-proxy-v1' || !poseValid(observation.pose)
        || !current(r) || r.cancelRequested || r.handle.snapshot().simTimeMs !== before.simTimeMs) throw failure();
      const currents = encodeRetinalRgb(observation.rgb), token = r.handle.prepareStep({ retinalCurrents: currents }), preview = r.handle.previewStep(token);
      if (preview.kind !== 'ready' || preview.simTimeMs !== before.simTimeMs + 5) throw failure();
      const motor = readFixtureMotor(preview), sequence = r.sequence + 1;
      const result = await transport.action(r.lease.sessionId, { ...scope(r), sequence, action: { type: 'move', ...motor, intervalMs: 5 } });
      validateAction(r, result, sequence, 'running');
      if (!current(r) || r.cancelRequested || r.lease.expiresAt <= now()) throw failure();
      r.handle.previewStep(token); r.handle.commitStep(token);
      r.sequence = sequence; r.frameId = observation.frameId;
      r.lastTrace = { individualId: id, individualSessionId: r.runtimeSession, visitEpoch: r.lease.epoch,
        frameId: observation.frameId, inputSimTimeMs: before.simTimeMs, outputSimTimeMs: preview.simTimeMs,
        sensorySource: observation.sensorySource, motor, pose: result.pose };
      return structuredClone(r.lastTrace);
    } catch { localQuiet(r); r.cancelRequested = true; r.reason = 'Observation or movement was not confirmed; paused return required.'; }
    finally { r.pending = null; }
    return reconcile(r);
  }
  async function lifecycle(id) { const r = visits.get(id); if (!r?.owned) return snapshot(id); r.cancelRequested = true; return reconcile(r); }
  return { snapshot, capabilities, admit, control, tick, lifecycle,
    disconnectAll: () => Promise.allSettled([...visits.values()].filter(r => r.owned).map(r => lifecycle(r.id))) };
}
