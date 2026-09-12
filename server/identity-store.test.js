import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'fly-identities-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('explicit saves survive restart with same identity, fresh session and paused time; readers create nothing', t => {
  const path = directory(t);
  let store = openIdentityStore(path);
  const id = store.primaryId;
  const session = store.snapshot().sessionId;
  assert.equal(store.snapshot().tick, 0);
  store.control(id, 'start');
  for (let i = 0; i < 83; i++) store.step();
  const state = store.save();
  const savedId = state.persistence.checkpointId;
  for (let i = 0; i < 17; i++) store.step();
  store.close();
  store = openIdentityStore(path);
  t.after(() => store.close());
  assert.equal(store.primaryId, id);
  assert.notEqual(store.snapshot().sessionId, session);
  assert.equal(store.snapshot().status, 'paused');
  assert.equal(store.snapshot().tick, 83);
  assert.deepEqual(store.snapshot().neural, state.neural);
  store.step();
  assert.equal(store.snapshot().tick, 83);
  for (let i = 0; i < 10; i++) store.snapshot();
  assert.equal(store.list().length, 1);
  assert.equal(store.snapshot().persistence.checkpointId, savedId);
});

test('replicas retain explicit lineage but cannot activate or mutate the resident', t => {
  const store = openIdentityStore(directory(t));
  t.after(() => store.close());
  const id = store.primaryId;
  store.control(id, 'start');
  store.encounter(id, 'nectar');
  store.step();
  const source = store.save();
  const replica = store.replica(id, source.persistence.checkpointId);
  assert.notEqual(replica.individualId, id);
  assert.equal(replica.status, 'saved-unloaded');
  assert.deepEqual(replica.persistence.branchOf, { individualId: id, checkpointId: source.persistence.checkpointId });
  assert.deepEqual(replica.neural, source.neural);
  assert.equal(replica.stimulusPolicy.individualId, replica.individualId);
  assert.equal(replica.stimulusPolicy.reservedDose, source.stimulusPolicy.reservedDose);
  assert.equal(replica.chemistry.some(value => value.active), false);
  assert.throws(() => store.control(replica.individualId, 'start'), /unloaded/);
  assert.throws(() => store.restore(id, replica.persistence.checkpointId), /does not belong/);
  assert.deepEqual(store.snapshot().neural, source.neural);
  assert.equal(store.snapshot().status, 'fault');
  store.restore(id, source.persistence.checkpointId);
  store.control(id, 'start'); store.step();
  assert.equal(store.snapshot(replica.individualId).tick, replica.tick);
  assert.equal(store.snapshot().tick, source.tick + 1);
});

test('corrupt or incompatible disk records cannot replace saved identities', t => {
  const path = directory(t);
  const store = openIdentityStore(path);
  store.close();
  const file = join(path, 'identities.json');
  const original = readFileSync(file, 'utf8');
  for (const corrupt of ['{', JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 }), original.replace('synthetic-lif-v1', 'foreign-model-v1')]) {
    writeFileSync(file, corrupt);
    assert.throws(() => openIdentityStore(path));
    assert.equal(readFileSync(file, 'utf8'), corrupt);
  }
  writeFileSync(file, original);
  const recovered = openIdentityStore(path);
  assert.equal(recovered.snapshot().status, 'paused');
  recovered.close();
});

test('failed save or restore preserves last checkpoint and neural state and stops advancement', t => {
  const path = directory(t);
  openIdentityStore(path).close();
  const file = join(path, 'identities.json');
  const original = readFileSync(file, 'utf8');
  const store = openIdentityStore(path, { write: () => { throw new Error('simulated disk full'); } });
  t.after(() => store.close());
  store.control(store.primaryId, 'start'); store.step();
  const neural = store.snapshot().neural;
  assert.throws(() => store.save(), /disk full/);
  assert.equal(store.snapshot().status, 'fault');
  store.step();
  assert.deepEqual(store.snapshot().neural, neural);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.throws(() => store.restore(store.primaryId, store.snapshot().persistence.checkpointId), /disk full/);
  assert.deepEqual(store.snapshot().neural, neural);
});

test('second writer is refused and lock is released on close', t => {
  const path = directory(t);
  const store = openIdentityStore(path);
  assert.throws(() => openIdentityStore(path), /already open|lock/);
  store.close();
  openIdentityStore(path).close();
});

