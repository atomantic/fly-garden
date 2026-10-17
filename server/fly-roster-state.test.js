import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFlyRoster, recordRosterReply, rosterKeyTarget, rowCommandTarget, rowVisitorActions } from '../client/src/fly-roster-state.js';
import { beginLanguageRequest, emptyLanguageLedger, languageKey } from '../client/src/language-reply-ledger.js';
import { podRosterEntry } from '../client/src/visitor-phase.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const individuals = [
  { individualId: 'fly-a', resident: true, sessionId: 'session-a' },
  { individualId: 'fly-b', resident: true, sessionId: 'session-b' },
  { individualId: 'fly-c', resident: false, sessionId: null },
];
const health = [
  { individualId: 'fly-a', phase: 'visiting', owned: true, running: true, worldId: 'garden-world' },
  { individualId: 'fly-b', phase: 'home', owned: false, running: false, worldId: null },
].map(podRosterEntry);

test('the roster lists every individual with its own session, pod state and selection, never another row\'s', () => {
  const rows = buildFlyRoster({ individuals, visitorRoster: health, selectedId: 'fly-b' });
  assert.deepEqual(rows.map(row => [row.individualId, row.sessionId, row.resident, row.selected]),
    [['fly-a', 'session-a', true, false], ['fly-b', 'session-b', true, true], ['fly-c', null, false, false]]);
  assert.deepEqual(rows.map(row => [row.pod.phase, row.pod.tone, row.pod.owned, row.pod.running, row.pod.worldId]),
    [['visiting', 'active', true, true, 'garden-world'], ['home', 'idle', false, false, null], ['home', 'idle', false, false, null]]);
  assert.notEqual(rows[0].pod.label, rows[1].pod.label);
  assert.deepEqual(rows.map(row => row.language), [null, null, null]);
  // Entries without an identifier are dropped rather than rendered as an unnamed row.
  assert.equal(buildFlyRoster({ individuals: [{}, { individualId: '' }, individuals[0]] }).length, 1);
});

test('a row command reply stands in for the roster only until a later roster read, and only for the listed session', () => {
  const visitor = { phase: 'returning', owned: true, running: false, worldId: 'garden-world' };
  let overrides = recordRosterReply({}, { individualId: 'fly-a', sessionId: 'session-a', visitor }, 100);
  const fresh = buildFlyRoster({ individuals, visitorRoster: health, overrides, rosterReadAt: 50 });
  assert.equal(fresh[0].pod.phase, 'returning');
  assert.equal(fresh[1].pod.phase, 'home', 'the reply for A never touches B');
  const superseded = buildFlyRoster({ individuals, visitorRoster: health, overrides, rosterReadAt: 100 });
  assert.equal(superseded[0].pod.phase, 'visiting', 'a roster read that started after the reply wins');
  // A reply for a session this row no longer lists is ignored.
  overrides = recordRosterReply({}, { individualId: 'fly-a', sessionId: 'stale-session', visitor }, 100);
  assert.equal(buildFlyRoster({ individuals, visitorRoster: health, overrides, rosterReadAt: 50 })[0].pod.phase, 'visiting');
  // Malformed replies are not recorded.
  assert.deepEqual(recordRosterReply({}, { individualId: '', sessionId: 's', visitor }), {});
  assert.deepEqual(recordRosterReply({}, { individualId: 'fly-a', sessionId: 's', visitor: null }), {});
});

test('the roster line carries each fly\'s own language status', () => {
  const ledger = beginLanguageRequest(emptyLanguageLedger, { key: languageKey('fly-b', 'session-b'), individualId: 'fly-b', sessionId: 'session-b', requestId: 'r1' }, 5);
  const rows = buildFlyRoster({ individuals, visitorRoster: health, ledger });
  assert.equal(rows[0].language, null);
  assert.equal(rows[1].language.status, 'pending');
  assert.equal(rows[1].language.requestId, 'r1');
});

