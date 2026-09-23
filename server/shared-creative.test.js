import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { createSharedCreativeHttp } from './shared-creative-http.js';
import { createSharedCreativeSessions, fixtureActionBatch, fixtureTraceProvenance, FIXTURE_ACTION_ADAPTER } from './shared-creative-session.js';
import { exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG, validateCreativeSource, CREATIVE_LIMITS } from './creative-artifacts.js';
import { SHARED_ACTION_TRACE, validateActionBatch } from '../shared/shared-action-trace.js';
import { readSharedCapture, newestSharedCapture } from '../client/src/shared-capture-state.js';
import { openIdentityStore } from './identity-store.js';
import { createServer } from './index.js';
const dataset = { namespace: 'synthetic-fixture', release: '1', modelId: 'synthetic-lif-v1' };
const renderers = { json: exportCreativeJSON, mid: exportCreativeMIDI, svg: exportCreativeSVG, png: exportCreativePNG };
const research = { namespace: 'male-cns', release: 'v1.0', modelId: 'malecns-traced-lif-v1' };

/** Tiny injected population. `kinds` lists 'fixture' or 'connectome' per member; research members
 * carry an explicitly declared test adapter and never use the fixture action builder. */
function fixture(kinds = ['fixture', 'fixture'], { ids } = {}) {
  const captures = createSharedCreativeSessions();
  const states = kinds.map((source, i) => {
    const individualId = ids?.[i] ?? (['one', 'two'][i] ?? `fly-${i}`);
    return { individualId, sessionId: `${individualId}-session`, source, dataset: source === 'fixture' ? dataset : research,
      model: { id: source === 'fixture' ? 'synthetic-lif-v1' : 'malecns-traced-lif-v1' }, persistence: { checkpointId: `${individualId}-save`, branchOf: null } };
  });
  const provenance = () => states.map(s => s.source === 'fixture' ? fixtureTraceProvenance(s) : {
    individualId: s.individualId, sessionId: s.sessionId, sourceType: 'connectome', derivation: 'declared-adapter-derived',
    adapterVersion: 'test-declared-adapter-v1', dataset: s.dataset, modelVersion: s.model.id,
    checkpointLineage: { checkpointId: s.persistence.checkpointId, branchOf: null } });
  const shared = { sharedId: 'world', worldEpoch: 'epoch', status: 'running', tick: 0, worldTimeMs: 0, lastReceivedAtMs: 1000,
    participants: states.map((s, i) => ({ individualId: s.individualId, sessionId: s.sessionId, simTimeMs: 0,
      pose: { x: i ? -0.5 : 0, z: i ? 0 : 1.079, yaw: 0 } })) };
  const command = (action, extra = {}, declared = provenance()) => captures.command(shared.sharedId, { protocolVersion: 1, sharedId: shared.sharedId,
    worldEpoch: action === 'start' ? shared.worldEpoch : captures.status(shared.sharedId).worldEpoch,
    captureSequence: captures.status(shared.sharedId).captureSequence, action, ...extra }, shared, declared);
  /** Commit one barrier; only the first member moves. Returns fixture-style traces. */
  const advance = (move = true) => {
    const oldTick = shared.tick; shared.tick++; shared.worldTimeMs += 5; shared.lastReceivedAtMs += 5;
    for (const p of shared.participants) p.simTimeMs += 5;
    if (move) shared.participants[0].pose.z += 0.002;
    return shared.participants.map((p, i) => ({ individualId: p.individualId, sessionId: p.sessionId, environmentEpoch: shared.worldEpoch,
      frameId: oldTick, inputSimTimeMs: p.simTimeMs - 5, outputSimTimeMs: p.simTimeMs, retinalCurrents: [0.1],
      motor: { forward: move && i === 0 ? 0.4 : 0, yaw: 0 }, pose: { ...p.pose } }));
  };
  const stateFor = id => states.find(s => s.individualId === id);
  /** A complete contract batch for any mixed population, as a declared adapter would supply it. */
  const declaredBatch = traces => {
    const declared = provenance();
    return { traceVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, tick: shared.tick, worldTimeMs: shared.worldTimeMs,
      wallTimeMs: shared.lastReceivedAtMs, actions: traces.map(t => ({ ...declared.find(p => p.individualId === t.individualId),
        sessionId: t.sessionId, sharedId: shared.sharedId, worldEpoch: t.environmentEpoch, tick: t.frameId + 1,
        actionKind: t.motor.forward === 0 ? 'rest' : 'move', sourceActionId: `src:${t.frameId}:${t.individualId}`, simTimeMs: t.outputSimTimeMs,
        position: { x: (t.pose.x + 2) / 4, y: (t.pose.z + 2) / 4 } })) };
  };
  const live = id => fixtureTraceProvenance(stateFor(id));
  const capture = (traces, build = t => fixtureActionBatch(shared, t, live)) => captures.capture(shared, () => build(traces));
  const source = () => JSON.parse(captures.export('world', 'json').bytes).source;
  return { captures, shared, states, provenance, command, advance, capture, declaredBatch, stateFor, source };
}

