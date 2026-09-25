import { randomUUID } from 'node:crypto';
import { LIF_MODEL } from './sparse-lif.js';
import { RuntimeError } from './runtime.js';
import { CONNECTOME_PROFILES } from './connectome-profiles.js';
import { portableConnectomeProfiles } from './portable-connectome-profiles.js';
import { assessSharedCapacity, createBarrierTelemetry, SHARED_MEASUREMENT_BOUNDS } from './shared-barrier-telemetry.js';
import { connectomeDeclaration, describeDeclarations } from './shared-environment-adapter.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const MAX_MEMBERS = 64;
const WORLD_INTERVAL_MS = 5;
const SUBSTEPS = WORLD_INTERVAL_MS / LIF_MODEL.dtMs;
const MODEL_IDS = Object.freeze(Object.fromEntries(Object.entries(CONNECTOME_PROFILES).map(([dataset, profile]) => [dataset, profile.modelId])));
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
/** Admission requires the adapter contract's fail-closed, channel-free connectome declaration. */
const declared = state => { try { connectomeDeclaration(state); return true; } catch { return false; } };
const disclosure = 'Full-connectome research barrier only. Each complete barrier advances every active pinned graph by five exact 1 ms neural substeps. No retinal input, motor output, body, chemistry, retained learning, biological sex comparison or cloud fallback is present.';

function fail(message, statusCode = 409) { throw new RuntimeError(message, statusCode); }
function safeState(value) {
  if (!value || value.source !== 'connectome' || !value.individualId || !['male-cns:v1.0', 'banc:v888'].includes(value.dataset) || !Number.isSafeInteger(value.commandSequence)
    || typeof value.sessionEpoch !== 'string' || !value.sessionEpoch) fail('Research participant state is unavailable.');
  return value;
}
function envelope(value) {
  return exact(value, ['protocolVersion', 'individualId', 'sessionEpoch', 'commandSequence'])
    && value.protocolVersion === 1 && typeof value.individualId === 'string' && typeof value.sessionEpoch === 'string'
    && Number.isSafeInteger(value.commandSequence);
}
function participantFrom(state, mode = 'active') {
  safeState(state);
  if (state.resident === false && ['unavailable', 'saved-unloaded'].includes(state.status)) return { individualId: state.individualId, sessionEpoch: state.sessionEpoch, dataset: state.dataset,
    mode, status: 'unavailable', tick: null, simTimeMs: null, graphSha256: state.graphSha256 ?? null,
    model: state.model ?? null, capabilities: state.capabilities };
  if (!state.resident || !state.neural || !Number.isSafeInteger(state.neural.tick) || state.neural.tick < 0
    || !Number.isSafeInteger(state.neural.simTimeMs) || state.neural.simTimeMs < 0
    || !/^[a-f0-9]{64}$/.test(state.graphSha256 ?? '') || !['paused', 'running', 'resting'].includes(state.status)) {
    // Reads report an unhealthy resident; only the explicit barrier/start paths act on it.
    if (state.resident === true) return { individualId: state.individualId, sessionEpoch: state.sessionEpoch, dataset: state.dataset,
      mode, status: state.status === 'fault' ? 'fault' : 'unavailable', tick: null, simTimeMs: null, graphSha256: state.graphSha256 ?? null,
      model: state.model ?? null, capabilities: state.capabilities };
    fail('Research participant is not an admitted, healthy resident.');
  }
  return { individualId: state.individualId, sessionEpoch: state.sessionEpoch, dataset: state.dataset,
    mode, status: mode === 'resting' ? 'resting' : state.status, tick: state.neural.tick,
    simTimeMs: state.neural.simTimeMs, graphSha256: state.graphSha256 ?? null,
    model: state.model ?? null, capabilities: state.capabilities };
}

