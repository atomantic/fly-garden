/** Versioned shared action-trace contract (version 1).
 *
 * A trace batch declares exactly one already-committed action per recipient at one world tick.
 * It carries attribution and provenance only: stable individual/session/world IDs, the world
 * epoch and tick, the source type, dataset/model namespace, checkpoint lineage, the declaring
 * adapter, an action kind and a source action ID. It never carries neural state, weights,
 * motor currents, retinal input, hidden targets, private paths or credentials, and it has no
 * authority to start, advance, reward or otherwise control a participant.
 *
 * Fixture recipients are `movement-derived` from the engineered shared fixture controller.
 * Research (`connectome`) recipients may appear only when a separately declared adapter
 * supplies the trace (`declared-adapter-derived`); this contract never infers a motor stream. */
import { SHARED_LIMITS } from './population-limits.js';

export const SHARED_ACTION_TRACE = Object.freeze({
  version: 1,
  maxParticipants: SHARED_LIMITS.maxMembers,
  derivations: Object.freeze({ fixture: 'movement-derived', connectome: 'declared-adapter-derived' }),
  actionKinds: Object.freeze(['move', 'rest']),
});
const provenanceKeys = ['individualId', 'sessionId', 'sourceType', 'derivation', 'adapterVersion', 'dataset', 'modelVersion', 'checkpointLineage'];
const batchKeys = ['traceVersion', 'sharedId', 'worldEpoch', 'tick', 'worldTimeMs', 'wallTimeMs', 'actions'];
const actionKeys = [...provenanceKeys, 'sharedId', 'worldEpoch', 'tick', 'actionKind', 'sourceActionId', 'simTimeMs', 'position'];
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const text = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key])));
const invalid = message => { throw new Error(`Invalid shared action trace: ${message}.`); };

/** Validate one participant's declared provenance. Returns a detached copy. */
export function validateTraceProvenance(value) {
  if (!exact(value, provenanceKeys)) invalid('provenance fields');
  const expected = SHARED_ACTION_TRACE.derivations[value.sourceType];
  if (!Object.hasOwn(SHARED_ACTION_TRACE.derivations, value.sourceType) || value.derivation !== expected) invalid('source type or derivation');
  if (![value.individualId, value.sessionId, value.adapterVersion, value.modelVersion].every(text)) invalid('identity or version');
  if (!exact(value.dataset, ['namespace', 'release', 'modelId']) || !Object.values(value.dataset).every(text)) invalid('dataset namespace');
  const lineage = value.checkpointLineage;
  if (!exact(lineage, ['checkpointId', 'branchOf']) || !(lineage.checkpointId === null || text(lineage.checkpointId))
    || !(lineage.branchOf === null || (exact(lineage.branchOf, ['individualId', 'checkpointId']) && text(lineage.branchOf.individualId)
      && text(lineage.branchOf.checkpointId)))) invalid('checkpoint lineage');
  return structuredClone(value);
}

/** True when an action declares exactly the provenance fixed for its individual at capture start. */
export function sameTraceProvenance(action, provenance) {
  return provenanceKeys.every(key => same(action[key], provenance[key]));
}

/** Validate a complete-batch envelope. Recipient completeness is checked by the consumer,
 * which alone knows the expected membership. Returns a detached copy. */
export function validateActionBatch(batch) {
  if (!exact(batch, batchKeys) || batch.traceVersion !== SHARED_ACTION_TRACE.version || ![batch.sharedId, batch.worldEpoch].every(text)
    || ![batch.tick, batch.worldTimeMs, batch.wallTimeMs].every(time) || batch.tick < 1 || !Array.isArray(batch.actions)
    || batch.actions.length < 1 || batch.actions.length > SHARED_ACTION_TRACE.maxParticipants) invalid('batch envelope');
  const individuals = new Set(), sourceActions = new Set();
  for (const action of batch.actions) {
    if (!exact(action, actionKeys)) invalid('action fields');
    validateTraceProvenance(Object.fromEntries(provenanceKeys.map(key => [key, action[key]])));
    if (action.sharedId !== batch.sharedId || action.worldEpoch !== batch.worldEpoch || action.tick !== batch.tick) invalid('world, epoch or tick');
    if (!SHARED_ACTION_TRACE.actionKinds.includes(action.actionKind) || !text(action.sourceActionId) || !time(action.simTimeMs)) invalid('action');
    if (!exact(action.position, ['x', 'y']) || ![action.position.x, action.position.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) invalid('position');
    if (individuals.has(action.individualId) || sourceActions.has(action.sourceActionId)) invalid('duplicate recipient or source action');
    individuals.add(action.individualId); sourceActions.add(action.sourceActionId);
  }
  return structuredClone(batch);
}
