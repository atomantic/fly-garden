import test from 'node:test';
import assert from 'node:assert/strict';
import { createSparseLif } from './sparse-lif.js';
import { buildVisualMapping, VISUAL_SOURCES } from './visual-mapping.js';
import { runSubthresholdTrial, READOUT_CONDITIONS } from './subthreshold-readout-trial.js';

/** 8 neurons: 0-3 are the four input ports (left/L1, left/L2, right/L1, right/L2), 4-5 are the
 * two pinned DNa02 motor IDs (receive no contacts, matching the real negative result), 6-7 are
 * disjoint hop-2 targets: both left ports contact 6, both right ports contact 7. */
function setup(condition) {
  const dataset = 'male-cns:v1.0', source = VISUAL_SOURCES[dataset];
  const rows = ['left', 'right'].flatMap((side, i) => ['L1', 'L2'].map((type, j) => ({ neuronId: `${dataset}/${i * 2 + j + 1}`, type, side, hex: [1, 1] })));
  rows.push(...Object.entries(source.motor).map(([side, neuronId]) => ({ neuronId, type: 'DNa02', side, hex: null })));
  const mapping = buildVisualMapping({ dataset, annotationSha256: source.annotationSha256, rows }, source.graphManifestSha256);
  const ids = [...rows.map(r => r.neuronId), `${dataset}/6`, `${dataset}/7`];
  const graph = {
    ids, offsets: new Uint32Array([0, 1, 2, 3, 4, 4, 4, 4, 4]), targets: new Uint32Array([6, 6, 7, 7]),
    contacts: new Uint32Array([500, 500, 500, 500]), signs: new Int8Array([1, 1, 1, 1, 0, 0, 0, 0]),
  };
  const kernel = createSparseLif(graph, { dataset, individualId: 'temporary-test' });
  kernel.inspectIds = ids;
  return { kernel, graph, mapping, condition };
}

test('each condition completes within the 25-step bound and reads the feature at exactly tick 22', async () => {
  for (const condition of READOUT_CONDITIONS) {
    const result = await runSubthresholdTrial(setup(condition));
    assert.equal(result.status, 'completed-bounded-trial');
    assert.equal(result.executedSteps, 25);
    assert.equal(result.readTick, 22);
    assert(Number.isFinite(result.feature));
    assert.equal(result.trace.find(t => t.tick === 22).subthresholdFeature, result.feature);
  }
});

test('black stays exactly zero; left and right onsets separate with the expected sign; whole-field is symmetric', async () => {
  const black = await runSubthresholdTrial(setup('unchanged-black'));
  const left = await runSubthresholdTrial(setup('changed-left-half-onset'));
  const right = await runSubthresholdTrial(setup('changed-right-half-onset'));
  const whole = await runSubthresholdTrial(setup('changed-whole-field-onset'));
  assert.equal(black.feature, 0);
  // A left onset delivers one subthreshold contact (0.5) to the left-driven target only;
  // feature = mean(right=0) - mean(left=0.5) = -0.5, and the mirror image for a right onset.
  assert.equal(left.feature, -0.5);
  assert.equal(right.feature, 0.5);
  // Whole-field stimulates both sides identically; with this fixture's symmetric wiring the two
  // group means must match exactly, cancelling to zero.
  assert.equal(whole.feature, 0);
});

test('rejects an unsupported condition and a non-fresh kernel', async () => {
  await assert.rejects(runSubthresholdTrial({ ...setup('unchanged-black'), condition: 'bogus' }));
  const fixture = setup('unchanged-black');
  fixture.kernel.step([]);
  await assert.rejects(runSubthresholdTrial(fixture));
});
