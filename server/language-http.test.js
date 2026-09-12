import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from './index.js';
import { openIdentityStore } from './identity-store.js';

async function setup(t, generate) {
  const directory = await mkdtemp(join(tmpdir(), 'fly-language-http-'));
  const identities = openIdentityStore(directory);
  const id = identities.primaryId;
  const server = createServer({ identities, autoTick: false, languageProviders: generate ? [{
    providerId: 'test', model: 'fixture', requestTokens: 4096, requestSpendMicros: 0, maxOutputTokens: 10, generate,
  }] : [] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/individuals/${id}`;
  const state = () => fetch(base).then(r => r.json());
  const language = () => fetch(`${base}/language`).then(r => r.json());
  const post = async (operation, payload, extra = {}) => {
    const current = await state();
    return fetch(`${base}/language`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify({ protocolVersion: 1, individualId: id, sessionId: current.sessionId, sequence: current.commandSequence + 1, operation, payload }) });
  };
  return { base, identities, id, state, language, post };
}
const config = { providerId: 'test', model: 'fixture', maxCalls: 3, maxTokens: 12288, maxSpendMicros: 0,
  cooldownMs: 1000, detectorThresholdHz: 1, detectorEnabled: false };

test('language HTTP defaults unavailable and reads never call a provider', async t => {
  const app = await setup(t);
  assert.deepEqual((await app.language()).providers, []);
  assert.equal((await app.language()).armed, false);
  assert.equal((await app.post('arm', config)).status, 409);
  assert.equal((await app.state()).status, 'paused');
});

test('language HTTP requires same-origin explicit arming, binds server evidence, and has no neural feedback', async t => {
  const seen = [];
  const app = await setup(t, async request => {
    seen.push(request);
    return { text: 'Uncertain fixture observation.', totalTokens: 5 };
  });
  const before = await app.state();
  await app.language(); await app.state();
  assert.equal(seen.length, 0);
  assert.equal((await app.post('arm', config, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.post('arm', config)).status, 200);
  assert.equal(seen.length, 0);
  const bad = await app.post('chat', { requestId: 'bad', message: 'Explain', windowId: null, evidence: {} });
  assert.equal(bad.status, 409);
  assert.equal(seen.length, 0);
  const response = await app.post('chat', { requestId: 'one', message: 'Explain', windowId: null });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(seen.length, 1);
  assert.equal(result.language.reserved.calls, 1);
  assert.deepEqual(result.state.neural, before.neural);
  assert.equal(result.state.status, 'paused');
  assert.equal((await app.post('disarm', {})).status, 200);
  assert.equal((await app.language()).armed, false);
});

test('same-state pause cancels an in-flight language result without refund', async t => {
  let release, entered;
  const called = new Promise(resolve => { entered = resolve; });
  const app = await setup(t, async () => { entered(); return new Promise(resolve => { release = resolve; }); });
  await app.post('arm', config);
  const pending = app.post('chat', { requestId: 'pending', message: 'Explain', windowId: null });
  await called;
  const current = await app.state();
  const pause = await fetch(`${app.base}/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, individualId: app.id, sessionId: current.sessionId, sequence: current.commandSequence + 1, action: 'pause' }) });
  assert.equal(pause.status, 200);
  release({ text: 'Late interpretation.', totalTokens: 5 });
  const result = await (await pending).json();
  assert.equal(result.language.armed, false);
  assert.equal(result.language.reserved.calls, 1);
  assert.equal(result.result.interpretation, undefined);
  assert.equal(result.result.status, 'canceled');
});
