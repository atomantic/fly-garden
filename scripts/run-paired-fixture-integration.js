import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIdentityStore } from '../server/identity-store.js';
import { openCapacityStore } from '../server/population-capacity.js';
import { createServer } from '../server/index.js';
import { RUNTIME_DATASET } from '../server/runtime.js';
import { podRosterEntry } from '../client/src/visitor-phase.js';
import { createPairedHostDouble } from './fixture-integration/paired-host-double.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DISCONNECT_CHECK = 'host-wide-disconnect-with-confirmed-cleanup', UNREACHABLE_CHECK = 'host-wide-unreachable-host-holds-both-paused';
// Server-owned refusal text is matched exactly and never copied into the report; the report carries harness-owned codes.
const BUDGET_REFUSAL = 'Language budget exhausted.';
const OLDER_HOST_REFUSAL = 'Host negotiated 1 concurrent managed visitor; the existing visit was left undisturbed.';
const WORLD = 'fixture-world', LATE_REPLY = 'LATE-SYNTHETIC-REPLY-MUST-NOT-BE-DELIVERED';
const UNSUPPORTED = ['rng', 'plasticity', 'refractory', 'delayBuffers', 'embodiment'];
const unavailable = [
  ['live-managed-host', 'No PortOS/Eidoverse process, production broker or credential is used; capacity is published by an in-process host double.'],
  ['rendered-observer', 'The second observer is an independent local HTTP reader. No browser, rendered host scene or human observer is exercised.'],
  ['admin-ui-selection', 'Per-fly controls, keyboard selection and late-reply attribution after a browser selection change are not exercised; only the server contracts behind them are.'],
  ['full-connectome-embodiment', 'Only the synthetic 32-neuron fixture is loaded; no MaleCNS or BANC profile is involved.'],
  ['retained-learning', 'Fixture has no plasticity or RNG state; the separate learning campaign remains negative.'],
  ['shared-habitat-coupling', 'Both flies are independent residents. No shared session, synchronized barrier or coupled world clock is created.'],
  ['language-provider', 'Budgets are exercised against an in-process synthetic provider double. No real provider, model or network is used.'],
  ['lease-expiry-campaign', 'Leases are 30 s and the run ends well before one expires; time-based expiry is covered only by the bridge unit tests.'],
  ['production-restart', 'Temporary-store reopen is not fresh-clone, PM2 or worker-crash verification.'],
];

function provenance() {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const hash = path => sha256(readFileSync(join(root, path)));
  return { revision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=normal']).length > 0,
    node: process.version, platform: process.platform, architecture: process.arch,
    dataset: RUNTIME_DATASET, host: 'in-process-synthetic-paired-double-v1', languageProvider: 'in-process-synthetic-provider-double-v1',
    dependencyLockSha256: hash('package-lock.json'),
    harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    hostDoubleSha256: hash('scripts/fixture-integration/paired-host-double.js') };
}

/** Deterministic in-process provider. Nothing leaves the process; only explicit chat requests reach it. */
function createLanguageDouble() {
  let calls = 0, holding = false, resume = null;
  const provider = { providerId: 'synthetic-double', model: 'fixture-v1', requestTokens: 4096, requestSpendMicros: 100, maxOutputTokens: 512,
    async generate() {
      calls++;
      if (!holding) return { text: 'Synthetic telemetry description; not the fly speaking.', totalTokens: 100 };
      await new Promise(done => { resume = done; });
      return { text: LATE_REPLY, totalTokens: 100 };
    } };
  return { provider, calls: () => calls, hold() { holding = true; }, waiting: () => resume !== null,
    finish() { holding = false; const done = resume; resume = null; done?.(); } };
}

/** What a visit may change on the home fly: only the clock moves forward. Nothing is restored, re-dosed or re-armed. */
function assertContinuity(before, after) {
  assert.equal(after.sessionId, before.sessionId);
  assert.equal(after.externalOwner, null);
  assert.equal(after.persistence.checkpointId, before.persistence.checkpointId);
  assert.equal(after.persistence.checkpointCount, before.persistence.checkpointCount);
  assert.deepEqual(after.persistence.branchOf, before.persistence.branchOf);
  assert(after.tick >= before.tick);
  const ledger = entries => entries.map(({ activeUntilMs, ...rest }) => rest);
  assert.deepEqual(ledger(after.stimulusPolicy.entries), ledger(before.stimulusPolicy.entries));
  for (const entry of after.stimulusPolicy.entries) {
    assert(entry.activeUntilMs <= before.stimulusPolicy.entries.find(value => value.id === entry.id).activeUntilMs);
  }
  assert.equal(after.stimulusPolicy.reservedDose, before.stimulusPolicy.reservedDose);
  assert.equal(after.stimulusPolicy.reservedDurationMs, before.stimulusPolicy.reservedDurationMs);
  assert.deepEqual(after.chemistry.map(entry => entry.id), before.chemistry.map(entry => entry.id));
  for (const entry of after.chemistry) {
    const previous = before.chemistry.find(value => value.id === entry.id);
    assert(entry.cooldownRemainingMs <= previous.cooldownRemainingMs); assert(entry.remainingMs <= previous.remainingMs);
  }
}

