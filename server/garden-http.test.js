import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fly-garden-http-'));
  const identities = openIdentityStore(directory);
  const server = createServer({ identities, autoTick: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = id => fetch(`${base}/api/individuals/${id}`).then(r => r.json());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const command = async (id, operation, fields, headers) => {
    const s = await state(id);
    return post(`/api/individuals/${id}/${operation}`, { protocolVersion: 1, individualId: id,
      sessionId: s.sessionId, sequence: s.commandSequence + 1, ...fields }, headers);
  };
  return { identities, base, state, post, command };
}

test('garden HTTP enablement is deliberate, session-scoped and revoked by lifecycle', async t => {
  const { identities, base, state, command } = await fixture(t), id = identities.primaryId;
  let status = await fetch(`${base}/api/individuals/${id}/garden`).then(r => r.json());
  assert.equal(status.enabled, false); assert.ok(status.catalog.every(effect => effect.evidence.includes('engineered')));
  assert.equal((await command(id, 'garden', { enabled: true })).status, 409);
  const attached = await command(id, 'environment', { action: 'attach' }).then(r => r.json());
  assert.match(attached.controllerToken, /^[0-9a-f]{64}$/);
  assert.equal((await command(id, 'control', { action: 'start' })).status, 200);
  let response = await command(id, 'garden', { enabled: true }); assert.equal(response.status, 200);
  const enabled = await response.json(); assert.equal(enabled.encounterDynamics.enabled, true);
  assert.equal(enabled.encounterDynamics.phase, 'armed-awaiting-observation'); assert.equal(enabled.stimulusPolicy.reservedDose, 0);
  assert.equal(Object.hasOwn(enabled, 'controllerToken'), false);
  assert.equal((await command(id, 'garden', { enabled: false })).status, 200);
  assert.equal((await state(id)).encounterDynamics.enabled, false);
  await command(id, 'garden', { enabled: true }); await command(id, 'control', { action: 'rest' });
  assert.equal((await state(id)).encounterDynamics.enabled, false);
  await command(id, 'control', { action: 'start' }); assert.equal((await state(id)).encounterDynamics.enabled, false);
});

test('shared garden HTTP controls preserve per-recipient opt-in and quiet lifecycle boundaries', async t => {
  const { identities, state, command } = await fixture(t), a = identities.primaryId;
  const b = identities.create().individualId;
  identities.load(b);
  const shared = identities.sharedJoin([a, b], 2);
  assert.equal((await command(a, 'garden', { enabled: true })).status, 409);
  identities.sharedControl(shared.sharedId, 'start');
  assert.equal((await state(a)).environmentAdapter.attached, false);
  const partnerBefore = await state(b);
  const response = await command(a, 'garden', { enabled: true });
  assert.equal(response.status, 200);
  const enabled = await response.json();
  assert.equal(enabled.encounterDynamics.enabled, true);
  assert.equal(enabled.encounterDynamics.environmentEpoch, enabled.sharedSession.worldEpoch);
  assert.equal(enabled.stimulusPolicy.reservedDose, 0);
  assert.equal(Object.hasOwn(enabled, 'controllerToken'), false);
  const partnerAfter = await state(b);
  assert.deepEqual(partnerAfter.encounterDynamics, partnerBefore.encounterDynamics);
  assert.deepEqual(partnerAfter.stimulusPolicy, partnerBefore.stimulusPolicy);
  assert.equal(partnerAfter.commandSequence, partnerBefore.commandSequence);
  assert.equal((await command(a, 'garden', { enabled: false })).status, 200);
  assert.equal((await state(a)).encounterDynamics.enabled, false);
  assert.equal((await command(a, 'garden', { enabled: true })).status, 200);
  assert.equal((await command(b, 'garden', { enabled: true })).status, 200);
  assert.equal((await command(a, 'control', { action: 'rest' })).status, 200);
  assert.equal((await state(a)).encounterDynamics.enabled, false);
  assert.equal((await state(b)).encounterDynamics.enabled, true);
  assert.equal((await command(a, 'garden', { enabled: true })).status, 409);
  identities.sharedControl(shared.sharedId, 'pause');
  assert.equal((await state(b)).encounterDynamics.enabled, false);
  assert.equal((await command(b, 'garden', { enabled: true })).status, 409);
  identities.sharedControl(shared.sharedId, 'start');
  assert.equal((await state(b)).encounterDynamics.enabled, false);
});

test('garden rejects cross-origin, stale or cross-recipient commands and unsupported fields/values', async t => {
  const { identities, state, command, post, base } = await fixture(t), a = identities.primaryId;
  const b = identities.create().individualId;
  const aState = await state(a), route = `/api/individuals/${a}/garden`;
  const envelope = { protocolVersion: 1, individualId: a, sessionId: aState.sessionId, sequence: aState.commandSequence + 1, enabled: false };
  assert.equal((await post(route, envelope, { Origin: 'https://invalid.example' })).status, 403);
  assert.equal((await post(route, { ...envelope, individualId: b })).status, 409);
  assert.equal((await post(route, { ...envelope, sessionId: 'stale' })).status, 409);
  assert.equal((await post(route, { ...envelope, compound: 'unsupported' })).status, 409);
  assert.equal((await command(a, 'garden', { enabled: 'yes' })).status, 400);
  assert.equal((await command(a, 'garden', { enabled: false })).status, 200);
  assert.equal((await post(route, envelope)).status, 409);
  assert.equal((await state(a)).encounterDynamics.enabled, false); assert.equal((await state(b)).encounterDynamics.enabled, false);
  assert.equal((await fetch(base + route, { method: 'DELETE' })).status, 405);
});
