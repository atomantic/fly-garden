export function readSharedCapture(value, id) {
  if (!value || value.protocolVersion !== 1 || value.sharedId !== id || !Number.isSafeInteger(value.captureSequence) || value.captureSequence < 0
    || !Number.isSafeInteger(value.actionCount) || value.actionCount < 0 || value.actionCount > 1024
    || typeof value.active !== 'boolean' || typeof value.partial !== 'boolean'
    || !Array.isArray(value.participantIds) || value.participantIds.length > 2
    || value.participantIds.some(id => typeof id !== 'string')
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
