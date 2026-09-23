import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openCrossCatalogJournal, createCrossCatalogCoordinator, CROSS_CATALOG_CONTRACT_VERSION } from './cross-catalog-checkpoint.js';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const GRAPH = { 'male-cns:v1.0': hash('male-graph'), 'banc:v888': hash('banc-graph') };
function directory(t, prefix = 'cross-catalog-') { const path = mkdtempSync(join(tmpdir(), prefix)); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

/**
 * Durable contract-conforming catalog double. State lives in one JSON file so reopen can be simulated.
 * It models the two real catalog families: fixture revert reselects the prior checkpoint, full-connectome revert
 * appends a restore lineage entry with the prior payload. It has no start method: nothing here can run a simulation.
 */
function openCatalog(path, { catalogType, catalogId, members = [] } = {}) {
  const file = join(path, `${catalogId.replace(/[^a-z0-9]/g, '_')}.json`);
  let state;
  if (existsSync(file)) state = JSON.parse(readFileSync(file, 'utf8'));
  else {
    state = { members: {}, payloads: {}, staged: {}, reverts: {} };
    for (const member of members) {
      const head = member.head === undefined ? randomUUID() : member.head;
      if (head) state.payloads[head] = { sha: hash(`${member.individualId}:${head}`), simTimeMs: member.simTimeMs ?? 0 };
      state.members[member.individualId] = { head, history: head ? [head] : [], dataset: member.dataset ?? (catalogType === 'fixture-identity' ? 'synthetic-fixture:v1' : 'male-cns:v1.0'),
        graphSha256: catalogType === 'fixture-identity' ? null : GRAPH[member.dataset ?? 'male-cns:v1.0'], modelId: catalogType === 'fixture-identity' ? null : 'malecns-traced-lif-v1',
        status: member.status ?? 'paused', mode: member.mode ?? 'active', sessionEpoch: randomUUID(), simTimeMs: member.simTimeMs ?? 0 };
    }
  }
  const save = () => writeFileSync(file, JSON.stringify(state));
  save();
  const epoch = randomUUID(), reservations = new Set(), calls = [], faults = {};
  const trip = name => { calls.push(name); const fault = faults[name]; if (fault) { delete faults[name]; throw typeof fault === 'function' ? fault() : new Error(`${name} fault`); } };
  const adapter = {
    contractVersion: CROSS_CATALOG_CONTRACT_VERSION, catalogType, catalogId,
    epoch: () => adapter.epochOverride ?? epoch,
    member: id => { const value = state.members[id]; return value ? { individualId: id, catalogType, head: value.head, dataset: value.dataset, graphSha256: value.graphSha256,
      modelId: value.modelId, status: value.status, mode: value.mode, sessionEpoch: value.sessionEpoch, simTimeMs: value.simTimeMs } : null; },
    reserve: ids => { trip('reserve'); if (ids.some(id => reservations.has(id))) throw new Error('reserved'); ids.forEach(id => reservations.add(id)); return () => ids.forEach(id => reservations.delete(id)); },
    preflight: ({ members }) => {
      trip('preflight');
      for (const member of members) {
        const value = state.members[member.individualId];
        if (!value || value.head !== member.parentId) throw new Error('stale parent');
        if (member.sourceCheckpointId && (!value.history.includes(member.sourceCheckpointId) || state.payloads[member.sourceCheckpointId].sha !== member.checkpointSha256)) throw new Error('lineage');
      }
    },
    stage: ({ transactionId, operation, members }) => {
      trip('stage');
      const planned = members.map(member => {
        const checkpointId = randomUUID(), source = member.sourceCheckpointId ? state.payloads[member.sourceCheckpointId] : null;
        const payload = source ? { ...source } : { sha: hash(`${member.individualId}:${checkpointId}`), simTimeMs: state.members[member.individualId].simTimeMs };
        return { individualId: member.individualId, parentId: member.parentId, checkpointId, sourceCheckpointId: member.sourceCheckpointId, checkpointSha256: payload.sha, simTimeMs: payload.simTimeMs, payload, operation };
      });
      state.staged[transactionId] = planned; save();
      return adapter.stageOverride ? adapter.stageOverride(planned) : planned.map(({ payload, operation: _, ...value }) => value);
    },
    commit: ({ transactionId }) => {
      trip('commit');
      const planned = state.staged[transactionId];
      for (const value of planned) { const member = state.members[value.individualId]; state.payloads[value.checkpointId] = value.payload; member.history.push(value.checkpointId); member.head = value.checkpointId; }
      delete state.staged[transactionId]; save();
      if (faults.commitUncertain) { delete faults.commitUncertain; throw Object.assign(new Error('fsync'), { code: 'CATALOG_DURABILITY_UNCERTAIN', selectedHeads: Object.fromEntries(planned.map(value => [value.individualId, value.checkpointId])) }); }
      return { heads: Object.fromEntries(planned.map(value => [value.individualId, value.checkpointId])) };
    },
    cancel: ({ transactionId }) => { trip('cancel'); delete state.staged[transactionId]; save(); },
    revert: ({ transactionId, heads }) => {
      trip('revert');
      if (state.reverts[transactionId]) return { heads: { ...state.reverts[transactionId] } };
      const result = {};
      for (const [id, prior] of Object.entries(heads)) {
        const member = state.members[id];
        if (catalogType === 'fixture-identity') member.head = prior;
        else { const restored = randomUUID(); state.payloads[restored] = { ...state.payloads[prior] }; member.history.push(restored); member.head = restored; }
        result[id] = member.head;
      }
      state.reverts[transactionId] = result; save(); return { heads: { ...result } };
    },
    activate: ({ members }) => {
      trip('activate');
      return members.map(member => { const value = state.members[member.individualId]; value.sessionEpoch = randomUUID(); value.status = 'paused'; value.mode = member.mode; value.simTimeMs = state.payloads[member.checkpointId].simTimeMs; save();
        return { individualId: member.individualId, checkpointId: value.head, sessionEpoch: value.sessionEpoch, status: 'paused' }; });
    },
    evict: ({ ids }) => { trip('evict'); for (const id of ids) state.members[id].status = 'saved-unloaded'; save(); },
    // Test-only integration probes.
    lifecycle: id => { if (reservations.has(id)) throw new Error('reserved by coordinator'); return 'ok'; },
    calls, faults, state: () => state, contentOf: id => state.payloads[state.members[id].head]?.sha ?? null,
  };
  return adapter;
}

function world(t, options = {}) {
  const path = directory(t);
  const ids = { fixtureA: randomUUID(), fixtureB: randomUUID(), male: randomUUID(), banc: randomUUID() };
  const fixture = openCatalog(path, { catalogType: 'fixture-identity', catalogId: 'fixture', members: [{ individualId: ids.fixtureA, simTimeMs: 10 }, { individualId: ids.fixtureB, simTimeMs: 20, mode: options.restingFixture ? 'resting' : 'active' }] });
  const maleCatalog = openCatalog(path, { catalogType: 'full-connectome', catalogId: 'connectome:male', members: [{ individualId: ids.male, dataset: 'male-cns:v1.0', simTimeMs: 5 }] });
  const bancCatalog = openCatalog(path, { catalogType: 'full-connectome', catalogId: 'connectome:banc', members: [{ individualId: ids.banc, dataset: 'banc:v888', simTimeMs: 15 }] });
  const commitLog = [];
  for (const catalog of [fixture, maleCatalog, bancCatalog]) { const commit = catalog.commit; catalog.commit = request => { commitLog.push(catalog.catalogId); return commit(request); }; }
  const journalPath = join(path, 'journal');
  const open = (journalOptions = {}) => {
    const journal = openCrossCatalogJournal(journalPath, journalOptions); t.after(() => journal.close());
    return { journal, coordinator: createCrossCatalogCoordinator({ journal, catalogs: [bancCatalog, fixture, maleCatalog] }) };
  };
  const members = () => [{ individualId: ids.fixtureA, catalogId: 'fixture' }, { individualId: ids.male, catalogId: 'connectome:male' },
    { individualId: ids.banc, catalogId: 'connectome:banc' }, { individualId: ids.fixtureB, catalogId: 'fixture' }];
  const saveBody = () => ({ protocolVersion: 1, intervalMs: 5, tick: 7, members: members() });
  const heads = () => Object.fromEntries([[ids.fixtureA, fixture], [ids.fixtureB, fixture], [ids.male, maleCatalog], [ids.banc, bancCatalog]].map(([id, catalog]) => [id, catalog.member(id).head]));
  const contents = () => Object.fromEntries([[ids.fixtureA, fixture], [ids.fixtureB, fixture], [ids.male, maleCatalog], [ids.banc, bancCatalog]].map(([id, catalog]) => [id, catalog.contentOf(id)]));
  return { commitLog, path, ids, fixture, maleCatalog, bancCatalog, open, members, saveBody, heads, contents, journalPath };
}

test('a mixed fixture and multi-catalog full-connectome save and restore commit in fixed order with fresh paused epochs', async t => {
  const w = world(t, { restingFixture: true });
  const { coordinator, journal } = w.open();
  const prior = w.heads();
  const joint = await coordinator.save(w.saveBody());
  assert.equal(joint.payload.kind, 'cross-catalog-joint');
  assert.equal(joint.payload.tick, 7);
  assert.deepEqual(joint.payload.members.map(member => member.catalogId), ['fixture', 'connectome:male', 'connectome:banc', 'fixture']);
  assert.equal(joint.payload.members.find(member => member.individualId === w.ids.fixtureB).mode, 'resting');
  assert.equal(joint.payload.members.find(member => member.individualId === w.ids.banc).graphSha256, GRAPH['banc:v888']);
  assert.match(joint.disclosure, /not embodied, sensory, learned or biological/);
  const saved = w.heads();
  for (const id of Object.values(w.ids)) assert.notEqual(saved[id], prior[id]);
  // Commits follow catalog type then namespace, never adapter or request order.
  assert.deepEqual(w.commitLog, ['fixture', 'connectome:banc', 'connectome:male']);
  const document = journal.document();
  assert.equal(document.jointCheckpoints.length, 1);
  assert.equal(document.transactions.at(-1).state, 'committed');
  assert.deepEqual(document.transactions.at(-1).catalogs.map(catalog => catalog.catalogId), ['fixture', 'connectome:banc', 'connectome:male']);
  assert.equal(coordinator.reserved(w.ids.male), false);

  // Advance heads independently, then restore the complete saved membership.
  await coordinator.save(w.saveBody());
  const epochs = Object.fromEntries(Object.values(w.ids).map(id => [id, [w.fixture, w.maleCatalog, w.bancCatalog].find(catalog => catalog.member(id)).member(id).sessionEpoch]));
  const restored = await coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() });
  assert.equal(restored.status, 'paused');
  const contents = w.contents();
  for (const member of joint.payload.members) assert.equal(contents[member.individualId], member.checkpointSha256);
  for (const member of restored.members) { assert.notEqual(member.sessionEpoch, epochs[member.individualId]); }
  assert.equal(restored.members.find(member => member.individualId === w.ids.fixtureB).mode, 'resting');
  // Restore appends lineage; it never rewrites the saved joint history.
  assert.equal(journal.document().jointCheckpoints.length, 2);
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(Object.keys(catalog.state().staged).length, 0);
  journal.close();
  const reopened = w.open();
  assert.equal(reopened.coordinator.status().recovery, null);
  assert.equal(reopened.coordinator.jointCheckpoints()[0].jointCheckpointId, joint.jointCheckpointId);
});

