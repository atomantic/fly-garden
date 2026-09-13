import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSharedCreativeHttp } from './shared-creative-http.js';
import { createSharedCreativeSessions } from './shared-creative-session.js';
import { exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG, validateCreativeSource } from './creative-artifacts.js';
import { readSharedCapture, newestSharedCapture } from '../client/src/shared-capture-state.js';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
const dataset = { namespace: 'synthetic-fixture', release: '1', modelId: 'synthetic-lif-v1' };
function fixture() {
  const captures = createSharedCreativeSessions();
  const states = ['one', 'two'].map(individualId => ({ individualId, sessionId: `${individualId}-session`, source: 'fixture', dataset,
    model: { id: 'synthetic-lif-v1' }, persistence: { checkpointId: `${individualId}-save` } }));
  const shared = { sharedId: 'world', worldEpoch: 'epoch', status: 'running', tick: 0, worldTimeMs: 0, lastReceivedAtMs: 1000,
    participants: states.map((s, i) => ({ individualId: s.individualId, sessionId: s.sessionId, simTimeMs: 0, pose: { x: i ? -0.5 : 0, z: i ? 0 : 1.079, yaw: 0 } })) };
  const command = (action, extra = {}) => captures.command(shared.sharedId, { protocolVersion: 1, sharedId: shared.sharedId,
    worldEpoch: action === 'start' ? shared.worldEpoch : captures.status(shared.sharedId).worldEpoch,
    captureSequence: captures.status(shared.sharedId).captureSequence, action, ...extra }, shared, states);
  const batch = (move = true) => {
    const oldTick = shared.tick; shared.tick++; shared.worldTimeMs += 5; shared.lastReceivedAtMs += 5;
    for (const p of shared.participants) p.simTimeMs += 5;
    if (move) shared.participants[0].pose.z += 0.002;
    return shared.participants.map(p => ({ individualId: p.individualId, sessionId: p.sessionId, environmentEpoch: shared.worldEpoch,
      frameId: oldTick, outputSimTimeMs: p.simTimeMs, pose: { ...p.pose } }));
  };
  return { captures, shared, states, command, batch };
}
test('complete accepted batches produce attributed joint artifacts with silent independent participants', () => {
  const f = fixture(); f.command('start'); f.captures.capture(f.shared, f.batch()); f.command('stop');
  const result = JSON.parse(f.captures.export('world', 'json').bytes);
  assert.equal(result.source.capture.complete, true); assert.equal(result.source.actions.length, 2);
  assert.equal(result.events.filter(e => e.kind === 'note').length, 1);
  assert(result.events.every(e => e.individualId === 'one')); assert.equal(result.source.actions[1].kind, 'rest');
  assert.deepEqual(result.source.participantProvenance.map(p => p.checkpointId), ['one-save', 'two-save']);
  for (const [format, render] of Object.entries({ json: exportCreativeJSON, mid: exportCreativeMIDI, svg: exportCreativeSVG, png: exportCreativePNG })) {
    assert.deepEqual(f.captures.export('world', format).bytes, render(result.source));
  }
  assert(f.captures.export('world', 'mid').bytes.includes(Buffer.from('two-save')));
  assert.throws(() => validateCreativeSource({ ...result.source, participantProvenance: [result.source.participantProvenance[0], result.source.participantProvenance[0]] }));
  const wrong = structuredClone(result.source); wrong.participantProvenance[0].sessionId = 'foreign'; assert.throws(() => validateCreativeSource(wrong));
});
test('invalid or missing action batches keep only the last complete prefix and stop capture', () => {
  for (const alter of [traces => traces.slice(1), traces => [traces[0], traces[0]], traces => traces.map(t => ({ ...t, environmentEpoch: 'old' }))]) {
    const f = fixture(); f.command('start'); f.captures.capture(f.shared, f.batch());
    f.captures.capture(f.shared, alter(f.batch())); const source = JSON.parse(f.captures.export('world', 'json').bytes).source;
    assert.equal(source.actions.length, 2); assert.equal(source.capture.complete, false); assert.equal(f.captures.status('world').active, false);
  }
});
test('lifecycle discontinuity and capture bounds preserve artifacts without neural actions or implicit replacement', () => {
  const f = fixture(); f.command('start'); assert.throws(() => f.command('discard')); assert.throws(() => f.command('start'));
  for (let i = 0; i < 513; i++) f.captures.capture(f.shared, f.batch(false));
  assert.equal(f.captures.status('world').actionCount, 1024); assert.equal(f.captures.status('world').partial, true);
  assert.equal(JSON.parse(f.captures.export('world', 'json').bytes).events.length, 0);
  const oldSequence = f.captures.status('world').captureSequence; f.command('discard');
  assert.throws(() => f.command('start', { captureSequence: oldSequence }));
  f.command('start'); f.shared.worldEpoch = 'resumed-epoch'; f.captures.synchronize('world', f.shared);
  assert.equal(f.captures.status('world').active, false); assert.equal(f.captures.status('world').partial, true);
  f.captures.synchronize('world', null); assert.equal(f.captures.list().length, 1); assert(f.captures.export('world', 'json').partial);
});
test('capture metadata cannot change retained participants and UI rejects foreign or older sources', () => {
  const f = fixture(); f.command('start'); const original = f.captures.status('world'); original.participantIds.reverse();
  assert.deepEqual(f.captures.status('world').participantIds, ['one', 'two']);
  assert.equal(newestSharedCapture(null, null), null);
  const current = readSharedCapture(f.captures.status('world'), 'world');
  assert.throws(() => readSharedCapture(current, 'other'));
  assert.equal(newestSharedCapture(current, { ...current, captureSequence: 0 }), current);
  const terminal = { ...current, active: false, partial: true, reason: 'World separated' };
  assert.equal(newestSharedCapture(terminal, current), terminal);
  assert.equal(newestSharedCapture(current, terminal), terminal);
  assert.equal(newestSharedCapture(terminal, { ...terminal, partial: false, reason: null }), terminal);
  const later = { ...current, actionCount: 2 }; assert.equal(newestSharedCapture(later, current), later);
  assert.equal(newestSharedCapture(later, { ...current, captureSequence: 2, captureId: null }).captureId, null);
});
test('HTTP capture sees actual shared commits, has independent sequences, and never advances on capture/export', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'shared-artifact-http-')), identities = openIdentityStore(directory);
  const ids = [identities.primaryId, identities.create().individualId]; identities.load(ids[1]);
  const app = createServer({ identities, autoTick: false }); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); rmSync(directory, { recursive: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = path => fetch(base + path).then(r => r.json());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const states = await Promise.all(ids.map(id => get(`/api/individuals/${id}`)));
  const joined = await (await post('/api/shared/join', { protocolVersion: 1, members: states.map(s => ({ protocolVersion: 1,
    individualId: s.individualId, sessionId: s.sessionId, sequence: s.commandSequence + 1 })) })).json();
  let shared = joined.shared; const path = `/api/shared/${shared.sharedId}/artifacts`;
  const control = async action => { shared = (await (await post(`/api/shared/${shared.sharedId}/control`, { protocolVersion: 1,
    sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, action })).json()).shared; };
  await control('start');
  const body = { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, captureSequence: 0, action: 'start' };
  assert.equal((await post(path, body, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await post(path, body)).status, 200); assert.equal((await post(path, body)).status, 409);
  assert.equal((await get(`/api/shared/${shared.sharedId}`)).shared.tick, 0);
  assert.equal((await get(`/api/shared/${shared.sharedId}`)).shared.commandSequence, 1);
  const frame = { controllerToken: joined.controllerToken, worldEpoch: shared.worldEpoch, worldTick: shared.tick,
    frames: shared.participants.map(p => ({ version: 1, individualId: p.individualId, sessionId: p.sessionId, environmentEpoch: shared.worldEpoch,
      frameId: shared.tick, simTimeMs: p.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) })) };
  const accepted = await post(`/api/shared/${shared.sharedId}/frames`, frame); assert.equal(accepted.status, 200); shared = (await accepted.json()).shared;
  assert.equal((await get(path)).actionCount, 2); const before = ids.map(id => identities.snapshot(id));
  const exportResult = await get(`${path}/export/json`); assert.equal(exportResult.source.actions.length, 2);
  assert.deepEqual(ids.map(id => identities.snapshot(id)), before);
  await control('separate'); const after = await get(path); assert.equal(after.active, false); assert.equal(after.partial, true);
  assert.equal((await get('/api/shared/artifacts')).captures.length, 1);
  assert.equal((await fetch(`${base}${path}/export/png`)).status, 200);
});

