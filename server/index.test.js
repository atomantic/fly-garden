import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './index.js';
import { createRuntime } from './runtime.js';

async function fixture(t) {
  const distDir = await mkdtemp(join(tmpdir(), 'fly-garden-test-'));
  await writeFile(join(distDir, 'index.html'), '<main>Fixture UI</main>');
  const runtime = createRuntime();
  const server = createServer({ runtime, autoTick: false, distDir });
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