test('an all-resting restored membership reports resting and nothing starts', async t => {
  const path = directory(t), a = randomUUID(), b = randomUUID();
  const fixture = openCatalog(path, { catalogType: 'fixture-identity', catalogId: 'fixture', members: [{ individualId: a, mode: 'resting' }] });
  const connectome = openCatalog(path, { catalogType: 'full-connectome', catalogId: 'connectome:male', members: [{ individualId: b, mode: 'resting' }] });
  const journal = openCrossCatalogJournal(join(path, 'journal')); t.after(() => journal.close());
  const coordinator = createCrossCatalogCoordinator({ journal, catalogs: [fixture, connectome] });
  const members = [{ individualId: a, catalogId: 'fixture' }, { individualId: b, catalogId: 'connectome:male' }];
  const joint = await coordinator.save({ protocolVersion: 1, intervalMs: 5, tick: 0, members });
  const restored = await coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members });
  assert.equal(restored.status, 'resting');
  assert.ok(restored.members.every(member => member.mode === 'resting'));
  assert.equal(fixture.member(a).status, 'paused');
  assert.equal(connectome.member(b).status, 'paused');
});

test('stale, extra, duplicate, cross-namespace and unpaused memberships are refused before any catalog changes', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  const prior = w.heads();
  const body = members => ({ protocolVersion: 1, intervalMs: 5, tick: 1, members });
  const refusals = [
    body([{ individualId: w.ids.fixtureA, catalogId: 'fixture' }]),
    body([...w.members(), { individualId: w.ids.fixtureA, catalogId: 'fixture' }]),
    body([{ individualId: w.ids.fixtureA, catalogId: 'fixture' }, { individualId: w.ids.male, catalogId: 'fixture' }]),
    body([{ individualId: w.ids.fixtureA, catalogId: 'fixture' }, { individualId: randomUUID(), catalogId: 'connectome:male' }]),
    body([{ individualId: w.ids.fixtureA, catalogId: 'fixture' }, { individualId: w.ids.male, catalogId: 'connectome:other' }]),
    body([{ individualId: w.ids.fixtureA, catalogId: 'fixture', extra: true }, { individualId: w.ids.male, catalogId: 'connectome:male' }]),
    { ...body(w.members()), intervalMs: 1 },
    { ...body(w.members()), protocolVersion: 2 },
  ];
  for (const request of refusals) await assert.rejects(coordinator.save(request));
  // The same stable ID in two catalog namespaces is ambiguous, never merged.
  w.bancCatalog.state().members[w.ids.fixtureA] = { ...w.bancCatalog.state().members[w.ids.banc] };
  await assert.rejects(coordinator.save(body(w.members())), /more than one catalog namespace/);
  delete w.bancCatalog.state().members[w.ids.fixtureA];
  // Withdrawn or running members cannot be saved.
  w.maleCatalog.state().members[w.ids.male].status = 'running';
  await assert.rejects(coordinator.save(body(w.members())), /explicitly paused/);
  w.maleCatalog.state().members[w.ids.male].status = 'paused';
  assert.deepEqual(w.heads(), prior);
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(catalog.calls.includes('stage'), false);
  assert.equal(journal.document().transactions.length, 0);

  const joint = await coordinator.save(body(w.members()));
  const restore = members => coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members });
  await assert.rejects(restore(w.members().slice(0, 3)), /complete saved membership/);
  await assert.rejects(restore(w.members().map(member => member.individualId === w.ids.male ? { ...member, catalogId: 'connectome:banc' } : member)), /complete saved membership/);
  await assert.rejects(coordinator.restore({ protocolVersion: 1, jointCheckpointId: randomUUID(), members: w.members() }), /not found/);
  w.bancCatalog.state().members[w.ids.banc].graphSha256 = GRAPH['male-cns:v1.0'];
  await assert.rejects(restore(w.members()), /namespace disagrees/);
});

