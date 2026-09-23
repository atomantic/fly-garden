import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Scene } from 'three';
import {
  FIXTURE_POSE_UNAVAILABLE, MIXED_WORLD_KIND, RESEARCH_BODY_UNAVAILABLE,
  buildMixedWorldPresentation, mixedMembershipKey, readMixedWorldPresentation,
} from '../shared/mixed-world-presentation.js';
import { createMixedWorldHttp } from './mixed-world-http.js';
import { createMixedVisualWorld } from '../client/src/shared-visual-world.js';
import { MIXED_CONTEXT_LOST, MIXED_WORLD_STALE_MS, acceptMixedPresentation, mixedWorldView } from '../client/src/mixed-world-state.js';
import { createServer } from './index.js';
import { openIdentityStore } from './identity-store.js';
import { openConnectomeStore } from './connectome-store.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createSparseLif } from './sparse-lif.js';
import { createCapacityPolicy } from './population-capacity.js';

// Injected presentation state only: no runtime, worker, renderer, full dataset or simulation.
const SHA = 'ab'.repeat(32);
const fixtureDataset = { namespace: 'synthetic-fixture', release: '1', modelId: 'synthetic-lif-v1' };
const research = { sensoryMotor: false, learning: false, chemistry: false, embodiment: false, disclosure: 'research only' };
const fixtureSession = (overrides = {}) => ({
  version: 2, sharedId: 'fixture-world', worldEpoch: 'fixture-epoch', tick: 12, intervalMs: 5, worldTimeMs: 60, status: 'running', reason: 'Failure at /Users/private/store.json',
  lastReceivedAtMs: 1, controllerToken: 'f'.repeat(64),
  participants: [
    { individualId: 'fixture-a', sessionId: 'session-a', dataset: fixtureDataset, simTimeMs: 60, mode: 'active', status: 'running', pose: { x: 0.5, z: -0.25, yaw: 1 }, motor: { forward: 0.4, yaw: 0.1 } },
    { individualId: 'fixture-b', sessionId: 'session-b', dataset: fixtureDataset, simTimeMs: 40, mode: 'resting', status: 'resting', pose: { x: -1, z: 1, yaw: 0 }, motor: { forward: 0, yaw: 0 } },
    { individualId: 'fixture-c', sessionId: 'session-c', dataset: fixtureDataset, simTimeMs: 60, mode: 'active', status: 'running', pose: { x: 9, z: 0, yaw: 0 }, motor: { forward: 0, yaw: 0 } },
  ],
  events: [{ type: 'join', tick: 0 }, { type: 'withdraw', tick: 7, individualId: 'fixture-gone' }], disclosure: 'fixture', ...overrides,
});
const connectomeSession = (overrides = {}) => ({
  protocolVersion: 1, kind: 'full-connectome-research-shared', sharedId: 'research-world', worldEpoch: 'research-epoch', tick: 3, intervalMs: 5, worldTimeMs: 15,
  status: 'paused', reason: 'Shared research session paused.', commandSequence: 4, substeps: 5, disclosure: 'research',
  participants: [
    { individualId: 'male-1', sessionEpoch: 'epoch-m', dataset: 'male-cns:v1.0', mode: 'active', status: 'paused', tick: 15, simTimeMs: 15, graphSha256: SHA, model: { id: 'sparse-lif-v1' }, capabilities: research,
      pose: { x: 0, z: 0, yaw: 0 }, neural: { spikes: 3 }, directory: '/trusted/private/male-1' },
    { individualId: 'female-1', sessionEpoch: 'epoch-f', dataset: 'banc:v888', mode: 'resting', status: 'resting', tick: 10, simTimeMs: 10, graphSha256: null, model: null, capabilities: research },
  ],
  events: [], ...overrides,
});
const build = ({ fixture = [fixtureSession()], connectome = [connectomeSession()], fixtureAvailable = true, connectomeAvailable = true, extra = {} } = {}) =>
  buildMixedWorldPresentation({ fixture: { available: fixtureAvailable, sessions: fixture }, connectome: { available: connectomeAvailable, sessions: connectome }, generatedAtMs: 1000, ...extra });
