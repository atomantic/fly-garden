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
  assert.equal(first.snapshot().stimulusPolicy.reservedDose, 0);
  assert.equal(first.restore(id, first.snapshot().persistence.checkpointId).status, 'paused');
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


test('failed staged admission preserves previously spent reservations and remains explicitly restorable', t => {
  const path = directory(t);
  let store = openIdentityStore(path);
  const id = store.primaryId;
  store.control(id, 'start'); store.encounter(id, 'nectar');
  for (let i = 0; i < 200; i++) store.step();
  const saved = store.save();
  store.close();
  store = openIdentityStore(path, { write: () => { throw new Error('simulated disk full'); } });
  store.control(id, 'start');
  assert.throws(() => store.encounter(id, 'floral'), /disk full/);
  assert.equal(store.snapshot().stimulusPolicy.reservedDose, saved.stimulusPolicy.reservedDose);
  assert.equal(store.snapshot().stimulusPolicy.entries.length, 1);
  assert.equal(store.snapshot().status, 'fault');
  assert.deepEqual(store.snapshot().neural, saved.neural);
  store.close();
  const recovered = openIdentityStore(path);
  t.after(() => recovered.close());
  assert.equal(recovered.restore(id, saved.persistence.checkpointId).status, 'paused');
  assert.equal(recovered.snapshot().stimulusPolicy.reservedDose, saved.stimulusPolicy.reservedDose);
});

test('independent residents isolate control, checkpoint histories, mutable snapshots and restore sessions', t => {
  const store = openIdentityStore(directory(t));
  t.after(() => store.close());
  const a = store.primaryId;
  const b = store.create().individualId;
  const before = store.snapshot(a);
  const unloadedSession = store.snapshot(b).sessionId;
  assert.equal(store.load(b).status, 'paused');
  assert.notEqual(store.snapshot(b).sessionId, unloadedSession);
  assert.equal(store.list().filter(value => value.resident).length, 2);
  store.control(b, 'start');
  store.encounter(b, 'nectar');
  for (let i = 0; i < 20; i++) store.step();
  assert.deepEqual(store.snapshot(a), before);
  const savedB = store.save(b);
  store.control(a, 'start');
  store.step(a);
  const savedA = store.save(a);
  store.control(b, 'rest');
  const restoredB = store.restore(b, savedB.persistence.checkpointId);
  assert.equal(restoredB.status, 'paused');
  assert.notEqual(restoredB.sessionId, savedB.sessionId);
  assert.deepEqual(store.snapshot(a), savedA);
  restoredB.neural.neurons[0].potential = 0.99;
  assert.notEqual(store.snapshot(b).neural.neurons[0].potential, 0.99);
  assert.throws(() => store.restore(b, savedA.persistence.checkpointId), /does not belong/);
  assert.equal(store.snapshot(b).status, 'fault');
  assert.deepEqual(store.snapshot(a), savedA);
  store.step(a);
  assert.equal(store.snapshot(a).tick, savedA.tick + 1);
});

test('explicit unload persists progress and reload cancels input without losing reservations', t => {
  const path = directory(t);
  let store = openIdentityStore(path);
  const id = store.create().individualId;
  store.load(id); store.control(id, 'start'); store.encounter(id, 'nectar');
  store.step(id);
  const active = store.snapshot(id);
  const unloaded = store.unload(id);
  assert.equal(unloaded.status, 'saved-unloaded');
  assert.equal(unloaded.tick, active.tick);
  assert.throws(() => store.control(id, 'start'), /unloaded/);
  const loaded = store.load(id);
  assert.equal(loaded.status, 'paused');
  assert.notEqual(loaded.sessionId, active.sessionId);
  assert.equal(loaded.stimulusPolicy.reservedDose, active.stimulusPolicy.reservedDose);
  assert.equal(loaded.chemistry.some(value => value.active), false);
  store.close();
  store = openIdentityStore(path);
  t.after(() => store.close());
  assert.equal(store.snapshot(id).status, 'saved-unloaded');
  assert.equal(store.snapshot(id).tick, active.tick);
  assert.equal(store.snapshot().status, 'paused');
});

