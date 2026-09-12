import { randomUUID, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEncounterDynamics, ENCOUNTER_CATALOG, GARDEN_ENCOUNTER_FLOWERS } from './encounter-dynamics.js';
import { createFixtureSharedSession, validateSharedPose } from './fixture-shared-session.js';
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
  if (!(saved?.schemaVersion === 1 && exact(saved, ['schemaVersion', 'primaryId', 'individuals'])
    || saved?.schemaVersion === 2 && exact(saved, ['schemaVersion', 'primaryId', 'individuals', 'jointCheckpoints']))
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
  if (saved.schemaVersion === 2) {
    if (!Array.isArray(saved.jointCheckpoints) || saved.jointCheckpoints.length > MAX_CHECKPOINTS) fail();
    const jointIds = new Set();
    for (const joint of saved.jointCheckpoints) {
      if (!exact(joint, ['jointCheckpointId', 'createdAt', 'payload', 'sha256']) || !uuid(joint.jointCheckpointId)
        || jointIds.has(joint.jointCheckpointId) || typeof joint.createdAt !== 'string' || !Number.isFinite(Date.parse(joint.createdAt))
        || joint.sha256 !== digest(joint.payload) || !exact(joint.payload, ['intervalMs', 'tick', 'members'])
        || joint.payload.intervalMs !== 5 || !Number.isSafeInteger(joint.payload.tick) || joint.payload.tick < 0
        || !Number.isSafeInteger(joint.payload.tick * 5) || !Array.isArray(joint.payload.members)
        || joint.payload.members.length < 2 || joint.payload.members.length > MAX_IDENTITIES) fail();
      jointIds.add(joint.jointCheckpointId);
      const memberIds = new Set();
      for (const member of joint.payload.members) {
        if (!exact(member, ['individualId', 'checkpointId', 'simTimeMs', 'pose']) || memberIds.has(member.individualId)
          || all.get(member.checkpointId) !== member.individualId) fail();
        memberIds.add(member.individualId); validateSharedPose(member.pose);
        const record = saved.individuals.find(record => record.individualId === member.individualId);
        const checkpoint = record.checkpoints.find(checkpoint => checkpoint.checkpointId === member.checkpointId);
        if (member.simTimeMs !== checkpoint.payload.dynamics.tick * 5) fail();
      }
    }
  }
  return saved;
}

