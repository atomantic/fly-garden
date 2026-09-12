import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeSessions } from './creative-session.js';
const state = (id = 'a') => ({ status: 'running', individualId: id, sessionId: `session-${id}`, model: { id: 'fixture' }, persistence: { checkpointId: 'checkpoint' },
  environmentAdapter: { attached: true, environmentEpoch: 'epoch', pose: { x: 0, z: 0, yaw: 0 }, lastReceivedAtMs: 1000, lastTrace: null } });
test('capture only retains accepted recipient movement and exported source reproduces deterministically', () => {
  const sessions = createCreativeSessions(), a = state(), b = state('b');
  sessions.start(a);
  a.environmentAdapter.pose.x = .1;
  a.environmentAdapter.lastTrace = { individualId: 'a', sessionId: 'session-a', environmentEpoch: 'epoch', frameId: 1, outputSimTimeMs: 5 };
  sessions.capture(b); sessions.capture(a); sessions.capture(a);
  assert.equal(sessions.status('a').actionCount, 1);
  assert.equal(sessions.status('a').eventCount, 1);
  assert.equal(sessions.status('b'), null);
  sessions.stop('a');
  assert.deepEqual(sessions.export('a', 'png'), sessions.export('a', 'png'));
  const source = JSON.parse(sessions.export('a', 'json').bytes).source;
  assert.equal(source.actions[0].individualId, 'a');
  assert.equal(source.actions[0].from.x, .5);
  assert.throws(() => sessions.start(a), /previous capture/);
  sessions.discard('a'); assert.equal(sessions.status('a'), null);
});
test('source transition stops partial capture without altering the individual', () => {
  const sessions = createCreativeSessions(), a = state(); sessions.start(a);
  a.sessionId = 'new-session'; const before = structuredClone(a); sessions.capture(a);
  assert.equal(sessions.status('a').partial, true);
  assert.equal(sessions.status('a').active, false);
  assert.deepEqual(a, before);
});

test('active exports carry partial provenance and invalid source cannot poison prior capture', () => {
  const sessions = createCreativeSessions(), a = state(); sessions.start(a);
  assert.equal(sessions.export('a', 'json').partial, true);
  assert.equal(JSON.parse(sessions.export('a', 'json').bytes).source.capture.complete, false);
  for (const format of ['json','mid','svg','png']) assert.ok(sessions.export('a', format).bytes.includes(Buffer.from('"complete":false')));
  a.environmentAdapter.lastTrace = { individualId: 'wrong', frameId: 1, outputSimTimeMs: 5 };
  sessions.capture(a);
  assert.equal(sessions.status('a').actionCount, 0);
  assert.equal(sessions.status('a').partial, true);
});
