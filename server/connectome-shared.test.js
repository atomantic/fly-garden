import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createConnectomeRegistry } from './connectome-registry.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createSparseLif } from './sparse-lif.js';
import { createCapacityPolicy } from './population-capacity.js';
import { createConnectomeSharedSession } from './connectome-shared-session.js';
import { createServer } from './index.js';
import { openIdentityStore } from './identity-store.js';
import { openConnectomeStore } from './connectome-store.js';

const datasets = ['male-cns:v1.0', 'banc:v888'];
const graph = dataset => ({ ids: [`${dataset}/1`, `${dataset}/2`], offsets: new Uint32Array([0, 1, 2]), targets: new Uint32Array([1, 0]), contacts: new Uint32Array([2, 2]), signs: new Int8Array([1, 1]) });
const settings = { maxResidentFlies: 2, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 };
const identities = [{ individualId: 'shared-a', dataset: datasets[0], directory: '/trusted/shared-a' }, { individualId: 'shared-b', dataset: datasets[1], directory: '/trusted/shared-b' }];

function backendFor(options, failure) {
  const session = createConnectomeSession({ ...options, graph: graph(options.dataset), provenance: { manifestSha256: 'ab'.repeat(32) } });
  let epoch = session.snapshot().sessionEpoch;
  let closed = false;
  const dispatch = async (action, value) => {
    if (closed) throw new Error('closed');
    const result = session.dispatch({ action, value, sessionEpoch: epoch });
    if (result?.sessionEpoch) epoch = result.sessionEpoch;
    return result;
  };
  return { ready: session.snapshot(), close: async () => { closed = true; }, snapshot: () => dispatch('snapshot'),
    start: () => dispatch('start'), pause: () => dispatch('pause'), advance: value => dispatch('advance', value),
    prepareAdvance: async value => { if (options.individualId === 'shared-a') await new Promise(resolve => setTimeout(resolve, 2)); return dispatch('prepareAdvance', value); },
    commitAdvance: async value => { if (failure && options.individualId === 'shared-b') throw new Error('commit failed'); return dispatch('commitAdvance', value); },
    rollbackAdvance: value => dispatch('rollbackAdvance', value), releaseAdvance: value => dispatch('releaseAdvance', value),
    checkpoint: () => dispatch('checkpoint'), restore: value => dispatch('restore', value),
    prepareRestore: value => dispatch('prepareRestore', value), commitRestore: value => dispatch('commitRestore', value) };
}

function registrySetup(failure = false) {
  const opened = [];
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    openBackend: async (_directory, options) => { const backend = backendFor(options, failure); opened.push(backend); return backend; } });
  return { registry, opened };
}

test('a zero-drive candidate is isolated until commit and becomes stale after another mutation', () => {
  const kernel = createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'candidate' });
  const token = kernel.prepareAdvance(5);
  assert.equal(kernel.summary().tick, 0);
  kernel.step();
  assert.throws(() => kernel.commitAdvance(token), /Stale/);
  const next = kernel.prepareAdvance(2);
  kernel.commitAdvance(next);
  assert.equal(kernel.summary().tick, 3);
  kernel.rollbackAdvance(next);
  assert.equal(kernel.summary().tick, 1);
});

test('registry barrier waits for all workers, preserves order-independent clocks and rolls back a failed commit', async t => {
  const f = registrySetup(), t2 = registrySetup(true);
  t.after(() => f.registry.close()); t.after(() => t2.registry.close());
  await Promise.all([f.registry.load('shared-a'), f.registry.load('shared-b')]);
  await Promise.all([f.registry.sharedControl('shared-a', 'start'), f.registry.sharedControl('shared-b', 'start')]);
  const result = await f.registry.barrier(['shared-b', 'shared-a'], 5, { 'shared-a': f.registry.snapshot('shared-a').sessionEpoch, 'shared-b': f.registry.snapshot('shared-b').sessionEpoch });
  assert.deepEqual(result.map(value => value.neural.tick), [5, 5]);
  assert.deepEqual(f.registry.list().map(value => value.neural.tick), [5, 5]);
  await f.registry.sharedControl('shared-a', 'rest'); await f.registry.sharedControl('shared-a', 'resume');
  assert.equal(f.registry.snapshot('shared-a').status, 'running');
  await Promise.all([t2.registry.load('shared-a'), t2.registry.load('shared-b')]);
  await Promise.all([t2.registry.sharedControl('shared-a', 'start'), t2.registry.sharedControl('shared-b', 'start')]);
  await assert.rejects(t2.registry.barrier(['shared-a', 'shared-b'], 5), /no participant advanced/);
  assert.deepEqual(t2.registry.list().map(value => value.neural.tick), [0, 0]);
  assert.deepEqual(t2.registry.list().map(value => value.status), ['paused', 'paused']);
});

