import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createSparseLif } from './sparse-lif.js';
import { createBenignPlasticity, PLASTICITY_RULE } from './benign-plasticity.js';
import { createExternalReadoutLearner, EXTERNAL_READOUT_RULE } from './external-readout-learner.js';
import { analyzeDataset, createSeededRandom } from './benign-learning-analysis.js';
import { buildMappingManifest, promotableManifestSha256 } from './benign-learning-manifest.js';
import { assignedRuns, deriveSeed, evaluateGates, runBenignLearningCampaign, validateTrialRecord, PER_TRIAL_RECORD_FIELDS } from './benign-learning-campaign.js';

const read = name => JSON.parse(readFileSync(new URL(`../experiments/benign-learning-v1/${name}`, import.meta.url)));
const MANIFEST = '0'.repeat(63) + '1';
const plasticEdges = [
  { preIndex: 0, postIndex: 2, baselineWeight: 0.5 },
  { preIndex: 1, postIndex: 2, baselineWeight: 0 },
];
const newPlasticity = () => createBenignPlasticity({ edges: plasticEdges, compartmentValidated: true, mappingManifestSha256: MANIFEST, neuronCount: 3 });

test('localized plasticity refuses to exist without a validated compartment-matched edge set', () => {
  for (const overrides of [{ compartmentValidated: false }, { compartmentValidated: 'yes' }, { mappingManifestSha256: 'not-a-digest' }]) {
    assert.throws(() => createBenignPlasticity({ edges: plasticEdges, compartmentValidated: true, mappingManifestSha256: MANIFEST, neuronCount: 3, ...overrides }));
  }
  assert.throws(() => createBenignPlasticity({ edges: [{ preIndex: 0, postIndex: 2, baselineWeight: 0.5 }, { preIndex: 0, postIndex: 2, baselineWeight: 0.5 }], compartmentValidated: true, mappingManifestSha256: MANIFEST, neuronCount: 3 }), /Duplicate/);
});

test('traces decay, clamp and drive the declared bounded depression rule one tick late', () => {
  const plasticity = newPlasticity();
  const decay = Math.exp(-1 / PLASTICITY_RULE.traceTauMs);
  // A gated tick may not change the weights the kernel reads during that tick.
  const first = plasticity.tick({ firing: [1, 1, 1], gate: 1 });
  assert.deepEqual(Array.from(first.effectiveWeights), [0.5, 0]);
  assert.equal(plasticity.gains()[0], 1 - PLASTICITY_RULE.etaPerSecond * 1 * 1 * 1 * 0.001);
  const second = plasticity.tick({ firing: [0, 0, 0], gate: 0 });
  assert.equal(second.effectiveWeights[0], 0.5 * plasticity.gains()[0]);
  // A zero baseline weight stays exactly zero however the gain moves.
  assert.equal(second.effectiveWeights[1], 0);
  // Repeated spikes clamp the trace at exactly 1.
  const saturating = newPlasticity();
  for (let i = 0; i < 500; i++) saturating.tick({ firing: [1, 1, 1], gate: 0 });
  const state = saturating.state();
  assert.equal(state.preTrace[0], 1);
  // One spike after a silent gap decays to exactly the declared factor.
  const single = newPlasticity();
  single.tick({ firing: [1, 0, 0], gate: 0 });
  single.tick({ firing: [0, 0, 0], gate: 0 });
  assert.equal(single.state().preTrace[0], decay);
  // Gains are bounded below at 0.8 no matter how long the gate is open.
  const bounded = newPlasticity();
  for (let i = 0; i < 200000; i++) bounded.tick({ firing: [1, 1, 1], gate: 1 });
  assert.equal(bounded.gains()[0], PLASTICITY_RULE.gainRange[0]);
});

test('evaluation phases never update gains or accept an out-of-range gate', () => {
  const plasticity = newPlasticity();
  for (let i = 0; i < 100; i++) plasticity.tick({ firing: [1, 1, 1], gate: 1, learningEnabled: false });
  assert.deepEqual(plasticity.gains(), [1, 1]);
  assert.equal(plasticity.state().gatedUpdates, 0);
  assert.throws(() => plasticity.tick({ firing: [1, 1, 1], gate: -0.1 }), /nonnegative/);
  assert.throws(() => plasticity.tick({ firing: [1, 1, 1], gate: 2 }), /nonnegative/);
  assert.throws(() => plasticity.tick({ firing: [1, 1], gate: 0 }), /firing vector/);
});

