import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openIdentityStore } from './identity-store.js';
import { openConnectomeStore } from './connectome-store.js';
import { createSparseLif } from './sparse-lif.js';
import { openCrossCatalogJournal, createCrossCatalogCoordinator } from './cross-catalog-checkpoint.js';
import { createFixtureCrossCatalogAdapter, createConnectomeCrossCatalogAdapter } from './cross-catalog-adapters.js';

const graph = dataset => ({ ids: [1, 2, 3].map(id => `${dataset}/${id}`), offsets: new Uint32Array([0, 1, 2, 3]), targets: new Uint32Array([1, 2, 0]), contacts: new Uint32Array([1200, 1200, 1200]), signs: new Int8Array([1, 1, 1]) });
const datasets = ['male-cns:v1.0', 'banc:v888'];
const profiles = Object.fromEntries(datasets.map(dataset => [dataset, { directory: `/trusted/${dataset}`,
  manifestSha256: 'ab'.repeat(32), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256, neuronCount: 3, edgeCount: 3 }]));
const kernel = identity => createSparseLif(graph(identity.dataset), { individualId: identity.individualId, dataset: identity.dataset });

function directory(t, prefix) { const path = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

/** Worker hook double backed by store reads. The coordinator contract stays intact; only the hooks are doubles. */
function openWorker(store) {
  const residents = new Map();
  return {
    add(id, { checkpoint, lifecycle = 'paused' }) {
      residents.set(id, { checkpoint: structuredClone(checkpoint), lifecycle, sessionEpoch: randomUUID() });
    },
    setLifecycle(id, lifecycle) { residents.get(id).lifecycle = lifecycle; },
    sessionEpochOf: id => residents.get(id)?.sessionEpoch ?? null,
    describe(id) {
      const resident = residents.get(id);
      if (!resident) return { status: 'saved-unloaded', sessionEpoch: null };
      return { status: resident.lifecycle, sessionEpoch: resident.sessionEpoch };
    },
    peekCheckpoint(id) {
      const resident = residents.get(id);
      if (!resident || resident.lifecycle === 'saved-unloaded') throw new Error('Connectome worker unavailable');
      return structuredClone(resident.checkpoint);
    },
    async activatePaused(id, { checkpointId }) {
      const resident = residents.get(id);
      if (!resident) throw new Error('Connectome worker unavailable');
      const payload = store.readCheckpoint(id, checkpointId);
      resident.checkpoint = structuredClone(payload);
      resident.sessionEpoch = randomUUID(); resident.lifecycle = 'paused';
      return { checkpointId, sessionEpoch: resident.sessionEpoch, status: 'paused' };
    },
    async evict(id) { residents.delete(id); },
  };
}

function world(t) {
  const root = directory(t, 'cross-catalog-adapters-');
  const fixture = openIdentityStore(join(root, 'fixture'));
  const primary = fixture.primaryId, second = fixture.create().individualId;
  fixture.load(second);
  fixture.control(second, 'rest');
  const store = openConnectomeStore(join(root, 'connectomes'), { profiles });
  const worker = openWorker(store);
  const male = store.create(datasets[0]), banc = store.create(datasets[1]);
  for (const identity of [male, banc]) {
    const live = kernel(identity); live.seedProbe([0]); live.step();
    const head = store.identities().find(record => record.individualId === identity.individualId).checkpointId;
    store.persistCheckpoint({ individualId: identity.individualId, dataset: identity.dataset, parentId: head, checkpoint: live.checkpoint(), operation: 'save' });
    const saved = store.identities().find(record => record.individualId === identity.individualId);
    worker.add(identity.individualId, { checkpoint: store.readCheckpoint(identity.individualId, saved.checkpointId) });
  }
  worker.setLifecycle(banc.individualId, 'resting');
  t.after(() => { try { fixture.close(); } catch {} try { store.close(); } catch {} });
  const fixtureAdapter = createFixtureCrossCatalogAdapter(fixture, { catalogId: 'fixture' });
  const maleAdapter = createConnectomeCrossCatalogAdapter({ store, worker, catalogId: 'connectome:male', dataset: datasets[0] });
  const bancAdapter = createConnectomeCrossCatalogAdapter({ store, worker, catalogId: 'connectome:banc', dataset: datasets[1] });
  const commitOrder = [];
  for (const adapter of [fixtureAdapter, maleAdapter, bancAdapter]) {
    const commit = adapter.commit.bind(adapter);
    adapter.commit = async request => { commitOrder.push(adapter.catalogId); return commit(request); };
  }
  const journal = openCrossCatalogJournal(join(root, 'journal'));
  t.after(() => { try { journal.close(); } catch {} });
  const coordinator = createCrossCatalogCoordinator({ journal, catalogs: [maleAdapter, fixtureAdapter, bancAdapter] });
  const members = [
    { individualId: primary, catalogId: 'fixture' },
    { individualId: second, catalogId: 'fixture' },
    { individualId: male.individualId, catalogId: 'connectome:male' },
    { individualId: banc.individualId, catalogId: 'connectome:banc' },
  ];
  const heads = () => Object.fromEntries([
    ...fixture.list().map(record => [record.individualId, record.checkpointId]),
    ...store.identities().map(record => [record.individualId, record.checkpointId]),
  ]);
  const contents = () => Object.fromEntries([
    ...fixture.list().flatMap(record => fixture.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
    ...store.identities().flatMap(record => store.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
  ]);
  return { root, fixture, primary, second, store, worker, male: male.individualId, banc: banc.individualId,
    fixtureAdapter, maleAdapter, bancAdapter, commitOrder, journal, coordinator, members, heads, contents };
}

test('a mixed real-store save and restore commits in fixed order with fresh paused epochs', async t => {
  const w = world(t);
  const prior = w.heads();
  const joint = await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 7, members: w.members });
  assert.equal(joint.payload.kind, 'cross-catalog-joint');
  assert.equal(joint.payload.members.length, 4);
  assert.match(joint.disclosure, /not embodied, sensory, learned or biological/);
  assert.deepEqual(w.commitOrder, ['fixture', 'connectome:banc', 'connectome:male']);
  assert.equal(joint.payload.members.find(member => member.individualId === w.second).mode, 'resting');
  assert.equal(joint.payload.members.find(member => member.individualId === w.banc).mode, 'resting');
  for (const id of Object.values(prior)) assert.ok(typeof id === 'string');
  const saved = w.heads();
  for (const member of joint.payload.members) assert.notEqual(saved[member.individualId], prior[member.individualId]);
  assert.equal(w.fixture.snapshot(w.second).status, 'resting');
  assert.equal(w.coordinator.reserved(w.male), false);

  await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 8, members: w.members });
  const epochs = { [w.primary]: w.fixture.snapshot(w.primary).sessionId, [w.second]: w.fixture.snapshot(w.second).sessionId,
    [w.male]: w.worker.sessionEpochOf(w.male), [w.banc]: w.worker.sessionEpochOf(w.banc) };
  const restored = await w.coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members });
  assert.equal(restored.status, 'paused');
  const contents = w.contents();
  for (const member of joint.payload.members) assert.equal(contents[member.individualId], member.checkpointSha256);
  for (const member of restored.members) assert.notEqual(member.sessionEpoch, epochs[member.individualId]);
  assert.equal(restored.members.find(member => member.individualId === w.second).mode, 'resting');
  assert.equal(w.journal.document().jointCheckpoints.length, 2);
  assert.equal(w.journal.document().transactions.at(-1).state, 'committed');
});

