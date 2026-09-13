import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_VALUE_IDS, NUMERICAL_HEALTH_DISCLOSURE, runtimeAdminValues } from '../client/src/runtime-admin-values.js';

const neural = { tick: 12, simTimeMs: 12, spikes: 0, totalSpikes: 4, traversedEdges: 9, minimum: -0.25, maximum: 0.75 };
const state = over => ({ protocolVersion: 1, source: 'connectome', individualId: 'lab-individual', dataset: 'male-cns:v1.0',
  sessionEpoch: 'epoch', commandSequence: 4, resident: true, status: 'paused', checkpointId: 'head-1',
  graphSha256: 'b'.repeat(64), model: { id: 'malecns-traced-lif-v1', dtMs: 1, refractorySteps: 2 },
  provenance: { manifestSha256: 'c'.repeat(64), neuronCount: 139255, edgeCount: 54492000, contactCount: 3 }, neural, ...over });
const profile = { dataset: 'male-cns:v1.0', neuronCount: 139255, edgeCount: 54492000, modelId: 'malecns-traced-lif-v1' };
const population = { residentCount: 1, settings: { maxResidentFlies: 2 }, pressure: 'nominal' };
const history = [{ checkpointId: 'head-1', tick: 12, createdAt: 1, bytes: 900, sha256: 'd'.repeat(64), operation: 'save', parentId: null, restoredFrom: null }];
const byId = values => Object.fromEntries(values.map(item => [item.id, item]));

test('one surface presents all seven admin values together, each naming its own source', () => {
  const values = runtimeAdminValues({ state: state(), profile, population, history, receiptAgeMs: 240 });
  assert.deepEqual(values.map(item => item.id), [...ADMIN_VALUE_IDS]);
  assert.equal(ADMIN_VALUE_IDS.length, 7);
  const found = byId(values);
  assert.equal(found['model-identity'].value, 'malecns-traced-lif-v1');
  assert.match(found['loaded-counts'].value, /139,255 retained neurons · 54,492,000 directed edges/);
  assert.equal(found['loaded-counts'].source, 'Selected runtime');
  assert.match(found['numerical-health'].value, /Finite potential bounds -0\.25 → 0\.75/);
  assert.match(found['state-age'].value, /240 ms since the last accepted receipt/);
  assert.match(found['checkpoint-lineage'].value, /1 durable checkpoints · head head-1/);
  assert.match(found['admission-state'].value, /1 resident of 2 ceiling · pressure nominal · this individual holds admission/);
  // Every displayed value carries a source, so no value silently borrows another's provenance.
  for (const item of values) assert.ok(typeof item.source === 'string' && item.source.length > 0);
});

test('numerical health always carries the disclosure that it is never a welfare score', () => {
  const health = byId(runtimeAdminValues({ state: state(), profile, population, history, receiptAgeMs: 0 }))['numerical-health'];
  assert.equal(health.note, NUMERICAL_HEALTH_DISCLOSURE);
  for (const word of ['happiness', 'consciousness', 'welfare', 'wellbeing']) assert.match(health.note, new RegExp(`never .*${word}|${word}`));
  assert.match(NUMERICAL_HEALTH_DISCLOSURE, /never/);
  // The rendered lab surface shows the note beside every value rather than only in prose.
  const source = readFileSync(new URL('../client/src/ConnectomeLab.jsx', import.meta.url), 'utf8');
  assert.match(source, /runtimeAdminValues\(/);
  assert.match(source, /item\.note/);
  const faulted = byId(runtimeAdminValues({ state: state({ status: 'fault' }), profile, population, history, receiptAgeMs: 5 }));
  assert.match(faulted['numerical-health'].value, /Fault reported/);
});

test('an unavailable value stays unavailable and is never filled in from another source', () => {
  const unloaded = byId(runtimeAdminValues({ state: state({ resident: false, status: 'saved-unloaded', neural: null,
    provenance: null, model: null, checkpointId: null }), profile, population: null, history: [], receiptAgeMs: null }));
  assert.equal(unloaded['model-identity'].available, false);
  assert.equal(unloaded['model-identity'].value, 'Unavailable');
  assert.equal(unloaded['numerical-health'].available, false);
  assert.equal(unloaded['state-age'].available, false);
  assert.equal(unloaded['checkpoint-lineage'].available, false);
  assert.equal(unloaded['admission-state'].available, false);
  // A pinned profile may stand in for counts only when it says so in the value's own source.
  assert.equal(unloaded['loaded-counts'].source, 'Pinned local profile (no resident worker)');
  assert.match(unloaded['loaded-counts'].note, /not a loaded graph/);
  assert.equal(byId(runtimeAdminValues({ state: state({ provenance: null }), profile: null, history, receiptAgeMs: 1 }))['loaded-counts'].available, false);
  // Simulation speed has no measurement at this revision and is never replaced by polling cadence.
  const speed = byId(runtimeAdminValues({ state: state(), profile, population, history, receiptAgeMs: 1 }))['simulation-speed'];
  assert.equal(speed.available, false);
  assert.match(speed.note, /Polling cadence is not simulated throughput/);
  // A disconnected read says so on the value whose freshness it describes.
  assert.match(byId(runtimeAdminValues({ state: state(), profile, population, history, receiptAgeMs: 900, disconnected: true }))['state-age'].note, /not current/);
  assert.throws(() => runtimeAdminValues({ state: { ...state(), source: 'fixture' } }));
});
