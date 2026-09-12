import { randomUUID, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnvironmentAdapter } from './environment-adapter.js';
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
export function acquireIdentityStoreLock(directory) {
  const database = new DatabaseSync(join(directory, 'writer.sqlite'));
  try {
    database.exec('CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');
    return () => database.close();
  } catch {
    database.close();
    throw new Error('Identity store is already open or its writer lock is unavailable.');
  }
}

export function validateIdentityDocument(saved) {
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
export function openIdentityStore(directory, { write = atomicWrite, loadPrimary = true, residentIds = [] } = {}) {
  if (!Array.isArray(residentIds) || residentIds.some(id => !uuid(id)) || new Set(residentIds).size !== residentIds.length) {
    throw new RuntimeError('Additional resident IDs must be a unique list of saved individual IDs.');
  }
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const release = acquireIdentityStoreLock(directory);
  const path = join(directory, 'identities.json');
  let saved, runtime, closed = false;
  const runtimes = new Map();
  const environments = new Map();
  const controllerTokens = new Map();
  const persistenceErrors = new Map();
  const persist = candidate => {
    const text = JSON.stringify(candidate);
    if (Buffer.byteLength(text) > MAX_BYTES) throw new RuntimeError('Identity storage limit reached. Preserve/export the store before continuing.', 409);
    write(path, text);
    saved = candidate;

  };
  const entry = (payload, parentId = null) => ({ checkpointId: randomUUID(), parentId,
    createdAt: new Date().toISOString(), payload, sha256: digest(payload) });
  try {
    try {
      if (statSync(path).size > MAX_BYTES) fail();
      saved = validateIdentityDocument(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (residentIds.length) throw new RuntimeError('Cannot select saved residents when initializing a new store.');
      const individualId = randomUUID();
      runtime = createRuntime({ individualId });
      const checkpoint = entry(runtime.checkpoint());
      persist({ schemaVersion: 1, primaryId: individualId, individuals: [{ individualId,
        createdAt: checkpoint.createdAt, branchOf: null, head: checkpoint.checkpointId, checkpoints: [checkpoint] }] });
    }
    // The caller's admission layer selects residency; browser reads never do.
    for (const id of new Set([...(loadPrimary ? [saved.primaryId] : []), ...residentIds])) {
      const record = recordFor(id);
      runtimes.set(id, createRuntime({ individualId: id, checkpoint: checkpointFor(record, record.head).payload }));
    }
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
    const resident = runtimes.has(id);
    if (!resident && !replicaSessions.has(id)) replicaSessions.set(id, randomUUID());
    const state = resident ? runtimes.get(id).snapshot() : createRuntime({ individualId: id, sessionId: replicaSessions.get(id),
      checkpoint: checkpointFor(record, record.head).payload }).snapshot();
    return { ...state, environmentAdapter: environmentSnapshot(id, state), ...(resident ? {} : { status: 'saved-unloaded' }), persistence: { mode: 'durable-fixture',
      checkpointId: record.head, branchOf: structuredClone(record.branchOf), checkpointCount: record.checkpoints.length,
      savedSimTimeMs: checkpointFor(record, record.head).payload.dynamics.tick * 5,
      error: persistenceErrors.get(id) ?? null, resident,
      disclosure: 'Explicit saves only. Restore cancels optional input but retains spent reservations. Explicit loads start paused. Dataset workers are not integrated.' } };
  }
  function requireResident(id) {
    recordFor(id);
    if (!runtimes.has(id)) throw new RuntimeError('Individual is saved-unloaded; explicitly load it before control.', 409);
    return runtimes.get(id);
  }
  function guarded(id, operation) {
    try { persistenceErrors.delete(id); return operation(); }
    catch (error) {
      const message = 'Persistence operation failed; previous checkpoint preserved.';
      persistenceErrors.set(id, message);
      runtimes.get(id)?.pauseFault(message);
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
    const runtime = requireResident(id);
    return guarded(id, () => {
      storeCheckpoint(id, runtime.checkpoint());
      return snapshot(id);
    });
  }
  function restore(id, checkpointId) {
    const runtime = requireResident(id);
    return guarded(id, () => {
      const record = recordFor(id);
      const checkpoint = checkpointFor(record, checkpointId);
      // Construct/validate before replacing either live state or the durable head.
      assertCheckpointPolicyContinuity(runtime.checkpoint(), checkpoint.payload);
      const restored = createRuntime({ individualId: id, checkpoint: checkpoint.payload });
      const next = structuredClone(saved);
      next.individuals.find(value => value.individualId === id).head = checkpoint.checkpointId;
      persist(next);
      detachEnvironment(id);
      runtimes.set(id, restored);
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
    guarded(id, () => persist(next));
    return snapshot(individualId);
  }
  // Capacity policy belongs to the caller. These primitives never start a clock.
  function create() {
    recordFor(saved.primaryId);
    if (saved.individuals.length >= MAX_IDENTITIES) throw new RuntimeError('Saved identity storage limit reached.', 409);
    const individualId = randomUUID();
    const initial = entry(createRuntime({ individualId }).checkpoint());
    const next = structuredClone(saved);
    next.individuals.push({ individualId, createdAt: initial.createdAt, branchOf: null,
      head: initial.checkpointId, checkpoints: [initial] });
    persist(next);
    return snapshot(individualId);
  }
  function load(id) {
    const record = recordFor(id);
    if (runtimes.has(id)) return snapshot(id);
    const candidate = createRuntime({ individualId: id, checkpoint: checkpointFor(record, record.head).payload });
    runtimes.set(id, candidate);
    replicaSessions.delete(id);
    return snapshot(id);
  }
  function unload(id) {
    const runtime = requireResident(id);
    // Durable save must succeed before residency is released; failures preserve/fault the individual.
    save(id);
    detachEnvironment(id);
    runtime.control('pause');
    runtimes.delete(id);
    replicaSessions.delete(id);
    return snapshot(id);
  }
  function environmentSnapshot(id, state) {
    recordFor(id);
    const adapter = environments.get(id);
    if (adapter) return { attached: true, ...adapter.snapshot() };
    return { attached: false, individualId: id, sessionId: (state ?? requireOrSavedState(id)).sessionId,
      pose: null, disclosure: 'Visual adapter detached. Body illustration is not controlled by the fixture.' };
  }
  function requireOrSavedState(id) {
    if (runtimes.has(id)) return runtimes.get(id).snapshot();
    if (!replicaSessions.has(id)) replicaSessions.set(id, randomUUID());
    return { sessionId: replicaSessions.get(id) };
  }
  function detachEnvironment(id) {
    environments.get(id)?.invalidate('Visual adapter explicitly detached.');
    environments.delete(id);
    controllerTokens.delete(id);
  }
  function environmentControl(id, action) {
    const runtime = requireResident(id);
    if (!['attach', 'detach'].includes(action)) throw new RuntimeError('Unknown environment action.');
    if (action === 'detach') detachEnvironment(id);
    else {
      runtime.control('pause');
      if (environments.has(id)) environments.get(id).invalidate('Explicit controller takeover; paused with a new epoch.');
      else environments.set(id, createEnvironmentAdapter(runtime));
      const controllerToken = randomBytes(32).toString('hex');
      controllerTokens.set(id, controllerToken);
      // This one response is the only token delivery; no snapshots/checkpoints/telemetry contain it.
      return { ...snapshot(id), controllerToken };
    }
    return snapshot(id);
  }
  function environmentFrame(id, frame) {
    requireResident(id);
    const adapter = environments.get(id);
    if (!adapter) throw new RuntimeError('Explicitly attach the visual adapter first.', 409);
    const token = controllerTokens.get(id);
    if (!token || typeof frame?.controllerToken !== 'string' || !/^[a-f0-9]{64}$/.test(frame.controllerToken)
      || !timingSafeEqual(Buffer.from(frame.controllerToken, 'hex'), Buffer.from(token, 'hex'))) {
      throw new RuntimeError('Controller lease missing or revoked; explicitly attach this tab to take control.', 409);
    }
    const { controllerToken, ...retinalFrame } = frame;
    try { return { trace: adapter.accept(retinalFrame), environment: environmentSnapshot(id), state: snapshot(id) }; }
    catch (error) { throw error.statusCode ? error : new RuntimeError(error.message, 409); }
  }
  function stepIndividual(id) {
    const runtime = requireResident(id);
    const adapter = environments.get(id);
    if (adapter) adapter.checkFreshness();
    else runtime.step();
  }
  return { environmentSnapshot, environmentControl, environmentFrame, create, createIndividual: create, load, unload, primaryId: saved.primaryId, snapshot, save, restore, replica,
    list: () => saved.individuals.map(record => ({ individualId: record.individualId, branchOf: structuredClone(record.branchOf),
      dataset: structuredClone(checkpointFor(record, record.head).payload.dataset),
      checkpointId: record.head, resident: runtimes.has(record.individualId) })),
    checkpoints: id => recordFor(id).checkpoints.map(({ payload, ...metadata }) => ({ ...metadata, simTimeMs: payload.dynamics.tick * 5 })),
    control: (id, action) => {
      const runtime = requireResident(id);
      if (!['start', 'pause', 'rest', 'home'].includes(action)) throw new RuntimeError('Unknown control action.');
      if (action === 'home') detachEnvironment(id);
      else environments.get(id)?.invalidate('Explicit lifecycle command rotated the controller epoch.');
      runtime.control(action);
      return snapshot(id);
    },
    encounter: (id, compoundId) => {
      const runtime = requireResident(id);
      const current = runtime.snapshot();
      if (compoundId === 'quiet' || current.status !== 'running') {
        runtime.encounter(compoundId);
        return snapshot(id);
      }
      // Validate/stage on a detached copy. Existing recovery prevents overlap with active input.
      const staged = createRuntime({ individualId: id, sessionId: current.sessionId, checkpoint: runtime.checkpoint() });
      staged.control('start');
      staged.encounter(compoundId);
      return guarded(id, () => {
        storeCheckpoint(id, staged.checkpoint());
        // No await/step can interleave: admission was validated against this exact live state.
        runtime.encounter(compoundId);
        return snapshot(id);
      });
    },
    step: id => { if (!closed) { if (id === undefined) { for (const id of runtimes.keys()) stepIndividual(id); } else stepIndividual(id); } },
    close: () => { if (!closed) { for (const id of environments.keys()) detachEnvironment(id); for (const resident of runtimes.values()) resident.control('pause'); closed = true; release(); } },
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