test('arrow, Home and End keys move the roving selection and wrap; other keys do nothing', () => {
  assert.equal(rosterKeyTarget('ArrowDown', 0, 3), 1);
  assert.equal(rosterKeyTarget('ArrowRight', 2, 3), 0);
  assert.equal(rosterKeyTarget('ArrowUp', 0, 3), 2);
  assert.equal(rosterKeyTarget('ArrowLeft', 1, 3), 0);
  assert.equal(rosterKeyTarget('Home', 2, 3), 0);
  assert.equal(rosterKeyTarget('End', 0, 3), 2);
  assert.equal(rosterKeyTarget('Enter', 0, 3), null);
  assert.equal(rosterKeyTarget('ArrowDown', 0, 0), null);
  assert.equal(rosterKeyTarget('ArrowDown', 7, 3), 1, 'an out-of-range index starts from the first row');
});

test('a row command binds to that row\'s individual and listed session; unloaded or sessionless rows cannot be commanded', () => {
  const rows = buildFlyRoster({ individuals, visitorRoster: health, selectedId: 'fly-a' });
  assert.deepEqual(rowCommandTarget(rows[0]), { individualId: 'fly-a', sessionId: 'session-a' });
  assert.deepEqual(rowCommandTarget(rows[1]), { individualId: 'fly-b', sessionId: 'session-b' });
  assert.equal(rowCommandTarget(rows[2]), null);
  assert.equal(rowCommandTarget({ ...rows[0], sessionId: null }), null);
  assert.deepEqual(rowVisitorActions(rows[0], { bridgeConfigured: true }), { canReturn: true, canVisit: false });
  assert.deepEqual(rowVisitorActions(rows[1], { bridgeConfigured: true }), { canReturn: false, canVisit: true });
  assert.deepEqual(rowVisitorActions(rows[1], { bridgeConfigured: false }), { canReturn: false, canVisit: false });
  assert.deepEqual(rowVisitorActions(rows[1], { bridgeConfigured: true, busy: true }), { canReturn: false, canVisit: false });
  assert.deepEqual(rowVisitorActions(rows[2], { bridgeConfigured: true }), { canReturn: false, canVisit: false });
  // Return stays available in every owned phase, including a stuck return, so a fly is never stranded.
  for (const phase of ['admission', 'departing', 'returning', 'reconnecting', 'disconnected', 'timed-out']) {
    const row = { ...rows[0], pod: { ...rows[0].pod, phase, owned: true } };
    assert.equal(rowVisitorActions(row, { bridgeConfigured: true }).canReturn, true, phase);
    assert.equal(rowVisitorActions(row, { bridgeConfigured: true }).canVisit, false, phase);
  }
});

/** The browser spec `tests/browser/fly-roster.spec.js` is not in CI; these guard the contracts it measures. */
test('the roster is a keyboard radiogroup with per-row controls, and both selectors share one selection path', () => {
  const roster = source('../client/src/FlyRoster.jsx'), main = source('../client/src/main.jsx');
  assert.match(roster, /role="radiogroup"/);
  assert.match(roster, /role="radio"/);
  assert.match(roster, /aria-checked=\{row\.selected\}/);
  assert.match(roster, /tabIndex=\{row\.selected \? 0 : -1\}/);
  assert.match(roster, /rosterKeyTarget\(event\.key/);
  // Row controls use the row's own target, never the selected fly's state.
  assert.match(roster, /useVisitorCommands\(target/);
  assert.doesNotMatch(roster, /selectedIndividualRef|state\.individualId/);
  assert.match(main, /onSelect=\{selectIndividual\}/);
  assert.equal((main.match(/onChange=\{event => selectIndividual\(event\.target\.value\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(main, /className="pod-roster"/, 'the read-only pod list was replaced by the roster');
});

test('a selection change hands an in-flight caretaker chat to the ledger instead of aborting or cancelling it', () => {
  const language = source('../client/src/LanguageControls.jsx'), main = source('../client/src/main.jsx');
  const cleanup = language.slice(language.indexOf('return () => { stopped = true;'), language.indexOf('}, [key]);'));
  assert.doesNotMatch(cleanup, /cancelRecipient|pending\.controller\.abort/);
  assert.match(language, /if \(operation === 'chat'\) onRequest\(/);
  assert.match(language, /heldLanguageReply\(ledger, key\)/);
  assert.match(main, /trackLanguageRequest/);
  assert.match(main, /settleLanguageRequest\(ledger, request/);
  // The ledger is passed to the panel, so a remount after a selection change sees the held reply.
  assert.match(main, /ledger=\{languageLedger\} onRequest=\{trackLanguageRequest\} onReplyShown=\{markLanguageShown\}/);
});
