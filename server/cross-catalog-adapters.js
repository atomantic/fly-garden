import { randomUUID, createHash } from 'node:crypto';
import { CROSS_CATALOG_CONTRACT_VERSION } from './cross-catalog-checkpoint.js';
import { LIF_MODEL } from './sparse-lif.js';

/**
 * Real per-member cross-catalog adapters (#108).
 *
 * These adapters implement the versioned coordinator contract from
 * `server/cross-catalog-checkpoint.js` against the live stores: the synthetic
 * fixture identity store stages per-member save/restore payloads outside any
 * fixture shared session, and the full-connectome store stages per-member
 * payloads outside its catalog-local joint transactions. Worker
 * activation/eviction on the connectome side is expressed through an injected
 * worker hook surface so the coordinator contract stays intact; the trusted
 * service wiring of those hooks (and of `reserved()` into samples, lifecycle,
 * joins, withdrawals, barriers and shutdown) remains follow-up work.
 *
 * Nothing here starts a simulation, couples a sensory/motor path, claims
 * learning or biological continuity, or infers embodiment. Every transaction
 * stays paused; rest is preserved as a mode, never penalized.
 */

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const shaValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const catalogIdValid = value => typeof value === 'string' && /^[a-z0-9][a-z0-9:._-]{0,63}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_HISTORY = 64;

function checkStore(store, methods, kind) {
  if (!store || methods.some(name => typeof store[name] !== 'function')) {
    throw new Error(`Invalid ${kind} store for cross-catalog coordination`);
  }
}

function checkWorker(worker) {
  if (!worker || ['describe', 'peekCheckpoint', 'activatePaused', 'evict'].some(name => typeof worker[name] !== 'function')) {
    throw new Error('Invalid connectome worker hooks for cross-catalog coordination');
  }
}

function checkCatalogId(catalogId) {
  if (!catalogIdValid(catalogId)) throw new Error('Invalid cross-catalog adapter namespace');
}

function reservations() {
  const held = new Set();
  return {
    reserve(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !uuid(id))) throw new Error('Invalid cross-catalog reservation membership');
      if (ids.some(id => held.has(id))) throw new Error('Cross-catalog member is reserved by another operation');
      ids.forEach(id => held.add(id));
      let released = false;
      return () => { if (!released) { released = true; ids.forEach(id => held.delete(id)); } };
    },
  };
}

function checkStageRequest(request) {
  if (!request || typeof request !== 'object' || !uuid(request.transactionId)
    || !['save', 'restore'].includes(request.operation) || !Array.isArray(request.members) || !request.members.length) {
    throw new Error('Invalid cross-catalog staging request');
  }
  for (const member of request.members) {
    if (!member || typeof member !== 'object' || !uuid(member.individualId)
      || (member.parentId !== null && !uuid(member.parentId))
      || (request.operation === 'restore') !== (member.sourceCheckpointId !== null && member.sourceCheckpointId !== undefined)
      || (member.sourceCheckpointId != null && !uuid(member.sourceCheckpointId))
      || (request.operation === 'restore' && !shaValid(member.checkpointSha256))
      || !['active', 'resting'].includes(member.mode)) throw new Error('Invalid cross-catalog staging member');
  }
}

const asUncertain = error => {
  if (error?.code === 'CONNECTOME_DURABILITY_UNCERTAIN' || error?.code === 'CATALOG_DURABILITY_UNCERTAIN') {
    const selected = error.selectedHeads && typeof error.selectedHeads === 'object' ? { ...error.selectedHeads } : {};
    throw Object.assign(new Error(String(error.message || 'Catalog durability uncertain')), {
      code: 'CATALOG_DURABILITY_UNCERTAIN', selectedHeads: selected,
    });
  }
  throw error;
};

