import { createHash, randomUUID } from 'node:crypto';
import { connectomeProfile } from './connectome-profiles.js';
/** Original research kernel. Anatomy is measured; every parameter below is engineered. */
export const LIF_MODEL = Object.freeze({
  id: 'malecns-traced-lif-v1', dtMs: 1, tauMs: 20, threshold: 1, reset: 0,
  refractorySteps: 2, delaySteps: 1, contactGain: 0.001, restingDrive: 0,
  precision: 'float64', integration: 'exact exponential leak, then delayed instantaneous synaptic jumps',
});

export const MAX_NEURON_SAMPLE = 256;
/** Validate the bounded request before graph lookup or result allocation. */
export function validateNeuronSampleIds(neuronIds, dataset) {
  if (!['male-cns:v1.0', 'banc:v888'].includes(dataset) || !Array.isArray(neuronIds)
    || neuronIds.length < 1 || neuronIds.length > MAX_NEURON_SAMPLE) throw new Error('Sample requires 1–256 exact namespaced neuron IDs');
  for (const id of neuronIds) {
    if (typeof id !== 'string' || id.length > 128 || !id.startsWith(`${dataset}/`)
      || !/^[1-9]\d*$/.test(id.slice(dataset.length + 1))) throw new Error('Sample neuron ID does not match the exact dataset namespace');
  }
  if (new Set(neuronIds).size !== neuronIds.length) throw new Error('Duplicate sample neuron ID');
}

