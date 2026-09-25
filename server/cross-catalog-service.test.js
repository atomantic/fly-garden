import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openIdentityStore } from './identity-store.js';
import { openConnectomeStore } from './connectome-store.js';
import { createSparseLif } from './sparse-lif.js';
import { createCrossCatalogService } from './cross-catalog-service.js';

const DATASETS = ['male-cns:v1.0', 'banc:v888'];
const MANIFEST = 'ab'.repeat(32);
const graph = dataset => ({
  ids: [`${dataset}/1`],
  offsets: new Uint32Array([0, 0]),
  targets: new Uint32Array(),
  contacts: new Uint32Array(),
  signs: new Int8Array([1]),
});
const directory = (t, prefix = 'cross-catalog-service-') => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};
const workerFor = store => {
  const residents = new Map();
  return {
    add(id, checkpoint, lifecycle = 'paused') {
      residents.set(id, { checkpoint: structuredClone(checkpoint), lifecycle, sessionEpoch: randomUUID() });
    },
    describe(id) {
      const resident = residents.get(id);
      return resident ? { status: resident.lifecycle, sessionEpoch: resident.sessionEpoch } : { status: 'saved-unloaded', sessionEpoch: null };
    },
    peekCheckpoint(id) {
      const resident = residents.get(id);
      if (!resident) throw new Error('Worker unavailable');
      return structuredClone(resident.checkpoint);
    },
    async activatePaused(id, { checkpointId, mode }) {
      const resident = residents.get(id);
      if (!resident) throw new Error('Worker unavailable');
      resident.checkpoint = structuredClone(store.readCheckpoint(id, checkpointId));
      resident.lifecycle = 'paused';
      resident.sessionEpoch = randomUUID();
      resident.mode = mode;
      return { checkpointId, sessionEpoch: resident.sessionEpoch, status: 'paused' };
    },
    async evict(id) {
      residents.delete(id);
    },
  };
};
const world = t => {
  const root = directory(t);
  const identities = openIdentityStore(join(root, 'identities'));
  const store = openConnectomeStore(join(root, 'connectomes'), {
    profiles: Object.fromEntries(DATASETS.map(dataset => [dataset, {
      directory: join(root, dataset),
      graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256,
      manifestSha256: MANIFEST,
      neuronCount: 1,
      edgeCount: 0,
    }])),
  });
  const worker = workerFor(store);
  const research = new Map();
  for (const dataset of DATASETS) {
    const identity = store.create(dataset);
    const kernel = createSparseLif(graph(dataset), { dataset, individualId: identity.individualId });
    kernel.seedProbe([0]);
    kernel.step();
    const head = store.identities().find(value => value.individualId === identity.individualId).checkpointId;
    store.persistCheckpoint({
      individualId: identity.individualId,
      dataset,
      parentId: head,
      checkpoint: kernel.checkpoint(),
      operation: 'save',
    });
    research.set(dataset, identity.individualId);
    worker.add(identity.individualId, store.readCheckpoint(identity.individualId,
      store.identities().find(value => value.individualId === identity.individualId).checkpointId), dataset === DATASETS[1] ? 'resting' : 'paused');
  }
  identities.control(identities.primaryId, 'rest');
  const lifecycle = [];
  const service = createCrossCatalogService({
    journalDirectory: join(root, 'journal'),
    identityStore: identities,
    connectomeStore: store,
    connectomeWorker: worker,
    onLifecycle: (...args) => lifecycle.push(args),
  });
  t.after(async () => {
    await service.close().catch(() => {});
    try { identities.close(); } catch {}
    try { store.close(); } catch {}
  });
  const members = [
    { individualId: identities.primaryId, catalogId: 'fixture' },
    { individualId: research.get(DATASETS[0]), catalogId: 'connectome:male' },
    { individualId: research.get(DATASETS[1]), catalogId: 'connectome:banc' },
  ];
  return { root, identities, store, worker, research, service, lifecycle, members };
};