const withheld = (value, pattern) => {
  assert.equal(value.available, false); assert.deepEqual(value.participants, []); assert.deepEqual(value.cohorts, []);
  assert.match(value.reason, pattern);
  readMixedWorldPresentation(value);
};

test('a mixed membership presents one complete provenance-labeled batch and never invents a research body', () => {
  const value = build();
  assert.equal(value.kind, MIXED_WORLD_KIND); assert.equal(value.version, 1); assert.equal(value.available, true);
  assert.deepEqual(value.participants.map(item => [item.individualId, item.source, item.namespace, item.sessionEpoch, item.cohortId, item.worldEpoch, item.lifecycle, item.mode, item.body.kind]), [
    ['fixture-a', 'fixture', 'synthetic-fixture', 'session-a', 'fixture-world', 'fixture-epoch', 'running', 'active', 'fixture-procedural'],
    ['fixture-b', 'fixture', 'synthetic-fixture', 'session-b', 'fixture-world', 'fixture-epoch', 'resting', 'resting', 'fixture-procedural'],
    ['fixture-c', 'fixture', 'synthetic-fixture', 'session-c', 'fixture-world', 'fixture-epoch', 'running', 'active', 'unavailable'],
    ['male-1', 'connectome', 'male-cns:v1.0', 'epoch-m', 'research-world', 'research-epoch', 'paused', 'active', 'unavailable'],
    ['female-1', 'connectome', 'banc:v888', 'epoch-f', 'research-world', 'research-epoch', 'resting', 'resting', 'unavailable'],
  ]);
  assert.deepEqual(value.participants[0].body.pose, { x: 0.5, z: -0.25, yaw: 1 });
  assert.equal(value.participants[2].body.reason, FIXTURE_POSE_UNAVAILABLE);
  // A research participant carrying a pose-like field still gets the explicit unavailable marker.
  assert.deepEqual(value.participants[3].body, { kind: 'unavailable', reason: RESEARCH_BODY_UNAVAILABLE });
  assert.equal(value.participants[3].boundary, 'research-only'); assert.equal(value.participants[3].graphSha256, SHA); assert.equal(value.participants[3].modelId, 'sparse-lif-v1');
  assert.equal(value.participants[4].modelId, null); assert.equal(value.participants[0].modelId, 'synthetic-lif-v1');
  assert.deepEqual(value.cohorts.map(item => [item.cohortId, item.source, item.sessionVersion, item.status, item.tick, item.memberIds.length]),
    [['fixture-world', 'fixture', 2, 'running', 12, 3], ['research-world', 'connectome', 1, 'paused', 3, 2]]);
  assert.deepEqual(value.cohorts[0].withdrawals, [{ individualId: 'fixture-gone', tick: 7 }]);
  assert.deepEqual(value.sources, { fixture: { available: true, cohortCount: 1 }, connectome: { available: true, cohortCount: 1 } });
  // Allowlisted copy: no token, neural state, motor output, private path or free-form failure reason.
  const text = JSON.stringify(value);
  for (const secret of ['controllerToken', 'ffffffff', '"neural"', 'spikes', '"motor"', 'forward', '/Users/private', '/trusted/private', 'simTimeMs', 'reason":"Failure']) assert.equal(text.includes(secret), false, secret);
});