test('failed unload preserves the targeted resident and leaves another resident untouched', t => {
  const path = directory(t);
  const initial = openIdentityStore(path);
  const b = initial.create().individualId;
  initial.close();
  const store = openIdentityStore(path, { write: () => { throw new Error('disk full'); } });
  t.after(() => store.close());
  store.load(b); store.control(b, 'start'); store.step(b);
  const primary = store.snapshot();
  const neural = store.snapshot(b).neural;
  assert.throws(() => store.unload(b), /disk full/);
  assert.equal(store.snapshot(b).persistence.resident, true);
  assert.equal(store.snapshot(b).status, 'fault');
  assert.deepEqual(store.snapshot(b).neural, neural);
  assert.deepEqual(store.snapshot(), primary);
});


test('boot may defer primary residency until explicit capacity admission', t => {
  const store = openIdentityStore(directory(t), { loadPrimary: false });
  t.after(() => store.close());
  assert.equal(store.snapshot().status, 'saved-unloaded');
  assert.equal(store.list().filter(value => value.resident).length, 0);
  store.step();
  assert.equal(store.snapshot().tick, 0);
  assert.throws(() => store.control(store.primaryId, 'start'), /unloaded/);
  assert.equal(store.load(store.primaryId).status, 'paused');
  store.step();
  assert.equal(store.snapshot().tick, 0);
});

test('visual adapter owns only attached recipient steps and detaches on restore/home/unload', t => {
  const store = openIdentityStore(directory(t)); t.after(() => store.close());
  const a = store.primaryId, b = store.create().individualId; store.load(b);
  assert.equal(store.environmentSnapshot(a).attached, false);
  const lease = store.environmentControl(a, 'attach');
  store.control(a, 'start'); store.control(b, 'start');
  store.step(); assert.equal(store.snapshot(a).tick, 0); assert.equal(store.snapshot(b).tick, 1);
  const state = store.snapshot(a), env = store.environmentSnapshot(a);
  const frame = { controllerToken: lease.controllerToken, version: 1, individualId: a, sessionId: state.sessionId, environmentEpoch: env.environmentEpoch,
    frameId: 0, simTimeMs: 0, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) };
  const result = store.environmentFrame(a, frame);
  assert.equal(result.state.tick, 1); assert.equal(store.snapshot(b).tick, 1);
  assert.ok(Math.abs(result.environment.pose.x) <= 2); assert.ok(Math.abs(result.environment.pose.z) <= 2);
  assert.throws(() => store.environmentFrame(b, frame), /attach/);
  const saved = store.save(a); store.restore(a, saved.persistence.checkpointId);
  assert.equal(store.environmentSnapshot(a).attached, false);
  store.environmentControl(a, 'attach'); store.control(a, 'home'); assert.equal(store.environmentSnapshot(a).attached, false);
  store.environmentControl(a, 'attach'); store.unload(a); store.load(a);
  assert.equal(store.environmentSnapshot(a).attached, false); assert.equal(store.snapshot(a).status, 'paused');
});

