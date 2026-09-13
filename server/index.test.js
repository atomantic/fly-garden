import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './index.js';
import { createRuntime } from './runtime.js';

async function fixture(t, options = {}) {
  const distDir = await mkdtemp(join(tmpdir(), 'fly-garden-test-'));
  await writeFile(join(distDir, 'index.html'), '<main>Fixture UI</main>');
  const runtime = createRuntime();
  const server = createServer({ runtime, autoTick: false, distDir, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(distDir, { recursive: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { runtime, base, get: () => fetch(`${base}/api/state`).then(r => r.json()),
    post: (path, body, headers = {}) => fetch(`${base}/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
  };
}

test('HTTP lifecycle starts paused, shares one clock, rests without reset, and never enables unimplemented capabilities', async t => {
  const { runtime, base, get, post } = await fixture(t);
  const initial = await get();
  assert.equal(initial.status, 'paused');
  assert.equal(initial.source, 'fixture');
  assert.equal(initial.model.neuronCount, 32);
  assert.equal(initial.model.edgeCount, 64);
  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.service, 'online');
  assert.equal(health.simulation, 'paused');
  assert.equal(health.connectome.available, false);
  assert.equal(health.ui.available, true);
  assert.equal(health.runtime.node, process.version);
  assert.equal(health.eidoverse.configured, false);
  assert.equal(health.eidoverse.available, false);
  for (const capability of Object.values(initial.capabilities)) {
    assert.equal(capability.available, false);
    assert.ok(capability.reason.length > 10);
  }
  runtime.step();
  assert.equal((await get()).tick, 0);
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 409);
  assert.equal((await post('control', { action: 'start' })).status, 200);
  for (let i = 0; i < 100; i++) runtime.step();
  const first = await get();
  assert.equal(first.simTimeMs, 500);
  assert.ok(first.neural.meanRateHz > 0);
  assert.deepEqual(await get(), first);
  await post('control', { action: 'rest' });
  runtime.step();
  assert.equal((await get()).status, 'resting');
  assert.equal((await get()).tick, first.tick);
  await post('control', { action: 'home' });
  assert.equal((await get()).status, 'paused');
  assert.deepEqual((await get()).neural, first.neural);
  assert.equal(createRuntime().snapshot().tick, 0);
  assert.equal(createRuntime().snapshot().status, 'paused');
});

test('missing built UI is distinct from healthy paused API service', async t => {
  const { base, get } = await fixture(t, { distDir: join(tmpdir(), 'missing-fly-ui', 'not-built') });
  const health = await fetch(`${base}/api/health`).then(r => r.json());
  assert.equal(health.service, 'online');
  assert.equal(health.ui.available, false);
  assert.equal(health.simulation, 'paused');
  assert.equal((await get()).tick, 0);
});

test('bounded encounters change model inputs, expire, enforce global and individual cooldown, and cannot be strengthened', async t => {
  const { runtime, get, post } = await fixture(t);
  const baseline = createRuntime();
  baseline.control('start');
  await post('control', { action: 'start' });
  const offered = await post('encounters', { compoundId: 'nectar' });
  assert.equal(offered.status, 200);
  assert.equal((await offered.json()).chemistry[0].remainingMs, 300);
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 409);
  assert.equal((await post('encounters', { compoundId: 'floral' })).status, 409);
  assert.equal((await post('encounters', { compoundId: 'nectar', intensity: 100 })).status, 400);
  runtime.step(); baseline.step();
  assert.ok((await get()).neural.neurons[0].potential > baseline.snapshot().neural.neurons[0].potential);
  for (let i = 1; i < 60; i++) runtime.step();
  assert.equal((await get()).chemistry[0].active, false);
  assert.equal((await get()).chemistry[0].remainingMs, 0);
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 409);
  await post('control', { action: 'rest' });
  await post('control', { action: 'start' });
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 409);
  for (let i = 60; i < 600; i++) runtime.step();
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 200);
  assert.equal((await post('encounters', { compoundId: 'pain' })).status, 400);
  await post('control', { action: 'rest' });
  assert.equal((await get()).chemistry[0].active, false);
});

test('HTTP boundary rejects malformed and cross-origin mutations and distinguishes missing API from SPA routes', async t => {
  const { base, post, get } = await fixture(t);
  assert.equal((await post('control', { action: 'start' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('control', { action: 'start' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await get()).status, 'paused');
  assert.equal((await post('control', { action: 'delete' })).status, 400);
  assert.equal((await post('control', [])).status, 400);
  assert.equal((await post('control', { action: 'start' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${base}/api/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/control`)).status, 405);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/api`)).status, 404);
  assert.equal((await post('control', { action: 'start', padding: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal(await (await fetch(`${base}/observatory`)).text(), '<main>Fixture UI</main>');
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 400);
  assert.equal((await post('control', { action: 'start' }, { Origin: base })).status, 200);
});

test('deterministic fixture replay has finite bounded state and snapshots cannot mutate the runtime', () => {
  const a = createRuntime({ sessionId: 'replay' });
  const b = createRuntime({ sessionId: 'replay' });
  a.control('start'); b.control('start');
  a.encounter('floral'); b.encounter('floral');
  for (let i = 0; i < 10000; i++) { a.step(); b.step(); }
  assert.deepEqual(a.snapshot(), b.snapshot());
  const snapshot = a.snapshot();
  for (const neuron of snapshot.neural.neurons) {
    assert.ok(Number.isFinite(neuron.potential));
    assert.ok(neuron.potential >= 0 && neuron.potential < 1);
    assert.ok(neuron.rateHz >= 0 && neuron.rateHz <= 200);
  }
  snapshot.neural.neurons[0].potential = NaN;
  assert.ok(Number.isFinite(a.snapshot().neural.neurons[0].potential));
});

test('HTTP quiet remains available during recovery and cancels input without a budget refund', async t => {
  const { post, get } = await fixture(t);
  await post('control', { action: 'start' });
  await post('encounters', { compoundId: 'nectar' });
  const before = await get();
  assert.equal(before.chemistry.find(effect => effect.id === 'quiet').cooldownRemainingMs, 0);
  assert.equal((await post('encounters', { compoundId: 'quiet' })).status, 200);
  const after = await get();
  assert.equal(after.chemistry.some(effect => effect.active), false);
  assert.equal(after.stimulusPolicy.reservedDose, before.stimulusPolicy.reservedDose);
  assert.deepEqual(after.neural, before.neural);
  assert.equal((await post('encounters', { compoundId: 'nectar' })).status, 409);
});

test('configured tailnet host serves UI and controls while other hosts and origins remain rejected', async t => {
  const { base, get } = await fixture(t, { allowedHosts: ['fly.example.ts.net'] });
  const host = `fly.example.ts.net:${new URL(base).port}`;
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method: options.method ?? 'GET', headers: { Host: host, ...options.headers } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text: async () => text }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  assert.equal(await (await request('/')).text(), '<main>Fixture UI</main>');
  assert.equal((await request('/api/health')).status, 200);
  const control = { method: 'POST', body: JSON.stringify({ action: 'start' }), headers: { 'Content-Type': 'application/json', Origin: `http://${host}` } };
  assert.equal((await request('/api/control', control)).status, 200);
  assert.equal((await get()).status, 'running');
  assert.equal((await request('/api/control', { ...control, headers: { ...control.headers, Origin: 'http://other.example.ts.net' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { Host: 'other.example.ts.net' } })).status, 403);
  assert.equal((await request('/api/health', { headers: { Host: 'fly.example.ts.net.attacker.example' } })).status, 403);
});

test('individual HTTP routing rejects cross-recipient envelopes and capacity failures preserve residents', async t => {
  const { openIdentityStore } = await import('./identity-store.js');
  const { createCapacityPolicy } = await import('./population-capacity.js');
  const directory = await mkdtemp(join(tmpdir(), 'fly-population-http-'));
  const identities = openIdentityStore(directory);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const capacity = createCapacityPolicy();
  const { base, post } = await fixture(t, { identities, capacity, incrementalMemoryBytes: 100,
    resourceUsage: () => ({ aggregateMemoryBytes: 1000, availableMemoryBytes: 1024 ** 3 }) });
  const state = id => fetch(`${base}/api/individuals/${id}`).then(r => r.json());
  const send = async (id, operation, data = {}) => {
    const current = await state(id);
    return post(`individuals/${id}/${operation}`, { protocolVersion: 1, individualId: id,
      sessionId: current.sessionId, sequence: current.commandSequence + 1, ...data });
  };
  const a = identities.primaryId, b = identities.create().individualId;
  assert.equal((await send(b, 'load')).status, 409);
  assert.equal(identities.list().filter(value => value.resident).length, 1);
  const settings = { ...capacity.settings(), maxResidentFlies: 2 };
  assert.equal((await post('population', settings, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('population', settings)).status, 200);
  assert.equal((await send(b, 'load')).status, 200);
  assert.equal((await state(b)).status, 'paused');
  assert.equal((await send(b, 'control', { action: 'start', individualId: a })).status, 409);
  assert.equal((await send(b, 'control', { action: 'start' })).status, 200);
  identities.step();
  assert.equal((await state(a)).tick, 0);
  assert.equal((await state(b)).tick, 1);
  await post('population', { ...settings, maxResidentFlies: 1 });
  assert.equal((await fetch(`${base}/api/population`).then(r => r.json())).excessResidents, 1);
  assert.equal((await send(b, 'unload')).status, 200);
  assert.equal((await state(b)).status, 'saved-unloaded');
  assert.equal((await send(b, 'load')).status, 409);
  assert.equal((await send(a, 'unload')).status, 200);
  assert.equal((await send(b, 'load')).status, 200);
  assert.equal((await state(b)).tick, 1);
  assert.equal((await state(b)).status, 'paused');
});

test('recording HTTP APIs preserve source identity and replay never changes live time', async t => {
  const { openIdentityStore } = await import('./identity-store.js');
  const { createRecordingStore, validateRecordingExport } = await import('./recording-store.js');
  const directory = await mkdtemp(join(tmpdir(), 'fly-recording-http-'));
  const identities = openIdentityStore(join(directory, 'identities'));
  const recordings = createRecordingStore({ directory: join(directory, 'recordings') });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { base, get, post } = await fixture(t, { identities, recordings });
  const initial = await get();
  const envelope = { protocolVersion: 1, individualId: initial.individualId, sessionId: initial.sessionId, sequence: 1 };
  assert.equal((await post('recordings', envelope, { Origin: 'https://evil.example' })).status, 403);
  const response = await post('recordings', envelope);
  assert.equal(response.status, 200);
  const session = await response.json();
  await recordings.append(session.id, { individualId: initial.individualId, sessionId: initial.sessionId,
    worldId: 'home', simulationTimeMs: 0, worldTimeMs: 0, wallTimeMs: Date.now(), sourceStartMs: 0, sourceEndMs: 0, ratesHz: [0] });
  assert.equal((await post(`recordings/${session.id}/stop`, {})).status, 200);
  const before = await get();
  const replay = await fetch(`${base}/api/recordings/${session.id}/replay`).then(r => r.json());
  assert.equal(replay.mode, 'read-only');
  assert.equal(replay.canResume, false);
  assert.equal(replay.records[0].individualId, initial.individualId);
  const exported = await fetch(`${base}/api/recordings/${session.id}/export`).then(r => r.json());
  validateRecordingExport(exported);
  assert.equal(exported.complete, true);
  assert.deepEqual(await get(), before);
  assert.equal((await post(`recordings/${session.id}/replay`, {})).status, 405);
  assert.equal((await post(`recordings/${session.id}/delete`, {})).status, 200);
  assert.equal(identities.checkpoints(initial.individualId).length, 1);
});

test('timer captures both individuals fairly and reports overlapping batches without blocking neural steps', async t => {
  const { openIdentityStore } = await import('./identity-store.js');
  const { createRecordingStore } = await import('./recording-store.js');
  const directory = await mkdtemp(join(tmpdir(), 'fly-recording-pair-'));
  const identities = openIdentityStore(join(directory, 'identities'));
  const second = identities.create().individualId;
  identities.load(second);
  let releaseFirst;
  const firstWrite = new Promise(resolve => { releaseFirst = resolve; });
  let writes = 0;
  const recordings = createRecordingStore({ directory: join(directory, 'recordings'), writeChunk: async (...args) => {
    if (++writes === 1) await firstWrite;
    return writeFile(...args);
  } });
  t.after(() => rm(directory, { recursive: true, force: true }));
  t.after(() => releaseFirst());
  const { base, post } = await fixture(t, { identities, recordings, autoTick: true,
    resourceUsage: () => ({ aggregateMemoryBytes: 1, availableMemoryBytes: 1024 ** 3 }) });
  const sessions = [];
  for (const id of [identities.primaryId, second]) {
    identities.control(id, 'start');
    const state = await fetch(`${base}/api/individuals/${id}`).then(r => r.json());
    sessions.push(await (await post('recordings', { protocolVersion: 1, individualId: id,
      sessionId: state.sessionId, sequence: state.commandSequence + 1 })).json());
  }
  const until = async predicate => {
    const deadline = Date.now() + 4000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'sampler condition timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  await until(() => writes === 1);
  const tick = identities.snapshot().tick;
  await until(() => recordings.list().every(s => s.droppedSamples >= 1));
  assert.ok(identities.snapshot().tick > tick, 'neural loop continues while disk write waits');
  releaseFirst();
  await until(() => sessions.every(s => recordings.read(s.id).records.length >= 1));
  for (const s of sessions) {
    await post(`recordings/${s.id}/stop`, {});
    const recorded = recordings.read(s.id);
    assert.ok(recorded.records.length >= 1);
    assert.ok(recorded.session.droppedSamples >= 1);
    assert.equal(recorded.complete, false);
  }
});

test('movement artifact capture exports accepted actions and source completeness without leaking controller lease', async t => {
  const { openIdentityStore } = await import('./identity-store.js');
  const directory = await mkdtemp(join(tmpdir(), 'fly-artifact-http-'));
  const identities = openIdentityStore(directory);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { base, get, post } = await fixture(t, { identities });
  const id = identities.primaryId;
  const send = async (operation, action) => {
    const current = await get();
    return post(`individuals/${id}/${operation}`, { protocolVersion: 1, individualId: id,
      sessionId: current.sessionId, sequence: current.commandSequence + 1, action });
  };
  const attach = await (await send('environment', 'attach')).json();
  const token = attach.controllerToken;
  await send('control', 'start');
  assert.equal((await send('artifacts', 'start')).status, 200);
  let current = await get();
  for (let i = 0; i < 20; i++) {
    const response = await post(`individuals/${id}/environment/frames`, { version: 1, individualId: id,
      sessionId: current.sessionId, environmentEpoch: current.environmentAdapter.environmentEpoch, controllerToken: token,
      frameId: i, simTimeMs: current.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) });
    assert.equal(response.status, 200);
    current = (await response.json()).state;
  }
  const active = await fetch(`${base}/api/individuals/${id}/artifacts/export/json`);
  assert.equal(active.headers.get('x-artifact-partial'), 'true');
  assert.equal((await active.json()).source.capture.complete, false);
  await send('artifacts', 'stop');
  const before = await get();
  const exported = await fetch(`${base}/api/individuals/${id}/artifacts/export/json`).then(r => r.json());
  assert.equal(exported.source.actions.length, 20);
  assert.equal(exported.source.capture.complete, true);
  assert.ok(!JSON.stringify(exported).includes(token));
  for (const format of ['mid','svg','png']) assert.equal((await fetch(`${base}/api/individuals/${id}/artifacts/export/${format}`)).status, 200);
  assert.deepEqual(await get(), before);
});
