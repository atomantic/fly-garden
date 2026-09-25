import { createConnectomeCrossCatalogAdapter, createFixtureCrossCatalogAdapter } from './cross-catalog-adapters.js';
import { CROSS_CATALOG_LIMITS, createCrossCatalogCoordinator, openCrossCatalogJournal } from './cross-catalog-checkpoint.js';
import { RuntimeError } from './runtime.js';

const CATALOGS = Object.freeze([
  Object.freeze({ catalogId: 'fixture', catalogType: 'fixture-identity' }),
  Object.freeze({ catalogId: 'connectome:male', catalogType: 'full-connectome' }),
  Object.freeze({ catalogId: 'connectome:banc', catalogType: 'full-connectome' }),
]);
const DATASETS = new Map([
  ['fixture', 'synthetic-fixture:v1'],
  ['connectome:male', 'male-cns:v1.0'],
  ['connectome:banc', 'banc:v888'],
]);
const DISCLOSURE = 'Cross-catalog research checkpoint transaction. It coordinates durable heads and paused runtime restoration only; it is not embodied, sensory, learned or biological behavior.';
const SAFE_CODES = new Set([
  'CROSS_CATALOG_REFUSED',
  'CROSS_CATALOG_UNAVAILABLE',
  'CROSS_CATALOG_BUSY',
  'CROSS_CATALOG_RECOVERY_REQUIRED',
  'CROSS_CATALOG_CAPACITY',
  'CROSS_CATALOG_STALE',
  'CROSS_CATALOG_DISAGREEMENT',
  'CROSS_CATALOG_ROLLED_BACK',
  'CROSS_CATALOG_RUNTIME_EVICTED',
  'CROSS_CATALOG_NOT_FOUND',
  'CROSS_CATALOG_JOURNAL_CORRUPT',
  'CROSS_CATALOG_JOURNAL_UNCERTAIN',
  'CROSS_CATALOG_OPERATION_FAILED',
]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\\/\0]/.test(value) ? value : null;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
const nullable = (value, project) => value === null ? null : project(value);
const unavailable = () => Object.assign(new RuntimeError('Cross-catalog checkpoint service is unavailable; existing state was preserved.', 409), {
  code: 'CROSS_CATALOG_UNAVAILABLE',
});
const safeHeads = value => {
  if (!Array.isArray(value)) return null;
  return value.slice(0, CROSS_CATALOG_LIMITS.members).filter(object).map(head => ({
    individualId: text(head.individualId),
    catalogType: text(head.catalogType, 32),
    catalogId: text(head.catalogId, 64),
    priorHead: nullable(head.priorHead, item => text(item, 64)),
    plannedHead: nullable(head.plannedHead, item => text(item, 64)),
    selectedHead: nullable(head.selectedHead, item => text(item, 64)),
  }));
};
const safeRecovery = value => {
  if (!object(value)) return null;
  const affectedHeads = safeHeads(value.affectedHeads);
  if (!affectedHeads) return null;
  return {
    transactionId: text(value.transactionId, 64),
    operation: ['save', 'restore'].includes(value.operation) ? value.operation : null,
    state: text(value.state, 32),
    reason: nullable(value.reason, item => text(item, 512)),
    catalogs: Array.isArray(value.catalogs) ? value.catalogs.slice(0, CROSS_CATALOG_LIMITS.catalogs).filter(object).map(catalog => ({
      catalogType: text(catalog.catalogType, 32),
      catalogId: text(catalog.catalogId, 64),
      catalogEpoch: text(catalog.catalogEpoch, 128),
      state: text(catalog.state, 32),
    })) : [],
    affectedHeads,
    journalReopenRequired: value.journalReopenRequired === true,
  };
};
const safeMember = (view, catalogId, catalogType) => {
  if (!object(view) || view.individualId === undefined || view.catalogType !== catalogType) return null;
  const individualId = text(view.individualId, 64);
  const dataset = text(view.dataset, 128);
  const head = nullable(view.head, item => text(item, 64));
  const graphSha256 = nullable(view.graphSha256, sha);
  const modelId = nullable(view.modelId, item => text(item, 128));
  const status = text(view.status, 64);
  const mode = ['active', 'resting'].includes(view.mode) ? view.mode : null;
  const sessionEpoch = text(view.sessionEpoch, 128);
  if (!individualId || !DATASETS.get(catalogId) || dataset !== DATASETS.get(catalogId) || !head && view.head !== null
    || !graphSha256 && view.graphSha256 !== null || !modelId && view.modelId !== null || !status || !mode || !sessionEpoch
    || !Number.isSafeInteger(view.simTimeMs) || view.simTimeMs < 0) return null;
  return {
    individualId,
    catalogType,
    catalogId,
    head,
    dataset,
    graphSha256,
    modelId,
    status,
    mode,
    sessionEpoch,
    simTimeMs: view.simTimeMs,
  };
};
const safeCheckpoint = value => {
  if (!object(value) || !object(value.payload)) return null;
  const members = Array.isArray(value.payload.members) ? value.payload.members.slice(0, CROSS_CATALOG_LIMITS.members).filter(object).map(member => ({
    individualId: text(member.individualId, 64),
    catalogType: text(member.catalogType, 32),
    catalogId: text(member.catalogId, 64),
    dataset: text(member.dataset, 128),
    graphSha256: sha(member.graphSha256),
    modelId: nullable(member.modelId, item => text(item, 128)),
    checkpointId: text(member.checkpointId, 64),
    checkpointSha256: sha(member.checkpointSha256),
    simTimeMs: Number.isSafeInteger(member.simTimeMs) && member.simTimeMs >= 0 ? member.simTimeMs : null,
    mode: ['active', 'resting'].includes(member.mode) ? member.mode : null,
  })) : null;
  const result = {
    jointCheckpointId: text(value.jointCheckpointId, 64),
    createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt >= 0 ? value.createdAt : null,
    payload: members ? {
      version: value.payload.version === 1 ? 1 : null,
      kind: value.payload.kind === 'cross-catalog-joint' ? value.payload.kind : null,
      intervalMs: value.payload.intervalMs === 5 ? 5 : null,
      tick: Number.isSafeInteger(value.payload.tick) && value.payload.tick >= 0 ? value.payload.tick : null,
      members,
    } : null,
    sha256: sha(value.sha256),
  };
  return result.jointCheckpointId && result.createdAt !== null && result.payload && result.sha256 ? result : null;
};
const publicFailure = error => {
  const code = SAFE_CODES.has(error?.code) ? error.code : 'CROSS_CATALOG_OPERATION_FAILED';
  const statusCode = error instanceof RuntimeError && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode : 409;
  const message = error instanceof RuntimeError && SAFE_CODES.has(error.code) && typeof error.message === 'string'
    && error.message.length <= 512 && !/[\\/\0]/.test(error.message)
    ? error.message : 'Cross-catalog operation failed; existing state was preserved.';
  const recovery = safeRecovery(error?.recovery);
  const affectedHeads = safeHeads(error?.affectedHeads);
  return Object.assign(new RuntimeError(message, statusCode), {
    code,
    ...(recovery ? { recovery } : {}),
    ...(affectedHeads ? { affectedHeads } : {}),
  });
};

