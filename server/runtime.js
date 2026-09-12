/** Original deterministic fixture. This is not a biological connectome or a learning model. */
const STEP_MS = 5;
const COMPOUNDS = [
  { id: 'nectar', label: 'Nectar', description: 'Brief synthetic input to four fixture neurons; no biological reward claim.', durationMs: 300, cooldownMs: 3000, drive: 0.045 },
  { id: 'floral', label: 'Floral scent', description: 'Brief synthetic sensory input; not a receptor or pheromone model.', durationMs: 500, cooldownMs: 3000, drive: 0.025 },
  { id: 'quiet', label: 'Quiet bloom', description: 'Temporarily reduces the engineered baseline input.', durationMs: 500, cooldownMs: 3000, drive: -0.02 },
];

export class RuntimeError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createRuntime() {
  let status = 'paused';
  let tick = 0;
  let eventId = 0;
  let lastEncounterAt = -Infinity;
  const events = [];
  const exposures = new Map();
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
  const log = (type, message) => {
    events.unshift({ id: ++eventId, timeMs: tick * STEP_MS, type, message });
    if (events.length > 80) events.pop();
  };
  log('system', 'Synthetic fixture ready. Paused; no connectome loaded. State is session-only.');

  function snapshot() {
    const time = tick * STEP_MS;
    return structuredClone({
      schemaVersion: 1, source: 'fixture', status, simTimeMs: time, tick, environment: 'home',
      model: {
        id: 'synthetic-lif-v1', label: 'Synthetic LIF fixture', neuronCount: neurons.length, edgeCount: edges.length,
        limitations: '32 invented neurons and 64 fixed connections. Engineered inputs and geometry. No biological anatomy, plasticity, demonstrated learning, or inferred mental state. Session-only state.',
      },
      neural: { neurons, edges, spikes: neurons.filter(n => n.firing).length, meanRateHz: neurons.reduce((sum, n) => sum + n.rateHz, 0) / neurons.length },
      chemistry: COMPOUNDS.map(({ drive, durationMs, cooldownMs, ...compound }) => {
        const exposure = exposures.get(compound.id);
        return { ...compound, active: !!exposure && time < exposure.endsAt,
          remainingMs: Math.max(0, (exposure?.endsAt ?? 0) - time),
          cooldownRemainingMs: Math.max(0, (exposure?.readyAt ?? 0) - time, lastEncounterAt + 1000 - time) };
      }),
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
      for (const exposure of exposures.values()) exposure.endsAt = Math.min(exposure.endsAt, tick * STEP_MS);
    }
    if (status !== next || action === 'home') {
      status = next;
      log('control', action === 'home' ? 'At home and paused. Neural state retained in this session.' : `Fixture ${status}.`);
    }
    return snapshot();
  }

  function encounter(compoundId) {
    const compound = COMPOUNDS.find(item => item.id === compoundId);
    if (!compound) throw new RuntimeError('Unknown virtual compound.');
    if (status !== 'running') throw new RuntimeError('Start the fixture before offering an encounter.', 409);
    const time = tick * STEP_MS;
    if (time < (exposures.get(compoundId)?.readyAt ?? 0) || time < lastEncounterAt + 1000) {
      throw new RuntimeError('Encounter cooldown is still active in simulation time.', 409);
    }
    lastEncounterAt = time;
    exposures.set(compoundId, { endsAt: time + compound.durationMs, readyAt: time + compound.cooldownMs });
    log('encounter', `${compound.label}: bounded synthetic effect for ${compound.durationMs} ms of simulation time. Admin offered; not an autonomous choice.`);
    return snapshot();
  }

  function step() {
    if (status !== 'running') return;
    const time = tick * STEP_MS;
    const currents = neurons.map((_, i) => 0.055 + (i % 5) * 0.003);
    for (const { source, target, weight } of edges) {
      if (neurons[Number(source.slice(8))].firing) currents[Number(target.slice(8))] += weight;
    }
    for (const compound of COMPOUNDS) {
      if (time >= (exposures.get(compound.id)?.endsAt ?? 0)) continue;
      for (let i = 0; i < neurons.length; i++) {
        if (compound.id === 'quiet' || (compound.id === 'nectar' ? i < 4 : i >= 16 && i < 20)) currents[i] += compound.drive;
      }
    }
    tick++;
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

  return { snapshot, control, encounter, step };
}