/** Synthetic fixture identity catalog adapter. Staging is per-member payload clones held by transaction ID; only commit selects heads. */
export function createFixtureCrossCatalogAdapter(store, { catalogId = 'fixture' } = {}) {
  checkStore(store, ['list', 'snapshot', 'checkpoints', 'peekLiveCheckpoint', 'readCrossCatalogPayload',
    'persistCrossCatalogCheckpoint', 'evictCrossCatalogResident', 'restore', 'load'], 'fixture identity');
  checkCatalogId(catalogId);
  const staged = new Map(), reverts = new Map(), guard = reservations();
  const FIXTURE_DATASET = 'synthetic-fixture:v1';

  const headOf = id => store.list().find(record => record.individualId === id)?.checkpointId ?? null;
  const historyOf = id => store.checkpoints(id);

  function view(id) {
    if (typeof id !== 'string') return null;
    const entry = store.list().find(record => record.individualId === id);
    if (!entry) return null;
    const snap = store.snapshot(id);
    let status = snap.status, mode = 'active';
    if (snap.externalOwner) status = 'visitor-owned';
    else if (snap.sharedSession) status = 'shared-joined';
    else if (status === 'resting') { status = 'paused'; mode = 'resting'; }
    return { individualId: id, catalogType: 'fixture-identity', head: entry.checkpointId,
      dataset: FIXTURE_DATASET, graphSha256: null, modelId: null, status, mode,
      sessionEpoch: typeof snap.sessionId === 'string' ? snap.sessionId : 'unknown',
      simTimeMs: integer(snap.simTimeMs) ? snap.simTimeMs : 0 };
  }

  function preflight(request) {
    checkStageRequest(request);
    for (const member of request.members) {
      if (headOf(member.individualId) !== member.parentId) throw new Error('Stale cross-catalog parent head');
      const history = historyOf(member.individualId);
      if (history.length >= MAX_HISTORY) throw new Error('Cross-catalog checkpoint history capacity reached');
      if (request.operation === 'restore') {
        const source = history.find(item => item.checkpointId === member.sourceCheckpointId);
        if (!source || source.sha256 !== member.checkpointSha256) throw new Error('Restore source is not in this member history');
      }
    }
  }

  return {
    contractVersion: CROSS_CATALOG_CONTRACT_VERSION, catalogType: 'fixture-identity', catalogId,
    epoch: () => digest(store.list().map(record => [record.individualId, record.checkpointId]).sort()),
    member: id => view(id),
    reserve: ids => guard.reserve(ids),
    preflight: async request => { preflight(request); },
    stage: async request => {
      preflight(request);
      if (staged.has(request.transactionId)) throw new Error('Duplicate cross-catalog staging transaction');
      const entries = request.members.map(member => {
        let payload, pose, checkpointSha256, simTimeMs;
        if (request.operation === 'save') {
          const live = store.peekLiveCheckpoint(member.individualId);
          if (live.parentHead !== member.parentId) throw new Error('Stale cross-catalog parent head');
          ({ payload, pose, sha256: checkpointSha256, simTimeMs } = live);
        } else {
          const saved = store.readCrossCatalogPayload(member.individualId, member.sourceCheckpointId);
          if (saved.sha256 !== member.checkpointSha256) throw new Error('Restore source is not in this member history');
          ({ payload, pose, sha256: checkpointSha256, simTimeMs } = saved);
        }
        return { individualId: member.individualId, parentId: member.parentId, priorHead: member.parentId,
          plannedHead: randomUUID(), sourceCheckpointId: member.sourceCheckpointId ?? null,
          payload, pose, checkpointSha256, simTimeMs, mode: member.mode };
      });
      staged.set(request.transactionId, { operation: request.operation, entries });
      return entries.map(entry => ({ individualId: entry.individualId, parentId: entry.parentId,
        checkpointId: entry.plannedHead, sourceCheckpointId: entry.sourceCheckpointId,
        checkpointSha256: entry.checkpointSha256, simTimeMs: entry.simTimeMs }));
    },
    commit: async ({ transactionId }) => {
      const prepared = staged.get(transactionId);
      if (!prepared) throw new Error('Unknown cross-catalog staging transaction');
      const applied = [];
      try {
        for (const entry of prepared.entries) {
          store.persistCrossCatalogCheckpoint({ individualId: entry.individualId, checkpointId: entry.plannedHead,
            parentId: entry.priorHead, payload: entry.payload, pose: entry.pose,
            operation: prepared.operation === 'restore' ? 'restore' : 'save', sourceCheckpointId: entry.sourceCheckpointId });
          applied.push(entry);
        }
      } catch (error) {
        const failed = [];
        for (const entry of applied) {
          try { store.restore(entry.individualId, entry.priorHead); }
          catch { failed.push(entry.individualId); }
        }
        staged.delete(transactionId);
        if (failed.length) {
          throw Object.assign(new Error('Cross-catalog fixture commit failed and compensation could not be verified'),
            { code: 'CATALOG_DURABILITY_UNCERTAIN',
              selectedHeads: Object.fromEntries(applied.map(entry => [entry.individualId,
                failed.includes(entry.individualId) ? entry.plannedHead : entry.priorHead])) });
        }
        throw error;
      }
      staged.delete(transactionId);
      return { heads: Object.fromEntries(prepared.entries.map(entry => [entry.individualId, entry.plannedHead])) };
    },
    cancel: async ({ transactionId }) => { staged.delete(transactionId); return true; },
    revert: async ({ transactionId, heads }) => {
      if (reverts.has(transactionId)) return { heads: { ...reverts.get(transactionId) } };
      if (!heads || typeof heads !== 'object' || Array.isArray(heads)) throw new Error('Invalid cross-catalog revert heads');
      const result = {};
      for (const [id, prior] of Object.entries(heads)) {
        if (prior === null) throw new Error('A member had no prior head to revert to.');
        if (!uuid(prior)) throw new Error('Invalid cross-catalog revert head');
        try { store.restore(id, prior); }
        catch (error) {
          if (!/saved-unloaded/.test(String(error.message))) throw error;
          store.load(id); store.restore(id, prior);
        }
        result[id] = headOf(id);
      }
      reverts.set(transactionId, result);
      return { heads: { ...result } };
    },
    activate: async ({ transactionId, members }) => {
      if (!uuid(transactionId) || !Array.isArray(members) || !members.length) throw new Error('Invalid cross-catalog activation');
      return members.map(member => {
        if (!uuid(member.individualId) || !uuid(member.checkpointId) || !['active', 'resting'].includes(member.mode)) {
          throw new Error('Invalid cross-catalog activation member');
        }
        if (headOf(member.individualId) !== member.checkpointId) throw new Error('Cross-catalog activation head does not match the selected head');
        const snap = store.restore(member.individualId, member.checkpointId);
        if (snap.status !== 'paused') throw new Error('Cross-catalog activation could not be verified paused');
        return { individualId: member.individualId, checkpointId: member.checkpointId, sessionEpoch: snap.sessionId, status: 'paused' };
      });
    },
    evict: async ({ transactionId, ids }) => {
      if (!uuid(transactionId) || !Array.isArray(ids) || !ids.length) throw new Error('Invalid cross-catalog eviction');
      for (const id of ids) {
        store.evictCrossCatalogResident(id);
        if (store.snapshot(id).status !== 'saved-unloaded') throw new Error('Cross-catalog eviction could not be verified');
      }
    },
  };
}

