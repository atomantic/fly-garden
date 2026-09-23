import { randomUUID } from 'node:crypto';
import { RuntimeError } from './runtime.js';

/** Versioned, default-off sensory/motor boundary for shared research worlds. It validates
 * declarations, routes each recipient only its own declared channels and commits a complete
 * action batch in membership order. It owns no timer, body, reward, chemistry or learning. */
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const MAX_MEMBERS = 64;
const VISUAL = Object.freeze({ width: 8, height: 4 });
const MOTOR = Object.freeze({ maxForward: 0.12, maxYaw: 0.8 });

export const ADAPTER_CHANNELS = Object.freeze({
  'visual-frame': Object.freeze({ direction: 'input', disclosure: 'Engineered 8×4 controller-camera luminance bytes; not a receptor map or validated fly vision.' }),
  'acoustic-event': Object.freeze({ direction: 'input', events: Object.freeze(['arranged-tone']), disclosure: 'A human-arranged garden tone event with a bounded level; no auditory receptor model.' }),
  'scent-proxy': Object.freeze({ direction: 'input', proxies: Object.freeze(['floral']), disclosure: 'A catalogued scent proxy with bounded intensity; not a receptor, pheromone or chemistry model.' }),
  'contact-proxy': Object.freeze({ direction: 'input', surfaces: Object.freeze(['petal', 'leaf', 'ground']), sides: Object.freeze(['left', 'right', 'both']),
    disclosure: 'A catalogued surface-contact proxy with bounded magnitude; no mechanoreceptor, injury or pain model.' }),
  'motor-proposal': Object.freeze({ direction: 'output', ...MOTOR, disclosure: 'A bounded forward/yaw proposal from an engineered readout; it moves no body by itself.' }),
});
const CHANNEL_NAMES = Object.freeze(Object.keys(ADAPTER_CHANNELS));
const CAPABILITY_KEYS = Object.freeze(['sensoryMotor', 'embodiment', 'chemistry', 'learning']);
/** Enablement requires separately reviewed evidence and a new contract version. */
const UNAVAILABLE_CAPABILITIES = Object.freeze(['embodiment', 'chemistry', 'learning']);
export const ADAPTER_BACKENDS = Object.freeze(['connectome', 'synthetic-double']);
export const SHARED_ADAPTER_CONTRACT = Object.freeze({ version: 1, kind: 'shared-environment-adapter', channels: CHANNEL_NAMES,
  unavailableCapabilities: UNAVAILABLE_CAPABILITIES, maxObservationAgeMs: 250, defaultStageTimeoutMs: 2000,
  disclosure: 'Engineered, versioned, opt-in adapter. Channels are declared sensory proxies and bounded motor proposals, not measured anatomy or inferred physiology. No body, reward, chemistry, learning or biological validation.' });

export class AdapterContractError extends RuntimeError {
  constructor(code, message, statusCode = 409) { super(message, statusCode); this.code = code; }
}
const reject = (code, message) => { throw new AdapterContractError(code, message); };

function inputPayload(channel, value) {
  const invalid = () => reject('malformed-channel', `Invalid ${channel} payload.`);
  if (channel === 'visual-frame') {
    if (!exact(value, ['width', 'height', 'luminance']) || value.width !== VISUAL.width || value.height !== VISUAL.height
      || !Array.isArray(value.luminance) || value.luminance.length !== VISUAL.width * VISUAL.height
      || !Array.from({ length: value.luminance.length }, (_, i) => Object.hasOwn(value.luminance, i)
        && Number.isInteger(value.luminance[i]) && value.luminance[i] >= 0 && value.luminance[i] <= 255).every(Boolean)) invalid();
    return Object.freeze({ width: value.width, height: value.height, luminance: Object.freeze([...value.luminance]) });
  }
  if (channel === 'acoustic-event') {
    if (!exact(value, ['event', 'level']) || !ADAPTER_CHANNELS[channel].events.includes(value.event) || !unit(value.level)) invalid();
    return Object.freeze({ event: value.event, level: value.level });
  }
  if (channel === 'scent-proxy') {
    if (!exact(value, ['proxy', 'intensity']) || !ADAPTER_CHANNELS[channel].proxies.includes(value.proxy) || !unit(value.intensity)) invalid();
    return Object.freeze({ proxy: value.proxy, intensity: value.intensity });
  }
  if (!exact(value, ['surface', 'side', 'magnitude']) || !ADAPTER_CHANNELS[channel].surfaces.includes(value.surface)
    || !ADAPTER_CHANNELS[channel].sides.includes(value.side) || !unit(value.magnitude)) invalid();
  return Object.freeze({ surface: value.surface, side: value.side, magnitude: value.magnitude });
}

