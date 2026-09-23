const checkpointMembers = checkpoint => {
  const members = checkpoint?.payload?.members;
  if (!Array.isArray(members) || members.length < 2) throw new Error('Saved joint checkpoint membership is unavailable.');
  const ids = members.map(member => member?.individualId);
  if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('Saved joint checkpoint membership is invalid.');
  return ids;
};

export const savedRestoreMemberIds = checkpoint => checkpointMembers(checkpoint);

export function jointRestoreBody(jointCheckpointId, states) {
  if (typeof jointCheckpointId !== 'string' || !jointCheckpointId || !Array.isArray(states) || states.length < 2) throw new Error('Saved joint checkpoint membership is unavailable.');
  const ids = states.map(state => state?.individualId);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Saved joint checkpoint membership is invalid.');
  return { protocolVersion: 1, jointCheckpointId, members: states.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence })) };
}

export async function restoreSavedCheckpoint({ request, checkpoint, loadState }) {
  if (typeof request !== 'function' || typeof loadState !== 'function') throw new Error('Saved joint checkpoint restore is unavailable.');
  const ids = checkpointMembers(checkpoint);
  const states = await Promise.all(ids.map(id => loadState(id)));
  return request('/api/connectomes/shared/restore', jointRestoreBody(checkpoint.jointCheckpointId, states));
}
