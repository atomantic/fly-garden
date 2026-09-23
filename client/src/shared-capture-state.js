import { SHARED_ACTION_TRACE } from '../../shared/shared-action-trace.js';

const boundaryShape = value => value === null || (!!value && typeof value.cause === 'string' && typeof value.worldEpoch === 'string'
  && Number.isSafeInteger(value.tick) && value.tick >= 0);
const participantShape = value => !!value && typeof value.individualId === 'string' && Object.hasOwn(SHARED_ACTION_TRACE.derivations, value.sourceType)
  && value.derivation === SHARED_ACTION_TRACE.derivations[value.sourceType] && typeof value.dataset?.namespace === 'string'
  && typeof value.modelVersion === 'string' && (value.checkpointId === null || typeof value.checkpointId === 'string');
export function readSharedCapture(value, id) {
  if (!value || value.protocolVersion !== 1 || value.traceVersion !== SHARED_ACTION_TRACE.version || value.sharedId !== id
    || !Number.isSafeInteger(value.captureSequence) || value.captureSequence < 0
    || !Number.isSafeInteger(value.actionCount) || value.actionCount < 0 || value.actionCount > 1024
    || typeof value.active !== 'boolean' || typeof value.partial !== 'boolean' || !boundaryShape(value.boundary)
    || !Array.isArray(value.participantIds) || value.participantIds.length > SHARED_ACTION_TRACE.maxParticipants
    || value.participantIds.some(id => typeof id !== 'string')
    || !Array.isArray(value.participants) || value.participants.length !== value.participantIds.length
    || value.participants.some((p, i) => !participantShape(p) || p.individualId !== value.participantIds[i])
    || !(value.humanContributionId === null || typeof value.humanContributionId === 'string')
    || !(value.captureId === null || typeof value.captureId === 'string')
    || !(value.worldEpoch === null || typeof value.worldEpoch === 'string')) throw new Error('Shared capture response does not match this source.');
  return value;
}
export function newestSharedCapture(previous, next) {
  if (!previous || !next || previous.sharedId !== next.sharedId) return next;
  if (previous.captureSequence > next.captureSequence) return previous;
  if (previous.captureSequence === next.captureSequence && previous.captureId === next.captureId
    && (previous.actionCount > next.actionCount || !previous.active && next.active || previous.partial && !next.partial)) return previous;
  return next;
}