/** Atomic whole-store replacement keeps checkpoint data and lineage in one transaction. No imported paths or credentials. */
export function openIdentityStore(directory, { write = atomicWrite, loadPrimary = true, residentIds = [], encounterFlowers = GARDEN_ENCOUNTER_FLOWERS } = {}) {
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
  const encounterAdapters = new Map();
  const persistenceErrors = new Map();
  const sharedSessions = new Map(), sharedOwners = new Map(), sharedTokens = new Map();
  const externalOwners = new Map();
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
    return { ...state, externalOwner: externalOwners.has(id) ? { kind: 'managed-visitor' } : null, sharedSession: sharedOwners.has(id) ? sharedSessions.get(sharedOwners.get(id)).snapshot() : null, environmentAdapter: environmentSnapshot(id, state), encounterDynamics: encounterDynamicsSnapshot(id, state), ...(resident ? {} : { status: 'saved-unloaded' }), persistence: { mode: 'durable-fixture',
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
  function requireExternalFree(id) {
    if (externalOwners.has(id)) throw new RuntimeError('A managed visitor owns this individual; use its scoped pause, rest or home flow until confirmed return.', 409);
  }
  function requireIndependent(id) {
    requireExternalFree(id);
    if (sharedOwners.has(id)) throw new RuntimeError('Individual belongs to a shared session; explicitly separate it before independent control or persistence.', 409);
  }
  function guarded(id, operation) {
    try { persistenceErrors.delete(id); return operation(); }
    catch (error) {
      const message = 'Persistence operation failed; previous checkpoint preserved.';
      persistenceErrors.set(id, message);
      if (sharedOwners.has(id)) sharedSessions.get(sharedOwners.get(id)).pause(message);
      runtimes.get(id)?.pauseFault(message);
      revokeEncounters(id);
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
    requireIndependent(id);
    const runtime = requireResident(id);
    return guarded(id, () => {
      storeCheckpoint(id, runtime.checkpoint());
      return snapshot(id);
    });
  }
  function restore(id, checkpointId) {
    requireIndependent(id);
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
      encounterAdapters.delete(id);
      runtimes.set(id, restored);
      return snapshot(id);
    });
  }
  function replica(id, checkpointId) {
    requireExternalFree(id);
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
    requireExternalFree(id);
    const record = recordFor(id);
    if (runtimes.has(id)) return snapshot(id);
    const candidate = createRuntime({ individualId: id, checkpoint: checkpointFor(record, record.head).payload });
    runtimes.set(id, candidate);
    replicaSessions.delete(id);
    return snapshot(id);
  }
  function unload(id) {
    requireIndependent(id);
    const runtime = requireResident(id);
    // Durable save must succeed before residency is released; failures preserve/fault the individual.
    save(id);
    detachEnvironment(id);
    runtime.control('pause');
    runtimes.delete(id);
    encounterAdapters.delete(id);
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
    revokeEncounters(id);
    environments.get(id)?.invalidate('Visual adapter explicitly detached.');
    environments.delete(id);
    controllerTokens.delete(id);
  }
  function environmentControl(id, action) {
    requireIndependent(id);
    const runtime = requireResident(id);
    if (!['attach', 'detach'].includes(action)) throw new RuntimeError('Unknown environment action.');
    if (action === 'detach') detachEnvironment(id);
    else {
      revokeEncounters(id);
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
    requireIndependent(id);
    requireResident(id);
    const adapter = environments.get(id);
    if (!adapter) throw new RuntimeError('Explicitly attach the visual adapter first.', 409);
    const token = controllerTokens.get(id);
    if (!token || typeof frame?.controllerToken !== 'string' || !/^[a-f0-9]{64}$/.test(frame.controllerToken)
      || !timingSafeEqual(Buffer.from(frame.controllerToken, 'hex'), Buffer.from(token, 'hex'))) {
      throw new RuntimeError('Controller lease missing or revoked; explicitly attach this tab to take control.', 409);
    }
    const { controllerToken, ...retinalFrame } = frame;
    try {
      const trace = adapter.accept(retinalFrame);
      const runtimeState = requireResident(id).snapshot();
      encounterAdapters.get(id)?.update({ individualId: id, sessionId: runtimeState.sessionId,
        environmentEpoch: trace.environmentEpoch, frameId: trace.frameId, simTimeMs: runtimeState.simTimeMs,
        pose: trace.pose, status: runtimeState.status });
      if (requireResident(id).snapshot().status !== 'running') revokeEncounters(id);
      return { trace, environment: environmentSnapshot(id), state: snapshot(id) };
    }
    catch (error) { throw error.statusCode ? error : new RuntimeError(error.message, 409); }
  }
  function stepIndividual(id) {
    if (externalOwners.has(id)) return;
    if (sharedOwners.has(id)) { sharedSessions.get(sharedOwners.get(id)).checkFreshness(); return; }
    const runtime = requireResident(id);
    const adapter = environments.get(id);
    if (adapter) { if (!adapter.checkFreshness()) revokeEncounters(id); }
    else runtime.step();
  }
  function encounterDynamicsSnapshot(id, state) {
    recordFor(id);
    const adapter = encounterAdapters.get(id);
    if (adapter) return adapter.snapshot();
    return { version: 1, individualId: id, sessionId: (state ?? requireOrSavedState(id)).sessionId, enabled: false,
      phase: 'disabled', environmentEpoch: null, contactIds: [], active: null, events: [],
      geometry: structuredClone(encounterFlowers), catalog: structuredClone(ENCOUNTER_CATALOG),
      disclosure: 'Optional engineered contact proxies are disabled. Explicit enablement is required in the running visual session; no biological chemistry or pharmacology.' };
  }
  function revokeEncounters(id) {
    const adapter = encounterAdapters.get(id);
    if (adapter?.snapshot().enabled) adapter.withdraw();
  }
  function durableEncounter(id, source, effectId) {
    const runtime = requireResident(id), state = runtime.snapshot();
    const staged = createRuntime({ individualId: id, sessionId: state.sessionId, checkpoint: runtime.checkpoint() });
    staged.control('start');
    staged.stimulate(source, staged.stimulusEnvelope(source, effectId));
    return guarded(id, () => {
      storeCheckpoint(id, staged.checkpoint());
      runtime.stimulate(source, runtime.stimulusEnvelope(source, effectId));
      return runtime.snapshot().stimulusPolicy.entries.at(-1);
    });
  }
  function encounterDynamicsControl(id, enabled) {
    requireIndependent(id);
    const runtime = requireResident(id);
    if (typeof enabled !== 'boolean') throw new RuntimeError('Encounter enablement must be boolean.');
    if (!enabled) { revokeEncounters(id); return snapshot(id); }
    const environment = environments.get(id);
    if (!environment || runtime.snapshot().status !== 'running') throw new RuntimeError('Explicitly attach and run the visual controller before enabling encounters.', 409);
    let adapter = encounterAdapters.get(id);
    if (!adapter || adapter.snapshot().sessionId !== runtime.snapshot().sessionId) {
      adapter = createEncounterDynamics({ individualId: id, sessionId: runtime.snapshot().sessionId, flowers: encounterFlowers,
        policySnapshot: () => runtime.snapshot().stimulusPolicy,
        admit: request => durableEncounter(id, 'garden', request.effectId),
        cancel: request => runtime.cancelStimulus('garden', request.entryId) });
      encounterAdapters.set(id, adapter);
    }
    adapter.setEnabled(true, environment.snapshot().environmentEpoch);
    return snapshot(id);
  }
  function sharedFor(sharedId) {
    if (closed) throw new RuntimeError('Identity store is closed.', 503);
    const session = sharedSessions.get(sharedId);
    if (!session) throw new RuntimeError('Shared session not found.', 404);
    return session;
  }
  function claimShared(session) {
    for (const id of session.memberIds()) { detachEnvironment(id); encounterAdapters.delete(id); sharedOwners.set(id, session.sharedId); }
    sharedSessions.set(session.sharedId, session);
    const controllerToken = randomBytes(32).toString('hex'); sharedTokens.set(session.sharedId, controllerToken);
    return { ...session.snapshot(), controllerToken };
  }
  function sharedJoin(ids) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_IDENTITIES || new Set(ids).size !== ids.length) throw new RuntimeError('Select distinct loaded shared members.');
    const members = ids.map(id => {
      requireIndependent(id); const runtime = requireResident(id);
      if (runtime.snapshot().status === 'fault') throw new RuntimeError('Restore faulted members before joining.', 409);
      return { runtime, pose: environments.get(id)?.snapshot().pose ?? { x: 0, z: 0, yaw: 0 } };
    });
    const session = createFixtureSharedSession(members);
    session.pause('Explicit shared join; all members paused.');
    return claimShared(session);
  }
  function sharedLeave(sharedId) {
    const session = sharedFor(sharedId); session.pause('Membership withdrawn at the current world boundary.');
    const result = session.snapshot();
    for (const id of session.memberIds()) sharedOwners.delete(id);
    sharedSessions.delete(sharedId); sharedTokens.delete(sharedId);
    return { ...result, status: 'separated' };
  }
  function sharedControl(sharedId, action) {
    const session = sharedFor(sharedId);
    if (action === 'start') session.start();
    else if (action === 'pause') session.pause();
    else throw new RuntimeError('Unknown shared control action.');
    return session.snapshot();
  }
  function sharedFrame(sharedId, batch) {
    const session = sharedFor(sharedId), token = sharedTokens.get(sharedId);
    if (!exact(batch, ['controllerToken', 'worldEpoch', 'worldTick', 'frames']) || typeof batch.controllerToken !== 'string'
      || !/^[a-f0-9]{64}$/.test(batch.controllerToken) || !token
      || !timingSafeEqual(Buffer.from(batch.controllerToken, 'hex'), Buffer.from(token, 'hex'))) throw new RuntimeError('Shared controller lease missing or revoked.', 409);
    const { controllerToken, ...frame } = batch;
    try { return session.accept(frame); }
    catch (error) { throw error.statusCode ? error : new RuntimeError(error.message, 409); }
  }
  function sharedSave(sharedId) {
    const session = sharedFor(sharedId);
    try {
      const state = session.snapshot();
      const next = structuredClone(saved); next.schemaVersion = 2; next.jointCheckpoints ??= [];
      if (next.jointCheckpoints.length >= MAX_CHECKPOINTS) throw new RuntimeError('Joint checkpoint history limit reached; no history was deleted.', 409);
      const members = state.participants.map(member => {
        const record = next.individuals.find(record => record.individualId === member.individualId);
        if (record.checkpoints.length >= MAX_CHECKPOINTS) throw new RuntimeError('Checkpoint history limit reached; no history was deleted.', 409);
        const checkpoint = entry(requireResident(member.individualId).checkpoint(), record.head);
        record.checkpoints.push(checkpoint); record.head = checkpoint.checkpointId;
        return { individualId: member.individualId, checkpointId: checkpoint.checkpointId, simTimeMs: member.simTimeMs, pose: member.pose };
      });
      const payload = { intervalMs: 5, tick: state.tick, members };
      const joint = { jointCheckpointId: randomUUID(), createdAt: new Date().toISOString(), payload, sha256: digest(payload) };
      next.jointCheckpoints.push(joint); validateIdentityDocument(next);
      persist(next);
      return structuredClone(joint);
    } catch (error) {
      session.pause('Joint save failed; previous durable checkpoints preserved.');
      throw error;
    }
  }
  function sharedRestore(jointCheckpointId) {
    recordFor(saved.primaryId);
    const joint = saved.jointCheckpoints?.find(value => value.jointCheckpointId === jointCheckpointId);
    if (!joint) throw new RuntimeError('Joint checkpoint not found.', 404);
    const memberIds = joint.payload.members.map(member => member.individualId), prior = new Set();
    const replacements = joint.payload.members.map(member => {
      requireExternalFree(member.individualId);
      const runtime = requireResident(member.individualId), owner = sharedOwners.get(member.individualId);
      if (owner) {
        if (sharedFor(owner).memberIds().some(id => !memberIds.includes(id))) throw new RuntimeError('Separate overlapping shared membership before joint restore.', 409);
        prior.add(owner);
      }
      const checkpoint = checkpointFor(recordFor(member.individualId), member.checkpointId);
      assertCheckpointPolicyContinuity(runtime.checkpoint(), checkpoint.payload);
      return { runtime: createRuntime({ individualId: member.individualId, checkpoint: checkpoint.payload }), pose: member.pose };
    });
    const session = createFixtureSharedSession(replacements, { tick: joint.payload.tick });
    const next = structuredClone(saved);
    for (const member of joint.payload.members) next.individuals.find(record => record.individualId === member.individualId).head = member.checkpointId;
    // All identity/policy/pose validation completes before the single durable write or ownership change.
    validateIdentityDocument(next); persist(next);
    for (const owner of prior) sharedLeave(owner);
    for (const member of replacements) runtimes.set(member.runtime.snapshot().individualId, member.runtime);
    return claimShared(session);
  }
  function claimExternal(id, ownerId) {
    requireIndependent(id);
    const runtime = requireResident(id);
    if (closed || typeof ownerId !== 'string' || !ownerId || ownerId.length > 128) throw new RuntimeError('Invalid external ownership request.', 409);
    if (runtime.snapshot().source !== 'fixture' || runtime.snapshot().status === 'fault') throw new RuntimeError('Only a healthy resident fixture can acquire visitor ownership.', 409);
    runtime.control('pause');
    detachEnvironment(id); revokeEncounters(id); encounterAdapters.delete(id);
    const owner = { ownerId };
    externalOwners.set(id, owner);
    const isCurrent = () => !closed && externalOwners.get(id) === owner && runtimes.get(id) === runtime;
    const assertCurrent = () => { if (!isCurrent()) throw new RuntimeError('External runtime authority was revoked.', 409); };
    return Object.freeze({
      isCurrent,
      snapshot: () => runtime.snapshot(),
      control: action => { assertCurrent(); return runtime.control(action); },
      prepareStep: input => { assertCurrent(); return runtime.prepareStep(input); },
      previewStep: token => { assertCurrent(); return runtime.previewStep(token); },
      commitStep: token => { assertCurrent(); return runtime.commitStep(token); },
      release: () => { if (externalOwners.get(id) === owner) { if (runtime.snapshot().status === 'running') runtime.control('pause'); externalOwners.delete(id); } },
    });
  }
  return { claimExternal, sharedJoin, sharedLeave, sharedControl, sharedFrame, sharedSave, sharedRestore,
    sharedSnapshot: sharedId => sharedFor(sharedId).snapshot(),
    sharedCheckpoints: () => structuredClone(saved.jointCheckpoints ?? []),
    encounterDynamicsSnapshot, encounterDynamicsControl, environmentSnapshot, environmentControl, environmentFrame, create, createIndividual: create, load, unload, primaryId: saved.primaryId, snapshot, save, restore, replica,
    list: () => saved.individuals.map(record => ({ individualId: record.individualId, branchOf: structuredClone(record.branchOf),
      dataset: structuredClone(checkpointFor(record, record.head).payload.dataset),
      checkpointId: record.head, resident: runtimes.has(record.individualId) })),
    checkpoints: id => recordFor(id).checkpoints.map(({ payload, ...metadata }) => ({ ...metadata, simTimeMs: payload.dynamics.tick * 5 })),
    control: (id, action) => {
      requireExternalFree(id);
      if (sharedOwners.has(id)) {
        if (!['pause', 'rest', 'home'].includes(action)) requireIndependent(id);
        const sharedId = sharedOwners.get(id);
        if (action === 'pause') { sharedSessions.get(sharedId).pause('A member explicitly paused the coupled session.'); return snapshot(id); }
        sharedLeave(sharedId);
      }
      const runtime = requireResident(id);
      if (!['start', 'pause', 'rest', 'home'].includes(action)) throw new RuntimeError('Unknown control action.');
      revokeEncounters(id);
      if (action === 'home') detachEnvironment(id);
      else environments.get(id)?.invalidate('Explicit lifecycle command rotated the controller epoch.');
      runtime.control(action);
      return snapshot(id);
    },
    encounter: (id, compoundId) => {
      requireIndependent(id);
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
