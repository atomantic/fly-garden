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
  persistCheckpoint, loadCheckpoint, persistJointCheckpoint, readJointCheckpoint, prepareJointRestore, commitJointRestore, cancelJointRestore,
  openBackend = openConnectomeBackend, operationTimeoutMs = 30000 } = {}) {
  if (!Array.isArray(identities) || identities.length > 64 || typeof persistCheckpoint !== 'function'
    || (loadCheckpoint !== undefined && typeof loadCheckpoint !== 'function')
    || (persistJointCheckpoint !== undefined && typeof persistJointCheckpoint !== 'function')
    || (readJointCheckpoint !== undefined && typeof readJointCheckpoint !== 'function')
    || (prepareJointRestore !== undefined && typeof prepareJointRestore !== 'function')
    || (commitJointRestore !== undefined && typeof commitJointRestore !== 'function')
    || (cancelJointRestore !== undefined && typeof cancelJointRestore !== 'function')
    || !Number.isInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 120000) throw new Error('Invalid research registry configuration');
  const records = new Map(); let loadQueue = Promise.resolve(), closed = false, closing = false;
  const restoreReservations = new Map(), restoreCalls = new Set(), restoreWaiters = new Set();
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
      provenance: r.state?.provenance ?? null, retainedWeightState: r.state?.retainedWeightState ?? null, capabilities });
  }
  function enqueue(r, fn) {
    const result = r.queue.then(() => { if (closed) throw new Error('Connectome registry closed'); return fn(); });
    r.queue = result.catch(() => {}); return result;
  }
  function reserveRestore(recordsToReserve, kind = 'restore') {
    const ids = recordsToReserve.map(r => r.individualId);
    if (ids.some(id => restoreReservations.has(id))) throw new Error('Connectome participant is reserved for another coordinated operation');
    const token = randomUUID();
    for (const id of ids) restoreReservations.set(id, { token, kind });
    return token;
  }
  function releaseRestore(token) {
    for (const [id, value] of restoreReservations) if (value.token === token) restoreReservations.delete(id);
  }
  function ensureUnreserved(r) {
    if (restoreReservations.has(r.individualId)) throw new Error('Connectome participant is reserved for another coordinated operation');
  }
  function trackRestoreCall(promise) {
    let cancel, tracked;
    const cancellation = new Promise((_, reject) => { cancel = reject; });
    tracked = Promise.race([Promise.resolve(promise), cancellation]).finally(() => { restoreCalls.delete(tracked); restoreWaiters.delete(cancel); });
    restoreCalls.add(tracked); restoreWaiters.add(cancel);
    return tracked;
  }
  function cancelRestoreCalls() {
    for (const cancel of restoreWaiters) cancel(new Error('Connectome registry closed'));
    restoreWaiters.clear();
  }
  async function bounded(promise, onTimeout) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => {
        onTimeout?.(); reject(new Error('Connectome operation deadline exceeded; shutdown requested and admission retained until exit'));
      }, operationTimeoutMs); timer.unref?.(); })]);
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
  async function call(r, operation, value, { allowReserved = false } = {}) {
    if (!allowReserved) ensureUnreserved(r);
    const backend = r.backend; if (!backend) throw new Error('Explicitly load this connectome individual first');
    try {
      const request = bounded(Promise.resolve().then(() => backend[operation](value)), () => { void evict(r, 'Worker deadline; durable checkpoint retained for paused recovery.').catch(() => {}); });
      return await (allowReserved ? trackRestoreCall(request) : request);
    }
     catch (error) {
       if (r.backend && !closing) {
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
  async function sharedControl(id, action) {
    const r = record(id);
     return enqueue(r, async () => {
       ensureUnreserved(r);
       if (!['start', 'pause', 'rest', 'resume'].includes(action)) throw new Error('Unknown shared research control action');
      if (!r.backend) {
        if (r.lifecycle === 'unavailable') return publicState(r);
        throw new Error('Explicitly load a healthy research individual first');
      }
      if (r.state?.status === 'fault') {
        await evict(r, 'Shared research worker faulted; durable checkpoint retained for explicit paused recovery.');
        r.lifecycle = 'unavailable'; r.reason = 'Shared research worker faulted; durable checkpoint retained for explicit paused recovery.';
        return publicState(r);
      }
      try {
        if (action === 'start') {
          r.state = await call(r, 'start'); r.lifecycle = 'running';
        } else if (action === 'pause') {
          r.state = await call(r, 'pause'); r.lifecycle = 'paused';
        } else if (action === 'rest') {
          r.state = await call(r, 'pause'); r.lifecycle = 'resting';
        } else {
          r.state = await call(r, 'start'); r.lifecycle = 'running';
        }
        r.reason = null;
        return publicState(r);
      } catch (error) {
        if (r.backend) {
          try { r.state = await call(r, 'pause'); r.lifecycle = 'paused'; } catch {}
        }
        r.reason = error.message;
        throw error;
      }
    });
  }
  function invalidateCommands(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 64 || new Set(ids).size !== ids.length) throw new Error('Invalid shared research command invalidation membership');
    const records = ids.map(record);
    if (records.some(r => !Number.isSafeInteger(r.sequence + 1))) throw new Error('Research command sequence limit reached');
    for (const r of records) r.sequence++;
    return records.map(publicState);
  }
  async function barrier(ids, steps, expectedEpochs = {}) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 64 || new Set(ids).size !== ids.length || !Number.isInteger(steps) || steps < 1 || steps > 1000) {
      throw new Error('Invalid shared research barrier membership or step count');
    }
    const records = ids.map(record);
    const reservation = reserveRestore(records, 'barrier');
    let prepared = [];
    try {
      await Promise.all(records.map(r => r.queue));
      for (const r of records) {
        if (!r.backend || r.lifecycle !== 'running' || r.state?.status === 'fault'
          || Object.hasOwn(expectedEpochs, r.individualId) && expectedEpochs[r.individualId] !== r.state?.sessionEpoch) {
          throw new Error('Every shared research participant must be healthy, running and on the current session epoch');
        }
      }
      const candidates = await Promise.allSettled(records.map(r => call(r, 'prepareAdvance', steps, { allowReserved: true })));
      prepared = candidates.map(result => result.status === 'fulfilled' ? result.value : null);
      if (candidates.some(result => result.status === 'rejected')) throw new Error('Research worker could not prepare a shared barrier candidate');
      for (const value of prepared) {
        if (typeof value?.token !== 'string' || !value.token || value.steps !== steps) throw new Error('Research worker returned an invalid shared barrier candidate');
      }
      const committed = await Promise.all(records.map((r, index) => call(r, 'commitAdvance', prepared[index].token, { allowReserved: true })));
      for (const [index, state] of committed.entries()) {
        if (state?.individualId !== records[index].individualId || state?.status !== 'running') throw new Error('Research worker returned an invalid shared barrier commit');
        records[index].state = state; records[index].lifecycle = state.status;
      }
      await Promise.all(records.map((r, index) => call(r, 'releaseAdvance', prepared[index].token, { allowReserved: true })));
      return records.map(publicState);
    } catch (error) {
      const rollback = await Promise.allSettled(records.map((r, index) => r.backend && prepared[index]?.token
        ? call(r, 'rollbackAdvance', prepared[index].token, { allowReserved: true }).then(state => { r.state = state; r.lifecycle = 'paused'; })
        : Promise.resolve()));
      for (const [index, result] of rollback.entries()) if (result.status === 'rejected') await evict(records[index], 'Shared barrier rollback failed; durable checkpoint retained for explicit paused recovery.').catch(() => {});
      await Promise.allSettled(records.map(r => r.backend ? call(r, 'pause', undefined, { allowReserved: true }).then(state => { r.state = state; r.lifecycle = 'paused'; }) : Promise.resolve()));
      throw new Error('Shared research barrier failed; no participant advanced.');
    } finally {
      releaseRestore(reservation);
    }
  }
  async function persist(r, checkpoint, operation, sourceCheckpointId = null) {
    // Writer must atomically persist payload and selected head, or leave both unchanged.
    let result;
    try {
      result = await persistCheckpoint({ individualId: r.individualId, dataset: r.dataset,
        parentId: r.checkpointId, checkpoint: structuredClone(checkpoint), operation, sourceCheckpointId });
    } catch (error) {
      if (error?.code === 'CONNECTOME_DURABILITY_UNCERTAIN') {
        await handleDurabilityFailure([r], error, 'Catalog selection changed but durability is uncertain. Recover storage before explicit paused reload.');
        if (error.individualId === r.individualId && idValid(error.selectedCheckpointId)) r.saved = loadCheckpoint ? null : checkpoint;
      }
      throw error;
    }
    if (!result || !idValid(result.checkpointId)) throw new Error('Checkpoint writer returned no valid durable head');
    r.saved = loadCheckpoint ? null : checkpoint; r.checkpointId = result.checkpointId;
  }
  async function discardWorkerRestore(r, token) {
    if (!token || !r.backend || typeof r.backend.discardRestore !== 'function') return;
    try {
      const state = await call(r, 'discardRestore', token, { allowReserved: true });
      if (state?.status) { r.state = state; r.lifecycle = state.status; }
    } catch {
      await evict(r, 'Prepared shared restore cleanup failed; durable checkpoint retained for explicit paused recovery.').catch(() => {});
    }
  }
  async function rollbackWorkerRestore(r, member) {
    if (typeof r.backend?.rollbackRestore === 'function') {
      const state = await call(r, 'rollbackRestore', { token: member.restoreToken, checkpoint: member.rollbackCheckpoint }, { allowReserved: true });
      if (state?.status) { r.state = state; r.lifecycle = state.status; }
      return;
    }
    const prepared = await call(r, 'prepareRestore', member.rollbackCheckpoint, { allowReserved: true });
    const state = await call(r, 'commitRestore', prepared.token, { allowReserved: true });
    r.state = state; r.lifecycle = 'paused';
  }
  async function cancelPreparedRestore(prepared, skipIds = new Set()) {
    if (typeof cancelJointRestore === 'function' && prepared?.token) {
      try { await cancelJointRestore(prepared.token); } catch {}
    }
    for (const member of prepared?.members ?? []) {
      if (skipIds.has(member.individualId)) continue;
      const r = records.get(member.individualId);
      if (r) await discardWorkerRestore(r, member.restoreToken);
    }
    if (prepared?.reservation) releaseRestore(prepared.reservation);
  }
  async function handleDurabilityFailure(records, error, reason) {
    if (error?.code !== 'CONNECTOME_DURABILITY_UNCERTAIN') return;
    for (const r of records) {
      r.recoveryRequired = true; r.reason = reason;
      const selected = error.selectedHeads?.[r.individualId]
        ?? (error.individualId === r.individualId ? error.selectedCheckpointId : null);
      if (idValid(selected)) { r.checkpointId = selected; r.durableHeadUnknown = false; }
      else r.durableHeadUnknown = true;
    }
    for (const r of records) await evict(r, reason);
  }
  function load(id) {
    const r = record(id);
     return enqueue(r, () => {
       const result = loadQueue.then(async () => {
         ensureUnreserved(r);
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
  async function sharedCheckpoint(ids, { intervalMs = 5, tick, modes = new Map() } = {}) {
    if (typeof persistJointCheckpoint !== 'function' || !Array.isArray(ids) || ids.length < 2 || ids.length > 64 || new Set(ids).size !== ids.length
      || intervalMs !== 5 || !Number.isSafeInteger(tick) || tick < 0) throw new Error('Invalid shared checkpoint request');
    const records = ids.map(record);
    const reservation = reserveRestore(records, 'checkpoint');
    try {
      await Promise.all(records.map(r => r.queue));
      if (records.some(r => !Number.isSafeInteger(r.sequence + 1))) throw new Error('Research command sequence limit reached');
      const values = await Promise.all(records.map(async r => {
        if (!r.backend || !r.owner || !r.state || !['paused', 'running', 'resting'].includes(r.lifecycle) || r.state.status === 'fault') throw new Error('Every shared checkpoint participant must be a healthy resident');
        const checkpoint = await call(r, 'checkpoint', undefined, { allowReserved: true });
        const state = await call(r, 'snapshot', undefined, { allowReserved: true });
        r.state = state; r.lifecycle = state.status;
        const mode = modes instanceof Map ? modes.get(r.individualId) : modes?.[r.individualId];
        if (mode !== undefined && !['active', 'resting'].includes(mode)) throw new Error('Invalid shared checkpoint member mode');
        return { individualId: r.individualId, dataset: r.dataset, parentId: r.checkpointId, checkpoint, mode: mode ?? 'active' };
      }));
      let result;
      try {
        result = await persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs, tick, members: values });
      } catch (error) {
        await handleDurabilityFailure(records, error, 'Shared joint checkpoint durability is uncertain; recover the catalog before explicit paused reload.');
        throw error;
      }
      const byId = new Map(Array.isArray(result?.payload?.members) ? result.payload.members.map(member => [member.individualId, member]) : []);
      if (byId.size !== records.length || records.some(r => !idValid(byId.get(r.individualId)?.checkpointId))) {
        const selectedHeads = Object.fromEntries([...byId].filter(([, member]) => idValid(member?.checkpointId)).map(([id, member]) => [id, member.checkpointId]));
        const error = Object.assign(new Error('Shared checkpoint writer returned an incomplete transaction'), { code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedHeads });
        await handleDurabilityFailure(records, error, 'Shared joint checkpoint receipt is uncertain; recover the catalog before explicit paused reload.');
        throw error;
      }
      invalidateCommands(ids);
      for (const r of records) {
        const member = byId.get(r.individualId);
        r.checkpointId = member.checkpointId; r.saved = loadCheckpoint ? null : values.find(value => value.individualId === r.individualId).checkpoint;
      }
      return result;
    } finally {
      releaseRestore(reservation);
    }
  }
  async function prepareSharedRestore(jointCheckpointId, expectedSequences = {}) {
    if (typeof readJointCheckpoint !== 'function' || typeof prepareJointRestore !== 'function' || typeof commitJointRestore !== 'function'
      || typeof jointCheckpointId !== 'string' || !expectedSequences || typeof expectedSequences !== 'object') throw new Error('Shared checkpoint restore is unavailable');
    const joint = readJointCheckpoint(jointCheckpointId);
    if (!joint?.payload?.members?.length || !Array.isArray(joint.payload.members)) throw new Error('Joint checkpoint has no members');
    const ids = joint.payload.members.map(member => member?.individualId);
    if (new Set(ids).size !== ids.length) throw new Error('Joint checkpoint has duplicate members');
    const records = ids.map(record);
    const reservation = reserveRestore(records, 'restore');
    let prepared;
    const members = [];
    try {
      await Promise.all(records.map(r => r.queue));
      prepared = prepareJointRestore(jointCheckpointId);
      if (!Array.isArray(prepared?.members) || prepared.members.length !== joint.payload.members.length) throw new Error('Joint restore planner returned an incomplete membership');
      for (const [index, member] of prepared.members.entries()) {
        const r = records[index];
        if (member.individualId !== ids[index]) throw new Error('Joint restore planner changed membership');
        const commandSequence = Object.hasOwn(expectedSequences, member.individualId) ? expectedSequences[member.individualId] : r.sequence;
        if (!r.backend || !r.owner || !r.state || r.state.status === 'fault' || r.checkpointId !== member.parentId
          || !Number.isSafeInteger(commandSequence) || r.sequence !== commandSequence || r.state.status !== 'paused') throw new Error('A shared restore participant is unavailable or stale');
        const sessionEpoch = r.state.sessionEpoch;
        const rollbackCheckpoint = await call(r, 'checkpoint', undefined, { allowReserved: true });
        if (rollbackCheckpoint?.individualId !== r.individualId || rollbackCheckpoint?.dataset !== r.dataset) throw new Error('A shared restore participant returned an invalid rollback checkpoint');
        const token = await call(r, 'prepareRestore', member.checkpoint, { allowReserved: true });
        if (!token?.token || r.sequence !== commandSequence || r.state?.sessionEpoch !== sessionEpoch) throw new Error('A shared restore participant changed during preparation');
        members.push({ ...member, restoreToken: token.token, sessionEpoch: r.state.sessionEpoch, commandSequence, rollbackCheckpoint: structuredClone(rollbackCheckpoint) });
      }
      return { jointCheckpointId, token: prepared.token, members, reservation };
    } catch (error) {
      await cancelPreparedRestore({ ...(prepared ?? {}), members, reservation });
      throw error;
    }
  }
  async function commitSharedRestore(prepared) {
    if (typeof commitJointRestore !== 'function' || !prepared || !Array.isArray(prepared.members) || prepared.members.length < 2) throw new Error('Invalid shared restore transaction');
    let records;
    try {
      records = prepared.members.map(member => record(member.individualId));
      if (new Set(records.map(r => r.individualId)).size !== records.length) throw new Error('Invalid shared restore transaction');
      if (!prepared.reservation || records.some(r => restoreReservations.get(r.individualId)?.token !== prepared.reservation)) throw new Error('Shared restore reservation is no longer valid');
    } catch (error) {
      if (prepared.reservation) releaseRestore(prepared.reservation);
      throw error;
    }
    let storageCommitted = false, reservationReleased = false, committed = [];
    try {
      for (const [index, member] of prepared.members.entries()) {
        const r = records[index], state = r.state;
        if (!r.backend || !r.owner || r.checkpointId !== member.parentId || state?.status !== 'paused'
          || state.sessionEpoch !== member.sessionEpoch || r.sequence !== member.commandSequence) throw new Error('A shared restore participant changed before commit');
      }
      if (records.some(r => !Number.isSafeInteger(r.sequence + 1))) throw new Error('Research command sequence limit reached');
      for (const [index, member] of prepared.members.entries()) {
        const state = await call(records[index], 'commitRestore', member.restoreToken, { allowReserved: true });
        if (state?.individualId !== records[index].individualId || state?.status !== 'paused') throw new Error('Shared restore worker returned an invalid paused state');
        records[index].state = state; records[index].lifecycle = 'paused';
        committed.push({ record: records[index], state });
      }
      const durable = commitJointRestore(prepared.token);
      storageCommitted = true;
      const durableById = Array.isArray(durable?.members) ? new Map(durable.members.map(member => [member.individualId, member])) : new Map();
      if (durableById.size !== records.length || records.some(r => !idValid(durableById.get(r.individualId)?.checkpointId))) {
        const selectedHeads = Object.fromEntries([...durableById].filter(([, member]) => idValid(member?.checkpointId)).map(([id, member]) => [id, member.checkpointId]));
        throw Object.assign(new Error('Shared restore returned an invalid durable head'), { code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedHeads });
      }
      for (const value of committed) {
        const member = durableById.get(value.record.individualId);
        value.record.state = value.state; value.record.lifecycle = 'paused'; value.record.checkpointId = member.checkpointId;
        value.record.saved = loadCheckpoint ? null : prepared.members.find(item => item.individualId === value.record.individualId).checkpoint;
      }
      invalidateCommands(records.map(r => r.individualId));
      return durable;
    } catch (error) {
      if (!storageCommitted && error?.code !== 'CONNECTOME_DURABILITY_UNCERTAIN') {
        const committedIds = new Set(committed.map(value => value.record.individualId));
        for (const value of committed) {
          const r = value.record, member = prepared.members.find(item => item.individualId === r.individualId);
          try {
            if (!member.rollbackCheckpoint) throw new Error('Missing rollback checkpoint');
            await rollbackWorkerRestore(r, member);
          } catch {
            await evict(r, 'Shared restore rollback failed; durable checkpoint retained for explicit paused recovery.').catch(() => {});
          }
        }
        await cancelPreparedRestore(prepared, committedIds);
        reservationReleased = true;
      } else if (error?.code === 'CONNECTOME_DURABILITY_UNCERTAIN') {
        for (const value of committed) value.record.saved = loadCheckpoint ? null : prepared.members.find(item => item.individualId === value.record.individualId).checkpoint;
        await handleDurabilityFailure(records, error, 'Shared restore durability is uncertain; reload the selected checkpoint paused.');
        releaseRestore(prepared.reservation);
        reservationReleased = true;
      }
      throw error;
    } finally {
      if (!reservationReleased) releaseRestore(prepared.reservation);
    }
  }
  function command(id, envelope, checkpoint = undefined, sourceCheckpointId = null) {
    const r = record(id);
    // Capture incoming values now: queued work must not read later caller mutations.
     const request = structuredClone(envelope), target = checkpoint === undefined ? undefined : structuredClone(checkpoint);
     return enqueue(r, async () => {
       ensureUnreserved(r);
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
            const reservation = reserveRestore([r], 'command-restore');
            let runtimeCommitted = false, rollbackCheckpoint, restoreToken;
            try {
              rollbackCheckpoint = await call(r, 'checkpoint', undefined, { allowReserved: true });
              const prepared = await call(r, 'prepareRestore', target, { allowReserved: true }); restoreToken = prepared.token;
              const state = await call(r, 'commitRestore', prepared.token, { allowReserved: true });
              if (state?.individualId !== r.individualId || state?.status !== 'paused') throw new Error('Connectome restore returned an invalid paused state');
              r.state = state; r.lifecycle = 'paused'; runtimeCommitted = true;
              await persist(r, target, 'restore', sourceCheckpointId);
            } catch (error) {
              if (runtimeCommitted && error?.code !== 'CONNECTOME_DURABILITY_UNCERTAIN') {
                try {
                  await rollbackWorkerRestore(r, { restoreToken, rollbackCheckpoint });
                } catch { await evict(r, 'Restore rollback failed; durable checkpoint retained for explicit paused recovery.').catch(() => {}); }
              }
              throw error;
            } finally { releaseRestore(reservation); }
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
       ensureUnreserved(r);
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
  return { register, load, command, sample, sharedControl, invalidateCommands, barrier, sharedCheckpoint, prepareSharedRestore, commitSharedRestore,
    list: () => [...records.values()].map(publicState), snapshot: id => publicState(record(id)),
    close: async () => { if (closed || closing) return; closing = true; cancelRestoreCalls();
      const reservedRecords = [...new Set([...restoreReservations.keys()])].map(id => records.get(id)).filter(Boolean);
      await Promise.allSettled(reservedRecords.map(r => evict(r, 'Registry closed; only previously committed checkpoints can recover.')));
      await Promise.all([...records.values()].map(r => r.queue));
      while (restoreCalls.size) await Promise.allSettled([...restoreCalls]);
      restoreReservations.clear(); closed = true;
      await Promise.all([...records.values()].map(r => evict(r, 'Registry closed; only previously committed checkpoints can recover.'))); } };
}