test('catalog disagreement and a changed catalog epoch abort with only transaction-owned staging cancelled', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  const joint = await coordinator.save(w.saveBody());
  const before = w.heads();
  // A restore stage that reports a payload hash different from the saved checkpoint is refused before any journal record.
  w.maleCatalog.stageOverride = planned => planned.map(({ payload, operation, ...value }) => ({ ...value, checkpointSha256: hash('other') }));
  await assert.rejects(coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() }), /disagrees/);
  delete w.maleCatalog.stageOverride;
  assert.deepEqual(w.heads(), before);
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(Object.keys(catalog.state().staged).length, 0);
  assert.equal(journal.document().transactions.length, 1);

  // An epoch that changes after staging (for example, a catalog reopen) aborts the journaled transaction.
  const original = w.bancCatalog.stage;
  w.bancCatalog.stage = request => { const value = original(request); w.bancCatalog.epochOverride = randomUUID(); return value; };
  await assert.rejects(coordinator.save(w.saveBody()), /epoch changed/);
  w.bancCatalog.stage = original; delete w.bancCatalog.epochOverride;
  assert.deepEqual(w.heads(), before);
  assert.equal(journal.document().transactions.at(-1).state, 'aborted');
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(Object.keys(catalog.state().staged).length, 0);
  assert.equal(coordinator.status().recovery, null);
});

