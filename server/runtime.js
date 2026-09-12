/** Original deterministic fixture. This is not a biological connectome or a learning model. */
const STEP_MS = 5;
import { randomUUID } from 'node:crypto';
import { createStimulusPolicy, validateStimulusCheckpoint, validateRetinalCurrents } from './stimulus-policy.js';

export const RUNTIME_PROTOCOL_VERSION = 1;
export const RUNTIME_DATASET = Object.freeze({ namespace: 'synthetic-fixture', release: '1', modelId: 'synthetic-lif-v1' });
const PARAMETERS = Object.freeze({ stepMs: STEP_MS, neuronCount: 32, membraneRetention: 0.975,
  baselineCurrent: 0.055, baselineCurrentStride: 0.003, threshold: 1, resetPotential: 0,
  minimumPotential: 0, excitatoryWeight: 0.11, inhibitoryWeight: -0.035, rateWindowMs: 1000 });
const UNSUPPORTED = Object.freeze({ rng: null, plasticity: null, refractory: null, delayBuffers: null, embodiment: null });
// Engineered numerical guards for this fixture, not measures of welfare or biological activity.
const MAX_RATE_HZ = 100;
const MAX_POTENTIAL_BEFORE_RESET = 4;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameFields = (value, expected) => exactKeys(value, Object.keys(expected))
  && Object.entries(expected).every(([key, item]) => value[key] === item);
const validIdentity = id => typeof id === 'string' && id.length > 0 && id.length <= 128;
const completeArray = (value, length, validate) => Array.isArray(value) && value.length === length
  && Array.from({ length }, (_, i) => Object.hasOwn(value, i) && validate(value[i], i)).every(Boolean);

export class RuntimeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Validate the complete payload before constructing a runtime or changing a current individual. */
export function validateRuntimeCheckpoint(saved, { individualId } = {}) {
  const invalid = () => { throw new RuntimeError('Invalid or incompatible fixture checkpoint.'); };
  if (!exactKeys(saved, ['schemaVersion', 'protocolVersion', 'individualId', 'dataset', 'parameters', 'dynamics', 'stimulusPolicy', 'unsupported', 'faultReason'])
    || saved.schemaVersion !== 1 || saved.protocolVersion !== RUNTIME_PROTOCOL_VERSION
    || !validIdentity(saved.individualId) || (individualId !== undefined && saved.individualId !== individualId)
    || !sameFields(saved.dataset, RUNTIME_DATASET) || !sameFields(saved.parameters, PARAMETERS)
    || !sameFields(saved.unsupported, UNSUPPORTED)
    || !(saved.faultReason === null || (typeof saved.faultReason === 'string' && saved.faultReason.length > 0 && saved.faultReason.length <= 500))
    || !exactKeys(saved.dynamics, ['tick', 'potentials', 'firing', 'spikeHistory'])) invalid();
  const { tick, potentials, firing, spikeHistory } = saved.dynamics;
  const timeMs = tick * STEP_MS;
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(timeMs)
    || !completeArray(potentials, PARAMETERS.neuronCount, potential => Number.isFinite(potential)
      && potential >= PARAMETERS.minimumPotential && potential < PARAMETERS.threshold)
    || !completeArray(firing, PARAMETERS.neuronCount, (value, index) => typeof value === 'boolean'
      && (!value || potentials[index] === PARAMETERS.resetPotential))
    || !completeArray(spikeHistory, PARAMETERS.neuronCount, (history, index) => Array.isArray(history) && history.length <= MAX_RATE_HZ
      && completeArray(history, history.length, (time, i) => Number.isSafeInteger(time) && time > 0 && time % STEP_MS === 0
        && time <= timeMs && time > timeMs - PARAMETERS.rateWindowMs && (i === 0 || time > history[i - 1]))
      && (history.at(-1) === timeMs) === firing[index])) invalid();
  validateStimulusCheckpoint(saved.stimulusPolicy, { individualId: saved.individualId, timeMs });
  return structuredClone(saved);
}

/** Explicit replicas get a new identity; the registry records source checkpoint lineage separately. */
export function branchRuntimeCheckpoint(saved, individualId) {
  if (!validIdentity(individualId)) throw new RuntimeError('Invalid replica identity.');
  const branch = validateRuntimeCheckpoint(saved);
  if (branch.individualId === individualId) throw new RuntimeError('A replica must have a new identity.');
  branch.individualId = individualId;
  branch.stimulusPolicy.individualId = individualId;
  for (const entry of branch.stimulusPolicy.entries) entry.individualId = individualId;
  return validateRuntimeCheckpoint(branch, { individualId });
}

/** A same-individual rewind may not erase or replace reservations spent since the requested save. */
export function assertCheckpointPolicyContinuity(currentCheckpoint, requestedCheckpoint) {
  const current = validateRuntimeCheckpoint(currentCheckpoint);
  const requested = validateRuntimeCheckpoint(requestedCheckpoint, { individualId: current.individualId });
  for (const entry of current.stimulusPolicy.entries) {
    const previous = requested.stimulusPolicy.entries.find(candidate => candidate.id === entry.id);
    if (!previous || Object.keys(entry).some(key => key !== 'activeUntilMs'
      && (key === 'targets' ? entry.targets.some((target, i) => previous.targets[i] !== target) : previous[key] !== entry[key]))) {
      throw new RuntimeError('Checkpoint restore would erase retained stimulus reservations. Save current state or create an explicit research replica.', 409);
    }
  }
}