test('external readout training is a separate module with frozen neural weights', () => {
  const learner = createExternalReadoutLearner({ readoutSha256: MANIFEST });
  const before = learner.gains();
  assert.deepEqual(before, { left: 1, right: 1 });
  const result = learner.tick({ base: { left: 40, right: 10 }, gate: 1 });
  // abs(baseChannel) clamps to 1, so both channels move by exactly eta * dtSeconds.
  assert.equal(learner.gains().left, 1 + EXTERNAL_READOUT_RULE.etaPerSecond * 0.001);
  assert.equal(learner.gains().left, learner.gains().right);
  // The external gain applies on the same tick; only the neural rule is delayed.
  assert.equal(result.left, 40 * learner.gains().left);
  for (let i = 0; i < 200000; i++) learner.tick({ base: { left: 1, right: 1 }, gate: 1 });
  assert.equal(learner.gains().right, EXTERNAL_READOUT_RULE.gainRange[1]);
  // The two learners share no state and no module.
  assert.notEqual(EXTERNAL_READOUT_RULE.id, PLASTICITY_RULE.id);
  assert.throws(() => createExternalReadoutLearner({ readoutSha256: 'short' }));
});

test('extended checkpoints carry plasticity, world, pose and RNG state with exact-digest restore equivalence', () => {
  const dataset = 'banc:v888';
  const graph = { ids: [1, 2, 3].map(id => `${dataset}/${id}`), offsets: new Uint32Array([0, 1, 2, 3]), targets: new Uint32Array([1, 2, 0]), contacts: new Uint32Array([1200, 1200, 1200]), signs: new Int8Array([1, 1, 1]) };
  const make = () => createSparseLif(graph, { individualId: 'research-branch-a', dataset });
  const kernel = make();
  kernel.seedProbe([0]);
  kernel.step();
  const plasticity = newPlasticity();
  const learner = createExternalReadoutLearner({ readoutSha256: MANIFEST });
  plasticity.tick({ firing: [1, 0, 1], gate: 1 });
  learner.tick({ base: { left: 1, right: 0 }, gate: 1 });
  const extensions = {
    plasticityGains: plasticity.state().gains,
    eligibilityTraces: { pre: plasticity.state().preTrace, post: plasticity.state().postTrace },
    worldPhase: { phase: 'training', trialIndex: 3, trialElapsedMs: 120, layoutVariant: 'layout-b', cueVariant: 'plain' },
    bodyPose: { x: 1.5, y: -2.25, heading: 0.75 },
    rngState: { stream: 'training-layout', state: ['4242', '99'] },
  };
  const digest = kernel.setCheckpointExtensions(extensions);
  const saved = JSON.parse(JSON.stringify(kernel.checkpoint()));
  assert.equal(saved.schemaVersion, 2);
  assert.deepEqual(saved.extensions.bodyPose, extensions.bodyPose);

  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const restored = createSparseLif({ ...graph }, { individualId: 'research-branch-a', dataset, checkpoint: saved });
  assert.equal(hash(restored.checkpoint()), hash(saved));
  assert.equal(restored.checkpointExtensionsSha256(), digest);
  for (let i = 0; i < 30; i++) {
    kernel.step();
    restored.step();
    assert.equal(hash(restored.checkpoint()), hash(kernel.checkpoint()));
  }
  // The restored branch reconstructs the learners to the same exact digests.
  const replay = newPlasticity();
  replay.restore({ rule: PLASTICITY_RULE.id, mappingManifestSha256: MANIFEST, updates: plasticity.state().updates,
    gatedUpdates: plasticity.state().gatedUpdates, gains: restored.checkpointExtensions().plasticityGains,
    preTrace: restored.checkpointExtensions().eligibilityTraces.pre, postTrace: restored.checkpointExtensions().eligibilityTraces.post });
  assert.equal(replay.stateSha256(), plasticity.stateSha256());
});