test('a complete fixture batch yields one attributable action per recipient and every export keeps provenance', () => {
  const f = fixture(); f.command('start'); f.capture(f.advance()); f.command('stop');
  const artifact = JSON.parse(f.captures.export('world', 'json').bytes), { source } = artifact;
  assert.equal(source.schemaVersion, 2); assert.equal(source.traceVersion, SHARED_ACTION_TRACE.version);
  assert.deepEqual(source.capture, { complete: true, reason: null, boundary: { cause: 'stop', worldEpoch: 'epoch', tick: 1 } });
  assert.deepEqual(source.actions.map(a => [a.individualId, a.kind, a.tick, a.worldEpoch, a.sourceType, a.derivation]),
    [['one', 'move', 1, 'epoch', 'fixture', 'movement-derived'], ['two', 'rest', 1, 'epoch', 'fixture', 'movement-derived']]);
  for (const a of source.actions) {
    assert.equal(a.sessionId, `${a.individualId}-session`); assert.deepEqual(a.dataset, dataset); assert.equal(a.modelVersion, 'synthetic-lif-v1');
    assert.deepEqual(a.checkpointLineage, { checkpointId: `${a.individualId}-save`, branchOf: null }); assert.equal(a.adapterVersion, FIXTURE_ACTION_ADAPTER);
    assert.equal(a.sourceActionId, `epoch:0:${a.individualId}`); assert.equal(a.worldId, 'world');
    // No motor, retinal, neural or hidden target values cross into the artifact.
    for (const key of ['motor', 'retinalCurrents', 'neural', 'target', 'pose']) assert.equal(Object.hasOwn(a, key), false);
  }
  assert.equal(artifact.kind, 'shared-action-derived-artifact'); assert.deepEqual(artifact.derivations, ['movement-derived']);
  assert.match(artifact.claim, /no learned creativity, intention, preference or subjective-expression claim/);
  assert(artifact.disclosures.some(d => d.includes('project-shared-garden-arrangement-v1'))); assert(artifact.disclosures.some(d => d.includes("not the fly's voice")));
  assert(artifact.events.length > 0 && artifact.events.every(e => e.individualId === 'one' && e.tick === 1 && e.worldEpoch === 'epoch'
    && e.humanContributionId === 'project-shared-garden-arrangement-v1' && e.derivation === 'movement-derived'));
  for (const [format, render] of Object.entries(renderers)) assert.deepEqual(f.captures.export('world', format).bytes, render(source));
  const midi = f.captures.export('world', 'mid').bytes, svg = f.captures.export('world', 'svg').bytes.toString();
  for (const text of ['two-save', 'synthetic-fixture', 'project-shared-garden-arrangement-v1', '"worldEpoch":"epoch"', 'movement-derived']) assert(midi.includes(Buffer.from(text)), text);
  assert.match(svg, /data-tick="1" data-derivation="movement-derived"/); assert.match(svg, /one-save/);
  const png = f.captures.export('world', 'png').bytes, textStart = png.indexOf('tEXt') + 4, textLength = png.readUInt32BE(textStart - 8);
  assert.deepEqual(JSON.parse(png.subarray(textStart, textStart + textLength).toString().split('\0')[1]).source, source);
  const idat = png.indexOf('IDAT'); assert.equal(inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).length, 256 * (256 * 3 + 1));
});

