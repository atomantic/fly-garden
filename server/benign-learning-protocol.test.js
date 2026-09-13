import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = name => JSON.parse(readFileSync(new URL(`../experiments/benign-learning-v1/${name}`, import.meta.url)));
test('gated protocol has internally consistent finite experiment and gate budgets', () => {
  const p = read('protocol.json');
  assert.equal(p.executionAllowed, false);
  assert.equal(p.executionPerformed, false);
  assert.equal(p.mappingManifestSha256, null);
  assert.equal(p.requiredGates.length, 6);
  const runs = p.datasets.length * p.conditions.length * p.seedIndices.length;
  const steps = p.phases.reduce((sum, phase) => sum + phase.trials * phase.trialMs / p.timeStepMs, 0);
  assert.equal(runs, p.budget.runs);
  assert.equal(steps, p.budget.maxStepsPerRunIncludingRestoreBranch);
  assert.equal(runs * steps, p.budget.maxStepsTotal);
  assert.equal(p.budget.automaticRetries, 0);
  const training = p.phases.filter(phase => phase.gateAllowed);
  assert.deepEqual(training.map(phase => phase.name), ['training']);
  assert.equal(training[0].trials * p.appetitiveGate.maxEventsPerTrainingTrial, p.appetitiveGate.maxEventsPerRun);
  assert.equal(p.appetitiveGate.maxEventsPerRun * p.appetitiveGate.pulseMs, p.appetitiveGate.maxOnTimeMsPerRun);
  assert.equal(p.retention.restoredBoot, 'paused');
  assert.equal(p.analysis.confirmatoryContrasts, p.datasets.length * 2);
});
test('inventory matches pinned annotation provenance and keeps source-qualified IDs', () => {
  const inventory = read('annotation-inventory.json');
  assert.equal(inventory.executionPerformed, false);
  for (const profile of inventory.profiles) {
    const lockName = profile.dataset === 'male-cns:v1.0' ? 'malecns-v1' : 'banc-v888';
    const lock = JSON.parse(readFileSync(new URL(`../connectome/${lockName}.lock.json`, import.meta.url)));
    assert.equal(profile.sourceSha256, lock.files.annotations.sha256);
    assert.equal(profile.sourceBytes, lock.files.annotations.bytes);
    assert.ok(profile.retainedRows <= profile.sourceRows);
    for (const group of Object.values(profile.groups)) {
      assert.equal(Object.values(group.sideCounts).reduce((sum, n) => sum + n, 0), group.count);
      for (const example of group.examples) assert.match(example.neuronId, new RegExp(`^${profile.dataset}/[0-9]+$`));
    }
  }
});

test('gate evidence, mapping manifest and campaign result agree with the frozen protocol artifact', () => {
  const protocolText = readFileSync(new URL('../experiments/benign-learning-v1/protocol.json', import.meta.url), 'utf8');
  const p = JSON.parse(protocolText);
  const evidence = read('gate-evidence.json');
  const manifest = read('mapping-manifest.json');
  const result = read('result.json');
  // The evidence was derived without advancing any neural model or training anything.
  assert.equal(evidence.neuralStepsExecuted, 0);
  assert.equal(evidence.trainingPerformed, false);
  assert.equal(evidence.executionAllowed, false);
  // Both derived gates are closed, and the derivation pins the same graph manifests
  // the checked-in visual mapping pins.
  for (const gate of ['fixed-causal-motor-readout', 'compartment-specific-plasticity-validation']) {
    assert.equal(evidence.gates[gate].status, 'closed');
  }
  for (const profile of evidence.gates['fixed-causal-motor-readout'].profiles) {
    const lockName = profile.dataset === 'male-cns:v1.0' ? 'graph.lock.json' : 'banc-v888.graph.lock.json';
    const lock = JSON.parse(readFileSync(new URL(`../connectome/${lockName}`, import.meta.url)));
    assert.equal(profile.graphManifestSha256, lock.manifestSha256);
    // No first-hop threshold crossing, so the causal motor readout stays unvalidated.
    assert.equal(profile.firstHopCrossesThreshold, false);
    assert.ok(profile.firstHopEligibleTargetVoltage.maximum < 1);
  }
  // An incomplete manifest is never promoted into the protocol.
  assert.equal(manifest.complete, false);
  assert.equal(p.mappingManifestSha256, null);
  assert.equal(p.mappingManifestComplete, false);
  assert.equal(p.incompleteMappingManifestSha256, manifest.manifestSha256);
  assert.equal(result.incompleteMappingManifestSha256, manifest.manifestSha256);
  // The recorded campaign refers to exactly this protocol file and executed nothing.
  assert.equal(result.protocolArtifactSha256, createHash('sha256').update(protocolText).digest('hex'));
  assert.equal(result.status, 'gate-closed');
  assert.equal(result.executionPerformed, false);
  assert.equal(result.executedRuns, 0);
  assert.equal(result.executedSteps, 0);
  assert.equal(result.assignedRuns.length, p.budget.runs);
  assert.ok(result.assignedRuns.every(run => run.status === 'not-run'));
  assert.deepEqual(result.closedGates, p.closedGates);
  assert.equal(p.executedNeuralSteps, 0);
});
