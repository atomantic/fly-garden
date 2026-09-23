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
import { createConnectomeService } from './connectome-service.js';
import { assessSharedCapacity, BARRIER_TELEMETRY_RETENTION, createBarrierTelemetry } from './shared-barrier-telemetry.js';
import { CONNECTOME_PROFILES } from './connectome-profiles.js';
import { describeTelemetry, measurementEnvelope } from '../client/src/connectome-shared-telemetry.js';

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
     prepareRestore: value => dispatch('prepareRestore', value), commitRestore: value => dispatch('commitRestore', value),
     discardRestore: value => dispatch('discardRestore', value), rollbackRestore: value => dispatch('rollbackRestore', value) };
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

test('shared restore restores distinct nonzero live ticks, modes and epochs after a second-worker commit failure', async t => {
  const target = [
    { individualId: 'shared-a', checkpoint: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'shared-a' }).checkpoint() },
    { individualId: 'shared-b', checkpoint: createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: 'shared-b' }).checkpoint() }
  ];
  let firstCommits = 0, secondCommits = 0, durableCommits = 0, cancelled = 0;
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { members: target } }),
    prepareJointRestore: () => ({ token: 'rollback-token', members: target.map(member => ({ ...member, parentId: null })) }),
    commitJointRestore: () => { durableCommits++; throw new Error('catalog unavailable'); },
    cancelJointRestore: () => { cancelled++; },
    openBackend: async (_directory, options) => {
      const backend = backendFor(options);
      if (options.individualId === 'shared-a') return { ...backend, commitRestore: async value => { firstCommits++; return backend.commitRestore(value); } };
      return { ...backend, commitRestore: async () => { secondCommits++; throw new Error('second commit failed'); } };
    } });
  t.after(() => registry.close());
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  const advance = async (id, steps) => {
    let state = registry.snapshot(id);
    await registry.command(id, { protocolVersion: 1, individualId: id, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'start', steps: null });
    state = registry.snapshot(id);
    await registry.command(id, { protocolVersion: 1, individualId: id, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'advance', steps });
    await registry.sharedControl(id, 'pause');
  };
  await advance('shared-a', 3); await advance('shared-b', 7); await registry.sharedControl('shared-a', 'rest');
  const before = registry.list();
  assert.deepEqual(before.map(state => state.neural.tick), [3, 7]);
  assert.deepEqual(before.map(state => state.status), ['resting', 'paused']);
  assert.equal(new Set(before.map(state => state.sessionEpoch)).size, 2);
  const prepared = await registry.prepareSharedRestore('joint');
  await assert.rejects(registry.commitSharedRestore(prepared), /second commit failed/);
  const after = registry.list();
  assert.deepEqual(after.map(state => state.neural.tick), before.map(state => state.neural.tick));
  assert.deepEqual(after.map(state => state.status), before.map(state => state.status));
  assert.deepEqual(after.map(state => state.sessionEpoch), before.map(state => state.sessionEpoch));
  assert.deepEqual(after.map(state => state.checkpointId), before.map(state => state.checkpointId));
  assert.equal(firstCommits, 1); assert.equal(secondCommits, 1); assert.equal(durableCommits, 0); assert.equal(cancelled, 1);
});

test('shared restore rejects extra, duplicate and cross-namespace membership before preparation', async () => {
  const expected = [
    { individualId: 'one', dataset: datasets[0], graphSha256: '1'.repeat(64), modelId: 'malecns-traced-lif-v1', mode: 'active' },
    { individualId: 'two', dataset: datasets[1], graphSha256: '2'.repeat(64), modelId: 'banc-proofread-lif-v1', mode: 'active' }
  ];
  const states = new Map([
    ['one', { source: 'connectome', individualId: 'one', dataset: datasets[0], sessionEpoch: 'epoch-one', commandSequence: 0, resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: '1'.repeat(64), model: { id: 'malecns-traced-lif-v1' }, capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } }],
    ['two', { source: 'connectome', individualId: 'two', dataset: datasets[1], sessionEpoch: 'epoch-two', commandSequence: 0, resident: true, status: 'paused', neural: { tick: 0, simTimeMs: 0 }, graphSha256: '2'.repeat(64), model: { id: 'banc-proofread-lif-v1' }, capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } }]
  ]);
  const envelopes = ids => ids.map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: states.get(id).sessionEpoch, commandSequence: 0 }));
  const cases = [
    ['extra', [...envelopes(['one', 'two']), { protocolVersion: 1, individualId: 'extra', sessionEpoch: 'epoch-extra', commandSequence: 0 }]],
    ['duplicate', envelopes(['one', 'one'])],
    ['cross-namespace', envelopes(['one', 'two'])]
  ];
  for (const [label, members] of cases) {
    const local = new Map([...states].map(([id, state]) => [id, structuredClone(state)]));
    if (label === 'cross-namespace') local.get('one').dataset = datasets[1];
    let preparations = 0;
    const service = createConnectomeSharedSession({ snapshot: id => structuredClone(local.get(id)), control: async () => {}, barrier: async () => [],
      readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { tick: 0, members: expected } }),
      prepareRestore: async () => { preparations++; return { members: [] }; }, commitRestore: async () => {} });
    await assert.rejects(service.restore({ protocolVersion: 1, jointCheckpointId: 'joint', members }), /membership|namespace|stale|unavailable|Invalid/);
    assert.equal(preparations, 0);
    await service.close();
  }
});

