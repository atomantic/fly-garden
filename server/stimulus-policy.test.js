import test from 'node:test';
import assert from 'node:assert/strict';
import { createStimulusPolicy, STIMULUS_SOURCES } from './stimulus-policy.js';
import { createRuntime } from './runtime.js';

const policyFixture = () => createStimulusPolicy({ individualId: 'fixture', sessionId: 'session' });
const offer = (policy, source, effect = 'nectar') => policy.admit(source, policy.envelope(source, effect));
const runFor = (runtime, ms) => { for (let i = 0; i < ms / 5; i++) runtime.step(); };
const runtimeEnvelope = (runtime, source, effect = 'nectar') => {
  const state = runtime.snapshot().stimulusPolicy;
  const definition = state.effects.find(item => item.id === effect);
  return { version: 1, source, individualId: state.individualId, sessionId: state.sessionId,
    simTimeMs: state.simTimeMs, effect, targets: definition.targets,
    intensity: definition.intensity, durationMs: definition.durationMs };
};

test('all sources share aggregate dose, duration, duty cycle and simulation-time recovery', () => {
  const policy = policyFixture();
  offer(policy, 'ui');
  for (const source of STIMULUS_SOURCES) assert.throws(() => offer(policy, source, 'floral'), /recovery/);
  policy.advance(3000);
  offer(policy, 'learning');
  policy.advance(6000);
  assert.throws(() => offer(policy, 'language'), /Aggregate/); // 40.5 dose, below the duration cap.
  assert.equal(policy.snapshot().reservedDose, 27);
  assert.equal(policy.snapshot().reservedDurationMs, 600);
  policy.advance(10300);
  offer(policy, 'language');
  assert.equal(policy.snapshot().reservedDose, 27);

  const duration = policyFixture();
  offer(duration, 'garden', 'floral');
  duration.advance(3000);
  offer(duration, 'eidoverse', 'floral');
  duration.advance(4000);
  assert.throws(() => offer(duration, 'ui'), /Aggregate/); // Dose would fit, duration would not.
  assert.equal(duration.snapshot().reservedDurationMs, 1000);
  assert.equal(duration.snapshot().reservedDutyCycle, 0.1);
  assert.equal(duration.snapshot().reservedDose, 25);
});

test('invalid envelopes are rejected atomically, including arbitrary mapping and source spoofing', () => {
  const policy = policyFixture();
  const valid = policy.envelope('ui', 'nectar');
  const invalid = [
    { version: 2 }, { source: 'unknown' }, { individualId: 'another' }, { sessionId: 'old' },
    { simTimeMs: -5 }, { simTimeMs: 5 }, { simTimeMs: NaN }, { effect: 'pain' },
    { targets: ['fixture-31'] }, { targets: [...valid.targets, 'fixture-4'] }, { targets: new Array(4) },
    { intensity: NaN }, { intensity: Infinity }, { intensity: -1 }, { intensity: 0.046 },
    { durationMs: NaN }, { durationMs: Infinity }, { durationMs: -5 }, { durationMs: 301 },
    { durationMs: 1 }, { durationMs: 0 }, { intensity: 0 }, { arbitraryCurrent: 10 },
  ];
  const before = policy.snapshot();
  for (const changes of invalid) {
    assert.throws(() => policy.admit('ui', { ...valid, ...changes }));
    assert.deepEqual(policy.snapshot(), before);
    assert.equal(policy.currents().size, 0);
  }
  assert.throws(() => policy.admit('eidoverse', valid), /source/);
  assert.throws(() => policy.admit('ui', null));
  policy.advance(5);
  assert.throws(() => policy.admit('ui', valid), /timestamp/);
  assert.throws(() => policy.advance(0), /rewind/);
  assert.throws(() => policy.advance(Infinity));
});

test('restoring old authenticated budgets unions reservations without refund, reactivation or partial mutation', () => {
  const policy = policyFixture();
  const empty = policy.checkpoint();
  offer(policy, 'ui');
  const first = JSON.parse(JSON.stringify(policy.checkpoint()));
  policy.advance(3000);
  offer(policy, 'learning');
  policy.restore(empty);
  assert.equal(policy.snapshot().reservedDose, 27);
  assert.equal(policy.currents().size, 0);
  policy.restore(first);
  assert.equal(policy.snapshot().reservedDose, 27);
  assert.equal(policy.snapshot().entries.length, 2);
  policy.advance(6000);
  assert.throws(() => offer(policy, 'eidoverse'), /Aggregate/);
  const before = policy.snapshot();
  const corrupt = structuredClone(first);
  corrupt.payload.entries[0].intensity = NaN;
  const erased = structuredClone(first);
  erased.payload.entries = [];
  const future = structuredClone(first);
  future.payload.timeMs = 20000;
  for (const saved of [null, {}, corrupt, erased, future, policyFixture().checkpoint()]) {
    assert.throws(() => policy.restore(saved));
    assert.deepEqual(policy.snapshot(), before);
  }
});

test('ledger stays bounded during sustained contact and only simulation time recovers budgets', () => {
  const policy = policyFixture();
  for (let time = 0; time <= 1000000; time += 1000) {
    policy.advance(time);
    try { offer(policy, STIMULUS_SOURCES[(time / 1000) % STIMULUS_SOURCES.length]); }
    catch (error) { assert.equal(error.statusCode, 409); }
    const state = policy.snapshot();
    assert.ok(state.entries.length <= 11);
    assert.ok(state.reservedDurationMs <= state.limits.maxDurationMs);
    assert.ok(state.reservedDose <= state.limits.maxDose);
  }
  const snapshot = policy.snapshot();
  snapshot.entries.length = 0;
  assert.notEqual(policy.snapshot().entries.length, 0);
});

