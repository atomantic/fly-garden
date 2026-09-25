export const CROSS_CATALOG_INTERVAL_MS = 5;
export const CROSS_CATALOG_MEMBER_LIMIT = 64;
export const CROSS_CATALOG_CHECKPOINT_LIMIT = 64;
export const CROSS_CATALOG_CATALOG_LIMIT = 8;

const STATUS_ERROR = 'Cross-catalog status is incompatible; current controls are disabled.';
const CHECKPOINT_ERROR = 'Cross-catalog checkpoint data is incompatible; current controls are disabled.';
const RECOVERY_ERROR = 'Cross-catalog recovery data is incompatible; recovery is disabled.';
const REQUEST_ERROR = 'Cross-catalog request data is invalid.';
const CATALOG_TYPES = new Set(['fixture-identity', 'full-connectome']);
const MEMBER_STATUSES = new Set(['paused', 'running', 'resting', 'fault', 'saved-unloaded', 'loading', 'unavailable', 'stopping', 'shared-joined', 'visitor-owned']);
const MODES = new Set(['active', 'resting']);
const OPERATIONS = new Set(['save', 'restore']);
const RECOVERY_STATES = new Set(['staged', 'committing', 'activating', 'recovery-required']);
const CATALOG_STATES = new Set(['staged', 'committed', 'failed', 'uncertain', 'reverting', 'reverted', 'cancelled']);
const MEMBER_KEYS = Object.freeze(['individualId', 'catalogType', 'catalogId', 'head', 'dataset', 'graphSha256', 'modelId', 'status', 'mode', 'sessionEpoch', 'simTimeMs']);
const CHECKPOINT_MEMBER_KEYS = Object.freeze(['individualId', 'catalogType', 'catalogId', 'dataset', 'graphSha256', 'modelId', 'checkpointId', 'checkpointSha256', 'simTimeMs', 'mode']);
const STATUS_REQUIRED_KEYS = Object.freeze(['protocolVersion', 'kind', 'available', 'busy', 'recovery', 'catalogs', 'disclosure', 'memberCount', 'members', 'checkpoints']);
const STATUS_OPTIONAL_KEYS = Object.freeze(['reason']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const permitted = (value, required, optional = []) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key)));
const token = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value);
const namespace = (value, max = 128) => token(value, max);
const text = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\\/\0]/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const date = value => uint(value) && value <= 8640000000000000;
const nullable = (value, predicate) => value === null || predicate(value);
const invalid = message => { throw new Error(message); };
const unique = (values, message) => { if (new Set(values).size !== values.length) invalid(message); };
const catalogTypeForId = catalogId => catalogId === 'fixture' ? 'fixture-identity' : catalogId.startsWith('connectome:') ? 'full-connectome' : null;

function readCatalog(value) {
  if (!exact(value, ['catalogId', 'catalogType']) || !token(value.catalogId, 64) || !CATALOG_TYPES.has(value.catalogType)) invalid(STATUS_ERROR);
  return value;
}

function readCatalogs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > CROSS_CATALOG_CATALOG_LIMIT) invalid(STATUS_ERROR);
  const catalogs = value.map(readCatalog);
  unique(catalogs.map(catalog => catalog.catalogId), STATUS_ERROR);
  return catalogs;
}

export function readCrossCatalogMember(value) {
  if (!exact(value, MEMBER_KEYS) || !token(value.individualId, 64) || !CATALOG_TYPES.has(value.catalogType)
    || !token(value.catalogId, 64) || !nullable(value.head, item => token(item, 64)) || !namespace(value.dataset)
    || !nullable(value.graphSha256, hash) || !nullable(value.modelId, item => token(item)) || !MEMBER_STATUSES.has(value.status)
    || !MODES.has(value.mode) || !token(value.sessionEpoch) || !uint(value.simTimeMs)) invalid(STATUS_ERROR);
  return value;
}

function readRecoveryCatalog(value) {
  if (!exact(value, ['catalogType', 'catalogId', 'catalogEpoch', 'state']) || !CATALOG_TYPES.has(value.catalogType)
    || !token(value.catalogId, 64) || !token(value.catalogEpoch) || !CATALOG_STATES.has(value.state)) invalid(RECOVERY_ERROR);
  return value;
}