test('persisted restore retains rest and withdrawal membership and reports all-resting status', async () => {
  const ids = ['one', 'two', 'three'];
  const states = new Map(ids.map((id, index) => [id, { source: 'connectome', individualId: id, dataset: datasets[index % 2], sessionEpoch: `epoch-${id}`, commandSequence: 0, resident: true, status: 'paused', neural: { tick: index, simTimeMs: index }, graphSha256: `${index + 1}`.repeat(64), model: { id: index === 1 ? 'banc-proofread-lif-v1' : 'malecns-traced-lif-v1' }, capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } }]));
  const saved = new Map();
  const control = async (id, action) => { const state = states.get(id); state.status = action === 'start' ? 'running' : 'paused'; return structuredClone(state); };
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control, barrier: async ids => ids.map(id => structuredClone(states.get(id))),
    invalidate: () => {}, checkpoint: async ({ ids: memberIds, tick, modes }) => {
      const result = { jointCheckpointId: `saved-${saved.size}`, payload: { tick, members: memberIds.map(id => ({ individualId: id, mode: modes[id] })) } };
      saved.set(result.jointCheckpointId, result); return result;
    }, readJointCheckpoint: id => structuredClone(saved.get(id)), listJoints: () => [...saved.values()],
    prepareRestore: async id => ({ jointCheckpointId: id, members: [] }), commitRestore: async () => {} });
  const envelopes = memberIds => memberIds.map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: states.get(id).sessionEpoch, commandSequence: states.get(id).commandSequence }));
  const joined = await service.join({ protocolVersion: 1, members: envelopes(ids) });
  const rest = await service.member(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: service.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: 1, individualId: 'two', action: 'rest' });
  const savedResponse = await service.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: rest.shared.worldEpoch, sequence: 2, action: 'save' });
  const withWithdrawal = structuredClone(saved.get(savedResponse.shared.events.at(-1).jointCheckpointId));
  const withdrawn = await service.member(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: savedResponse.shared.worldEpoch, sequence: 3, individualId: 'three', action: 'withdraw' });
  const separated = await service.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: withdrawn.shared.worldEpoch, sequence: 4, action: 'separate' });
  assert.equal(separated.shared.status, 'separated');
  const restored = await service.restore({ protocolVersion: 1, jointCheckpointId: withWithdrawal.jointCheckpointId, members: envelopes(ids) });
  assert.deepEqual(restored.shared.participants.map(member => [member.individualId, member.mode]), [['one', 'active'], ['two', 'resting'], ['three', 'active']]);
  await service.control(restored.shared.sharedId, { protocolVersion: 1, sharedId: restored.shared.sharedId, worldEpoch: restored.shared.worldEpoch, sequence: 1, action: 'separate' });
  const allResting = { jointCheckpointId: 'all-resting', payload: { tick: 4, members: ids.map(id => ({ individualId: id, mode: 'resting' })) } };
  saved.set(allResting.jointCheckpointId, allResting);
  const resting = await service.restore({ protocolVersion: 1, jointCheckpointId: allResting.jointCheckpointId, members: envelopes(ids) });
  assert.equal(resting.shared.status, 'resting');
  assert.equal(resting.shared.participants.every(member => member.mode === 'resting'), true);
  await assert.rejects(service.control(resting.shared.sharedId, { protocolVersion: 1, sharedId: resting.shared.sharedId, worldEpoch: resting.shared.worldEpoch, sequence: 1, action: 'start' }), /Every shared research participant is resting/);
  await assert.rejects(service.advance(resting.shared.sharedId, { protocolVersion: 1, sharedId: resting.shared.sharedId, worldEpoch: resting.shared.worldEpoch, sequence: 1, action: 'barrier' }), /Explicit shared start|Every shared research participant is resting/);
  await service.close();
});

test('joint post-rename uncertainty reconciles every selected head and evicts cached workers', async t => {
  const target = [ identities[0], identities[1] ].map(identity => {
    const kernel = createSparseLif(graph(identity.dataset), { dataset: identity.dataset, individualId: identity.individualId });
    kernel.seedProbe([0]); kernel.step();
    return { individualId: identity.individualId, checkpoint: kernel.checkpoint() };
  });
  const heads = Object.fromEntries(target.map(member => [member.individualId, randomUUID()]));
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { members: target } }),
    prepareJointRestore: () => ({ token: 'uncertain-token', members: target.map(member => ({ ...member, parentId: null })) }),
    commitJointRestore: () => { throw Object.assign(new Error('catalog durability uncertain'), { code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedHeads: heads }); },
    cancelJointRestore: () => {},
    openBackend: async (_directory, options) => backendFor(options) });
  t.after(() => registry.close());
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  const prepared = await registry.prepareSharedRestore('joint');
  await assert.rejects(registry.commitSharedRestore(prepared), error => error.code === 'CONNECTOME_DURABILITY_UNCERTAIN');
  assert.deepEqual(registry.list().map(state => state.checkpointId), [heads['shared-a'], heads['shared-b']]);
  assert.equal(registry.list().every(state => !state.resident && state.recoveryRequired), true);
});

test('individual restore rolls runtime back when persistence fails after worker commit', async t => {
  const identity = identities[0];
  const targetKernel = createSparseLif(graph(identity.dataset), { dataset: identity.dataset, individualId: identity.individualId });
  targetKernel.seedProbe([0]); targetKernel.step(); targetKernel.step();
  const registry = createConnectomeRegistry({ identities: [identity], capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => { throw new Error('catalog unavailable'); },
    openBackend: async (_directory, options) => backendFor(options) });
  t.after(() => registry.close());
  await registry.load(identity.individualId);
  const state = registry.snapshot(identity.individualId);
  await assert.rejects(registry.command(identity.individualId, { protocolVersion: 1, individualId: identity.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'restore', steps: null }, targetKernel.checkpoint(), null), /catalog unavailable/);
  assert.equal(registry.snapshot(identity.individualId).sessionEpoch, state.sessionEpoch);
  assert.equal(registry.snapshot(identity.individualId).neural.tick, 0);
  assert.equal(registry.snapshot(identity.individualId).resident, true);
  assert.equal(registry.snapshot(identity.individualId).status, 'paused');
});
test('shared restore reservation rejects direct lifecycle and sample work before preparation completes', async t => {
   let release;
  const gate = new Promise(resolve => { release = resolve; });
  const target = [
    { individualId: 'shared-a', checkpoint: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'shared-a' }).checkpoint() },
    { individualId: 'shared-b', checkpoint: createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: 'shared-b' }).checkpoint() }
  ];
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { members: target } }),
    prepareJointRestore: () => ({ token: 'reservation-token', members: target.map(member => ({ ...member, parentId: null })) }),
    commitJointRestore: () => ({ jointCheckpointId: 'joint', members: target.map(member => ({ individualId: member.individualId, checkpointId: randomUUID() })) }),
    cancelJointRestore: () => {},
    openBackend: async (_directory, options) => { const backend = backendFor(options); if (options.individualId === 'shared-a') return { ...backend, prepareRestore: async value => { await gate; return backend.prepareRestore(value); } }; return backend; } });
  t.after(() => registry.close());
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  const restoring = registry.prepareSharedRestore('joint');
  await new Promise(resolve => setImmediate(resolve));
  const state = registry.snapshot('shared-a');
  await assert.rejects(registry.command('shared-a', { protocolVersion: 1, individualId: 'shared-a', sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'pause', steps: null }), /reserved/);
  await assert.rejects(registry.sample('shared-a', { protocolVersion: 1, individualId: 'shared-a', dataset: state.dataset, graphSha256: state.graphSha256, sessionEpoch: state.sessionEpoch, neuronIds: [`${datasets[0]}/1`] }), /reserved/);
  release();
  const prepared = await restoring;
  await registry.commitSharedRestore(prepared);
  assert.deepEqual(registry.list().map(value => value.status), ['paused', 'paused']);
});