test('a refused later commit compensates every committed catalog to its prior content', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  const prior = w.contents();
  w.maleCatalog.faults.commit = () => new Error('male catalog write refused');
  await assert.rejects(coordinator.save(w.saveBody()), error => error.code === 'CROSS_CATALOG_ROLLED_BACK' && error.affectedHeads.length === 4);
  assert.deepEqual(w.contents(), prior);
  const record = journal.document().transactions.at(-1);
  assert.equal(record.state, 'rolled-back');
  assert.deepEqual(record.catalogs.map(catalog => [catalog.catalogId, catalog.state]), [['fixture', 'reverted'], ['connectome:banc', 'reverted'], ['connectome:male', 'cancelled']]);
  assert.equal(journal.document().jointCheckpoints.length, 0);
  // Compensation appended restore lineage in full-connectome catalogs; history was not deleted.
  assert.equal(w.bancCatalog.state().members[w.ids.banc].history.length, 3);
  assert.equal(w.maleCatalog.state().members[w.ids.male].history.length, 1);
  assert.equal(coordinator.status().recovery, null);
  await coordinator.save(w.saveBody());
});

test('post-rename uncertainty reports the complete affected-head set, fails closed and recovers explicitly', async t => {
  const w = world(t);
  const { coordinator } = w.open();
  const prior = w.heads(), priorContents = w.contents();
  w.bancCatalog.faults.commitUncertain = true;
  const error = await coordinator.save(w.saveBody()).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  const heads = Object.fromEntries(error.recovery.affectedHeads.map(value => [value.individualId, value]));
  assert.equal(heads[w.ids.banc].selectedHead, heads[w.ids.banc].plannedHead);
  assert.equal(heads[w.ids.fixtureA].selectedHead, heads[w.ids.fixtureA].plannedHead);
  assert.equal(heads[w.ids.male].selectedHead, prior[w.ids.male]);
  assert.equal(heads[w.ids.male].priorHead, prior[w.ids.male]);
  assert.equal(Object.keys(w.maleCatalog.state().staged).length, 0, 'uncommitted connectome staging is cancelled');
  assert.equal(w.maleCatalog.calls.includes('commit'), false);
  assert.equal(coordinator.reserved(w.ids.fixtureA), true);
  await assert.rejects(coordinator.save(w.saveBody()), /recovery is required/);
  await assert.rejects(coordinator.recover({ protocolVersion: 1, transactionId: error.recovery.transactionId, action: 'complete' }), /planned head/);
  await assert.rejects(coordinator.recover({ protocolVersion: 1, transactionId: randomUUID(), action: 'rollback' }), /stale/);
  const result = await coordinator.recover({ protocolVersion: 1, transactionId: error.recovery.transactionId, action: 'rollback' });
  assert.equal(result.state, 'rolled-back');
  assert.deepEqual(w.contents(), priorContents);
  assert.equal(coordinator.reserved(w.ids.fixtureA), false);
  await coordinator.save(w.saveBody());
});

