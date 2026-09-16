import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
import { createCreativeSessions } from './creative-session.js';
import { createManagedVisitorTransport } from './managed-visitor-transport.js';
import { randomUUID } from 'node:crypto';
function transport() {
  const sessions = new Map(), ids = new Set(); let discoveries = 0, observations = 0;
  return { enabled: true, appId: 'garden', counts: () => ({ discoveries, observations }),
    capabilities: async () => { discoveries++; return { version: 1, appId: 'garden', available: true,
      individualIds: [...ids], worldIds: ['garden-world'], contract: { version: 1, expiryEnforced: true, admissionDeadline: true,
        bodies: ['fly-v1'], actions: ['start', 'pause', 'rest', 'move', 'leave', 'interact'], maxConcurrentVisitors: 2,
        patchObjects: [{ objectId: 'gentle-patch-a', x: 0, z: 0, radius: 0.3 }], interactionEffects: ['settle'],
        controllerRaster: { width: 8, height: 4, channels: 3 } } }; },
    admit: async input => { const lease = { version: 1, sessionId: `visit-${input.individualId}`, appId: 'garden',
      individualId: input.individualId, individualSessionId: input.individualSessionId, worldId: input.worldId, epoch: 'epoch',
      expiresAt: Date.now() + input.ttlMs, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      sessions.set(lease.sessionId, { ...lease, frame: -1 }); return lease; },
    action: async (id, input) => ({ version: 1, sessionId: id, appId: 'garden', individualId: input.individualId,
      individualSessionId: input.individualSessionId, worldId: input.worldId, epoch: input.epoch, sequence: input.sequence,
      expiresAt: sessions.get(id).expiresAt, pose: sessions.get(id).pose, status: { start: 'running', move: 'running', pause: 'paused', rest: 'resting' }[input.action.type] }),
    observe: async (id, input) => { observations++; return { version: 1, sessionId: id, appId: 'garden', ...input,
      frameId: ++sessions.get(id).frame, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4,
      rgb: Array(96).fill(90), pose: sessions.get(id).pose, sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' }; },
    leave: async (id, input) => { sessions.delete(id); return { version: 1, sessionId: id, appId: 'garden', ...input, status: 'left' }; },
    cancel: async input => ({ version: 1, appId: 'garden', ...input, confirmed: true, pending: false, expiresAt: null }),
    allow: id => ids.add(id), sessions,
  };
}
async function setup(t, { autoTick = false, enabled = true, ...serverOptions } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'visitor-http-')), store = openIdentityStore(directory), wire = transport();
  wire.enabled = enabled; wire.allow(store.primaryId);
  const server = createServer({ identities: store, autoTick, visitorTransport: wire, ...serverOptions }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  t.after(async () => { server.close(); await once(server, 'close'); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const state = async () => (await fetch(`${base}/api/individuals/${id}`)).json();
  const command = async (operation, payload = {}, options = {}) => { const current = await state(); return fetch(`${base}/api/individuals/${id}/visitor`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...options.headers }, body: JSON.stringify({ protocolVersion: 1,
      individualId: id, sessionId: current.sessionId, sequence: current.commandSequence + 1, operation, payload, ...options.body }) }); };
  return { base, id, store, wire, command, state };
}
test('visitor HTTP is local-only by default, requires exact same-origin envelopes, and admits paused', async t => {
  const s = await setup(t); const path = `${s.base}/api/individuals/${s.id}/visitor`;
  const health = async () => (await (await fetch(`${s.base}/api/health`)).json()).eidoverse;
  assert.equal((await health()).configured, true); assert.equal((await health()).available, false);
  assert.equal(s.wire.counts().discoveries, 0);
  assert.equal((await (await fetch(path)).json()).visitor.phase, 'home'); assert.equal(s.wire.counts().discoveries, 0);
  const capability = await (await fetch(`${path}?capabilities=1`)).json(); assert.equal(capability.capabilities.available, true); assert.equal(s.wire.counts().discoveries, 1);
  assert.equal((await fetch(`${path}?capabilities=0`)).status, 400);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { headers: { origin: 'https://other.test' } })).status, 403);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { body: { privateHistory: [] } })).status, 409);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { body: { sessionId: 'stale' } })).status, 409);
  assert.equal(s.store.snapshot().externalOwner, null);
  const admitted = await (await s.command('admit', { worldId: 'garden-world' })).json();
  assert.equal(admitted.state.status, 'paused'); assert.equal(admitted.visitor.phase, 'visiting'); assert.equal(admitted.state.externalOwner.kind, 'managed-visitor');
  assert.equal((await health()).available, true);
  assert.deepEqual((await health()).individuals, [{ individualId: s.id, phase: 'visiting', owned: true, running: false, worldId: 'garden-world' }]);
  assert.equal((await health()).capacity, 2);
  assert.equal(admitted.state.environmentAdapter.attached, false); assert.equal(s.wire.counts().observations, 0);
  const current = await s.state(); const forbidden = await fetch(`${s.base}/api/individuals/${s.id}/control`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, individualId: s.id, sessionId: current.sessionId, sequence: current.commandSequence + 1, action: 'start' }) });
  assert.equal(forbidden.status, 409); assert.equal(s.store.snapshot().status, 'paused');
  assert.equal((await (await s.command('start')).json()).state.status, 'running');
  assert.equal((await (await s.command('rest')).json()).state.status, 'resting');
  const home = await (await s.command('home')).json(); assert.equal(home.state.externalOwner, null); assert.equal(home.visitor.phase, 'home'); assert.equal(home.state.status, 'paused');
  assert.equal((await health()).available, false);
});
test('disabled transport cannot acquire local ownership or query broker', async t => {
  const s = await setup(t, { enabled: false }); assert.equal((await s.command('admit', { worldId: 'garden-world' })).status, 409);
  assert.equal(s.store.snapshot().externalOwner, null); assert.equal(s.wire.counts().discoveries, 0);
});
test('server scheduler advances only an explicitly started visit and never advances it twice locally', async t => {
  const s = await setup(t, { autoTick: true }); await s.command('admit', { worldId: 'garden-world' });
  await new Promise(resolve => setTimeout(resolve, 110)); assert.equal(s.store.snapshot().tick, 0);
  await s.command('start');
  const end = Date.now() + 2000;
  while (s.wire.counts().observations < 3 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  await s.command('pause'); const tick = s.store.snapshot().tick;
  assert(tick >= 3); assert.equal(tick, s.wire.counts().observations);
  await new Promise(resolve => setTimeout(resolve, 110)); assert.equal(s.store.snapshot().tick, tick);
  await s.command('home');
});

test('admission disarms language and ends home neural and movement captures at the ownership boundary', async t => {
  const creativeSessions = createCreativeSessions(), invalidated = [], appended = [];
  const languageService = { snapshot: () => ({ available: false }), lifecycle: id => invalidated.push(id), tick: async () => {}, close() {} };
  const recordings = { start: () => ({ id: randomUUID() }), append: async (id, value) => { appended.push(value); return { session: { status: 'stopped' } }; }, close() {} };
  const s = await setup(t, { autoTick: true, creativeSessions, languageService, recordings });
  s.store.environmentControl(s.id, 'attach'); s.store.control(s.id, 'start'); creativeSessions.start(s.store.snapshot(s.id));
  const state = await s.state();
  assert.equal((await fetch(`${s.base}/api/recordings`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, individualId: s.id, sessionId: state.sessionId, sequence: state.commandSequence + 1 }) })).status, 200);
  await s.command('admit', { worldId: 'garden-world' });
  assert.deepEqual(invalidated, [s.id]); assert.equal(creativeSessions.status(s.id).partial, true); assert.equal(creativeSessions.status(s.id).active, false);
  const end = Date.now() + 2000;
  while (!appended.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(appended, [{ sessionId: null }]);
  await s.command('home');
});