test('reserved restore rejects concurrent withdrawal and barrier attempts without membership mutation', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const three = [...identities, { individualId: 'shared-c', dataset: datasets[0], directory: '/trusted/shared-c' }];
  const target = three.map(identity => ({ individualId: identity.individualId, checkpoint: createSparseLif(graph(identity.dataset), { dataset: identity.dataset, individualId: identity.individualId }).checkpoint() }));
  const registry = createConnectomeRegistry({ identities: three, capacity: createCapacityPolicy({ settings: { ...settings, maxResidentFlies: 3 } }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000, measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }), readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { members: target } }),
    prepareJointRestore: () => ({ token: 'reserved-token', members: target.map(member => ({ ...member, parentId: null })) }), commitJointRestore: () => ({ jointCheckpointId: 'joint', members: target.map(member => ({ individualId: member.individualId, checkpointId: randomUUID() })) }), cancelJointRestore: () => {},
    openBackend: async (_directory, options) => { const backend = backendFor(options); if (options.individualId === 'shared-a') return { ...backend, prepareRestore: async value => { await gate; return backend.prepareRestore(value); } }; return backend; } });
  t.after(() => registry.close());
  await Promise.all(three.map(identity => registry.load(identity.individualId)));
  const shared = createConnectomeSharedSession({ snapshot: id => registry.snapshot(id), control: (id, action) => registry.sharedControl(id, action), barrier: (ids, steps, expected) => registry.barrier(ids, steps, expected), invalidate: ids => registry.invalidateCommands(ids) });
  const joined = await shared.join({ protocolVersion: 1, members: three.map(identity => { const state = registry.snapshot(identity.individualId); return { protocolVersion: 1, individualId: identity.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence }; }) });
  const restoring = registry.prepareSharedRestore('joint');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(shared.member(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: shared.snapshot(joined.shared.sharedId).shared.worldEpoch, sequence: 1, individualId: 'shared-c', action: 'withdraw' }), /reserved/);
  await assert.rejects(registry.barrier(three.map(identity => identity.individualId), 5), /reserved/);
  assert.equal(shared.snapshot(joined.shared.sharedId).shared.participants.length, 3);
  release(); await restoring; await shared.close();
});

test('worker restore preparation cannot be invalidated by sampling or lifecycle actions', () => {
  const session = createConnectomeSession({ graph: graph(datasets[0]), dataset: datasets[0], individualId: 'worker' });
  const prepared = session.dispatch({ action: 'prepareRestore', value: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'worker' }).checkpoint(), sessionEpoch: session.snapshot().sessionEpoch });
  assert.throws(() => session.dispatch({ action: 'sample', value: [`${datasets[0]}/1`], sessionEpoch: session.snapshot().sessionEpoch }), /Restore preparation pending/);
  assert.throws(() => session.dispatch({ action: 'start', sessionEpoch: session.snapshot().sessionEpoch }), /Restore preparation pending/);
  session.dispatch({ action: 'discardRestore', value: prepared.token, sessionEpoch: session.snapshot().sessionEpoch });
  assert.equal(session.snapshot().status, 'paused');
  assert.doesNotThrow(() => session.dispatch({ action: 'sample', value: [`${datasets[0]}/1`], sessionEpoch: session.snapshot().sessionEpoch }));
});
test('joint durability failure makes shared and service views fail closed', async t => {
  let fail = false;
  const root = mkdtempSync(join(tmpdir(), 'shared-connectome-fault-'));
  const descriptors = Object.fromEntries(datasets.map(dataset => [dataset, { directory: join(root, dataset), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256,
    manifestSha256: 'ab'.repeat(32), neuronCount: 2, edgeCount: 2 }]));
  const catalog = openConnectomeStore(join(root, 'catalog'), { profiles: descriptors, syncCatalogDirectory: () => { if (fail) throw new Error('directory fsync failed'); } });
  const a = catalog.create(datasets[0]), b = catalog.create(datasets[1]);
  const ka = createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: a.individualId });
  const kb = createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: b.individualId });
  catalog.persistCheckpoint({ individualId: a.individualId, dataset: a.dataset, parentId: null, checkpoint: ka.checkpoint(), operation: 'save' });
  catalog.persistCheckpoint({ individualId: b.individualId, dataset: b.dataset, parentId: null, checkpoint: kb.checkpoint(), operation: 'save' });
  const profiles = Object.fromEntries(datasets.map(dataset => [dataset, { descriptor: descriptors[dataset], measurement: { available: true, backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }]));
  const service = createConnectomeService({ store: catalog, profiles, capacity: createCapacityPolicy({ settings: { maxResidentFlies: 3, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 } }),
    getResources: () => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000 }), openBackend: async (_directory, options) => backendFor(options) });
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  for (const identity of [a, b]) {
    const state = service.snapshot(identity.individualId);
    await service.command(identity.individualId, { protocolVersion: 1, individualId: identity.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'load', steps: null, checkpointId: null });
  }
  const states = [service.snapshot(a.individualId), service.snapshot(b.individualId)];
  const joined = await service.shared.join({ protocolVersion: 1, members: states.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence })) });
  fail = true;
  await assert.rejects(service.shared.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'save' }), /durability|refresh/i);
  assert.equal(service.view().available, false);
  assert.equal(service.shared.view().available, false);
  assert.throws(() => service.shared.checkpoints(), /unavailable/i);
});