test('environment HTTP enforces command/origin and separate frame epochs with recipient capture hook', async t => {
  const store = openIdentityStore(directory(t));
  const captures = [];
  const server = createServer({ identities: store, autoTick: false, onEnvironmentFrame: state => captures.push(state) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const route = `/api/individuals/${id}/environment`;
  let state = store.snapshot();
  const command = { protocolVersion: 1, individualId: id, sessionId: state.sessionId, sequence: 1, action: 'attach' };
  assert.equal((await post(route, command, { Origin: 'https://invalid.example' })).status, 403);
  let response = await post(route, command); assert.equal(response.status, 200); state = await response.json();
  assert.equal(state.environmentAdapter.attached, true); assert.equal(state.commandSequence, 1);
  const controllerToken = state.controllerToken;
  response = await post(`/api/individuals/${id}/control`, { ...command, sequence: 2, action: 'start' }); state = await response.json();
  const frame = { controllerToken, version: 1, individualId: id, sessionId: state.sessionId, environmentEpoch: state.environmentAdapter.environmentEpoch,
    frameId: 0, simTimeMs: 0, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(0) };
  assert.equal((await post(route + '/frames', frame, { Origin: 'https://invalid.example' })).status, 403);
  response = await post(route + '/frames', frame); assert.equal(response.status, 200);
  const accepted = await response.json(); assert.equal(accepted.state.tick, 1); assert.equal(accepted.state.commandSequence, 2);
  assert.equal(captures.length, 1); assert.equal(captures[0].environmentTrace.frameId, 0); assert.equal(captures[0].individualId, id);
  assert.equal((await post(route + '/frames', frame)).status, 409); assert.equal(captures.length, 1);
  assert.equal((await fetch(base + route).then(r => r.json())).attached, true);
});

test('controller lease is private, survives pause/resume, and explicit takeover revokes the old producer', async t => {
  const store = openIdentityStore(directory(t));
  const captures = [];
  const server = createServer({ identities: store, autoTick: false, onEnvironmentFrame: state => captures.push(state) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  const route = `/api/individuals/${id}/environment`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let sequence = 0;
  const command = async (path, action) => {
    const s = store.snapshot(id);
    const response = await post(path, { protocolVersion: 1, individualId: id, sessionId: s.sessionId, sequence: ++sequence, action });
    assert.equal(response.status, 200); return response.json();
  };
  const first = await command(route, 'attach'), token = first.controllerToken;
  assert.match(token, /^[0-9a-f]{64}$/);
  await command(`/api/individuals/${id}/control`, 'start');
  const frame = controllerToken => {
    const s = store.snapshot(id), e = s.environmentAdapter;
    return { controllerToken, version: 1, individualId: id, sessionId: s.sessionId, environmentEpoch: e.environmentEpoch,
      frameId: e.lastFrameId + 1, simTimeMs: s.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(0) };
  };
  const missingLease = frame(token); delete missingLease.controllerToken;
  assert.equal((await post(route + '/frames', missingLease)).status, 409); assert.equal(store.snapshot(id).tick, 0);
  let response = await post(route + '/frames', frame(token)); assert.equal(response.status, 200);
  assert.equal(JSON.stringify(await response.json()).includes(token), false);
  for (const path of ['/api/state', '/api/health', `/api/individuals/${id}`, route]) {
    const text = await fetch(base + path).then(r => r.text());
    assert.equal(text.includes(token), false); assert.equal(text.includes('controllerToken'), false);
  }
  assert.equal(JSON.stringify(captures).includes(token), false);
  const beforePause = store.environmentSnapshot(id).environmentEpoch;
  await command(`/api/individuals/${id}/control`, 'pause'); await command(`/api/individuals/${id}/control`, 'start');
  assert.notEqual(store.environmentSnapshot(id).environmentEpoch, beforePause);
  assert.equal((await post(route + '/frames', frame(token))).status, 200);
  const second = await command(route, 'attach');
  assert.notEqual(second.controllerToken, token); assert.equal(second.status, 'paused');
  await command(`/api/individuals/${id}/control`, 'start');
  const tick = store.snapshot(id).tick;
  assert.equal((await post(route + '/frames', frame(token))).status, 409); assert.equal(store.snapshot(id).tick, tick);
  assert.equal((await post(route + '/frames', frame(second.controllerToken))).status, 200);
  await command(route, 'detach'); const third = await command(route, 'attach'); await command(`/api/individuals/${id}/control`, 'start');
  assert.notEqual(third.controllerToken, second.controllerToken);
  assert.equal((await post(route + '/frames', frame(second.controllerToken))).status, 409);
});
