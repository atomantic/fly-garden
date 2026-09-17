import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
import { RETINAL_ADAPTER } from './environment-adapter.js';

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'fly-freshness-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

const frameFor = (state, controllerToken, rgb = Array(96).fill(255)) => ({
  controllerToken, version: 1, individualId: state.individualId, sessionId: state.sessionId,
  environmentEpoch: state.environmentAdapter.environmentEpoch, frameId: state.environmentAdapter.lastFrameId + 1,
  simTimeMs: state.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb,
});

/**
 * The registry timer (`store.step()`, driven by the server's interval) must not free-run an
 * attached recipient. Covers the wiring in identity-store `stepIndividual`, not only the
 * adapter's own `checkFreshness` unit behaviour.
 */
test('registry timer pauses an attached recipient and revokes encounters when rendering stops, never stepping from stale frames', async t => {
  const store = openIdentityStore(directory(t)); t.after(() => store.close());
  const attached = store.primaryId, free = store.create().individualId; store.load(free);
  const lease = store.environmentControl(attached, 'attach');
  store.control(attached, 'start'); store.control(free, 'start');

  store.environmentFrame(attached, frameFor(store.snapshot(attached), lease.controllerToken));
  const accepted = store.snapshot(attached);
  const epoch = accepted.environmentAdapter.environmentEpoch;
  assert.equal(accepted.tick, 1);
  store.encounterDynamicsControl(attached, true);
  assert.equal(store.snapshot(attached).encounterDynamics.enabled, true);

  // While frames are fresh the timer only checks freshness: it never advances the attached
  // fixture, and the unattached neighbour keeps its own independent clock through the same timer.
  for (let i = 0; i < 25; i++) store.step();
  const held = store.snapshot(attached);
  assert.equal(held.tick, 1); assert.equal(held.simTimeMs, accepted.simTimeMs);
  assert.equal(held.status, 'running');
  assert.equal(held.environmentAdapter.environmentEpoch, epoch);
  assert.equal(held.encounterDynamics.enabled, true);
  assert.equal(store.snapshot(free).tick, 25);

  // Rendering stops. Nothing else changes; only the observation ages past the adapter bound.
  await delay(RETINAL_ADAPTER.maxAgeMs + 20);
  const neural = store.snapshot(attached).neural;
  store.step();

  const paused = store.snapshot(attached);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.tick, 1);
  assert.equal(paused.simTimeMs, accepted.simTimeMs);
  assert.deepEqual(paused.neural, neural);
  assert.notEqual(paused.environmentAdapter.environmentEpoch, epoch);
  assert.equal(paused.environmentAdapter.attached, true);
  assert.deepEqual(paused.environmentAdapter.pose, accepted.environmentAdapter.pose);
  assert.deepEqual(paused.environmentAdapter.motor, { forward: 0, yaw: 0 });
  assert.equal(paused.environmentAdapter.lastFrameId, -1);
  assert.equal(paused.encounterDynamics.enabled, false);
  assert.equal(paused.encounterDynamics.phase, 'disabled');
  assert.equal(store.snapshot(free).status, 'running');

  // Further timer ticks neither free-run the paused recipient nor rotate the epoch again.
  const rotated = paused.environmentAdapter.environmentEpoch;
  for (let i = 0; i < 50; i++) store.step();
  const idle = store.snapshot(attached);
  assert.equal(idle.tick, 1);
  assert.equal(idle.environmentAdapter.environmentEpoch, rotated);
  assert.equal(store.snapshot(free).tick, 76);

  // A frame captured before the pause is bound to the retired epoch and cannot resume time.
  assert.throws(() => store.environmentFrame(attached, frameFor(accepted, lease.controllerToken)), /epoch/);
  assert.equal(store.snapshot(attached).tick, 1);
  // Even a frame rebuilt on the rotated epoch is refused until the caretaker explicitly resumes.
  assert.throws(() => store.environmentFrame(attached, frameFor(idle, lease.controllerToken)), /run the fixture/);
  assert.equal(store.snapshot(attached).tick, 1);

  // Explicit resume plus a fresh frame is what restarts neural time; the lease survives the pause.
  store.control(attached, 'start');
  const resumed = store.snapshot(attached);
  store.environmentFrame(attached, frameFor(resumed, lease.controllerToken));
  assert.equal(store.snapshot(attached).tick, 2);
});

