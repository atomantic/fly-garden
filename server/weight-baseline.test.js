import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSparseLif, LIF_MODEL } from './sparse-lif.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createConnectomeRegistry } from './connectome-registry.js';
import { openConnectomeStore } from './connectome-store.js';
import { WEIGHT_LAYERS, GRAPH_MANIFEST_BASELINE, namedWeightBaselines, weightDifferenceLayer } from '../client/src/weight-baseline.js';

const dataset = 'male-cns:v1.0', individualId = 'baseline-individual';
const neuron = raw => `${dataset}/${raw}`;
const graph = () => ({ ids: [0,1,2,3].map(i => neuron(String(9007199254740993n + BigInt(i)))),
  offsets: Uint32Array.from([0,1,2,2,2]), targets: new Uint32Array([2,3]), contacts: new Uint32Array([500,1200]), signs: new Int8Array([1,-1,1,1]) });
const gains = over => ({ rule: 'benign-landmark-association-v1/kc-to-mbon-gain', mappingManifestSha256: 'a'.repeat(64),
  updates: 7, gatedUpdates: 2, gains: [1, 1.02], preTrace: [0, 0], postTrace: [0, 0], ...over });
const extensions = plasticityGains => ({ plasticityGains, eligibilityTraces: null, worldPhase: null, bodyPose: null, rngState: null });

const state = over => ({ protocolVersion: 1, source: 'connectome', individualId, dataset, sessionEpoch: 'epoch', commandSequence: 3,
  resident: true, status: 'paused', graphSha256: 'b'.repeat(64), model: { id: 'test', dtMs: 1, refractorySteps: 2 },
  provenance: { manifestSha256: 'c'.repeat(64) }, neural: { tick: 5, simTimeMs: 5, spikes: 0, totalSpikes: 0, traversedEdges: 0, minimum: 0, maximum: 0 },
  retainedWeightState: { checkpointSchemaVersion: 1, extensionsSha256: null, contactGain: LIF_MODEL.contactGain,
    weightBasis: 'anatomicalContacts * engineeredSign * engineeredContactGain', plasticity: null }, ...over });
const edge = over => ({ edgeIndex: 0, direction: 'outgoing', anatomicalContacts: 500, engineeredSign: 1,
  engineeredWeight: 500 * 1 * LIF_MODEL.contactGain, ...over });
const history = [{ checkpointId: 'ckpt-1', tick: 12, createdAt: 1, bytes: 900, sha256: 'd'.repeat(64), operation: 'save', parentId: null, restoredFrom: null }];

test('the kernel names its weight basis and never invents a retained gain block it does not hold', () => {
  const kernel = createSparseLif(graph(), { dataset, individualId });
  assert.deepEqual(kernel.retainedWeightState(), { checkpointSchemaVersion: 1, extensionsSha256: null,
    weightBasis: 'anatomicalContacts * engineeredSign * engineeredContactGain', contactGain: LIF_MODEL.contactGain, plasticity: null });
  const sha256 = kernel.setCheckpointExtensions(extensions(gains()));
  const retained = kernel.retainedWeightState();
  assert.equal(retained.checkpointSchemaVersion, 2);
  assert.equal(retained.extensionsSha256, sha256);
  assert.deepEqual(retained.plasticity, { rule: 'benign-landmark-association-v1/kc-to-mbon-gain',
    mappingManifestSha256: 'a'.repeat(64), updates: 7, gatedUpdates: 2, edgeCount: 2 });
  // A summary, never a copy: no gain, trace or neural array leaves the kernel here.
  for (const key of ['gains', 'preTrace', 'postTrace']) assert.equal(key in retained.plasticity, false);
  // An extension block whose gain record is unreadable is reported as present and unknown, never as absent.
  kernel.setCheckpointExtensions(extensions('not a gain record'));
  assert.deepEqual(kernel.retainedWeightState().plasticity,
    { rule: 'unknown', mappingManifestSha256: null, updates: null, gatedUpdates: null, edgeCount: null });
  kernel.setCheckpointExtensions(extensions(null));
  assert.equal(kernel.retainedWeightState().plasticity, null);
  assert.equal(kernel.retainedWeightState().checkpointSchemaVersion, 2);
  kernel.setCheckpointExtensions(null);
  assert.equal(kernel.retainedWeightState().checkpointSchemaVersion, 1);
});

