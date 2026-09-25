import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { openIdentityStore } from './identity-store.js';
import { openConnectomeStore } from './connectome-store.js';
import { createSparseLif } from './sparse-lif.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createCapacityPolicy } from './population-capacity.js';
import { createServer } from './index.js';

const datasets = ['male-cns:v1.0', 'banc:v888'];
const graph = dataset => ({ ids: [`${dataset}/1`], offsets: new Uint32Array([0, 0]), targets: new Uint32Array(), contacts: new Uint32Array(), signs: new Int8Array([1]) });

test('live registry cross-catalog save and restore keep selected heads and paused modes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cross-catalog-live-'));
  const identities = openIdentityStore(join(root, 'identities'));
  const profiles = Object.fromEntries(datasets.map(dataset => [dataset, {
    directory: join(root, dataset), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256,
    manifestSha256: 'ab'.repeat(32), neuronCount: 1, edgeCount: 0,
  }]));
  const catalog = openConnectomeStore(join(root, 'connectomes'), { profiles });
  const backend = async (_directory, options) => {
    const session = createConnectomeSession({ ...options, graph: graph(options.dataset), provenance: { manifestSha256: 'ab'.repeat(32) } });
    let epoch = session.snapshot().sessionEpoch;
    const dispatch = async (action, value) => {
      const result = session.dispatch({ action, value, sessionEpoch: epoch });
      if (result?.sessionEpoch) epoch = result.sessionEpoch;
      return result;
    };
    return { ready: session.snapshot(), close: async () => {}, snapshot: () => dispatch('snapshot'), start: () => dispatch('start'),
      pause: () => dispatch('pause'), advance: value => dispatch('advance', value), checkpoint: () => dispatch('checkpoint'),
      prepareRestore: value => dispatch('prepareRestore', value), commitRestore: value => dispatch('commitRestore', value),
      discardRestore: value => dispatch('discardRestore', value), rollbackRestore: value => dispatch('rollbackRestore', value),
      sample: value => dispatch('sample', value) };
  };
  const capacity = createCapacityPolicy({ settings: { maxResidentFlies: 3, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 } });
  const research = new Map();
  for (const dataset of datasets) {
    const identity = catalog.create(dataset);
    const kernel = createSparseLif(graph(dataset), { dataset, individualId: identity.individualId });
    kernel.seedProbe([0]);
    kernel.step();
    catalog.persistCheckpoint({ individualId: identity.individualId, dataset, parentId: null, checkpoint: kernel.checkpoint(), operation: 'save' });
    research.set(dataset, identity.individualId);
  }
  const server = createServer({ identities, connectomeCatalog: catalog, connectomeProfiles: Object.fromEntries(datasets.map(dataset => [dataset, { descriptor: profiles[dataset], measurement: { available: true, backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 1000 } }])),
    connectomeBackend: backend, capacity, resourceUsage: () => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 100000 }),
    crossCatalogDirectory: join(root, 'cross-catalog'), autoTick: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setImmediate(resolve));
    try { catalog.close(); } catch {}
    try { identities.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const state = async id => (await fetch(`${base}/api/connectomes/${id}`)).json();
  const command = async (id, action, steps = null, checkpointId = null) => {
    const current = await state(id);
    return post(`/api/connectomes/${id}/commands`, { protocolVersion: 1, individualId: id, sessionEpoch: current.sessionEpoch, commandSequence: current.commandSequence, action, steps, checkpointId });
  };
  for (const dataset of datasets) assert.equal((await command(research.get(dataset), 'load')).status, 200);
  identities.control(identities.primaryId, 'rest');
  const status = await (await fetch(`${base}/api/cross-catalog`)).json();
  assert.equal(status.available, true);
  assert.equal(status.members.length, 3);
  const members = [{ individualId: identities.primaryId, catalogId: 'fixture' }, { individualId: research.get(datasets[0]), catalogId: 'connectome:male' }, { individualId: research.get(datasets[1]), catalogId: 'connectome:banc' }];
  const save = await post('/api/cross-catalog', { protocolVersion: 1, intervalMs: 5, tick: 4, members });
  assert.equal(save.status, 200);
  const saved = await save.json();
  for (const member of saved.payload.members) {
    if (member.catalogId !== 'fixture') assert.equal((await state(member.individualId)).checkpointId, member.checkpointId);
  }
  assert.equal((await state(research.get(datasets[0]))).status, 'paused');
  const restored = await post('/api/cross-catalog/restore', { protocolVersion: 1, jointCheckpointId: saved.jointCheckpointId, members });
  assert.equal(restored.status, 200);
  const restoredValue = await restored.json();
  assert.equal(restoredValue.status, 'paused');
  assert.equal(identities.snapshot(identities.primaryId).status, 'resting');
  assert.equal((await state(research.get(datasets[0]))).resident, true);
  assert.equal((await state(research.get(datasets[1]))).resident, true);
});