test('session order and registry iteration cannot reorder or re-identify participants', () => {
  const second = fixtureSession({ sharedId: 'another-world', worldEpoch: 'other-epoch', participants: [
    { individualId: 'fixture-x', sessionId: 'session-x', dataset: fixtureDataset, simTimeMs: 0, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } },
    { individualId: 'fixture-y', sessionId: 'session-y', dataset: fixtureDataset, simTimeMs: 0, status: 'paused', pose: { x: 0, z: 0, yaw: 0 } }], version: 1 });
  const forward = build({ fixture: [fixtureSession(), second] }), reversed = build({ fixture: [second, fixtureSession()] });
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward.cohorts.map(item => item.cohortId), ['another-world', 'fixture-world', 'research-world']);
  // Coincident poses are preserved rather than separated or merged into one body.
  assert.equal(forward.participants.filter(item => item.cohortId === 'another-world').length, 2);
});

test('inconsistent membership, epochs, provenance or capability claims withhold the whole world', () => {
  const participant = (index, extra = {}) => ({ individualId: `fixture-${index}`, sessionId: `session-${index}`, dataset: fixtureDataset, simTimeMs: 0, status: 'paused', pose: { x: 0, z: 0, yaw: 0 }, ...extra });
  withheld(build({ fixture: [], connectome: [] }), /No admitted shared participants/);
  withheld(build({ fixture: [fixtureSession({ version: 1, participants: Array.from({ length: 64 }, (_, i) => participant(i)) })] }), /2–64/);
  withheld(build({ connectome: [connectomeSession({ participants: [{ ...connectomeSession().participants[0], individualId: 'fixture-a' }, connectomeSession().participants[1]] })] }), /appears twice/);
  withheld(build({ connectome: [connectomeSession({ sharedId: 'fixture-world' })] }), /duplicated/);
  withheld(build({ fixture: [fixtureSession({ worldEpoch: '' })] }), /epoch/);
  withheld(build({ fixture: [fixtureSession({ status: 'separated' })] }), /status/);
  withheld(build({ fixture: [fixtureSession({ version: 3 })] }), /contract version/);
  withheld(build({ fixture: [fixtureSession({ version: 1 })] }), /Version 1 fixture participant/);
  withheld(build({ fixture: [fixtureSession({ participants: fixtureSession().participants.slice(0, 1) })] }), /2–64/);
  const fixtureMember = extra => fixtureSession({ participants: [{ ...fixtureSession().participants[0], ...extra }, fixtureSession().participants[1]] });
  withheld(build({ fixture: [fixtureMember({ dataset: { namespace: 'male-cns:v1.0', modelId: 'x' } })] }), /synthetic fixture namespace/);
  withheld(build({ fixture: [fixtureMember({ sessionId: undefined })] }), /runtime session epoch/);
  withheld(build({ fixture: [fixtureMember({ status: 'dancing' })] }), /unknown lifecycle/);
  withheld(build({ fixture: [fixtureMember({ mode: 'sleeping' })] }), /quiet-state mode/);
  withheld(build({ fixture: [fixtureMember({ individualId: '../etc' })] }), /stable individual ID/);
  const researchMember = extra => connectomeSession({ participants: [{ ...connectomeSession().participants[0], ...extra }, connectomeSession().participants[1]] });
  withheld(build({ connectome: [researchMember({ capabilities: { ...research, embodiment: true } })] }), /no adapter authority/);
  withheld(build({ connectome: [researchMember({ capabilities: { ...research, sensoryMotor: true } })] }), /no adapter authority/);
  withheld(build({ connectome: [researchMember({ capabilities: undefined })] }), /no adapter authority/);
  withheld(build({ connectome: [researchMember({ dataset: 'synthetic-fixture' })] }), /pinned connectome namespace/);
  withheld(build({ connectome: [researchMember({ graphSha256: 'not-a-hash' })] }), /graph or model provenance/);
  withheld(build({ connectome: [researchMember({ sessionEpoch: null })] }), /worker session epoch/);
  withheld(build({ connectome: [connectomeSession({ kind: 'fixture' })] }), /contract version/);
  // Failing or unavailable sources never silently drop their participants from a smaller world.
  withheld(buildMixedWorldPresentation({ fixture: { available: false, sessions: [], failed: true }, connectome: { available: true, sessions: [connectomeSession()] }, generatedAtMs: 1 }), /could not be read/);
  withheld(build({ connectomeAvailable: false }), /still reports shared sessions/);
  withheld(build({ extra: { generatedAtMs: -1 } }), /clock/);
  // A source that is genuinely absent presents the remaining complete sessions, labeled by source.
  const fixtureOnly = build({ connectome: [], connectomeAvailable: false });
  assert.equal(fixtureOnly.available, true); assert.deepEqual(fixtureOnly.sources.connectome, { available: false, cohortCount: 0 });
});

