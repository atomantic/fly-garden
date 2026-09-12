/** Original research kernel. Anatomy is measured; every parameter below is engineered. */
export const LIF_MODEL = Object.freeze({
  id: 'malecns-traced-lif-v1', dtMs: 1, tauMs: 20, threshold: 1, reset: 0,
  refractorySteps: 2, delaySteps: 1, contactGain: 0.001, restingDrive: 0,
  precision: 'float64', integration: 'exact exponential leak, then delayed instantaneous synaptic jumps',
});

export function validateGraph(graph) {
  const { ids, offsets, targets, contacts, signs } = graph;
  if (!Array.isArray(ids) || !(offsets instanceof Uint32Array) || !(targets instanceof Uint32Array) ||
      !(contacts instanceof Uint32Array) || !(signs instanceof Int8Array)) throw new Error('Invalid sparse array types');
  const n = ids.length;
  if (!n || new Set(ids).size !== n || Array.from(ids).some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) {
    throw new Error('Invalid stable string neuron IDs');
  }
  if (offsets.length !== n + 1 || offsets[0] !== 0 || offsets[n] !== targets.length ||
      contacts.length !== targets.length || signs.length !== n) throw new Error('Incompatible sparse dimensions');
  for (let i = 0; i < n; i++) {
    if (offsets[i] > offsets[i + 1] || ![-1, 0, 1].includes(signs[i])) throw new Error('Invalid sparse index/sign');
  }
  for (let e = 0; e < targets.length; e++) {
    if (targets[e] >= n || contacts[e] < 1) throw new Error('Invalid target/contact count');
  }
}

export function createSparseLif(graph) {
  validateGraph(graph);
  const { ids, offsets, targets, contacts, signs } = graph;
  const n = ids.length;
  let potential = new Float64Array(n);
  let firing = new Uint8Array(n);
  let refractory = new Uint8Array(n);
  let nextPotential = new Float64Array(n);
  let nextFiring = new Uint8Array(n);
  let nextRefractory = new Uint8Array(n);
  const incoming = new Float64Array(n);
  const decay = Math.exp(-LIF_MODEL.dtMs / LIF_MODEL.tauMs);
  let tick = 0, totalSpikes = 0, traversedEdges = 0;

  // A one-time, explicitly requested numerical probe. No tonic/reward drive or RNG.
  function seedProbe(indices) {
    if (tick !== 0 || firing.some(Boolean)) throw new Error('Probe must precede advancement');
    if (!Array.isArray(indices) || indices.length > n || new Set(indices).size !== indices.length ||
        Array.from(indices).some(index => !Number.isInteger(index) || index < 0 || index >= n)) throw new Error('Invalid probe indices');
    for (const index of indices) {
      firing[index] = 1;
      refractory[index] = LIF_MODEL.refractorySteps;
    }
  }

  function step() {
    incoming.fill(0);
    let visited = 0, spikes = 0;
    for (let source = 0; source < n; source++) {
      if (!firing[source]) continue;
      for (let edge = offsets[source]; edge < offsets[source + 1]; edge++) {
        incoming[targets[edge]] += signs[source] * contacts[edge] * LIF_MODEL.contactGain;
        visited++;
      }
    }
    for (let i = 0; i < n; i++) {
      nextFiring[i] = 0;
      nextRefractory[i] = refractory[i] > 0 ? refractory[i] - 1 : 0;
      const value = refractory[i] > 0 ? LIF_MODEL.reset : potential[i] * decay + incoming[i];
      if (!Number.isFinite(value)) throw new Error('Non-finite neural state; last valid state retained');
      // Negative voltage is permitted, without interpreting it as punishment/pain.
      nextPotential[i] = value;
      if (value >= LIF_MODEL.threshold) {
        nextFiring[i] = 1;
        nextPotential[i] = LIF_MODEL.reset;
        nextRefractory[i] = LIF_MODEL.refractorySteps;
        spikes++;
      }
    }
    [potential, nextPotential] = [nextPotential, potential];
    [firing, nextFiring] = [nextFiring, firing];
    [refractory, nextRefractory] = [nextRefractory, refractory];
    tick++;
    totalSpikes += spikes;
    traversedEdges += visited;
  }

  function summary() {
    let spikes = 0, minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < n; i++) {
      spikes += firing[i];
      minimum = Math.min(minimum, potential[i]);
      maximum = Math.max(maximum, potential[i]);
    }
    return { tick, simTimeMs: tick * LIF_MODEL.dtMs, spikes, totalSpikes, traversedEdges, minimum, maximum };
  }
  // Copies for small numerical diagnostics only; full graph benchmark uses summary().
  return { step, seedProbe, summary,
    inspect: () => ({ potential: potential.slice(), firing: firing.slice(), refractory: refractory.slice() }) };
}
