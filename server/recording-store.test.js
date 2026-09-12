import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecordingStore, validateRecordingExport } from './recording-store.js';
const provenance = { individualId: 'fly', worldId: 'garden', sessionId: 'source-session', modelVersion: 'fixture-1', datasetVersion: 'synthetic-1', checkpointId: 'saved', seed: null, participantIds: ['fly'], sampleIntervalMs: 100 };
const observation = { individualId: 'fly', worldId: 'garden', sessionId: 'source-session', simulationTimeMs: 100, worldTimeMs: 100, wallTimeMs: 500, sourceStartMs: 0, sourceEndMs: 100, ratesHz: [1, 2] };
function setup(t, options = {}) { const directory = mkdtempSync(join(tmpdir(), 'recording-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return { directory, store: createRecordingStore({ directory, ...options }) }; }
test('restart preserves records, marks interruption, and corrupt chunks leave intact evidence', async t => {
  const { directory, store } = setup(t); const s = store.start(provenance);
  await store.append(s.id, observation); await store.append(s.id, observation); store.close();
  const next = createRecordingStore({ directory });
  assert.equal(next.read(s.id).session.status, 'partial');
  writeFileSync(join(directory, `${s.id}-0.json`), '{');
  const result = next.read(s.id); assert.equal(result.records.length, 1); assert.equal(result.gaps.length, 1); assert.equal(result.complete, false); next.close();
});
test('export uses allowlisted data and replay is inert; delete leaves checkpoint', async t => {
  const { directory, store } = setup(t); writeFileSync(join(directory, 'checkpoint.json'), '{}');
  const s = store.start({ ...provenance, credential: 'secret' });
  await store.append(s.id, { ...observation, providerKey: 'secret' }); store.stop(s.id);
  const result = store.replay(s.id); assert.equal(result.complete, true); assert.equal(result.canResume, false);
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(result.records[0].eventId, `${s.id}:0`);
  assert.equal(validateRecordingExport(store.export(s.id)).session.checkpointId, 'saved');
  assert.throws(() => validateRecordingExport({ ...result, schemaVersion: 2 }), /incompatible/);
  store.delete(s.id); assert.deepEqual(store.list(), []); store.close();
});
test('quotas and missing participants never claim completion', async t => {
  const { store } = setup(t, { maxBytes: 1, maxSessions: 1 }); const s = store.start({ ...provenance, participantIds: ['fly', 'partner'] });
  assert.equal((await store.append(s.id, observation)).accepted, false);
  assert.equal(store.read(s.id).complete, false); assert.equal(store.status().usedBytes, 0);
  assert.throws(() => store.start(provenance), /limit/); store.close();
});
test('disk failures and busy writer bound buffering and expose lost samples', async t => {
  let release; const { store } = setup(t, { writeChunk: () => new Promise((resolve, reject) => { release = () => reject(Object.assign(new Error('full'), { code: 'ENOSPC' })); }) });
  const s = store.start(provenance); const pending = store.append(s.id, observation);
  assert.equal((await store.append(s.id, observation)).accepted, false); release(); await pending;
  assert.equal(store.read(s.id).session.droppedSamples, 2); assert.match(store.read(s.id).session.failure, /ENOSPC/); store.close();
});
test('out of order and nonfinite telemetry is rejected with explicit gaps', async t => {
  const { store } = setup(t); const s = store.start(provenance); await store.append(s.id, observation);
  assert.equal((await store.append(s.id, { ...observation, simulationTimeMs: 50 })).accepted, false);
  assert.equal((await store.append(s.id, { ...observation, ratesHz: [Infinity] })).accepted, false);
  assert.equal(store.stop(s.id).status, 'partial'); store.close();
});
test('index record cap and source session transitions stop recording', async t => {
  const { store } = setup(t, { maxRecords: 1 }); const s = store.start(provenance);
  await store.append(s.id, observation); assert.equal((await store.append(s.id, observation)).session.status, 'partial');
  const second = store.start(provenance); assert.equal((await store.append(second.id, { ...observation, sessionId: 'restored' })).session.status, 'partial'); store.close();
});
test('restart removes only owned orphan chunks and rejects oversized corrupt content', async t => {
  const { directory, store } = setup(t); const s = store.start(provenance); await store.append(s.id, observation); store.close();
  writeFileSync(join(directory, `${s.id}-99.json`), 'orphan'); writeFileSync(join(directory, 'checkpoint.json'), 'preserve');
  writeFileSync(join(directory, `${s.id}-0.json`), 'x'.repeat(70000));
  const next = createRecordingStore({ directory }); assert.equal(next.read(s.id).gaps.length, 1);
  const { existsSync } = await import('node:fs'); assert.equal(existsSync(join(directory, `${s.id}-99.json`)), false);
  assert.equal(existsSync(join(directory, 'checkpoint.json')), true); next.close();
});
test('export validation rejects secret fields, invalid numeric telemetry and incomplete claims', async t => {
  const { store } = setup(t); const s = store.start(provenance); await store.append(s.id, observation); store.stop(s.id);
  for (const change of [v => { v.session.credential = 'bad'; }, v => { v.records[0].ratesHz = [NaN]; }, v => { v.session.schemaVersion = 2; }, v => { v.session.droppedSamples = 1; }]) {
    const v = store.export(s.id); change(v); assert.throws(() => validateRecordingExport(v), /incompatible/);
  } store.close();
});
