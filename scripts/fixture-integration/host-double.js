// Original, deliberately synthetic host. No broker credentials or sibling services are read.
// This is a fixture for the Fly Garden HTTP/bridge integration, never Eidoverse evidence.
export function createHostDouble(individualId) {
  let mode = 'supported', serial = 0, calls = 0, steps = 0;
  const leases = new Map();
  const transport = {
    enabled: true, appId: 'integration-fixture',
    async capabilities() {
      calls++;
      return { version: 1, appId: transport.appId, available: true,
        individualIds: mode === 'denied' ? [] : [individualId], worldIds: ['fixture-world'],
        contract: { version: mode === 'old-version' ? 0 : 1, expiryEnforced: true, admissionDeadline: true,
          bodies: ['fly-v1'], actions: ['start', 'pause', 'rest', 'move', 'leave', 'interact'],
          maxConcurrentVisitors: 1, controllerRaster: { width: 8, height: 4, channels: 3 },
          patchObjects: [{ objectId: 'fixture-flower', x: 0, z: 0, radius: 0.3 }], interactionEffects: ['settle'] } };
    },
    async admit(input) {
      calls++;
      const lease = { version: 1, appId: transport.appId, sessionId: `fixture-visit-${++serial}`,
        individualId: input.individualId, individualSessionId: input.individualSessionId,
        worldId: input.worldId, epoch: `fixture-epoch-${serial}`, expiresAt: Date.now() + input.ttlMs,
        status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      leases.set(lease.sessionId, { lease, frame: -1 });
      return lease;
    },
    async action(id, input) {
      calls++;
      if (['move', 'interact'].includes(input.action.type)) steps++;
      const { lease } = leases.get(id);
      return { version: 1, appId: transport.appId, sessionId: id,
        individualId: input.individualId, individualSessionId: input.individualSessionId,
        worldId: input.worldId, epoch: input.epoch, sequence: input.sequence, expiresAt: lease.expiresAt,
        pose: lease.pose, status: { start: 'running', pause: 'paused', rest: 'resting', move: 'running', interact: 'running' }[input.action.type],
        ...(input.action.type === 'interact' ? { interaction: { objectId: input.action.objectId, effect: input.action.effect, accepted: true } } : {}) };
    },
    async observe(id, input) {
      calls++;
      const record = leases.get(id);
      // Hard limit independent of polling speed: at most three neural steps per visit.
      if (record.frame >= 2 || mode === 'disconnect') throw new Error('Synthetic observation unavailable.');
      return { version: 1, appId: transport.appId, sessionId: id, ...input,
        epoch: mode === 'prior-epoch' ? 'fixture-expired-epoch' : input.epoch,
        frameId: ++record.frame, capturedAtMs: Date.now() - (mode === 'stale-frame' ? 1000 : 0),
        camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(0), pose: record.lease.pose,
        sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' };
    },
    async leave(id, input) {
      calls++; leases.delete(id);
      return { version: 1, appId: transport.appId, sessionId: id, ...input, status: 'left' };
    },
    async cancel(input) {
      calls++;
      return { version: 1, appId: transport.appId, ...input, confirmed: true, pending: false, expiresAt: null };
    },
  };
  return { transport, setMode(value) { mode = value; }, counts: () => ({ calls, steps, leases: leases.size }) };
}
