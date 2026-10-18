import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFlyRoster, mergeRosterReply, rosterKeyTarget, rowCommandTarget, rowVisitorActions } from '../client/src/fly-roster-state.js';
import { beginLanguageRequest, emptyLanguageLedger } from '../client/src/language-reply-ledger.js';
import { sessionKey } from '../client/src/runtime-state.js';
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

test('a row command reply refreshes exactly that fly\'s roster entry', () => {
  const reply = { individualId: 'fly-a', sessionId: 'session-a', visitor: { phase: 'returning', owned: true, running: false, worldId: 'garden-world' } };
  const merged = mergeRosterReply(health, reply);
  assert.deepEqual(merged.map(entry => [entry.individualId, entry.phase, entry.worldId]), [['fly-a', 'returning', 'garden-world'], ['fly-b', 'home', null]]);
  assert.equal(merged[1], health[1], 'the reply for A never touches B');
  // A fly the health read has not listed yet is added rather than lost.
  assert.deepEqual(mergeRosterReply([], reply).map(entry => entry.phase), ['returning']);
  // Malformed replies change nothing.
  assert.equal(mergeRosterReply(health, { individualId: '', visitor: reply.visitor }), health);
  assert.equal(mergeRosterReply(health, { individualId: 'fly-a', visitor: null }), health);
});

test('the roster line carries each fly\'s own language status', () => {
  const ledger = beginLanguageRequest(emptyLanguageLedger, { key: sessionKey('fly-b', 'session-b'), individualId: 'fly-b', sessionId: 'session-b', requestId: 'r1' }, 5);
  const rows = buildFlyRoster({ individuals, visitorRoster: health, ledger });
  assert.deepEqual(rows.map(row => row.language), [null, 'pending', null]);
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
  assert.deepEqual(rowVisitorActions(rows[0], { bridgeConfigured: true }), { target: rowCommandTarget(rows[0]), canReturn: true, canVisit: false });
  assert.deepEqual(rowVisitorActions(rows[1], { bridgeConfigured: true }), { target: rowCommandTarget(rows[1]), canReturn: false, canVisit: true });
  assert.deepEqual(rowVisitorActions(rows[1], { bridgeConfigured: false }), { target: rowCommandTarget(rows[1]), canReturn: false, canVisit: false });
  assert.deepEqual(rowVisitorActions(rows[2], { bridgeConfigured: true }), { target: null, canReturn: false, canVisit: false });
  // Return stays available in every owned phase, including a stuck return, so a fly is never stranded.
  for (const phase of ['admission', 'departing', 'returning', 'reconnecting', 'disconnected', 'timed-out']) {
    const row = { ...rows[0], pod: { ...rows[0].pod, phase, owned: true } };
    assert.equal(rowVisitorActions(row, { bridgeConfigured: true }).canReturn, true, phase);
    assert.equal(rowVisitorActions(row, { bridgeConfigured: true }).canVisit, false, phase);
  }
});

/** The browser spec `tests/browser/fly-roster.spec.js` is not in CI; these guard the contracts it measures. */
test('the roster is a keyboard radiogroup with per-row controls, and every selector shares one selection path', () => {
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
  assert.doesNotMatch(cleanup, /cancel|abort\(\)(?!;?\s*readEpoch)/);
  assert.doesNotMatch(language, /postLanguage\([^)]*'chat'/, 'the panel never posts a chat itself');
  assert.match(language, /onChat\(state, \{ requestId, message/);
  assert.match(language, /settledLanguageReply\(ledger, key\)/);
  assert.match(main, /postLanguage\(source, "chat", payload\)/);
  assert.match(main, /settleLanguageRequest\(ledger, request/);
  // The ledger and the chat path reach the panel, so a remount after a selection change reads the held reply.
  for (const prop of ['ledger={languageLedger}', 'onChat={sendLanguageChat}', 'onMutation={handleLanguageMutation}']) assert.ok(main.includes(prop), prop);
});