test('schema-version 1 checkpoints written before plasticity state remain loadable unchanged', () => {
  const dataset = 'male-cns:v1.0';
  const graph = { ids: [1, 2, 3].map(id => `${dataset}/${id}`), offsets: new Uint32Array([0, 1, 2, 3]), targets: new Uint32Array([1, 2, 0]), contacts: new Uint32Array([1200, 1200, 1200]), signs: new Int8Array([1, 1, 1]) };
  const legacy = createSparseLif(graph, { individualId: 'legacy-a', dataset });
  legacy.seedProbe([0]);
  legacy.step();
  const saved = JSON.parse(JSON.stringify(legacy.checkpoint()));
  assert.equal(saved.schemaVersion, 1);
  assert.ok(!Object.hasOwn(saved, 'extensions'));
  const extended = createSparseLif(graph, { individualId: 'legacy-a', dataset });
  extended.setCheckpointExtensions({ plasticityGains: [1], eligibilityTraces: { pre: [0], post: [0] }, worldPhase: {}, bodyPose: {}, rngState: [] });
  // Restoring a legacy checkpoint explicitly clears the extension block.
  extended.restore(saved);
  assert.equal(extended.checkpointExtensions(), null);
  assert.equal(extended.checkpoint().schemaVersion, 1);
  // Invalid extension blocks reject atomically.
  const before = extended.checkpoint();
  for (const mutate of [s => { s.schemaVersion = 2; }, s => { s.schemaVersion = 2; s.extensions = { bodyPose: {} }; }, s => { s.extensions = {}; }]) {
    const invalid = structuredClone(saved);
    mutate(invalid);
    assert.throws(() => extended.restore(invalid));
    assert.deepEqual(extended.checkpoint(), before);
  }
  const nonFinite = structuredClone(saved);
  nonFinite.schemaVersion = 2;
  nonFinite.extensions = { plasticityGains: ['NaN-as-string'], eligibilityTraces: { pre: [], post: [] }, worldPhase: {}, bodyPose: { x: Number.POSITIVE_INFINITY }, rngState: [] };
  assert.throws(() => extended.restore(nonFinite));
});

test('manifest stays incomplete and unpromotable while a derived gate is closed', () => {
  const evidence = read('gate-evidence.json');
  const built = buildMappingManifest(evidence);
  assert.equal(built.complete, false);
  assert.equal(promotableManifestSha256(built), null);
  assert.deepEqual(built.unresolvedSections, ['causalMotorReadout', 'compartmentMatchedEdges']);
  assert.equal(built.manifest.compartmentMatchedEdges, null);
  assert.match(built.manifest.manifestSha256, /^[0-9a-f]{64}$/);
  // The scene declares a quiet area and no aversive element whatsoever.
  assert.ok(built.manifest.scene.quietArea.radius > 0);
  assert.equal(JSON.stringify(built.manifest.scene).includes('penalt'), false);
  const open = structuredClone(evidence);
  open.gates['fixed-causal-motor-readout'].status = 'open';
  open.gates['compartment-specific-plasticity-validation'].status = 'open';
  const complete = buildMappingManifest(open);
  assert.equal(complete.complete, true);
  assert.match(promotableManifestSha256(complete), /^[0-9a-f]{64}$/);
});

test('the assigned run table covers every declared run and derives reproducible named stream seeds', () => {
  const protocol = read('protocol.json');
  const artifact = 'a'.repeat(64);
  const table = assignedRuns(protocol, artifact);
  assert.equal(table.runs.length, protocol.budget.runs);
  assert.equal(new Set(table.runs.map(run => run.runId)).size, protocol.budget.runs);
  assert.ok(table.runs.every(run => run.status === 'not-run' && run.executedSteps === 0));
  assert.deepEqual(Object.keys(table.runs[0].streamSeeds), protocol.streams);
  assert.equal(table.runs[0].streamSeeds['analysis'], deriveSeed(artifact, protocol.datasets[0], 0, 'analysis').toString());
  assert.notEqual(deriveSeed(artifact, protocol.datasets[0], 0, 'analysis'), deriveSeed(artifact, protocol.datasets[1], 0, 'analysis'));
  // Target category is counterbalanced by seed parity, not chosen after the fact.
  assert.equal(table.runs.filter(run => run.targetCategory === 'ring').length, protocol.budget.runs / 2);
});

test('the campaign never starts automatically and refuses to execute while a gate is closed', async () => {
  const protocol = read('protocol.json');
  const evidence = read('gate-evidence.json');
  await assert.rejects(() => runBenignLearningCampaign({ protocol, gateEvidence: evidence }), /explicit run request/);
  let executorCalls = 0;
  const result = await runBenignLearningCampaign({
    protocol, gateEvidence: evidence, explicitRun: true,
    checkpointContractValidated: true, isolatedCatalogValidated: true,
    executeRun: () => { executorCalls++; throw new Error('must not run'); },
  });
  assert.equal(executorCalls, 0);
  assert.equal(result.status, 'gate-closed');
  assert.equal(result.executionPerformed, false);
  assert.equal(result.executedSteps, 0);
  assert.equal(result.mappingManifestSha256, null);
  assert.deepEqual(result.closedGates, ['fixed-causal-motor-readout', 'compartment-specific-plasticity-validation', 'reviewed-bound-manifest-and-explicit-start']);
  // Every assigned run is still reported; none is quietly excluded.
  assert.equal(result.assignedRuns.length, protocol.budget.runs);
  assert.ok(result.assignedRuns.every(run => run.status === 'not-run'));
});

