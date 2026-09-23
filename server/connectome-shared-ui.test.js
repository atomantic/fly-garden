import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSavedCheckpoint, savedRestoreMemberIds } from '../client/src/connectome-shared-restore.js';

test('saved checkpoint restore contract loads complete membership and requests a paused shared session', async () => {
  const checkpoint = { jointCheckpointId: 'joint-1', payload: { members: [{ individualId: 'one' }, { individualId: 'two' }, { individualId: 'three' }] } };
  const states = new Map([
    ['one', { individualId: 'one', sessionEpoch: 'epoch-one', commandSequence: 2 }],
    ['two', { individualId: 'two', sessionEpoch: 'epoch-two', commandSequence: 3 }],
    ['three', { individualId: 'three', sessionEpoch: 'epoch-three', commandSequence: 4 }]
  ]);
  const calls = [];
  const result = await restoreSavedCheckpoint({
    checkpoint,
    loadState: async id => { calls.push(['load', id]); return states.get(id); },
    request: async (path, body) => { calls.push(['request', path, body]); return { shared: { status: 'paused', participants: savedRestoreMemberIds(checkpoint).map(individualId => ({ individualId })) } }; }
  });
  assert.deepEqual(calls.slice(0, 3), [['load', 'one'], ['load', 'two'], ['load', 'three']]);
  assert.equal(calls[3][1], '/api/connectomes/shared/restore');
  assert.deepEqual(calls[3][2], { protocolVersion: 1, jointCheckpointId: 'joint-1', members: [
    { protocolVersion: 1, individualId: 'one', sessionEpoch: 'epoch-one', commandSequence: 2 },
    { protocolVersion: 1, individualId: 'two', sessionEpoch: 'epoch-two', commandSequence: 3 },
    { protocolVersion: 1, individualId: 'three', sessionEpoch: 'epoch-three', commandSequence: 4 }
  ] });
  assert.equal(result.shared.status, 'paused');
});