test('running, saved-unloaded, unknown and duplicate memberships are refused before any store changes', async t => {
  const w = world(t);
  const prior = w.heads(), priorContents = w.contents();
  w.fixture.control(w.primary, 'start');
  await assert.rejects(w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 1, members: w.members }), /explicitly paused/);
  w.fixture.control(w.primary, 'pause');
  w.fixture.evictCrossCatalogResident(w.second);
  await assert.rejects(w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 1, members: w.members }), /explicitly paused/);
  w.fixture.load(w.second);
  const body = members => ({ protocolVersion: 1, intervalMs: 5, tick: 1, members });
  await assert.rejects(w.coordinator.save(body([w.members[0], { individualId: randomUUID(), catalogId: 'connectome:male' }])), /unavailable or its catalog view is malformed/);
  await assert.rejects(w.coordinator.save(body([w.members[0], w.members[0]])), /distinct/);
  await assert.rejects(w.coordinator.save(body([w.members[0], { ...w.members[2], catalogId: 'connectome:banc' }])), /unavailable or its catalog view is malformed/);
  assert.deepEqual(w.heads(), prior);
  assert.deepEqual(w.contents(), priorContents);
  assert.equal(w.journal.document().transactions.length, 0);
});

test('a mid-transaction head change aborts with only transaction-owned staging cancelled', async t => {
  const w = world(t);
  const joint = await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 1, members: w.members });
  assert.equal(w.journal.document().transactions.length, 1);
  // Until reserved() is wired into the service (remaining work), an unserialized
  // writer can still move a head mid-transaction; the coordinator must abort.
  const peek = w.worker.peekCheckpoint.bind(w.worker);
  w.worker.peekCheckpoint = id => {
    if (id === w.male) w.fixture.save(w.primary);
    return peek(id);
  };
  const before = w.heads();
  await assert.rejects(w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 2, members: w.members }), /changed during the transaction/);
  w.worker.peekCheckpoint = peek;
  assert.equal(w.journal.document().transactions.at(-1).state, 'aborted');
  assert.equal(w.coordinator.status().recovery, null);
  // The outside write is preserved; every catalog-local head is otherwise unchanged.
  assert.notEqual(w.heads()[w.primary], before[w.primary]);
  assert.equal(w.heads()[w.second], before[w.second]);
  assert.equal(w.heads()[w.male], before[w.male]);
  assert.equal(w.heads()[w.banc], before[w.banc]);
  await w.maleAdapter.cancel({ transactionId: randomUUID() });
  assert.equal(joint.payload.members.length, 4);
});

