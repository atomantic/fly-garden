import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.js';
import { readRuntimeSnapshot, mergeRuntimeSnapshot } from '../client/src/runtime-state.js';
test('first poll refuses the reported legacy runtime instead of dereferencing null session state', () => {
  const legacy = { schemaVersion: 1, source: 'fixture', status: 'paused', tick: 0, simTimeMs: 0,
    neural: { neurons: [], meanRateHz: 0 }, capabilities: {} };
  assert.equal(mergeRuntimeSnapshot(null, legacy), legacy);
  assert.throws(() => readRuntimeSnapshot(legacy), error => error.code === 'RUNTIME_PROTOCOL_MISMATCH' && /Restart Fly Garden/.test(error.message));
  assert.throws(() => readRuntimeSnapshot(null), /Backend version mismatch/);
  const current = { ...createRuntime().snapshot(), commandSequence: 0 };
  assert.equal(mergeRuntimeSnapshot(null, readRuntimeSnapshot(current)), current);
});
test('stale responses cannot undo pause or replace a newer trajectory; new sessions can reset clocks', () => {
  const current = { ...createRuntime().snapshot(), tick: 12, commandSequence: 4, status: 'paused' };
  assert.equal(mergeRuntimeSnapshot(current, { ...current, tick: 13, commandSequence: 3, status: 'running' }), current);
  assert.equal(mergeRuntimeSnapshot(current, { ...current, tick: 11 }), current);
  const restored = { ...current, sessionId: 'fresh-restored-session', tick: 2 };
  assert.equal(mergeRuntimeSnapshot(current, restored), restored);
});
