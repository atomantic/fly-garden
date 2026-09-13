import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, statSync } from 'node:fs';
import { join } from 'node:path';
/** Admission is an engineering resource guard, not a welfare or biological validation. */
export const DEFAULT_CAPACITY_SETTINGS = Object.freeze({
  maxResidentFlies: 1,
  maxAggregateMemoryBytes: 512 * 1024 * 1024,
  minFreeMemoryBytes: 256 * 1024 * 1024,
});
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;

export const CAPACITY_REFUSALS = Object.freeze({
  'invalid-residents': 'Resident inventory is unavailable.',
  'resident-limit': 'Configured resident capacity is exhausted; paused loaded individuals count.',
  'unknown-footprint': 'Incremental footprint is unknown; complete a bounded resource measurement before loading.',
  'unknown-resources': 'Current aggregate memory or host headroom is unavailable.',
  'aggregate-memory': 'Loading would exceed the aggregate memory budget.',
  'memory-headroom': 'Loading would consume reserved host memory headroom.',
});
/** Only these local policy codes are public; worker/storage exception messages remain private. */
export class CapacityAdmissionError extends Error {
  constructor(code) {
    if (typeof code !== 'string' || !Object.hasOwn(CAPACITY_REFUSALS, code)) throw new Error('Unknown capacity refusal code');
    super(`Connectome load rejected: ${code}: ${CAPACITY_REFUSALS[code]}`);
    Object.defineProperty(this, 'code', { value: code, enumerable: true });
  }
}

export function validateCapacitySettings(value) {
  const keys = Object.keys(DEFAULT_CAPACITY_SETTINGS);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))
    || !keys.every(key => positive(value[key]))) {
    throw new Error('Capacity settings require positive safe integers for maxResidentFlies, maxAggregateMemoryBytes and minFreeMemoryBytes.');
  }
  return { ...value };
}

/** Estimates must include incremental dataset, worker, renderer and telemetry allocations.
 * Shared graph allocations may be excluded only when an existing allocation is actually reused.
 */
export function estimateFootprint(components) {
  const keys = ['datasetBytes', 'workerBytes', 'rendererBytes', 'telemetryBytes'];
  if (!components || !keys.every(key => nonnegative(components[key]))) return null;
  const bytes = keys.reduce((sum, key) => sum + components[key], 0);
  return positive(bytes) ? bytes : null;
}

/** residents includes paused and faulted loaded instances; saved-unloaded identities are absent.
 * availableMemoryBytes is current OS free memory, after existing processes; do not subtract
 * resident allocations again. aggregateMemoryBytes includes all supervisor/worker allocations.
 */
export function assessAdmission({ settings = DEFAULT_CAPACITY_SETTINGS, residents = [],
  incrementalMemoryBytes, aggregateMemoryBytes, availableMemoryBytes }) {
  settings = validateCapacitySettings(settings);
  const reject = code => ({ admitted: false, code, reason: CAPACITY_REFUSALS[code] });
  if (!Array.isArray(residents)) return reject('invalid-residents');
  if (residents.length >= settings.maxResidentFlies) return reject('resident-limit');
  if (!positive(incrementalMemoryBytes)) return reject('unknown-footprint');
  if (!nonnegative(aggregateMemoryBytes) || !nonnegative(availableMemoryBytes)) return reject('unknown-resources');
  if (incrementalMemoryBytes > settings.maxAggregateMemoryBytes - aggregateMemoryBytes) return reject('aggregate-memory');
  if (incrementalMemoryBytes > availableMemoryBytes - settings.minFreeMemoryBytes) return reject('memory-headroom');
  return { admitted: true, code: 'admitted', reason: 'Configured capacity and measured memory headroom permit a paused load.' };
}

