import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTEXT_LOST_MESSAGE, createAtlasContextGuard } from '../client/src/webgl-context-loss.js';

function harness() {
  const calls = { cancelled: 0, measuring: [], failures: [], prevented: 0 };
  const guard = createAtlasContextGuard({
    cancelBenchmark: () => calls.cancelled++,
    setMeasuring: value => calls.measuring.push(value),
    setFailure: value => calls.failures.push(value),
  });
  const event = { preventDefault: () => calls.prevented++ };
  return { calls, guard, event };
}

const laidOut = { width: 640, height: 480 };

test('a healthy context renders, picks and keeps the searchable table', () => {
  const { calls, guard } = harness();
  assert.equal(guard.lost, false);
  assert.equal(guard.canRender(), true);
  assert.equal(guard.canPick(laidOut), true);
  assert.equal(guard.searchableTableAvailable(), true);
  assert.deepEqual(calls, { cancelled: 0, measuring: [], failures: [], prevented: 0 });
});

test('losing the drawing context cancels the benchmark, suppresses drawing and disables picking', () => {
  const { calls, guard, event } = harness();
  assert.equal(guard.handleContextLost(event), true);
  assert.equal(calls.prevented, 1, 'default handling would make the context unrestorable');
  assert.equal(calls.cancelled, 1, 'an in-flight redraw measurement must not keep running on a dead context');
  assert.deepEqual(calls.measuring, [false], 'the measuring status message must be cleared');
  assert.deepEqual(calls.failures, [CONTEXT_LOST_MESSAGE]);
  assert.equal(guard.lost, true);
  assert.equal(guard.canRender(), false);
  assert.equal(guard.canPick(laidOut), false);
});

test('the searchable cell table survives context loss and the alert says so', () => {
  const { guard, event } = harness();
  guard.handleContextLost(event);
  assert.equal(guard.searchableTableAvailable(), true);
  assert.match(CONTEXT_LOST_MESSAGE, /searchable cell table remains available/);
  // Loss is reported as a display failure with a recovery instruction, never as missing anatomy.
  assert.match(CONTEXT_LOST_MESSAGE, /Reload the atlas/);
  assert.doesNotMatch(CONTEXT_LOST_MESSAGE, /cells? (?:were|was) removed|no cells/i);
});

test('a repeated loss event is idempotent and does not re-cancel or re-announce', () => {
  const { calls, guard, event } = harness();
  guard.handleContextLost(event);
  assert.equal(guard.handleContextLost(event), false);
  assert.equal(calls.cancelled, 1);
  assert.deepEqual(calls.measuring, [false]);
  assert.deepEqual(calls.failures, [CONTEXT_LOST_MESSAGE]);
  assert.equal(calls.prevented, 2, 'every event must still be prevented');
});

test('picking also refuses an unlaid-out canvas, and a loss event without preventDefault is tolerated', () => {
  const { guard } = harness();
  for (const rect of [undefined, null, {}, { width: 0, height: 480 }, { width: 640, height: 0 }])
    assert.equal(guard.canPick(rect), false);
  const bare = harness();
  assert.equal(bare.guard.handleContextLost({}), true);
  assert.equal(bare.guard.canRender(), false);
});

test('AtlasCanvas routes rendering, picking and the loss listener through the guard', () => {
  const source = readFileSync(new URL('../client/src/AtlasCanvas.jsx', import.meta.url), 'utf8');
  assert.match(source, /createAtlasContextGuard\(\{/);
  assert.match(source, /if \(context\.canRender\(\)\) renderer\.render/);
  assert.match(source, /if \(!context\.canPick\(rect\)\) return;/);
  assert.match(source, /addEventListener\('webglcontextlost', contextLost\)/);
  assert.match(source, /const contextLost = event => context\.handleContextLost\(event\);/);
  // The component must not keep a second copy of the lost flag.
  assert.doesNotMatch(source, /\blet lost\b/);
});
