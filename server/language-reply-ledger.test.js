import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginLanguageRequest, emptyLanguageLedger, languageRosterStatus, pendingLanguageRequest, settleLanguageRequest, settledLanguageReply,
} from '../client/src/language-reply-ledger.js';
import { sessionKey } from '../client/src/runtime-state.js';

const A = { individualId: 'fly-a', sessionId: 'session-a' }, B = { individualId: 'fly-b', sessionId: 'session-b' };
const request = (fly, requestId) => ({ key: sessionKey(fly.individualId, fly.sessionId), ...fly, requestId });
const reply = (fly, requestId) => ({ ok: true, result: { status: 'complete', interpretation: `text for ${fly.individualId}`, requestId } });

test('a reply is readable only under its own fly and session key, never another fly\'s', () => {
  const a = request(A, 'req-1'), bKey = sessionKey(B.individualId, B.sessionId);
  let ledger = beginLanguageRequest(emptyLanguageLedger, a, 10);
  assert.equal(pendingLanguageRequest(ledger, a.key).requestId, 'req-1');
  assert.equal(pendingLanguageRequest(ledger, bKey), null);
  // A restored session of the same individual is a different recipient.
  assert.equal(pendingLanguageRequest(ledger, sessionKey(A.individualId, 'restored')), null);
  assert.equal(languageRosterStatus(ledger, 'fly-a'), 'pending');
  assert.equal(languageRosterStatus(ledger, 'fly-b'), null);

  ledger = settleLanguageRequest(ledger, a, reply(A, 'req-1'), 20);
  assert.equal(pendingLanguageRequest(ledger, a.key), null);
  const settled = settledLanguageReply(ledger, a.key);
  assert.equal(settled.outcome.result.interpretation, 'text for fly-a');
  assert.equal(settled.settledAt, 20);
  assert.equal(settledLanguageReply(ledger, bKey), null, 'B\'s panel can never pick A\'s reply up');
  assert.equal(settledLanguageReply(ledger, sessionKey(A.individualId, 'restored')), null);
  assert.equal(languageRosterStatus(ledger, 'fly-a'), 'received');
});

test('two flies keep independent entries; settling one leaves the other pending', () => {
  const a = request(A, 'req-a'), b = request(B, 'req-b');
  let ledger = beginLanguageRequest(beginLanguageRequest(emptyLanguageLedger, a, 1), b, 2);
  ledger = settleLanguageRequest(ledger, b, reply(B, 'req-b'), 3);
  assert.equal(languageRosterStatus(ledger, 'fly-a'), 'pending');
  assert.equal(languageRosterStatus(ledger, 'fly-b'), 'received');
  assert.equal(settledLanguageReply(ledger, b.key).outcome.result.interpretation, 'text for fly-b');
  assert.equal(settledLanguageReply(ledger, a.key), null);
  assert.equal(pendingLanguageRequest(ledger, a.key).requestId, 'req-a');
});

test('a stale or superseded settle is dropped, and a failed reply is recorded as a failure for its own fly', () => {
  const first = request(A, 'req-1'), second = request(A, 'req-2');
  let ledger = beginLanguageRequest(emptyLanguageLedger, first, 1);
  ledger = beginLanguageRequest(ledger, second, 2);
  // The first request's late result cannot settle the second.
  assert.equal(settleLanguageRequest(ledger, first, reply(A, 'req-1'), 3), ledger);
  assert.equal(pendingLanguageRequest(ledger, second.key).requestId, 'req-2');
  ledger = settleLanguageRequest(ledger, second, { ok: false, error: 'Language request refused' }, 4);
  assert.deepEqual(settledLanguageReply(ledger, second.key).outcome, { ok: false, error: 'Language request refused' });
  assert.equal(languageRosterStatus(ledger, 'fly-a'), 'failed');
  // Settling twice, or with a malformed outcome, changes nothing further.
  assert.equal(settleLanguageRequest(ledger, second, reply(A, 'req-2'), 5), ledger);
  const noError = settleLanguageRequest(beginLanguageRequest(emptyLanguageLedger, first, 1), first, {}, 2);
  assert.equal(settledLanguageReply(noError, first.key).outcome.error, 'Language reply unavailable.');
});

test('malformed requests never enter the ledger', () => {
  for (const bad of [null, {}, { key: 'x', individualId: 'a', sessionId: 's', requestId: 'r' },
    { key: 'a/s', individualId: 'a', sessionId: 's', requestId: '' }, { key: 'a/s', individualId: 'a', sessionId: 's' }]) {
    assert.equal(beginLanguageRequest(emptyLanguageLedger, bad), emptyLanguageLedger, JSON.stringify(bad));
  }
  assert.deepEqual(Object.keys(emptyLanguageLedger.entries), []);
});

test('the roster word follows the most recent request of an individual across its sessions', () => {
  const old = request(A, 'old'), restored = request({ individualId: 'fly-a', sessionId: 'restored' }, 'new');
  let ledger = beginLanguageRequest(emptyLanguageLedger, old, 1);
  ledger = settleLanguageRequest(ledger, old, reply(A, 'old'), 2);
  ledger = beginLanguageRequest(ledger, restored, 3);
  assert.equal(languageRosterStatus(ledger, 'fly-a'), 'pending');
  // The old session's reply is still only readable under its own key.
  assert.equal(settledLanguageReply(ledger, old.key).requestId, 'old');
  assert.equal(settledLanguageReply(ledger, restored.key), null);
});
