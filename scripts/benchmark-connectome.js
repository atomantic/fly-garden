import { performance } from 'node:perf_hooks';
import { openConnectomeBackend } from '../server/connectome.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--data') {
  console.error('Usage: node scripts/benchmark-connectome.js --data <imported graph directory>');
  process.exitCode = 1;
} else {
  const runs = [];
  for (const mode of ['quiet', 'one-time-probe']) {
    const backend = await openConnectomeBackend(args[1]);
    try {
      if (!backend.ready.available) {
        console.log(JSON.stringify(backend.ready, null, 2));
        process.exitCode = 1;
        break;
      }
      // Deterministic index stride, with exact ID mapping pinned in graph.lock.json.
      const probeIndices = mode === 'quiet' ? [] : Array.from(
        { length: Math.ceil(backend.ready.provenance.neuronCount / 100) }, (_, i) => i * 100);
      if (probeIndices.length) await backend.probe(probeIndices);
      await backend.start();
      const measurements = [];
      let peakRssBytes = backend.ready.memory.rss;
      const start = performance.now();
      let current;
      for (let second = 1; second <= 10; second++) {
        current = await backend.advance(1000);
        peakRssBytes = Math.max(peakRssBytes, current.memory.rss);
        if (second === 1 || second === 10) {
          const wallMs = performance.now() - start;
          measurements.push({ simulatedMs: current.neural.simTimeMs, wallMs,
            simulatedWallRatio: current.neural.simTimeMs / wallMs, ...current.neural });
        }
      }
      await backend.pause();
      runs.push({ mode, probeNeuronCount: probeIndices.length, provenance: backend.ready.provenance,
        model: backend.ready.model, loadWallMs: backend.ready.loadWallMs, sampledPeakRssBytes: peakRssBytes,
        workerArrayBufferBytes: current.memory.arrayBuffers, measurements });
    } finally {
      await backend.close();
    }
  }
  console.log(JSON.stringify({ schemaVersion: 1, runtime: process.version,
    platform: process.platform, architecture: process.arch,
    processMaxRssKiB: process.resourceUsage().maxRSS, runs,
    limitations: 'CPU research benchmark, no renderer or plasticity. Probe is a single engineered initial spike pattern, not sensory input, reward, or learning. Quiet throughput is not an active-workload guarantee. No body/readout mapping. Sampled RSS includes both parent and worker; process max RSS is the OS high-water mark.' }, null, 2));
}
