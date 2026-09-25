import test from 'node:test';
import assert from 'node:assert/strict';
import {
  crossCatalogRecoveryBody,
  crossCatalogRestoreBody,
  crossCatalogSaveBody,
  currentCrossCatalogRequest,
  readCrossCatalogCheckpoints,
  readCrossCatalogRecovery,
  readCrossCatalogStatus,
} from '../client/src/cross-catalog-state.js';

const identifier = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const head = value => identifier(value + 1000);
const hash = value => value.repeat(64);
const fixtureMember = {
  individualId: identifier(1),
  catalogType: 'fixture-identity',
  catalogId: 'fixture',
  head: head(1),
  dataset: 'synthetic-fixture:v1',
  graphSha256: null,
  modelId: null,
  status: 'paused',
  mode: 'resting',
  sessionEpoch: 'epoch-fixture',
  simTimeMs: 15,
};
const connectomeMember = {
  individualId: identifier(2),
  catalogType: 'full-connectome',
  catalogId: 'connectome:male',
  head: head(2),
  dataset: 'male-cns:v1.0',
  graphSha256: hash('a'),
  modelId: 'malecns-traced-lif-v1',
  status: 'paused',
  mode: 'active',
  sessionEpoch: 'epoch-connectome',
  simTimeMs: 20,
};
const checkpointMember = (member, value) => ({
  individualId: member.individualId,
  catalogType: member.catalogType,
  catalogId: member.catalogId,
  dataset: member.dataset,
  graphSha256: member.graphSha256,
  modelId: member.modelId,
  checkpointId: head(value),
  checkpointSha256: hash(String(value % 10)),
  simTimeMs: member.simTimeMs,
  mode: member.mode,
});
const checkpoint = {
  jointCheckpointId: identifier(20),
  createdAt: 1,
  payload: {
    version: 1,
    kind: 'cross-catalog-joint',
    intervalMs: 5,
    tick: 7,
    members: [checkpointMember(fixtureMember, 3), checkpointMember(connectomeMember, 4)],
  },
  sha256: hash('b'),
};
const status = {
  protocolVersion: 1,
  kind: 'cross-catalog-checkpoint-status',
  available: true,
  busy: false,
  recovery: null,
  catalogs: [
    { catalogId: 'fixture', catalogType: 'fixture-identity' },
    { catalogId: 'connectome:male', catalogType: 'full-connectome' },
  ],
  disclosure: 'Cross-catalog research checkpoint transaction. It coordinates durable heads and paused runtime restoration only; it is not embodied, sensory, learned or biological behavior.',
  memberCount: 2,
  members: [fixtureMember, connectomeMember],
  checkpoints: [checkpoint],
};
const recovery = {
  transactionId: identifier(30),
  operation: 'restore',
  state: 'recovery-required',
  reason: 'Explicit operator recovery is required.',
  catalogs: [
    { catalogType: 'fixture-identity', catalogId: 'fixture', catalogEpoch: hash('c'), state: 'committed' },
    { catalogType: 'full-connectome', catalogId: 'connectome:male', catalogEpoch: hash('d'), state: 'uncertain' },
  ],
  affectedHeads: [
    { individualId: fixtureMember.individualId, catalogType: 'fixture-identity', catalogId: 'fixture', priorHead: head(1), plannedHead: head(3), selectedHead: head(3) },
    { individualId: connectomeMember.individualId, catalogType: 'full-connectome', catalogId: 'connectome:male', priorHead: head(2), plannedHead: head(4), selectedHead: head(2) },
  ],
  journalReopenRequired: false,
};

test('validates the complete bounded safe status, checkpoint and recovery views', () => {
  assert.equal(readCrossCatalogStatus(status), status);
  assert.deepEqual(readCrossCatalogCheckpoints({ checkpoints: [checkpoint] }).checkpoints, [checkpoint]);
  assert.equal(readCrossCatalogStatus({ ...status, recovery }).recovery, recovery);
  assert.equal(readCrossCatalogRecovery(recovery), recovery);
  assert.equal(readCrossCatalogRecovery(null), null);
});

