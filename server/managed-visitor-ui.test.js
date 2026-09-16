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

/** `tests/browser/teleport-pod-phases.spec.js` reads the pod tone back out of the rendered three.js
 * material through these attributes. That suite is not part of `npm test` or CI, so the contract it
 * depends on is guarded here: if the readback is dropped, the browser evidence silently stops
 * measuring the renderer and starts measuring nothing. */
test('the renderer publishes the pod tone it actually drew, read back from the ring material', () => {
  const scene = source('../client/src/Scene.jsx');
  const apply = scene.slice(scene.indexOf('const applyPod'), scene.indexOf('const draw ='));
  for (const attribute of ['podEmissive', 'podIntensity', 'podOffset']) {
    assert.match(apply, new RegExp(`${attribute}:`), `Scene no longer publishes ${attribute}`);
  }
  // Each value is read back off the material or the transform, never restated from the React prop
  // that set it — otherwise the browser spec would assert the input against itself.
  assert.match(apply, /ring\.material\.emissive\.getHexString\(\)/);
  assert.match(apply, /ring\.material\.emissiveIntensity/);
  assert.match(apply, /Math\.abs\(ring\.position\.y - baseY\)/);
  assert.doesNotMatch(apply, /podEmissive: current\.tone|podEmissive: tone\./, 'readback must not restate the prop');
  // The tone write must stay outside the movement branch, so it still applies with motion off, and
  // the readback must follow it rather than sampling a stale material.
  assert(apply.indexOf('emissive.setHex') < apply.indexOf('getHexString'), 'readback must follow the write');
  assert.match(apply, /const moving = animate && current\.motion === true && current\.phase === "visiting"/);
});

test('roster entries expose each fly pod state without a selection change', () => {
  const roster = [{ individualId: 'a', phase: 'visiting', owned: true, running: true },
    { individualId: 'b', phase: 'admission', owned: true, running: false }].map(podRosterEntry);
  assert.deepEqual(roster.map(entry => entry.phase), ['visiting', 'admission']);
  assert.deepEqual(roster.map(entry => entry.tone), ['active', 'pending']);
  assert.notEqual(roster[0].label, roster[1].label);
  assert.equal(podRosterEntry({ individualId: 'c' }).phase, 'home');
});