test('successful shared restore invalidates every member through the lifecycle callback', async t => {
  const events = [], root = mkdtempSync(join(tmpdir(), 'shared-connectome-recording-'));
  const descriptors = Object.fromEntries(datasets.map(dataset => [dataset, { directory: join(root, dataset), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256,
    manifestSha256: 'ab'.repeat(32), neuronCount: 2, edgeCount: 2 }]));
  const catalog = openConnectomeStore(join(root, 'catalog'), { profiles: descriptors });
  const a = catalog.create(datasets[0]), b = catalog.create(datasets[1]);
  const ka = createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: a.individualId });
  const kb = createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: b.individualId });
  catalog.persistCheckpoint({ individualId: a.individualId, dataset: a.dataset, parentId: null, checkpoint: ka.checkpoint(), operation: 'save' });
  catalog.persistCheckpoint({ individualId: b.individualId, dataset: b.dataset, parentId: null, checkpoint: kb.checkpoint(), operation: 'save' });
  const profiles = Object.fromEntries(datasets.map(dataset => [dataset, { descriptor: descriptors[dataset], measurement: { available: true, backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }]));
  const service = createConnectomeService({ store: catalog, profiles, capacity: createCapacityPolicy({ settings: { maxResidentFlies: 3, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 } }),
    getResources: () => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000 }), openBackend: async (_directory, options) => backendFor(options), onLifecycle: id => events.push(id) });
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  for (const identity of [a, b]) {
    const state = service.snapshot(identity.individualId);
    await service.command(identity.individualId, { protocolVersion: 1, individualId: identity.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'load', steps: null, checkpointId: null });
  }
  const states = [service.snapshot(a.individualId), service.snapshot(b.individualId)];
  const joined = await service.shared.join({ protocolVersion: 1, members: states.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence })) });
  const saved = await service.shared.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: joined.shared.worldEpoch, sequence: 1, action: 'save' });
  const separated = await service.shared.control(joined.shared.sharedId, { protocolVersion: 1, sharedId: joined.shared.sharedId, worldEpoch: saved.shared.worldEpoch, sequence: 2, action: 'separate' });
  assert.equal(separated.shared.status, 'separated'); events.length = 0;
  const current = [service.snapshot(a.individualId), service.snapshot(b.individualId)];
  const restored = await service.shared.restore({ protocolVersion: 1, jointCheckpointId: (await service.shared.checkpoints())[0].jointCheckpointId,
    members: current.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence })) });
  assert.equal(restored.shared.status, 'paused');
  assert.deepEqual(events.sort(), [a.individualId, b.individualId].sort());
});

test('registry shutdown cancels an in-flight restore reservation without waiting for its worker gate', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const target = [
    { individualId: 'shared-a', checkpoint: createSparseLif(graph(datasets[0]), { dataset: datasets[0], individualId: 'shared-a' }).checkpoint() },
    { individualId: 'shared-b', checkpoint: createSparseLif(graph(datasets[1]), { dataset: datasets[1], individualId: 'shared-b' }).checkpoint() }
  ];
  const registry = createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }),
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    readJointCheckpoint: () => ({ jointCheckpointId: 'joint', payload: { members: target } }),
    prepareJointRestore: () => ({ token: 'shutdown-token', members: target.map(member => ({ ...member, parentId: null })) }),
    commitJointRestore: () => ({ jointCheckpointId: 'joint', members: target.map(member => ({ individualId: member.individualId, checkpointId: randomUUID() })) }),
    cancelJointRestore: () => {},
    openBackend: async (_directory, options) => { const backend = backendFor(options); if (options.individualId === 'shared-a') return { ...backend, prepareRestore: async value => { await gate; return backend.prepareRestore(value); } }; return backend; } });
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  const restoring = registry.prepareSharedRestore('joint');
  await new Promise(resolve => setImmediate(resolve));
  await registry.close();
  await assert.rejects(restoring, /closed|reserved/);
  release();
  assert.equal(registry.list().every(state => !state.resident), true);
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