function readAffectedHead(value) {
  if (!exact(value, ['individualId', 'catalogType', 'catalogId', 'priorHead', 'plannedHead', 'selectedHead'])
    || !token(value.individualId, 64) || !CATALOG_TYPES.has(value.catalogType) || !token(value.catalogId, 64)
    || !nullable(value.priorHead, item => token(item, 64)) || !nullable(value.plannedHead, item => token(item, 64))
    || !nullable(value.selectedHead, item => token(item, 64))) invalid(RECOVERY_ERROR);
  return value;
}

export function readCrossCatalogRecovery(value) {
  if (value === null) return null;
  if (!exact(value, ['transactionId', 'operation', 'state', 'reason', 'catalogs', 'affectedHeads', 'journalReopenRequired'])
    || !token(value.transactionId, 64) || !OPERATIONS.has(value.operation) || !RECOVERY_STATES.has(value.state)
    || !nullable(value.reason, item => text(item)) || !Array.isArray(value.catalogs) || value.catalogs.length < 1
    || value.catalogs.length > CROSS_CATALOG_CATALOG_LIMIT || !Array.isArray(value.affectedHeads)
    || value.affectedHeads.length < 2 || value.affectedHeads.length > CROSS_CATALOG_MEMBER_LIMIT
    || typeof value.journalReopenRequired !== 'boolean') invalid(RECOVERY_ERROR);
  const catalogs = value.catalogs.map(readRecoveryCatalog);
  const affectedHeads = value.affectedHeads.map(readAffectedHead);
  unique(catalogs.map(catalog => catalog.catalogId), RECOVERY_ERROR);
  unique(affectedHeads.map(head => head.individualId), RECOVERY_ERROR);
  for (const head of affectedHeads) {
    const catalog = catalogs.find(item => item.catalogId === head.catalogId);
    if (!catalog || catalog.catalogType !== head.catalogType) invalid(RECOVERY_ERROR);
  }
  return value;
}

function readCheckpointMember(value) {
  if (!exact(value, CHECKPOINT_MEMBER_KEYS) || !token(value.individualId, 64) || !CATALOG_TYPES.has(value.catalogType)
    || !token(value.catalogId, 64) || !namespace(value.dataset) || !nullable(value.graphSha256, hash)
    || !nullable(value.modelId, item => token(item)) || !token(value.checkpointId, 64) || !hash(value.checkpointSha256)
    || !uint(value.simTimeMs) || !MODES.has(value.mode)) invalid(CHECKPOINT_ERROR);
  return value;
}

export function readCrossCatalogCheckpoint(value) {
  if (!exact(value, ['jointCheckpointId', 'createdAt', 'payload', 'sha256']) || !token(value.jointCheckpointId, 64)
    || !date(value.createdAt) || !exact(value.payload, ['version', 'kind', 'intervalMs', 'tick', 'members'])
    || value.payload.version !== 1 || value.payload.kind !== 'cross-catalog-joint' || value.payload.intervalMs !== CROSS_CATALOG_INTERVAL_MS
    || !uint(value.payload.tick) || !Array.isArray(value.payload.members) || value.payload.members.length < 2
    || value.payload.members.length > CROSS_CATALOG_MEMBER_LIMIT || !hash(value.sha256)) invalid(CHECKPOINT_ERROR);
  const members = value.payload.members.map(readCheckpointMember);
  unique(members.map(member => member.individualId), CHECKPOINT_ERROR);
  unique(members.map(member => member.checkpointId), CHECKPOINT_ERROR);
  return value;
}

export function readCrossCatalogCheckpoints(value) {
  if (!exact(value, ['checkpoints']) || !Array.isArray(value.checkpoints) || value.checkpoints.length > CROSS_CATALOG_CHECKPOINT_LIMIT) invalid(CHECKPOINT_ERROR);
  const checkpoints = value.checkpoints.map(readCrossCatalogCheckpoint);
  unique(checkpoints.map(checkpoint => checkpoint.jointCheckpointId), CHECKPOINT_ERROR);
  return value;
}