test('the worker session and the registry publish the same retained weight state', async () => {
  const session = createConnectomeSession({ graph: graph(), dataset, individualId });
  assert.deepEqual(session.snapshot().retainedWeightState, { checkpointSchemaVersion: 1, extensionsSha256: null,
    weightBasis: 'anatomicalContacts * engineeredSign * engineeredContactGain', contactGain: LIF_MODEL.contactGain, plasticity: null });
  let worker;
  const registry = createConnectomeRegistry({ identities: [{ individualId, dataset, directory: '/trusted' }],
    getResources: async () => ({ aggregateMemoryBytes: 0, availableMemoryBytes: 1e10,
      measurement: { backend: 'connectome', dataset, incrementalMemoryBytes: 100, includesCheckpointSerialization: true } }),
    persistCheckpoint: async () => ({ checkpointId: 'saved' }),
    openBackend: async (_directory, options) => {
      worker = createConnectomeSession({ ...options, graph: graph() });
      let epoch = worker.snapshot().sessionEpoch;
      return { ready: worker.snapshot(), close: async () => {}, ...Object.fromEntries(['snapshot','start','pause','advance','checkpoint','prepareRestore','commitRestore','sample']
        .map(action => [action, async value => { const result = worker.dispatch({ action, value, sessionEpoch: epoch });
          if (result?.sessionEpoch) epoch = result.sessionEpoch; return result; }])) };
    } });
  // An unloaded individual reports no retained weight state rather than a default one.
  assert.equal(registry.snapshot(individualId).retainedWeightState, null);
  await registry.load(individualId);
  assert.deepEqual(registry.snapshot(individualId).retainedWeightState, worker.snapshot().retainedWeightState);
  await registry.close();
});

test('durable checkpoints cannot carry a retained gain block or a foreign graph', t => {
  const path = mkdtempSync(join(tmpdir(), 'weight-baseline-store-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const profiles = { [dataset]: { directory: '/trusted', manifestSha256: 'ab'.repeat(32),
    graphSha256: createSparseLif(graph(), { dataset }).graphSha256, neuronCount: 4, edgeCount: 2 } };
  const store = openConnectomeStore(path, { profiles });
  t.after(() => store.close());
  const identity = store.create(dataset);
  const kernel = createSparseLif(graph(), { individualId: identity.individualId, dataset });
  const save = checkpoint => store.persistCheckpoint({ individualId: identity.individualId, dataset,
    parentId: store.identities().find(item => item.individualId === identity.individualId).checkpointId,
    checkpoint, operation: 'save', sourceCheckpointId: null });
  assert.ok(save(kernel.checkpoint()).checkpointId);
  // This refusal is what lets a listed checkpoint be named as a baseline that provably carries no gains.
  kernel.setCheckpointExtensions(extensions(gains()));
  const extended = kernel.checkpoint();
  assert.equal(extended.schemaVersion, 2);
  assert.throws(() => save(extended));
  assert.throws(() => save({ ...kernel.checkpoint(), schemaVersion: 1, extensions: undefined, graphSha256: 'f'.repeat(64) }));
});

test('baselines are named and digested; nothing is compared against an unnamed source', () => {
  assert.deepEqual(WEIGHT_LAYERS.map(layer => layer.id),
    ['measured-structure', 'engineered-parameters', 'instantaneous-state', 'baseline-difference']);
  const baselines = namedWeightBaselines(state(), history);
  assert.deepEqual(baselines.map(item => item.id), [GRAPH_MANIFEST_BASELINE, 'checkpoint:ckpt-1']);
  assert.equal(baselines[0].sha256, 'c'.repeat(64));
  assert.equal(baselines[1].sha256, 'd'.repeat(64));
  // A history row without an exact digest or tick is not offered as a baseline at all.
  assert.deepEqual(namedWeightBaselines(state(), [{ ...history[0], sha256: 'short' }]).map(item => item.id), [GRAPH_MANIFEST_BASELINE]);
  assert.deepEqual(namedWeightBaselines(state({ provenance: null }), history), []);
  const unnamed = weightDifferenceLayer({ state: state(), baselineId: 'checkpoint:absent', checkpoints: history, edges: [edge()] });
  assert.equal(unnamed.outcome, 'refused');
  assert.equal(unnamed.rows.length, 0);
});

