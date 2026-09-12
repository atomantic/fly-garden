/** Refuse legacy/unidentified runtimes before enabling any scoped control. */
export function readRuntimeSnapshot(value) {
  if (!value || typeof value !== 'object' || value.protocolVersion !== 1
    || typeof value.individualId !== 'string' || !value.individualId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !Number.isSafeInteger(value.commandSequence) || value.commandSequence < 0
    || !Number.isSafeInteger(value.tick) || value.tick < 0
    || !value.neural || !Array.isArray(value.neural.neurons) || !Number.isFinite(value.neural.meanRateHz)) {
    const error = new Error('Backend version mismatch. Restart Fly Garden, then reload this page. No simulation was started.');
    error.code = 'RUNTIME_PROTOCOL_MISMATCH';
    throw error;
  }
  return value;
}

/** An empty initial selection cannot compare as the same unidentified session. */
export function mergeRuntimeSnapshot(previous, next) {
  return previous && previous.individualId === next.individualId && previous.sessionId === next.sessionId
    && (previous.tick > next.tick || previous.commandSequence > next.commandSequence) ? previous : next;
}