/**
 * Full-connectome catalog adapter for one namespace (for example
 * `connectome:male` or `connectome:banc`). Several adapters may share one
 * store directory with different dataset filters; each resolves only its own
 * members, so the same stable ID can never be claimed twice. Runtime state
 * flows through the injected worker hooks; durable staging lives in the store.
 */
export function createConnectomeCrossCatalogAdapter({ store, worker, catalogId, dataset = null } = {}) {
  checkStore(store, ['identities', 'checkpoints', 'readCheckpoint', 'stageCrossCatalog',
    'commitCrossCatalog', 'cancelCrossCatalog', 'appendCrossCatalogRevert'], 'connectome');
  checkWorker(worker);
  checkCatalogId(catalogId);
  if (dataset !== null && typeof dataset !== 'string') throw new Error('Invalid connectome adapter dataset filter');
  const staged = new Map(), reverts = new Map(), guard = reservations();

  const identityOf = id => {
    const identity = store.identities().find(record => record.individualId === id);
    if (!identity || (dataset !== null && identity.dataset !== dataset)) return null;
    return identity;
  };

  function view(id) {
    if (typeof id !== 'string') return null;
    const identity = identityOf(id);
    if (!identity) return null;
    let graphSha256 = null, modelId = null, simTimeMs = 0;
    if (identity.checkpointId !== null) {
      const payload = store.readCheckpoint(id, identity.checkpointId);
      if (payload.dataset !== identity.dataset) throw new Error('Connectome checkpoint recipient mismatch');
      graphSha256 = payload.graphSha256; modelId = payload.model?.id ?? null; simTimeMs = payload.tick * LIF_MODEL.dtMs;
    }
    let status = 'unavailable', mode = 'active', sessionEpoch = identity.checkpointId ?? 'saved-unloaded';
    try {
      const described = worker.describe(id);
      sessionEpoch = typeof described.sessionEpoch === 'string' ? described.sessionEpoch : sessionEpoch;
      if (described.status === 'paused') status = 'paused';
      else if (described.status === 'resting') { status = 'paused'; mode = 'resting'; }
      else if (typeof described.status === 'string' && described.status) status = described.status;
    } catch { status = 'saved-unloaded'; }
    return { individualId: id, catalogType: 'full-connectome', head: identity.checkpointId,
      dataset: identity.dataset, graphSha256, modelId, status, mode, sessionEpoch,
      simTimeMs: integer(simTimeMs) ? simTimeMs : 0 };
  }

  function preflight(request) {
    checkStageRequest(request);
    for (const member of request.members) {
      const identity = identityOf(member.individualId);
      if (!identity || identity.checkpointId !== member.parentId) throw new Error('Stale cross-catalog parent head');
      const history = store.checkpoints(member.individualId);
      if (history.length >= MAX_HISTORY) throw new Error('Cross-catalog checkpoint history capacity reached');
      if (request.operation === 'restore') {
        const source = history.find(item => item.checkpointId === member.sourceCheckpointId);
        if (!source || source.sha256 !== member.checkpointSha256) throw new Error('Restore source is not in this member history');
      }
    }
  }

  return {
    contractVersion: CROSS_CATALOG_CONTRACT_VERSION, catalogType: 'full-connectome', catalogId,
    epoch: () => digest(store.identities()
      .filter(record => dataset === null || record.dataset === dataset)
      .map(record => [record.individualId, record.checkpointId]).sort()),
    member: id => view(id),
    reserve: ids => guard.reserve(ids),
    preflight: async request => { preflight(request); },
    stage: async request => {
      preflight(request);
      if (staged.has(request.transactionId)) throw new Error('Duplicate cross-catalog staging transaction');
      const items = request.members.map(member => {
        let checkpoint;
        if (request.operation === 'save') {
          checkpoint = worker.peekCheckpoint(member.individualId);
          if (!checkpoint || checkpoint.individualId !== member.individualId) throw new Error('Connectome worker checkpoint recipient mismatch');
          const identity = identityOf(member.individualId);
          if (!identity || checkpoint.dataset !== identity.dataset) throw new Error('Connectome worker checkpoint recipient mismatch');
        } else {
          checkpoint = store.readCheckpoint(member.individualId, member.sourceCheckpointId);
        }
        return { individualId: member.individualId, checkpointId: randomUUID(), parentId: member.parentId,
          restoredFrom: request.operation === 'restore' ? member.sourceCheckpointId : null,
          operation: request.operation, checkpoint,
          sourceCheckpointId: member.sourceCheckpointId ?? null, mode: member.mode };
      });
      let files;
      try {
        files = store.stageCrossCatalog(request.transactionId, items);
      } catch (error) { asUncertain(error); }
      const byId = new Map(files.map(file => [file.checkpointId, file]));
      const entries = items.map(item => {
        const file = byId.get(item.checkpointId);
        if (!file) throw new Error('Connectome staging returned an incomplete plan');
        return { ...item, plannedHead: item.checkpointId, checkpointSha256: file.sha256, simTimeMs: file.tick * LIF_MODEL.dtMs };
      });
      staged.set(request.transactionId, { operation: request.operation, entries });
      return entries.map(entry => ({ individualId: entry.individualId, parentId: entry.parentId,
        checkpointId: entry.plannedHead, sourceCheckpointId: entry.sourceCheckpointId,
        checkpointSha256: entry.checkpointSha256, simTimeMs: entry.simTimeMs }));
    },
    commit: async ({ transactionId }) => {
      const prepared = staged.get(transactionId);
      if (!prepared) throw new Error('Unknown cross-catalog staging transaction');
      const scope = prepared.entries.map(entry => entry.individualId);
      try {
        const result = store.commitCrossCatalog(transactionId, { individualIds: scope });
        staged.delete(transactionId);
        return { heads: Object.fromEntries(result.members.map(member => [member.individualId, member.checkpointId])) };
      } catch (error) { staged.delete(transactionId); asUncertain(error); }
    },
    cancel: async ({ transactionId }) => {
      if (!uuid(transactionId)) throw new Error('Invalid cross-catalog staging transaction');
      const prepared = staged.get(transactionId);
      staged.delete(transactionId);
      if (prepared) store.cancelCrossCatalog(transactionId, { individualIds: prepared.entries.map(entry => entry.individualId) });
      else store.cancelCrossCatalog(transactionId);
      return true;
    },
    revert: async ({ transactionId, heads }) => {
      if (reverts.has(transactionId)) return { heads: { ...reverts.get(transactionId) } };
      if (!heads || typeof heads !== 'object' || Array.isArray(heads)) throw new Error('Invalid cross-catalog revert heads');
      const result = {};
      for (const [id, prior] of Object.entries(heads)) {
        if (prior === null) throw new Error('A member had no prior head to revert to.');
        if (!uuid(prior)) throw new Error('Invalid cross-catalog revert head');
        const identity = identityOf(id);
        if (!identity) throw new Error('Connectome identity not found');
        const current = store.checkpoints(id).find(item => item.checkpointId === identity.checkpointId);
        if (current && current.restoredFrom === prior) { result[id] = identity.checkpointId; continue; }
        const appended = store.appendCrossCatalogRevert({ individualId: id, checkpointId: randomUUID(), priorHead: prior });
        result[id] = appended.checkpointId;
      }
      reverts.set(transactionId, result);
      return { heads: { ...result } };
    },
    activate: async ({ transactionId, members }) => {
      if (!uuid(transactionId) || !Array.isArray(members) || !members.length) throw new Error('Invalid cross-catalog activation');
      const activated = [];
      for (const member of members) {
        if (!uuid(member.individualId) || !uuid(member.checkpointId) || !['active', 'resting'].includes(member.mode)) {
          throw new Error('Invalid cross-catalog activation member');
        }
        const identity = identityOf(member.individualId);
        if (!identity || identity.checkpointId !== member.checkpointId) {
          throw new Error('Cross-catalog activation head does not match the selected head');
        }
        const result = await worker.activatePaused(member.individualId, { checkpointId: member.checkpointId, mode: member.mode });
        if (!result || result.checkpointId !== member.checkpointId || typeof result.sessionEpoch !== 'string' || result.status !== 'paused') {
          throw new Error('Cross-catalog activation could not be verified paused');
        }
        activated.push({ individualId: member.individualId, checkpointId: member.checkpointId,
          sessionEpoch: result.sessionEpoch, status: 'paused' });
      }
      return activated;
    },
    evict: async ({ transactionId, ids }) => {
      if (!uuid(transactionId) || !Array.isArray(ids) || !ids.length) throw new Error('Invalid cross-catalog eviction');
      for (const id of ids) {
        await worker.evict(id);
        let status = null;
        try { status = worker.describe(id).status; } catch { status = 'saved-unloaded'; }
        if (status !== 'saved-unloaded') throw new Error('Cross-catalog eviction could not be verified');
      }
    },
  };
}