test('registry cancels a shared restore preparation when a worker rejects its candidate', async t => {
  let cancelled = null;
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ payload: { members: [{ individualId: 'shared-a' }, { individualId: 'shared-b' }] } }),
    prepareJointRestore: () => ({ token: 'prepared-token', members: [
      { individualId: 'shared-a', parentId: null, checkpoint: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'shared-a' }).checkpoint() },
      { individualId: 'shared-b', parentId: null, checkpoint: createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: 'shared-b' }).checkpoint() }
    ] }),
    commitJointRestore: () => { throw new Error('not used'); }, cancelJointRestore: token => { cancelled = token; },
    openBackend: async (_directory, options) => { const backend = backendFor(options); if (options.individualId === 'shared-b') return { ...backend, prepareRestore: async () => { throw new Error('candidate rejected'); } }; return backend; } });
  t.after(() => registry.close());
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  await assert.rejects(registry.prepareSharedRestore('joint'), /candidate rejected/);
  assert.equal(cancelled, 'prepared-token');
});

test('shared session exposes fixed five-substep barriers, rest and withdrawal without private input', async () => {
  const states = new Map();
  for (const [index, id] of ['one', 'two'].entries()) states.set(id, { source: 'connectome', individualId: id, dataset: datasets[index], sessionEpoch: `epoch-${id}`, commandSequence: 0,
    resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: `${index}`.repeat(64), model: { id: datasets[index] },
    capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } });
  const control = async (id, action) => { const state = states.get(id); state.status = action === 'start' ? 'running' : 'paused'; if (action === 'rest') state.status = 'resting'; return structuredClone(state); };
  let barrierGate = null;
  const barrier = async ids => { if (barrierGate) await barrierGate.promise; return ids.map(id => { const state = states.get(id); state.neural.tick += 5; state.neural.simTimeMs += 5; return structuredClone(state); }); };
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control, barrier, available: () => true });
  const joined = await service.join({ protocolVersion: 1, members: ['one', 'two'].map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: states.get(id).sessionEpoch, commandSequence: 0 })) });
  assert.equal(joined.shared.participants.length, 2); assert.equal(joined.shared.status, 'paused');
  await service.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'start' });
  const barrierResult = await service.advance(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: 2, action: 'barrier' });
  assert.equal(barrierResult.shared.tick, 1); assert.equal(barrierResult.traces[0].substeps, 5);
  const rest = await service.member(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: barrierResult.shared.worldEpoch, sequence: 3, individualId: 'one', action: 'rest' });
  assert.equal(rest.shared.participants.find(value => value.individualId === 'one').mode, 'resting');
  await service.advance(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: 4, action: 'barrier' });
  assert.equal(states.get('one').neural.tick, 5); assert.equal(states.get('two').neural.tick, 10);
  await service.pauseForPressure(); const pressure = service.snapshot(joined.shared.sharedId).shared; assert.equal(pressure.status, 'paused');
  await service.pauseForPressure(); assert.equal(service.snapshot(joined.shared.sharedId).shared.commandSequence, pressure.commandSequence);
  await assert.rejects(service.member(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: pressure.commandSequence + 1, individualId: 'one', action: 'withdraw' }), /below two/);
  const restarted = await service.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: pressure.commandSequence + 1, action: 'start' });
  let releaseBarrier;
  const startedBarrier = new Promise(resolve => { releaseBarrier = resolve; });
  barrierGate = { promise: startedBarrier };
  const inFlight = service.advance(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: restarted.shared.worldEpoch, sequence: restarted.shared.commandSequence + 1, action: 'barrier' });
  await new Promise(resolve => setImmediate(resolve));
  await service.pauseForPressure(); assert.equal(service.snapshot(joined.shared.sharedId).shared.status, 'running');
  releaseBarrier(); await inFlight; assert.equal(service.snapshot(joined.shared.sharedId).shared.status, 'paused');
  barrierGate = null;
  await service.close(); assert.equal(service.view().sessions.length, 0);
});

