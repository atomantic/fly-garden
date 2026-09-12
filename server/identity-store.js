import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRuntime, RuntimeError, branchRuntimeCheckpoint, assertCheckpointPolicyContinuity } from './runtime.js';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_IDENTITIES = 64;
const MAX_CHECKPOINTS = 64;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = () => { throw new RuntimeError('Identity store is corrupt or incompatible; existing files were preserved.', 409); };

/** SQLite's OS-backed exclusive lock is released automatically on process death. */
function acquireLock(directory) {
  const database = new DatabaseSync(join(directory, 'writer.sqlite'));
  try {
    database.exec('CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    return () => database.close();
  } catch {
    database.close();
    throw new Error('Identity store is already open or its writer lock is unavailable.');
  }
}

function validate(saved) {
  if (!exact(saved, ['schemaVersion', 'primaryId', 'individuals']) || saved.schemaVersion !== 1
    || !uuid(saved.primaryId) || !Array.isArray(saved.individuals) || !saved.individuals.length
    || saved.individuals.length > MAX_IDENTITIES) fail();
  const ids = new Set();
  const all = new Map();
  for (const record of saved.individuals) {
    if (!exact(record, ['individualId', 'createdAt', 'branchOf', 'head', 'checkpoints']) || !uuid(record.individualId)
      || ids.has(record.individualId) || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
      || !uuid(record.head) || !Array.isArray(record.checkpoints) || !record.checkpoints.length || record.checkpoints.length > MAX_CHECKPOINTS) fail();
    ids.add(record.individualId);
    const seen = new Set();
    for (const checkpoint of record.checkpoints) {
      if (!exact(checkpoint, ['checkpointId', 'parentId', 'createdAt', 'payload', 'sha256']) || !uuid(checkpoint.checkpointId)
        || all.has(checkpoint.checkpointId) || (checkpoint.parentId !== null && !seen.has(checkpoint.parentId))
        || typeof checkpoint.createdAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.createdAt))
        || checkpoint.sha256 !== digest(checkpoint.payload)) fail();
      createRuntime({ individualId: record.individualId, checkpoint: checkpoint.payload });
      seen.add(checkpoint.checkpointId);
      all.set(checkpoint.checkpointId, record.individualId);
    }
    if (!seen.has(record.head)) fail();
  }
  if (!ids.has(saved.primaryId)) fail();
  const predecessors = new Set();
  for (const record of saved.individuals) {
    if (record.branchOf !== null && (!exact(record.branchOf, ['individualId', 'checkpointId'])
      || all.get(record.branchOf.checkpointId) !== record.branchOf.individualId
      || !predecessors.has(record.branchOf.individualId))) fail();
    predecessors.add(record.individualId);
  }
  return saved;
}