test('mixed fixture and declared research actions keep separate provenance; reversed delivery is accepted by identity', () => {
  const f = fixture(['fixture', 'connectome']);
  assert.throws(() => fixtureTraceProvenance(f.states[1]), /declared adapter/);
  f.command('start');
  for (let i = 0; i < 2; i++) f.capture(f.advance().toReversed(), f.declaredBatch);
  const artifact = JSON.parse(f.captures.export('world', 'json').bytes), { source } = artifact;
  assert.equal(f.captures.status('world').active, true); assert.equal(source.capture.complete, false); assert.equal(source.capture.boundary, null);
  assert.deepEqual(source.actions.map(a => `${a.tick}:${a.individualId}:${a.sourceType}:${a.dataset.namespace}`),
    ['1:one:fixture:synthetic-fixture', '1:two:connectome:male-cns', '2:one:fixture:synthetic-fixture', '2:two:connectome:male-cns']);
  assert.deepEqual(artifact.derivations, ['declared-adapter-derived', 'movement-derived']);
  assert(artifact.disclosures.some(d => d.includes('no full-connectome body or motor stream is inferred')));
  assert.deepEqual(f.captures.status('world').participants.map(p => [p.sourceType, p.derivation, p.checkpointId]),
    [['fixture', 'movement-derived', 'one-save'], ['connectome', 'declared-adapter-derived', 'two-save']]);
  // Changing either source's declared derivation breaks the contract rather than relabeling it.
  const relabeled = f.declaredBatch(f.advance()); relabeled.actions[1].derivation = 'movement-derived';
  assert.throws(() => validateActionBatch(relabeled), /source type or derivation/);
});

test('missing, duplicate, stale, discontinuous, cross-recipient or mismatched actions keep the last complete prefix', () => {
  const alterations = {
    missing: [traces => traces.slice(1), 'invalid-batch'],
    duplicate: [traces => [traces[0], traces[0]], 'invalid-batch'],
    'stale epoch': [traces => traces.map(t => ({ ...t, environmentEpoch: 'old' })), 'invalid-batch'],
    'stale tick': [traces => traces.map(t => ({ ...t, frameId: t.frameId - 1 })), 'invalid-batch'],
    'cross-recipient': [traces => traces.map((t, i) => ({ ...t, sessionId: traces[1 - i].sessionId })), 'provenance-mismatch'],
    'moved pose': [traces => traces.map(t => ({ ...t, pose: { ...t.pose, x: t.pose.x + 0.01 } })), 'provenance-mismatch'],
    'not a trace': [() => null, 'invalid-batch'],
  };
  for (const [name, [alter, cause]] of Object.entries(alterations)) {
    const f = fixture(); f.command('start'); f.capture(f.advance());
    f.capture(alter(f.advance()));
    const status = f.captures.status('world'), source = f.source();
    assert.equal(status.active, false, name); assert.equal(status.partial, true, name); assert.equal(status.actionCount, 2, name);
    assert.deepEqual(status.boundary, { cause, worldEpoch: 'epoch', tick: 1 }, name);
    assert.equal(source.actions.length, 2, name); assert.equal(source.capture.complete, false, name); assert.equal(source.capture.boundary.cause, cause, name);
    assert.equal(f.captures.export('world', 'png').partial, true, name);
  }
  // A skipped world tick is a discontinuity, not a gap to be filled.
  const skip = fixture(); skip.command('start'); skip.capture(skip.advance()); skip.advance(); skip.capture(skip.advance());
  assert.equal(skip.captures.status('world').boundary.cause, 'invalid-batch'); assert.equal(skip.captures.status('world').actionCount, 2);
  // Changed checkpoint lineage or an extra hidden field is a provenance/contract failure.
  const lineage = fixture(); lineage.command('start'); lineage.capture(lineage.advance());
  lineage.states[1].persistence.checkpointId = 'two-newer-save'; lineage.capture(lineage.advance());
  assert.equal(lineage.captures.status('world').boundary.cause, 'provenance-mismatch');
  const hidden = fixture(); hidden.command('start');
  hidden.capture(hidden.advance(), traces => { const batch = fixtureActionBatch(hidden.shared, traces, id => fixtureTraceProvenance(hidden.stateFor(id))); batch.actions[0].target = { x: 0, z: 0 }; return batch; });
  assert.equal(hidden.captures.status('world').boundary.cause, 'invalid-batch'); assert.equal(hidden.captures.status('world').actionCount, 0);
  assert.equal(JSON.parse(hidden.captures.export('world', 'json').bytes).events.length, 0);
});

