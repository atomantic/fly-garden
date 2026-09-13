import { randomUUID } from 'node:crypto';
import { openConnectomeBackend } from './connectome.js';
import { validateNeuronSampleIds } from './sparse-lif.js';
import { connectomeProfile } from './connectome-profiles.js';
import { createCapacityPolicy, CapacityAdmissionError } from './population-capacity.js';

const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const idValid = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id);
const capabilities = Object.freeze({ sensoryMotor: false, learning: false, chemistry: false, embodiment: false,
  disclosure: 'Research sparse LIF only. No sensory/motor mapping, plasticity, retained learning, chemistry or body state. No automatic advancement or numerical probes.' });

/** Trusted service adapter: callers own durable identity metadata, directory selection,
 * measured capacity evidence and atomic checkpoint/head persistence. No HTTP or timers. */
export function createConnectomeRegistry({ identities = [], capacity = createCapacityPolicy(), getResources = async () => ({}),
  persistCheckpoint, loadCheckpoint, openBackend = openConnectomeBackend, operationTimeoutMs = 30000 } = {}) {
  if (!Array.isArray(identities) || identities.length > 64 || typeof persistCheckpoint !== 'function'
    || (loadCheckpoint !== undefined && typeof loadCheckpoint !== 'function')
    || !Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 120000) throw new Error('Invalid research registry configuration');
  const records = new Map(); let loadQueue = Promise.resolve(), closed = false, closing = false;
  function register(input) {
    if (closed || closing || records.size >= 64) throw new Error('Connectome registry closed or identity capacity reached');
    if (!input || !idValid(input.individualId) || records.has(input.individualId) || typeof input.directory !== 'string' || !input.directory) throw new Error('Invalid or duplicate connectome identity');
    connectomeProfile(input.dataset);
    if (input.checkpointId != null && !idValid(input.checkpointId)) throw new Error('Invalid connectome checkpoint head');
    if (input.checkpointId != null && !input.checkpoint && !loadCheckpoint) throw new Error('A lazy checkpoint loader is required for this saved head');
    if (input.checkpoint && (input.checkpoint.individualId !== input.individualId || input.checkpoint.dataset !== input.dataset)) throw new Error('Checkpoint recipient/profile mismatch');
    records.set(input.individualId, { individualId: input.individualId, dataset: input.dataset, directory: input.directory,
      saved: input.checkpoint ? structuredClone(input.checkpoint) : null, checkpointId: input.checkpointId ?? null,
      backend: null, owner: null, state: null, epoch: randomUUID(), sequence: 0, queue: Promise.resolve(), reason: null, recoveryRequired: false, durableHeadUnknown: false, lifecycle: 'saved-unloaded' });
    return publicState(records.get(input.individualId));
  }
  for (const input of identities) register(input);
  function record(id) {
    if (closed || closing) throw new Error('Connectome registry closed');
    const r = records.get(id); if (!r) throw new Error('Connectome individual not registered'); return r;
  }
  function publicState(r) {
    return structuredClone({ protocolVersion: 1, individualId: r.individualId, dataset: r.dataset, source: 'connectome',
      resident: !!r.owner, status: r.lifecycle, sessionEpoch: r.state?.sessionEpoch ?? r.epoch, commandSequence: r.sequence,
      checkpointId: r.checkpointId, reason: r.reason, recoveryRequired: r.recoveryRequired, neural: r.state?.neural ?? null,
      graphSha256: r.state?.graphSha256 ?? r.saved?.graphSha256 ?? null, model: r.state?.model ?? null,
      provenance: r.state?.provenance ?? null, capabilities });
  }
  function enqueue(r, fn) {
    const result = r.queue.then(() => { if (closed) throw new Error('Connectome registry closed'); return fn(); });
    r.queue = result.catch(() => {}); return result;
  }
  async function bounded(promise, onTimeout) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => {
        onTimeout?.(); reject(new Error('Connectome operation deadline exceeded; shutdown requested and admission retained until exit'));
      }, operationTimeoutMs); })]);
    } finally { clearTimeout(timer); }
  }
  function release(r, owner, unexpected = false) {
    owner.exited = true;
    if (r.owner !== owner) return; // Late shutdown notifications cannot revoke a replacement.
    r.owner = null; r.backend = null; r.state = null; r.epoch = randomUUID();
    r.lifecycle = unexpected ? 'unavailable' : 'saved-unloaded';
    if (unexpected) r.reason = 'Worker exited; durable checkpoint retained for explicit paused recovery.';
  }
  async function evict(r, reason, owner = r.owner) {
    if (!owner || owner.exited) return;
    if (owner.stopping) return owner.stopping;
    owner.intentional = true;
    if (r.owner === owner) {
      r.backend = null; r.state = null; r.epoch = randomUUID();
      r.lifecycle = 'stopping'; r.reason = reason;
    }
    owner.stopping = (async () => {
      if (typeof owner.handle?.terminate === 'function') await owner.handle.terminate();
      else {
        // Legacy injected factories cannot be canceled while opening. Their admission
        // reservation remains held until they produce a handle and shutdown completes.
        const backend = owner.backend ?? await owner.opening;
        await backend.close();
      }
      release(r, owner);
    })();
    return owner.stopping;
  }
  async function call(r, operation, value) {
    const backend = r.backend; if (!backend) throw new Error('Explicitly load this connectome individual first');
    try { return await bounded(Promise.resolve().then(() => backend[operation](value)), () => { void evict(r, 'Worker deadline; durable checkpoint retained for paused recovery.').catch(() => {}); }); }
    catch (error) {
      if (r.backend) {
        try { r.state = await bounded(backend.snapshot(), () => { void evict(r, 'Worker unavailable; durable checkpoint retained.').catch(() => {}); }); r.lifecycle = r.state.status; }
        catch { await evict(r, 'Worker unavailable; durable checkpoint retained.'); }
      }
      throw error;
    }
  }
  async function pause(r) {
    if (r.state?.status === 'fault') return;
    r.state = await call(r, 'pause'); r.lifecycle = 'paused';
  }
  async function persist(r, checkpoint, operation, sourceCheckpointId = null) {
    // Writer must atomically persist payload and selected head, or leave both unchanged.
    let result;
    try {
      result = await persistCheckpoint({ individualId: r.individualId, dataset: r.dataset,
        parentId: r.checkpointId, checkpoint: structuredClone(checkpoint), operation, sourceCheckpointId });
    } catch (error) {
      if (error?.code === 'CONNECTOME_DURABILITY_UNCERTAIN') {
        r.recoveryRequired = true;
        if (error.individualId === r.individualId && idValid(error.selectedCheckpointId)) {
          r.saved = loadCheckpoint ? null : checkpoint;
          r.checkpointId = error.selectedCheckpointId;
        } else r.durableHeadUnknown = true;
        await evict(r, 'Catalog selection changed but durability is uncertain. Recover storage before explicit paused reload.');
      }
      throw error;
    }
    if (!result || !idValid(result.checkpointId)) throw new Error('Checkpoint writer returned no valid durable head');
    r.saved = loadCheckpoint ? null : checkpoint; r.checkpointId = result.checkpointId;
  }
  function load(id) {
    const r = record(id);
    return enqueue(r, () => {
      const result = loadQueue.then(async () => {
        if (r.backend) return publicState(r);
        if (r.owner) throw new Error('Previous worker termination is unconfirmed; admission remains reserved');
        if (r.recoveryRequired && (r.durableHeadUnknown || !loadCheckpoint)) throw new Error('Storage recovery and registry reconstruction are required before loading an uncertain durable head');
        const resources = await getResources({ individualId: id, dataset: r.dataset });
        const measurement = resources.measurement;
        const footprint = measurement?.backend === 'connectome' && measurement.dataset === r.dataset
          && measurement.includesCheckpointSerialization === true ? measurement.incrementalMemoryBytes : null;
        const residents = [...(resources.residents ?? []), ...[...records.values()].filter(value => value.owner)
          .filter(value => !(resources.residents ?? []).some(existing => existing.individualId === value.individualId))
          .map(value => ({ individualId: value.individualId, status: value.lifecycle }))];
        const decision = capacity.preflight({ ...resources, residents, incrementalMemoryBytes: footprint });
        if (!decision.admitted) throw new CapacityAdmissionError(decision.code);
        let checkpoint = r.saved;
        if (loadCheckpoint && r.checkpointId !== null) {
          checkpoint = await loadCheckpoint({ individualId: id, dataset: r.dataset, checkpointId: r.checkpointId });
          if (!checkpoint || checkpoint.individualId !== id || checkpoint.dataset !== r.dataset) throw new Error('Saved checkpoint missing or recipient/profile mismatch');
          checkpoint = structuredClone(checkpoint);
        }
        const owner = { handle: null, opening: null, backend: null, intentional: false, stopping: null, exited: false };
        r.owner = owner; r.lifecycle = 'loading';
        try {
          owner.handle = openBackend(r.directory, { dataset: r.dataset, individualId: id, checkpoint,
            onExit: () => release(r, owner, !owner.intentional) });
          owner.opening = Promise.resolve(owner.handle);
          const backend = await bounded(owner.opening, () => {
            void evict(r, 'Worker load deadline; admission reserved until termination completes.', owner).catch(() => {});
          });
          owner.backend = backend;
          if (owner.exited || owner.intentional || r.owner !== owner) throw new Error('Worker exited or stopped before publication');
          const state = backend.ready;
          if (!state?.available || state.status !== 'paused' || state.individualId !== id || state.dataset !== r.dataset || !state.sessionEpoch) {
            await evict(r, 'Research worker unavailable or incompatible; no fixture substituted', owner);
            throw new Error('Research worker unavailable or incompatible; no fixture substituted');
          }
          r.backend = backend; r.state = state; r.lifecycle = 'paused'; r.reason = null; r.sequence = 0; r.recoveryRequired = false;
        } catch (error) {
          if (!owner.stopping && !owner.exited) {
            if (owner.handle?.terminated) {
              void evict(r, 'Worker failed during loading; admission reserved until termination completes.', owner).catch(() => {});
            } else if (!owner.backend) release(r, owner, true); // Rejected injected factory owns its own cleanup.
          }
          throw error;
        }
        return publicState(r);
      });
      loadQueue = result.catch(() => {}); return result;
    });
  }
  function command(id, envelope, checkpoint = undefined, sourceCheckpointId = null) {
    const r = record(id);
    // Capture incoming values now: queued work must not read later caller mutations.
    const request = structuredClone(envelope), target = checkpoint === undefined ? undefined : structuredClone(checkpoint);
    return enqueue(r, async () => {
      if (!exact(request, ['protocolVersion', 'individualId', 'sessionEpoch', 'commandSequence', 'action', 'steps'])
        || request.protocolVersion !== 1 || request.individualId !== id || request.sessionEpoch !== r.state?.sessionEpoch
        || request.commandSequence !== r.sequence || !Number.isSafeInteger(r.sequence + 1)
        || !['start', 'pause', 'rest', 'home', 'advance', 'save', 'unload', 'restore'].includes(request.action)
        || (request.action === 'advance' ? !Number.isInteger(request.steps) || request.steps < 1 || request.steps > 1000 : request.steps !== null)
        || (request.action === 'restore') !== (target !== undefined)
        || (request.action === 'restore' ? (loadCheckpoint && !idValid(sourceCheckpointId)) || (sourceCheckpointId !== null && !idValid(sourceCheckpointId)) : sourceCheckpointId !== null)) throw new Error('Invalid or stale connectome command');
      r.sequence++;
      try {
        if (request.action === 'start' || request.action === 'advance') {
          r.state = await call(r, request.action, request.steps); r.lifecycle = r.state.status;
        } else {
          await pause(r);
          if (request.action === 'restore') {
            const prepared = await call(r, 'prepareRestore', target);
            await persist(r, target, 'restore', sourceCheckpointId);
            try { r.state = await call(r, 'commitRestore', prepared.token); r.lifecycle = 'paused'; }
            catch (error) { await evict(r, 'Durable restore committed; worker stopped. Explicit load recovers the selected head paused.'); throw error; }
          } else if (['save', 'unload'].includes(request.action)) {
            await persist(r, await call(r, 'checkpoint'), request.action);
            if (request.action === 'unload') await evict(r, null);
          } else if (request.action === 'rest') r.lifecycle = 'resting';
          else if (request.action === 'home') r.reason = 'Paused locally; this backend has no external embodiment or travel.';
        }
        return publicState(r);
      } catch (error) {
        if (r.backend) await pause(r).catch(() => {});
        r.reason = error.message; throw error;
      }
    });
  }
  function sample(id, envelope) {
    const r = record(id);
    if (!exact(envelope, ['protocolVersion', 'individualId', 'dataset', 'graphSha256', 'sessionEpoch', 'neuronIds'])
      || envelope.protocolVersion !== 1 || envelope.individualId !== id || envelope.dataset !== r.dataset
      || typeof envelope.graphSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.graphSha256)
      || typeof envelope.sessionEpoch !== 'string') throw new Error('Invalid connectome sample envelope');
    validateNeuronSampleIds(envelope.neuronIds, envelope.dataset);
    const request = { ...envelope, neuronIds: [...envelope.neuronIds] };
    return enqueue(r, async () => {
      if (!r.backend || !['paused', 'running', 'resting'].includes(r.lifecycle)) throw new Error('Connectome sample unavailable; explicitly load a healthy worker first');
      if (request.sessionEpoch !== r.state?.sessionEpoch || request.graphSha256 !== r.state?.graphSha256) throw new Error('Stale connectome sample session or graph');
      const backend = r.backend;
      // Read failures do not send pause/start or alter Rest. Only a worker deadline
      // invokes the existing fail-closed termination path and retains admission.
      const value = await bounded(Promise.resolve().then(() => backend.sample(request.neuronIds)), () => {
        void evict(r, 'Sample deadline; worker stopped and durable checkpoint retained.').catch(() => {});
      });
      if (r.backend !== backend || r.state?.sessionEpoch !== request.sessionEpoch) throw new Error('Connectome sample session ended');
      if (value?.individualId !== id || value.dataset !== request.dataset || value.graphSha256 !== request.graphSha256
        || value.sessionEpoch !== request.sessionEpoch) throw new Error('Connectome sample source mismatch');
      return { ...value, status: r.lifecycle, commandSequence: r.sequence };
    });
  }
  return { register, load, command, sample, list: () => [...records.values()].map(publicState), snapshot: id => publicState(record(id)),
    close: async () => { if (closed || closing) return; closing = true; await Promise.all([...records.values()].map(r => r.queue)); closed = true;
      await Promise.all([...records.values()].map(r => evict(r, 'Registry closed; only previously committed checkpoints can recover.'))); } };
}
