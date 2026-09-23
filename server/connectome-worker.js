import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { loadConnectome } from './connectome-data.js';
import { createSparseLif, LIF_MODEL } from './sparse-lif.js';
import { connectomeProfile } from './connectome-profiles.js';

/** Explicit controller factory also permits small numerical fixtures in tests. */
export function createConnectomeSession({ graph, dataset, individualId = randomUUID(), checkpoint = null, provenance = null, loadWallMs = 0 }) {
  const kernel = createSparseLif(graph, { dataset, individualId, checkpoint });
  let status = 'paused', reason = null, sessionEpoch = randomUUID(), pendingRestore = null, pendingAdvance = null, lastRestore = null;
  const snapshot = () => ({ protocolVersion: 1, source: 'connectome', status, available: status !== 'fault',
    reason, individualId, sessionEpoch, dataset, model: kernel.model, graphSha256: kernel.graphSha256, provenance, loadWallMs,
    neural: kernel.summary(), memory: process.memoryUsage(), retainedWeightState: kernel.retainedWeightState(),
    limitations: 'Research LIF backend only. No sensory/motor mapping, plasticity, retained learning, or biological validation. No automatic advancement.' });
  function dispatch({ action, value, sessionEpoch: suppliedEpoch }) {
    if (action === 'snapshot') return snapshot();
    if (suppliedEpoch !== sessionEpoch) throw new Error('Stale connectome session epoch');
     if (action === 'discardRestore') {
       if (value !== undefined && (!pendingRestore || pendingRestore.token !== value)) throw new Error('Stale prepared restore token');
       pendingRestore = null; lastRestore = null;
       return snapshot();
     }
     if (action === 'rollbackRestore') {
       if (!lastRestore || value?.token !== lastRestore.token || !value?.checkpoint) throw new Error('Stale committed restore token');
       kernel.restore(value.checkpoint); sessionEpoch = lastRestore.previousEpoch; lastRestore = null; status = 'paused'; reason = null;
       return snapshot();
     }
     if (action === 'sample') {
      if (pendingRestore) throw new Error('Restore preparation pending; discard it before sampling.');
       if (status === 'fault') throw new Error('Connectome is unavailable or faulted');
       lastRestore = null;
       return { ...kernel.sample(value), sessionEpoch, status, provenance };
    }
     if (action === 'prepareRestore') {
       if (pendingRestore) throw new Error('Restore preparation already pending; discard it before preparing another.');
       if (pendingAdvance) { kernel.releaseAdvance(pendingAdvance.candidate); pendingAdvance = null; }
       lastRestore = null;
    }
    if (action === 'prepareRestore') {
      const candidate = kernel.prepareRestore(value), token = randomUUID();
      pendingRestore = { token, candidate };
      return { token, sessionEpoch };
    }
    if (action === 'commitRestore') {
       if (!pendingRestore || value !== pendingRestore.token) throw new Error('Stale prepared restore token');
       const previousEpoch = sessionEpoch;
       kernel.commitRestore(pendingRestore.candidate); pendingRestore = null; lastRestore = { token: value, previousEpoch };
       status = 'paused'; reason = null; sessionEpoch = randomUUID();
      return snapshot();
    }
    if (action === 'prepareAdvance' && pendingRestore) throw new Error('Restore preparation pending; discard it before preparing advancement.');
    if (action === 'prepareAdvance') {
      if (status !== 'running') throw new Error('Explicit start required before advancement');
      if (pendingAdvance) kernel.releaseAdvance(pendingAdvance.candidate);
      pendingAdvance = null; pendingRestore = null;
      try {
        const candidate = kernel.prepareAdvance(value), token = randomUUID();
        pendingAdvance = { token, candidate };
        return { token, steps: value, sessionEpoch };
      } catch {
        status = 'fault'; reason = 'Numerical fault; last valid state retained and advancement stopped.';
        throw new Error(reason);
      }
    }
    if (action === 'commitAdvance') {
      if (!pendingAdvance || value !== pendingAdvance.token) throw new Error('Stale prepared advance token');
      try {
        kernel.commitAdvance(pendingAdvance.candidate); pendingAdvance.committed = true;
        return snapshot();
      } catch {
        status = 'fault'; reason = 'Numerical fault; last valid state retained and advancement stopped.';
        throw new Error(reason);
      }
    }
    if (action === 'rollbackAdvance') {
      if (!pendingAdvance || value !== pendingAdvance.token) throw new Error('Stale prepared advance token');
      try {
        if (pendingAdvance.committed) kernel.rollbackAdvance(pendingAdvance.candidate);
        else kernel.releaseAdvance(pendingAdvance.candidate);
        pendingAdvance = null; status = 'paused'; reason = null;
        return snapshot();
      } catch (error) {
        pendingAdvance = null; status = 'fault'; reason = 'Shared barrier rollback failed; durable checkpoint retained for explicit recovery.';
        throw error;
      }
    }
    if (action === 'releaseAdvance') {
      if (!pendingAdvance || value !== pendingAdvance.token) throw new Error('Stale prepared advance token');
      kernel.releaseAdvance(pendingAdvance.candidate); pendingAdvance = null;
      return snapshot();
    }
     if (!['snapshot', 'prepareAdvance', 'commitAdvance', 'rollbackAdvance', 'releaseAdvance'].includes(action)) pendingAdvance = null;
     if (!['snapshot', 'checkpoint', 'rollbackRestore'].includes(action)) lastRestore = null;
     if (pendingRestore && !['checkpoint', 'snapshot', 'commitRestore', 'discardRestore'].includes(action)) throw new Error('Restore preparation pending; commit or discard it first.');
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
