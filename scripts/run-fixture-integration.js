import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIdentityStore } from '../server/identity-store.js';
import { createServer } from '../server/index.js';
import { RUNTIME_DATASET } from '../server/runtime.js';
import { createHostDouble } from './fixture-integration/host-double.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const unavailable = [
  ['live-managed-host', 'No PortOS/Eidoverse process, production broker or credential is used.'],
  ['rendered-observer', 'No browser or rendered host observer is exercised.'],
  ['full-connectome-embodiment', 'Only the synthetic 32-neuron fixture is loaded.'],
  ['retained-learning', 'Fixture has no plasticity or RNG state; the separate learning campaign remains negative.'],
  ['language-provider', 'No provider is configured or armed.'],
  ['production-restart', 'Temporary-store reopen is not fresh-clone, PM2 or worker-crash verification.'],
  ['remaining-fault-campaign', 'Expiry, revocation, numerical faults and corrupt durable restore need separate integrated evidence.'],
];

function provenance() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { revision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=normal']).length > 0,
    node: process.version, platform: process.platform, architecture: process.arch,
    dataset: RUNTIME_DATASET, host: 'in-process-synthetic-double-v1',
    dependencyLockSha256: sha256(readFileSync(join(root, 'package-lock.json'))),
    harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    hostDoubleSha256: sha256(readFileSync(join(root, 'scripts/fixture-integration/host-double.js'))) };
}