export function createCrossCatalogService({
  directory = null,
  journalDirectory = directory,
  identityStore = null,
  identities = identityStore,
  connectomeStore = null,
  store = connectomeStore,
  worker = null,
  connectomeWorker = worker,
  workerHooks = connectomeWorker,
  journal = null,
  coordinator = null,
  onLifecycle = () => {},
} = {}) {
  if (typeof onLifecycle !== 'function') throw new Error('Invalid cross-catalog lifecycle callback');
  let activeJournal = journal;
  let activeCoordinator = coordinator;
  let unavailableState = !activeCoordinator && (!identities || !store || !workerHooks);
  let openedJournal = false;
  let adapters = [];

  if (!unavailableState && !activeCoordinator && !activeJournal) {
    if (typeof journalDirectory !== 'string' || !journalDirectory) unavailableState = true;
    else {
      try {
        activeJournal = openCrossCatalogJournal(journalDirectory);
        openedJournal = true;
      } catch {
        unavailableState = true;
      }
    }
  }

  if (!unavailableState && !activeCoordinator) {
    try {
      adapters = [
        createFixtureCrossCatalogAdapter(identities, { catalogId: 'fixture' }),
        createConnectomeCrossCatalogAdapter({ store, worker: workerHooks, catalogId: 'connectome:male', dataset: DATASETS.get('connectome:male') }),
        createConnectomeCrossCatalogAdapter({ store, worker: workerHooks, catalogId: 'connectome:banc', dataset: DATASETS.get('connectome:banc') }),
      ];
      activeCoordinator = createCrossCatalogCoordinator({ journal: activeJournal, catalogs: adapters });
    } catch (error) {
      if (openedJournal) activeJournal.close();
      if (['CROSS_CATALOG_JOURNAL_CORRUPT', 'CROSS_CATALOG_JOURNAL_UNCERTAIN'].includes(error?.code)) unavailableState = true;
      else throw error;
    }
  } else if (activeCoordinator && identities && store && workerHooks) {
    adapters = [
      createFixtureCrossCatalogAdapter(identities, { catalogId: 'fixture' }),
      createConnectomeCrossCatalogAdapter({ store, worker: workerHooks, catalogId: 'connectome:male', dataset: DATASETS.get('connectome:male') }),
      createConnectomeCrossCatalogAdapter({ store, worker: workerHooks, catalogId: 'connectome:banc', dataset: DATASETS.get('connectome:banc') }),
    ];
  }

  if (activeCoordinator && ['save', 'restore', 'recover', 'status', 'jointCheckpoints', 'reserved', 'close']
    .some(method => typeof activeCoordinator[method] !== 'function')) {
    throw new Error('Invalid cross-catalog coordinator');
  }

  const adapterEntries = [
    { catalogId: 'fixture', catalogType: 'fixture-identity', adapter: adapters[0], ids: identities ? () => identities.list().map(record => record.individualId) : null },
    { catalogId: 'connectome:male', catalogType: 'full-connectome', adapter: adapters[1], ids: store ? () => store.identities().filter(record => record.dataset === DATASETS.get('connectome:male')).map(record => record.individualId) : null },
    { catalogId: 'connectome:banc', catalogType: 'full-connectome', adapter: adapters[2], ids: store ? () => store.identities().filter(record => record.dataset === DATASETS.get('connectome:banc')).map(record => record.individualId) : null },
  ];
  const keyOf = participant => `${participant.catalogId}:${participant.individualId}`;

  function required() {
    if (unavailableState || closed || !activeCoordinator) throw unavailable();
  }

  function baseStatus() {
    if (unavailableState || !activeCoordinator) {
      return {
        protocolVersion: 1,
        kind: 'cross-catalog-checkpoint-status',
        available: false,
        busy: false,
        recovery: null,
        catalogs: CATALOGS.map(catalog => ({ ...catalog })),
        disclosure: DISCLOSURE,
        reason: 'Cross-catalog checkpoint journal is unavailable; existing state was preserved.',
      };
    }
    try {
      const status = activeCoordinator.status();
      return {
        protocolVersion: 1,
        kind: 'cross-catalog-checkpoint-status',
        available: !closed && status?.available === true,
        busy: !closed && status?.busy === true,
        recovery: safeRecovery(status?.recovery),
        catalogs: CATALOGS.map(catalog => ({ ...catalog })),
        disclosure: DISCLOSURE,
      };
    } catch {
      return {
        protocolVersion: 1,
        kind: 'cross-catalog-checkpoint-status',
        available: false,
        busy: false,
        recovery: null,
        catalogs: CATALOGS.map(catalog => ({ ...catalog })),
        disclosure: DISCLOSURE,
        reason: 'Cross-catalog checkpoint status is unavailable; existing state was preserved.',
      };
    }
  }

  function memberData() {
    if (unavailableState || closed || !adapters.length) return { members: [], memberCount: 0, failed: false };
    let entries = [];
    try {
      for (const catalog of adapterEntries) if (catalog.ids) entries.push(...catalog.ids().map(individualId => ({
        individualId,
        catalogId: catalog.catalogId,
        catalogType: catalog.catalogType,
      })));
    } catch {
      return { members: [], memberCount: 0, failed: true };
    }
    const members = [];
    let failed = false;
    for (const participant of entries) {
      if (members.length >= CROSS_CATALOG_LIMITS.members) break;
      const catalog = adapterEntries.find(value => value.catalogId === participant.catalogId);
      try {
        const view = safeMember(catalog.adapter.member(participant.individualId), participant.catalogId, participant.catalogType);
        if (view) members.push(view);
        else failed = true;
      } catch {
        failed = true;
      }
    }
    return { members, memberCount: entries.length, failed };
  }

  function checkpointData() {
    if (unavailableState || closed || !activeCoordinator) return { checkpoints: [], failed: false };
    try {
      const values = activeCoordinator.jointCheckpoints();
      if (!Array.isArray(values)) return { checkpoints: [], failed: true };
      const checkpoints = values.slice(0, CROSS_CATALOG_LIMITS.jointHistory).map(safeCheckpoint).filter(Boolean);
      return { checkpoints, failed: checkpoints.length !== Math.min(values.length, CROSS_CATALOG_LIMITS.jointHistory) };
    } catch {
      return { checkpoints: [], failed: true };
    }
  }

  function snapshot(participants) {
    const values = new Map();
    for (const participant of participants) {
      const catalog = adapterEntries.find(value => value.catalogId === participant.catalogId);
      if (!catalog?.adapter) {
        values.set(keyOf(participant), undefined);
        continue;
      }
      try {
        values.set(keyOf(participant), safeMember(catalog.adapter.member(participant.individualId), participant.catalogId, participant.catalogType));
      } catch {
        values.set(keyOf(participant), undefined);
      }
    }
    return values;
  }

  function participantsFrom(values) {
    if (!Array.isArray(values)) return [];
    return values.filter(object).flatMap(value => {
      const individualId = text(value.individualId, 64);
      const catalogId = text(value.catalogId, 64);
      return individualId && catalogId && CATALOGS.some(catalog => catalog.catalogId === catalogId) ? [{ individualId, catalogId }] : [];
    });
  }

  function participantsFor(body) {
    const requested = participantsFrom(body?.members);
    if (requested.length) return requested;
    try {
      return participantsFrom(activeCoordinator?.status().recovery?.affectedHeads);
    } catch {
      return [];
    }
  }

  function resultParticipants(result) {
    return [
      ...participantsFrom(result?.payload?.members),
      ...participantsFrom(result?.members),
      ...participantsFrom(result?.affectedHeads),
    ];
  }

  function changed(before, after, participant) {
    const key = keyOf(participant);
    const prior = before.get(key);
    const current = after.get(key);
    if (prior === undefined || current === undefined) return prior !== current;
    if (prior === null || current === null) return prior !== current;
    return prior.head !== current.head || prior.sessionEpoch !== current.sessionEpoch || prior.status !== current.status || prior.mode !== current.mode;
  }

  function notifyLifecycle(ids) {
    for (const id of new Set(ids)) {
      try {
        const result = onLifecycle(id);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch {}
    }
  }

  async function operation(method, body) {
    required();
    const participants = participantsFor(body);
    const before = snapshot(participants);
    try {
      const result = await activeCoordinator[method](body);
      const confirmed = resultParticipants(result);
      const selected = [...new Map([...participants, ...confirmed].map(participant => [keyOf(participant), participant])).values()];
      const after = snapshot(selected);
      const confirmedKeys = new Set(confirmed.map(keyOf));
      notifyLifecycle(selected.filter(participant => confirmedKeys.has(keyOf(participant)) || changed(before, after, participant)).map(participant => participant.individualId));
      return result;
    } catch (error) {
      const after = snapshot(participants);
      notifyLifecycle(participants.filter(participant => changed(before, after, participant)).map(participant => participant.individualId));
      throw publicFailure(error);
    }
  }

  let closed = false;
  return {
    view() {
      const status = baseStatus();
      const members = memberData();
      const history = checkpointData();
      return {
        ...status,
        available: status.available && !members.failed && !history.failed,
        ...(!status.available || members.failed || history.failed ? {
          reason: members.failed || history.failed
            ? 'Cross-catalog checkpoint view is incomplete; existing state was preserved.'
            : status.reason,
        } : {}),
        memberCount: members.memberCount,
        members: members.members,
        checkpoints: history.checkpoints,
      };
    },
    status: baseStatus,
    checkpoints() {
      return checkpointData().checkpoints;
    },
    save: body => operation('save', body),
    restore: body => operation('restore', body),
    recover: body => operation('recover', body),
    reserved(individualId) {
      if (unavailableState || closed || !activeCoordinator) return false;
      try { return activeCoordinator.reserved(individualId) === true; } catch { return true; }
    },
    async close() {
      if (closed) return;
      closed = true;
      let failure = null;
      if (activeCoordinator) {
        try { await activeCoordinator.close(); } catch (error) { failure = error; }
      }
      if (activeJournal) {
        try { activeJournal.close(); } catch (error) { failure ??= error; }
      }
      if (failure) throw publicFailure(failure);
    },
  };
}