/** Returns a halt code instead of throwing: an unusable proposal pauses the coupled session. */
function motorProblem(value) {
  if (!exact(value, ['forward', 'yaw'])) return 'invalid-response';
  if (!Number.isFinite(value.forward) || !Number.isFinite(value.yaw)) return 'numerical-fault';
  return value.forward < 0 || value.forward > MOTOR.maxForward || Math.abs(value.yaw) > MOTOR.maxYaw ? 'invalid-response' : null;
}

function channelList(value, direction) {
  if (!Array.isArray(value) || value.length > CHANNEL_NAMES.length || new Set(value).size !== value.length
    || value.some(name => ADAPTER_CHANNELS[name]?.direction !== direction)) reject('invalid-declaration', `Declared ${direction} channels are unknown, duplicated or misdirected.`);
  return Object.freeze(CHANNEL_NAMES.filter(name => value.includes(name)));
}

/** A declaration must exist, match this contract version exactly and is frozen before admission. */
export function validateDeclaration(value) {
  if (value === undefined || value === null) reject('undeclared-capability', 'A shared adapter participant has no capability declaration.');
  if (!exact(value, ['contractVersion', 'individualId', 'sessionEpoch', 'backend', 'inputs', 'outputs', 'capabilities'])
    || value.contractVersion !== SHARED_ADAPTER_CONTRACT.version || !idValid(value.individualId) || !idValid(value.sessionEpoch)
    || !ADAPTER_BACKENDS.includes(value.backend) || !exact(value.capabilities, CAPABILITY_KEYS)
    || CAPABILITY_KEYS.some(key => typeof value.capabilities[key] !== 'boolean')) reject('invalid-declaration', 'Invalid or unsupported shared adapter declaration.');
  const inputs = channelList(value.inputs, 'input'), outputs = channelList(value.outputs, 'output');
  if (UNAVAILABLE_CAPABILITIES.some(key => value.capabilities[key])) reject('capability-unavailable', 'Embodiment, chemistry and learning are unavailable in adapter contract version 1.');
  const coupled = inputs.length + outputs.length > 0;
  if (value.capabilities.sensoryMotor !== coupled) reject('invalid-declaration', 'The sensoryMotor capability must match the declared channels.');
  if (value.backend === 'connectome' && coupled) reject('capability-unavailable', 'Full-connectome workers declare no sensory or motor channel until separately reviewed evidence enables one.');
  return Object.freeze({ contractVersion: value.contractVersion, individualId: value.individualId, sessionEpoch: value.sessionEpoch, backend: value.backend,
    inputs, outputs, capabilities: Object.freeze(Object.fromEntries(CAPABILITY_KEYS.map(key => [key, value.capabilities[key]]))) });
}

/** The only declaration a full-connectome registry state can produce. Missing or non-false
 * capability flags fail closed rather than defaulting to an uncoupled participant. */
export function connectomeDeclaration(state) {
  const capabilities = state?.capabilities;
  if (!capabilities || CAPABILITY_KEYS.some(key => capabilities[key] !== false)) reject('undeclared-capability', 'Full-connectome participant capabilities are missing or not declared unavailable.');
  return validateDeclaration({ contractVersion: SHARED_ADAPTER_CONTRACT.version, individualId: state.individualId, sessionEpoch: state.sessionEpoch,
    backend: 'connectome', inputs: [], outputs: [], capabilities: Object.fromEntries(CAPABILITY_KEYS.map(key => [key, false])) });
}

const declarationView = declaration => ({ individualId: declaration.individualId, sessionEpoch: declaration.sessionEpoch, backend: declaration.backend,
  inputs: [...declaration.inputs], outputs: [...declaration.outputs], capabilities: { ...declaration.capabilities } });

