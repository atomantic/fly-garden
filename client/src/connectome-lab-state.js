export const DATASETS = ['male-cns:v1.0', 'banc:v888'];
const uint = value => Number.isSafeInteger(value) && value >= 0;
export function readConnectomeState(value) {
  if (!value || value.protocolVersion !== 1 || value.source !== 'connectome' || !DATASETS.includes(value.dataset)
    || typeof value.individualId !== 'string' || !value.individualId || typeof value.sessionEpoch !== 'string' || !value.sessionEpoch
    || !uint(value.commandSequence) || typeof value.resident !== 'boolean'
    || !['saved-unloaded','loading','paused','running','resting','fault','unavailable','stopping'].includes(value.status)
    || (value.neural !== null && (!value.neural || !['tick','simTimeMs','spikes','totalSpikes','traversedEdges'].every(key => uint(value.neural[key]))
      || !['minimum','maximum'].every(key => Number.isFinite(value.neural[key]))))) throw new Error('Connectome metadata is incompatible. Refresh the current backend before controlling it.');
  return value;
}
export function currentLabRequest(request, current) {
  return request.generation === current.generation && request.individualId === current.individualId
    && (request.sessionEpoch === null || request.sessionEpoch === current.sessionEpoch);
}
export function mergeConnectomeState(previous, next) {
  if (previous?.individualId === next.individualId && previous.sessionEpoch === next.sessionEpoch
    && (previous.commandSequence > next.commandSequence || (previous.neural?.tick ?? 0) > (next.neural?.tick ?? 0))) return previous;
  return next;
}
export function labCommand(state, action, steps, checkpointId) {
  if (action === 'advance' && (!Number.isInteger(steps) || steps < 1 || steps > 1000)) throw new Error('Choose 1–1000 one-millisecond steps.');
  return {protocolVersion:1,individualId:state.individualId,sessionEpoch:state.sessionEpoch,commandSequence:state.commandSequence,
    action,steps:action==='advance'?steps:null,checkpointId:action==='restore'?checkpointId:null};
}

export function readConnectomeHistory(value, id) {
  if (!value || value.individualId !== id || !Array.isArray(value.checkpoints) || value.checkpoints.length > 64
    || value.checkpoints.some(item => !item || typeof item.checkpointId !== 'string' || !item.checkpointId
      || !uint(item.tick) || !uint(item.createdAt) || item.createdAt > 8640000000000000
      || !uint(item.bytes) || item.bytes < 1 || typeof item.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.operation !== 'string'
      || ![item.parentId, item.restoredFrom].every(source => source === null || typeof source === 'string')))
    throw new Error('Checkpoint history does not match the selected individual.');
  return value.checkpoints;
}

export function readLabCommandReply(previous, next, action) {
  readConnectomeState(next);
  if (next.individualId !== previous.individualId || next.dataset !== previous.dataset
    || (!['load','restore','unload'].includes(action) && next.sessionEpoch !== previous.sessionEpoch))
    throw new Error('Command response does not match the selected individual and worker session.');
  return next;
}

/** Publish the ID and its validated catalog dataset in one parent update. */
export function selectConnectomePair(current, individualId, dataset = current.dataset) {
  if (typeof individualId !== 'string' || !DATASETS.includes(dataset)) throw new Error('Invalid connectome selection source.');
  return {individualId,dataset};
}
/** A delayed metadata effect cannot replace another selected source or dataset. */
export function mergeConnectomeSelection(current, snapshot) {
  if (!snapshot || snapshot.individualId !== current.individualId || snapshot.dataset !== current.dataset) return current;
  return {individualId:snapshot.individualId,dataset:snapshot.dataset};
}