test('an absent gain block is reported as an explicit zero difference against the named baseline', () => {
  const result = weightDifferenceLayer({ state: state(), baselineId: GRAPH_MANIFEST_BASELINE, checkpoints: history,
    edges: [edge(), edge({ edgeIndex: 1, direction: 'incoming', anatomicalContacts: 1200, engineeredSign: -1, engineeredWeight: 1200 * -1 * LIF_MODEL.contactGain })],
    totalMatching: 5 });
  assert.equal(result.outcome, 'compared');
  assert.equal(result.differingEdges, 0);
  assert.deepEqual(result.extent, { comparedEdges: 2, matchingEdges: 5, complete: false });
  assert.deepEqual(result.rows.map(row => row.delta), [0, 0]);
  assert.deepEqual(result.rows[1], { edgeIndex: 1, direction: 'incoming', baselineWeight: -1.2, currentWeight: -1.2, delta: 0 });
  assert.match(result.reason, /declared state, not by recomputing/);
  assert.match(result.reason, /no learned weight change exists/i);
  assert.equal(weightDifferenceLayer({ state: state(), baselineId: GRAPH_MANIFEST_BASELINE, checkpoints: history,
    edges: [edge()], totalMatching: 1 }).extent.complete, true);
  // The sampled extent is explicit even when the caller cannot state the total.
  assert.deepEqual(weightDifferenceLayer({ state: state(), baselineId: GRAPH_MANIFEST_BASELINE, checkpoints: history,
    edges: [edge()] }).extent, { comparedEdges: 1, matchingEdges: null, complete: false });
});

test('an unreported, unloaded, disagreeing or gain-holding runtime never yields a zero difference', () => {
  const base = { baselineId: GRAPH_MANIFEST_BASELINE, checkpoints: history, edges: [edge()], totalMatching: 1 };
  const unreported = weightDifferenceLayer({ ...base, state: state({ retainedWeightState: null }) });
  assert.equal(unreported.outcome, 'unreported');
  assert.equal(unreported.differingEdges, null);
  assert.match(unreported.reason, /no absence of change is claimed/);
  for (const over of [{ resident: false }, { status: 'saved-unloaded' }])
    assert.equal(weightDifferenceLayer({ ...base, state: state(over) }).outcome, 'refused');
  // Anatomy and runtime disagreeing about the engineered mapping stops the whole comparison.
  const disagreement = weightDifferenceLayer({ ...base, state: state(), edges: [edge({ engineeredWeight: 0.7 })] });
  assert.equal(disagreement.outcome, 'refused');
  assert.equal(disagreement.rows.length, 0);
  assert.equal(weightDifferenceLayer({ ...base, edges: [edge({ engineeredSign: 2 })], state: state() }).outcome, 'refused');
  assert.equal(weightDifferenceLayer({ ...base, edges: [edge({ direction: 'sideways' })], state: state() }).outcome, 'refused');
  // A self connection is a real anatomical row, not a malformed one.
  assert.equal(weightDifferenceLayer({ ...base, edges: [edge({ direction: 'self' })], state: state() }).outcome, 'compared');
  const holding = weightDifferenceLayer({ ...base, state: state({ retainedWeightState:
    { checkpointSchemaVersion: 2, extensionsSha256: 'e'.repeat(64), contactGain: LIF_MODEL.contactGain,
      weightBasis: 'anatomicalContacts * engineeredSign * engineeredContactGain',
      plasticity: { rule: 'benign-landmark-association-v1/kc-to-mbon-gain', mappingManifestSha256: 'a'.repeat(64), updates: 7, gatedUpdates: 2, edgeCount: 2 } } }) });
  assert.equal(holding.outcome, 'unattributable');
  assert.equal(holding.differingEdges, null);
  assert.equal(holding.rows.length, 0);
  assert.match(holding.reason, /rather than a zero one/);
});
