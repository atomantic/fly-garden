import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginLanguageRequest, emptyLanguageLedger, heldLanguageReply, languageKey, languageReplyTarget,
  languageRosterStatus, markLanguageReplyShown, pendingLanguageRequest, settleLanguageRequest,
} from '../client/src/language-reply-ledger.js';

const A = { individualId: 'fly-a', sessionId: 'session-a' }, B = { individualId: 'fly-b', sessionId: 'session-b' };
const request = (fly, requestId) => ({ key: languageKey(fly.individualId, fly.sessionId), ...fly, requestId });
const reply = (fly, requestId) => ({ ok: true, result: { status: 'complete', interpretation: `text for ${fly.individualId}`, requestId },
  language: { individualId: fly.individualId, sessionId: fly.sessionId, events: [{ requestId }] }, state: { ...fly, tick: 3 } });

test('a reply is applied to its own fly only while that fly is selected; otherwise it is held for that fly', () => {
  const a = request(A, 'req-1');
  assert.equal(languageReplyTarget(a, a.key), 'panel');
  assert.equal(languageReplyTarget(a, languageKey(B.individualId, B.sessionId)), 'ledger');
  // A restored session of the same individual is a different recipient.
  assert.equal(languageReplyTarget(a, languageKey(A.individualId, 'restored')), 'ledger');
  assert.equal(languageReplyTarget(null, a.key), 'ledger');

  let ledger = beginLanguageRequest(emptyLanguageLedger, a, 10);
  assert.deepEqual(pendingLanguageRequest(ledger, a.key)?.requestId, 'req-1');
  assert.equal(pendingLanguageRequest(ledger, languageKey(B.individualId, B.sessionId)), null);
  assert.deepEqual(languageRosterStatus(ledger, 'fly-a'), { status: 'pending', sessionId: 'session-a', requestId: 'req-1', startedAt: 10, settledAt: null });
  assert.equal(languageRosterStatus(ledger, 'fly-b'), null);

  ledger = settleLanguageRequest(ledger, a, reply(A, 'req-1'), 20);
  assert.equal(pendingLanguageRequest(ledger, a.key), null);
  const held = heldLanguageReply(ledger, a.key);
  assert.equal(held.outcome.result.interpretation, 'text for fly-a');
  assert.equal(held.outcome.language.individualId, 'fly-a');
  // B's panel can never pick A's reply up, by key.
  assert.equal(heldLanguageReply(ledger, languageKey(B.individualId, B.sessionId)), null);
  assert.equal(languageRosterStatus(ledger, 'fly-a').status, 'held');

  ledger = markLanguageReplyShown(ledger, a.key);
  assert.equal(heldLanguageReply(ledger, a.key), null);
  assert.equal(languageRosterStatus(ledger, 'fly-a').status, 'shown');
  // Marking is idempotent and a foreign key changes nothing.
  assert.equal(markLanguageReplyShown(ledger, a.key), ledger);
  assert.equal(markLanguageReplyShown(ledger, 'nobody/nothing'), ledger);
});

test('two flies keep independent entries; settling one leaves the other pending', () => {
  const a = request(A, 'req-a'), b = request(B, 'req-b');
  let ledger = beginLanguageRequest(beginLanguageRequest(emptyLanguageLedger, a, 1), b, 2);
  ledger = settleLanguageRequest(ledger, b, reply(B, 'req-b'), 3);
  assert.equal(languageRosterStatus(ledger, 'fly-a').status, 'pending');
  assert.equal(languageRosterStatus(ledger, 'fly-b').status, 'held');
  assert.equal(heldLanguageReply(ledger, b.key).outcome.result.interpretation, 'text for fly-b');
  assert.equal(heldLanguageReply(ledger, a.key), null);
});

test('a stale or superseded settle is dropped, and a failed reply is recorded as a failure for its own fly', () => {
  const first = request(A, 'req-1'), second = request(A, 'req-2');
  let ledger = beginLanguageRequest(emptyLanguageLedger, first, 1);
  ledger = beginLanguageRequest(ledger, second, 2);
  // The first request's late result cannot settle the second.
  assert.equal(settleLanguageRequest(ledger, first, reply(A, 'req-1'), 3), ledger);
  assert.equal(pendingLanguageRequest(ledger, second.key).requestId, 'req-2');
  ledger = settleLanguageRequest(ledger, second, { ok: false, error: 'Language request refused' }, 4);
  assert.deepEqual(heldLanguageReply(ledger, second.key).outcome, { ok: false, error: 'Language request refused' });
  assert.equal(languageRosterStatus(ledger, 'fly-a').status, 'failed');
  // Settling twice, or with a malformed outcome, changes nothing further.
  assert.equal(settleLanguageRequest(ledger, second, reply(A, 'req-2'), 5), ledger);
  const noError = settleLanguageRequest(beginLanguageRequest(emptyLanguageLedger, first, 1), first, {}, 2);
  assert.equal(heldLanguageReply(noError, first.key).outcome.error, 'Language reply unavailable.');
});

test('malformed requests never enter the ledger', () => {
  for (const bad of [null, {}, { key: 'x', individualId: 'a', sessionId: 's', requestId: 'r' },
    { key: 'a/s', individualId: 'a', sessionId: 's', requestId: '' }, { key: 'a/s', individualId: 'a', sessionId: 's' }]) {
    assert.equal(beginLanguageRequest(emptyLanguageLedger, bad), emptyLanguageLedger, JSON.stringify(bad));
  }
  assert.deepEqual(Object.keys(emptyLanguageLedger.entries), []);
});

test('the roster line reports the most recent request of an individual across its sessions', () => {
  const old = request(A, 'old'), restored = { ...request({ individualId: 'fly-a', sessionId: 'restored' }, 'new') };
  let ledger = beginLanguageRequest(emptyLanguageLedger, old, 1);
  ledger = settleLanguageRequest(ledger, old, reply(A, 'old'), 2);
  ledger = beginLanguageRequest(ledger, restored, 3);
  assert.deepEqual(languageRosterStatus(ledger, 'fly-a'), { status: 'pending', sessionId: 'restored', requestId: 'new', startedAt: 3, settledAt: null });
  // The old session's held reply is still only readable under its own key.
  assert.equal(heldLanguageReply(ledger, old.key).requestId, 'old');
  assert.equal(heldLanguageReply(ledger, restored.key), null);
});