test('service wires fixed real-store namespaces, safe bounded views, paused save and restore, and lifecycle IDs only', async t => {
  const w = world(t);
  const initial = w.service.view();
  assert.equal(initial.available, true, JSON.stringify(initial));
  assert.deepEqual(initial.catalogs, [
    { catalogId: 'fixture', catalogType: 'fixture-identity' },
    { catalogId: 'connectome:male', catalogType: 'full-connectome' },
    { catalogId: 'connectome:banc', catalogType: 'full-connectome' },
  ]);
  assert.deepEqual(initial.members.map(member => [member.catalogId, member.dataset, member.mode]), [
    ['fixture', 'synthetic-fixture:v1', 'resting'],
    ['connectome:male', DATASETS[0], 'active'],
    ['connectome:banc', DATASETS[1], 'resting'],
  ]);
  assert.equal(JSON.stringify(initial).includes(w.root), false);
  assert.deepEqual(initial.checkpoints, []);

  const body = { protocolVersion: 1, intervalMs: 5, tick: 2, members: w.members };
  await assert.rejects(w.service.save({ ...body, directory: w.root }), error => error.code === 'CROSS_CATALOG_REFUSED');
  assert.deepEqual(w.lifecycle, []);
  const first = await w.service.save(body);
  assert.equal(first.payload.kind, 'cross-catalog-joint');
  assert.deepEqual(w.lifecycle, w.members.map(member => [member.individualId]));
  assert.equal(w.service.view().checkpoints.length, 1);
  assert.deepEqual(w.service.checkpoints()[0], w.service.view().checkpoints[0]);

  await w.service.save({ ...body, tick: 3 });
  const restored = await w.service.restore({ protocolVersion: 1, jointCheckpointId: first.jointCheckpointId, members: w.members });
  assert.equal(restored.status, 'paused');
  assert.equal(restored.members.find(member => member.individualId === w.identities.primaryId).mode, 'resting');
  assert.equal(w.lifecycle.length, 9);
  assert.equal(w.lifecycle.every(args => args.length === 1), true);

  for (let count = 1; count < 64; count++) w.identities.create();
  const bounded = w.service.view();
  assert.equal(bounded.memberCount, 66);
  assert.equal(bounded.members.length, 64);
  assert.equal(bounded.members.every(member => Object.hasOwn(member, 'directory') === false), true);
  await w.service.close();
  await w.service.close();
  assert.equal(w.identities.snapshot(w.identities.primaryId).individualId, w.identities.primaryId);
  assert.equal(w.store.identities().length, 2);
});

test('injected journal and coordinator preserve exact bodies, lifecycle IDs, safe status and close ownership', async t => {
  const ids = [randomUUID(), randomUUID()];
  const calls = [], lifecycle = [];
  let journalClosed = false, coordinatorClosed = false;
  const journal = { close() { journalClosed = true; } };
  const participants = [{ individualId: ids[0], catalogId: 'fixture' }, { individualId: ids[1], catalogId: 'connectome:male' }];
  const coordinator = {
    save: async body => { calls.push(['save', body]); return { payload: { members: participants } }; },
    restore: async body => { calls.push(['restore', body]); return { members: participants }; },
    recover: async body => { calls.push(['recover', body]); return { affectedHeads: participants }; },
    status: () => ({ available: true, busy: false, recovery: null, path: '/private/catalog' }),
    jointCheckpoints: () => [],
    reserved: id => id === ids[0],
    close: async () => { coordinatorClosed = true; },
  };
  const service = createCrossCatalogService({ journal, coordinator, onLifecycle: (...args) => lifecycle.push(args) });
  assert.equal(service.status().available, true);
  assert.equal(JSON.stringify(service.view()).includes('/private/catalog'), false);
  const save = { protocolVersion: 1, intervalMs: 5, tick: 0, members: participants };
  const restore = { protocolVersion: 1, jointCheckpointId: randomUUID(), members: participants };
  const recover = { protocolVersion: 1, transactionId: randomUUID(), action: 'rollback' };
  const saved = await service.save(save);
  assert.equal(saved.payload.members, participants);
  await service.restore(restore);
  await service.recover(recover);
  assert.equal(calls[0][1], save);
  assert.equal(calls.some(([, body]) => body === restore), true);
  assert.equal(calls.some(([, body]) => body === recover), true);
  assert.deepEqual(lifecycle, [...participants.map(member => [member.individualId]), ...participants.map(member => [member.individualId]), ...participants.map(member => [member.individualId])]);
  assert.equal(service.reserved(ids[0]), true);
  await service.close();
  assert.equal(journalClosed, true);
  assert.equal(coordinatorClosed, true);
  await assert.rejects(service.save(save), error => error.code === 'CROSS_CATALOG_UNAVAILABLE');
  assert.equal(service.view().available, false);
});

test('missing and corrupt journals fail closed without resetting files or exposing paths', async t => {
  const missing = createCrossCatalogService();
  assert.equal(missing.view().available, false);
  assert.match(missing.view().reason, /unavailable/);
  assert.deepEqual(missing.checkpoints(), []);
  assert.equal(missing.reserved(randomUUID()), false);
  await assert.rejects(missing.save({}), error => error.code === 'CROSS_CATALOG_UNAVAILABLE');
  await missing.close();

  const root = directory(t, 'cross-catalog-corrupt-');
  const journalDirectory = join(root, 'journal');
  mkdirSync(journalDirectory);
  const path = join(journalDirectory, 'journal.json');
  const original = '{"schemaVersion":1,"private":"/do/not/expose"}';
  writeFileSync(path, original);
  const corrupt = createCrossCatalogService({ journalDirectory });
  assert.equal(corrupt.status().available, false);
  assert.equal(corrupt.view().checkpoints.length, 0);
  assert.equal(readFileSync(path, 'utf8'), original);
  await assert.rejects(corrupt.restore({}), error => error.code === 'CROSS_CATALOG_UNAVAILABLE' && !error.message.includes('/'));
  await corrupt.close();
});