test('rest, withdrawal, pause, separation, context loss and checkpoint transitions end capture at a recorded boundary without control', () => {
  const transitions = {
    rest: f => { f.shared.participants[1].mode = 'resting'; f.captures.synchronize('world', f.shared); },
    pause: f => { f.shared.status = 'paused'; f.shared.worldEpoch = 'paused-epoch'; f.captures.synchronize('world', f.shared); },
    // A lost rendering context stops frames; the server freshness guard pauses the world.
    'context loss': f => { f.shared.status = 'paused'; f.shared.reason = 'Shared controller deadline elapsed'; f.capture(f.advance()); },
    separate: f => f.captures.synchronize('world', null),
    withdraw: f => f.captures.invalidateMembers(['two'], 'withdraw'),
    checkpoint: f => f.captures.invalidateMembers(['one'], 'save'),
    restore: f => f.captures.invalidateMembers(['one', 'two'], 'restore'),
    membership: f => { f.shared.participants[1].sessionId = 'replacement-session'; f.captures.synchronize('world', f.shared); },
  };
  const expected = { rest: 'rest', pause: 'pause', 'context loss': 'pause', separate: 'separate', withdraw: 'withdraw', checkpoint: 'checkpoint', restore: 'restore', membership: 'membership' };
  for (const [name, transition] of Object.entries(transitions)) {
    const f = fixture(); f.command('start'); f.capture(f.advance()); f.capture(f.advance(false));
    const states = structuredClone(f.states), shared = structuredClone(f.shared);
    transition(f);
    const status = f.captures.status('world');
    assert.equal(status.active, false, name); assert.equal(status.partial, true, name);
    assert.deepEqual(status.boundary, { cause: expected[name], worldEpoch: 'epoch', tick: 2 }, name);
    assert.equal(status.actionCount, 4, name); assert.equal(f.source().capture.boundary.tick, 2, name);
    // Capture never mutates participant state; later batches are ignored without building a trace.
    if (name !== 'context loss') { assert.deepEqual(f.states, states, name); if (!['rest', 'pause', 'membership'].includes(name)) assert.deepEqual(f.shared, shared, name); }
    let supplied = false; f.captures.capture(f.shared, () => { supplied = true; }); assert.equal(supplied, false, name);
  }
  // Start is refused while any member rests; rest itself is valid and unpenalized.
  const resting = fixture(); resting.shared.participants[0].mode = 'resting';
  assert.throws(() => resting.command('start'), /resting.*Rest remains valid/); assert.equal(resting.captures.status('world').captureId, null);
});

test('64-member and 1,024-action bounds keep complete batches and every export stays within its byte limit', () => {
  const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const ids = Array.from({ length: 64 }, (_, i) => uuid(i));
  const f = fixture(Array(64).fill('fixture'), { ids }); f.shared.worldEpoch = uuid(999); f.shared.sharedId = 'world';
  f.shared.participants.forEach((p, i) => { p.pose = { x: -1.5 + (i % 8) * 0.4, z: -1.5 + Math.floor(i / 8) * 0.4, yaw: 0 }; });
  f.command('start');
  for (let tick = 1; tick <= 17; tick++) {
    const traces = f.advance(false);
    for (const [i, p] of f.shared.participants.entries()) { p.pose.x += 0.01; traces[i].pose = { ...p.pose }; traces[i].motor.forward = 0.5; }
    f.capture(tick % 2 ? traces.toReversed() : traces);
  }
  const status = f.captures.status('world');
  assert.equal(status.actionCount, 1024); assert.deepEqual(status.boundary, { cause: 'bound', worldEpoch: uuid(999), tick: 16 });
  assert.equal(status.participants.length, 64); assert.doesNotThrow(() => readSharedCapture(status, 'world'));
  const source = f.source();
  for (const id of ids) assert.equal(source.actions.filter(a => a.individualId === id).length, 16);
  for (const [format] of Object.entries(renderers)) assert(f.captures.export('world', format).bytes.length <= CREATIVE_LIMITS.outputBytes, format);
  const tooMany = fixture(Array(65).fill('fixture'));
  assert.throws(() => tooMany.command('start'), /already running shared population/);
});