test('a commit failure rolls every catalog back to its prior content', async t => {
  const w = world(t);
  const priorContents = w.contents(), priorHeads = w.heads();
  let calls = 0;
  w.fixture.close();
  const failing = openIdentityStore(join(w.root, 'fixture'), { write: (path, text) => {
    calls++;
    if (calls === 2) throw new Error('disk full');
    writeFileSync(path, text);
  } });
  failing.load(w.second);
  const liveHeads = store => Object.fromEntries([
    ...store.list().map(record => [record.individualId, record.checkpointId]),
    ...w.store.identities().map(record => [record.individualId, record.checkpointId]),
  ]);
  const liveContents = store => Object.fromEntries([
    ...store.list().flatMap(record => store.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
    ...w.store.identities().flatMap(record => w.store.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
  ]);
  const fixtureAdapter = createFixtureCrossCatalogAdapter(failing, { catalogId: 'fixture' });
  const journal = w.journal;
  const coordinator = createCrossCatalogCoordinator({ journal, catalogs: [fixtureAdapter, w.maleAdapter, w.bancAdapter] });
  await assert.rejects(coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 3, members: w.members }),
    error => error.code === 'CROSS_CATALOG_ROLLED_BACK' && error.affectedHeads.length === 4);
  assert.deepEqual(liveContents(failing), priorContents);
  assert.deepEqual(liveHeads(failing), priorHeads);
  assert.equal(journal.document().transactions.at(-1).state, 'rolled-back');
  assert.equal(journal.document().jointCheckpoints.length, 0);
  failing.close();
  const reopened = openIdentityStore(join(w.root, 'fixture'));
  reopened.load(w.second);
  t.after(() => reopened.close());
  const recovered = createCrossCatalogCoordinator({ journal,
    catalogs: [createFixtureCrossCatalogAdapter(reopened, { catalogId: 'fixture' }), w.maleAdapter, w.bancAdapter] });
  const joint = await recovered.save({ protocolVersion: 1, intervalMs: 5, tick: 4, members: w.members });
  assert.equal(joint.payload.members.length, 4);
});