export function capacitySnapshot({ settings = DEFAULT_CAPACITY_SETTINGS, residents = [], savedCount = residents.length,
  aggregateMemoryBytes, availableMemoryBytes }) {
  settings = validateCapacitySettings(settings);
  const known = nonnegative(aggregateMemoryBytes) && nonnegative(availableMemoryBytes);
  return {
    settings, residentCount: residents.length,
    runningCount: residents.filter(value => value.status === 'running').length,
    savedUnloadedCount: Math.max(0, savedCount - residents.length),
    excessResidents: Math.max(0, residents.length - settings.maxResidentFlies),
    aggregateMemoryBytes: nonnegative(aggregateMemoryBytes) ? aggregateMemoryBytes : null,
    availableMemoryBytes: nonnegative(availableMemoryBytes) ? availableMemoryBytes : null,
    pressure: !known ? 'unknown' : aggregateMemoryBytes > settings.maxAggregateMemoryBytes
      || availableMemoryBytes < settings.minFreeMemoryBytes ? 'hard-limit' : 'within-budget',
    validatedConnectomeCapacity: null,
    disclosure: 'Configured capacity is an operator ceiling. Fixture tests do not validate full-dataset single or paired operating envelopes.',
  };
}

/** Persist first: failed saves must not change active policy. No creation, eviction or start. */
export function createCapacityPolicy({ settings = DEFAULT_CAPACITY_SETTINGS, persist = () => {} } = {}) {
  let current = validateCapacitySettings(settings);
  return {
    settings: () => ({ ...current }),
    configure(next) {
      const validated = validateCapacitySettings(next);
      persist({ ...validated });
      current = validated;
      return { ...current };
    },
    preflight: resources => assessAdmission({ ...resources, settings: current }),
    snapshot: resources => capacitySnapshot({ ...resources, settings: current }),
  };
}

/** Separate versioned local setting file; corrupt input never silently resets policy. */
export function openCapacityStore(directory, { write = writeCapacityAtomic } = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'capacity.json');
  let settings = DEFAULT_CAPACITY_SETTINGS;
  try {
    if (statSync(path).size > 4096) throw new Error('Capacity settings file is too large.');
    const document = JSON.parse(readFileSync(path, 'utf8'));
    if (!document || document.schemaVersion !== 1 || Object.keys(document).length !== 2
      || !Object.hasOwn(document, 'settings')) throw new Error('Unsupported capacity settings schema.');
    settings = validateCapacitySettings(document.settings);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const persist = next => write(path, JSON.stringify({ schemaVersion: 1, settings: next }));
  // Materialize defaults too, so backup includes the active operator policy.
  persist(settings);
  return createCapacityPolicy({ settings, persist });
}
function writeCapacityAtomic(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

/** Bounded local fixture allocation probe. No stepping, external calls or worker startup.
 * Includes retained runtime, snapshot and checkpoint allocation, multiplied by four for
 * allocation/serialization overhead. This is a fixture estimate, never a connectome estimate.
 * GC or allocator reuse can make deltas inconclusive; reject rather than invent a footprint.
 */
export function measureFixtureFootprint(createPausedRuntime, { memoryUsage = process.memoryUsage,
  maxProbeBytes = 16 * 1024 * 1024, sampleCount = 4 } = {}) {
  if (!positive(maxProbeBytes) || !positive(sampleCount) || sampleCount > 8) throw new Error('Invalid bounded fixture probe settings.');
  const before = memoryUsage();
  const retained = [];
  let largest = 0;
  for (let i = 0; i < sampleCount; i++) {
    const runtime = createPausedRuntime();
    const snapshot = runtime.snapshot();
    if (snapshot.status !== 'paused') return { incrementalMemoryBytes: null, reason: 'Probe runtime did not start paused.' };
    retained.push({ runtime, snapshot, checkpoint: runtime.checkpoint() });
    const current = memoryUsage();
    const heapDelta = current.heapUsed - before.heapUsed;
    const rssDelta = current.rss - before.rss;
    if (![heapDelta, rssDelta].every(Number.isFinite)) return { incrementalMemoryBytes: null, reason: 'Memory measurement unavailable.' };
    if (Math.max(heapDelta, rssDelta) > maxProbeBytes) return { incrementalMemoryBytes: null, reason: 'Bounded fixture allocation probe exceeded its limit.' };
    largest = Math.max(largest, heapDelta, rssDelta);
  }
  // Use the entire retained batch as the per-instance estimate, intentionally conservative.
  const bytes = Math.ceil(largest * 4);
  return { incrementalMemoryBytes: positive(bytes) ? bytes : null,
    reason: positive(bytes) ? 'Measured paused fixture allocation batch with fourfold overhead; excludes real dataset workers and browser rendering.' : 'Allocation delta was inconclusive; admission requires a new measurement.',
    sampleCount, measuredAllocationBytes: largest, backend: 'synthetic-fixture' };
}