test('the strict reader refuses tampered batches and the membership key ignores clocks but not identity', () => {
  const value = build();
  readMixedWorldPresentation(structuredClone(value));
  const tampered = [
    v => { v.participants[3].body = { kind: 'fixture-procedural', pose: { x: 0, z: 0, yaw: 0 } }; },
    v => { v.participants[0].neural = { spikes: 1 }; },
    v => { v.participants[1].worldEpoch = 'other'; },
    v => { v.cohorts[0].memberIds.reverse(); },
    v => { v.participants.pop(); },
    v => { v.participants[4].source = 'fixture'; },
    v => { v.participants[0].graphSha256 = SHA; },
    v => { v.available = false; v.reason = 'x'; },
    v => { v.disclosure = 'This is embodied.'; },
    v => { v.sources.fixture.cohortCount = 2; },
    v => { v.participants[0].body.pose.x = Number.NaN; },
  ];
  for (const change of tampered) { const copy = structuredClone(value); change(copy); assert.throws(() => readMixedWorldPresentation(copy), undefined, change.toString()); }
  const moved = build({ fixture: [fixtureSession({ tick: 99, worldEpoch: 'fixture-epoch-2', participants: fixtureSession().participants.map(item => ({ ...item, pose: item.pose.x === 9 ? item.pose : { ...item.pose, x: 0 } })) })] });
  assert.equal(mixedMembershipKey(moved), mixedMembershipKey(value));
  const withdrawn = build({ fixture: [fixtureSession({ participants: fixtureSession().participants.slice(0, 2) })] });
  assert.notEqual(mixedMembershipKey(withdrawn), mixedMembershipKey(value));
  const reposed = build({ fixture: [fixtureSession({ participants: fixtureSession().participants.map(item => ({ ...item, pose: { x: 0, z: 0, yaw: 0 } })) })] });
  assert.notEqual(mixedMembershipKey(reposed), mixedMembershipKey(value));
  assert.equal(mixedMembershipKey(build({ fixture: [], connectome: [] })), null);
});

