import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAPACITY_SETTINGS, validateCapacitySettings, estimateFootprint, assessAdmission, createCapacityPolicy, CapacityAdmissionError, CAPACITY_REFUSALS } from './population-capacity.js';
const settings = { maxResidentFlies: 2, maxAggregateMemoryBytes: 1000, minFreeMemoryBytes: 100 };
const resources = { residents: [], incrementalMemoryBytes: 100, aggregateMemoryBytes: 100, availableMemoryBytes: 1000 };

test('default one and configured two/four count every loaded paused worker', () => {
  assert.equal(DEFAULT_CAPACITY_SETTINGS.maxResidentFlies, 1);
  for (const limit of [1, 2, 4]) {
    const policy = createCapacityPolicy({ settings: { ...settings, maxResidentFlies: limit } });
    const residents = [];
    for (let i = 0; i < limit; i++) {
      assert.equal(policy.preflight({ ...resources, residents }).admitted, true);
      residents.push({ individualId: String(i), status: 'paused' });
    }
    assert.equal(policy.preflight({ ...resources, residents }).code, 'resident-limit');
    residents.pop();
    assert.equal(policy.preflight({ ...resources, residents }).admitted, true);
  }
});
test('invalid settings are rejected and failed persistence leaves policy unchanged', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of Object.keys(settings)) assert.throws(() => validateCapacitySettings({ ...settings, [key]: value }));
  }
  assert.throws(() => validateCapacitySettings({ ...settings, extra: true }));
  const policy = createCapacityPolicy({ settings, persist() { throw new Error('disk full'); } });
  assert.throws(() => policy.configure({ ...settings, maxResidentFlies: 4 }), /disk full/);
  assert.deepEqual(policy.settings(), settings);
});
test('resource unknowns and exact memory boundaries fail closed without altering residents', () => {
  const residents = [{ individualId: 'a', status: 'running' }];
  const original = structuredClone(residents);
  const check = overrides => assessAdmission({ settings, ...resources, residents, ...overrides });
  assert.equal(check({ incrementalMemoryBytes: null }).code, 'unknown-footprint');
  assert.equal(check({ aggregateMemoryBytes: NaN }).code, 'unknown-resources');
  assert.equal(check({ availableMemoryBytes: undefined }).code, 'unknown-resources');
  assert.equal(check({ aggregateMemoryBytes: 901 }).code, 'aggregate-memory');
  assert.equal(check({ availableMemoryBytes: 199 }).code, 'memory-headroom');
  assert.equal(check({ aggregateMemoryBytes: 900, availableMemoryBytes: 200 }).admitted, true);
  assert.deepEqual(residents, original);
});
test('lowering capacity preserves residents and shows excess; increases do not create or run', () => {
  const policy = createCapacityPolicy({ settings });
  const residents = [{ individualId: 'a', status: 'running' }, { individualId: 'b', status: 'paused' }];
  const before = structuredClone(residents);
  policy.configure({ ...settings, maxResidentFlies: 1 });
  const state = policy.snapshot({ ...resources, residents, savedCount: 3 });
  assert.equal(state.excessResidents, 1);
  assert.equal(state.runningCount, 1);
  assert.equal(state.savedUnloadedCount, 1);
  assert.equal(state.validatedConnectomeCapacity, null);
  assert.equal(policy.preflight({ ...resources, residents }).admitted, false);
  policy.configure({ ...settings, maxResidentFlies: 4 });
  assert.deepEqual(residents, before);
});
test('resource pressure is explicit and component estimates never silently omit unknown allocations', () => {
  const policy = createCapacityPolicy({ settings });
  assert.equal(policy.snapshot(resources).pressure, 'within-budget');
  assert.equal(policy.snapshot({ ...resources, aggregateMemoryBytes: 1001 }).pressure, 'hard-limit');
  assert.equal(policy.snapshot({ ...resources, availableMemoryBytes: null }).pressure, 'unknown');
  assert.equal(estimateFootprint({ datasetBytes: 50, workerBytes: 20, rendererBytes: 0, telemetryBytes: 30 }), 100);
  assert.equal(estimateFootprint({ datasetBytes: 50, workerBytes: 20, telemetryBytes: 30 }), null);
  assert.equal(estimateFootprint({ datasetBytes: Number.MAX_SAFE_INTEGER, workerBytes: 20, rendererBytes: 0, telemetryBytes: 30 }), null);
});

test('versioned capacity settings survive reopen and corruption is preserved', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openCapacityStore } = await import('./population-capacity.js');
  const directory = mkdtempSync(join(tmpdir(), 'fly-capacity-'));
  try {
    const store = openCapacityStore(directory);
    assert.equal(store.settings().maxResidentFlies, 1);
    store.configure(settings);
    assert.deepEqual(openCapacityStore(directory).settings(), settings);
    const before = readFileSync(join(directory, 'capacity.json'), 'utf8');
    const failing = openCapacityStore(directory, { write() {} });
    assert.throws(() => failing.configure({ ...settings, maxResidentFlies: 0 }));
    assert.equal(readFileSync(join(directory, 'capacity.json'), 'utf8'), before);
    writeFileSync(join(directory, 'capacity.json'), '{broken');
    assert.throws(() => openCapacityStore(directory));
    assert.equal(readFileSync(join(directory, 'capacity.json'), 'utf8'), '{broken');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('bounded fixture probe stays paused and rejects unknown or excessive allocations', async () => {
  const { measureFixtureFootprint } = await import('./population-capacity.js');
  const fixture = () => ({ snapshot: () => ({ status: 'paused' }), checkpoint: () => ({ tick: 0 }) });
  let used = 100;
  const result = measureFixtureFootprint(fixture, { memoryUsage: () => ({ heapUsed: used += 100, rss: 1000 }) });
  assert.equal(result.incrementalMemoryBytes, 1600);
  assert.equal(result.backend, 'synthetic-fixture');
  assert.equal(measureFixtureFootprint(fixture, { memoryUsage: () => ({ heapUsed: 0, rss: 0 }) }).incrementalMemoryBytes, null);
  assert.equal(measureFixtureFootprint(fixture, { memoryUsage: () => ({ heapUsed: used += 100, rss: 1000 }), maxProbeBytes: 50 }).incrementalMemoryBytes, null);
  assert.equal(measureFixtureFootprint(() => ({ snapshot: () => ({ status: 'running' }) })).incrementalMemoryBytes, null);
});

test('public admission errors accept only canonical local policy codes',()=>{
 for(const code of Object.keys(CAPACITY_REFUSALS)){const error=new CapacityAdmissionError(code);assert.equal(error.code,code);assert(error.message.includes(CAPACITY_REFUSALS[code]));}
 for(const code of ['PRIVATE_PATH','toString','__proto__',null,['resident-limit']])assert.throws(()=>new CapacityAdmissionError(code));
});
