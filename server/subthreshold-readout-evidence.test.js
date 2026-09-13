import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitSubthresholdReadout } from './visual-subthreshold-readout.js';
import { READOUT_CONDITIONS } from './subthreshold-readout-trial.js';

test('published campaign evidence preserves exact accounting and reproduces the recorded negative verdict', () => {
  const result = JSON.parse(readFileSync(new URL('../connectome/subthreshold-readout-result.json', import.meta.url)));
  assert.equal(result.status, 'completed-fixed-campaign');
  assert.equal(result.runCount, 8);
  assert.equal(result.retries, 0);
  assert(result.sampledPeakRssBytes <= 1024 ** 3);
  assert(result.totalWallMs < 60000);
  const pairs = new Set();
  for (const dataset of ['male-cns:v1.0', 'banc:v888']) {
    const byCondition = {};
    for (const r of result.results.filter(x => x.dataset === dataset)) {
      pairs.add(`${dataset}:${r.condition}`);
      assert.equal(r.status, 'completed-bounded-trial');
      assert.equal(r.executedSteps, 25);
      assert.equal(r.readTick, 22);
      byCondition[r.condition] = r.feature;
    }
    assert.deepEqual(new Set(Object.keys(byCondition)), new Set(READOUT_CONDITIONS));
    const fit = fitSubthresholdReadout(byCondition);
    assert.equal(fit.verdict.separates, true);
    assert.equal(fit.verdict.blackExactlyZero, true);
    assert.equal(fit.verdict.wholeFieldWithinBand, false);
    assert.equal(fit.passed, false);
  }
  assert.equal(pairs.size, 8);
});