test('a journal write failure after a catalog commit survives restart and requires verified operator recovery', async t => {
  const w = world(t);
  let writes = 0, failAt = Infinity;
  const writeDocument = (path, bytes) => { writes++; if (writes === failAt) throw new Error('disk full'); writeFileSync(path, bytes); };
  const first = w.open({ writeDocument });
  // Writes: staged, committing, then one per committed catalog. Fail the record written after the first catalog commit.
  failAt = writes + 3;
  await assert.rejects(first.coordinator.save(w.saveBody()), /disk full/);
  assert.equal(first.coordinator.status().recovery.state, 'recovery-required');
  first.journal.close();
  const second = w.open();
  const pending = second.coordinator.status().recovery;
  assert.equal(pending.state, 'committing');
  await assert.rejects(second.coordinator.save(w.saveBody()), /recovery is required/);
  // A head the record cannot explain keeps recovery pending.
  const saved = w.bancCatalog.state().members[w.ids.banc].head;
  w.bancCatalog.state().members[w.ids.banc].head = randomUUID();
  await assert.rejects(second.coordinator.recover({ protocolVersion: 1, transactionId: pending.transactionId, action: 'rollback' }), /disagrees/);
  w.bancCatalog.state().members[w.ids.banc].head = saved;
  const result = await second.coordinator.recover({ protocolVersion: 1, transactionId: pending.transactionId, action: 'rollback' });
  assert.equal(result.state, 'rolled-back');
  assert.equal(second.journal.document().transactions.at(-1).state, 'rolled-back');
  second.journal.close();
  const third = w.open();
  assert.equal(third.coordinator.status().recovery, null);
});