/** Explicit bounded test run. Never opens the user's catalog, discovers a host, or calls a provider. */
export async function runFixtureIntegration({ hostFactory = createHostDouble } = {}) {
  const report = { schemaVersion: 1, scope: 'synthetic-fixture-http-integration',
    disclosure: 'Engineered sensory arrays and host double; not a rendered garden, live Eidoverse, learning or biological acceptance.',
    provenance: provenance(), checks: [], unavailable: unavailable.map(([id, reason]) => ({ id, outcome: 'unavailable', reason })),
    integrationAcceptance: 'unavailable' };
  const directory = mkdtempSync(join(tmpdir(), 'fly-fixture-integration-'));
  let store, server, base, id, step = 'setup';
  const check = (name, evidence = {}) => report.checks.push({ id: name, outcome: 'pass', evidence });
  const get = async path => {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    assert.equal(response.status, 200); return response.json();
  };
  const state = () => get(`/api/individuals/${id}`);
  const post = async (path, body, expected = 200) => {
    const response = await fetch(`${base}/api/individuals/${id}/${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000), redirect: 'error' });
    assert.equal(response.status, expected); return response.json();
  };
  const command = async (path, body, expected = 200) => {
    const current = await state();
    return post(path, { protocolVersion: 1, individualId: id, sessionId: current.sessionId,
      sequence: current.commandSequence + 1, ...body }, expected);
  };
  const visit = (operation, payload = {}) => command('visitor', { operation, payload });
  const waitFor = async predicate => {
    const deadline = Date.now() + 5000;
    do { const current = await state(); if (predicate(current)) return current; await delay(10); } while (Date.now() < deadline);
    throw new Error('Bounded fixture wait failed.');
  };
  const close = async () => {
    if (server?.listening) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
    // The server closes its services asynchronously on close. Store.close is idempotent.
    store?.close();
  };
  try {
    store = openIdentityStore(directory); id = store.primaryId;
    const host = hostFactory(id);
    const listen = async () => {
      server = createServer({ identities: store, autoTick: true, visitorTransport: host.transport, languageProviders: [] });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      base = `http://127.0.0.1:${server.address().port}`;
    };
    await listen();
    step = 'paused-boot-and-observer';
    const boot = await state(); await get('/api/health'); await state(); await delay(75);
    assert.equal((await state()).tick, 0); assert.equal(boot.status, 'paused');
    assert.equal(host.counts().calls, 0);
    check(step, { tick: 0, hostCalls: 0 });

    step = 'garden-to-artifact';
    const attached = await command('environment', { action: 'attach' });
    await command('control', { action: 'start' }); await command('artifacts', { action: 'start' });
    let current = await state(), lastFrame;
    for (let frameId = 0; frameId < 40; frameId++) {
      lastFrame = { version: 1, individualId: id, sessionId: current.sessionId,
        environmentEpoch: current.environmentAdapter.environmentEpoch, controllerToken: attached.controllerToken,
        frameId, simTimeMs: current.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4,
        rgb: Array(96).fill(255) };
      current = (await post('environment/frames', lastFrame)).state;
    }
    await command('artifacts', { action: 'stop' });
    const artifact = await get(`/api/individuals/${id}/artifacts/export/json`);
    assert.equal(artifact.source.actions.length, 40); assert.equal(artifact.source.capture.complete, true);
    assert(artifact.source.actions.every(action => action.individualId === id && action.sessionId === boot.sessionId));
    assert(!JSON.stringify(artifact).includes(attached.controllerToken));
    const formats = {};
    for (const format of ['mid', 'svg', 'png']) {
      const response = await fetch(`${base}/api/individuals/${id}/artifacts/export/${format}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
      formats[format] = { bytes: bytes.length, sha256: sha256(bytes) };
    }
    check(step, { tick: current.tick, acceptedActions: artifact.source.actions.length,
      events: artifact.events.length, formats, note: 'An exported MIDI container does not establish a melody or learned choice.' });

    step = 'replayed-garden-frame';
    const beforeReplay = await state(); await post('environment/frames', lastFrame, 409);
    const afterReplay = await state(); assert.equal(afterReplay.tick, beforeReplay.tick);
    await command('control', { action: 'pause' });
    check(step, { rejected: true, tick: afterReplay.tick });
    const saved = await command('checkpoints', {});

    step = 'acknowledged-visit-and-return';
    const admitted = await visit('admit', { worldId: 'fixture-world' });
    assert.equal(admitted.visitor.phase, 'visiting'); assert.equal(admitted.state.status, 'paused');
    assert.equal(admitted.state.environmentAdapter.attached, false);
    await command('control', { action: 'start' }, 409);
    await command('visitor', { operation: 'admit', payload: { worldId: 'fixture-world' } }, 409);
    assert.equal((await state()).visitor.visitEpoch, admitted.visitor.visitEpoch);
    await visit('interact'); await visit('start');
    const advanced = await waitFor(value => value.tick > saved.tick);
    const returned = (await visit('home')).state;
    assert.equal(returned.status, 'paused'); assert.equal(returned.externalOwner, null);
    assert.equal(returned.individualId, saved.individualId); assert.equal(returned.sessionId, saved.sessionId);
    assert.equal(returned.persistence.checkpointId, saved.persistence.checkpointId);
    assert.equal(returned.persistence.checkpointCount, saved.persistence.checkpointCount);
    assert.deepEqual(returned.persistence.branchOf, saved.persistence.branchOf);
    assert(returned.tick >= advanced.tick && returned.tick <= saved.tick + 3);
    check(step, { homeTick: saved.tick, returnedTick: returned.tick, identityPreserved: true,
      sessionPreserved: true, checkpointPreserved: true, hostSteps: host.counts().steps,
      interactionAcknowledged: advanced.visitor.lastInteraction !== null });

    for (const mode of ['denied', 'old-version', 'stale-frame', 'prior-epoch', 'disconnect']) {
      step = mode; host.setMode(mode); const before = await state();
      const result = await visit('admit', { worldId: 'fixture-world' });
      if (['denied', 'old-version'].includes(mode)) {
        assert.equal(result.visitor.phase, 'blocked'); assert.equal(result.visitor.owned, false);
      } else {
        assert.equal(result.visitor.phase, 'visiting');
        assert.notEqual(result.visitor.visitEpoch, admitted.visitor.visitEpoch);
        await visit('start'); await waitFor(value => !value.visitor.owned);
      }
      const after = await state(); assert.equal(after.tick, before.tick); assert.equal(after.status, 'paused');
      assert.equal(after.externalOwner, null); assert.equal(after.sessionId, before.sessionId);
      assert.equal(after.persistence.checkpointId, before.persistence.checkpointId);
      check(step, { rejectedWithoutAdvancement: true, tick: after.tick });
    }

    step = 'saved-paused-reopen';
    const checkpoint = await command('checkpoints', {}); const oldSession = checkpoint.sessionId;
    await close(); store = openIdentityStore(directory); host.setMode('supported'); await listen();
    const recovered = await state();
    assert.equal(recovered.individualId, id); assert.notEqual(recovered.sessionId, oldSession);
    assert.equal(recovered.persistence.checkpointId, checkpoint.persistence.checkpointId);
    assert.equal(recovered.tick, checkpoint.tick); assert.equal(recovered.status, 'paused');
    assert.equal(recovered.environmentAdapter.attached, false); assert.equal(recovered.externalOwner, null);
    await delay(75); assert.equal((await state()).tick, recovered.tick);
    check(step, { identityPreserved: true, checkpointPreserved: true, freshSession: true, tick: recovered.tick });
    report.outcome = 'pass';
  } catch {
    // Never publish raw exceptions, response bodies, credentials, local paths or private environment values.
    report.checks.push({ id: step, outcome: 'failed', evidence: { reason: 'Fixture assertion or operation failed; reproduce locally to diagnose.' } });
    report.outcome = 'failed';
  } finally {
    await close(); rmSync(directory, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.error('Explicit invocation required: node scripts/run-fixture-integration.js --run');
    process.exitCode = 2;
  } else {
    try {
      const report = await runFixtureIntegration();
      console.log(JSON.stringify(report, null, 2)); process.exitCode = report.outcome === 'pass' ? 0 : 1;
    } catch {
      console.error('Fixture harness setup or cleanup failed; no acceptance result is available.'); process.exitCode = 1;
    }
  }
}