test('the scene builds exactly one labeled object per participant and rebuilds rather than patches membership', () => {
  const scene = new Scene(), value = build(), visual = createMixedVisualWorld(scene, value);
  try {
    assert.equal(visual.objects.size, 5);
    assert.deepEqual([...visual.objects.values()].map(item => [item.userData.individualId, item.userData.source, item.userData.kind]), [
      ['fixture-a', 'fixture', 'fixture-body'], ['fixture-b', 'fixture', 'fixture-body'], ['fixture-c', 'fixture', 'unavailable-marker'],
      ['male-1', 'connectome', 'research-marker'], ['female-1', 'connectome', 'research-marker']]);
    const a = visual.objects.get('fixture-a'), [cx, cz] = a.userData.origin;
    assert.deepEqual(a.position.toArray().map(n => Number(n.toFixed(6))), [cx + 0.5, 0.33, cz - 0.25]);
    assert.equal(a.rotation.y, 1 + Math.PI);
    // Research markers and the unavailable fixture marker are not fly bodies: a handful of meshes, no wings or legs.
    for (const id of ['fixture-c', 'male-1', 'female-1']) { let meshes = 0; visual.objects.get(id).traverse(object => { if (object.isMesh) meshes++; }); assert.equal(meshes, 4, id); }
    let bodyMeshes = 0; a.traverse(object => { if (object.isMesh) bodyMeshes++; }); assert.equal(bodyMeshes, 14); // 13 procedural body meshes plus the hidden highlight ring.
    // Separate plots: a research marker never sits on a fixture plot.
    assert.notDeepEqual(visual.objects.get('male-1').userData.origin, a.userData.origin);
    const frozen = [...visual.objects.values()].map(item => item.position.toArray());
    const research = visual.objects.get('male-1').position.toArray();
    const moved = build({ fixture: [fixtureSession({ participants: fixtureSession().participants.map(item => item.individualId === 'fixture-a' ? { ...item, pose: { x: 1, z: 1, yaw: 0 } } : item) })] });
    assert.equal(visual.apply(moved), true);
    assert.deepEqual(a.position.toArray().map(n => Number(n.toFixed(6))), [cx + 1, 0.33, cz + 1]);
    assert.deepEqual(visual.objects.get('male-1').position.toArray(), research);
    const withdrawn = build({ fixture: [fixtureSession({ participants: fixtureSession().participants.slice(0, 2) })] });
    const before = [...visual.objects.values()].map(item => item.position.toArray());
    assert.equal(visual.apply(withdrawn), false);
    assert.deepEqual([...visual.objects.values()].map(item => item.position.toArray()), before);
    assert.notDeepEqual(before, frozen);
    assert.equal(visual.highlight('female-1'), true);
    const lit = [...visual.objects.entries()].filter(([, holder]) => { let on = false; holder.traverse(object => { if (object.userData.highlight && object.visible) on = true; }); return on; }).map(([id]) => id);
    assert.deepEqual(lit, ['female-1']);
    assert.equal(visual.highlight('unknown'), false);
    assert.throws(() => createMixedVisualWorld(new Scene(), build({ fixture: [], connectome: [] })), /unavailable/);
    assert.throws(() => createMixedVisualWorld(new Scene(), { ...value, participants: [] }));
  } finally { visual.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('stale data, read failure and graphics loss stop presentation without altering the batch', () => {
  const value = build();
  assert.deepEqual(mixedWorldView({ presentation: value, receivedAtMs: 1000, nowMs: 1500 }), { present: true, table: true, alert: false, message: null });
  for (const stale of [{ receivedAtMs: 1000, nowMs: 1001 + MIXED_WORLD_STALE_MS }, { receivedAtMs: 1000, nowMs: 999 }, { receivedAtMs: null, nowMs: 1000 }]) {
    const view = mixedWorldView({ presentation: value, ...stale });
    assert.equal(view.present, false); assert.equal(view.table, false); assert.match(view.message, /stale/);
  }
  const failed = mixedWorldView({ presentation: value, receivedAtMs: 1000, nowMs: 1000, readError: 'offline' });
  assert.equal(failed.present || failed.table, false); assert.match(failed.message, /offline\. Presentation stopped/);
  const lost = mixedWorldView({ presentation: value, receivedAtMs: 1000, nowMs: 1000, contextLost: true });
  assert.deepEqual([lost.present, lost.table, lost.message], [false, true, MIXED_CONTEXT_LOST]);
  const unavailable = mixedWorldView({ presentation: build({ fixture: [], connectome: [] }), receivedAtMs: 1000, nowMs: 1000 });
  assert.equal(unavailable.present || unavailable.table, false);
  const newer = { ...value, generatedAtMs: 2000 };
  assert.equal(acceptMixedPresentation(newer, value), newer);
  assert.equal(acceptMixedPresentation(value, newer), newer);
  assert.equal(acceptMixedPresentation(null, value), value);
});

test('the HTTP shell is GET-only, query-free, and reports failed reads without leaking their text', () => {
  const calls = [], responses = [];
  const json = (response, status, value) => responses.push([status, value]);
  const handler = createMixedWorldHttp({ json, now: () => 5000,
    readFixtureSessions: () => { calls.push('fixture'); return [fixtureSession()]; },
    readConnectomeView: () => { calls.push('connectome'); return { protocolVersion: 1, available: true, sessions: [connectomeSession()] }; } });
  const url = path => new URL(`http://localhost${path}`);
  assert.equal(handler({ method: 'GET' }, {}, url('/api/shared/x')), false);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.throws(() => handler({ method }, {}, url('/api/mixed-world')), error => error.statusCode === 405);
  assert.throws(() => handler({ method: 'GET' }, {}, url('/api/mixed-world?start=1')), error => error.statusCode === 400);
  assert.deepEqual(calls, []);
  assert.equal(handler({ method: 'GET' }, {}, url('/api/mixed-world')), true);
  assert.equal(responses[0][0], 200); assert.equal(responses[0][1].available, true); assert.equal(responses[0][1].generatedAtMs, 5000);
  const failing = createMixedWorldHttp({ json, readFixtureSessions: () => { throw new Error('EACCES: /Users/private/identities.json'); }, readConnectomeView: () => ({ available: false, sessions: [] }) });
  failing({ method: 'GET' }, {}, url('/api/mixed-world'));
  const failed = responses.at(-1)[1];
  assert.equal(failed.available, false); assert.equal(JSON.stringify(failed).includes('/Users/private'), false);
  const absent = createMixedWorldHttp({ json });
  absent({ method: 'GET' }, {}, url('/api/mixed-world'));
  assert.match(responses.at(-1)[1].reason, /No admitted shared participants/);
});

test('the browser shell only reads the mixed world route and exposes no mutation or adapter path', () => {
  const sources = ['../client/src/MixedWorldScene.jsx', '../client/src/mixed-world-state.js', '../shared/mixed-world-presentation.js', './mixed-world-http.js']
    .map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const source of sources) {
    for (const forbidden of ['method:', "'POST'", 'controllerToken', "/control'", '/control`', '/barrier', '/member', '/join', '/restore', '/frames', 'readRetina', 'requestAnimationFrame']) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.deepEqual([...sources[0].matchAll(/fetch\(([^,)]+)/g)].map(match => match[1]), ["'/api/mixed-world'"]);
});

const datasets = ['male-cns:v1.0', 'banc:v888'];
const graph = dataset => ({ ids: [`${dataset}/1`, `${dataset}/2`], offsets: new Uint32Array([0, 1, 2]), targets: new Uint32Array([1, 0]), contacts: new Uint32Array([2, 2]), signs: new Int8Array([1, 1]) });
function tinyBackend(options) {
  const session = createConnectomeSession({ ...options, graph: graph(options.dataset), provenance: { manifestSha256: SHA } });
  let epoch = session.snapshot().sessionEpoch;
  const dispatch = async (action, value) => { const result = session.dispatch({ action, value, sessionEpoch: epoch }); if (result?.sessionEpoch) epoch = result.sessionEpoch; return result; };
  return { ready: session.snapshot(), close: async () => {}, snapshot: () => dispatch('snapshot'), start: () => dispatch('start'), pause: () => dispatch('pause'),
    advance: value => dispatch('advance', value), prepareAdvance: value => dispatch('prepareAdvance', value), commitAdvance: value => dispatch('commitAdvance', value),
    rollbackAdvance: value => dispatch('rollbackAdvance', value), releaseAdvance: value => dispatch('releaseAdvance', value), checkpoint: () => dispatch('checkpoint') };
}

test('an app observer reading a real mixed fixture/tiny-graph population changes no participant', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mixed-world-'));
  const identities = openIdentityStore(join(directory, 'fixtures'));
  const fixtureIds = [identities.primaryId, identities.create().individualId]; identities.load(fixtureIds[1]);
  const descriptors = Object.fromEntries(datasets.map(dataset => [dataset, { directory: join(directory, dataset), graphSha256: createSparseLif(graph(dataset), { dataset }).graphSha256, manifestSha256: SHA, neuronCount: 2, edgeCount: 2 }]));
  const catalog = openConnectomeStore(join(directory, 'catalog'), { profiles: descriptors });
  const profiles = Object.fromEntries(datasets.map(dataset => [dataset, { descriptor: descriptors[dataset], measurement: { available: true, backend: 'connectome', dataset, includesCheckpointSerialization: true, incrementalMemoryBytes: 1000 } }]));
  const server = createServer({ identities, autoTick: false, capacity: createCapacityPolicy({ settings: { maxResidentFlies: 4, maxAggregateMemoryBytes: 100000, minFreeMemoryBytes: 100 } }),
    resourceUsage: () => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 100000 }), connectomeCatalog: catalog, connectomeProfiles: profiles, connectomeBackend: async (_directory, options) => tinyBackend(options) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); catalog.close(); identities.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async path => (await fetch(base + path)).json();
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.match((await get('/api/mixed-world')).reason, /No admitted shared participants/);
  const researchIds = [];
  for (const dataset of datasets) {
    const view = await get('/api/connectomes');
    const created = (await (await post('/api/connectomes', { protocolVersion: 1, catalogEpoch: view.catalogEpoch, commandSequence: view.commandSequence, dataset })).json()).state;
    const state = await get(`/api/connectomes/${created.individualId}`);
    assert.equal((await post(`/api/connectomes/${created.individualId}/commands`, { protocolVersion: 1, individualId: created.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action: 'load', steps: null, checkpointId: null })).status, 200);
    researchIds.push(created.individualId);
  }
  const researchStates = await Promise.all(researchIds.map(id => get(`/api/connectomes/${id}`)));
  assert.equal((await post('/api/connectomes/shared/join', { protocolVersion: 1, members: researchStates.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionEpoch: value.sessionEpoch, commandSequence: value.commandSequence })) })).status, 200);
  const fixtureStates = await Promise.all(fixtureIds.map(id => get(`/api/individuals/${id}`)));
  const joined = await post('/api/shared/join', { protocolVersion: 1, sharedVersion: 2, members: fixtureStates.map(value => ({ protocolVersion: 1, individualId: value.individualId, sessionId: value.sessionId, sequence: value.commandSequence + 1 })) });
  assert.equal(joined.status, 200);
  const { controllerToken } = await joined.json();
  const observe = async () => ({
    fixtures: await Promise.all(fixtureIds.map(async id => { const value = await get(`/api/individuals/${id}`); return [value.sessionId, value.commandSequence, value.status, value.tick, value.sharedSession?.commandSequence ?? null, value.sharedSession?.worldEpoch]; })),
    research: await Promise.all(researchIds.map(async id => { const value = await get(`/api/connectomes/${id}`); return [value.sessionEpoch, value.commandSequence, value.status, value.neural?.tick]; })),
    researchShared: (await get('/api/connectomes/shared')).sessions.map(item => [item.sharedId, item.worldEpoch, item.commandSequence, item.status, item.tick]),
  });
  const before = await observe();
  const first = await (await fetch(`${base}/api/mixed-world`)).text(), second = await get('/api/mixed-world');
  assert.equal(first.includes(controllerToken), false); assert.equal(first.includes('"neural"'), false);
  assert.equal(second.available, true); assert.equal(second.participants.length, 4);
  assert.deepEqual(second.participants.map(item => [item.source, item.individualId]).sort(), [...fixtureIds.map(id => ['fixture', id]), ...researchIds.map(id => ['connectome', id])].sort());
  assert.ok(second.participants.filter(item => item.source === 'connectome').every(item => item.body.kind === 'unavailable' && item.graphSha256 && item.lifecycle === 'paused'));
  assert.ok(second.participants.filter(item => item.source === 'fixture').every(item => item.body.kind === 'fixture-procedural' && item.lifecycle === 'paused'));
  assert.equal((await post('/api/mixed-world', {})).status, 405);
  assert.deepEqual(await observe(), before);
});