test('operator completion appends the joint record only after every planned head is verified', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  w.maleCatalog.faults.commitUncertain = true;
  const error = await coordinator.save(w.saveBody()).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  // The uncertain final commit did select its heads; the fixture and BANC catalogs committed before it.
  const result = await coordinator.recover({ protocolVersion: 1, transactionId: error.recovery.transactionId, action: 'complete' });
  assert.equal(result.state, 'committed');
  assert.equal(journal.document().jointCheckpoints.length, 1);
});

test('runtime activation failure never leaves a selected head paired with an unverified runtime', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  const joint = await coordinator.save(w.saveBody());
  await coordinator.save(w.saveBody());
  w.bancCatalog.faults.activate = () => new Error('worker died');
  const error = await coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() }).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_RUNTIME_EVICTED');
  assert.equal(journal.document().transactions.at(-1).state, 'unloaded');
  for (const id of Object.values(w.ids)) assert.equal([w.fixture, w.maleCatalog, w.bancCatalog].find(catalog => catalog.member(id)).member(id).status, 'saved-unloaded');
  for (const member of joint.payload.members) assert.equal(w.contents()[member.individualId], member.checkpointSha256);

  // If eviction cannot be verified either, the coordinator fails closed.
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) for (const member of Object.values(catalog.state().members)) member.status = 'paused';
  w.maleCatalog.faults.activate = () => new Error('worker died');
  w.fixture.faults.evict = () => new Error('cannot unload');
  const second = await coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() }).catch(value => value);
  assert.equal(second.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  assert.equal(coordinator.status().recovery.operation, 'restore');
  const recovered = await coordinator.recover({ protocolVersion: 1, transactionId: second.recovery.transactionId, action: 'complete' });
  assert.equal(recovered.state, 'unloaded');
  assert.equal(w.fixture.member(w.ids.fixtureA).status, 'saved-unloaded');
});

test('one transaction at a time: concurrent restore, lifecycle and shutdown are serialized against the reservation', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open();
  const joint = await coordinator.save(w.saveBody());
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const original = w.maleCatalog.preflight;
  w.maleCatalog.preflight = async request => { await gate; return original(request); };
  const first = coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(coordinator.restore({ protocolVersion: 1, jointCheckpointId: joint.jointCheckpointId, members: w.members() }), /already in progress/);
  await assert.rejects(coordinator.save(w.saveBody()), /already in progress/);
  assert.equal(coordinator.reserved(w.ids.male), true);
  assert.throws(() => w.maleCatalog.lifecycle(w.ids.male), /reserved/);
  assert.throws(() => w.fixture.lifecycle(w.ids.fixtureA), /reserved/);
  const closed = coordinator.close();
  resume();
  await assert.rejects(first, /closing/);
  await closed;
  assert.equal(w.maleCatalog.lifecycle(w.ids.male), 'ok');
  assert.equal(coordinator.reserved(w.ids.male), false);
  assert.equal(journal.document().transactions.length, 1, 'shutdown before staging writes no record');
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(catalog.calls.filter(call => call === 'commit').length, 1);
  await assert.rejects(coordinator.save(w.saveBody()), /closing/);
});