/** Read-only summary for a session response: declarations only, never neural state. */
export function describeDeclarations(states, declare = connectomeDeclaration) {
  const participants = states.map(state => {
    try { return { declared: true, ...declarationView(declare(state)) }; }
    catch { return { declared: false, individualId: state?.individualId ?? null, reason: 'Capability declaration missing or unsupported; this participant cannot be admitted.' }; }
  });
  const coupled = participants.some(participant => participant.declared && participant.capabilities.sensoryMotor);
  return { contractVersion: SHARED_ADAPTER_CONTRACT.version, kind: SHARED_ADAPTER_CONTRACT.kind, coupled,
    reason: coupled ? null : 'No participant declares a sensory or motor channel; this session accepts no observation or action payload.',
    participants, disclosure: SHARED_ADAPTER_CONTRACT.disclosure };
}

const HALT_REASONS = Object.freeze({
  'stale-epoch': 'A stale world or participant session epoch was presented.',
  'stale-observation': 'The observation batch is stale, future-dated or for another world tick.',
  'partial-batch': 'The observation batch is missing an active participant.',
  timeout: 'A participant did not respond within the bounded stage deadline.',
  'worker-fault': 'A participant failed while staging or committing.',
  'numerical-fault': 'A participant returned a non-finite value.',
  'invalid-response': 'A participant returned an undeclared, malformed or cross-session response.',
  'step-mismatch': 'A participant returned a skipped or extra neural step.',
});

/** members: [{ declaration, backend: { stage, commit, discard, rollback }, clock: { tick, simTimeMs } }].
 * backend.stage(request) prepares, without committing, exactly `substeps` neural steps for one
 * recipient; commit/discard/rollback take { individualId, worldEpoch, worldTick }. rollback(ref)
 * restores the pre-batch state for that ref and is a no-op when that ref was never applied, so a
 * commit that fails after partially applying is also rolled back. */
