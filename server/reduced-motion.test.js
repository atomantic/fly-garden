import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REDUCED_MOTION_QUERY,
  motionRenderPolicy,
  observeReducedMotion,
  prefersReducedMotion,
} from '../client/src/reduced-motion.js';

function view(matches, { legacy = false, throws = false } = {}) {
  const listeners = [];
  const query = { matches, media: REDUCED_MOTION_QUERY };
  if (legacy) {
    query.addListener = handler => listeners.push(handler);
    query.removeListener = handler => listeners.splice(listeners.indexOf(handler), 1);
  } else {
    query.addEventListener = (type, handler) => { assert.equal(type, 'change'); listeners.push(handler); };
    query.removeEventListener = (type, handler) => listeners.splice(listeners.indexOf(handler), 1);
  }
  const asked = [];
  return {
    asked,
    listeners,
    matchMedia(media) { asked.push(media); if (throws) throw new Error('matchMedia unavailable'); return query; },
  };
}

test('the operating-system reduce preference is read from the exact media query', () => {
  const reduced = view(true), full = view(false);
  assert.equal(prefersReducedMotion(reduced), true);
  assert.equal(prefersReducedMotion(full), false);
  assert.deepEqual(reduced.asked, ['(prefers-reduced-motion: reduce)']);
});

test('an absent, failing or non-boolean preference is reported as not reduced rather than guessed', () => {
  assert.equal(prefersReducedMotion(undefined), false);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion(view(true, { throws: true })), false);
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: 'yes' }) }), false);
});

test('reduced motion stops continuous repainting and orbit damping; full motion keeps the frame loop', () => {
  const reduced = motionRenderPolicy(true);
  assert.equal(reduced.reducedMotion, true);
  assert.equal(reduced.continuous, false);
  assert.equal(reduced.enableDamping, false);
  assert.deepEqual([...reduced.redrawOn], ['state-commit', 'control-interaction', 'resize']);
  const full = motionRenderPolicy(false);
  assert.equal(full.continuous, true);
  assert.equal(full.enableDamping, true);
  assert.deepEqual([...full.redrawOn], ['animation-frame']);
  // Only an explicit true reduces motion; unknown input must not silently disable the live view.
  assert.equal(motionRenderPolicy(undefined).continuous, true);
  assert.equal(motionRenderPolicy('reduce').continuous, true);
  assert.throws(() => { reduced.continuous = true; }, TypeError);
});

test('preference changes are delivered and fully unsubscribed on both MediaQueryList APIs', () => {
  for (const legacy of [false, true]) {
    const target = view(false, { legacy }), seen = [];
    const stop = observeReducedMotion(target, value => seen.push(value));
    assert.equal(target.listeners.length, 1);
    target.listeners[0]({ matches: true });
    target.listeners[0]({ matches: false });
    assert.deepEqual(seen, [true, false]);
    stop();
    assert.equal(target.listeners.length, 0);
  }
});

test('observing a missing or failing media query is a no-op that still returns an unsubscribe function', () => {
  for (const target of [undefined, {}, view(true, { throws: true }), { matchMedia: () => null }]) {
    const stop = observeReducedMotion(target, () => assert.fail('no change should be delivered'));
    assert.equal(typeof stop, 'function');
    stop();
  }
  // A media query with neither listener API is inert rather than a crash.
  const stop = observeReducedMotion({ matchMedia: () => ({ matches: true }) }, () => {});
  assert.equal(typeof stop, 'function');
  stop();
});

test('every WebGL view consults the shared policy instead of holding an unconditional frame loop', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const file of ['../client/src/Scene.jsx', '../client/src/SharedScene.jsx']) {
    const source = read(file);
    assert.match(source, /motionRenderPolicy/, `${file} must read the shared motion policy`);
    assert.match(source, /motion\.enableDamping/, `${file} must take orbit damping from the policy`);
    assert.match(source, /if\s*\(motion\.continuous\)/, `${file} must gate its animation-frame loop`);
  }
  // The atlas has no animation-frame loop at all, so it satisfies the policy in both states.
  const atlas = read('../client/src/AtlasCanvas.jsx');
  assert.equal(/requestAnimationFrame\(/.test(atlas.split('function measureRedraws')[0]), false);
});

test('teleport-pod phase tone is state, not motion, and the visiting-only movement guard is intact', () => {
  const source = readFileSync(new URL('../client/src/Scene.jsx', import.meta.url), 'utf8');
  const applyPod = source.slice(source.indexOf('const applyPod ='), source.indexOf('const draw ='));
  assert.ok(applyPod.length, 'Scene.jsx must keep the pod update in one reviewable place');
  // Emissive colour and intensity are written on every draw, so the phase stays visible with no loop.
  assert.match(applyPod, /ring\.material\.emissive\.setHex\(tone\.emissive\)/);
  assert.match(applyPod, /ring\.material\.emissiveIntensity = tone\.intensity/);
  // Only the sinusoidal bob is gated on the motion policy.
  assert.match(applyPod, /const moving = animate && current\.motion === true && current\.phase === "visiting"/);
  assert.match(applyPod, /const offset = moving \? Math\.sin/);
  // The tone write must not sit inside the `moving` branch.
  assert.equal(/if \(moving\)/.test(applyPod), false);
  // The draw path applies the pod in both modes, passing the policy only as the animate flag.
  assert.match(source, /applyPod\(motion\.continuous\);/);
});
