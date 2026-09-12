/** Original deterministic fixture. This is not a biological connectome or a learning model. */
const STEP_MS = 5;
import { randomUUID } from 'node:crypto';
import { createStimulusPolicy } from './stimulus-policy.js';

export class RuntimeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createRuntime({ individualId = 'synthetic-fixture', sessionId = randomUUID() } = {}) {
  const policy = createStimulusPolicy({ individualId, sessionId });
  let status = 'paused';
  let tick = 0;
  let eventId = 0;
  const events = [];
  const neurons = Array.from({ length: 32 }, (_, i) => ({
    id: `fixture-${i}`, region: i < 16 ? 'Synthetic left' : 'Synthetic right',
    x: (i < 16 ? -1 : 1) + Math.cos(i * 2.399) * 0.65,
    y: Math.sin(i * 2.399) * 0.7,
    z: ((i % 7) - 3) * 0.16,
    potential: (i % 8) * 0.04, firing: false, rateHz: 0,
  }));
  const edges = neurons.flatMap((n, i) => [
    { source: n.id, target: neurons[(i + 1) % neurons.length].id, weight: 0.11 },
    { source: n.id, target: neurons[(i + 7) % neurons.length].id, weight: -0.035 },
  ]);
  const spikeHistory = neurons.map(() => []);
  const log = (type, message, details) => {
    events.unshift({ id: ++eventId, timeMs: tick * STEP_MS, type, message, ...(details ? { details } : {}) });
    if (events.length > 80) events.pop();
  };
  log('system', 'Synthetic fixture ready. Paused; no connectome loaded. State is session-only.');

  function snapshot() {
    const time = tick * STEP_MS;
    const stimulusPolicy = policy.snapshot();
    return structuredClone({
      schemaVersion: 1, source: 'fixture', status, simTimeMs: time, tick, environment: 'home',
      model: {
        id: 'synthetic-lif-v1', label: 'Synthetic LIF fixture', neuronCount: neurons.length, edgeCount: edges.length,
        limitations: '32 invented neurons and 64 fixed connections. Engineered inputs and geometry. No biological anatomy, plasticity, demonstrated learning, or inferred mental state. Session-only state.',
      },
      neural: { neurons, edges, spikes: neurons.filter(n => n.firing).length, meanRateHz: neurons.reduce((sum, n) => sum + n.rateHz, 0) / neurons.length },
      stimulusPolicy,
      chemistry: stimulusPolicy.effects.map(({ intensity, durationMs, targets, ...effect }) => effect),
      events,
      capabilities: {
        connectome: { available: false, reason: 'Real dataset import and neural worker are not implemented. This is an explicit synthetic fixture.' },
        llm: { available: false, reason: 'Language interpreter is not configured. No provider calls are made.' },
        eidoverse: { available: false, reason: 'Scoped embodied visitor protocol and host support are not implemented. The fly is at home.' },
      },
    });
  }

  function control(action) {
    if (!['start', 'pause', 'rest', 'home'].includes(action)) throw new RuntimeError('Unknown control action.');
    const next = action === 'start' ? 'running' : action === 'rest' ? 'resting' : 'paused';
    if (action === 'rest' || action === 'home') {
      // Stop stimulation without erasing cooldowns or resetting neural state.
      policy.cancelOptional();
    }
    if (status !== next || action === 'home') {
      status = next;
      log('control', action === 'home' ? 'At home and paused. Neural state retained in this session.' : `Fixture ${status}.`);
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

  // Internal checkpoint hook only. No HTTP import/export or durable identity is implemented yet.
  function restoreStimulusPolicy(saved) {
    policy.restore(saved);
    status = 'paused';
    log('policy', 'Policy checkpoint reconciled; paused, optional input canceled and spent reservations retained.');
    return snapshot();
  }

  function step() {
    if (status !== 'running') return;
    const currents = neurons.map((_, i) => 0.055 + (i % 5) * 0.003);
    for (const { source, target, weight } of edges) {
      if (neurons[Number(source.slice(8))].firing) currents[Number(target.slice(8))] += weight;
    }
    for (const [target, intensity] of policy.currents()) currents[Number(target.slice(8))] += intensity;
    tick++;
    policy.advance(tick * STEP_MS);
    for (let i = 0; i < neurons.length; i++) {
      const neuron = neurons[i];
      const potential = neuron.potential * 0.975 + currents[i];
      neuron.firing = potential >= 1;
      neuron.potential = neuron.firing ? 0 : Math.max(0, potential);
      if (neuron.firing) spikeHistory[i].push(tick * STEP_MS);
      while (spikeHistory[i].length && spikeHistory[i][0] <= tick * STEP_MS - 1000) spikeHistory[i].shift();
      // Fixed trailing 1 s window; the initial partial window is padded with zero activity.
      neuron.rateHz = spikeHistory[i].length;
    }
  }

  return { snapshot, control, encounter, stimulate, step,
    checkpointStimulusPolicy: policy.checkpoint, restoreStimulusPolicy };
}
