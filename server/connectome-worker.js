import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { loadConnectome } from './connectome-data.js';
import { createSparseLif, LIF_MODEL } from './sparse-lif.js';
import { connectomeProfile } from './connectome-profiles.js';

let status = 'loading', reason = null, kernel = null, provenance = null, loadWallMs = 0, model = null;
const snapshot = () => ({ protocolVersion: 1, source: 'connectome', status, available: !!kernel && status !== 'fault',
  reason, dataset: workerData.dataset, model, provenance, loadWallMs,
  neural: kernel?.summary() ?? null, memory: process.memoryUsage(),
  limitations: 'Research LIF backend only. No sensory/motor mapping, plasticity, retained learning, or biological validation. No automatic advancement.' });

const start = performance.now();
try {
  const profile = connectomeProfile(workerData.dataset);
  const { graph, manifest, manifestSha256 } = await loadConnectome(workerData.directory, workerData.dataset);
  kernel = createSparseLif(graph);
  model = { ...LIF_MODEL, id: profile.modelId };
  provenance = { dataset: manifest.dataset, selection: manifest.selection, manifestSha256,
    neuronCount: manifest.neuronCount, edgeCount: manifest.edgeCount, contactCount: manifest.contactCount };
  status = 'paused';
} catch {
  status = 'unavailable';
  reason = 'Pinned connectome files are missing, incompatible, or unreadable. No fixture substituted.';
}
loadWallMs = performance.now() - start;
parentPort.postMessage({ id: 0, value: snapshot() });

parentPort.on('message', ({ id, action, value }) => {
  try {
    if (action === 'snapshot') return parentPort.postMessage({ id, value: snapshot() });
    if (!kernel || status === 'fault') throw new Error('Connectome is unavailable or faulted');
    if (action === 'start') status = 'running';
    else if (action === 'pause') status = 'paused';
    else if (action === 'probe') {
      if (status !== 'paused') throw new Error('Probe requires paused state');
      kernel.seedProbe(value);
    } else if (action === 'advance') {
      if (status !== 'running') throw new Error('Explicit start required before advancement');
      if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('Advance must be 1–1000 steps');
      try {
        for (let i = 0; i < value; i++) kernel.step();
      } catch {
        status = 'fault';
        reason = 'Numerical fault; last valid state retained and advancement stopped.';
        throw new Error(reason);
      }
    } else throw new Error('Unknown backend operation');
    parentPort.postMessage({ id, value: snapshot() });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