test('HTTP fresh arrival after a rendering gap pauses before a registry tick and requires explicit resume', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const store = openIdentityStore(directory(t)); t.after(() => store.close());
  const server = createServer({ identities: store, autoTick: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  const post = body => fetch(`${base}/api/individuals/${id}/environment/frames`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const lease = store.environmentControl(id, 'attach'); store.control(id, 'start');
  assert.equal((await post(frameFor(store.snapshot(id), lease.controllerToken))).status, 200);
  store.encounterDynamicsControl(id, true);
  const before = store.snapshot(id);
  clock += RETINAL_ADAPTER.maxAgeMs + 1;
  const late = await post(frameFor(before, lease.controllerToken));
  assert.equal(late.status, 409);
  assert.match((await late.json()).error, /stale/);
  const paused = store.snapshot(id);
  assert.equal(paused.status, 'paused'); assert.equal(paused.tick, before.tick);
  assert.equal(paused.simTimeMs, before.simTimeMs);
  assert.deepEqual(paused.neural, before.neural);
  assert.deepEqual(paused.environmentAdapter.pose, before.environmentAdapter.pose);
  assert.deepEqual(paused.environmentAdapter.motor, { forward: 0, yaw: 0 });
  assert.notEqual(paused.environmentAdapter.environmentEpoch, before.environmentAdapter.environmentEpoch);
  assert.equal(paused.encounterDynamics.enabled, false);
  assert.equal(paused.encounterDynamics.phase, 'disabled');
  assert.equal((await post(frameFor(paused, lease.controllerToken))).status, 409);
  store.step(); assert.equal(store.snapshot(id).tick, before.tick);
  store.control(id, 'start');
  assert.equal((await post(frameFor(store.snapshot(id), lease.controllerToken))).status, 200);
  assert.equal(store.snapshot(id).tick, before.tick + 1);
});

test('HTTP registry tick pauses a controller whose browser stopped posting frames', async t => {
  const store = openIdentityStore(directory(t)); t.after(() => store.close());
  const server = createServer({ identities: store, autoTick: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, id = store.primaryId;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const read = async () => (await fetch(`${base}/api/individuals/${id}/environment`)).json();

  const command = (path, action, sequence) => post(path, { protocolVersion: 1, individualId: id,
    sessionId: store.snapshot(id).sessionId, sequence, action });
  const attach = await (await command(`/api/individuals/${id}/environment`, 'attach', 1)).json();
  const token = attach.controllerToken;
  assert.match(token, /^[0-9a-f]{64}$/);
  await command(`/api/individuals/${id}/control`, 'start', 2);
  const state = store.snapshot(id);
  const accepted = await post(`/api/individuals/${id}/environment/frames`, frameFor(state, token));
  assert.equal(accepted.status, 200);
  const running = await read();
  assert.equal(running.attached, true);
  assert.equal(store.snapshot(id).tick, 1);

  await delay(RETINAL_ADAPTER.maxAgeMs + 20);
  store.step();
  const stopped = await read();
  assert.equal(store.snapshot(id).status, 'paused');
  assert.equal(store.snapshot(id).tick, 1);
  assert.notEqual(stopped.environmentEpoch, running.environmentEpoch);
  // The stale in-flight frame the browser was about to send is rejected, not applied.
  const late = await post(`/api/individuals/${id}/environment/frames`, frameFor(state, token));
  assert.equal(late.status, 409);
  assert.equal(store.snapshot(id).tick, 1);
});