test('HTTP envelopes reject duplicates and pre-restore sessions without cross-individual changes', async t => {
  const identities = openIdentityStore(directory(t));
  const server = createServer({ identities, autoTick: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = () => fetch(`${base}/api/state`).then(value => value.json());
  const envelope = (state, extra = {}) => ({ protocolVersion: 1, individualId: state.individualId,
    sessionId: state.sessionId, sequence: state.commandSequence + 1, ...extra });
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const initial = await get();
  assert.equal((await post('/api/control', { action: 'start' })).status, 409);
  const start = envelope(initial, { action: 'start' });
  assert.equal((await post('/api/control', start)).status, 200);
  assert.equal((await post('/api/control', start)).status, 409);
  identities.step();
  const beforeSave = await get();
  const path = `/api/individuals/${initial.individualId}`;
  assert.equal((await post(`${path}/checkpoints`, envelope(beforeSave), { Origin: 'https://other.example' })).status, 403);
  const saved = await (await post(`${path}/checkpoints`, envelope(beforeSave))).json();
  const beforeRestore = envelope(saved, { action: 'start' });
  const restored = await (await post(`${path}/restore`, envelope(saved, { checkpointId: saved.persistence.checkpointId }))).json();
  assert.notEqual(restored.sessionId, saved.sessionId);
  assert.equal((await post('/api/control', { ...beforeRestore, sequence: restored.commandSequence + 1 })).status, 409);
  assert.equal((await get()).status, 'paused');
  const replica = await (await post(`${path}/replicas`, envelope(restored, { checkpointId: restored.persistence.checkpointId }))).json();
  assert.equal(replica.status, 'saved-unloaded');
  const after = await get();
  assert.equal(after.tick, saved.tick);
  assert.equal((await fetch(`${base}/api/individuals`).then(value => value.json())).individuals.length, 2);
  assert.equal((await fetch(`${base}${path}/checkpoints`).then(value => value.json())).checkpoints.length, 2);
});

test('admission is durably reserved before delivery, and old restores cannot refund spent exposure', t => {
  const path = directory(t);
  let store = openIdentityStore(path);
  const initialId = store.snapshot().persistence.checkpointId;
  const id = store.primaryId;
  store.control(id, 'start');
  const admitted = store.encounter(id, 'nectar');
  const spent = admitted.stimulusPolicy.reservedDose;
  assert.ok(spent > 0);
  assert.notEqual(admitted.persistence.checkpointId, initialId);
  assert.throws(() => store.restore(id, initialId), /reservation|budget|exposure/);
  assert.equal(store.snapshot().status, 'fault');
  store.close();
  store = openIdentityStore(path);
  t.after(() => store.close());
  assert.equal(store.snapshot().status, 'paused');
  assert.equal(store.snapshot().stimulusPolicy.reservedDose, spent);
  assert.equal(store.snapshot().chemistry.some(value => value.active), false);
  store.control(id, 'start');
  assert.throws(() => store.encounter(id, 'nectar'), /recovery/);
  assert.throws(() => store.restore(id, initialId), /reservation|budget|exposure/);
});

test('failed admission receipt never delivers current and bounded history never prunes old checkpoints', t => {
  const path = directory(t);
  const first = openIdentityStore(path);
  const id = first.primaryId;
  const original = first.snapshot().persistence.checkpointId;
  for (let i = 1; i < 64; i++) first.save();
  first.control(id, 'start');
  const neural = first.snapshot().neural;
  assert.throws(() => first.encounter(id, 'nectar'), /history limit/);
  assert.equal(first.snapshot().status, 'fault');
  first.step();
  assert.deepEqual(first.snapshot().neural, neural);
  assert.equal(first.snapshot().chemistry.some(value => value.active), false);
  assert.equal(first.checkpoints(id).length, 64);
  assert.equal(first.checkpoints(id)[0].checkpointId, original);
  first.close();
  const next = openIdentityStore(path);
  assert.equal(next.snapshot().stimulusPolicy.reservedDose, 0);
  assert.equal(next.snapshot().status, 'paused');
  next.close();
});


test('process death releases writer ownership and recovery remains paused', async t => {
  const path = directory(t);
  const moduleUrl = new URL('./identity-store.js', import.meta.url).href;
  const code = `import { openIdentityStore } from ${JSON.stringify(moduleUrl)};
    const store = openIdentityStore(${JSON.stringify(path)});
    store.control(store.primaryId, 'start'); store.step(); store.save();
    console.log(store.primaryId); setInterval(() => store.step(), 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [chunk] = await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => { throw new Error(`child exited before ready: ${stderr}`); }),
  ]);
  const id = chunk.toString().trim();
  child.kill('SIGKILL');
  await once(child, 'exit');
  const recovered = openIdentityStore(path);
  t.after(() => recovered.close());
  assert.equal(recovered.primaryId, id);
  assert.equal(recovered.snapshot().tick, 1);
  assert.equal(recovered.snapshot().status, 'paused');
  recovered.step();
  assert.equal(recovered.snapshot().tick, 1);
});