/** Explicit bounded test run. Never opens the user's catalog, discovers a host, or calls a real provider.
 * `onFailure(error, step)` lets a local caller see the raw cause; it is never copied into the report. */
export async function runPairedFixtureIntegration({ hostFactory = createPairedHostDouble, onFailure = () => {} } = {}) {
  const startedAt = performance.now();
  const report = { schemaVersion: 1, scope: 'synthetic-fixture-http-paired-integration',
    disclosure: 'Two independent synthetic fixtures, an in-process host double and a synthetic provider double; not a live Eidoverse, rendered garden, shared habitat, learning or biological acceptance.',
    provenance: provenance(), checks: [], requirements: [], unavailable: unavailable.map(([id, reason]) => ({ id, outcome: 'unavailable', reason })),
    integrationAcceptance: 'unavailable' };
  const directory = mkdtempSync(join(tmpdir(), 'fly-paired-integration-'));
  const identityDirectory = join(directory, 'identities'), capacityDirectory = join(directory, 'capacity');
  const language = createLanguageDouble();
  let store, server, base, host, capacity, A, B, step = 'setup';
  const check = (id, evidence = {}) => report.checks.push({ id, outcome: 'pass', evidence });

  const request = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(5000), redirect: 'error',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const get = async path => { const result = await request('GET', path); assert.equal(result.status, 200); return result.body; };
  const state = id => get(`/api/individuals/${id}`);
  const attempt = async (id, path, body) => {
    const current = await state(id);
    return request('POST', `/api/individuals/${id}/${path}`, { protocolVersion: 1, individualId: id,
      sessionId: current.sessionId, sequence: current.commandSequence + 1, ...body });
  };
  const send = async (id, path, body) => { const result = await attempt(id, path, body); assert.equal(result.status, 200, `${path} ${result.status}`); return result.body; };
  const visit = (id, operation, payload = {}) => send(id, 'visitor', { operation, payload });
  const tryVisit = (id, operation, payload = {}) => attempt(id, 'visitor', { operation, payload });
  const control = (id, action) => send(id, 'control', { action });
  const languageView = id => get(`/api/individuals/${id}/language`);
  const waitFor = async (id, predicate) => {
    const deadline = Date.now() + 5000;
    do { const current = await state(id); if (predicate(current)) return current; await delay(10); } while (Date.now() < deadline);
    throw new Error('Bounded fixture wait failed.');
  };
  const advanced = (id, from, by = 3) => waitFor(id, value => value.tick >= from + by);
  const atHome = value => !value.visitor.owned && value.externalOwner === null && value.visitor.phase === 'home' && value.status === 'paused';
  const distinct = values => new Set(values).size === values.length;
  const close = async () => {
    if (server?.listening) { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; }
    store?.close();
  };
  const listen = async () => {
    server = createServer({ identities: store, autoTick: true, capacity, visitorTransport: host.transport,
      languageProviders: [language.provider], incrementalMemoryBytes: 100,
      resourceUsage: () => ({ aggregateMemoryBytes: 1000, availableMemoryBytes: 1024 ** 3 }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const baselineOf = value => ({ sessionId: value.sessionId, tick: value.tick, persistence: structuredClone(value.persistence),
    stimulusPolicy: structuredClone(value.stimulusPolicy), chemistry: structuredClone(value.chemistry) });
  /** The partner must be exactly as it was: same body, grant, epoch and attributed motion, still stepping. */
  const assertPeerUndisturbed = async (peerId, peerEpoch) => {
    const before = await state(peerId);
    assert.equal(before.visitor.owned, true); assert.equal(before.visitor.visitEpoch, peerEpoch);
    const after = await advanced(peerId, before.tick, 3);
    assert.equal(after.visitor.phase, 'visiting'); assert.equal(after.visitor.running, true);
    assert.equal(after.visitor.visitEpoch, peerEpoch); assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.visitor.lastTrace.individualId, peerId); assert.equal(after.visitor.lastTrace.visitEpoch, peerEpoch);
    assert(host.counts().leased.includes(peerId));
    return after;
  };

  try {
    store = openIdentityStore(identityDirectory); A = store.primaryId;
    capacity = openCapacityStore(capacityDirectory);
    host = hostFactory([A], { capacity: 2 });
    await listen();

    step = 'local-capacity-admits-two-and-refuses-a-third';
    const primary = await state(A);
    const created = await request('POST', '/api/individuals', { protocolVersion: 1, individualId: A, sessionId: primary.sessionId, sequence: primary.commandSequence + 1 });
    assert.equal(created.status, 200); B = created.body.individualId; host.allow(B);
    assert.notEqual(B, A); assert.equal((await state(B)).status, 'saved-unloaded');
    const refusedAtOne = await attempt(B, 'load', {});
    assert.equal(refusedAtOne.status, 409); assert.match(refusedAtOne.body.error, /resident capacity is exhausted/);
    assert.equal((await state(B)).status, 'saved-unloaded'); assert.equal((await state(A)).status, 'paused');
    const settings = (await get('/api/population')).settings;
    assert.equal((await request('POST', '/api/population', { ...settings, maxResidentFlies: 2 })).status, 200);
    await send(B, 'load', {});
    const [homeA, homeB] = [await state(A), await state(B)];
    for (const value of [homeA, homeB]) { assert.equal(value.status, 'paused'); assert.equal(value.tick, 0); assert.equal(value.externalOwner, null); }
    assert.notEqual(homeA.sessionId, homeB.sessionId);
    assert.equal(host.counts().calls, 0);
    const thirdCreate = await request('POST', '/api/individuals', { protocolVersion: 1, individualId: A, sessionId: homeA.sessionId, sequence: homeA.commandSequence + 1 });
    const third = thirdCreate.body.individualId;
    const refusedAtTwo = await attempt(third, 'load', {});
    assert.equal(refusedAtTwo.status, 409); assert.match(refusedAtTwo.body.error, /resident capacity is exhausted/);
    assert.equal((await get('/api/individuals')).individuals.filter(value => value.resident).length, 2);
    assert.equal((await state(third)).status, 'saved-unloaded');
    const population = await get('/api/population');
    assert.equal(population.residentCount, 2); assert.equal(population.excessResidents, 0);
    check(step, { configuredResidentCeiling: 2, residents: 2, thirdLoadRefused: true, residentsPreserved: true, distinctIdentities: true,
      distinctSessions: true, bothPausedAtTickZero: true, hostCalls: 0,
      note: 'Local resident capacity is a separate setting from the host-negotiated visitor capacity; admission inputs here are fixed synthetic constants.' });

    step = 'home-state-per-individual';
    for (const id of [A, B]) {
      await control(id, 'start');
      await send(id, 'encounters', { compoundId: 'nectar' });
      await control(id, 'pause'); await send(id, 'checkpoints', {});
    }
    const attached = {};
    for (const id of [A, B]) attached[id] = await send(id, 'environment', { action: 'attach' });
    for (const id of [A, B]) { await control(id, 'start'); await send(id, 'artifacts', { action: 'start' }); }
    const lastFrame = {}; let frames = 0;
    for (let frameId = 0; frameId < 12; frameId++) {
      // Interleaved on purpose: neither fly's clock, lease or artifact may absorb the other's frame.
      for (const id of [A, B]) {
        const current = await state(id);
        lastFrame[id] = { version: 1, individualId: id, sessionId: current.sessionId,
          environmentEpoch: current.environmentAdapter.environmentEpoch, controllerToken: attached[id].controllerToken,
          frameId, simTimeMs: current.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) };
        const result = await request('POST', `/api/individuals/${id}/environment/frames`, lastFrame[id]);
        assert.equal(result.status, 200); frames++;
      }
    }
    const crossed = await request('POST', `/api/individuals/${B}/environment/frames`, lastFrame[A]);
    assert.equal(crossed.status, 409);
    assert.equal((await request('POST', `/api/individuals/${A}/environment/frames`, lastFrame[A])).status, 409);
    // Releasing the home camera lease returns each fly to timer-driven stepping, so it can later run at home while its partner is away.
    for (const id of [A, B]) {
      await send(id, 'artifacts', { action: 'stop' }); await control(id, 'pause'); await send(id, 'environment', { action: 'detach' });
      assert.equal((await state(id)).environmentAdapter.attached, false); await send(id, 'checkpoints', {});
    }
    const artifacts = {};
    for (const [label, id] of [['A', A], ['B', B]]) {
      const artifact = await get(`/api/individuals/${id}/artifacts/export/json`), session = (await state(id)).sessionId;
      assert.equal(artifact.source.actions.length, 12); assert.equal(artifact.source.capture.complete, true);
      assert(artifact.source.actions.every(action => action.individualId === id && action.sessionId === session));
      const text = JSON.stringify(artifact);
      assert(!text.includes(attached[A].controllerToken) && !text.includes(attached[B].controllerToken));
      assert(!text.includes(id === A ? B : A));
      const formats = {};
      for (const format of ['mid', 'svg', 'png']) {
        const response = await fetch(`${base}/api/individuals/${id}/artifacts/export/${format}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer());
        formats[format] = { bytes: bytes.length, sha256: sha256(bytes) };
      }
      artifacts[label] = { acceptedActions: artifact.source.actions.length, events: artifact.events.length, formats };
    }
    const baseline = { [A]: baselineOf(await state(A)), [B]: baselineOf(await state(B)) };
    for (const id of [A, B]) {
      assert(baseline[id].stimulusPolicy.entries.some(entry => entry.effect === 'nectar'));
      assert(baseline[id].persistence.checkpointCount > 1);
    }
    assert.notEqual(baseline[A].stimulusPolicy.individualId, baseline[B].stimulusPolicy.individualId);
    check(step, { interleavedFrames: frames, crossRecipientFrameRefused: true, replayedFrameRefused: true,
      artifacts,
      spentNectarReservation: { A: baseline[A].stimulusPolicy.reservedDose, B: baseline[B].stimulusPolicy.reservedDose },
      checkpointCount: { A: baseline[A].persistence.checkpointCount, B: baseline[B].persistence.checkpointCount },
      note: 'Each artifact names only its own individual and session. An exported MIDI container does not establish a melody or learned choice.' });

    step = 'per-individual-language-budgets';
    const armBody = { providerId: 'synthetic-double', model: 'fixture-v1', cooldownMs: 1000, detectorThresholdHz: 20, detectorEnabled: false };
    await send(A, 'language', { operation: 'arm', payload: { ...armBody, maxCalls: 2, maxTokens: 8192, maxSpendMicros: 300 } });
    await send(B, 'language', { operation: 'arm', payload: { ...armBody, maxCalls: 1, maxTokens: 4096, maxSpendMicros: 100 } });
    const chat = (id, message) => send(id, 'language', { operation: 'chat', payload: { requestId: randomBytes(16).toString('hex'), message, windowId: null } });
    await chat(A, 'Describe the current telemetry.');
    const [viewA, viewB] = [await languageView(A), await languageView(B)];
    assert.equal(viewA.individualId, A); assert.equal(viewB.individualId, B);
    assert.deepEqual(viewA.reserved, { calls: 1, tokens: 4096, spendMicros: 100 });
    assert.deepEqual(viewB.reserved, { calls: 0, tokens: 0, spendMicros: 0 });
    assert.equal(viewA.aggregateReservedSpendMicros, 100); assert.equal(viewB.aggregateReservedSpendMicros, 100);
    // A's cooldown clock is A's own: B's first request, made immediately after A's, is not delayed by it.
    await chat(B, 'Describe the current telemetry.');
    await delay(1100);
    const overCeiling = await attempt(B, 'language', { operation: 'chat', payload: { requestId: randomBytes(16).toString('hex'), message: 'Over its own ceiling.', windowId: null } });
    assert.equal(overCeiling.status, 409); assert.equal(overCeiling.body.error, BUDGET_REFUSAL);
    const afterB = { A: await languageView(A), B: await languageView(B) };
    assert.deepEqual(afterB.A.reserved, viewA.reserved);
    assert.deepEqual(afterB.B.reserved, { calls: 1, tokens: 4096, spendMicros: 100 });
    assert.equal(afterB.A.aggregateReservedSpendMicros, 200);
    for (const [id, view] of [[A, afterB.A], [B, afterB.B]]) assert(view.events.filter(event => event.requestId).every(event => event.individualId === id));
    assert.equal(language.calls(), 2);
    check(step, { providerCalls: language.calls(), providerKind: 'in-process-synthetic-double',
      ceilings: { A: { maxCalls: 2, maxSpendMicros: 300 }, B: { maxCalls: 1, maxSpendMicros: 100 } },
      reserved: { A: afterB.A.reserved, B: afterB.B.reserved }, aggregateReservedSpendMicros: afterB.A.aggregateReservedSpendMicros,
      overCeilingRefusalForB: 'language-budget-exhausted', partnerNotDelayedByCooldown: true, eventsAttributed: true,
      note: 'The server has no active-selection input: every language request is keyed by its envelope individual. Neither fly consumed the other\'s ceiling.' });

    step = 'late-provider-reply-keeps-its-recipient';
    language.hold();
    const lateRequestId = randomBytes(16).toString('hex');
    const pendingChat = attempt(A, 'language', { operation: 'chat', payload: { requestId: lateRequestId, message: 'This request is still pending when A departs.', windowId: null } });
    pendingChat.catch(() => {}); // a failed step must not leave this request as an unhandled rejection
    const waitDeadline = Date.now() + 5000;
    while (!language.waiting() && Date.now() < waitDeadline) await delay(10);
    assert(language.waiting());
    const bBeforeDeparture = await languageView(B);
    const departed = await visit(A, 'admit', { worldId: WORLD });
    assert.equal(departed.visitor.phase, 'visiting'); const epochA1 = departed.visitor.visitEpoch;
    language.finish();
    // Departure cancels the pending request; its record stays attributed to A and the provider's late text is dropped.
    const canceledChat = await pendingChat;
    assert.equal(canceledChat.status, 200); assert.equal(canceledChat.body.result.status, 'canceled');
    assert.equal(canceledChat.body.result.individualId, A); assert.equal(canceledChat.body.result.requestId, lateRequestId);
    const [lateA, lateB] = [await languageView(A), await languageView(B)];
    assert(!JSON.stringify([lateA, lateB]).includes(LATE_REPLY));
    assert.equal(lateA.armed, false); assert.equal(lateA.pending, false);
    assert.equal(lateA.reserved.calls, 2);
    assert.equal(lateB.armed, true);
    assert.deepEqual(lateB.reserved, bBeforeDeparture.reserved); assert.deepEqual(lateB.config, bBeforeDeparture.config);
    assert(lateA.events.filter(event => event.requestId).every(event => event.individualId === A));
    assert(lateB.events.filter(event => event.requestId).every(event => event.individualId === B));
    check(step, { lateReplyDelivered: false, departedFlyDisarmed: true, partnerStillArmed: true, partnerBudgetUntouched: true,
      reservationNotRefunded: lateA.reserved.calls === 2, providerCalls: language.calls() });

    step = 'split-location-a-visits-b-home';
    const awayA = await state(A);
    assert.equal(awayA.visitor.owned, true); assert.equal(awayA.status, 'paused'); assert.equal(awayA.environmentAdapter.attached, false);
    assert.equal(awayA.visitor.visitEpoch, epochA1);
    const localControl = await attempt(A, 'control', { action: 'start' });
    assert.equal(localControl.status, 409); assert.match(localControl.body.error, /managed visitor owns this individual/);
    const homeBefore = await state(B); assert.equal(atHome(homeBefore), true);
    await control(B, 'start'); const homeRunning = await advanced(B, homeBefore.tick, 3); await control(B, 'pause');
    const tickA = (await state(A)).tick; await delay(150);
    assert.equal((await state(A)).tick, tickA);
    assert.equal(host.counts().leased.length, 1); assert.deepEqual(host.counts().leased, [A]);
    const pods = (await get('/api/health')).eidoverse.individuals.map(podRosterEntry);
    const podOf = id => pods.find(entry => entry.individualId === id);
    assert.equal(podOf(A).phase, 'visiting'); assert.equal(podOf(B).phase, 'home'); assert.notEqual(podOf(A).label, podOf(B).label);
    check(step, { visitor: 'A', atHome: 'B', homeControlsStayAvailableForB: homeRunning.tick > homeBefore.tick, awayFlyDidNotStep: true,
      localControlOfAwayFlyRefused: true, hostLeases: host.counts().leased.length,
      podLabels: { A: podOf(A).label, B: podOf(B).label } });

    step = 'both-visiting-with-distinct-epochs';
    const capabilityReads = {};
    for (const [label, id] of [['A', A], ['B', B]]) capabilityReads[label] = (await get(`/api/individuals/${id}/visitor?capabilities=1`)).capabilities;
    assert(Object.values(capabilityReads).every(value => value.maxConcurrentVisitors === 2));
    const admittedB = await visit(B, 'admit', { worldId: WORLD }); assert.equal(admittedB.visitor.phase, 'visiting');
    const epochB1 = admittedB.visitor.visitEpoch; assert.notEqual(epochB1, epochA1);
    const duplicate = await tryVisit(A, 'admit', { worldId: WORLD });
    assert.equal(duplicate.status, 409); assert.match(duplicate.body.error, /already owns this individual/);
    assert.equal((await state(A)).visitor.visitEpoch, epochA1);
    assert.deepEqual(host.counts().leased, [A, B].toSorted()); // the host lists leases in id order
    await visit(A, 'start'); await visit(B, 'start');
    const [stepA, stepB] = [await state(A), await state(B)];
    const [movedA, movedB] = [await advanced(A, stepA.tick, 3), await advanced(B, stepB.tick, 3)];
    // An independent reader, as a second observer's browser would be, using only the local read-only routes.
    const observed = {};
    for (const [label, id] of [['A', A], ['B', B]]) observed[label] = (await get(`/api/individuals/${id}/visitor`)).visitor;
    for (const [label, id] of [['A', A], ['B', B]]) {
      assert.equal(observed[label].individualId, id); assert.equal(observed[label].phase, 'visiting'); assert.equal(observed[label].owned, true);
      assert.equal(observed[label].lastTrace.individualId, id); assert.equal(observed[label].lastTrace.visitEpoch, observed[label].visitEpoch);
      assert.equal(observed[label].lastTrace.individualSessionId, observed[label].individualSessionId);
    }
    assert(distinct([observed.A.visitEpoch, observed.B.visitEpoch]));
    assert(distinct([observed.A.individualSessionId, observed.B.individualSessionId]));
    assert(distinct([observed.A.lastTrace.individualId, observed.B.lastTrace.individualId]));
    const health = (await get('/api/health')).eidoverse;
    assert.deepEqual([A, B].map(id => health.individuals.find(entry => entry.individualId === id).phase), ['visiting', 'visiting']);
    assert.equal(health.capacity, 2);
    assert(host.stepsFor(A) >= 3 && host.stepsFor(B) >= 3);
    check(step, { negotiatedCapacity: 2, duplicateAdmissionOfOwnedFlyRefused: true, distinctVisitEpochs: [observed.A.visitEpoch, observed.B.visitEpoch],
      distinctIndividuals: true, tracesAttributedToOwnIndividualEpochAndSession: true,
      hostLeases: host.counts().leased.length, ticksAdvanced: { A: movedA.tick - stepA.tick, B: movedB.tick - stepB.tick },
      secondObserver: 'local-http-reader-not-rendered' });

    step = 'revocation-of-a-leaves-b-visiting';
    host.setFault(A, 'revoked');
    const returnedA = await waitFor(A, value => !value.visitor.owned);
    host.clearFault(A);
    assert.equal(atHome(returnedA), true); assert.equal(returnedA.sessionId, baseline[A].sessionId);
    assert.equal(returnedA.persistence.checkpointId, baseline[A].persistence.checkpointId);
    const frozenA = returnedA.tick; await assertPeerUndisturbed(B, epochB1); assert.equal((await state(A)).tick, frozenA);
    assert.deepEqual(host.counts().leased, [B]);
    check(step, { revokedFlyReturnedPausedWithoutRestore: true, partnerStillVisitingSameEpoch: true, partnerStillStepping: true,
      revokedFlyStoppedStepping: true, hostLeases: host.counts().leased.length });

    for (const fault of ['peer-scope', 'stale-epoch']) {
      step = `${fault}-reply-for-a-cannot-command-b`;
      const reentry = await visit(A, 'admit', { worldId: WORLD });
      assert.equal(reentry.visitor.phase, 'visiting'); assert.notEqual(reentry.visitor.visitEpoch, epochA1);
      const atAdmission = (await state(A)).tick;
      host.setFault(A, fault); await visit(A, 'start');
      const rejected = await waitFor(A, value => !value.visitor.owned);
      host.clearFault(A);
      assert.equal(atHome(rejected), true); assert.equal(rejected.tick, atAdmission);
      await assertPeerUndisturbed(B, epochB1);
      assert.equal(host.counts().scopeViolations, 0);
      check(step, { staleOrMisroutedReplyRefusedWithoutAdvancement: true, rejectedFlyReturnedPaused: true,
        partnerStillVisitingSameEpoch: true, hostScopeViolations: host.counts().scopeViolations });
    }

    step = 'independent-return-in-both-directions';
    const readmitted = await visit(A, 'admit', { worldId: WORLD }); await visit(A, 'start');
    const epochA3 = readmitted.visitor.visitEpoch;
    const beforeReturnB = await state(B);
    await visit(B, 'home'); const returnedB = await state(B);
    assert.equal(atHome(returnedB), true);
    const frozenB = returnedB.tick; await assertPeerUndisturbed(A, epochA3); await delay(100);
    assert.equal((await state(B)).tick, frozenB);
    assert.equal(returnedB.sessionId, beforeReturnB.sessionId);
    await visit(A, 'home'); assert.equal(atHome(await state(A)), true);
    assert.deepEqual(host.counts().leased, []);
    check(step, { bReturnedWhileAVisitedAndKeptStepping: true, aReturnedLastFromItsOwnFreshGrant: true, noLeasesRemain: true,
      note: 'The opposite direction, A leaving while B stays, is the revocation check above.' });

    for (const [mode, id] of [['disconnect', DISCONNECT_CHECK], ['unreachable', UNREACHABLE_CHECK]]) {
      step = id;
      for (const fly of [A, B]) { await visit(fly, 'admit', { worldId: WORLD }); await visit(fly, 'start'); }
      const running = [await state(A), await state(B)];
      const stepped = [await advanced(A, running[0].tick, 3), await advanced(B, running[1].tick, 3)];
      host.setHostMode(mode);
      if (mode === 'disconnect') {
        // Observations fail but cleanup still confirms, so each fly returns home paused on its own.
        for (const fly of [A, B]) assert.equal(atHome(await waitFor(fly, value => !value.visitor.owned)), true);
      } else {
        // Nothing is reachable, not even cleanup: both stay owned and paused, never reset, and never claim to be home.
        const held = [];
        for (const fly of [A, B]) held.push(await waitFor(fly, value => value.visitor.owned && ['disconnected', 'reconnecting'].includes(value.visitor.phase)));
        for (const value of held) { assert.equal(value.status, 'paused'); assert.equal(value.visitor.running, false); assert.notEqual(value.externalOwner, null); }
        const heldControl = await attempt(A, 'control', { action: 'start' });
        assert.equal(heldControl.status, 409); assert.match(heldControl.body.error, /managed visitor owns this individual/);
        const frozen = [held[0].tick, held[1].tick]; await delay(150);
        assert.deepEqual([(await state(A)).tick, (await state(B)).tick], frozen);
        host.setHostMode('supported');
        for (const fly of [A, B]) assert.equal(atHome(await waitFor(fly, value => !value.visitor.owned)), true);
      }
      host.setHostMode('supported');
      const after = [await state(A), await state(B)];
      for (const [index, fly] of [A, B].entries()) {
        assert(after[index].tick >= stepped[index].tick); assert.equal(after[index].sessionId, running[index].sessionId);
        assert.equal(after[index].persistence.checkpointId, baseline[fly].persistence.checkpointId);
      }
      const settled = [after[0].tick, after[1].tick]; await delay(150);
      assert.deepEqual([(await state(A)).tick, (await state(B)).tick], settled);
      assert.deepEqual(host.counts().leased, []);
      check(id, { bothPausedWithoutRestore: true, ticksNeverRewound: true, sessionsPreserved: true, checkpointsPreserved: true,
        cleanup: mode === 'disconnect' ? 'confirmed-on-first-attempt' : 'quarantined-then-confirmed-after-host-returned' });
    }

    step = 'paired-round-trip-continuity';
    const finalState = { [A]: await state(A), [B]: await state(B) };
    for (const id of [A, B]) {
      assertContinuity(baseline[id], finalState[id]);
      assert(finalState[id].tick > baseline[id].tick); assert(finalState[id].stimulusPolicy.simTimeMs > baseline[id].stimulusPolicy.simTimeMs);
    }
    const checkpoints = {};
    for (const id of [A, B]) {
      checkpoints[id] = (await get(`/api/individuals/${id}/checkpoints`)).checkpoints.filter(checkpoint => checkpoint.payload);
      for (const checkpoint of checkpoints[id]) assert.deepEqual(Object.keys(checkpoint.payload.unsupported).sort(), [...UNSUPPORTED].sort());
      for (const checkpoint of checkpoints[id]) assert(Object.values(checkpoint.payload.unsupported).every(value => value === null));
    }
    const finalLanguage = { A: await languageView(A), B: await languageView(B) };
    assert.deepEqual(finalLanguage.A.reserved, { calls: 2, tokens: 8192, spendMicros: 200 });
    assert.deepEqual(finalLanguage.B.reserved, { calls: 1, tokens: 4096, spendMicros: 100 });
    assert.equal(finalLanguage.A.armed, false); assert.equal(finalLanguage.B.armed, false);
    assert.equal(host.counts().scopeViolations, 0); assert.deepEqual(host.counts().leased, []);
    const epochList = { A: host.epochsFor(A), B: host.epochsFor(B) };
    check(step, { identityAndSessionPreservedPerFly: true, checkpointLineagePreservedPerFly: true, stimulusLedgerPreservedPerFly: true,
      chemicalRecoveryNeverReset: true, noRestoreDuringAnyVisit: true,
      ticksBeforeAndAfter: { A: [baseline[A].tick, finalState[A].tick], B: [baseline[B].tick, finalState[B].tick] },
      hostSteps: { A: host.stepsFor(A), B: host.stepsFor(B) }, epochsIssued: epochList,
      languageReservationsNeverRefunded: true, languageDisarmedByEachDeparture: true, hostScopeViolations: host.counts().scopeViolations,
      notCarriedBecauseUnsupported: UNSUPPORTED,
      note: 'RNG, plasticity, refractory state, delay buffers and embodiment are recorded as unsupported nulls; nothing about them was preserved or tested.' });

    step = 'older-host-refuses-second-visitor';
    for (const id of [A, B]) await send(id, 'checkpoints', {});
    const beforeOlder = { A: await state(A), B: await state(B) };
    await close();
    store = openIdentityStore(identityDirectory, { residentIds: [B] });
    capacity = openCapacityStore(capacityDirectory);
    host = hostFactory([A, B], { capacity: null });
    await listen();
    assert.equal((await get('/api/population')).settings.maxResidentFlies, 2);
    const olderCapability = (await get(`/api/individuals/${A}/visitor?capabilities=1`)).capabilities;
    assert.equal(olderCapability.maxConcurrentVisitors, 1);
    const recoveredOlder = { A: await state(A), B: await state(B) };
    assert.equal(recoveredOlder.B.tick, beforeOlder.B.tick); assert.notEqual(recoveredOlder.B.sessionId, beforeOlder.B.sessionId);
    await visit(A, 'admit', { worldId: WORLD }); await visit(A, 'start');
    const olderEpoch = (await state(A)).visitor.visitEpoch;
    const refused = await tryVisit(B, 'admit', { worldId: WORLD });
    assert.equal(refused.status, 409); assert.equal(refused.body.error, OLDER_HOST_REFUSAL);
    const refusedB = await state(B);
    assert.equal(atHome(refusedB), true); assert.equal(refusedB.tick, beforeOlder.B.tick); assert.equal(refusedB.sessionId, recoveredOlder.B.sessionId);
    assert.equal(host.counts().admits, 1);
    const stillVisiting = await assertPeerUndisturbed(A, olderEpoch);
    assert.equal(stillVisiting.visitor.phase, 'visiting');
    await visit(A, 'home');
    const admittedLater = await visit(B, 'admit', { worldId: WORLD });
    assert.equal(admittedLater.visitor.phase, 'visiting'); await visit(B, 'home');
    assert.deepEqual(host.counts().leased, []);
    check(step, { hostPublishedCapacityField: false, bridgeReadsCapacityAs: olderCapability.maxConcurrentVisitors,
      secondAdmissionRefusedBeforeAnyHostRequest: true, firstVisitorKeptSteppingSameEpoch: true,
      refusedFlyUntouched: true, hostAdmissionRequests: 1, secondAdmittedAfterFirstReturned: true,
      refusal: 'host-capacity-one-visitor' });

    step = 'saved-paused-reopen-pair';
    const saved = { A: await send(A, 'checkpoints', {}), B: await send(B, 'checkpoints', {}) };
    const oldSessions = { A: saved.A.sessionId, B: saved.B.sessionId };
    await close();
    store = openIdentityStore(identityDirectory, { residentIds: [B] });
    capacity = openCapacityStore(capacityDirectory);
    host = hostFactory([A, B], { capacity: 2 });
    await listen();
    const recovered = { A: await state(A), B: await state(B) };
    for (const [label, id] of [['A', A], ['B', B]]) {
      assert.equal(recovered[label].individualId, id); assert.notEqual(recovered[label].sessionId, oldSessions[label]);
      assert.equal(recovered[label].persistence.checkpointId, saved[label].persistence.checkpointId);
      assert.equal(recovered[label].tick, saved[label].tick); assert.equal(recovered[label].status, 'paused');
      assert.equal(recovered[label].environmentAdapter.attached, false); assert.equal(recovered[label].externalOwner, null);
    }
    assert.notEqual(recovered.A.individualId, recovered.B.individualId);
    await delay(75); assert.deepEqual([(await state(A)).tick, (await state(B)).tick], [recovered.A.tick, recovered.B.tick]);
    assert.equal(host.counts().calls, 0);
    check(step, { identitiesPreserved: true, checkpointsPreserved: true, freshSessions: true, bothPausedAtSavedTick: true,
      noVisitorOwnership: true, hostCalls: 0 });

    report.outcome = 'pass';
  } catch (error) {
    onFailure(error, step);
    // Never publish raw exceptions, response bodies, credentials, local paths or private environment values.
    report.checks.push({ id: step, outcome: 'failed', evidence: { reason: 'Fixture assertion or operation failed; reproduce locally to diagnose.' } });
    report.outcome = 'failed';
  } finally {
    language.finish(); // never leave a held provider promise (and the gate's timeout timer) behind
    await close(); rmSync(directory, { recursive: true, force: true });
  }
  report.timing = { wallMs: Math.round(performance.now() - startedAt),
    note: 'Wall time of one run on the recorded machine with a 50 ms server scheduler; not a capacity, latency or throughput benchmark.' };
  report.requirements = requirementsFor(report.checks);
  return report;
}

/** FR-36–40 as far as this fixture run can speak to them. A clause with no check here is unavailable, never inferred. */
function requirementsFor(checks) {
  const passed = id => checks.some(check => check.id === id && check.outcome === 'pass');
  const failed = id => checks.some(check => check.id === id && check.outcome === 'failed');
  const clause = (text, ids, reason) => ({ clause: text, ...(ids.length ? { checks: ids, outcome: ids.every(passed) ? 'pass' : ids.some(failed) ? 'failed' : 'not-run' } : { outcome: 'unavailable', reason }) });
  const outcomeOf = clauses => (clauses.some(value => value.outcome === 'failed') ? 'failed' : clauses.some(value => value.outcome === 'not-run') ? 'not-run'
    : clauses.every(value => value.outcome === 'pass') ? 'pass' : clauses.some(value => value.outcome === 'pass') ? 'partial' : 'unavailable');
  const requirement = (id, clauses) => ({ id, scope: 'synthetic-fixture-http', outcome: outcomeOf(clauses), clauses });
  return [
    requirement('FR-36', [clause('Separately versioned MaleCNS v1.0 and BANC v888 profiles', [], 'Only the synthetic fixture is loaded; profile hashes and licences are evidenced by the model cards and descriptor tests, not by this run.')]),
    requirement('FR-37', [
      clause('Configured resident ceiling admits two and refuses a third without disturbing residents', ['local-capacity-admits-two-and-refuses-a-third']),
      clause('Preflight against measured memory headroom', [], 'Memory inputs are fixed synthetic constants, so headroom is not measured here.')]),
    requirement('FR-38', [
      clause('Isolated identity, session and checkpoint lineage per fly', ['home-state-per-individual', 'paired-round-trip-continuity']),
      clause('Isolated chemical and stimulus-reservation state per fly', ['home-state-per-individual', 'paired-round-trip-continuity']),
      clause('Late provider replies and per-fly budgets retain their original recipient', ['per-individual-language-budgets', 'late-provider-reply-keeps-its-recipient']),
      clause('Isolated RNG and learning state per fly', [], 'RNG and plasticity are unsupported nulls in the fixture checkpoint; there is nothing to isolate or compare.')]),
    requirement('FR-39', [clause('Individuals couple only through declared senses and a synchronized world clock', [], 'No shared session is created; both flies run independently.')]),
    requirement('FR-40', [
      clause('Two-at-home, split-location and two-visiting cases with distinct admissions and epochs', ['split-location-a-visits-b-home', 'both-visiting-with-distinct-epochs', 'independent-return-in-both-directions']),
      clause('Rejection or revocation of one visitor cannot control another', ['revocation-of-a-leaves-b-visiting', 'peer-scope-reply-for-a-cannot-command-b', 'stale-epoch-reply-for-a-cannot-command-b']),
      clause('A host-wide disconnect pauses every affected visitor without resets', [DISCONNECT_CHECK, UNREACHABLE_CHECK]),
      clause('An older single-visitor host preserves single-visitor operation', ['older-host-refuses-second-visitor']),
      clause('Per-individual and aggregate language budgets independent of selection', ['per-individual-language-budgets']),
      clause('A second observer sees two distinct, correctly attributed flies in a rendered host', [], 'The second observer is a local HTTP reader; no rendered host or human observer exists in this run.')]),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.error('Explicit invocation required: node scripts/run-paired-fixture-integration.js --run');
    process.exitCode = 2;
  } else {
    try {
      const report = await runPairedFixtureIntegration();
      console.log(JSON.stringify(report, null, 2)); process.exitCode = report.outcome === 'pass' ? 0 : 1;
    } catch {
      console.error('Paired fixture harness setup or cleanup failed; no acceptance result is available.'); process.exitCode = 1;
    }
  }
}
