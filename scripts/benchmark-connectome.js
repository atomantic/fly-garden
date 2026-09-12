import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { openConnectomeBackend } from '../server/connectome.js';
import { connectomeProfile } from '../server/connectome-profiles.js';

const { values } = parseArgs({ options: {
  data: { type: 'string', multiple: true }, dataset: { type: 'string', multiple: true },
} });
const directories = values.data ?? [];
const datasets = values.dataset ?? ['male-cns:v1.0'];
if (!directories.length || directories.length > 2 || directories.length !== datasets.length ||
    new Set(datasets).size !== datasets.length) {
  throw new Error('Supply one or two --dataset <profile> --data <graph directory> pairs; default profile is male-cns:v1.0');
}
for (const dataset of datasets) connectomeProfile(dataset);
const runs = [];
for (const mode of ['quiet', 'one-time-probe']) {
  const backends = [];
  try {
    const loadStart = performance.now();
    // Serial verified loads retain earlier workers paused, measuring actual combined residency.
    for (let i = 0; i < directories.length; i++) {
      backends.push(await openConnectomeBackend(directories[i], { dataset: datasets[i] }));
    }
    const combinedLoadWallMs = performance.now() - loadStart;
    if (backends.some(backend => !backend.ready.available)) {
      runs.push({ mode, status: 'unavailable', residents: backends.map(backend => backend.ready) });
      process.exitCode = 1;
      break;
    }
    const residents = [];
    for (const backend of backends) {
      const indices = mode === 'quiet' ? [] : Array.from(
        { length: Math.ceil(backend.ready.provenance.neuronCount / 100) }, (_, i) => i * 100);
      if (indices.length) await backend.probe(indices);
      residents.push({ probeNeuronCount: indices.length, provenance: backend.ready.provenance,
        model: backend.ready.model, loadWallMs: backend.ready.loadWallMs });
    }
    await Promise.all(backends.map(backend => backend.start()));
    const measurements = [];
    let peakRssBytes = process.memoryUsage().rss;
    const start = performance.now();
    let current;
    for (let second = 1; second <= 10; second++) {
      // No worker can begin the next interval until every resident completes this one.
      current = await Promise.all(backends.map(backend => backend.advance(1000)));
      peakRssBytes = Math.max(peakRssBytes, ...current.map(state => state.memory.rss));
      if (second === 1 || second === 10) {
        const wallMs = performance.now() - start;
        measurements.push({ simulatedMsPerResident: second * 1000, wallMs,
          simulatedWallRatio: second * 1000 / wallMs, residents: current.map(state => state.neural) });
      }
    }
    await Promise.all(backends.map(backend => backend.pause()));
    runs.push({ mode, status: 'measured', residentCount: backends.length, residents,
      combinedLoadWallMs, sampledPeakProcessRssBytes: peakRssBytes,
      residentArrayBufferBytes: current.map(state => state.memory.arrayBuffers),
      combinedArrayBufferBytes: current.reduce((sum, state) => sum + state.memory.arrayBuffers, 0), measurements });
  } finally {
    await Promise.all(backends.map(backend => backend.close()));
  }
}
console.log(JSON.stringify({ schemaVersion: 2, runtime: process.version,
  platform: process.platform, architecture: process.arch,
  processMaxRssKiB: process.resourceUsage().maxRSS, runs,
  limitations: 'CPU research benchmark without renderer or plasticity. Each resident has independent state and a single engineered initial probe, not sensory input, reward, or learning. Pair ratio uses simulated time per resident, not the sum. RSS is process-wide and must not be summed across workers; array buffers are per-worker. Load includes hash/structure validation with warm cache. No admission guarantee for sustained activity, rendered embodiment, or larger populations.' }, null, 2));