test('a paired two-fly visit preserves chemical and stimulus-policy state and checkpoint lineage', async t => {
  const s = await setup(t, { autoTick: true });
  const second = s.store.create().individualId; s.wire.allow(second); s.store.load(second);
  const ids = [s.id, second];
  const read = async id => (await fetch(`${s.base}/api/individuals/${id}`)).json();
  const envelope = async (id, path, body) => { const current = await read(id);
    return fetch(`${s.base}/api/individuals/${id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, individualId: id, sessionId: current.sessionId, sequence: current.commandSequence + 1, ...body }) }); };
  const post = (id, path, body) => envelope(id, path, body);
  const visitor = (id, operation, payload = {}) => envelope(id, 'visitor', { operation, payload });
  // Spend a real bounded stimulus reservation on each fly so the comparison is not vacuous.
  for (const id of ids) {
    const started = await post(id, 'control', { action: 'start' });
    assert.equal(started.status, 200, JSON.stringify(await started.json()));
    const encounter = await post(id, 'encounters', { compoundId: 'nectar' });
    assert.equal(encounter.status, 200, JSON.stringify(await encounter.json()));
    assert.equal((await post(id, 'control', { action: 'pause' })).status, 200);
    assert.equal((await post(id, 'checkpoints', {})).status, 200);
  }
  const before = Object.fromEntries(ids.map(id => { const state = s.store.snapshot(id);
    return [id, { stimulusPolicy: state.stimulusPolicy, chemistry: state.chemistry, sessionId: state.sessionId,
      persistence: state.persistence, tick: state.tick }]; }));
  for (const id of ids) assert(before[id].stimulusPolicy.entries.some(entry => entry.effect === 'nectar'), id);

  for (const id of ids) assert.equal((await visitor(id, 'admit', { worldId: 'garden-world' })).status, 200);
  assert.deepEqual((await (await fetch(`${s.base}/api/health`)).json()).eidoverse.individuals.map(entry => entry.phase), ['visiting', 'visiting']);
  for (const id of ids) assert.equal((await visitor(id, 'start')).status, 200);
  const end = Date.now() + 3000;
  while (s.wire.counts().observations < 6 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  for (const id of ids) assert.equal((await visitor(id, 'home')).status, 200);

  for (const id of ids) {
    const after = s.store.snapshot(id), expected = before[id];
    // Identity and runtime session are the same individual, not a restored or replaced one.
    assert.equal(after.sessionId, expected.sessionId, id);
    assert.equal(after.externalOwner, null, id);
    assert.equal(after.status, 'paused', id);
    assert(after.tick > expected.tick, `${id} advanced no fixture steps during its visit`);
    // The spent stimulus reservation ledger survives the visit: nothing was cleared, refunded or re-dosed.
    // Active delivery is truncated at the ownership boundary by design, so activeUntilMs may only shrink.
    const ledger = entries => entries.map(({ activeUntilMs, ...rest }) => rest);
    assert.deepEqual(ledger(after.stimulusPolicy.entries), ledger(expected.stimulusPolicy.entries), id);
    for (const entry of after.stimulusPolicy.entries) {
      const previous = expected.stimulusPolicy.entries.find(value => value.id === entry.id);
      assert(entry.activeUntilMs <= previous.activeUntilMs, `${id} optional input was extended across the visit`);
    }
    assert.equal(after.stimulusPolicy.individualId, expected.stimulusPolicy.individualId, id);
    assert.equal(after.stimulusPolicy.reservedDose, expected.stimulusPolicy.reservedDose, id);
    assert.equal(after.stimulusPolicy.reservedDurationMs, expected.stimulusPolicy.reservedDurationMs, id);
    assert.deepEqual(after.stimulusPolicy.limits, expected.stimulusPolicy.limits, id);
    // Chemical recovery keeps counting down across the visit rather than resetting to a fresh window.
    assert.deepEqual(after.chemistry.map(entry => entry.id), expected.chemistry.map(entry => entry.id), id);
    for (const entry of after.chemistry) {
      const previous = expected.chemistry.find(value => value.id === entry.id);
      assert.deepEqual([entry.label, entry.description], [previous.label, previous.description], id);
      assert(entry.cooldownRemainingMs <= previous.cooldownRemainingMs, `${id} ${entry.id} cooldown reset`);
      assert(entry.remainingMs <= previous.remainingMs, `${id} ${entry.id} effect re-armed`);
    }
    assert(after.stimulusPolicy.simTimeMs > expected.stimulusPolicy.simTimeMs, id);
    // Checkpoint lineage is intact and no restore happened during the visit.
    assert.equal(after.persistence.checkpointId, expected.persistence.checkpointId, id);
    assert.equal(after.persistence.checkpointCount, expected.persistence.checkpointCount, id);
    assert.deepEqual(after.persistence.branchOf, expected.persistence.branchOf, id);
  }
  // Honest scope. RNG state, plasticity, refractory state, delay buffers and embodiment are
  // UNSUPPORTED in server/runtime.js. This round trip does not preserve them, because they do not
  // exist: the checkpoint records them as null rather than as carried-over state. Do not read the
  // continuity assertions above as evidence of retained learning or reproducible stochastic dynamics.
  const checkpoints = await (await fetch(`${s.base}/api/individuals/${s.id}/checkpoints`)).json();
  for (const checkpoint of checkpoints.checkpoints) {
    if (!checkpoint.payload) continue;
    assert.deepEqual(checkpoint.payload.unsupported,
      { rng: null, plasticity: null, refractory: null, delayBuffers: null, embodiment: null });
  }
  assert.match(s.store.snapshot(s.id).model.limitations, /No biological anatomy, RNG dynamics, plasticity/);
});

test('an unconfigured bridge reports the specific unmet setting through health and individual state', async t => {
  // A real transport with only the separately provisioned PortOS credential missing (NFR-5).
  const visitorTransport = createManagedVisitorTransport({ baseUrl: 'http://127.0.0.1:5555', appId: 'garden',
    fetchImpl: () => assert.fail('an unconfigured bridge must never reach the network') });
  const s = await setup(t, { visitorTransport });
  const { eidoverse } = await (await fetch(`${s.base}/api/health`)).json();
  assert.equal(eidoverse.available, false); assert.equal(eidoverse.configured, false);
  assert.equal(eidoverse.configurationCode, 'credential-unset');
  assert.deepEqual(eidoverse.unresolvedSettings, ['FLY_GARDEN_VISITOR_CREDENTIAL']);
  assert.match(eidoverse.reason, /optional password unset/);
  const { visitor } = await (await fetch(`${s.base}/api/individuals/${s.id}/visitor?capabilities=1`)).json();
  assert.equal(visitor.available, false); assert.equal(visitor.configurationCode, 'credential-unset');
  assert.equal(visitor.reason, eidoverse.reason);
  assert.equal((await s.command('admit', { worldId: 'garden-world' })).status, 409);
  assert.equal(s.store.snapshot().externalOwner, null);
  // The unmet-setting explanation never carries a value the owner configured.
  const published = JSON.stringify({ eidoverse, visitor });
  assert(!published.includes('127.0.0.1:5555') && !published.includes('mv1_a'));
});