export function createSharedEnvironmentAdapter({ sharedId = randomUUID(), members, intervalMs = 5, substeps = 5, now = Date.now,
  stageTimeoutMs = SHARED_ADAPTER_CONTRACT.defaultStageTimeoutMs, maxObservationAgeMs = SHARED_ADAPTER_CONTRACT.maxObservationAgeMs } = {}) {
  if (!idValid(sharedId) || !Array.isArray(members) || members.length < 2 || members.length > MAX_MEMBERS || typeof now !== 'function'
    || ![intervalMs, substeps, stageTimeoutMs, maxObservationAgeMs].every(value => Number.isSafeInteger(value) && value > 0) || stageTimeoutMs > 60000) {
    throw new Error('Invalid shared environment adapter configuration');
  }
  const participants = members.map(member => {
    const declaration = validateDeclaration(member?.declaration);
    const backend = member.backend;
    if (!backend || ['stage', 'commit', 'discard', 'rollback'].some(key => typeof backend[key] !== 'function')
      || !exact(member.clock, ['tick', 'simTimeMs']) || ![member.clock.tick, member.clock.simTimeMs].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('Invalid shared environment adapter participant');
    }
    return { declaration, backend, mode: 'active', clock: { ...member.clock } };
  });
  if (new Set(participants.map(member => member.declaration.individualId)).size !== participants.length) throw new Error('Shared adapter participants must be distinct');
  let worldEpoch = randomUUID(), worldTick = 0, status = 'paused', reason = 'Explicit resume required.', fault = null, busy = false;
  // Timed-out stages keep running in their backend; resume waits until each late result is discarded.
  const lingering = new Set();
  const active = () => participants.filter(member => member.mode === 'active');
  const find = id => participants.find(member => member.declaration.individualId === id);
  const rotate = () => { worldEpoch = randomUUID(); };
  const idle = () => { if (busy) reject('batch-in-progress', 'A shared adapter batch is already in progress.'); if (status === 'closed') reject('closed', 'Shared adapter is closed.'); };
  /** A candidate that cannot be discarded or rolled back leaves backend state uncertain. */
  function uncertain() {
    status = 'fault'; fault = 'worker-fault';
    reason = 'A participant could not discard or roll back a staged candidate; separate the session.';
  }
  const cleared = results => { if (results.some(result => result.status === 'rejected')) uncertain(); };
  function halt(code) {
    if (status !== 'fault') status = 'paused';
    fault = code; reason = status === 'fault' ? `${HALT_REASONS[code]} Backend state is uncertain; separate the session.` : `${HALT_REASONS[code]} Explicit resume required.`; rotate();
    throw new AdapterContractError(code, reason);
  }
  function view() {
    return { contractVersion: SHARED_ADAPTER_CONTRACT.version, kind: SHARED_ADAPTER_CONTRACT.kind, sharedId, worldEpoch, worldTick, intervalMs, substeps,
      status, reason, fault, participants: participants.map(member => ({ ...declarationView(member.declaration), mode: member.mode })),
      disclosure: SHARED_ADAPTER_CONTRACT.disclosure };
  }
  function resume(body) {
    idle();
    if (!exact(body, ['worldEpoch']) || body.worldEpoch !== worldEpoch) reject('stale-epoch', 'Stale shared adapter resume envelope.');
    if (status === 'fault') reject('fault', 'A participant could not be rolled back; separate the session.');
    if (lingering.size) reject('stage-pending', 'A timed-out participant stage has not settled yet; resume after it is discarded.');
    if (status !== 'paused') reject('not-paused', 'Only a paused shared adapter can be explicitly resumed.');
    status = 'running'; reason = null; fault = null; rotate();
    return view();
  }
  function pause() {
    idle();
    if (status === 'running') { status = 'paused'; reason = 'Shared adapter paused explicitly.'; rotate(); }
    return view();
  }
  /** Structural problems are rejected without any state change; freshness, completeness and
   * participant failures pause the coupled session and rotate its epoch. */
  function validateBatch(batch) {
    if (status !== 'running') reject('not-running', 'Explicit resume required before an adapter batch.');
    if (!exact(batch, ['contractVersion', 'sharedId', 'worldEpoch', 'worldTick', 'capturedAtMs', 'observations'])
      || batch.contractVersion !== SHARED_ADAPTER_CONTRACT.version || batch.sharedId !== sharedId
      || !Number.isSafeInteger(batch.worldTick) || !Number.isSafeInteger(batch.capturedAtMs) || batch.capturedAtMs < 0
      || !Array.isArray(batch.observations) || batch.observations.length > MAX_MEMBERS) reject('malformed-batch', 'Invalid shared adapter observation batch.');
    const byId = new Map();
    for (const observation of batch.observations) {
      if (!exact(observation, ['individualId', 'sessionEpoch', 'channels']) || !observation.channels
        || typeof observation.channels !== 'object' || Array.isArray(observation.channels)) reject('malformed-batch', 'Invalid shared adapter observation envelope.');
      const member = find(observation.individualId);
      if (!member) reject('cross-session', 'Observation names an individual outside this shared adapter session.');
      if (byId.has(observation.individualId)) reject('duplicate', 'Duplicate observation for one participant in a batch.');
      if (member.mode !== 'active') reject('resting-member', 'Resting participants receive no observation.');
      const names = Object.keys(observation.channels);
      if (names.some(name => !member.declaration.inputs.includes(name))) reject('undeclared-channel', 'Observation carries a channel absent from the recipient declaration.');
      byId.set(observation.individualId, { sessionEpoch: observation.sessionEpoch,
        channels: Object.freeze(Object.fromEntries(CHANNEL_NAMES.filter(name => names.includes(name)).map(name => [name, inputPayload(name, observation.channels[name])]))) });
    }
    if (batch.worldEpoch !== worldEpoch) halt('stale-epoch');
    for (const [id, observation] of byId) if (observation.sessionEpoch !== find(id).declaration.sessionEpoch) halt('stale-epoch');
    let receivedAtMs;
    try { receivedAtMs = now(); } catch { receivedAtMs = Number.NaN; }
    if (batch.worldTick !== worldTick || !Number.isFinite(receivedAtMs) || batch.capturedAtMs > receivedAtMs
      || receivedAtMs - batch.capturedAtMs > maxObservationAgeMs) halt('stale-observation');
    if (active().some(member => !byId.has(member.declaration.individualId))) halt('partial-batch');
    return byId;
  }
  function bounded(promise) {
    let timer;
    const deadline = new Promise((_, rejectDeadline) => { timer = setTimeout(() => rejectDeadline(new AdapterContractError('timeout', HALT_REASONS.timeout)), stageTimeoutMs); });
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
  }
  function responseProblem(member, response) {
    const { individualId, sessionEpoch } = member.declaration;
    if (!exact(response, ['individualId', 'sessionEpoch', 'worldTick', 'neural', 'proposal']) || response.individualId !== individualId
      || response.sessionEpoch !== sessionEpoch || response.worldTick !== worldTick || !exact(response.neural, ['tick', 'simTimeMs'])) return 'invalid-response';
    if (response.neural.tick !== member.clock.tick + substeps || response.neural.simTimeMs !== member.clock.simTimeMs + intervalMs) return 'step-mismatch';
    if (!member.declaration.outputs.includes('motor-proposal')) return response.proposal === null ? null : 'invalid-response';
    return motorProblem(response.proposal);
  }
  async function step(batch) {
    idle();
    const observations = validateBatch(batch);
    busy = true;
    const recipients = active(), ref = member => ({ individualId: member.declaration.individualId, worldEpoch, worldTick });
    try {
      // Each backend receives only its own recipient-scoped copy; completion order is ignored.
      const stages = recipients.map(member => Promise.resolve().then(() => member.backend.stage(Object.freeze({
        contractVersion: SHARED_ADAPTER_CONTRACT.version, individualId: member.declaration.individualId, sessionEpoch: member.declaration.sessionEpoch,
        worldEpoch, worldTick, intervalMs, substeps, channels: observations.get(member.declaration.individualId).channels }))));
      const settled = await Promise.allSettled(stages.map(bounded));
      const problem = settled.map((result, index) => result.status === 'rejected' ? (result.reason?.code === 'timeout' ? 'timeout' : 'worker-fault')
        : responseProblem(recipients[index], result.value)).find(Boolean);
      if (problem) {
        for (const [index, result] of settled.entries()) {
          if (result.reason?.code !== 'timeout') continue;
          const member = recipients[index], late = ref(member), done = () => member.backend.discard(late);
          lingering.add(member);
          stages[index].then(done, done).catch(uncertain).finally(() => lingering.delete(member));
        }
        cleared(await Promise.allSettled(recipients.map(member => member.backend.discard(ref(member)))));
        halt(problem);
      }
      const committed = [];
      for (const member of recipients) {
        try { await member.backend.commit(ref(member)); committed.push(member); }
        catch {
          const attempted = [...committed, member];
          cleared(await Promise.allSettled(attempted.reverse().map(value => value.backend.rollback(ref(value)))));
          cleared(await Promise.allSettled(recipients.filter(value => !attempted.includes(value)).map(value => value.backend.discard(ref(value)))));
          halt('worker-fault');
        }
      }
      const interval = { startMs: worldTick * intervalMs, endMs: (worldTick + 1) * intervalMs };
      const traces = recipients.map((member, index) => {
        const response = settled[index].value;
        member.clock = { ...response.neural };
        return { individualId: member.declaration.individualId, sessionEpoch: member.declaration.sessionEpoch, worldTick, interval,
          receivedChannels: Object.keys(observations.get(member.declaration.individualId).channels),
          proposal: response.proposal === null ? null : { forward: response.proposal.forward, yaw: response.proposal.yaw },
          neural: { ...response.neural }, substeps };
      });
      worldTick++;
      return { ...view(), traces };
    } finally { busy = false; }
  }
  function rest(id) {
    idle();
    const member = find(id);
    if (!member) reject('cross-session', 'Individual is not a member of this shared adapter session.');
    if (member.mode === 'resting') reject('same-mode', 'Participant is already resting.');
    member.mode = 'resting';
    if (!active().length && status !== 'fault') { status = 'resting'; reason = 'Every participant is resting; the world clock is frozen.'; }
    return view();
  }
  /** As in the shared-session contract, a member woken while the world runs joins the next
   * batch; a batch captured without it is partial and pauses the session. */
  function wake(id) {
    idle();
    const member = find(id);
    if (!member) reject('cross-session', 'Individual is not a member of this shared adapter session.');
    if (member.mode === 'active') reject('same-mode', 'Participant is already active.');
    member.mode = 'active';
    if (status === 'resting') { status = 'paused'; reason = 'A participant resumed; explicit resume required.'; }
    return view();
  }
  /** Revokes only this participant's scope; the rest keep their declarations and clocks. */
  function withdraw(id) {
    idle();
    const member = find(id);
    if (!member) reject('cross-session', 'Individual is not a member of this shared adapter session.');
    if (participants.length <= 2) reject('population-floor', 'Withdrawal would drop the population below two; separate the session instead.');
    participants.splice(participants.indexOf(member), 1);
    if (!active().length && status !== 'fault') { status = 'resting'; reason = 'Every remaining participant is resting; the world clock is frozen.'; }
    return view();
  }
  function close() { idle(); status = 'closed'; reason = 'Shared adapter closed.'; return view(); }
  return { view, resume, pause, step, rest, wake, withdraw, close };
}
