import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCheckpointPolicyContinuity, branchRuntimeCheckpoint, createRuntime, RUNTIME_DATASET, validateRuntimeCheckpoint } from './runtime.js';
import { createStimulusPolicy, validateStimulusCheckpoint } from './stimulus-policy.js';

const steps = (runtime, count) => { for (let i = 0; i < count; i++) runtime.step(); };
const fixture = () => createRuntime({ individualId: 'individual-a', sessionId: 'session-a' });
const restore = checkpoint => createRuntime({ individualId: 'individual-a', sessionId: 'session-b', checkpoint });

test('portable checkpoint restores the same fixture trajectory, independent identity and trailing rates', () => {
  const source = fixture();
  source.control('start');
  steps(source, 317);
  source.control('pause');
  const saved = JSON.parse(JSON.stringify(source.checkpoint()));
  const restored = restore(saved);
  assert.equal(restored.snapshot().status, 'paused');
  assert.equal(restored.snapshot().individualId, 'individual-a');
  assert.equal(restored.snapshot().sessionId, 'session-b');
  assert.equal(restored.snapshot().protocolVersion, 1);
  assert.deepEqual(restored.snapshot().dataset, RUNTIME_DATASET);
  assert.deepEqual(restored.snapshot().neural, source.snapshot().neural);
  steps(restored, 2000);
  assert.equal(restored.snapshot().tick, 317);
  source.control('start'); restored.control('start');
  for (let i = 0; i < 500; i++) {
    source.step(); restored.step();
    assert.deepEqual(restored.snapshot().neural, source.snapshot().neural);
  }
  assert.equal(fixture().snapshot().tick, 0);
  assert.deepEqual(saved.unsupported, { rng: null, plasticity: null, refractory: null, delayBuffers: null, embodiment: null,
    plasticityGains: null, eligibilityTraces: null, worldPhase: null, bodyPose: null });
  // Fixture checkpoints written before the research kernel retained plasticity,
  // world and RNG state must keep loading unchanged.
  const legacy = structuredClone(saved);
  legacy.unsupported = { rng: null, plasticity: null, refractory: null, delayBuffers: null, embodiment: null };
  assert.equal(validateRuntimeCheckpoint(legacy).individualId, saved.individualId);
  saved.dynamics.potentials[0] = 0.99;
  assert.notEqual(restored.checkpoint().dynamics.potentials[0], 0.99);
});

test('restored exposure stays canceled with original reservations, source session and simulation-time recovery', () => {
  const source = fixture();
  source.control('start');
  source.encounter('nectar');
  steps(source, 10);
  const restored = restore(source.checkpoint());
  const policy = restored.snapshot().stimulusPolicy;
  assert.equal(policy.sessionId, 'session-b');
  assert.equal(policy.entries[0].sessionId, 'session-a');
  assert.equal(policy.reservedDose, 13.5);
  assert.equal(policy.reservedDurationMs, 300);
  assert.equal(policy.effects.some(effect => effect.active), false);
  assert.equal(policy.effects.find(effect => effect.id === 'nectar').cooldownRemainingMs, 2950);
  steps(restored, 100000);
  assert.deepEqual(restored.snapshot().stimulusPolicy, policy);
  restored.control('start');
  assert.throws(() => restored.encounter('nectar'), /recovery/);
  steps(restored, 590);
  restored.encounter('nectar');
  assert.equal(restored.snapshot().stimulusPolicy.reservedDose, 27);
  assert.equal(restored.snapshot().stimulusPolicy.entries[1].sessionId, 'session-b');
});

