import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