export function readCrossCatalogStatus(value) {
  if (!permitted(value, STATUS_REQUIRED_KEYS, STATUS_OPTIONAL_KEYS) || value.protocolVersion !== 1
    || value.kind !== 'cross-catalog-checkpoint-status' || typeof value.available !== 'boolean' || typeof value.busy !== 'boolean'
    || !text(value.disclosure) || !uint(value.memberCount) || !Array.isArray(value.members)
    || value.members.length > CROSS_CATALOG_MEMBER_LIMIT || !Array.isArray(value.checkpoints)
    || value.checkpoints.length > CROSS_CATALOG_CHECKPOINT_LIMIT || Object.hasOwn(value, 'reason') && !text(value.reason)) invalid(STATUS_ERROR);
  const catalogs = readCatalogs(value.catalogs);
  const recovery = readCrossCatalogRecovery(value.recovery);
  if (recovery === null && value.recovery !== null) invalid(STATUS_ERROR);
  const catalogById = new Map(catalogs.map(catalog => [catalog.catalogId, catalog]));
  const members = value.members.map(readCrossCatalogMember);
  if (value.memberCount < members.length) invalid(STATUS_ERROR);
  unique(members.map(member => member.individualId), STATUS_ERROR);
  for (const member of members) {
    const catalog = catalogById.get(member.catalogId);
    if (!catalog || catalog.catalogType !== member.catalogType) invalid(STATUS_ERROR);
  }
  const checkpoints = value.checkpoints.map(readCrossCatalogCheckpoint);
  unique(checkpoints.map(checkpoint => checkpoint.jointCheckpointId), STATUS_ERROR);
  return value;
}

export const readCrossCatalogView = readCrossCatalogStatus;

function saveMembers(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > CROSS_CATALOG_MEMBER_LIMIT) invalid(REQUEST_ERROR);
  const projected = value.map(member => {
    if (exact(member, ['individualId', 'catalogId'])) {
      if (!token(member.individualId, 64) || !token(member.catalogId, 64)) invalid(REQUEST_ERROR);
      const catalogType = catalogTypeForId(member.catalogId);
      if (!catalogType) invalid(REQUEST_ERROR);
      return { individualId: member.individualId, catalogId: member.catalogId, catalogType };
    }
    const current = readCrossCatalogMember(member);
    if (current.status !== 'paused') invalid(REQUEST_ERROR);
    return { individualId: current.individualId, catalogId: current.catalogId, catalogType: current.catalogType };
  });
  unique(projected.map(member => member.individualId), REQUEST_ERROR);
  unique(projected.map(member => `${member.catalogId}:${member.individualId}`), REQUEST_ERROR);
  if (!projected.some(member => member.catalogType === 'fixture-identity') || !projected.some(member => member.catalogType === 'full-connectome')) invalid(REQUEST_ERROR);
  return projected.map(({ individualId, catalogId }) => ({ individualId, catalogId }));
}

export function crossCatalogSaveBody(tick, members) {
  if (!uint(tick)) invalid(REQUEST_ERROR);
  return { protocolVersion: 1, intervalMs: CROSS_CATALOG_INTERVAL_MS, tick, members: saveMembers(members) };
}

export function crossCatalogRestoreBody(checkpoint) {
  const saved = readCrossCatalogCheckpoint(checkpoint);
  return {
    protocolVersion: 1,
    jointCheckpointId: saved.jointCheckpointId,
    members: saved.payload.members.map(({ individualId, catalogId }) => ({ individualId, catalogId })),
  };
}

export function crossCatalogRecoveryBody(recovery, action) {
  const current = readCrossCatalogRecovery(recovery);
  if (current === null || !['rollback', 'complete'].includes(action)) invalid(REQUEST_ERROR);
  return { protocolVersion: 1, transactionId: current.transactionId, action };
}

export function currentCrossCatalogRequest(request, current) {
  return object(request) && object(current) && uint(request.generation) && uint(current.generation)
    && request.generation === current.generation;
}