// ---- Barrier telemetry, bounded resource metadata and explicit measurement (#103) ----
const MODEL_IDS = Object.fromEntries(Object.entries(CONNECTOME_PROFILES).map(([dataset, profile]) => [dataset, profile.modelId]));
const envelope = (shared, extra) => ({ protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, ...extra });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function delayedRegistry(delays, options = {}) {
  return createConnectomeRegistry({ identities, capacity: createCapacityPolicy({ settings }), ...options,
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000,
      measurement: { backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 100 } }),
    persistCheckpoint: async () => ({ checkpointId: randomUUID() }),
    openBackend: async (_directory, opened) => { const backend = backendFor(opened); const id = opened.individualId;
      return { ...backend,
        start: async () => { await wait(delays.start?.[id] ?? 0); return backend.start(); },
        prepareAdvance: async value => { if (delays.hang?.[id]) await delays.hang[id]; await wait(delays.prepare?.[id] ?? 0); return backend.prepareAdvance(value); },
        commitAdvance: async value => { await wait(delays.commit?.[id] ?? 0); return backend.commitAdvance(value); } }; } });
}
function registryShared(registry, extra = {}) {
  return createConnectomeSharedSession({ snapshot: id => registry.snapshot(id), control: (id, action) => registry.sharedControl(id, action),
    barrier: (ids, steps, expected, observe) => registry.barrier(ids, steps, expected, observe), invalidate: ids => registry.invalidateCommands(ids), ...extra });
}
async function joinedRunning(service, registry) {
  const members = ['shared-a', 'shared-b'].map(id => { const state = registry.snapshot(id); return { protocolVersion: 1, individualId: id, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence }; });
  const joined = await service.join({ protocolVersion: 1, members });
  return (await service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
}
function mockShared({ ids = ['one', 'two'], graphSha = index => `${index}`.repeat(64), ...extra } = {}) {
  const states = new Map(), calls = { control: 0, barrier: 0 };
  for (const [index, id] of ids.entries()) {
    const dataset = datasets[index % 2];
    states.set(id, { source: 'connectome', individualId: id, dataset, sessionEpoch: `epoch-${id}`, commandSequence: 0, resident: true, status: 'paused',
      neural: { tick: 0, simTimeMs: 0 }, graphSha256: graphSha(index), model: { id: MODEL_IDS[dataset] },
      capabilities: { sensoryMotor: false, learning: false, chemistry: false, embodiment: false } });
  }
  const behaviour = { step: 5, timing: 'report', fail: false };
  const control = async (id, action) => { calls.control++; const state = states.get(id); if (state.status !== 'fault') state.status = action === 'start' ? 'running' : 'paused'; return structuredClone(state); };
  const barrier = async (memberIds, _steps, _expected, observe) => {
    calls.barrier++;
    if (behaviour.fail) { observe?.({ queueWaitMs: 0, prepareMs: 1, commitMs: null, failure: 'worker-failure', members: memberIds.map(individualId => ({ individualId, prepareMs: 1, commitMs: null })), completionOrder: { prepare: [...memberIds], commit: [] } }); throw new Error('injected failure'); }
    const result = memberIds.map(id => { const state = states.get(id); state.neural.tick += behaviour.step; state.neural.simTimeMs += behaviour.step; return structuredClone(state); });
    if (behaviour.timing === 'report') observe?.({ queueWaitMs: 0.5, prepareMs: 1, commitMs: 1, failure: null, members: memberIds.map(individualId => ({ individualId, prepareMs: 1, commitMs: 1 })), completionOrder: { prepare: [...memberIds].reverse(), commit: [...memberIds] } });
    else if (behaviour.timing === 'malformed') observe?.({ queueWaitMs: Number.NaN, prepareMs: -1, commitMs: 1, failure: null, members: [], completionOrder: { prepare: ['ghost'], commit: [] } });
    else if (behaviour.timing === 'throwing') { observe?.({ queueWaitMs: 0, prepareMs: 0, commitMs: 0 }); }
    return result;
  };
  const service = createConnectomeSharedSession({ snapshot: id => structuredClone(states.get(id)), control, barrier, runtime: { node: 'v-test', platform: 'test', arch: 'test' },
    measuredAt: () => '2026-09-23T00:00:00.000Z', memoryUsage: () => ({ rss: 1000 }), pinned: () => ({}), ...extra });
  const envelopes = () => ids.map(id => ({ protocolVersion: 1, individualId: id, sessionEpoch: states.get(id).sessionEpoch, commandSequence: 0 }));
  return { states, calls, behaviour, service, envelopes };
}

test('injected scheduling varies queue wait and completion order while every committed barrier stays exactly five 1 ms substeps', async t => {
  const delays = { prepare: {}, commit: {}, start: {} };
  const registry = delayedRegistry(delays), service = registryShared(registry);
  t.after(async () => { await service.close(); await registry.close(); });
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  let shared = await joinedRunning(service, registry);
  delays.prepare = { 'shared-a': 30 }; delays.commit = { 'shared-a': 30 };
  shared = (await service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  const first = shared.telemetry.latest;
  assert.deepEqual(first.completionOrder, { prepare: ['shared-b', 'shared-a'], commit: ['shared-b', 'shared-a'] });
  delays.prepare = { 'shared-b': 30 }; delays.commit = { 'shared-b': 30 };
  shared = (await service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  const second = shared.telemetry.latest;
  assert.deepEqual(second.completionOrder, { prepare: ['shared-a', 'shared-b'], commit: ['shared-a', 'shared-b'] });
  delays.prepare = {}; delays.commit = {}; delays.start = { 'shared-a': 40 };
  const queued = registry.sharedControl('shared-a', 'start');
  await wait(5);
  shared = (await service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  await queued;
  const third = shared.telemetry.latest;
  assert.ok(third.queueWaitMs >= 20 && third.queueWaitMs > first.queueWaitMs, `queue wait ${third.queueWaitMs} should include the in-flight lifecycle operation`);
  for (const sample of [first, second, third]) {
    assert.equal(sample.outcome, 'committed'); assert.equal(sample.valid, true); assert.equal(sample.substepValidation, 'exact');
    assert.deepEqual(sample.members.map(member => [member.individualId, member.observedSubsteps, member.skippedSubsteps, member.extraSubsteps]), [['shared-a', 5, 0, 0], ['shared-b', 5, 0, 0]]);
    for (const value of [sample.wallMs, sample.queueWaitMs, sample.prepareMs, sample.commitMs, sample.lagMs]) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(sample.wallMs >= sample.prepareMs + sample.commitMs);
  }
  assert.deepEqual(registry.list().map(state => [state.neural.tick, state.neural.simTimeMs]), [[15, 15], [15, 15]]);
  assert.deepEqual(shared.telemetry.history.map(sample => sample.worldTick), [1, 2, 3]);
  assert.deepEqual(shared.telemetry.counts, { committed: 3, failed: 0, invalid: 0, pressurePauses: 0 });
  assert.equal(shared.telemetry.retention.maxSamples, BARRIER_TELEMETRY_RETENTION);
});

test('a registry deadline is reported as a failed barrier, rolls back and pauses through the existing path', async t => {
  let release;
  const delays = { hang: { 'shared-b': new Promise(resolve => { release = resolve; }) } };
  const registry = delayedRegistry(delays, { operationTimeoutMs: 25 }), service = registryShared(registry);
  t.after(async () => { release(); await service.close(); await registry.close(); });
  await Promise.all([registry.load('shared-a'), registry.load('shared-b')]);
  const shared = await joinedRunning(service, registry);
  await assert.rejects(service.advance(shared.sharedId, envelope(shared, { action: 'barrier' })), /no participant advanced/);
  const after = service.view().sessions[0];
  assert.equal(after.status, 'paused'); assert.equal(after.tick, 0);
  assert.equal(after.telemetry.latest.outcome, 'failed'); assert.equal(after.telemetry.latest.reason, 'deadline');
  assert.equal(after.telemetry.latest.substepValidation, 'not-committed');
  assert.equal(after.telemetry.health.state, 'fault');
  assert.ok(after.telemetry.health.reasons.some(reason => reason.code === 'deadline'));
  assert.equal(registry.snapshot('shared-a').neural.tick, 0);
});

test('telemetry recorder keeps a declared bound and fails closed on malformed or non-finite values', () => {
  const telemetry = createBarrierTelemetry({ intervalMs: 5, substeps: 5 });
  const ids = ['one', 'two'];
  const timing = { queueWaitMs: 0, prepareMs: 1, commitMs: 1, failure: null, members: ids.map(individualId => ({ individualId, prepareMs: 1, commitMs: 1 })), completionOrder: { prepare: ids, commit: ids } };
  const good = { outcome: 'committed', worldTick: 1, startedAt: 10, finishedAt: 17, memberIds: ids, timing, observedSubsteps: { one: 5, two: 5 } };
  assert.equal(telemetry.record(good).lagMs, 2);
  const invalid = [
    { ...good, startedAt: Number.NaN }, { ...good, finishedAt: 9 }, { ...good, startedAt: Infinity, finishedAt: Infinity },
    { ...good, timing: { ...timing, queueWaitMs: -1 } }, { ...good, timing: { ...timing, prepareMs: Number.POSITIVE_INFINITY } },
    { ...good, timing: { ...timing, members: [{ individualId: 'two', prepareMs: 1, commitMs: 1 }, { individualId: 'one', prepareMs: 1, commitMs: 1 }] } },
    { ...good, timing: { ...timing, completionOrder: { prepare: ['one', 'one'], commit: ids } } },
    { ...good, timing: { ...timing, completionOrder: { prepare: ['one'], commit: ids } } },
    { ...good, observedSubsteps: { one: 4, two: 5 } }, { ...good, observedSubsteps: { one: 5, two: 6 } }, { ...good, timing: null }
  ];
  for (const sample of invalid) {
    const recorded = telemetry.record(sample);
    assert.equal(recorded.valid, false); assert.equal(recorded.reason, 'invalid-telemetry');
    assert.deepEqual([recorded.wallMs, recorded.queueWaitMs, recorded.prepareMs, recorded.commitMs, recorded.lagMs], [null, null, null, null, null]);
    assert.equal(recorded.completionOrder, null); assert.equal(recorded.members.every(member => member.prepareRank === null && member.observedSubsteps === null), true);
  }
  const mismatch = telemetry.record({ outcome: 'failed', reason: 'step-mismatch', worldTick: 1, startedAt: 1, finishedAt: 2, memberIds: ids, timing: undefined, observedSubsteps: { one: 4, two: 5 } });
  assert.equal(mismatch.valid, true); assert.equal(mismatch.substepValidation, 'mismatch');
  assert.deepEqual(mismatch.members.map(member => [member.skippedSubsteps, member.extraSubsteps]), [[1, 0], [0, 0]]);
  assert.equal(telemetry.record({ ...good, outcome: 'failed', reason: '/private/path leak' }).reason, 'worker-failure');
  assert.throws(() => telemetry.record({ ...good, memberIds: ['one', 'one'] }), /Invalid barrier telemetry record/);
  for (let index = 0; index < 40; index++) telemetry.record({ ...good, worldTick: index + 2 });
  const view = telemetry.view();
  assert.equal(view.history.length, BARRIER_TELEMETRY_RETENTION); assert.equal(view.history.at(-1).index, 54);
  assert.deepEqual(view.counts, { committed: 52, failed: 2, invalid: 11, pressurePauses: 0 });
  assert.equal(view.observational, true);
  assert.throws(() => createBarrierTelemetry({ intervalMs: 5, substeps: 5, retention: 0 }), /Invalid barrier telemetry configuration/);
});

test('reads never consume a sequence, call a worker or change lifecycle; faults still pause only through the explicit barrier', async () => {
  const f = mockShared();
  const joined = await f.service.join({ protocolVersion: 1, members: f.envelopes() });
  let shared = (await f.service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
  shared = (await f.service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  const before = { calls: { ...f.calls }, shared: structuredClone(shared) };
  for (let index = 0; index < 5; index++) { f.service.view(); f.service.snapshot(shared.sharedId); }
  const read = f.service.snapshot(shared.sharedId).shared;
  assert.deepEqual(f.calls, before.calls);
  assert.deepEqual([read.commandSequence, read.worldEpoch, read.status, read.tick], [shared.commandSequence, shared.worldEpoch, 'running', 1]);
  assert.deepEqual(read.telemetry, shared.telemetry);
  assert.equal(read.telemetry.health.state, 'nominal');
  assert.equal(JSON.stringify(read.telemetry).includes('neural'), false);

  f.states.get('two').status = 'fault';
  const faulted = f.service.snapshot(shared.sharedId).shared;
  assert.equal(faulted.status, 'running'); assert.deepEqual(f.calls, before.calls);
  assert.deepEqual(faulted.telemetry.health, { state: 'fault', reasons: [{ individualId: 'two', code: 'participant-fault' }] });
  assert.equal(faulted.participants[1].status, 'fault');
  await assert.rejects(f.service.advance(shared.sharedId, envelope(faulted, { action: 'barrier' })), /unavailable/);
  const paused = f.service.snapshot(shared.sharedId).shared;
  assert.equal(paused.status, 'paused'); assert.equal(paused.telemetry.latest.reason, 'participant-unavailable');
  assert.equal(f.calls.barrier, before.calls.barrier);

  f.states.get('two').status = 'paused'; f.states.get('one').sessionEpoch = 'replaced';
  const stale = f.service.snapshot(shared.sharedId).shared;
  assert.equal(stale.telemetry.health.state, 'fault');
  assert.ok(stale.telemetry.health.reasons.some(reason => reason.code === 'stale-epoch' && reason.individualId === 'one'));
  await f.service.close();
});

test('malformed, missing or throwing telemetry never blocks a valid barrier and is published as invalid', async () => {
  let ticks = 0;
  const f = mockShared({ now: () => { ticks++; if (ticks === 2) throw new Error('clock unavailable'); return ticks; } });
  const joined = await f.service.join({ protocolVersion: 1, members: f.envelopes() });
  let shared = (await f.service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
  shared = (await f.service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  assert.equal(shared.tick, 1); assert.equal(shared.telemetry.latest.valid, false);
  f.behaviour.timing = 'malformed';
  shared = (await f.service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  assert.equal(shared.tick, 2); assert.equal(shared.telemetry.latest.reason, 'invalid-telemetry'); assert.equal(shared.status, 'running');
  f.behaviour.timing = 'none';
  shared = (await f.service.advance(shared.sharedId, envelope(shared, { action: 'barrier' }))).shared;
  assert.equal(shared.telemetry.latest.valid, true); assert.equal(shared.telemetry.latest.queueWaitMs, null); assert.equal(shared.telemetry.latest.completionOrder, null);
  f.behaviour.step = 4;
  await assert.rejects(f.service.advance(shared.sharedId, envelope(shared, { action: 'barrier' })), /skipped or extra/);
  const mismatch = f.service.snapshot(shared.sharedId).shared;
  assert.equal(mismatch.status, 'paused'); assert.equal(mismatch.tick, 3);
  assert.equal(mismatch.telemetry.latest.reason, 'step-mismatch'); assert.equal(mismatch.telemetry.latest.substepValidation, 'mismatch');
  assert.deepEqual(mismatch.telemetry.counts, { committed: 3, failed: 1, invalid: 2, pressurePauses: 0 });
  await f.service.close();
});

test('pressure pauses are counted and reported, and an explicit start clears the pressure reason', async () => {
  const f = mockShared();
  const joined = await f.service.join({ protocolVersion: 1, members: f.envelopes() });
  let shared = (await f.service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
  await f.service.pauseForPressure();
  shared = f.service.snapshot(shared.sharedId).shared;
  assert.equal(shared.status, 'paused'); assert.equal(shared.telemetry.counts.pressurePauses, 1);
  assert.deepEqual(shared.telemetry.pressure, { worldTick: 0, reason: 'resource-pressure' });
  assert.equal(shared.telemetry.health.state, 'pressure');
  shared = (await f.service.control(shared.sharedId, envelope(shared, { action: 'start' }))).shared;
  assert.equal(shared.telemetry.health.state, 'nominal'); assert.equal(shared.telemetry.counts.pressurePauses, 1);
  await f.service.close();
});

test('explicit measurement is bounded, stops cleanly and never validates capacity for tiny or unpinned graphs', async () => {
  const f = mockShared({ resources: () => ({ residentCount: 2, runningCount: 2, maxResidentFlies: 4, aggregateMemoryBytes: 10, availableMemoryBytes: 100, pressure: f.behaviour.pressure ?? 'within-budget', memberMemoryBytes: { [datasets[0]]: 123 } }) });
  const joined = await f.service.join({ protocolVersion: 1, members: f.envelopes() });
  await assert.rejects(f.service.measure(joined.shared.sharedId, envelope(joined.shared, { barriers: 100 })), /Explicit shared start/);
  let shared = (await f.service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
  for (const barriers of [9, 1001, 10.5, '100']) await assert.rejects(f.service.measure(shared.sharedId, envelope(shared, { barriers })), /Invalid shared research measurement envelope/);
  assert.equal(f.calls.barrier, 0);
  assert.equal(shared.telemetry.capacity.validatedConnectomeCapacity, null); assert.equal(shared.telemetry.capacity.reason, 'no-measurement');
  assert.equal(shared.telemetry.capacity.configuredMaxResidents, 4);
  assert.deepEqual(shared.telemetry.resources.members.map(member => member.incrementalMemoryBytes), [123, null]);
  shared = (await f.service.measure(shared.sharedId, envelope(shared, { barriers: 100 }))).shared;
  assert.equal(shared.telemetry.measurement.status, 'complete'); assert.equal(shared.telemetry.measurement.completedBarriers, 100);
  assert.deepEqual(shared.telemetry.measurement.members.map(member => member.completedSubsteps), [500, 500]);
  assert.equal(shared.tick, 100); assert.equal(shared.status, 'running');
  assert.equal(shared.telemetry.capacity.validatedConnectomeCapacity, null); assert.equal(shared.telemetry.capacity.reason, 'not-pinned-full-graph');
  f.behaviour.pressure = 'hard-limit';
  shared = (await f.service.measure(shared.sharedId, envelope(shared, { barriers: 50 }))).shared;
  assert.equal(shared.telemetry.measurement.status, 'unavailable'); assert.equal(shared.telemetry.measurement.stopReason, 'resource-pressure');
  assert.equal(shared.status, 'paused'); assert.equal(shared.telemetry.health.state, 'pressure'); assert.equal(shared.tick, 100);
  assert.equal(shared.telemetry.capacity.reason, 'measurement-incomplete');
  f.behaviour.pressure = 'within-budget';
  shared = (await f.service.control(shared.sharedId, envelope(shared, { action: 'start' }))).shared;
  f.behaviour.fail = true;
  shared = (await f.service.measure(shared.sharedId, envelope(shared, { barriers: 10 }))).shared;
  assert.equal(shared.telemetry.measurement.stopReason, 'worker-failure'); assert.equal(shared.status, 'paused');
  f.behaviour.fail = false;
  shared = (await f.service.control(shared.sharedId, envelope(shared, { action: 'start' }))).shared;
  shared = (await f.service.member(shared.sharedId, envelope(shared, { individualId: 'one', action: 'rest' }))).shared;
  await assert.rejects(f.service.measure(shared.sharedId, envelope(shared, { barriers: 10 })), /every shared research participant to be active/);
  await f.service.close();

  let clock = 0;
  const slow = mockShared({ now: () => (clock += 10), measurementDeadlineMs: 50 });
  const slowJoined = await slow.service.join({ protocolVersion: 1, members: slow.envelopes() });
  let slowShared = (await slow.service.control(slowJoined.shared.sharedId, envelope(slowJoined.shared, { action: 'start' }))).shared;
  slowShared = (await slow.service.measure(slowShared.sharedId, envelope(slowShared, { barriers: 1000 }))).shared;
  assert.equal(slowShared.telemetry.measurement.stopReason, 'deadline'); assert.equal(slowShared.status, 'paused');
  assert.ok(slowShared.telemetry.measurement.completedBarriers < 10);
  assert.match(slowShared.reason, /deadline/);
  await slow.service.close();
});

test('validated capacity requires matching pinned graphs, models, membership and runtime', async () => {
  const hashes = [ 'a'.repeat(64), 'b'.repeat(64) ];
  const pinned = { [datasets[0]]: { graphSha256: hashes[0] }, [datasets[1]]: { graphSha256: hashes[1] } };
  const f = mockShared({ graphSha: index => hashes[index], pinned: () => pinned });
  const joined = await f.service.join({ protocolVersion: 1, members: f.envelopes() });
  let shared = (await f.service.control(joined.shared.sharedId, envelope(joined.shared, { action: 'start' }))).shared;
  shared = (await f.service.measure(shared.sharedId, envelope(shared, { barriers: 100 }))).shared;
  const capacity = shared.telemetry.capacity.validatedConnectomeCapacity;
  assert.equal(shared.telemetry.capacity.reason, 'matching-measurement');
  assert.equal(capacity.residentCount, 2); assert.equal(capacity.completedBarriers, 100); assert.deepEqual(capacity.datasets, [...datasets].sort());
  assert.match(capacity.scope, /not an admission authorization/);
  const measurement = shared.telemetry.measurement, participants = shared.participants;
  const base = { measurement, participants, runtime: { node: 'v-test', platform: 'test', arch: 'test' }, pinned, modelIds: MODEL_IDS, substeps: 5, intervalMs: 5 };
  assert.ok(assessSharedCapacity(base).validatedConnectomeCapacity);
  const cases = [
    [{ runtime: { node: 'v0', platform: 'test', arch: 'test' } }, 'runtime-mismatch'],
    [{ measurement: { ...measurement, backend: 'synthetic-fixture' } }, 'measurement-malformed'],
    [{ measurement: { ...measurement, simulatedToWallRatio: Number.NaN } }, 'measurement-malformed'],
    [{ measurement: { ...measurement, wall: { ...measurement.wall, maxMs: Infinity } } }, 'measurement-malformed'],
    [{ measurement: { ...measurement, members: measurement.members.map(member => ({ ...member, completedSubsteps: 499 })) } }, 'measurement-malformed'],
    [{ measurement: { ...measurement, completedBarriers: 50, members: measurement.members.map(member => ({ ...member, completedSubsteps: 250 })) } }, 'insufficient-barriers'],
    [{ participants: [participants[0], { ...participants[1], mode: 'resting' }] }, 'membership-mismatch'],
    [{ participants: [participants[0]] }, 'membership-mismatch'],
    [{ participants: [participants[0], { ...participants[1], graphSha256: 'c'.repeat(64) }] }, 'membership-mismatch'],
    [{ pinned: { [datasets[0]]: pinned[datasets[0]] } }, 'not-pinned-full-graph'],
    [{ modelIds: { ...MODEL_IDS, [datasets[1]]: 'fixture-model' } }, 'not-pinned-full-graph'],
    [{ measurement: null }, 'no-measurement']
  ];
  for (const [change, reason] of cases) assert.deepEqual(assessSharedCapacity({ ...base, ...change }), { validatedConnectomeCapacity: null, reason });
  await f.service.close();
});

test('HTTP exposes bounded telemetry without private paths and an explicit measurement route', async t => {
  const h = await httpSetup(t), a = await h.create(datasets[0]), b = await h.create(datasets[1]);
  assert.equal((await h.load(a.individualId)).status, 200); assert.equal((await h.load(b.individualId)).status, 200);
  const states = await Promise.all([h.state(a.individualId), h.state(b.individualId)]);
  const joined = await (await h.post('/api/connectomes/shared/join', { protocolVersion: 1, members: states.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) })).json();
  const running = await (await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/control`, envelope(joined.shared, { action: 'start' }))).json();
  const read = async () => (await fetch(`${h.base}/api/connectomes/shared/${joined.shared.sharedId}`)).json();
  const first = await read(), second = await read();
  assert.equal(first.shared.commandSequence, running.shared.commandSequence); assert.deepEqual(second.shared.telemetry, first.shared.telemetry);
  assert.equal(first.shared.telemetry.capacity.validatedConnectomeCapacity, null);
  assert.equal(first.shared.telemetry.resources.aggregate.maxResidentFlies, 3);
  assert.deepEqual(first.shared.telemetry.resources.members.map(member => member.incrementalMemoryBytes), [1000, 1000]);
  assert.equal((await fetch(`${h.base}/api/connectomes/shared/${joined.shared.sharedId}/measure`)).status, 405);
  const measured = await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/measure`, envelope(running.shared, { barriers: 10 }));
  assert.equal(measured.status, 200); const result = await measured.json();
  assert.equal(result.shared.telemetry.measurement.status, 'complete'); assert.equal(result.shared.tick, 10);
  assert.equal(result.shared.telemetry.capacity.validatedConnectomeCapacity, null);
  assert.ok(['not-pinned-full-graph', 'insufficient-barriers'].includes(result.shared.telemetry.capacity.reason));
  assert.equal(result.shared.telemetry.history.length, 10);
  assert.ok(result.shared.telemetry.history.every(sample => sample.outcome === 'committed' && sample.substepValidation === 'exact'));
  const text = JSON.stringify(result);
  assert.equal(text.includes(tmpdir()), false); assert.equal(text.includes('/trusted/'), false);
  assert.deepEqual((await Promise.all([h.state(a.individualId), h.state(b.individualId)])).map(value => value.neural.tick), [50, 50]);
  assert.equal((await h.post(`/api/connectomes/shared/${joined.shared.sharedId}/measure`, envelope(result.shared, { barriers: 10, extra: true }))).status, 409);
});

test('client telemetry description is read-only and states capacity boundaries', () => {
  const telemetry = createBarrierTelemetry({ intervalMs: 5, substeps: 5 });
  telemetry.record({ outcome: 'committed', worldTick: 1, startedAt: 0, finishedAt: 7, memberIds: ['one', 'two'],
    timing: { queueWaitMs: 0, prepareMs: 2, commitMs: 3, members: [{ individualId: 'one', prepareMs: 2, commitMs: 3 }, { individualId: 'two', prepareMs: 1, commitMs: 1 }], completionOrder: { prepare: ['two', 'one'], commit: ['two', 'one'] } },
    observedSubsteps: { one: 5, two: 5 } });
  const summary = describeTelemetry({ ...telemetry.view(), health: { state: 'nominal', reasons: [] }, resources: { aggregate: null }, measurement: null,
    capacity: { validatedConnectomeCapacity: null, reason: 'no-measurement', configuredMaxResidents: 2 } });
  assert.match(summary.latest, /committed · world tick 1 · wall 7\.000 ms/);
  assert.match(summary.members[0], /one · prepare #2/);
  assert.match(summary.capacity, /unavailable: no explicit active-pair measurement/);
  assert.equal(summary.resources, 'Resource monitoring unavailable.');
  assert.equal(describeTelemetry(null), null);
  assert.deepEqual(measurementEnvelope({ sharedId: 's', worldEpoch: 'w', commandSequence: 4 }), { protocolVersion: 1, sharedId: 's', worldEpoch: 'w', sequence: 5, barriers: 100 });
});
