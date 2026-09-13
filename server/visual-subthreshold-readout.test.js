import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSubthresholdReadout, createFrozenSubthresholdReadout, SUBTHRESHOLD_READOUT_RULE } from './visual-subthreshold-readout.js';

test('a clean, well-separated result passes and bounds yaw to the max on the fitting conditions', () => {
  const fit = fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': -2, 'changed-right-half-onset': 2, 'changed-whole-field-onset': 0 });
  assert.equal(fit.passed, true);
  assert.equal(fit.verdict.separates, true);
  assert.equal(fit.verdict.blackExactlyZero, true);
  assert.equal(fit.verdict.wholeFieldWithinBand, true);
  assert.equal(fit.yawByCondition['changed-left-half-onset'], -SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond);
  assert.equal(fit.yawByCondition['changed-right-half-onset'], SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond);
});

test('a nonzero black feature fails even when left/right separate cleanly', () => {
  const fit = fitSubthresholdReadout({ 'unchanged-black': 1e-9, 'changed-left-half-onset': -2, 'changed-right-half-onset': 2, 'changed-whole-field-onset': 0 });
  assert.equal(fit.verdict.blackExactlyZero, false);
  assert.equal(fit.passed, false);
});

test('whole-field exceeding its band fails even with real left/right separation and exact-zero black', () => {
  const fit = fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': -2, 'changed-right-half-onset': 2, 'changed-whole-field-onset': 1 });
  assert.equal(fit.verdict.wholeFieldWithinBand, false);
  assert.equal(fit.passed, false);
});

test('identical left/right features fail separation (below floor) with a valid, non-throwing result', () => {
  const fit = fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': 0, 'changed-right-half-onset': 0, 'changed-whole-field-onset': 0 });
  assert.equal(fit.verdict.separates, false);
  assert.equal(fit.passed, false);
  assert.equal(fit.scale, 0);
});

test('rejects a fit missing a required condition', () => {
  assert.throws(() => fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': 1 }));
});

test('runtime readout refuses construction from a failed fit and never exceeds the bound', () => {
  const failed = fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': 0, 'changed-right-half-onset': 0, 'changed-whole-field-onset': 0 });
  assert.throws(() => createFrozenSubthresholdReadout(failed));
  const passed = fitSubthresholdReadout({ 'unchanged-black': 0, 'changed-left-half-onset': -1, 'changed-right-half-onset': 3, 'changed-whole-field-onset': 0 });
  const readout = createFrozenSubthresholdReadout(passed);
  assert.equal(readout.tick(3).yawRadiansPerSecond, SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond);
  assert.equal(readout.tick(-1).forwardSpeed, 0);
  assert.equal(readout.tick(1000).yawRadiansPerSecond, SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond);
  assert.throws(() => readout.tick(NaN));
});
