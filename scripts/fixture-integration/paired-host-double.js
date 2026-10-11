// Original, deliberately synthetic multi-visitor host. No broker credentials or sibling services are read.
// A fixture for the Fly Garden HTTP/bridge integration with TWO independently admitted individuals,
// never Eidoverse evidence. It models only what the bridge validates: per-individual leases and epochs,
// negotiated capacity (a number, or omitted as an older single-visitor host would), and injectable faults.
const APP_ID = 'integration-fixture';

/**
 * @param {string[]} individualIds individuals the owner approved for this host (more may be allowed later)
 * @param {{capacity?: number|null, observationLimit?: number}} options `capacity: null` omits
 *   `maxConcurrentVisitors`, which the bridge must read as exactly one visitor. `observationLimit`
 *   is a hard per-lease bound independent of polling speed.
 */
export function createPairedHostDouble(individualIds, { capacity = 2, observationLimit = 400 } = {}) {
  const approved = new Set(individualIds);
  const leases = new Map(), faults = new Map(), steps = new Map(), epochs = new Map();
  let hostMode = 'supported', serial = 0, calls = 0, admits = 0, leaves = 0, scopeViolations = 0;

  const unreachable = () => hostMode === 'unreachable';
  /** Every request names the individual, runtime session, world and epoch it was issued for.
   * A request that does not match its lease is counted and refused: it must never occur. */
  function leaseFor(id, input) {
    const record = leases.get(id);
    if (!record) throw new Error('Synthetic host has no such visit.');
    const { lease } = record;
    if (input.individualId !== lease.individualId || input.individualSessionId !== lease.individualSessionId
      || input.worldId !== lease.worldId || input.epoch !== lease.epoch) {
      scopeViolations++; throw new Error('Synthetic host refused a request outside its lease scope.');
    }
    return record;
  }
  const transport = {
    enabled: true, appId: APP_ID,
    async capabilities() {
      calls++;
      if (unreachable()) throw new Error('Synthetic host unreachable.');
      return { version: 1, appId: APP_ID, available: true,
        individualIds: hostMode === 'denied' ? [] : [...approved], worldIds: ['fixture-world'],
        contract: { version: 1, expiryEnforced: true, admissionDeadline: true, bodies: ['fly-v1'],
          actions: ['start', 'pause', 'rest', 'move', 'leave', 'interact'],
          ...(capacity === null ? {} : { maxConcurrentVisitors: capacity }),
          controllerRaster: { width: 8, height: 4, channels: 3 },
          patchObjects: [{ objectId: 'fixture-flower', x: 0, z: 0, radius: 0.3 }], interactionEffects: ['settle'] } };
    },
    async admit(input) {
      calls++; admits++;
      if (unreachable()) throw new Error('Synthetic host unreachable.');
      // A real host owns its own capacity; the bridge normally refuses first, so reaching this is a defect.
      if (leases.size >= (capacity ?? 1)) throw new Error('Synthetic host is at its negotiated capacity.');
      const lease = { version: 1, appId: APP_ID, sessionId: `fixture-visit-${++serial}`,
        individualId: input.individualId, individualSessionId: input.individualSessionId,
        worldId: input.worldId, epoch: `fixture-epoch-${serial}`, expiresAt: Date.now() + input.ttlMs,
        status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      leases.set(lease.sessionId, { lease, frame: -1 });
      epochs.set(input.individualId, [...(epochs.get(input.individualId) ?? []), lease.epoch]);
      return lease;
    },
    async action(id, input) {
      calls++;
      if (unreachable()) throw new Error('Synthetic host unreachable.');
      const { lease } = leaseFor(id, input);
      if (faults.get(lease.individualId) === 'revoked') throw new Error('Synthetic grant revoked.');
      if (['move', 'interact'].includes(input.action.type)) steps.set(lease.individualId, (steps.get(lease.individualId) ?? 0) + 1);
      return { version: 1, appId: APP_ID, sessionId: id,
        individualId: input.individualId, individualSessionId: input.individualSessionId,
        worldId: input.worldId, epoch: input.epoch, sequence: input.sequence, expiresAt: lease.expiresAt,
        pose: lease.pose, status: { start: 'running', pause: 'paused', rest: 'resting', move: 'running', interact: 'running' }[input.action.type],
        ...(input.action.type === 'interact' ? { interaction: { objectId: input.action.objectId, effect: input.action.effect, accepted: true } } : {}) };
    },
    async observe(id, input) {
      calls++;
      if (unreachable() || hostMode === 'disconnect') throw new Error('Synthetic observation unavailable.');
      const record = leaseFor(id, input), fault = faults.get(record.lease.individualId);
      if (fault === 'revoked') throw new Error('Synthetic grant revoked.');
      if (record.frame >= observationLimit) throw new Error('Synthetic observation bound reached.');
      // A misrouted reply that carries the partner's scope, as a confused or hostile host might send.
      const peer = fault === 'peer-scope'
        ? [...leases.values()].find(other => other.lease.individualId !== record.lease.individualId)?.lease : null;
      return { version: 1, appId: APP_ID, sessionId: id, ...input,
        ...(peer ? { individualId: peer.individualId, individualSessionId: peer.individualSessionId } : {}),
        epoch: fault === 'stale-epoch' ? 'fixture-expired-epoch' : input.epoch,
        frameId: ++record.frame, capturedAtMs: Date.now(),
        camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(0), pose: record.lease.pose,
        sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' };
    },
    async leave(id, input) {
      calls++;
      if (unreachable()) throw new Error('Synthetic host unreachable.');
      leaseFor(id, input); leases.delete(id); leaves++;
      return { version: 1, appId: APP_ID, sessionId: id, ...input, status: 'left' };
    },
    async cancel(input) {
      calls++;
      if (unreachable()) throw new Error('Synthetic host unreachable.');
      return { version: 1, appId: APP_ID, ...input, confirmed: true, pending: false, expiresAt: null };
    },
  };
  const leased = () => [...leases.values()].map(record => record.lease.individualId).sort();
  return { transport,
    allow(individualId) { approved.add(individualId); },
    /** Host-wide: 'supported' | 'disconnect' (observations fail, cleanup still confirms) | 'unreachable' (everything fails). */
    setHostMode(value) { hostMode = value; },
    /** Per individual: 'revoked' | 'peer-scope' | 'stale-epoch'. Another individual's lease is never touched. */
    setFault(individualId, fault) { faults.set(individualId, fault); },
    clearFault(individualId) { faults.delete(individualId); },
    epochsFor: individualId => [...(epochs.get(individualId) ?? [])],
    counts: () => ({ calls, admits, leaves, scopeViolations, leases: leases.size, leased: leased(),
      steps: Object.fromEntries([...steps].sort(([a], [b]) => (a < b ? -1 : 1))) }),
    stepsFor: individualId => steps.get(individualId) ?? 0 };
}