test('shared restore rejects a command sequence change during worker preparation', async t => {
  let cancelled = null, registry;
  const restoreMembers = [
    { individualId: 'shared-a', parentId: null, checkpoint: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'shared-a' }).checkpoint() },
    { individualId: 'shared-b', parentId: null, checkpoint: createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: 'shared-b' }).checkpoint() }
  ];
  registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ payload: { members: restoreMembers } }),
    prepareJointRestore: () => ({ token: 'sequence-token', members: restoreMembers }),
    commitJointRestore: () => { throw new Error('not used'); }, cancelJointRestore: token => { cancelled = token; },
    openBackend: async (_directory, options) => { const backend = backendFor(options); if (options.individualId !== 'shared-a') return backend; return { ...backend, prepareRestore: async value => { registry.invalidateCommands(['shared-a']); return backend.prepareRestore(value); } }; } });
  t.after(() => registry.close());
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  await assert.rejects(registry.prepareSharedRestore('joint', { 'shared-a': 0, 'shared-b': 0 }), /changed during preparation/);
  assert.equal(cancelled, 'sequence-token');
});

test('restore reserves membership before an awaited preparation blocks a concurrent join', async () => {
  const states = new Map();
  for (const [index, id] of ['one', 'two'].entries()) states.set(id, { source: 'connectome', individualId: id, dataset: datasets[index], sessionEpoch: `epoch-${id}`, commandSequence: 0,
    resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: `${index}`.repeat(64), model: { id: datasets[index] },
    capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control: async () => {}, barrier: async () => [],
    readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { tick: 0, members: [{ individualId: 'one', mode: 'active' }, { individualId: 'two', mode: 'active' }] } }),
    prepareRestore: async () => { await gate; return { members: [] }; }, commitRestore: async () => {} });
  const members = ['one', 'two'].map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: states.get(id).sessionEpoch, commandSequence: 0 }));
  const restoring = service.restore({ protocolVersion: 1, jointCheckpointId: 'joint', members });
  await Promise.resolve();
  await assert.rejects(service.join({ protocolVersion: 1, members }), /Stale or unavailable/);
  release();
  assert.equal((await restoring).shared.status, 'paused');
  await service.close();
});

test('join refreshes participant epochs after queued lifecycle work before claiming ownership', async () => {
  const states = new Map();
  for (const [index, id] of ['one', 'two'].entries()) states.set(id, { source: 'connectome', individualId: id, dataset: datasets[index], sessionEpoch: `old-${id}`, commandSequence: 0,
    resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: `${index}`.repeat(64), model: { id: datasets[index] },
    capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } });
  const control = async (id, action) => { const state = states.get(id); if (action === 'pause') state.sessionEpoch = `new-${id}`; state.status = action === 'start' ? 'running' : 'paused'; return structuredClone(state); };
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control, barrier: async ids => ids.map(id => { const state = states.get(id); state.neural.tick += 5; state.neural.simTimeMs += 5; return structuredClone(state); }) });
  const joined = await service.join({ protocolVersion: 1, members: ['one', 'two'].map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: `old-${id}`, commandSequence: 0 })) });
  assert.deepEqual(joined.shared.participants.map(member => member.sessionEpoch), ['new-one', 'new-two']);
  await service.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'start' });
  const barrier = await service.advance(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: 2, action: 'barrier' });
  assert.equal(barrier.traces.every(trace => trace.substeps === 5), true);
  await service.close();
});

async function httpSetup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'shared-connectome-http-'));
  const identities = openIdentityStore(join(directory, 'fixtures'));
  const descriptors = Object.fromEntries(datasets.map(dataset => [dataset, { directory: join(directory, dataset), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256, manifestSha256: 'ab'.repeat(32), neuronCount: 2, edgeCount: 2 }]));
  const catalog = openConnectomeStore(join(directory, 'catalog'), { profiles: descriptors });
  const profiles = Object.fromEntries(datasets.map(dataset => [dataset, { descriptor: descriptors[dataset], measurement: { available: true, backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 1000 } }]));
  const backend = async (_directory, options) => backendFor(options, false);
  const server = createServer({ identities, autoTick: false, capacity: createCapacityPolicy({ settings: { maxResidentFlies: 3, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 } }), resourceUsage: () => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 100000 }), connectomeCatalog: catalog, connectomeProfiles: profiles, connectomeBackend: backend });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); catalog.close(); identities.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const list = async () => (await fetch(`${base}/api/connectomes`)).json();
  const state = async id => (await fetch(`${base}/api/connectomes/${id}`)).json();
  const create = async dataset => { const view = await list(); const response = await post('/api/connectomes', { protocolVersion: 1, catalogEpoch: view.catalogEpoch, commandSequence: view.commandSequence, dataset }); return (await response.json()).state; };
  const load = async id => { const current = await state(id); return post(`/api/connectomes/${id}/commands`, { protocolVersion: 1, individualId: id, sessionEpoch: current.sessionEpoch, commandSequence: current.commandSequence, action: 'load', steps: null, checkpointId: null }); };
  return { base, post, list, state, create, load };
}