test('schema 2 sources reject reordered, relabeled or inconsistent batches; schema 1 remains readable', () => {
  const f = fixture(); f.command('start'); f.capture(f.advance()); f.capture(f.advance()); f.command('stop');
  const source = f.source();
  assert.doesNotThrow(() => validateCreativeSource(source));
  const variants = [
    s => { [s.actions[0], s.actions[1]] = [s.actions[1], s.actions[0]]; },
    s => { s.actions[2].dataset = { ...s.actions[2].dataset, namespace: 'male-cns' }; },
    s => { s.actions[3].checkpointLineage = { checkpointId: 'other', branchOf: null }; },
    s => { s.actions[1].individualId = 'one'; },
    s => { s.actions.pop(); },
    s => { s.capture.boundary.tick = 1; },
    s => { s.capture.boundary.cause = 'pause'; },
    s => { s.participants[0].sourceType = 'connectome'; },
    s => { s.actions[0].tick = 5; },
    s => { s.arrangement.humanContributionId = undefined; },
    s => { s.participants[1].sessionId = s.participants[0].sessionId; for (const a of s.actions.filter(a => a.individualId === 'two')) a.sessionId = s.participants[0].sessionId; },
  ];
  for (const [index, alter] of variants.entries()) { const copy = structuredClone(source); alter(copy); assert.throws(() => validateCreativeSource(copy), undefined, `variant ${index}`); }
  const v1 = { schemaVersion: 1, kind: 'movement-derived-source', sessionId: 's', worldId: 'home', modelVersion: 'synthetic-lif-v1', checkpointId: null,
    participantIds: ['one'], arrangement: source.arrangement, actions: [] };
  assert.equal(JSON.parse(exportCreativeJSON(v1)).kind, 'movement-derived-artifact');
});

test('capture metadata cannot change retained participants and UI rejects foreign or older sources', () => {
  const f = fixture(); f.command('start'); const original = f.captures.status('world'); original.participantIds.reverse(); original.participants[0].dataset.namespace = 'x';
  assert.deepEqual(f.captures.status('world').participantIds, ['one', 'two']); assert.equal(f.captures.status('world').participants[0].dataset.namespace, 'synthetic-fixture');
  assert.equal(newestSharedCapture(null, null), null);
  const current = readSharedCapture(f.captures.status('world'), 'world');
  assert.throws(() => readSharedCapture(current, 'other'));
  assert.throws(() => readSharedCapture({ ...current, traceVersion: 2 }, 'world'));
  assert.throws(() => readSharedCapture({ ...current, participants: [{ ...current.participants[0], derivation: 'learned' }, current.participants[1]] }, 'world'));
  assert.equal(newestSharedCapture(current, { ...current, captureSequence: 0 }), current);
  const terminal = { ...current, active: false, partial: true, reason: 'World separated' };
  assert.equal(newestSharedCapture(terminal, current), terminal);
  assert.equal(newestSharedCapture(current, terminal), terminal);
  assert.equal(newestSharedCapture(terminal, { ...terminal, partial: false, reason: null }), terminal);
  const later = { ...current, actionCount: 2 }; assert.equal(newestSharedCapture(later, current), later);
  assert.equal(newestSharedCapture(later, { ...current, captureSequence: 2, captureId: null }).captureId, null);
});