test('rejects private fields, unsafe namespaces, statuses, modes and oversized collections', () => {
  for (const mutate of [
    value => { value.directory = '/private/catalog'; },
    value => { value.members[0].checkpointPayload = {}; },
    value => { value.checkpoints[0].journalPath = '/private/journal'; },
    value => { value.members[0].catalogId = '../private'; },
    value => { value.members[0].status = 'private-status'; },
    value => { value.members[0].mode = 'running'; },
  ]) {
    const value = structuredClone(status);
    mutate(value);
    assert.throws(() => readCrossCatalogStatus(value), /incompatible/);
  }
  const privateRecovery = structuredClone(recovery);
  privateRecovery.affectedHeads[0].cause = '/private/cause';
  assert.throws(() => readCrossCatalogStatus({ ...status, recovery: privateRecovery }), /incompatible/);
  const members = Array.from({ length: 65 }, (_, index) => ({ ...fixtureMember, individualId: identifier(index + 40), head: head(index + 40) }));
  assert.throws(() => readCrossCatalogStatus({ ...status, memberCount: 65, members }), /incompatible/);
  const checkpoints = Array.from({ length: 65 }, (_, index) => ({ ...checkpoint, jointCheckpointId: identifier(index + 200) }));
  assert.throws(() => readCrossCatalogCheckpoints({ checkpoints }), /incompatible/);
  assert.throws(() => readCrossCatalogCheckpoints({ checkpoints, directory: '/private' }), /incompatible/);
});

test('builds exact fixed-interval save envelopes only for paused mixed membership', () => {
  const members = [fixtureMember, connectomeMember];
  const body = crossCatalogSaveBody(9, members);
  assert.deepEqual(body, {
    protocolVersion: 1,
    intervalMs: 5,
    tick: 9,
    members: [
      { individualId: fixtureMember.individualId, catalogId: 'fixture' },
      { individualId: connectomeMember.individualId, catalogId: 'connectome:male' },
    ],
  });
  assert.equal(Object.hasOwn(body.members[0], 'status'), false);
  assert.equal(Object.hasOwn(body.members[0], 'head'), false);
  for (const tick of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) assert.throws(() => crossCatalogSaveBody(tick, members), /invalid/);
  const secondFixture = { ...fixtureMember, individualId: identifier(5), head: head(5) };
  assert.throws(() => crossCatalogSaveBody(0, [fixtureMember, secondFixture]), /invalid/);
  assert.throws(() => crossCatalogSaveBody(0, [fixtureMember, { ...connectomeMember, status: 'running' }]), /incompatible|invalid/);
  assert.throws(() => crossCatalogSaveBody(0, [fixtureMember, { ...connectomeMember, individualId: fixtureMember.individualId }]), /incompatible|invalid/);
  assert.throws(() => crossCatalogSaveBody(0, [fixtureMember]), /invalid/);
  const tooMany = Array.from({ length: 65 }, (_, index) => ({ ...fixtureMember, individualId: identifier(index + 300), head: head(index + 300) }));
  assert.throws(() => crossCatalogSaveBody(0, tooMany), /invalid/);
});

test('restore and recovery requests use exact saved or reported identities and actions', () => {
  assert.deepEqual(crossCatalogRestoreBody(checkpoint), {
    protocolVersion: 1,
    jointCheckpointId: checkpoint.jointCheckpointId,
    members: [
      { individualId: fixtureMember.individualId, catalogId: 'fixture' },
      { individualId: connectomeMember.individualId, catalogId: 'connectome:male' },
    ],
  });
  assert.deepEqual(crossCatalogRecoveryBody(recovery, 'rollback'), {
    protocolVersion: 1,
    transactionId: recovery.transactionId,
    action: 'rollback',
  });
  assert.deepEqual(crossCatalogRecoveryBody(recovery, 'complete'), {
    protocolVersion: 1,
    transactionId: recovery.transactionId,
    action: 'complete',
  });
  assert.throws(() => crossCatalogRestoreBody({ ...checkpoint, members: [] }), /incompatible/);
  assert.throws(() => crossCatalogRecoveryBody(recovery, 'retry'), /invalid/);
  assert.equal(currentCrossCatalogRequest({ generation: 4 }, { generation: 4 }), true);
  assert.equal(currentCrossCatalogRequest({ generation: 4 }, { generation: 5 }), false);
});
