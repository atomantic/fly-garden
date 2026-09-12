import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { loadConnectome } from './connectome-data.js';
import { createSparseLif, LIF_MODEL } from './sparse-lif.js';
import { connectomeProfile } from './connectome-profiles.js';

/** Explicit controller factory also permits small numerical fixtures in tests. */
export function createConnectomeSession({ graph, dataset, individualId = randomUUID(), checkpoint = null, provenance = null, loadWallMs = 0 }) {
  const kernel = createSparseLif(graph, { dataset, individualId, checkpoint });
  let status = 'paused', reason = null, sessionEpoch = randomUUID(), pendingRestore = null;
  const snapshot = () => ({ protocolVersion: 1, source: 'connectome', status, available: status !== 'fault',
    reason, individualId, sessionEpoch, dataset, model: kernel.model, graphSha256: kernel.graphSha256, provenance, loadWallMs,
    neural: kernel.summary(), memory: process.memoryUsage(),
    limitations: 'Research LIF backend only. No sensory/motor mapping, plasticity, retained learning, or biological validation. No automatic advancement.' });
  function dispatch({ action, value, sessionEpoch: suppliedEpoch }) {
    if (action === 'snapshot') return snapshot();
    if (suppliedEpoch !== sessionEpoch) throw new Error('Stale connectome session epoch');
    if (action === 'sample') {
      if (status === 'fault') throw new Error('Connectome is unavailable or faulted');
      return { ...kernel.sample(value), sessionEpoch, status, provenance };
    }
    if (action === 'prepareRestore') {
      const candidate = kernel.prepareRestore(value), token = randomUUID();
      pendingRestore = { token, candidate };
      return { token, sessionEpoch };
    }
    if (action === 'commitRestore') {
      if (!pendingRestore || value !== pendingRestore.token) throw new Error('Stale prepared restore token');
      kernel.commitRestore(pendingRestore.candidate); pendingRestore = null;
      status = 'paused'; reason = null; sessionEpoch = randomUUID();
      return snapshot();
    }
    if (!['checkpoint', 'snapshot'].includes(action)) pendingRestore = null;
    if (action === 'restore') {
      kernel.restore(value);
      status = 'paused'; reason = null; sessionEpoch = randomUUID();
      return snapshot();
    }
    if (action === 'checkpoint') return kernel.checkpoint();
    if (status === 'fault') throw new Error('Connectome is unavailable or faulted');
    if (action === 'start') status = 'running';
    else if (action === 'pause') status = 'paused';
    else if (action === 'probe') {
      if (status !== 'paused') throw new Error('Probe requires paused state');
      kernel.seedProbe(value);
    } else if (action === 'advance') {
      if (status !== 'running') throw new Error('Explicit start required before advancement');
      if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('Advance must be 1–1000 steps');
      try { for (let i = 0; i < value; i++) kernel.step(); }
      catch {
        status = 'fault'; reason = 'Numerical fault; last valid state retained and advancement stopped.';
        throw new Error(reason);
      }
    } else throw new Error('Unknown backend operation');
    return snapshot();
  }
  return { snapshot, dispatch };
}

if (parentPort) {
  let session, unavailable;
  const start = performance.now();
  try {
    connectomeProfile(workerData.dataset);
    const { graph, manifest, manifestSha256 } = await loadConnectome(workerData.directory, workerData.dataset);
    session = createConnectomeSession({ graph, dataset: workerData.dataset, individualId: workerData.individualId,
      checkpoint: workerData.checkpoint ?? null,
      provenance: { dataset: manifest.dataset, selection: manifest.selection, manifestSha256,
        neuronCount: manifest.neuronCount, edgeCount: manifest.edgeCount, contactCount: manifest.contactCount },
      loadWallMs: performance.now() - start });
  } catch {
    unavailable = { protocolVersion: 1, source: 'connectome', status: 'unavailable', available: false,
      reason: 'Pinned connectome files or checkpoint are missing, incompatible, or unreadable. No fixture substituted.',
      dataset: workerData.dataset, individualId: workerData.individualId, model: null, provenance: null,
      loadWallMs: performance.now() - start, neural: null, memory: process.memoryUsage() };
  }
  parentPort.postMessage({ id: 0, value: session ? session.snapshot() : unavailable });
  parentPort.on('message', message => {
    try {
      if (!session && message.action !== 'snapshot') throw new Error('Connectome is unavailable or faulted');
      parentPort.postMessage({ id: message.id, value: session ? session.dispatch(message) : unavailable });
    } catch (error) { parentPort.postMessage({ id: message.id, error: error.message }); }
  });
}