export function createRuntime({ individualId = 'synthetic-fixture', sessionId = randomUUID(), checkpoint: saved } = {}) {
  if (![individualId, sessionId].every(validIdentity)) throw new RuntimeError('Invalid runtime identity.');
  const restored = saved === undefined ? null : validateRuntimeCheckpoint(saved, { individualId });
  const policy = createStimulusPolicy({ individualId, sessionId, durableCheckpoint: restored?.stimulusPolicy });
  let status = 'paused';
  let faultReason = restored?.faultReason ?? null;
  let tick = restored?.dynamics.tick ?? 0;
  let eventId = 0;
  const events = [];
  const neurons = Array.from({ length: PARAMETERS.neuronCount }, (_, i) => ({
    id: `fixture-${i}`, region: i < 16 ? 'Synthetic left' : 'Synthetic right',
    x: (i < 16 ? -1 : 1) + Math.cos(i * 2.399) * 0.65,
    y: Math.sin(i * 2.399) * 0.7,
    z: ((i % 7) - 3) * 0.16,
    potential: restored?.dynamics.potentials[i] ?? (i % 8) * 0.04,
    firing: restored?.dynamics.firing[i] ?? false, rateHz: restored?.dynamics.spikeHistory[i].length ?? 0,
  }));
  const edges = neurons.flatMap((n, i) => [
    { source: n.id, target: neurons[(i + 1) % neurons.length].id, weight: PARAMETERS.excitatoryWeight },
    { source: n.id, target: neurons[(i + 7) % neurons.length].id, weight: PARAMETERS.inhibitoryWeight },
  ]);
  let spikeHistory = restored?.dynamics.spikeHistory ?? neurons.map(() => []);
  const log = (type, message, details) => {
    events.unshift({ id: ++eventId, timeMs: tick * STEP_MS, type, message, ...(details ? { details } : {}) });
    if (events.length > 80) events.pop();
  };
  log('system', restored
    ? 'Synthetic fixture checkpoint restored paused. Optional exposures canceled; spent reservations retained. No missed time simulated.'
    : 'Synthetic fixture ready. Paused; no connectome loaded.');

  function snapshot() {
    const time = tick * STEP_MS;
    const stimulusPolicy = policy.snapshot();
    return structuredClone({
      schemaVersion: 1, protocolVersion: RUNTIME_PROTOCOL_VERSION, individualId, sessionId,
      source: 'fixture', status, faultReason, simTimeMs: time, tick, environment: 'home', dataset: RUNTIME_DATASET,
      model: {
        id: RUNTIME_DATASET.modelId, label: 'Synthetic LIF fixture', neuronCount: neurons.length, edgeCount: edges.length,
        limitations: '32 invented neurons and 64 fixed connections. Engineered inputs and geometry. No biological anatomy, RNG dynamics, plasticity, demonstrated learning, or inferred mental state. An optional engineered retinal/motor adapter can drive the illustrated body; this is not biological embodiment. Checkpoints preserve only supported neural fixture state; restore cancels active optional input.',
      },
      safeguards: { maxRateHz: MAX_RATE_HZ, maxPotentialBeforeReset: MAX_POTENTIAL_BEFORE_RESET,
        disclosure: 'Engineered numerical fault limits, not biological activity thresholds or welfare scores. When attached, the engineered controller-camera adapter separately validates observation freshness.' },
      neural: { neurons, edges, spikes: neurons.filter(n => n.firing).length, meanRateHz: neurons.reduce((sum, n) => sum + n.rateHz, 0) / neurons.length },
      stimulusPolicy,
      chemistry: stimulusPolicy.effects.map(({ intensity, durationMs, targets, ...effect }) => effect),
      events,
      capabilities: {
        connectome: { available: false, reason: 'The observatory is using its explicit synthetic fixture. The research connectome backend is not integrated into this habitat.' },
        llm: { available: false, reason: 'Language interpreter is not configured. No provider calls are made.' },
        eidoverse: { available: false, reason: 'Scoped embodied visitor protocol and host support are not implemented. The fly is at home.' },
      },
    });
  }

  function control(action) {
    if (!['start', 'pause', 'rest', 'home'].includes(action)) throw new RuntimeError('Unknown control action.');
    if (status === 'fault') {
      if (action === 'start') throw new RuntimeError('Runtime fault requires an explicit validated checkpoint restore.', 409);
      return snapshot();
    }
    if (action === 'start') faultReason = null;
    const next = action === 'start' ? 'running' : action === 'rest' ? 'resting' : 'paused';
    if (action === 'rest' || action === 'home') {
      // Stop stimulation without erasing cooldowns or resetting neural state.
      policy.cancelOptional();
    }
    if (status !== next || action === 'home') {
      status = next;
      log('control', action === 'home' ? 'At home and paused. Neural state retained.' : `Fixture ${status}.`);
    }
    return snapshot();
  }

  // Source is bound by the server adapter, never taken from a caller's HTTP payload.
  function stimulate(source, request) {
    try {
      if (status !== 'running') throw new RuntimeError('Start the fixture before offering an encounter.', 409);
      const accepted = policy.admit(source, request);
      log('policy', 'Optional synthetic stimulus accepted. Engineered mapping; not inferred consent.', {
        decision: 'accepted', ...accepted,
      });
    } catch (error) {
      log('policy', 'Stimulus rejected before delivery.', { decision: 'rejected', reason: error.message });
      throw error;
    }
    return snapshot();
  }

  function encounter(compoundId) {
    let request;
    try { request = policy.envelope('ui', compoundId); }
    catch (error) {
      log('policy', 'Stimulus rejected before delivery.', { decision: 'rejected', reason: error.message });
      throw error;
    }
    return stimulate('ui', request);
  }

  // Retained for callers using the conservative, authenticated same-session policy rewind hook.
  function restoreStimulusPolicy(saved) {
    policy.restore(saved);
    if (status !== 'fault') status = 'paused';
    log('policy', 'Policy checkpoint reconciled; advancement stopped, optional input canceled and spent reservations retained.');
    return snapshot();
  }

  function checkpoint() {
    return structuredClone({ schemaVersion: 1, protocolVersion: RUNTIME_PROTOCOL_VERSION, individualId,
      dataset: RUNTIME_DATASET, parameters: PARAMETERS,
      dynamics: { tick, potentials: neurons.map(neuron => neuron.potential), firing: neurons.map(neuron => neuron.firing), spikeHistory },
      stimulusPolicy: policy.durableCheckpoint(), unsupported: UNSUPPORTED, faultReason });
  }

  function pauseFault(reason) {
    if (typeof reason !== 'string' || !reason.length || reason.length > 500) throw new RuntimeError('Invalid fault reason.');
    status = 'fault';
    faultReason = reason;
    policy.cancelOptional();
    log('fault', reason);
    return snapshot();
  }

  function step(input) {
    let retinalCurrents = null;
    if (input !== undefined) {
      if (!exactKeys(input, ['retinalCurrents'])) throw new RuntimeError('Unsupported fixture sensory input.');
      retinalCurrents = validateRetinalCurrents(input.retinalCurrents);
    }
    if (status !== 'running') return;
    const nextTick = tick + 1;
    const nextTime = nextTick * STEP_MS;
    if (!Number.isSafeInteger(nextTick) || !Number.isSafeInteger(nextTime)) {
      pauseFault('Simulation clock exceeded its safe numerical range; last valid state retained.');
      return;
    }
    const currents = neurons.map((_, i) => PARAMETERS.baselineCurrent + (i % 5) * PARAMETERS.baselineCurrentStride);
    if (retinalCurrents) currents.forEach((_, i) => { currents[i] += retinalCurrents[i]; });
    for (const { source, target, weight } of edges) {
      if (neurons[Number(source.slice(8))].firing) currents[Number(target.slice(8))] += weight;
    }
    for (const [target, intensity] of policy.currents()) currents[Number(target.slice(8))] += intensity;
    const next = [];
    const nextHistory = [];
    for (let i = 0; i < neurons.length; i++) {
      const neuron = neurons[i];
      const potential = neuron.potential * PARAMETERS.membraneRetention + currents[i];
      if (!Number.isFinite(potential) || Math.abs(potential) > MAX_POTENTIAL_BEFORE_RESET) {
        pauseFault('Non-finite or excessive fixture potential; last valid state retained.');
        return;
      }
      const firing = potential >= PARAMETERS.threshold;
      const history = spikeHistory[i].filter(time => time > nextTime - PARAMETERS.rateWindowMs);
      if (firing) history.push(nextTime);
      // Fixed trailing 1 s window; the initial partial window is padded with zero activity.
      if (history.length > MAX_RATE_HZ) {
        pauseFault('Fixture firing rate exceeded its numerical guard; last valid state retained.');
        return;
      }
      next.push({ potential: firing ? PARAMETERS.resetPotential : Math.max(PARAMETERS.minimumPotential, potential), firing, rateHz: history.length });
      nextHistory.push(history);
    }
    // Commit only after every candidate value passes: a failed step never partially advances a neuron or the policy clock.
    policy.advance(nextTime);
    tick = nextTick;
    for (let i = 0; i < neurons.length; i++) Object.assign(neurons[i], next[i]);
    spikeHistory = nextHistory;
  }

  function cancelStimulus(source, entryId) {
    const canceled = policy.cancelEntry(source, entryId);
    if (canceled) log('policy', 'Scoped optional input canceled; spent reservation and recovery retained.', { source, entryId });
    return canceled;
  }

  return { snapshot, control, encounter, stimulate, stimulusEnvelope: policy.envelope, cancelStimulus, step, checkpoint, pauseFault,
    checkpointStimulusPolicy: policy.checkpoint, restoreStimulusPolicy };
}