test('an open gate enforces per-run budgets, the exact restore contract and no retries', async () => {
  const protocol = read('protocol.json');
  const evidence = structuredClone(read('gate-evidence.json'));
  evidence.gates['fixed-causal-motor-readout'].status = 'open';
  evidence.gates['compartment-specific-plasticity-validation'].status = 'open';
  const gates = evaluateGates({ protocol, gateEvidence: evidence, manifest: buildMappingManifest(evidence), checkpointContractValidated: true, isolatedCatalogValidated: true });
  assert.equal(gates.allOpen, true);

  const record = run => ({
    ...Object.fromEntries(PER_TRIAL_RECORD_FIELDS.map(field => [field, null])),
    dataset: run.dataset, condition: run.condition, seedIndex: run.seedIndex, phase: 'baseline', trialIndex: 0,
    startTick: 0, endTick: 2000, trialScore: 0, noContact: true, firstContactCategory: null, gateEvents: [], gateOnMs: 0, wallMs: 1,
  });
  let calls = 0;
  const overBudget = await runBenignLearningCampaign({
    protocol, gateEvidence: evidence, explicitRun: true, checkpointContractValidated: true, isolatedCatalogValidated: true,
    executeRun: run => { calls++; return { executedSteps: protocol.budget.maxStepsPerRunIncludingRestoreBranch + 1, checkpointCount: 3, checkpointBytes: 0, restoreEquivalent: true, trialRecords: [record(run)] }; },
  });
  assert.equal(calls, 1);
  assert.equal(overBudget.status, 'incomplete');
  assert.match(overBudget.reason, /budget|restore contract/);

  const faulted = await runBenignLearningCampaign({
    protocol, gateEvidence: evidence, explicitRun: true, checkpointContractValidated: true, isolatedCatalogValidated: true,
    executeRun: () => { throw new Error('numerical fault'); },
  });
  assert.equal(faulted.status, 'incomplete');
  assert.match(faulted.reason, /numerical fault/);
  assert.equal(faulted.executedRuns, 0);
  assert.deepEqual(faulted.datasetResults, []);
  assert.throws(() => validateTrialRecord({ ...record({ dataset: 'a', condition: 'b', seedIndex: 0 }), noContact: true, trialScore: 1 }), /score zero/);
});

test('paired block bootstrap reports every seed and refuses to pass a null or negative effect', () => {
  const seedIndices = [0, 1, 2, 3, 4, 5, 6, 7];
  const flat = Object.fromEntries(['paired-local-plasticity', 'frozen-neural-and-readout', 'balanced-shuffled-cue-plasticity']
    .map(condition => [condition, Object.fromEntries(seedIndices.map(seed => [seed, { baseline: 0, retentionNative: 0 }]))]));
  const none = analyzeDataset({ dataset: 'male-cns:v1.0', seedIndices, scores: flat, analysisSeed: 12345n });
  assert.equal(none.status, 'complete');
  assert.equal(none.passes, false);
  assert.equal(none.contrasts.length, 2);
  assert.ok(none.contrasts.every(contrast => contrast.pointEffect === 0 && contrast.interval[0] === 0 && contrast.perSeedDifference.length === 8));

  const strong = structuredClone(flat);
  for (const seed of seedIndices) strong['paired-local-plasticity'][seed].retentionNative = 0.9;
  const positive = analyzeDataset({ dataset: 'male-cns:v1.0', seedIndices, scores: strong, analysisSeed: 12345n });
  assert.equal(positive.passes, true);
  assert.ok(positive.contrasts.every(contrast => contrast.pointEffect >= 0.15 && contrast.interval[0] > 0));
  assert.equal(positive.poolDatasets, false);

  const missing = structuredClone(flat);
  delete missing['frozen-neural-and-readout'][5];
  const incomplete = analyzeDataset({ dataset: 'banc:v888', seedIndices, scores: missing, analysisSeed: 1n });
  assert.equal(incomplete.status, 'incomplete');
  assert.match(incomplete.reason, /never dropped or imputed/);

  // The bootstrap stream is deterministic and reproducible from the named seed.
  const a = createSeededRandom(99n);
  const b = createSeededRandom(99n);
  assert.equal(a(), b());
  assert.throws(() => createSeededRandom(99));
});
