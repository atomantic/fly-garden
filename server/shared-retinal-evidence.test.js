import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRasters } from '../client/src/shared-retinal-evidence.js';

test('static raster comparisons preserve exact channel differences without tolerance inflation', () => {
 const a = Array(96).fill(0), b = a.slice(); b[3] = 255; b[95] = 2;
 assert.deepEqual(compareRasters(a, a), { changedChannels: 0, absoluteDifference: 0 });
 assert.deepEqual(compareRasters(a, b), { changedChannels: 2, absoluteDifference: 257 });
 assert.deepEqual(compareRasters(b, a), compareRasters(a, b));
 for (const bad of [[], Array(96).fill(NaN), Array(96).fill(256), Array(96).fill(1.5)]) assert.throws(() => compareRasters(a, bad));
});

test('recorded static contrast preserves all bytes and declared exact comparisons', async () => {
 const { readFile } = await import('node:fs/promises');
 const report = JSON.parse(await readFile(new URL('../research/results/shared-retinal-static.json', import.meta.url)));
 assert.deepEqual(compareRasters(report.a, report.b), report.comparisons.partnerChange);
 assert.deepEqual(report.equalToA, ['repeatedA', 'restoredA', 'observerA', 'observerB']);
 for (const key of ['repeat','poseReturn','observerChange']) assert.deepEqual(report.comparisons[key], compareRasters(report.a, report.a));
 assert.equal(report.comparisons.partnerChange.changedChannels > 0, true);
});