test('post-rename uncertainty fails closed and operator rollback restores prior content', async t => {
  const w = world(t);
  const priorContents = w.contents();
  let sabotage = true;
  const commit = w.store.commitCrossCatalog.bind(w.store);
  w.store.commitCrossCatalog = (...args) => {
    const result = commit(...args);
    if (!sabotage) return result;
    sabotage = false;
    throw Object.assign(new Error('post-rename fsync lost'),
      { code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedHeads: Object.fromEntries(result.members.map(member => [member.individualId, member.checkpointId])) });
  };
  const error = await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 5, members: w.members }).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  const heads = Object.fromEntries(error.recovery.affectedHeads.map(value => [value.individualId, value]));
  // Fixed commit order is fixture, then connectome:banc, then connectome:male,
  // so the sabotaged post-rename failure lands on the BANC namespace: fixture
  // and BANC selected their planned heads while male never committed.
  assert.equal(heads[w.primary].selectedHead, heads[w.primary].plannedHead);
  assert.equal(heads[w.banc].selectedHead, heads[w.banc].plannedHead);
  assert.equal(heads[w.male].selectedHead, heads[w.male].priorHead);
  assert.equal(w.coordinator.reserved(w.male), true);
  await assert.rejects(w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 6, members: w.members }), /recovery is required/);
  const result = await w.coordinator.recover({ protocolVersion: 1, transactionId: error.recovery.transactionId, action: 'rollback' });
  assert.equal(result.state, 'rolled-back');
  assert.deepEqual(w.contents(), priorContents);
  assert.equal(w.coordinator.reserved(w.male), false);
  await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 6, members: w.members });
});

test('a crashed transaction survives close and reopen, then rolls back explicitly', async t => {
  const w = world(t);
  let sabotage = true;
  const commit = w.store.commitCrossCatalog.bind(w.store);
  w.store.commitCrossCatalog = (...args) => {
    const result = commit(...args);
    if (!sabotage) return result;
    sabotage = false;
    throw Object.assign(new Error('post-rename fsync lost'),
      { code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedHeads: Object.fromEntries(result.members.map(member => [member.individualId, member.checkpointId])) });
  };
  const error = await w.coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 9, members: w.members }).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  const transactionId = error.recovery.transactionId;
  const priorContents = w.contents();
  w.journal.close(); w.fixture.close(); w.store.close();
  const fixture = openIdentityStore(join(w.root, 'fixture'));
  const store = openConnectomeStore(join(w.root, 'connectomes'), { profiles });
  t.after(() => { try { fixture.close(); } catch {} try { store.close(); } catch {} });
  const worker = openWorker(store);
  for (const identity of store.identities()) {
    worker.add(identity.individualId, { checkpoint: store.readCheckpoint(identity.individualId, identity.checkpointId) });
  }
  const journal = openCrossCatalogJournal(join(w.root, 'journal'));
  t.after(() => { try { journal.close(); } catch {} });
  const coordinator = createCrossCatalogCoordinator({ journal, catalogs: [
    createFixtureCrossCatalogAdapter(fixture, { catalogId: 'fixture' }),
    createConnectomeCrossCatalogAdapter({ store, worker, catalogId: 'connectome:male', dataset: datasets[0] }),
    createConnectomeCrossCatalogAdapter({ store, worker, catalogId: 'connectome:banc', dataset: datasets[1] }),
  ] });
  const pending = coordinator.status().recovery;
  assert.equal(pending.transactionId, transactionId);
  // Connectome staging manifests are reclaimed on store open, so the stranded
  // staging cancels cleanly and the rollback reselects prior content.
  const result = await coordinator.recover({ protocolVersion: 1, transactionId, action: 'rollback' });
  assert.equal(result.state, 'rolled-back');
  assert.deepEqual(Object.fromEntries([
    ...fixture.list().flatMap(record => fixture.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
    ...store.identities().flatMap(record => store.checkpoints(record.individualId)
      .filter(item => item.checkpointId === record.checkpointId).map(item => [record.individualId, item.sha256])),
  ]), priorContents);
  assert.equal(coordinator.status().recovery, null);
  const joint = await coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 10, members: w.members });
  assert.equal(joint.payload.members.length, 4);
});