export function createConnectomeSharedSession({ snapshot, control, barrier, invalidate = () => {}, checkpoint, readJointCheckpoint, listJoints, prepareRestore, commitRestore, available = () => true, isReserved = () => false,
  now = () => performance.now(), resources = () => null, memoryUsage = () => process.memoryUsage(), measuredAt = () => new Date().toISOString(),
  runtime = { node: process.version, platform: process.platform, arch: process.arch }, pinned = portableConnectomeProfiles,
  measurementDeadlineMs = SHARED_MEASUREMENT_BOUNDS.deadlineMs } = {}) {
  if (typeof snapshot !== 'function' || typeof control !== 'function' || typeof barrier !== 'function' || typeof invalidate !== 'function'
    || typeof isReserved !== 'function' || [now, resources, memoryUsage, measuredAt, pinned].some(value => typeof value !== 'function') || !runtime || typeof runtime !== 'object'
    || !Number.isSafeInteger(measurementDeadlineMs) || measurementDeadlineMs < 1 || measurementDeadlineMs > 600000
    || (checkpoint !== undefined && typeof checkpoint !== 'function') || (readJointCheckpoint !== undefined && typeof readJointCheckpoint !== 'function')
    || (listJoints !== undefined && typeof listJoints !== 'function') || (prepareRestore !== undefined && typeof prepareRestore !== 'function')
    || (commitRestore !== undefined && typeof commitRestore !== 'function')) throw new Error('Invalid shared connectome service configuration');
  const sessions = new Map();
  const owners = new Map();
  const joining = new Set();
  const pending = new Set();
  let closing = false;
  const owns = id => owners.has(id) || joining.has(id);
  const reserve = id => { if (pending.has(id)) fail('Shared research operation already in progress.'); pending.add(id); };
  const required = () => { if (closing || !available()) fail('Full-connectome shared research is unavailable.', 409); };
  const assertUnreserved = ids => { if (Array.isArray(ids) && ids.some(id => isReserved(id))) fail('Cross-catalog checkpoint coordination is reserved for this research participant.', 409); };
  const sessionFor = id => { required(); const value = sessions.get(id); if (!value) fail('Shared research session not found.', 404); return value; };
  const stateFor = id => safeState(snapshot(id));
  const event = (session, type, extra = {}) => { session.events.push({ type, tick: session.tick, ...extra }); session.events = session.events.slice(-64); };
  const clock = () => { try { return now(); } catch { return Number.NaN; } };
  let pinnedProfiles = null;
  const pinnedReference = () => { try { pinnedProfiles ??= pinned(); } catch { pinnedProfiles = {}; } return pinnedProfiles; };
  const newSession = fields => ({ ...fields, telemetry: createBarrierTelemetry({ intervalMs: WORLD_INTERVAL_MS, substeps: SUBSTEPS }), measurement: null, fault: null, pressure: false });
  function observe(session, sample) {
    try { session.telemetry.record(sample); } catch { /* telemetry is observation-only and cannot change the barrier outcome */ }
  }
  /** Safe aggregate/per-member metadata only: counts, bytes and pinned namespaces, never paths or graph arrays. */
  function resourceView(participants) {
    let value = null;
    try { value = resources(); } catch { value = null; }
    const aggregate = value && typeof value === 'object' ? { residentCount: count(value.residentCount), runningCount: count(value.runningCount),
      maxResidentFlies: count(value.maxResidentFlies), aggregateMemoryBytes: count(value.aggregateMemoryBytes), availableMemoryBytes: count(value.availableMemoryBytes),
      pressure: ['within-budget', 'hard-limit', 'unknown'].includes(value.pressure) ? value.pressure : 'unknown' } : null;
    return { aggregate, reason: aggregate ? null : 'Resource monitoring is unavailable to this session.',
      members: participants.map(participant => ({ individualId: participant.individualId, dataset: participant.dataset, modelId: participant.model?.id ?? null,
        status: participant.status, incrementalMemoryBytes: count(value?.memberMemoryBytes?.[participant.dataset]) })) };
  }
  function health(session, participants) {
    const reasons = [];
    for (const [index, participant] of participants.entries()) {
      if (['fault', 'unavailable'].includes(participant.status)) reasons.push({ individualId: participant.individualId, code: 'participant-fault' });
      else if (participant.sessionEpoch !== session.participants[index].sessionEpoch) reasons.push({ individualId: participant.individualId, code: 'stale-epoch' });
    }
    if (session.fault) reasons.push({ individualId: null, code: session.fault });
    if (session.pressure) reasons.push({ individualId: null, code: 'resource-pressure' });
    const codes = reasons.map(reason => reason.code);
    const state = codes.some(code => code !== 'stale-epoch' && code !== 'resource-pressure') ? 'fault' : codes.includes('stale-epoch') ? 'stale' : codes.includes('resource-pressure') ? 'pressure' : 'nominal';
    return { state, reasons };
  }
  const bundle = session => {
    const states = session.participants.map(member => stateFor(member.individualId));
    const participants = session.participants.map((member, index) => participantFrom(states[index], member.mode));
    const members = states.map((value, index) => session.participants[index].mode === 'resting' ? { ...value, status: 'resting' } : value);
    const resourceSummary = resourceView(participants);
    const capacity = assessSharedCapacity({ measurement: session.measurement, participants, runtime, pinned: session.measurement ? pinnedReference() : {},
      modelIds: MODEL_IDS, substeps: SUBSTEPS, intervalMs: WORLD_INTERVAL_MS });
    return { shared: { protocolVersion: 1, kind: 'full-connectome-research-shared', sharedId: session.sharedId,
      worldEpoch: session.worldEpoch, tick: session.tick, intervalMs: WORLD_INTERVAL_MS, worldTimeMs: session.tick * WORLD_INTERVAL_MS,
      status: session.status, reason: session.reason, commandSequence: session.commandSequence, participants, events: structuredClone(session.events),
      substeps: SUBSTEPS, telemetry: { ...session.telemetry.view(), health: health(session, participants), resources: resourceSummary,
        measurement: structuredClone(session.measurement), capacity: { ...capacity, configuredMaxResidents: resourceSummary.aggregate?.maxResidentFlies ?? null } },
      adapter: describeDeclarations(states), disclosure }, members };
  };
  const view = () => ({ protocolVersion: 1, kind: 'full-connectome-research-shared-view', available: available(), sessions: [...sessions.values()].map(bundle).map(value => value.shared) });
  async function pauseAll(session) {
    return Promise.allSettled(session.participants.map(member => control(member.individualId, 'pause')));
  }
  function pauseFailure(results) {
    return results.find(result => result.status === 'rejected')?.reason?.message || 'A shared research participant could not be paused.';
  }
  async function applyPressurePause(session) {
    if (session.status !== 'running' && !session.pressureRequested) return;
    const paused = await pauseAll(session);
    session.pressureRequested = paused.some(result => result.status === 'rejected');
    session.pressure = true; session.telemetry.recordPressure(session.tick, !session.pressureRequested);
    session.status = 'paused';
    session.reason = session.pressureRequested
      ? `Resource pressure pause incomplete: ${pauseFailure(paused)}`
      : 'Resource pressure paused shared research; explicit shared start required.';
    session.worldEpoch = randomUUID();
    session.commandSequence++;
    event(session, 'pressure-pause');
  }
  async function join(body) {
    required();
    if (!exact(body, ['protocolVersion', 'members']) || body.protocolVersion !== 1 || !Array.isArray(body.members)
      || body.members.length < 2 || body.members.length > MAX_MEMBERS || new Set(body.members.map(member => member?.individualId)).size !== body.members.length) {
      fail('Select 2–64 distinct loaded full-connectome participants.');
    }
    assertUnreserved(body.members.map(member => member.individualId));
    const states = body.members.map(member => {
      if (!envelope(member)) fail('Invalid shared research membership envelope.');
      const state = stateFor(member.individualId);
      if (state.sessionEpoch !== member.sessionEpoch || state.commandSequence !== member.commandSequence || state.resident !== true
        || !declared(state) || owns(member.individualId)) {
        fail('Stale or unavailable shared research participant; refresh the catalog before joining.');
      }
      return state;
    });
    for (const id of states.map(state => state.individualId)) joining.add(id);
    try {
       await Promise.all(states.map(state => control(state.individualId, 'pause')));
       if (closing) fail('Full-connectome shared research is unavailable.');
       const refreshed = states.map(state => stateFor(state.individualId));
      if (refreshed.some((state, index) => state.dataset !== states[index].dataset || state.graphSha256 !== states[index].graphSha256
        || !state.resident || !state.neural || !declared(state))) {
        fail('A shared research participant became unavailable while joining.');
      }
      invalidate(refreshed.map(state => state.individualId));
      const session = newSession({ sharedId: randomUUID(), worldEpoch: randomUUID(), tick: 0, status: 'paused', reason: 'Explicit shared start required.', commandSequence: 0, pressureRequested: false,
        participants: refreshed.map(state => ({ individualId: state.individualId, sessionEpoch: state.sessionEpoch, mode: 'active' })), events: [{ type: 'join', tick: 0 }] });
      sessions.set(session.sharedId, session);
      for (const member of session.participants) owners.set(member.individualId, session.sharedId);
      return bundle(session);
    } catch (error) {
      await Promise.allSettled(states.map(state => control(state.individualId, 'pause')));
      fail(error?.message || 'Shared research participants could not be paused.');
    } finally {
      for (const id of states.map(state => state.individualId)) joining.delete(id);
    }
  }
  function validateControl(session, body, keys) {
    if (!exact(body, keys) || body.protocolVersion !== 1 || body.sharedId !== session.sharedId || body.worldEpoch !== session.worldEpoch
      || !Number.isSafeInteger(body.sequence) || body.sequence !== session.commandSequence + 1) fail('Stale or invalid shared research control envelope.');
  }
  function assertParticipantEpochs(session) {
    for (const member of session.participants) if (stateFor(member.individualId).sessionEpoch !== member.sessionEpoch) fail('A shared research participant session changed; separate and explicitly rejoin.');
  }
  async function runControl(sharedId, body) {
    const session = sessionFor(sharedId);
    assertUnreserved(session.participants.map(member => member.individualId));
    if (!exact(body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'action']) || !['start', 'pause', 'save', 'separate'].includes(body.action)) fail('Invalid shared research action.');
    validateControl(session, body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'action']);
    if (body.action === 'start') {
      const active = session.participants.filter(member => member.mode === 'active');
      if (!active.length) fail('Every shared research participant is resting; explicitly resume one before starting.');
      try {
        assertParticipantEpochs(session);
        if (active.some(member => { const state = stateFor(member.individualId); return !state.resident || !state.neural; })) fail('A shared research participant is unavailable.');
        await Promise.all(active.map(member => control(member.individualId, 'start')));
      } catch { await pauseAll(session); session.status = 'paused'; session.reason = 'Shared participant unavailable; explicit shared start required.'; session.worldEpoch = randomUUID(); fail(session.reason); }
      session.status = 'running'; session.reason = null; session.worldEpoch = randomUUID(); session.fault = null; session.pressure = false; event(session, 'start');
    } else if (body.action === 'pause') {
      const paused = await pauseAll(session);
      if (paused.some(result => result.status === 'rejected')) {
        session.status = 'paused'; session.reason = `Shared research pause incomplete: ${pauseFailure(paused)}`; session.worldEpoch = randomUUID();
        fail(session.reason);
      }
      session.status = 'paused'; session.reason = 'Shared research session paused.'; session.worldEpoch = randomUUID(); event(session, 'pause');
    } else if (body.action === 'save') {
      if (session.status === 'running') fail('Pause the shared research session before saving a joint checkpoint.');
      if (typeof checkpoint !== 'function') fail('Shared research checkpoint persistence is unavailable.');
      assertParticipantEpochs(session);
      const result = await checkpoint({ ids: session.participants.map(member => member.individualId), intervalMs: WORLD_INTERVAL_MS, tick: session.tick,
        modes: Object.fromEntries(session.participants.map(member => [member.individualId, member.mode])) });
      if (!result || typeof result.jointCheckpointId !== 'string' || result.payload?.members?.length !== session.participants.length) fail('Shared research checkpoint persistence returned an incomplete transaction.');
      event(session, 'save', { jointCheckpointId: result.jointCheckpointId });
    } else {
      const paused = await pauseAll(session);
      if (paused.some(result => result.status === 'rejected')) {
        session.status = 'paused'; session.reason = `Shared research separation incomplete: ${pauseFailure(paused)}`; session.worldEpoch = randomUUID();
        fail(session.reason);
      }
      try { invalidate(session.participants.map(member => member.individualId)); }
      catch (error) {
        session.status = 'paused'; session.reason = `Shared research command invalidation incomplete: ${error.message}`; session.worldEpoch = randomUUID();
        fail(session.reason);
      }
      session.status = 'separated'; session.reason = 'Shared research membership separated at the current boundary.'; event(session, 'separate');
      for (const member of session.participants) owners.delete(member.individualId);
      sessions.delete(session.sharedId);
    }
    session.commandSequence++;
    return bundle(session);
  }
  /** One complete barrier on a validated, running session. Telemetry observes the decided outcome only. */
  async function performBarrier(session) {
    const active = session.participants.filter(member => member.mode === 'active');
    if (!active.length) fail('Every shared research participant is resting; the world clock is frozen.');
    const memberIds = active.map(member => member.individualId);
    const startedAt = clock();
    let timing, observed = null, stage = 'precheck', reason = 'stale-epoch';
    try {
      assertParticipantEpochs(session);
      reason = 'participant-unavailable';
      const before = new Map(active.map(member => [member.individualId, stateFor(member.individualId)]));
      if (active.some(member => { const state = before.get(member.individualId); return !state.resident || !state.neural || state.status !== 'running'; })) fail('A shared research participant is unavailable.');
      const expected = Object.fromEntries(active.map(member => [member.individualId, before.get(member.individualId).sessionEpoch]));
      stage = 'barrier';
      const result = await barrier(memberIds, SUBSTEPS, expected, value => { timing = value; });
      stage = 'validate'; reason = 'invalid-result';
      if (!Array.isArray(result) || result.length !== active.length) throw new Error('Shared research barrier returned an incomplete result.');
      const byId = new Map(result.map(value => [value.individualId, safeState(value)]));
      observed = Object.fromEntries(active.map(member => {
        const prior = before.get(member.individualId).neural.tick, next = byId.get(member.individualId)?.neural?.tick;
        return [member.individualId, Number.isSafeInteger(next) ? next - prior : null];
      }));
      for (const member of active) {
        const prior = before.get(member.individualId), value = byId.get(member.individualId);
        if (!value?.neural || value.sessionEpoch !== prior.sessionEpoch || value.neural.tick !== prior.neural.tick + SUBSTEPS
          || value.neural.simTimeMs !== prior.neural.simTimeMs + WORLD_INTERVAL_MS) { reason = 'step-mismatch'; throw new Error('Shared research barrier returned a skipped or extra neural step.'); }
      }
      session.tick++; session.commandSequence++; event(session, 'barrier', { substeps: SUBSTEPS });
      observe(session, { outcome: 'committed', worldTick: session.tick, startedAt, finishedAt: clock(), memberIds, timing, observedSubsteps: observed });
      return active.map(member => { const value = byId.get(member.individualId); return { individualId: member.individualId,
        sessionEpoch: value.sessionEpoch, inputSimTimeMs: value.neural.simTimeMs - WORLD_INTERVAL_MS, outputSimTimeMs: value.neural.simTimeMs,
        substeps: SUBSTEPS, neural: value.neural }; });
    } catch (error) {
      const failure = stage === 'barrier' ? timing?.failure ?? 'worker-failure' : reason;
      observe(session, { outcome: 'failed', reason: failure, worldTick: session.tick, startedAt, finishedAt: clock(), memberIds, timing, observedSubsteps: observed });
      await pauseAll(session); session.status = 'paused'; session.reason = 'Shared research barrier failed; no participant advanced; explicit shared start required.'; session.worldEpoch = randomUUID();
      session.fault = failure;
      fail(error?.message || session.reason);
    }
  }
  async function runAdvance(sharedId, body) {
    const session = sessionFor(sharedId);
    assertUnreserved(session.participants.map(member => member.individualId));
    if (!exact(body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'action']) || body.action !== 'barrier') fail('Invalid shared research barrier envelope.');
    validateControl(session, body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'action']);
    if (session.status !== 'running') fail('Explicit shared start required before a research barrier.');
    const traces = await performBarrier(session);
    return { ...bundle(session), traces };
  }
  /** Explicit, bounded measurement on an already started session. It runs complete barriers
   * through the same path and stops (never crops, substitutes or retries) on failure,
   * deadline or resource pressure, reporting the measurement as unavailable. */
  async function runMeasure(sharedId, body) {
    const session = sessionFor(sharedId);
    assertUnreserved(session.participants.map(member => member.individualId));
    const keys = ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'barriers'];
    if (!exact(body, keys) || !Number.isSafeInteger(body.barriers) || body.barriers < SHARED_MEASUREMENT_BOUNDS.minBarriers
      || body.barriers > SHARED_MEASUREMENT_BOUNDS.maxBarriers) fail('Invalid shared research measurement envelope.');
    validateControl(session, body, keys);
    if (session.status !== 'running') fail('Explicit shared start required before a bounded measurement.');
    if (session.participants.some(member => member.mode !== 'active')) fail('Measurement requires every shared research participant to be active; resting members are never measured.');
    session.commandSequence++;
    const rss = () => { try { const value = memoryUsage()?.rss; return Number.isSafeInteger(value) && value >= 0 ? value : null; } catch { return null; } };
    const members = session.participants.map(member => { const state = stateFor(member.individualId);
      return { individualId: member.individualId, dataset: state.dataset, modelId: state.model?.id ?? null, graphSha256: state.graphSha256 ?? null, completedSubsteps: 0 }; });
    const baseline = rss(), walls = [], startedAt = clock();
    let peak = baseline, stopReason = null;
    for (let index = 0; index < body.barriers; index++) {
      let pressure = 'within-budget';
      try { pressure = resources()?.pressure ?? 'within-budget'; } catch { pressure = 'unknown'; }
      if (session.pressureRequested || pressure !== 'within-budget') { stopReason = 'resource-pressure'; break; }
      const elapsed = clock() - startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0) { stopReason = 'invalid-telemetry'; break; }
      if (elapsed > measurementDeadlineMs) { stopReason = 'deadline'; break; }
      const barrierStarted = clock();
      try { await performBarrier(session); } catch { stopReason = session.fault ?? 'worker-failure'; break; }
      walls.push(clock() - barrierStarted);
      for (const member of members) member.completedSubsteps += SUBSTEPS;
      const current = rss();
      peak = peak === null || current === null ? null : Math.max(peak, current);
    }
    if (stopReason === 'resource-pressure') await applyPressurePause(session);
    if (stopReason === 'deadline') {
      const paused = await pauseAll(session);
      session.status = 'paused'; session.worldEpoch = randomUUID();
      session.reason = paused.some(result => result.status === 'rejected') ? `Measurement deadline pause incomplete: ${pauseFailure(paused)}` : 'Measurement deadline reached; shared research paused; explicit shared start required.';
      event(session, 'pause');
    }
    const sorted = [...walls].sort((left, right) => left - right);
    const totalMs = walls.reduce((sum, value) => sum + value, 0);
    if (!stopReason && (!walls.length || walls.some(value => !Number.isFinite(value) || value < 0) || !(totalMs > 0))) stopReason = 'invalid-telemetry';
    const complete = !stopReason;
    session.measurement = { schemaVersion: 1, kind: 'shared-barrier-measurement', backend: 'connectome', status: complete ? 'complete' : 'unavailable',
      stopReason, requestedBarriers: body.barriers, completedBarriers: walls.length, intervalMs: WORLD_INTERVAL_MS, substepsPerBarrier: SUBSTEPS,
      runtime: { node: runtime.node, platform: runtime.platform, arch: runtime.arch }, measuredAt: measuredAt(), members,
      wall: complete ? { totalMs, minMs: sorted[0], medianMs: sorted[Math.floor((sorted.length - 1) / 2)], maxMs: sorted.at(-1) } : null,
      simulatedToWallRatio: complete ? walls.length * WORLD_INTERVAL_MS / totalMs : null,
      memory: complete && baseline !== null && peak !== null ? { baselineRssBytes: baseline, sampledPeakRssBytes: peak, incrementBytes: peak - baseline } : null,
      disclosure: 'Explicit zero-drive shared barrier measurement on already loaded workers. RSS is sampled between barriers and can miss transient peaks. No sensory input, rendering, learning or cloud fallback.' };
    event(session, 'measure', { completedBarriers: walls.length, status: session.measurement.status });
    return bundle(session);
  }
  async function runMemberControl(sharedId, body) {
    const session = sessionFor(sharedId);
    assertUnreserved(session.participants.map(member => member.individualId));
    if (!exact(body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'individualId', 'action']) || !['rest', 'resume', 'withdraw'].includes(body.action)) fail('Invalid shared research member envelope.');
    validateControl(session, body, ['protocolVersion', 'sharedId', 'worldEpoch', 'sequence', 'individualId', 'action']);
    const member = session.participants.find(value => value.individualId === body.individualId);
    if (!member) fail('Individual is not a member of this shared research session.', 404);
    assertParticipantEpochs(session);
    if (body.action === 'withdraw') {
      if (session.participants.length <= 2) fail('Withdrawal would drop the research population below two members; separate the session instead.');
      await control(member.individualId, 'pause');
      try { invalidate([member.individualId]); }
      catch (error) {
        await pauseAll(session); session.status = 'paused'; session.reason = `Shared research command invalidation incomplete: ${error.message}`; session.worldEpoch = randomUUID();
        fail(session.reason);
      }
      session.participants = session.participants.filter(value => value !== member); owners.delete(member.individualId);
      if (session.participants.every(value => value.mode === 'resting')) { session.status = 'resting'; session.reason = 'Every remaining participant is resting; the world clock is frozen.'; }
      event(session, 'withdraw', { individualId: member.individualId });
    } else {
      if (body.action === 'rest' && member.mode === 'resting' || body.action === 'resume' && member.mode === 'active') fail('Member is already in the requested mode.');
      await control(member.individualId, body.action === 'resume' ? (session.status === 'running' ? 'start' : 'pause') : body.action);
      member.mode = body.action === 'rest' ? 'resting' : 'active';
      if (session.participants.every(value => value.mode === 'resting')) { session.status = 'resting'; session.reason = 'Every participant is resting; the world clock is frozen.'; }
      else if (session.status === 'resting') { session.status = 'paused'; session.reason = 'A participant resumed; explicit shared start required.'; }
      event(session, body.action, { individualId: member.individualId });
    }
    session.commandSequence++;
    return bundle(session);
  }
  async function restore(body) {
    required();
    if (typeof readJointCheckpoint !== 'function' || typeof prepareRestore !== 'function' || typeof commitRestore !== 'function'
      || !exact(body, ['protocolVersion', 'jointCheckpointId', 'members']) || body.protocolVersion !== 1
      || typeof body.jointCheckpointId !== 'string' || !Array.isArray(body.members) || body.members.length < 2 || body.members.length > MAX_MEMBERS
      || new Set(body.members.map(member => member?.individualId)).size !== body.members.length) fail('Invalid shared research restore envelope.');
    assertUnreserved(body.members.map(member => member.individualId));
    const joint = readJointCheckpoint(body.jointCheckpointId);
    const expected = joint?.payload?.members;
    if (!joint || joint.jointCheckpointId !== body.jointCheckpointId || !Array.isArray(expected) || expected.length !== body.members.length) fail('Shared research joint checkpoint membership is unavailable.');
     const expectedIds = new Set(expected.map(member => member.individualId));
     const expectedById = new Map(expected.map(member => [member.individualId, member]));
     for (const member of body.members) {
       if (!exact(member, ['protocolVersion', 'individualId', 'sessionEpoch', 'commandSequence']) || member.protocolVersion !== 1
         || !expectedIds.has(member.individualId) || owns(member.individualId) || joining.has(member.individualId)) fail('Stale or unavailable shared research restore member.');
       const state = stateFor(member.individualId), expectedMember = expectedById.get(member.individualId);
       if ((expectedMember.dataset && state.dataset !== expectedMember.dataset) || (expectedMember.graphSha256 && state.graphSha256 !== expectedMember.graphSha256) || (expectedMember.modelId && state.model?.id !== expectedMember.modelId)) fail('Shared restore member namespace does not match the saved checkpoint.');
       if (state.sessionEpoch !== member.sessionEpoch || state.commandSequence !== member.commandSequence || state.status !== 'paused'
         || state.resident !== true || !declared(state)) fail('Every shared restore member must be an explicitly paused healthy resident.');
     }
    if (expected.some(member => !body.members.some(value => value.individualId === member.individualId))) fail('Shared research restore requires the complete saved membership.');
    const memberIds = body.members.map(member => member.individualId);
    const expectedSequences = Object.fromEntries(body.members.map(member => [member.individualId, member.commandSequence]));
    for (const id of memberIds) joining.add(id);
    try {
       const prepared = await prepareRestore(body.jointCheckpointId, expectedSequences);
       await commitRestore(prepared);
       if (closing) fail('Full-connectome shared research is unavailable.');
       const participants = expected.map(member => {
        const state = stateFor(member.individualId);
        return { individualId: member.individualId, sessionEpoch: state.sessionEpoch, mode: member.mode };
      });
       const allResting = participants.every(member => member.mode === 'resting');
       const session = newSession({ sharedId: randomUUID(), worldEpoch: randomUUID(), tick: joint.payload.tick, status: allResting ? 'resting' : 'paused', reason: allResting ? 'Every participant is resting; the world clock is frozen.' : 'Explicit shared restore is paused.', commandSequence: 0,
         pressureRequested: false, participants, events: [{ type: 'restore', tick: joint.payload.tick, jointCheckpointId: joint.jointCheckpointId }] });
      sessions.set(session.sharedId, session);
      for (const member of participants) owners.set(member.individualId, session.sharedId);
      return bundle(session);
    } finally {
      for (const id of memberIds) joining.delete(id);
    }
  }
  function checkpoints() {
    required();
    return typeof listJoints === 'function' ? listJoints() : [];
  }
  async function finishOperation(sharedId) {
    pending.delete(sharedId);
    const session = sessions.get(sharedId);
    if (session?.pressureRequested) await applyPressurePause(session);
  }
  async function controlShared(sharedId, body) {
    sessionFor(sharedId); reserve(sharedId);
    try { return await runControl(sharedId, body); } finally { await finishOperation(sharedId); }
  }
  async function advance(sharedId, body) {
    sessionFor(sharedId); reserve(sharedId);
    try { return await runAdvance(sharedId, body); } finally { await finishOperation(sharedId); }
  }
  async function measure(sharedId, body) {
    sessionFor(sharedId); reserve(sharedId);
    try { return await runMeasure(sharedId, body); } finally { await finishOperation(sharedId); }
  }
  async function memberControl(sharedId, body) {
    sessionFor(sharedId); reserve(sharedId);
    try { return await runMemberControl(sharedId, body); } finally { await finishOperation(sharedId); }
  }
  async function pauseForPressure() {
    for (const session of sessions.values()) {
      if (pending.has(session.sharedId)) { session.pressureRequested = true; continue; }
      if (session.status !== 'running' && !session.pressureRequested) continue;
      await applyPressurePause(session);
    }
  }
  async function close() {
    closing = true;
    for (const session of sessions.values()) await pauseAll(session);
    for (const session of sessions.values()) for (const member of session.participants) owners.delete(member.individualId);
    sessions.clear(); joining.clear();
  }
  return { view, join, control: controlShared, advance, measure, member: memberControl, restore, checkpoints, owns, pauseForPressure, snapshot: id => bundle(sessionFor(id)), close };
}