/** Atomic whole-store replacement keeps checkpoint data and lineage in one transaction. No imported paths or credentials. */
export function openIdentityStore(directory, { write = atomicWrite } = {}) {
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const release = acquireLock(directory);
  const path = join(directory, 'identities.json');
  let saved, runtime, closed = false, persistenceError = null;
  const persist = candidate => {
    const text = JSON.stringify(candidate);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new RuntimeError('Identity storage limit reached. Preserve/export the store before continuing.', 409);
    write(path, text);
    saved = candidate;
    persistenceError = null;
  };
  const entry = (payload, parentId = null) => ({ checkpointId: randomUUID(), parentId,
    createdAt: new Date().toISOString(), payload, sha256: digest(payload) });
  try {
    try {
      if (statSync(path).size > MAX_BYTES) fail();
      saved = validate(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const individualId = randomUUID();
      runtime = createRuntime({ individualId });
      const checkpoint = entry(runtime.checkpoint());
      persist({ schemaVersion: 1, primaryId: individualId, individuals: [{ individualId,
        createdAt: checkpoint.createdAt, branchOf: null, head: checkpoint.checkpointId, checkpoints: [checkpoint] }] });
    }
    const record = saved.individuals.find(value => value.individualId === saved.primaryId);
    runtime = createRuntime({ individualId: saved.primaryId,
      checkpoint: record.checkpoints.find(value => value.checkpointId === record.head).payload });
  } catch (error) { release(); throw error; }

  function recordFor(id) {
    if (closed) throw new RuntimeError('Identity store is closed.', 503);
    const record = saved.individuals.find(value => value.individualId === id);
    if (!record) throw new RuntimeError('Individual not found.', 404);
    return record;
  }
  function checkpointFor(record, id) {
    const checkpoint = record.checkpoints.find(value => value.checkpointId === id);
    if (!checkpoint) throw new RuntimeError('Checkpoint does not belong to this individual.', 404);
    return checkpoint;
  }
  const replicaSessions = new Map();
  function snapshot(id = saved.primaryId) {
    const record = recordFor(id);
    const resident = id === saved.primaryId;
    if (!resident && !replicaSessions.has(id)) replicaSessions.set(id, randomUUID());
    const state = resident ? runtime.snapshot() : createRuntime({ individualId: id, sessionId: replicaSessions.get(id),
      checkpoint: checkpointFor(record, record.head).payload }).snapshot();
    return { ...state, ...(resident ? {} : { status: 'saved-unloaded' }), persistence: { mode: 'durable-fixture',
      checkpointId: record.head, branchOf: record.branchOf, checkpointCount: record.checkpoints.length,
      savedSimTimeMs: checkpointFor(record, record.head).payload.dynamics.tick * 5,
      error: persistenceError, resident,
      disclosure: 'Explicit saves only. Restore cancels optional input but retains spent reservations. Saved replicas are unloaded; dataset workers and capacity admission are not integrated.' } };
  }
  function requireResident(id) {
    recordFor(id);
    if (id !== saved.primaryId) throw new RuntimeError('Saved replica is unloaded. Population admission is not implemented.', 409);
  }
  function guarded(operation) {
    try { return operation(); }
    catch (error) {
      persistenceError = 'Persistence operation failed; previous checkpoint preserved.';
      runtime.pauseFault(persistenceError);
      throw error;
    }
  }
  function storeCheckpoint(id, payload) {
    const record = recordFor(id);
    if (record.checkpoints.length >= MAX_CHECKPOINTS) throw new RuntimeError('Checkpoint history limit reached; no history was deleted.', 409);
    const checkpoint = entry(payload, record.head);
    const next = structuredClone(saved);
    const replacement = next.individuals.find(value => value.individualId === id);
    replacement.checkpoints.push(checkpoint);
    replacement.head = checkpoint.checkpointId;
    persist(next);
  }
  function save(id = saved.primaryId) {
    requireResident(id);
    return guarded(() => {
      storeCheckpoint(id, runtime.checkpoint());
      return snapshot(id);
    });
  }
  function restore(id, checkpointId) {
    requireResident(id);
    return guarded(() => {
      const record = recordFor(id);
      const checkpoint = checkpointFor(record, checkpointId);
      // Construct/validate before replacing either live state or the durable head.
      assertCheckpointPolicyContinuity(runtime.checkpoint(), checkpoint.payload);
      const restored = createRuntime({ individualId: id, checkpoint: checkpoint.payload });
      const next = structuredClone(saved);
      next.individuals.find(value => value.individualId === id).head = checkpoint.checkpointId;
      persist(next);
      runtime = restored;
      return snapshot(id);
    });
  }
  function replica(id, checkpointId) {
    const record = recordFor(id);
    const checkpoint = checkpointFor(record, checkpointId);
    if (saved.individuals.length >= MAX_IDENTITIES) throw new RuntimeError('Saved identity storage limit reached.', 409);
    const individualId = randomUUID();
    const branched = entry(branchRuntimeCheckpoint(checkpoint.payload, individualId));
    const next = structuredClone(saved);
    next.individuals.push({ individualId, createdAt: branched.createdAt, branchOf: { individualId: id, checkpointId },
      head: branched.checkpointId, checkpoints: [branched] });
    guarded(() => persist(next));
    return snapshot(individualId);
  }
  return { primaryId: saved.primaryId, snapshot, save, restore, replica,
    list: () => saved.individuals.map(record => ({ individualId: record.individualId, branchOf: record.branchOf,
      checkpointId: record.head, resident: record.individualId === saved.primaryId })),
    checkpoints: id => recordFor(id).checkpoints.map(({ payload, ...metadata }) => ({ ...metadata, simTimeMs: payload.dynamics.tick * 5 })),
    control: (id, action) => { requireResident(id); runtime.control(action); return snapshot(id); },
    encounter: (id, compoundId) => {
      requireResident(id);
      const current = runtime.snapshot();
      if (compoundId === 'quiet' || current.status !== 'running') {
        runtime.encounter(compoundId);
        return snapshot(id);
      }
      // Validate/stage on a detached copy. Existing recovery prevents overlap with active input.
      const staged = createRuntime({ individualId: id, sessionId: current.sessionId, checkpoint: runtime.checkpoint() });
      staged.control('start');
      staged.encounter(compoundId);
      return guarded(() => {
        storeCheckpoint(id, staged.checkpoint());
        // No await/step can interleave: admission was validated against this exact live state.
        runtime.encounter(compoundId);
        return snapshot(id);
      });
    },
    step: () => { if (!closed) runtime.step(); },
    close: () => { if (!closed) { runtime.control('pause'); closed = true; release(); } },
  };
}

function atomicWrite(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