test('one real fixture catalog coordinates with a contract-conforming double', async t => {
  const w = world(t);
  const contract = (await import('./cross-catalog-checkpoint.js')).CROSS_CATALOG_CONTRACT_VERSION;
  const ids = { a: randomUUID(), b: randomUUID() };
  const hash = value => createHash('sha256').update(String(value)).digest('hex');
  const state = { heads: { [ids.a]: randomUUID(), [ids.b]: randomUUID() }, epoch: randomUUID(), staged: new Map() };
  const double = {
    contractVersion: contract, catalogType: 'full-connectome', catalogId: 'connectome:doubles',
    epoch: () => state.epoch,
    member: id => state.heads[id] ? { individualId: id, catalogType: 'full-connectome', head: state.heads[id],
      dataset: 'male-cns:v1.0', graphSha256: hash('g'), modelId: 'm', status: 'paused', mode: 'active',
      sessionEpoch: 'epoch', simTimeMs: 0 } : null,
    reserve: ids => { const release = () => {}; return release; },
    preflight: async () => {},
    stage: async ({ transactionId, members }) => {
      const planned = members.map(member => ({ individualId: member.individualId, parentId: member.parentId,
        checkpointId: randomUUID(), sourceCheckpointId: member.sourceCheckpointId, checkpointSha256: hash(member.individualId), simTimeMs: 0 }));
      state.staged.set(transactionId, planned);
      return planned;
    },
    commit: async ({ transactionId }) => {
      const planned = state.staged.get(transactionId);
      for (const value of planned) state.heads[value.individualId] = value.checkpointId;
      state.staged.delete(transactionId);
      return { heads: Object.fromEntries(planned.map(value => [value.individualId, value.checkpointId])) };
    },
    cancel: async ({ transactionId }) => { state.staged.delete(transactionId); },
    revert: async ({ heads }) => { for (const [id, prior] of Object.entries(heads)) state.heads[id] = prior; return { heads: { ...heads } }; },
    activate: async ({ members }) => members.map(member => ({ individualId: member.individualId,
      checkpointId: state.heads[member.individualId], sessionEpoch: randomUUID(), status: 'paused' })),
    evict: async () => {},
  };
  const coordinator = createCrossCatalogCoordinator({ journal: w.journal,
    catalogs: [w.fixtureAdapter, double] });
  const members = [{ individualId: w.primary, catalogId: 'fixture' }, { individualId: w.second, catalogId: 'fixture' },
    { individualId: ids.a, catalogId: 'connectome:doubles' }, { individualId: ids.b, catalogId: 'connectome:doubles' }];
  const joint = await coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 11, members });
  assert.equal(joint.payload.members.length, 4);
  const restored = await coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members });
  assert.equal(restored.status, 'paused');
});

test('adapter and staging boundaries fail closed without touching durable heads', async t => {
  const w = world(t);
  const prior = w.heads();
  assert.throws(() => createFixtureCrossCatalogAdapter({}, { catalogId: 'fixture' }), /Invalid fixture identity store/);
  assert.throws(() => createFixtureCrossCatalogAdapter(w.fixture, { catalogId: 'Bad!' }), /namespace/);
  assert.throws(() => createConnectomeCrossCatalogAdapter({ store: w.store, worker: {}, catalogId: 'connectome:male' }), /Invalid connectome worker/);
  await assert.rejects(w.fixtureAdapter.commit({ transactionId: randomUUID() }), /Unknown/);
  assert.equal(await w.fixtureAdapter.cancel({ transactionId: randomUUID() }), true);
  await assert.rejects(w.fixtureAdapter.revert({ transactionId: randomUUID(), heads: { [w.primary]: null } }), /no prior head/);
  assert.deepEqual(w.heads(), prior);
  const tampered = join(w.root, 'tampered');
  writeFileSync(tampered, 'keep');
  assert.equal(existsSync(tampered), true);
  const staging = join(w.root, 'connectomes', 'staging');
  assert.ok(!existsSync(staging) || readdirSync(staging).length === 0);
});