test('journal and adapter compatibility boundaries fail closed without erasing files', async t => {
  const path = directory(t);
  const journal = openCrossCatalogJournal(path);
  assert.throws(() => openCrossCatalogJournal(path), /already open/);
  journal.close();
  const file = join(path, 'journal.json');
  const original = readFileSync(file, 'utf8');
  const document = JSON.parse(original);
  writeFileSync(file, JSON.stringify({ ...document, schemaVersion: 2 }));
  assert.throws(() => openCrossCatalogJournal(path), /corrupt or incompatible/);
  writeFileSync(file, JSON.stringify({ ...document, jointCheckpoints: [{}] }));
  assert.throws(() => openCrossCatalogJournal(path), /corrupt or incompatible/);
  writeFileSync(file, original);
  openCrossCatalogJournal(path).close();

  const nonempty = directory(t);
  writeFileSync(join(nonempty, 'unrelated.txt'), 'keep');
  assert.throws(() => openCrossCatalogJournal(nonempty), /nonempty/);
  assert.equal(readFileSync(join(nonempty, 'unrelated.txt'), 'utf8'), 'keep');

  const catalogs = directory(t);
  const adapter = openCatalog(catalogs, { catalogType: 'full-connectome', catalogId: 'connectome:male' });
  const reopened = openCrossCatalogJournal(path); t.after(() => reopened.close());
  assert.throws(() => createCrossCatalogCoordinator({ journal: reopened, catalogs: [{ ...adapter, contractVersion: 2 }] }), /unsupported/);
  assert.throws(() => createCrossCatalogCoordinator({ journal: reopened, catalogs: [{ ...adapter, catalogType: 'eidoverse' }] }), /unsupported/);
  assert.throws(() => createCrossCatalogCoordinator({ journal: reopened, catalogs: [adapter, adapter] }), /Duplicate/);
  const { evict, ...incomplete } = adapter;
  assert.throws(() => createCrossCatalogCoordinator({ journal: reopened, catalogs: [incomplete] }), /unsupported/);
});

test('journal capacity is projected before any catalog stages and refusal deletes no history', async t => {
  const w = world(t);
  const { coordinator, journal } = w.open({ capacityBytes: 4096 });
  const error = await coordinator.save(w.saveBody()).catch(value => value);
  assert.equal(error.code, 'CROSS_CATALOG_CAPACITY');
  for (const catalog of [w.fixture, w.maleCatalog, w.bancCatalog]) assert.equal(catalog.calls.includes('stage'), false);
  assert.equal(journal.document().transactions.length, 0);
  assert.equal(coordinator.status().recovery, null);
});

test('a crash after an appending revert but before the journal records it is reconciled by an idempotent rollback', async t => {
  const w = world(t);
  const priorContents = w.contents();
  let writes = 0, failAt = Infinity;
  // Every write from failAt on fails, like a process that stops before journaling anything else.
  const writeDocument = (path, bytes) => { writes++; if (writes >= failAt) throw new Error('disk gone'); writeFileSync(path, bytes); };
  const first = w.open({ writeDocument });
  w.maleCatalog.faults.commit = () => new Error('male catalog write refused');
  // Writes: staged, committing, fixture committed, BANC committed, BANC reverting; BANC then appends its revert and the journal stops.
  failAt = writes + 6;
  await assert.rejects(first.coordinator.save(w.saveBody()), error => error.code === 'CROSS_CATALOG_RECOVERY_REQUIRED');
  const appended = w.bancCatalog.member(w.ids.banc).head;
  first.journal.close();
  const second = w.open();
  const pending = second.coordinator.status().recovery;
  assert.equal(pending.state, 'committing');
  assert.equal(pending.catalogs.find(catalog => catalog.catalogId === 'connectome:banc').state, 'reverting');
  // The appended restore-lineage head is not in the journal, yet only rollback may resolve it.
  assert.ok(!pending.affectedHeads.some(value => [value.priorHead, value.plannedHead, value.selectedHead].includes(appended)));
  await assert.rejects(second.coordinator.recover({ protocolVersion: 1, transactionId: pending.transactionId, action: 'complete' }), /only rollback/);
  const result = await second.coordinator.recover({ protocolVersion: 1, transactionId: pending.transactionId, action: 'rollback' });
  assert.equal(result.state, 'rolled-back');
  assert.equal(w.bancCatalog.member(w.ids.banc).head, appended, 'the idempotent revert did not append a second lineage entry');
  assert.equal(w.bancCatalog.state().members[w.ids.banc].history.length, 3);
  assert.deepEqual(w.contents(), priorContents);
});