test('HTTP shared full-connectome barrier is explicit, fixed-step and owner-scoped', async t => {
  const h = await httpSetup(t), a = await h.create(datasets[0]), b = await h.create(datasets[1]);
  assert.equal((await h.load(a.individualId)).status, 200); assert.equal((await h.load(b.individualId)).status, 200);
  const states = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  const joinedResponse = await h.post('/api/connectomes/shared/join', { protocolVersion: 1, members: states.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) });
  assert.equal(joinedResponse.status, 200); const joined = await joinedResponse.json();
  assert.equal((await h.post(`/api/connectomes/${a.individualId}/commands`, { protocolVersion: 1, individualId: a.individualId, sessionEpoch: states[0].sessionEpoch, commandSequence: 0, action: 'start', steps: null, checkpointId: null })).status, 409);
  const started = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/control`, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'start' });
  assert.equal(started.status, 200); const running = await started.json();
  assert.deepEqual((await Promise.all([h.state(a.individualId), h.state(b.individualId)])).map(value => value.neural.tick), [0, 0]);
  const barrier = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/barrier`, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: running.shared.worldEpoch, sequence: 2, action: 'barrier' });
  assert.equal(barrier.status, 200); const advanced = await barrier.json();
  assert.equal(advanced.shared.tick, 1); assert.deepEqual(advanced.traces.map(value => value.substeps), [5, 5]);
  const current = await h.state(a.individualId); assert.equal(current.neural.tick, 5);
  const separated = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/control`, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: advanced.shared.worldEpoch, sequence: advanced.shared.commandSequence + 1, action: 'separate' });
  assert.equal(separated.status, 200);
  assert.equal((await h.post(`/api/connectomes/${a.individualId}/commands`, { protocolVersion: 1, individualId: a.individualId, sessionEpoch: states[0].sessionEpoch, commandSequence: states[0].commandSequence, action: 'pause', steps: null, checkpointId: null })).status, 409);
});

test('HTTP joint checkpoint save, listing and restore are explicit, paused and lineage-bound', async t => {
  const h = await httpSetup(t), a = await h.create(datasets[0]), b = await h.create(datasets[1]);
  assert.equal((await h.load(a.individualId)).status, 200); assert.equal((await h.load(b.individualId)).status, 200);
  const initial = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  const joinedResponse = await h.post('/api/connectomes/shared/join', { protocolVersion: 1, members: initial.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) });
  assert.equal(joinedResponse.status, 200); const joined = await joinedResponse.json();
  const savedResponse = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/control`, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'save' });
  assert.equal(savedResponse.status, 200); const saved = await savedResponse.json();
  assert.equal(saved.shared.status, 'paused'); assert.equal(saved.shared.events.at(-1).type, 'save');
  const listedResponse = await fetch(`${h.base}/api/connectomes/shared/checkpoints`); assert.equal(listedResponse.status, 200);
  const listed = await listedResponse.json(); assert.equal(listed.checkpoints.length, 1); const jointId = listed.checkpoints[0].jointCheckpointId;
  const before = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  const separatedResponse = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/control`, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: saved.shared.worldEpoch, sequence: saved.shared.commandSequence + 1, action: 'separate' });
  assert.equal(separatedResponse.status, 200);
  const current = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  const incomplete = await h.post('/api/connectomes/shared/restore', { protocolVersion: 1, jointCheckpointId: jointId,
    members: [{ protocolVersion: 1, individualId: current[0].individualId, sessionEpoch: current[0].sessionEpoch, commandSequence: current[0].commandSequence }] });
  assert.equal(incomplete.status, 409);
  assert.deepEqual((await Promise.all([h.state(a.individualId), h.state(b.individualId)])).map(value => value.status), ['paused', 'paused']);
  const restoredResponse = await h.post('/api/connectomes/shared/restore', { protocolVersion: 1, jointCheckpointId: jointId,
    members: current.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) });
  assert.equal(restoredResponse.status, 200); const restored = await restoredResponse.json();
  assert.equal(restored.shared.status, 'paused'); assert.equal(restored.shared.tick, 0);
  const after = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  assert.deepEqual(after.map(value => value.status), ['paused', 'paused']);
  assert.equal(after[0].sessionEpoch === before[0].sessionEpoch, false); assert.equal(after[1].sessionEpoch === before[1].sessionEpoch, false);
  const stale = await h.post('/api/connectomes/shared/restore', { protocolVersion: 1, jointCheckpointId: jointId,
    members: current.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) });
  assert.equal(stale.status, 409);
});