test('checkpoint shape, namespace, versions, finite numbers and clock/state coherence are strict', () => {
  const source = fixture();
  source.control('start');
  steps(source, 250);
  const saved = source.checkpoint();
  const mutations = [
    value => { value.extra = true; },
    value => { value.schemaVersion = 2; },
    value => { value.protocolVersion = 2; },
    value => { value.individualId = 'another'; },
    value => { value.dataset.namespace = 'malecns-v1'; },
    value => { value.dataset.release = '2'; },
    value => { value.dataset.modelId = 'another-model'; },
    value => { value.parameters.stepMs = 10; },
    value => { value.parameters.membraneRetention = 0.98; },
    value => { value.parameters.excitatoryWeight = 0.2; },
    value => { value.unsupported.rng = 123; },
    value => { value.faultReason = ''; },
    value => { value.dynamics.tick = -1; },
    value => { value.dynamics.tick = 0.5; },
    value => { value.dynamics.tick = Number.MAX_SAFE_INTEGER; },
    value => { value.dynamics.potentials[0] = NaN; },
    value => { value.dynamics.potentials[0] = Infinity; },
    value => { value.dynamics.potentials[0] = -0.01; },
    value => { value.dynamics.potentials[0] = 1; },
    value => { value.dynamics.potentials.pop(); },
    value => { delete value.dynamics.potentials[0]; },
    value => { value.dynamics.firing[0] = 1; },
    value => { value.dynamics.firing[0] = true; value.dynamics.potentials[0] = 0.5; },
    value => { value.dynamics.spikeHistory[0] = [1260]; },
    value => { value.dynamics.spikeHistory[0] = [250]; },
    value => { value.dynamics.spikeHistory[0] = [1000, 1000]; },
    value => { value.dynamics.spikeHistory[0] = [1200, 1195]; },
    value => { value.dynamics.spikeHistory[0] = [1201]; },
    value => { value.dynamics.spikeHistory[0] = Array(101).fill(1200); },
    value => { value.stimulusPolicy.timeMs -= 5; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(saved);
    mutate(invalid);
    assert.throws(() => restore(invalid));
  }
  for (const invalid of [null, {}, [], 'checkpoint']) assert.throws(() => restore(invalid));
  assert.deepEqual(source.checkpoint(), saved);
});

test('durable policy validation rejects corruption, budget overflow and invalid recovery without changing a live runtime', () => {
  const source = fixture();
  source.control('start'); source.encounter('nectar'); steps(source, 600); source.encounter('floral');
  const saved = source.checkpoint();
  const mutations = [
    value => { value.version = 2; },
    value => { value.individualId = 'another'; },
    value => { value.nextId = 1; },
    value => { value.entries[0].source = 'unknown'; },
    value => { value.entries[0].individualId = 'another'; },
    value => { value.entries[0].sessionId = ''; },
    value => { value.entries[0].intensity = NaN; },
    value => { value.entries[0].intensity = 0.1; },
    value => { value.entries[0].durationMs = 301; },
    value => { value.entries[0].targets = ['fixture-31']; },
    value => { value.entries[0].activeUntilMs = 305; },
    value => { value.entries[0].activeUntilMs = -5; },
    value => { value.entries[0].simTimeMs = 4000; },
    value => { value.entries[1].id = value.entries[0].id; },
    value => { value.entries[1].simTimeMs = 500; value.entries[1].activeUntilMs = 1000; },
    value => { value.entries = Array(12).fill(value.entries[0]); },
    value => { value.entries[0].extra = true; },
    value => { delete value.entries[0]; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(saved);
    mutate(invalid.stimulusPolicy);
    assert.throws(() => restore(invalid));
  }
  assert.deepEqual(source.checkpoint(), saved);
  const budget = structuredClone(saved.stimulusPolicy);
  budget.timeMs = 6000;
  budget.entries.push({ ...structuredClone(budget.entries[1]), id: 3, simTimeMs: 6000, activeUntilMs: 6500 });
  budget.nextId = 4;
  assert.throws(() => validateStimulusCheckpoint(budget), /Invalid/);
});

test('replica creation is explicit, isolated and cannot restore the parent identity directly', () => {
  const source = fixture();
  source.control('start'); source.encounter('floral'); steps(source, 25);
  const saved = source.checkpoint();
  assert.throws(() => createRuntime({ individualId: 'replica-b', checkpoint: saved }), /Invalid/);
  assert.throws(() => branchRuntimeCheckpoint(saved, 'individual-a'), /new identity/);
  const branch = branchRuntimeCheckpoint(saved, 'replica-b');
  const replica = createRuntime({ individualId: 'replica-b', sessionId: 'replica-session', checkpoint: branch });
  assert.equal(replica.snapshot().status, 'paused');
  assert.equal(replica.snapshot().stimulusPolicy.entries[0].individualId, 'replica-b');
  assert.deepEqual(replica.snapshot().neural, source.snapshot().neural);
  replica.control('start'); steps(replica, 10);
  assert.deepEqual(source.checkpoint(), saved);
  assert.notDeepEqual(replica.snapshot().neural, source.snapshot().neural);
});

test('same-individual restore cannot refund retained reservations or replace an event from a divergent session', () => {
  const source = fixture();
  const empty = source.checkpoint();
  source.control('start'); source.encounter('nectar');
  const offered = source.checkpoint();
  assert.throws(() => assertCheckpointPolicyContinuity(offered, empty), /erase retained/);
  steps(source, 10); source.encounter('quiet');
  assert.doesNotThrow(() => assertCheckpointPolicyContinuity(source.checkpoint(), offered));
  const changedSession = structuredClone(offered);
  changedSession.stimulusPolicy.entries[0].sessionId = 'divergent-session';
  assert.throws(() => assertCheckpointPolicyContinuity(source.checkpoint(), changedSession), /erase retained/);
  assert.throws(() => assertCheckpointPolicyContinuity(source.checkpoint(), branchRuntimeCheckpoint(offered, 'replica')), /Invalid/);
  steps(source, 2050); // Reservations expire only after simulated recovery; restoring now cannot erase retained spend.
  assert.equal(source.checkpoint().stimulusPolicy.entries.length, 0);
  assert.doesNotThrow(() => assertCheckpointPolicyContinuity(source.checkpoint(), empty));
});

test('fault pause preserves neural state and spent budget and requires explicit validated recovery', () => {
  const source = fixture();
  source.control('start'); source.encounter('nectar'); steps(source, 25);
  const before = source.checkpoint();
  source.pauseFault('Storage failed; retained the active individual.');
  assert.equal(source.snapshot().status, 'fault');
  assert.equal(source.snapshot().faultReason, 'Storage failed; retained the active individual.');
  assert.deepEqual(source.checkpoint().dynamics, before.dynamics);
  assert.equal(source.snapshot().stimulusPolicy.reservedDose, 13.5);
  assert.equal(source.snapshot().chemistry.some(effect => effect.active), false);
  steps(source, 1000);
  assert.deepEqual(source.checkpoint().dynamics, before.dynamics);
  assert.throws(() => source.control('start'), /validated checkpoint restore/);
  source.control('home');
  assert.equal(source.snapshot().status, 'fault');
  const restored = restore(source.checkpoint());
  assert.equal(restored.snapshot().status, 'paused');
  assert.equal(restored.snapshot().faultReason, source.snapshot().faultReason);
  restored.control('start');
  assert.equal(restored.snapshot().faultReason, null);
});

test('unsafe clock and excessive candidate firing rate stop before committing any part of a step', () => {
  const clockCheckpoint = fixture().checkpoint();
  clockCheckpoint.dynamics.tick = Math.floor(Number.MAX_SAFE_INTEGER / 5);
  clockCheckpoint.stimulusPolicy.timeMs = clockCheckpoint.dynamics.tick * 5;
  const clock = restore(clockCheckpoint);
  clock.control('start'); clock.step();
  assert.equal(clock.snapshot().status, 'fault');
  assert.match(clock.snapshot().faultReason, /clock/);
  assert.deepEqual(clock.checkpoint().dynamics, clockCheckpoint.dynamics);
  assert.equal(clock.checkpoint().stimulusPolicy.timeMs, clockCheckpoint.stimulusPolicy.timeMs);

  const rateCheckpoint = fixture().checkpoint();
  rateCheckpoint.dynamics.tick = 200;
  rateCheckpoint.stimulusPolicy.timeMs = 1000;
  rateCheckpoint.dynamics.potentials[0] = 0.99;
  rateCheckpoint.dynamics.spikeHistory[0] = Array.from({ length: 100 }, (_, i) => 500 + i * 5);
  const rate = restore(rateCheckpoint);
  rate.control('start'); rate.step();
  assert.equal(rate.snapshot().status, 'fault');
  assert.match(rate.snapshot().faultReason, /firing rate/);
  assert.deepEqual(rate.checkpoint().dynamics, rateCheckpoint.dynamics);
  assert.equal(rate.checkpoint().stimulusPolicy.timeMs, 1000);
  assert.doesNotThrow(() => validateRuntimeCheckpoint(rate.checkpoint()));
});

test('durable policy import stays separate from same-session HMAC restore and rejects exhausted sequences', () => {
  const original = createStimulusPolicy({ individualId: 'a', sessionId: 'a-session' });
  original.admit('ui', original.envelope('ui', 'nectar'));
  const resumed = createStimulusPolicy({ individualId: 'a', sessionId: 'b-session', durableCheckpoint: original.durableCheckpoint() });
  assert.equal(resumed.currents().size, 0);
  assert.equal(resumed.snapshot().reservedDose, 13.5);
  assert.throws(() => resumed.restore(original.checkpoint()), /integrity/);
  const exhausted = resumed.durableCheckpoint();
  exhausted.nextId = Number.MAX_SAFE_INTEGER;
  const limit = createStimulusPolicy({ individualId: 'a', sessionId: 'c-session', durableCheckpoint: exhausted });
  assert.throws(() => limit.admit('ui', limit.envelope('ui', 'quiet')), /sequence limit/);
  assert.equal(limit.snapshot().reservedDose, 13.5);
});
