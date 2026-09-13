import { Worker } from 'node:worker_threads';
import { READOUT_CONDITIONS } from './subthreshold-readout-trial.js';

const DATASETS = ['male-cns:v1.0', 'banc:v888'];
const DEADLINE_MS = 60000, RSS_LIMIT_BYTES = 1024 ** 3; // research/visual-subthreshold-readout-protocol.json budget

function worker(entry) {
  const worker = new Worker(new URL('./subthreshold-readout-worker.js', import.meta.url), { workerData: entry });
  const promise = new Promise((resolve, reject) => {
    worker.once('message', value => value.ok ? resolve(value.result) : reject(new Error(value.reason)));
    worker.once('error', () => reject(new Error('Trial worker failed')));
    worker.once('exit', () => reject(new Error('Trial worker exited before result')));
  });
  return { promise, terminate: () => worker.terminate() };
}

/** One worker at a time; fixed complete campaign ceiling, no retries or adjustable gains — same discipline as visual-causal-campaign.js, scoped per research/visual-subthreshold-readout-protocol.json. */
export async function runSubthresholdReadoutCampaign(directories, { spawn = worker, rss = () => process.memoryUsage().rss, now = () => performance.now() } = {}) {
  if (!directories || Object.keys(directories).length !== 2 || !DATASETS.every(d => typeof directories[d] === 'string' && directories[d])) throw new Error('Two explicit dataset directories required');
  const start = now(), results = [];
  let active = null, peak = 0, rejectLimit;
  const limit = new Promise((_, reject) => { rejectLimit = reject; });
  limit.catch(() => {});
  function check() {
    peak = Math.max(peak, rss());
    if (!Number.isFinite(peak) || peak > RSS_LIMIT_BYTES || now() - start >= DEADLINE_MS) throw new Error('Subthreshold readout campaign memory/deadline exceeded');
  }
  const monitor = setInterval(() => { try { check(); } catch (e) { rejectLimit(e); } }, 10);
  try {
    for (const dataset of DATASETS) for (const condition of READOUT_CONDITIONS) {
      check();
      active = spawn({ dataset, directory: directories[dataset], condition });
      const result = await Promise.race([active.promise, limit]);
      check();
      if (result.condition !== condition || result.dataset !== dataset || result.status !== 'completed-bounded-trial') throw new Error('Trial report mismatch');
      await active.terminate();
      check();
      active = null;
      results.push(result);
    }
    return { schemaVersion: 1, status: 'completed-fixed-campaign', runCount: results.length, results, sampledPeakRssBytes: peak, totalWallMs: now() - start, maxMemoryBytes: RSS_LIMIT_BYTES, maxWallMs: DEADLINE_MS, retries: 0 };
  } catch {
    return { schemaVersion: 1, status: 'incomplete', completedRuns: results.length, results, sampledPeakRssBytes: peak, reason: 'Fixed campaign validation or resource bound failed; no retry performed.' };
  } finally {
    clearInterval(monitor);
    if (active) await active.terminate();
  }
}
