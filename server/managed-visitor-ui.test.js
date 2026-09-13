import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VISITOR_PHASES, podPresentation, podRosterEntry } from '../client/src/visitor-phase.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('every bridge phase renders a distinct pod label and an unknown phase falls back to home', () => {
  const bridge = source('./managed-visitor-bridge.js');
  // Each phase the bridge can assign must have a presentation; no silent blank pod.
  for (const phase of ['home', 'admission', 'departing', 'visiting', 'returning', 'reconnecting', 'disconnected', 'timed-out', 'blocked']) {
    assert(VISITOR_PHASES.includes(phase), `missing presentation for ${phase}`);
    assert(bridge.includes(`'${phase}'`), `bridge no longer produces ${phase}`);
  }
  const labels = VISITOR_PHASES.map(phase => podPresentation({ phase }).label);
  assert.equal(new Set(labels).size, VISITOR_PHASES.length);
  assert(labels.every(label => label.trim().length > 0));
  assert.equal(podPresentation({ phase: 'arrived' }).phase, 'home');
  assert.equal(podPresentation(null).label, podPresentation({ phase: 'home' }).label);
});

test('pod motion and arrival wording appear only after host acknowledgment', () => {
  for (const phase of VISITOR_PHASES) {
    const pod = podPresentation({ phase, worldId: 'world', running: true });
    assert.equal(pod.motion, phase === 'visiting', `${phase} motion`);
    if (phase !== 'visiting') assert.doesNotMatch(pod.detail, /arriv|landed|welcome/i, `${phase} implies arrival`);
  }
  // The two phases named in the acceptance criterion: a requested admission and a refused one.
  for (const phase of ['admission', 'blocked']) {
    const pod = podPresentation({ phase, worldId: 'world' });
    assert.equal(pod.motion, false);
    assert.doesNotMatch(pod.label, /arriv/i);
    assert.doesNotMatch(pod.detail, /arriv/i);
  }
  assert.equal(podPresentation({ phase: 'visiting', worldId: 'garden-world' }).destination, 'garden-world');
  // A pre-acknowledgment phase still names its requested destination without claiming presence.
  assert.match(podPresentation({ phase: 'admission', worldId: 'garden-world' }).detail, /garden-world/);
  assert.equal(podPresentation({ phase: 'home', worldId: 'garden-world' }).destination, null);
});

test('the away habitat keeps the pod visible and the pod label reads live visitor state', () => {
  const css = source('../client/src/style.css'), main = source('../client/src/main.jsx');
  assert.doesNotMatch(css, /\.habitat-away \.pod-label\s*\{\s*display:\s*none/);
  assert.match(css, /\.habitat-away \.pod-label/);
  assert.doesNotMatch(main, /HOST BRIDGE NOT CONNECTED/);
  assert.match(main, /podPresentation\(/);
});

test('roster entries expose each fly pod state without a selection change', () => {
  const roster = [{ individualId: 'a', phase: 'visiting', owned: true, running: true },
    { individualId: 'b', phase: 'admission', owned: true, running: false }].map(podRosterEntry);
  assert.deepEqual(roster.map(entry => entry.phase), ['visiting', 'admission']);
  assert.deepEqual(roster.map(entry => entry.tone), ['active', 'pending']);
  assert.notEqual(roster[0].label, roster[1].label);
  assert.equal(podRosterEntry({ individualId: 'c' }).phase, 'home');
});