test('runtime adapters and UI encounter share the boundary before any neural mutation', () => {
  for (const source of STIMULUS_SOURCES) {
    const runtime = createRuntime();
    runtime.control('start');
    runtime.encounter('floral');
    const neural = runtime.snapshot().neural;
    assert.throws(() => runtime.stimulate(source, runtimeEnvelope(runtime, source)), /recovery/);
    assert.deepEqual(runtime.snapshot().neural, neural);
    assert.equal(runtime.snapshot().events[0].details.decision, 'rejected');
  }
  const runtime = createRuntime();
  runtime.control('start');
  const neural = runtime.snapshot().neural;
  for (const invalid of [{ intensity: NaN }, { intensity: Infinity }, { effect: 'injury' }, { simTimeMs: 5 }, { targets: ['fixture-31'] }, { targets: new Array(4) }]) {
    assert.throws(() => runtime.stimulate('garden', { ...runtimeEnvelope(runtime, 'garden'), ...invalid }));
    assert.deepEqual(runtime.snapshot().neural, neural);
  }
  runtime.stimulate('garden', runtimeEnvelope(runtime, 'garden'));
  const accepted = runtime.snapshot().events[0].details;
  assert.equal(accepted.source, 'garden');
  assert.equal(accepted.intensity, 0.045);
  assert.equal(accepted.durationMs, 300);
  runtime.step();
  assert.notDeepEqual(runtime.snapshot().neural, neural);
});

test('Rest, quiet, idle and avoidance preserve baseline and never escalate input', () => {
  const a = createRuntime({ sessionId: 'baseline' });
  const b = createRuntime({ sessionId: 'baseline' });
  a.control('start'); b.control('start');
  a.encounter('quiet');
  runFor(a, 5000); runFor(b, 5000);
  assert.deepEqual(a.snapshot().neural, b.snapshot().neural);
  assert.equal(a.snapshot().stimulusPolicy.reservedDose, 0);
  a.encounter('nectar');
  const budget = a.snapshot().stimulusPolicy.reservedDose;
  a.control('rest');
  for (let i = 0; i < 10; i++) {
    a.control('start');
    assert.throws(() => a.encounter('nectar'), /recovery/);
    a.control('rest');
    runFor(a, 1000);
  }
  assert.equal(a.snapshot().simTimeMs, 5000);
  assert.equal(a.snapshot().stimulusPolicy.reservedDose, budget);
  assert.equal(a.snapshot().chemistry.some(effect => effect.active), false);
  a.control('start');
  runFor(a, 5000); runFor(b, 5000);
  assert.deepEqual(a.snapshot().neural, b.snapshot().neural);
  assert.equal(a.snapshot().stimulusPolicy.entries[0].intensity, 0.045);
});

test('pause freezes delivery and recovery; internal restore returns paused without refreshing budgets', () => {
  const runtime = createRuntime();
  const before = runtime.checkpointStimulusPolicy();
  runtime.control('start');
  runtime.encounter('nectar');
  runtime.control('pause');
  const paused = runtime.snapshot();
  runFor(runtime, 10000);
  assert.deepEqual(runtime.snapshot(), paused);
  runtime.control('start');
  runtime.restoreStimulusPolicy(before);
  assert.equal(runtime.snapshot().status, 'paused');
  assert.equal(runtime.snapshot().stimulusPolicy.reservedDose, 13.5);
  assert.equal(runtime.snapshot().chemistry.some(effect => effect.active), false);
  runtime.control('start');
  assert.throws(() => runtime.encounter('nectar'), /recovery/);
});

test('quiet can cancel immediately during recovery without refunding dose or reactivating after restore', () => {
  const policy = policyFixture();
  offer(policy, 'ui');
  const active = policy.checkpoint();
  assert.equal(policy.currents().get('fixture-0'), 0.045);
  offer(policy, 'garden', 'quiet');
  assert.equal(policy.currents().size, 0);
  assert.equal(policy.snapshot().reservedDose, 13.5);
  assert.throws(() => offer(policy, 'language'), /recovery/);
  policy.restore(active);
  assert.equal(policy.currents().size, 0);
  assert.equal(policy.snapshot().reservedDose, 13.5);
});

test('receipt-scoped cancellation checks source and retains other receipts and aggregate reservations', () => {
  const policy = createStimulusPolicy({ individualId: 'a', sessionId: 's' });
  const ui = policy.admit('ui', policy.envelope('ui', 'nectar'));
  policy.advance(1000);
  const garden = policy.admit('garden', policy.envelope('garden', 'floral'));
  const before = policy.snapshot();
  assert.throws(() => policy.cancelEntry('ui', garden.id), /source mismatch/);
  assert.deepEqual(policy.snapshot(), before);
  assert.equal(policy.cancelEntry('ui', ui.id), false);
  assert.equal(policy.snapshot().effects.find(e => e.id === 'floral').active, true);
  assert.equal(policy.cancelEntry('garden', garden.id), true);
  assert.equal(policy.currents().size, 0);
  assert.equal(policy.snapshot().reservedDose, before.reservedDose);
  assert.equal(policy.snapshot().entries.length, 2);
  assert.equal(policy.cancelEntry('garden', garden.id), false);
});
