import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
import { createCreativeSessions } from './creative-session.js';
import { randomUUID } from 'node:crypto';
function transport() {
  const sessions = new Map(), ids = new Set(); let discoveries = 0, observations = 0;
  return { enabled: true, appId: 'garden', counts: () => ({ discoveries, observations }),
    capabilities: async () => { discoveries++; return { version: 1, appId: 'garden', available: true,
      individualIds: [...ids], worldIds: ['garden-world'], contract: { version: 1, expiryEnforced: true, admissionDeadline: true,
        bodies: ['fly-v1'], actions: ['start', 'pause', 'rest', 'move', 'leave'], controllerRaster: { width: 8, height: 4, channels: 3 } } }; },
    admit: async input => { const lease = { version: 1, sessionId: `visit-${input.individualId}`, appId: 'garden',
      individualId: input.individualId, individualSessionId: input.individualSessionId, worldId: input.worldId, epoch: 'epoch',
      expiresAt: Date.now() + input.ttlMs, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } };
      sessions.set(lease.sessionId, { ...lease, frame: -1 }); return lease; },
    action: async (id, input) => ({ version: 1, sessionId: id, appId: 'garden', individualId: input.individualId,
      individualSessionId: input.individualSessionId, worldId: input.worldId, epoch: input.epoch, sequence: input.sequence,
      expiresAt: sessions.get(id).expiresAt, pose: sessions.get(id).pose, status: { start: 'running', move: 'running', pause: 'paused', rest: 'resting' }[input.action.type] }),
    observe: async (id, input) => { observations++; return { version: 1, sessionId: id, appId: 'garden', ...input,
      frameId: ++sessions.get(id).frame, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4,
      rgb: Array(96).fill(90), pose: sessions.get(id).pose, sensorySource: 'engineered-gentle-patch-spatial-proxy-v1' }; },
    leave: async (id, input) => { sessions.delete(id); return { version: 1, sessionId: id, appId: 'garden', ...input, status: 'left' }; },
    cancel: async input => ({ version: 1, appId: 'garden', ...input, confirmed: true, pending: false, expiresAt: null }),
    allow: id => ids.add(id), sessions,
  };
}
async function setup(t, { autoTick = false, enabled = true, ...serverOptions } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'visitor-http-')), store = openIdentityStore(directory), wire = transport();
  wire.enabled = enabled; wire.allow(store.primaryId);
  const server = createServer({ identities: store, autoTick, visitorTransport: wire, ...serverOptions }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  t.after(async () => { server.close(); await once(server, 'close'); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const state = async () => (await fetch(`${base}/api/individuals/${id}`)).json();
  const command = async (operation, payload = {}, options = {}) => { const current = await state(); return fetch(`${base}/api/individuals/${id}/visitor`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...options.headers }, body: JSON.stringify({ protocolVersion: 1,
      individualId: id, sessionId: current.sessionId, sequence: current.commandSequence + 1, operation, payload, ...options.body }) }); };
  return { base, id, store, wire, command, state };
}
test('visitor HTTP is local-only by default, requires exact same-origin envelopes, and admits paused', async t => {
  const s = await setup(t); const path = `${s.base}/api/individuals/${s.id}/visitor`;
  assert.equal((await (await fetch(path)).json()).visitor.phase, 'home'); assert.equal(s.wire.counts().discoveries, 0);
  const capability = await (await fetch(`${path}?capabilities=1`)).json(); assert.equal(capability.capabilities.available, true); assert.equal(s.wire.counts().discoveries, 1);
  assert.equal((await fetch(`${path}?capabilities=0`)).status, 400);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { headers: { origin: 'https://other.test' } })).status, 403);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { body: { privateHistory: [] } })).status, 409);
  assert.equal((await s.command('admit', { worldId: 'garden-world' }, { body: { sessionId: 'stale' } })).status, 409);
  assert.equal(s.store.snapshot().externalOwner, null);
  const admitted = await (await s.command('admit', { worldId: 'garden-world' })).json();
  assert.equal(admitted.state.status, 'paused'); assert.equal(admitted.visitor.phase, 'visiting'); assert.equal(admitted.state.externalOwner.kind, 'managed-visitor');
  assert.equal(admitted.state.environmentAdapter.attached, false); assert.equal(s.wire.counts().observations, 0);
  const current = await s.state(); const forbidden = await fetch(`${s.base}/api/individuals/${s.id}/control`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, individualId: s.id, sessionId: current.sessionId, sequence: current.commandSequence + 1, action: 'start' }) });
  assert.equal(forbidden.status, 409); assert.equal(s.store.snapshot().status, 'paused');
  assert.equal((await (await s.command('start')).json()).state.status, 'running');
  assert.equal((await (await s.command('rest')).json()).state.status, 'resting');
  const home = await (await s.command('home')).json(); assert.equal(home.state.externalOwner, null); assert.equal(home.visitor.phase, 'home'); assert.equal(home.state.status, 'paused');
});
test('disabled transport cannot acquire local ownership or query broker', async t => {
  const s = await setup(t, { enabled: false }); assert.equal((await s.command('admit', { worldId: 'garden-world' })).status, 409);
  assert.equal(s.store.snapshot().externalOwner, null); assert.equal(s.wire.counts().discoveries, 0);
});
test('server scheduler advances only an explicitly started visit and never advances it twice locally', async t => {
  const s = await setup(t, { autoTick: true }); await s.command('admit', { worldId: 'garden-world' });
  await new Promise(resolve => setTimeout(resolve, 110)); assert.equal(s.store.snapshot().tick, 0);
  await s.command('start');
  const end = Date.now() + 2000;
  while (s.wire.counts().observations < 3 && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  await s.command('pause'); const tick = s.store.snapshot().tick;
  assert(tick >= 3); assert.equal(tick, s.wire.counts().observations);
  await new Promise(resolve => setTimeout(resolve, 110)); assert.equal(s.store.snapshot().tick, tick);
  await s.command('home');
});

test('admission disarms language and ends home neural and movement captures at the ownership boundary', async t => {
  const creativeSessions = createCreativeSessions(), invalidated = [], appended = [];
  const languageService = { snapshot: () => ({ available: false }), lifecycle: id => invalidated.push(id), tick: async () => {}, close() {} };
  const recordings = { start: () => ({ id: randomUUID() }), append: async (id, value) => { appended.push(value); return { session: { status: 'stopped' } }; }, close() {} };
  const s = await setup(t, { autoTick: true, creativeSessions, languageService, recordings });
  s.store.environmentControl(s.id, 'attach'); s.store.control(s.id, 'start'); creativeSessions.start(s.store.snapshot(s.id));
  const state = await s.state();
  assert.equal((await fetch(`${s.base}/api/recordings`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: 1, individualId: s.id, sessionId: state.sessionId, sequence: state.commandSequence + 1 }) })).status, 200);
  await s.command('admit', { worldId: 'garden-world' });
  assert.deepEqual(invalidated, [s.id]); assert.equal(creativeSessions.status(s.id).partial, true); assert.equal(creativeSessions.status(s.id).active, false);
  const end = Date.now() + 2000;
  while (!appended.length && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(appended, [{ sessionId: null }]);
  await s.command('home');
});
