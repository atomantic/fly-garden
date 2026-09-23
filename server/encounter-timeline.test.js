import test from 'node:test';
import assert from 'node:assert/strict';
import { encounterTimelineModel } from '../client/src/encounter-timeline.js';
import { createEncounterDynamics } from './encounter-dynamics.js';
import { createStimulusPolicy } from './stimulus-policy.js';

const catalog = [
  { id: 'floral', label: 'Floral contact proxy', intensity: 0.025, durationMs: 500 },
  { id: 'nectar', label: 'Fictional nectar input', intensity: 0.045, durationMs: 300 },
];
const event = (kind, simTimeMs, extra = {}) => ({
  individualId: 'fly-a', sessionId: 'session-a', environmentEpoch: 'epoch-a', kind, simTimeMs, ...extra,
});
const stateWith = (overrides = {}) => ({ individualId: 'fly-a', sessionId: 'session-a', encounterDynamics: {
  version: 1, individualId: 'fly-a', sessionId: 'session-a', simTimeMs: 500, catalog, events: [],
  recoveryRemainingMs: 1200,
  aggregate: { reservedDose: 12.5, reservedDurationMs: 500,
    limits: { maxDose: 40, maxDurationMs: 1000, windowMs: 10000 } },
  ...overrides,
} });

test('encounter timeline is scoped to its individual and session', () => {
  assert.deepEqual(encounterTimelineModel({
    individualId: 'fly-b', sessionId: 'session-a',
    encounterDynamics: { individualId: 'fly-a', sessionId: 'session-a', simTimeMs: 0, events: [] },
  }), { available: false, reason: 'Encounter history is unavailable for the selected individual/session.' });
  assert.equal(encounterTimelineModel({
    individualId: 'fly-a', sessionId: 'session-b',
    encounterDynamics: { individualId: 'fly-a', sessionId: 'session-a', simTimeMs: 0, events: [] },
  }).available, false);
  assert.equal(encounterTimelineModel({
    individualId: 'fly-a', sessionId: 'session-a',
    encounterDynamics: { ...stateWith().encounterDynamics, version: 2 },
  }).available, false);
});

test('timeline consumes the real encounter snapshot and shared stimulus ledger', () => {
  const individualId = 'fly-a', sessionId = 'session-a';
  const policy = createStimulusPolicy({ individualId, sessionId });
  const dynamics = createEncounterDynamics({ individualId, sessionId,
    flowers: [{ id: 'test-flower', x: 0, z: 0, radius: 0.35, effectId: 'floral' }],
    admit: request => policy.admit('garden', policy.envelope('garden', request.effectId)),
    cancel: request => policy.cancelEntry(request.source, request.entryId),
    policySnapshot: () => policy.snapshot(),
  });
  const frame = (frameId, simTimeMs, x) => ({ individualId, sessionId, environmentEpoch: 'epoch-a', frameId,
    simTimeMs, pose: { x, z: 0 }, status: 'running' });
  policy.advance(0);
  dynamics.setEnabled(true, 'epoch-a');
  dynamics.update(frame(0, 0, 1));
  policy.advance(5);
  const snapshot = dynamics.update(frame(1, 5, 0));
  const model = encounterTimelineModel({ individualId, sessionId, encounterDynamics: snapshot });

  assert.equal(model.available, true);
  assert.deepEqual(model.activePulse, { label: 'Floral contact proxy', intensity: 0.025, activeUntilMs: 505 });
  assert.deepEqual(model.budget, { reservedDose: 12.5, maxDose: 40,
    reservedDurationMs: 500, maxDurationMs: 1000, windowMs: 10000 });
  assert.deepEqual(model.events.map(row => row.message), [
    'Encounter control enabled; no exposure was applied.', 'A bounded synthetic pulse was admitted.',
  ]);
});

test('timeline separates bounded synthetic exposure from unavailable retained learning', () => {
  const model = encounterTimelineModel(stateWith({
    active: { id: 7, effectId: 'floral', activeUntilMs: 750 },
    events: [
      event('enabled', 0),
      event('admitted', 250, { entryId: 7, effectId: 'floral' }),
      event('washout', 500, { entryId: 7, retainedLearning: 'Unavailable; no plasticity implemented.' }),
      { ...event('admitted', 400, { entryId: 7, effectId: 'nectar' }), sessionId: 'other-session' },
      event('unauthorized-event-kind', 450),
      event('rejected', -5),
      event('constructor', 475),
    ],
  }));

  assert.equal(model.simTimeMs, 500);
  assert.equal(model.persistentLearning, 'Unavailable; fixture weights do not change.');
  assert.deepEqual(model.activePulse, { label: 'Floral contact proxy', intensity: 0.025, activeUntilMs: 750 });
  assert.equal(model.recoveryRemainingMs, 1200);
  assert.deepEqual(model.budget, { reservedDose: 12.5, maxDose: 40,
    reservedDurationMs: 500, maxDurationMs: 1000, windowMs: 10000 });
  assert.deepEqual(model.events.map(row => [row.simTimeMs, row.message, row.effect?.label]), [
    [0, 'Encounter control enabled; no exposure was applied.', undefined],
    [250, 'A bounded synthetic pulse was admitted.', 'Floral contact proxy'],
    [500, 'The pulse stopped before expiry; its reservation was not refunded.', 'Floral contact proxy'],
  ]);
  assert.equal(model.unavailableEventCount, 4);
});

test('timeline keeps only the latest twelve valid session events in simulation order', () => {
  const events = Array.from({ length: 15 }, (_, index) => event('enabled', index * 5));
  const model = encounterTimelineModel(stateWith({ events }));
  assert.equal(model.events.length, 12);
  assert.deepEqual(model.events.map(row => row.simTimeMs), Array.from({ length: 12 }, (_, index) => (index + 3) * 5));
  assert.equal(model.omittedOlderEvents, 3);
});

test('timeline reports corrupt active, budget and cooldown fields as unavailable', () => {
  const model = encounterTimelineModel(stateWith({
    active: { effectId: 'unregistered', activeUntilMs: 750 },
    recoveryRemainingMs: 'unknown',
    aggregate: { reservedDose: 'unknown', reservedDurationMs: 500,
      limits: { maxDose: 40, maxDurationMs: 1000, windowMs: 10000 } },
  }));
  assert.equal(model.activeUnavailable, true);
  assert.equal(model.budget, null);
  assert.equal(model.recoveryRemainingMs, null);
});