test('HTTP capture refreshes source after a delayed body rather than starting from stale state', async () => {
  for (const transition of ['pause', 'separate', 'advance']) {
    const f = fixture(); let live = structuredClone(f.shared), finishBody, bodyStarted;
    const started = new Promise(resolve => { bodyStarted = resolve; });
    const body = new Promise(resolve => { finishBody = resolve; });
    const replies = [];
    const handler = createSharedCreativeHttp({ identities: {
      sharedSnapshot: () => live && structuredClone(live), snapshot: id => f.states.find(s => s.individualId === id),
    }, captures: f.captures, readBody: () => { bodyStarted(); return body; }, json: (_, code, value) => replies.push({ code, value }) });
    // Use a valid route ID while retaining the fixture's source identity.
    f.shared.sharedId = 'abc'; live.sharedId = 'abc';
    const pending = handler({ method: 'POST' }, {}, new URL('http://localhost/api/shared/abc/artifacts'));
    await started;
    if (transition === 'pause') live.status = 'paused';
    if (transition === 'separate') live = null;
    if (transition === 'advance') { f.batch(); live = structuredClone(f.shared); }
    finishBody({ protocolVersion: 1, sharedId: 'abc', worldEpoch: 'epoch', captureSequence: 0, action: 'start' });
    await pending;
    if (transition !== 'advance') {
      assert.equal(replies[0].code, 409); assert.equal(f.captures.status('abc').active, false);
    } else {
      assert.equal(replies[0].code, 200);
      const from = structuredClone(f.shared.participants[0].pose);
      f.captures.capture(f.shared, f.batch());
      assert.equal(f.captures.status('abc').active, true);
      const source = JSON.parse(f.captures.export('abc', 'json').bytes).source;
      assert.equal(source.actions.length, 2);
      assert.deepEqual(source.actions[0].from, { x: (from.x + 2) / 4, y: (from.z + 2) / 4 });
    }
  }
});
