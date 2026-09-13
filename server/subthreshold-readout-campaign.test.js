import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { runSubthresholdReadoutCampaign } from './subthreshold-readout-campaign.js';
import { READOUT_CONDITIONS } from './subthreshold-readout-trial.js';

test('campaign owns one worker at a time, runs all 8 dataset/condition pairs and does not retry failure', async () => {
  let active = 0, maximum = 0, opens = 0, closes = 0;
  const spawn = ({ dataset, condition }) => {
    opens++; active++; maximum = Math.max(maximum, active);
    return { promise: Promise.resolve({ dataset, condition, status: 'completed-bounded-trial' }), terminate: async () => { closes++; active--; } };
  };
  const dirs = { 'male-cns:v1.0': '/private/a', 'banc:v888': '/private/b' };
  const result = await runSubthresholdReadoutCampaign(dirs, { spawn, rss: () => 100 });
  assert.equal(result.status, 'completed-fixed-campaign');
  assert.equal(result.runCount, 8);
  assert.equal(maximum, 1);
  assert.equal(opens, closes);
  assert(!JSON.stringify(result).includes('/private'));
  const pairs = new Set(result.results.map(r => `${r.dataset}:${r.condition}`));
  assert.equal(pairs.size, 8);

  let failures = 0;
  const failed = await runSubthresholdReadoutCampaign(dirs, { spawn: () => { failures++; return { promise: Promise.reject(new Error('/private/failure')), terminate: async () => {} }; }, rss: () => 100 });
  assert.equal(failed.status, 'incomplete');
  assert.equal(failures, 1);
  assert(!JSON.stringify(failed).includes('/private'));
});

test('resource refusal happens before worker creation and the CLI requires explicit run without graph access', async () => {
  let opened = false;
  const r = await runSubthresholdReadoutCampaign({ 'male-cns:v1.0': 'a', 'banc:v888': 'b' }, { spawn: () => { opened = true; }, rss: () => 2 * 1024 ** 3 });
  assert.equal(r.status, 'incomplete');
  assert.equal(opened, false);
  const result = spawnSync(process.execPath, [new URL('../scripts/run-subthreshold-readout-campaign.js', import.meta.url).pathname], { encoding: 'utf8', timeout: 5000 });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Explicit --run/);
});

test('stalled active worker is terminated at the fixed campaign deadline', async () => {
  let reads = 0, terminated = false;
  const result = await runSubthresholdReadoutCampaign({ 'male-cns:v1.0': 'a', 'banc:v888': 'b' }, {
    spawn: () => ({ promise: new Promise(() => {}), terminate: async () => { terminated = true; } }),
    rss: () => 100, now: () => ++reads <= 2 ? 0 : 60001,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(terminated, true);
  assert.equal(result.completedRuns, 0);
});

test('a report whose dataset/condition/status does not match the request is rejected as a mismatch', async () => {
  const result = await runSubthresholdReadoutCampaign({ 'male-cns:v1.0': 'a', 'banc:v888': 'b' }, {
    spawn: () => ({ promise: Promise.resolve({ dataset: 'wrong', condition: READOUT_CONDITIONS[0], status: 'completed-bounded-trial' }), terminate: async () => {} }),
    rss: () => 100,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.completedRuns, 0);
});