export function validateGraph(graph) {
  const { ids, offsets, targets, contacts, signs } = graph;
  if (!Array.isArray(ids) || !(offsets instanceof Uint32Array) || !(targets instanceof Uint32Array) ||
      !(contacts instanceof Uint32Array) || !(signs instanceof Int8Array)) throw new Error('Invalid sparse array types');
  const n = ids.length;
  const namespace = typeof ids[0] === 'string' && ids[0].includes('/') ? ids[0].split('/')[0] : null;
  if (!n || new Set(ids).size !== n || Array.from(ids).some(id => typeof id !== 'string' ||
      !(namespace ? ['male-cns:v1.0', 'banc:v888'].includes(namespace) &&
        id.startsWith(`${namespace}/`) && /^[1-9]\d*$/.test(id.slice(namespace.length + 1)) : /^[1-9]\d*$/.test(id)))) {
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

export function createSparseLif(graph, { individualId = randomUUID(), dataset = null, checkpoint = null } = {}) {
  validateGraph(graph);
  const { ids, offsets, targets, contacts, signs } = graph;
  if (typeof individualId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(individualId)) throw new Error('Invalid individual identity');
  const namespace = ids[0].includes('/') ? ids[0].split('/')[0] : null;
  if (dataset === null && namespace) dataset = namespace;
  if (dataset !== null && (!connectomeProfile(dataset) || namespace !== dataset)) throw new Error('Graph dataset namespace mismatch');
  if (namespace && dataset !== namespace) throw new Error('Explicit graph dataset required');
  const model = Object.freeze({ ...LIF_MODEL, id: dataset ? connectomeProfile(dataset).modelId : LIF_MODEL.id });
  const hash = createHash('sha256');
  hash.update(JSON.stringify(ids));
  // Canonical little-endian words, independent of host typed-array byte order.
  const word = Buffer.alloc(4);
  const chunk = Buffer.allocUnsafe(65536);
  for (const array of [offsets, targets, contacts]) {
    word.writeUInt32LE(array.length); hash.update(word);
    for (let start = 0; start < array.length; start += chunk.length / 4) {
      const count = Math.min(array.length - start, chunk.length / 4);
      for (let i = 0; i < count; i++) chunk.writeUInt32LE(array[start + i], i * 4);
      hash.update(chunk.subarray(0, count * 4));
    }
  }
  hash.update(Buffer.from(signs.buffer, signs.byteOffset, signs.byteLength));
  const graphSha256 = hash.digest('hex');
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
  let revision = Symbol();
  const preparedRestores = new WeakMap();

  // A one-time, explicitly requested numerical probe. No tonic/reward drive or RNG.
  function seedProbe(indices) {
    if (tick !== 0 || firing.some(Boolean)) throw new Error('Probe must precede advancement');
    if (!Array.isArray(indices) || indices.length > n || new Set(indices).size !== indices.length ||
        Array.from(indices).some(index => !Number.isInteger(index) || index < 0 || index >= n)) throw new Error('Invalid probe indices');
    revision = Symbol();
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
    if (![tick + 1, totalSpikes + spikes, traversedEdges + visited].every(Number.isSafeInteger)) throw new Error('Neural clock/counter limit; last valid state retained');
    [potential, nextPotential] = [nextPotential, potential];
    [firing, nextFiring] = [nextFiring, firing];
    [refractory, nextRefractory] = [nextRefractory, refractory];
    revision = Symbol();
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
  function sample(neuronIds) {
    validateNeuronSampleIds(neuronIds, dataset);
    // Only the requested lookup is allocated: no persistent all-neuron index or
    // full-state copy changes the worker's measured resident memory footprint.
    const requested = new Map(neuronIds.map(id => [id, -1]));
    let found = 0;
    for (let index = 0; index < ids.length && found < neuronIds.length; index++) {
      if (requested.has(ids[index])) { requested.set(ids[index], index); found++; }
    }
    if (found !== neuronIds.length) throw new Error('Unknown sample neuron ID; no partial sample returned');
    const simTimeMs = tick * model.dtMs;
    return { protocolVersion: 1, kind: 'connectome-neuron-sample', source: 'connectome',
      individualId, dataset, graphSha256, modelId: model.id, tick, simTimeMs,
      timeWindow: { kind: 'instantaneous', startTick: tick, endTick: tick, startSimTimeMs: simTimeMs, endSimTimeMs: simTimeMs },
      samples: neuronIds.map(neuronId => {
        const index = requested.get(neuronId);
        return { neuronId, potential: potential[index], firing: firing[index], refractoryStepsRemaining: refractory[index] };
      }),
      disclosure: 'Instantaneous modeled potential, pending one-step firing flag and refractory steps remaining. Not firing rates, recorded biology, learning, welfare or body-control evidence.' };
  }
  function exportCheckpoint() {
    return { schemaVersion: 1, kind: 'sparse-lif', individualId, dataset, graphSha256,
      model: { ...model }, tick, totalSpikes, traversedEdges,
      potential: Array.from(potential), firing: Array.from(firing), refractory: Array.from(refractory) };
  }
  function prepareRestore(saved) {
    const expected = ['schemaVersion', 'kind', 'individualId', 'dataset', 'graphSha256', 'model', 'tick', 'totalSpikes', 'traversedEdges', 'potential', 'firing', 'refractory'];
    if (!saved || typeof saved !== 'object' || Object.keys(saved).length !== expected.length || expected.some(k => !Object.hasOwn(saved, k)) ||
      saved.schemaVersion !== 1 || saved.kind !== 'sparse-lif' || saved.individualId !== individualId || saved.dataset !== dataset || saved.graphSha256 !== graphSha256 ||
      !saved.model || Object.keys(saved.model).length !== Object.keys(model).length || Object.entries(model).some(([k,v]) => saved.model[k] !== v)) throw new Error('Incompatible neural checkpoint identity/model/graph');
    if (![saved.tick, saved.totalSpikes, saved.traversedEdges].every(v => Number.isSafeInteger(v) && v >= 0)) throw new Error('Invalid neural checkpoint clock/counters');
    if (![saved.potential, saved.firing, saved.refractory].every(a => Array.isArray(a) && a.length === n)) throw new Error('Invalid neural checkpoint dimensions');
    let pendingSpikes = 0;
    for (let i = 0; i < n; i++) {
      const v = saved.potential[i], f = saved.firing[i], r = saved.refractory[i];
      if (!Number.isFinite(v) || v >= model.threshold || ![0, 1].includes(f) || !Number.isInteger(r) || r < 0 || r > model.refractorySteps ||
        (r > 0 && v !== model.reset) || ((f === 1) !== (r === model.refractorySteps))) throw new Error('Invalid neural checkpoint state');
      // Before the first step only seedProbe may change state: reset voltage and
      // either unseeded (0,0) or pending probe (1,refractorySteps), with no counters.
      if (saved.tick === 0 && (v !== model.reset || (r !== 0 && r !== model.refractorySteps))) throw new Error('Invalid initial neural checkpoint state');
      pendingSpikes += f;
    }
    // One update emits at most n spikes and traverses each directed edge at most
    // once. BigInt keeps these bounds exact even when tick*n exceeds safe Number.
    if (BigInt(saved.totalSpikes) > BigInt(saved.tick) * BigInt(n)
      || BigInt(saved.traversedEdges) > BigInt(saved.tick) * BigInt(targets.length)
      || (saved.tick > 0 && pendingSpikes > saved.totalSpikes)) throw new Error('Inconsistent neural checkpoint history');
    // Allocate and validate everything before replacing any authoritative state.
    const p = Float64Array.from(saved.potential), f = Uint8Array.from(saved.firing), r = Uint8Array.from(saved.refractory);
    const token = Object.freeze(Object.create(null));
    preparedRestores.set(token, { revision, p, f, r, tick: saved.tick, totalSpikes: saved.totalSpikes, traversedEdges: saved.traversedEdges });
    return token;
  }
  function commitRestore(token) {
    const candidate = preparedRestores.get(token);
    if (!candidate || candidate.revision !== revision) throw new Error('Stale or foreign prepared neural restore');
    preparedRestores.delete(token);
    potential = candidate.p; firing = candidate.f; refractory = candidate.r;
    tick = candidate.tick; totalSpikes = candidate.totalSpikes; traversedEdges = candidate.traversedEdges;
    revision = Symbol();
    return summary();
  }
  function restore(saved) {
    return commitRestore(prepareRestore(saved));
  }
  if (checkpoint !== null) restore(checkpoint);
  // Graph ownership is transferred to the kernel; callers must not mutate CSR arrays.
  // Copies for small numerical diagnostics only; full graph benchmark uses summary().
  return { step, seedProbe, summary, sample, checkpoint: exportCheckpoint, restore, prepareRestore, commitRestore, individualId, graphSha256, model,
    inspect: () => ({ potential: potential.slice(), firing: firing.slice(), refractory: refractory.slice() }) };
}
