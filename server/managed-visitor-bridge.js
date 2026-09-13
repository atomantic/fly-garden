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
const CONTRACT_ACTIONS = ['start', 'pause', 'rest', 'move', 'leave', 'interact'];
/** Derived settling gate: the fixture's own bounded forward readout, not a caretaker target. */
const SETTLE_FORWARD = 0.012;
const patchObjectValid = value => exact(value, ['objectId', 'x', 'z', 'radius']) && validId(value.objectId)
  && [value.x, value.z].every(v => Number.isFinite(v) && Math.abs(v) <= 2)
  && Number.isFinite(value.radius) && value.radius > 0 && value.radius <= 0.5;
const withinReach = (pose, object) => Math.hypot(pose.x - object.x, pose.z - object.z) <= object.radius;
const DISCLOSURE = 'Engineered gentle-patch spatial projection → bounded fixture luminance currents → bilateral rate motor readout. Not rendered retinal imagery, biological vision, learning or subjective-state evidence.';

/** The injected registry lease must exclusively own a resident fixture. Browser selection
 * never supplies runtime authority. No durable checkpoint is used for transient stepping. */
export function createManagedVisitorBridge({ authority, transport = createManagedVisitorTransport(), now = Date.now } = {}) {
  if (typeof authority?.claim !== 'function') throw visitorFailure('configuration', 'Visitor ownership adapter is required.');
  const visits = new Map();
  let pendingCapabilities = null;
  /** Last successfully negotiated host contract limits. Absent capacity means exactly one visitor. */
  let negotiated = null;
  const ownedCount = () => [...visits.values()].filter(r => r.owned).length;
  const hostCapacity = () => negotiated?.maxConcurrentVisitors ?? 1;
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
      individualSessionId: r?.runtimeSession ?? null, lastTrace: r?.lastTrace ?? null,
      interactArmed: r?.interactArmed ?? false, lastInteraction: r?.lastInteraction ?? null,
      patchObjects: (r?.patchObjects ?? negotiated?.patchObjects ?? []).map(object => object.objectId),
      hostCapacity: negotiated === null ? null : negotiated.maxConcurrentVisitors,
      hostVisitors: ownedCount(), disclosure: DISCLOSURE });
  }
  function localQuiet(r, action = r.returnAction ?? 'pause') {
    r.running = false;
    if (current(r)) r.handle.control(action);
  }
  function release(r) {
    if (r.pending === 'admission') return;
    localQuiet(r, r.returnAction ?? 'pause');
    r.handle.release(); r.owned = false; r.phase = 'home'; r.lease = null; r.cancelRequested = false; r.cleanupBound = null;
    r.interactArmed = false;
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
  /** An interaction acknowledgment carries its own schema; the host may not smuggle extra fields,
   * and the confirmed pose must still lie inside the negotiated patch object it named. */
  function validateInteraction(r, value, sequence, contact) {
    if (!exact(value, [...common, 'expiresAt', 'sequence', 'status', 'pose', 'interaction']) || !matches(r, value)
      || value.sequence !== sequence || value.status !== 'running' || value.expiresAt !== r.lease.expiresAt
      || !poseValid(value.pose) || !exact(value.interaction, ['objectId', 'effect', 'accepted'])
      || value.interaction.objectId !== contact.objectId || value.interaction.accepted !== true
      || value.interaction.effect !== 'settle' || !r.interactionEffects.includes(value.interaction.effect)
      || !withinReach(value.pose, contact)) throw failure();
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
    const capacity = contract?.maxConcurrentVisitors, objects = contract?.patchObjects, effects = contract?.interactionEffects;
    if (contract?.version !== 1 || contract.expiryEnforced !== true || contract.admissionDeadline !== true
      || !Array.isArray(contract.bodies) || !contract.bodies.includes('fly-v1') || !Array.isArray(contract.actions)
      || !CONTRACT_ACTIONS.every(action => contract.actions.includes(action))
      // An absent capacity field is a single-visitor host, never an unbounded one.
      || capacity !== undefined && !(Number.isSafeInteger(capacity) && capacity >= 1 && capacity <= 64)
      || !Array.isArray(objects) || !objects.length || objects.length > 16 || !objects.every(patchObjectValid)
      || new Set(objects.map(object => object.objectId)).size !== objects.length
      || !Array.isArray(effects) || !effects.every(effect => typeof effect === 'string') || !effects.includes('settle')
      || contract.controllerRaster?.width !== 8 || contract.controllerRaster?.height !== 4 || contract.controllerRaster?.channels !== 3) throw failure();
    negotiated = { maxConcurrentVisitors: capacity ?? 1, patchObjects: structuredClone(objects), interactionEffects: [...effects] };
    return { available: true, worldIds: result.worldIds.filter(validId), maxConcurrentVisitors: negotiated.maxConcurrentVisitors,
      patchObjects: negotiated.patchObjects.map(object => object.objectId), interactionEffects: [...negotiated.interactionEffects],
      disclosure: DISCLOSURE };
  }
  function reconcile(r) {
    if (r.cleanupPromise) return r.cleanupPromise;
    const promise = performReconcile(r);
    r.cleanupPromise = promise.finally(() => { r.cleanupPromise = null; });
    return r.cleanupPromise;
  }
  async function performReconcile(r) {
    if (!r.owned) return snapshot(r.id);
    // A repeat attempt after an unconfirmed cleanup is a distinct, non-terminal retry state.
    const retrying = ['disconnected', 'timed-out', 'reconnecting'].includes(r.phase);
    localQuiet(r, r.returnAction ?? 'pause'); r.phase = retrying ? 'reconnecting' : 'returning'; r.nextCleanupAt = now() + 1000;
    if (retrying) r.reason = 'Retrying unconfirmed remote cleanup; local ownership remains paused.';
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
    // Refuse before any claim so an existing visit is never paused or disturbed by a rejected second admission.
    if (ownedCount() >= hostCapacity()) throw visitorFailure('host-capacity',
      `Host negotiated ${hostCapacity()} concurrent managed visitor${hostCapacity() === 1 ? '' : 's'}; the existing visit was left undisturbed.`);
    if (visits.size >= 64 && !visits.has(id)) throw visitorFailure('capacity', 'Visitor bridge identity capacity reached.');
    const handle = authority.claim(id, randomUUID()), state = handle.snapshot();
    const r = { id, handle, owned: true, runtimeSession: state.sessionId, worldId: input.worldId, lease: null,
      phase: 'admission', reason: 'Requesting explicit paused admission.', pending: 'admission', running: false,
      cancelRequested: false, sequence: -1, frameId: -1, cleanupBound: null, nextCleanupAt: 0, returnAction: 'pause', lastTrace: null,
      interactArmed: false, lastInteraction: null, patchObjects: [], interactionEffects: [] };
    visits.set(id, r); localQuiet(r);
    let attempted = false;
    try {
      if (state.source !== 'fixture' || !current(r)) throw visitorFailure('unsupported', 'Only an exclusively owned loaded fixture can visit.');
      await capabilities(id, input.worldId);
      // Re-check against the freshly negotiated limit; the host may have lowered it since the cached read.
      if (ownedCount() > hostCapacity()) throw visitorFailure('host-capacity',
        `Host negotiated ${hostCapacity()} concurrent managed visitor${hostCapacity() === 1 ? '' : 's'}; the existing visit was left undisturbed.`);
      r.patchObjects = structuredClone(negotiated.patchObjects); r.interactionEffects = [...negotiated.interactionEffects];
      if (!current(r) || r.cancelRequested) throw visitorFailure('canceled', 'Visitor admission canceled before departure.');
      attempted = true;
      r.phase = 'departing'; r.reason = 'Scoped departure requested; the host has not acknowledged a body yet.';
      const response = await transport.admit({ ...originalScope(r), body: 'fly-v1', ttlMs: 30000 });
      r.lease = validLease(r, response); r.cleanupBound = r.lease.expiresAt;
      if (!current(r) || r.cancelRequested) throw visitorFailure('canceled', 'Visitor admission superseded.');
      r.phase = 'visiting'; r.reason = 'Host acknowledged admission; visitor and local fixture remain paused.';
    } catch (error) {
      // Keep the specific refusal; releasing ownership below would otherwise overwrite it with the generic home reason.
      const reason = error instanceof Error && ['disabled', 'unsupported', 'unauthorized', 'canceled', 'host-capacity'].includes(error.code)
        ? error.message : 'Visitor admission was not confirmed.';
      r.phase = error.code === 'timed-out' ? 'timed-out' : attempted ? 'disconnected' : 'blocked';
      r.cancelRequested = attempted;
      if (!attempted) { r.pending = null; release(r); r.phase = 'blocked'; }
      r.reason = reason;
    } finally { r.pending = null; }
    if (r.cancelRequested) await reconcile(r);
    return snapshot(id);
  }
  function record(id) { const r = visits.get(id); if (!r?.owned) throw visitorFailure('unavailable', 'No owned visitor session for this individual.'); return r; }
  async function control(id, action) {
    if (!['start', 'pause', 'rest', 'home', 'interact'].includes(action)) throw visitorFailure('invalid-request', 'Unknown visitor control.');
    const r = record(id); now();
    if (action === 'interact') {
      // Arming is a local permission only. It never names an object, an effect or a moment:
      // contact is derived later from the fixture's own pose and bounded motor readout.
      if (!r.patchObjects.length) throw visitorFailure('unsupported', 'Host negotiated no patch-object interaction allowlist.');
      if (r.pending || r.cancelRequested || !r.lease || !current(r) || r.lease.expiresAt <= now())
        throw visitorFailure('unavailable', 'Visitor is not ready for patch interaction.');
      r.interactArmed = !r.interactArmed;
      r.reason = r.interactArmed
        ? 'Patch interaction allowed; contact stays derived from the fixture pose and motor readout.'
        : 'Patch interaction withdrawn; only bounded movement leaves the process.';
      return snapshot(id);
    }
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
      // Derived, never puppeted: the fixture must have slowed below its own bounded forward readout
      // and already be standing inside a negotiated patch object. No host or resident supplies a target.
      const contact = r.interactArmed && motor.forward <= SETTLE_FORWARD
        ? r.patchObjects.find(object => withinReach(observation.pose, object)) ?? null : null;
      const outward = contact ? { type: 'interact', objectId: contact.objectId, effect: 'settle', intervalMs: 5 }
        : { type: 'move', ...motor, intervalMs: 5 };
      const result = await transport.action(r.lease.sessionId, { ...scope(r), sequence, action: outward });
      if (contact) validateInteraction(r, result, sequence, contact); else validateAction(r, result, sequence, 'running');
      if (!current(r) || r.cancelRequested || r.lease.expiresAt <= now()) throw failure();
      r.handle.previewStep(token); r.handle.commitStep(token);
      r.sequence = sequence; r.frameId = observation.frameId;
      if (contact) r.lastInteraction = { individualId: id, visitEpoch: r.lease.epoch, frameId: observation.frameId,
        sequence, objectId: contact.objectId, effect: 'settle', pose: result.pose };
      r.lastTrace = { individualId: id, individualSessionId: r.runtimeSession, visitEpoch: r.lease.epoch,
        frameId: observation.frameId, inputSimTimeMs: before.simTimeMs, outputSimTimeMs: preview.simTimeMs,
        sensorySource: observation.sensorySource, motor, pose: result.pose,
        action: outward.type, objectId: contact ? contact.objectId : null };
      return structuredClone(r.lastTrace);
    } catch { localQuiet(r); r.cancelRequested = true; r.reason = 'Observation or movement was not confirmed; paused return required.'; }
    finally { r.pending = null; }
    return reconcile(r);
  }
  async function lifecycle(id) { const r = visits.get(id); if (!r?.owned) return snapshot(id); r.cancelRequested = true; return reconcile(r); }
  return { snapshot, capabilities, admit, control, tick, lifecycle,
    disconnectAll: () => Promise.allSettled([...visits.values()].filter(r => r.owned).map(r => lifecycle(r.id))) };
}