test('discard and stale commands keep sequences; a new capture needs an explicit discard', () => {
  const f = fixture(); f.command('start'); assert.throws(() => f.command('discard')); assert.throws(() => f.command('start'));
  f.capture(f.advance()); f.command('stop');
  const oldSequence = f.captures.status('world').captureSequence; f.command('discard');
  assert.equal(f.captures.status('world').boundary, null); assert.equal(f.captures.list().length, 0);
  assert.throws(() => f.command('start', { captureSequence: oldSequence }));
  f.command('start'); assert.equal(f.captures.status('world').actionCount, 0); assert.equal(f.captures.status('world').active, true);
  f.captures.synchronize('world', null); assert.equal(f.captures.list().length, 1); assert(f.captures.export('world', 'json').partial);
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
  const frame = () => ({ controllerToken: joined.controllerToken, worldEpoch: shared.worldEpoch, worldTick: shared.tick,
    frames: shared.participants.map(p => ({ version: 1, individualId: p.individualId, sessionId: p.sessionId, environmentEpoch: shared.worldEpoch,
      frameId: shared.tick, simTimeMs: p.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) })) });
  await control('start');
  const body = { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, captureSequence: 0, action: 'start' };
  assert.equal((await post(path, body, { Origin: 'https://other.test' })).status, 403);
  assert.equal((await post(path, body)).status, 200); assert.equal((await post(path, body)).status, 409);
  assert.equal((await get(`/api/shared/${shared.sharedId}`)).shared.tick, 0);
  assert.equal((await get(`/api/shared/${shared.sharedId}`)).shared.commandSequence, 1);
  const accepted = await post(`/api/shared/${shared.sharedId}/frames`, frame()); assert.equal(accepted.status, 200); shared = (await accepted.json()).shared;
  const status = await get(path); assert.equal(status.actionCount, 2);
  assert.deepEqual(status.participants.map(p => [p.individualId, p.sourceType, p.checkpointId]), states.map(s => [s.individualId, 'fixture', s.persistence.checkpointId]));
  const before = ids.map(id => identities.snapshot(id));
  const exportResult = await get(`${path}/export/json`); assert.equal(exportResult.source.actions.length, 2);
  assert.deepEqual(exportResult.source.actions.map(a => [a.individualId, a.tick, a.checkpointLineage.checkpointId]), states.map(s => [s.individualId, 1, s.persistence.checkpointId]));
  assert.deepEqual(ids.map(id => identities.snapshot(id)), before);
  // A checkpoint save changes lineage: capture ends at the recorded boundary; the world keeps running.
  await control('save'); const saved = await get(path);
  assert.equal(saved.active, false); assert.deepEqual(saved.boundary, { cause: 'checkpoint', worldEpoch: status.worldEpoch, tick: 1 });
  assert.equal(shared.status, 'running');
  assert.equal((await post(`/api/shared/${shared.sharedId}/frames`, frame())).status, 200); assert.equal((await get(path)).actionCount, 2);
  await control('separate'); const after = await get(path); assert.equal(after.active, false); assert.equal(after.partial, true); assert.equal(after.boundary.cause, 'checkpoint');
  assert.equal((await get('/api/shared/artifacts')).captures.length, 1);
  const png = await fetch(`${base}${path}/export/png`); assert.equal(png.status, 200); assert.equal(png.headers.get('x-artifact-partial'), 'true');
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
    if (transition === 'advance') { f.advance(); live = structuredClone(f.shared); }
    finishBody({ protocolVersion: 1, sharedId: 'abc', worldEpoch: 'epoch', captureSequence: 0, action: 'start' });
    await pending;
    if (transition !== 'advance') {
      assert.equal(replies[0].code, 409); assert.equal(f.captures.status('abc').active, false);
    } else {
      assert.equal(replies[0].code, 200);
      const from = structuredClone(f.shared.participants[0].pose);
      f.capture(f.advance());
      assert.equal(f.captures.status('abc').active, true);
      const source = JSON.parse(f.captures.export('abc', 'json').bytes).source;
      assert.equal(source.actions.length, 2); assert.equal(source.startTick, 1); assert.equal(source.actions[0].tick, 2);
      assert.deepEqual(source.actions[0].from, { x: (from.x + 2) / 4, y: (from.z + 2) / 4 });
    }
  }
});
