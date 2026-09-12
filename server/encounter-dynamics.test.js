import test from 'node:test';
import assert from 'node:assert/strict';
import { createStimulusPolicy } from './stimulus-policy.js';
import { createEncounterDynamics, ENCOUNTER_CATALOG, GARDEN_ENCOUNTER_FLOWERS } from './encounter-dynamics.js';
function fixture(individualId = 'a', overrides = {}) {
  const policy = createStimulusPolicy({ individualId, sessionId: 's' });
  const offered = [], canceled = [];
  const dynamics = createEncounterDynamics({ individualId, sessionId: 's', flowers: [
    { id: 'left', x: 0, z: 0, radius: 0.3, effectId: 'floral' },
    { id: 'overlap', x: 0.1, z: 0, radius: 0.3, effectId: 'nectar' },
  ], policySnapshot: policy.snapshot,
  admit(request) { offered.push(request); return policy.admit('garden', policy.envelope('garden', request.effectId)); },
  cancel(request) { canceled.push(request); policy.cancelOptional(); }, ...overrides });
  let frameId = 0;
  const observe = (simTimeMs, x, status = 'running', epoch = 'e') => {
    policy.advance(simTimeMs);
    return dynamics.update({ individualId, sessionId: 's', environmentEpoch: epoch, frameId: frameId++, simTimeMs, pose: { x, z: 0 }, status });
  };
  return { policy, dynamics, offered, canceled, observe };
}
test('catalog separates fictional modulation and sensory proxies with actual procedural flower geometry', () => {
  assert.deepEqual(ENCOUNTER_CATALOG.map(e => e.category), ['fictional-modulation-input', 'engineered-scent-proxy']);
  assert.ok(ENCOUNTER_CATALOG.every(e => e.units && e.evidence && e.persistentPlasticity.includes('Unavailable')));
  const first = GARDEN_ENCOUNTER_FLOWERS.find(f => f.id === 'garden-flower-0');
  assert.equal(first.x, 2.4); assert.equal(first.z, 0);
  assert.ok(GARDEN_ENCOUNTER_FLOWERS.every(f => !(f.x > 1 && f.z < -0.6)));
  assert.throws(() => fixture('a', { flowers: [{ id: 'unknown', x: 0, z: 0, radius: 0.1, effectId: 'unsupported-drug' }] }), /Unsupported/);
});
test('disabled and arming inside contact never dose; actual later approach offers one overlapping pulse', () => {
  const f = fixture(); f.observe(0, 0); assert.equal(f.offered.length, 0);
  f.dynamics.setEnabled(true, 'e'); f.observe(5, 0); assert.equal(f.offered.length, 0);
  f.observe(10, 2); const active = f.observe(15, 0);
  assert.equal(f.offered.length, 1); assert.equal(active.phase, 'bounded-pulse');
  assert.equal(active.active.flowerId, 'left'); assert.equal(active.aggregate.reservedDurationMs, 500);
  for (let t = 20; t <= 10000; t += 5) f.observe(t, 0);
  assert.equal(f.offered.length, 1); assert.equal(f.dynamics.snapshot().phase, 'habituated-contact');
});
test('withdrawal washes out delivery without refund; repeated contacts still obey existing shared recovery', () => {
  const f = fixture(); f.dynamics.setEnabled(true, 'e'); f.observe(0, 2); f.observe(5, 0);
  const spent = f.policy.snapshot().reservedDose;
  f.observe(10, 2); assert.equal(f.canceled.length, 1); assert.equal(f.policy.currents().size, 0);
  assert.equal(f.policy.snapshot().reservedDose, spent);
  const rejected = f.observe(15, 0); assert.equal(rejected.active, null);
  assert.equal(rejected.events.at(-1).kind, 'rejected'); assert.match(rejected.events.at(-1).reason, /recovery/);
  f.observe(20, 2); f.observe(3005, 0);
  assert.equal(f.policy.snapshot().reservedDurationMs, 1000);
  f.observe(3010, 2); const capped = f.observe(6005, 0);
  assert.equal(capped.events.at(-1).kind, 'rejected'); assert.match(capped.events.at(-1).reason, /budget/);
});
test('rest and epoch change cancel current recipients and require deliberate reenablement', () => {
  const f = fixture(); f.dynamics.setEnabled(true, 'e'); f.observe(0, 2); f.observe(5, 0);
  const spent = f.policy.snapshot().reservedDose;
  assert.equal(f.observe(10, 0, 'resting').phase, 'resting'); assert.equal(f.policy.currents().size, 0);
  f.observe(15, 0); assert.equal(f.offered.length, 1);
  assert.equal(f.observe(20, 0, 'running', 'new').enabled, false);
  assert.equal(f.policy.snapshot().reservedDose, spent);
  f.observe(25, 2, 'running', 'new'); assert.equal(f.offered.length, 1);
});
test('per-recipient contacts and failed durable admissions cannot cross or escalate', () => {
  const a = fixture('a'), b = fixture('b');
  for (const f of [a, b]) { f.dynamics.setEnabled(true, 'e'); f.observe(0, 2); }
  a.observe(5, 0); assert.equal(b.policy.snapshot().reservedDose, 0); assert.deepEqual(b.dynamics.snapshot().contactIds, []);
  assert.throws(() => a.dynamics.update({ individualId: 'b', sessionId: 's' }), /recipient/);
  const failed = fixture('c', { admit() { throw new Error('durable write failed'); } });
  failed.dynamics.setEnabled(true, 'e'); failed.observe(0, 2); failed.observe(5, 0);
  assert.equal(failed.policy.currents().size, 0); assert.equal(failed.policy.snapshot().reservedDose, 0);
  for (let t = 10; t < 100; t += 5) failed.observe(t, 0);
  assert.equal(failed.dynamics.snapshot().events.filter(e => e.kind === 'rejected').length, 1);
});
test('clock/sequence validation happens before contact or policy mutation', () => {
  const f = fixture(); f.dynamics.setEnabled(true, 'e'); f.observe(0, 2);
  const before = f.dynamics.snapshot();
  assert.throws(() => f.dynamics.update({ individualId: 'a', sessionId: 's', environmentEpoch: 'e',
    frameId: 0, simTimeMs: 0, pose: { x: 0, z: 0 }, status: 'running' }), /Stale/);
  assert.deepEqual(f.dynamics.snapshot(), before);
});
