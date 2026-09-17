import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.js';
import { createEnvironmentAdapter, encodeRetinalRgb, readFixtureMotor, RETINAL_ADAPTER } from './environment-adapter.js';
function setup() {
  let clock = 1000;
  const runtime = createRuntime({ individualId: 'a', sessionId: 's' });
  const adapter = createEnvironmentAdapter(runtime, { now: () => clock });
  const frame = (rgb = Array(96).fill(0)) => ({ version: 1, individualId: 'a', sessionId: 's',
    environmentEpoch: adapter.snapshot().environmentEpoch, frameId: runtime.snapshot().tick,
    simTimeMs: runtime.snapshot().simTimeMs, capturedAtMs: clock, camera: 'controller', width: 8, height: 4, rgb });
  return { runtime, adapter, frame, elapse(ms) { clock += ms; } };
}
test('recorded pixel change causes bounded sensory, neural and motor changes in actual fixture', () => {
  const dark = setup(), bright = setup();
  dark.runtime.control('start'); bright.runtime.control('start');
  const rgb = Array.from({ length: 96 }, (_, i) => Math.floor(i / 3) % 8 < 4 ? 255 : 0);
  let trace;
  for (let i = 0; i < 200; i++) {
    dark.adapter.accept(dark.frame()); trace = bright.adapter.accept(bright.frame(rgb));
  }
  assert.notDeepEqual(dark.runtime.checkpoint().dynamics, bright.runtime.checkpoint().dynamics);
  assert.notDeepEqual(dark.adapter.snapshot().motor, bright.adapter.snapshot().motor);
  assert.equal(trace.inputSimTimeMs, 995); assert.equal(trace.outputSimTimeMs, 1000);
  assert.ok(trace.retinalCurrents.every(n => n >= 0 && n <= 0.02));
  assert.ok(Math.abs(trace.motor.yaw) <= RETINAL_ADAPTER.maxYawSpeed);
  assert.ok(trace.motor.forward >= 0 && trace.motor.forward <= RETINAL_ADAPTER.maxForwardSpeed);
  assert.deepEqual(bright.runtime.snapshot().stimulusPolicy.entries, []);
});
test('observer cameras, hidden coordinates and malformed pixels are rejected without advancement', () => {
  const { runtime, adapter, frame } = setup(); runtime.control('start');
  for (const bad of [{ ...frame(), camera: 'observer' }, { ...frame(), hiddenTarget: [1, 2] },
    { ...frame(), rgb: Array(96).fill(NaN) }, { ...frame(), rgb: Array(95).fill(0) }]) {
    assert.throws(() => adapter.accept(bad)); assert.equal(runtime.snapshot().tick, 0);
  }
  assert.deepEqual(encodeRetinalRgb(Array(96).fill(0)), Array(32).fill(0));
});
test('duplicate, stale, future and cross-recipient/session/epoch frames cannot advance', () => {
  const { runtime, adapter, frame, elapse } = setup(); runtime.control('start');
  const accepted = frame(); adapter.accept(accepted);
  assert.throws(() => adapter.accept(accepted), /sequence/);
  for (const bad of [{ ...frame(), individualId: 'b' }, { ...frame(), sessionId: 'old' },
    { ...frame(), environmentEpoch: 'old' }, { ...frame(), simTimeMs: 99 }, { ...frame(), capturedAtMs: 1001 }]) {
    assert.throws(() => adapter.accept(bad)); assert.equal(runtime.snapshot().tick, 1);
  }
  const stale = frame(); elapse(251); assert.throws(() => adapter.accept(stale), /stale/);
  assert.equal(adapter.checkFreshness(), false); assert.equal(runtime.snapshot().status, 'paused');
  assert.notEqual(adapter.snapshot().environmentEpoch, accepted.environmentEpoch);
});
test('fresh arrivals cannot erase an expired observation gap before the watchdog runs', () => {
  for (const gap of [251, -1]) {
    const { runtime, adapter, frame, elapse } = setup(); runtime.control('start');
    adapter.accept(frame());
    const before = runtime.checkpoint(), environment = adapter.snapshot();
    elapse(gap);
    assert.throws(() => adapter.accept(frame()), /stale/);
    assert.equal(runtime.snapshot().status, 'paused');
    assert.equal(runtime.snapshot().tick, before.dynamics.tick);
    assert.deepEqual(runtime.checkpoint().dynamics, before.dynamics);
    assert.deepEqual(adapter.snapshot().pose, environment.pose);
    assert.notEqual(adapter.snapshot().environmentEpoch, environment.environmentEpoch);
    assert.deepEqual(adapter.snapshot().motor, { forward: 0, yaw: 0 });
    assert.equal(adapter.snapshot().lastFrameId, -1);
    assert.throws(() => adapter.accept(frame()), /Explicitly run/);
    runtime.control('start');
    adapter.accept(frame());
    assert.equal(runtime.snapshot().tick, before.dynamics.tick + 1);
  }
});
test('invalid frame traffic neither refreshes freshness nor changes the epoch', () => {
  const { runtime, adapter, frame, elapse } = setup(); runtime.control('start');
  adapter.accept(frame()); const environment = adapter.snapshot();
  elapse(200);
  assert.throws(() => adapter.accept({ ...frame(), rgb: Array(96).fill(NaN) }), /RGB/);
  assert.equal(adapter.snapshot().lastReceivedAtMs, environment.lastReceivedAtMs);
  elapse(51);
  assert.throws(() => adapter.accept({ ...frame(), environmentEpoch: 'other' }), /epoch/);
  assert.equal(adapter.snapshot().environmentEpoch, environment.environmentEpoch);
  assert.equal(runtime.snapshot().tick, 1);
  assert.throws(() => adapter.accept(frame()), /stale/);
  assert.equal(runtime.snapshot().status, 'paused');
  assert.equal(runtime.snapshot().tick, 1);
});
test('fresh arrival at the exact observation deadline advances only one step', () => {
  const { runtime, adapter, frame, elapse } = setup(); runtime.control('start');
  adapter.accept(frame()); const epoch = adapter.snapshot().environmentEpoch;
  elapse(250); adapter.accept(frame());
  assert.equal(runtime.snapshot().tick, 2);
  assert.equal(adapter.snapshot().environmentEpoch, epoch);
});
test('a first frame cannot bypass an expired first-frame grace period', () => {
  const { runtime, adapter, frame, elapse } = setup(); runtime.control('start');
  adapter.checkFreshness(); elapse(251);
  assert.throws(() => adapter.accept(frame()), /stale/);
  assert.equal(runtime.snapshot().tick, 0);
  assert.equal(runtime.snapshot().status, 'paused');
});
test('rest, quiet and idle never escalate input or erase optional policy reservations', () => {
  const { runtime, adapter, frame } = setup(); runtime.control('start'); runtime.encounter('nectar');
  const reserved = runtime.snapshot().stimulusPolicy.reservedDose;
  adapter.accept(frame()); runtime.control('rest');
  assert.throws(() => adapter.accept(frame()), /Explicitly run/);
  assert.deepEqual(adapter.snapshot().motor, { forward: 0, yaw: 0 });
  assert.equal(runtime.snapshot().stimulusPolicy.reservedDose, reserved);
  assert.equal(runtime.snapshot().stimulusPolicy.effects.find(e => e.id === 'nectar').active, false);
});
test('runtime shared sensory policy rejects unbounded currents atomically and does not retain frames on checkpoint', () => {
  const runtime = createRuntime(); runtime.control('start');
  const before = runtime.checkpoint();
  for (const input of [{ retinalCurrents: Array(32).fill(0.021) }, { retinalCurrents: Array(32).fill(-1) },
    { retinalCurrents: Array(31).fill(0) }, { retinalCurrents: Array(32).fill(0), extra: 1 }]) {
    assert.throws(() => runtime.step(input)); assert.deepEqual(runtime.checkpoint(), before);
  }
  runtime.step({ retinalCurrents: Array(32).fill(0.02) });
  const restored = createRuntime({ individualId: runtime.snapshot().individualId, checkpoint: runtime.checkpoint() });
  assert.equal(restored.snapshot().status, 'paused');
  assert.equal(Object.hasOwn(restored.checkpoint(), 'retinalCurrents'), false);
  assert.deepEqual(readFixtureMotor(restored.snapshot()), { forward: 0, yaw: 0 });
});
test('explicit start has bounded first-frame grace without advancing neural time', () => {
  const { runtime, adapter, elapse } = setup(); runtime.control('start');
  assert.equal(adapter.checkFreshness(), true); assert.equal(runtime.snapshot().tick, 0);
  elapse(251); assert.equal(adapter.checkFreshness(), false); assert.equal(runtime.snapshot().status, 'paused');
  assert.equal(runtime.snapshot().tick, 0);
});
