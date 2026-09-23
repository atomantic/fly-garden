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

/**
 * Retained mutable state beyond the LIF arrays. The kernel owns the exactness
 * contract (key set, canonical JSON, finite numbers, bounded size, digest); the
 * plasticity and campaign modules own every biological/protocol interpretation.
 * A checkpoint without this block is a schema-version 1 checkpoint and stays
 * loadable unchanged.
 */
export const CHECKPOINT_EXTENSION_KEYS = Object.freeze(['plasticityGains', 'eligibilityTraces', 'worldPhase', 'bodyPose', 'rngState']);
const MAX_EXTENSION_BYTES = 64 * 1024 * 1024;
const MAX_EXTENSION_DEPTH = 8;

function canonicalJson(value, depth = 0) {
  if (depth > MAX_EXTENSION_DEPTH) throw new Error('Checkpoint extension nesting exceeds the declared depth');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Checkpoint extension carries a non-finite number');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 4096) throw new Error('Checkpoint extension string exceeds the declared length');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => canonicalJson(item, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key], depth + 1)]));
  }
  throw new Error('Checkpoint extension accepts only plain JSON values');
}

/** Canonicalize, bound and digest the extension block; never interprets its meaning. */
export function normalizeCheckpointExtensions(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== CHECKPOINT_EXTENSION_KEYS.length
    || CHECKPOINT_EXTENSION_KEYS.some(key => !Object.hasOwn(value, key))) throw new Error('Checkpoint extensions require exactly the declared keys');
  const canonical = canonicalJson(value);
  const serialized = JSON.stringify(canonical);
  if (serialized.length > MAX_EXTENSION_BYTES) throw new Error('Checkpoint extension exceeds the declared size bound');
  return { value: canonical, sha256: createHash('sha256').update(serialized).digest('hex') };
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
  let extensions = null;
  let revision = Symbol();
  const preparedRestores = new WeakMap();
  const preparedAdvances = new WeakMap();

  function prepareAdvance(steps) {
    if (!Number.isInteger(steps) || steps < 1 || steps > 1000) throw new Error('Advance must be 1–1000 steps');
    let candidatePotential = potential.slice();
    let candidateFiring = firing.slice();
    let candidateRefractory = refractory.slice();
    let nextPotential = new Float64Array(n);
    let nextFiring = new Uint8Array(n);
    let nextRefractory = new Uint8Array(n);
    let candidateTick = tick;
    let candidateTotalSpikes = totalSpikes;
    let candidateTraversedEdges = traversedEdges;
    for (let step = 0; step < steps; step++) {
      let visited = 0;
      let spikes = 0;
      incoming.fill(0);
      nextFiring.fill(0);
      nextRefractory.fill(0);
      for (let source = 0; source < n; source++) {
        if (!candidateFiring[source]) continue;
        for (let edge = offsets[source]; edge < offsets[source + 1]; edge++) {
          incoming[targets[edge]] += signs[source] * contacts[edge] * LIF_MODEL.contactGain;
          visited++;
        }
      }
      for (let i = 0; i < n; i++) {
        nextRefractory[i] = candidateRefractory[i] > 0 ? candidateRefractory[i] - 1 : 0;
        const value = candidateRefractory[i] > 0 ? LIF_MODEL.reset : candidatePotential[i] * decay + incoming[i];
        if (!Number.isFinite(value)) throw new Error('Non-finite neural state; last valid state retained');
        nextPotential[i] = value;
        if (value >= LIF_MODEL.threshold) {
          nextFiring[i] = 1;
          nextPotential[i] = LIF_MODEL.reset;
          nextRefractory[i] = LIF_MODEL.refractorySteps;
          spikes++;
        }
      }
      if (![candidateTick + 1, candidateTotalSpikes + spikes, candidateTraversedEdges + visited].every(Number.isSafeInteger)) {
        throw new Error('Neural clock/counter limit; last valid state retained');
      }
      [candidatePotential, nextPotential] = [nextPotential, candidatePotential];
      [candidateFiring, nextFiring] = [nextFiring, candidateFiring];
      [candidateRefractory, nextRefractory] = [nextRefractory, candidateRefractory];
      candidateTick++;
      candidateTotalSpikes += spikes;
      candidateTraversedEdges += visited;
    }
    const token = Object.freeze(Object.create(null));
    preparedAdvances.set(token, { revision, potential: candidatePotential, firing: candidateFiring,
      refractory: candidateRefractory, tick: candidateTick, totalSpikes: candidateTotalSpikes,
      traversedEdges: candidateTraversedEdges, beforePotential: potential, beforeFiring: firing,
      beforeRefractory: refractory, beforeTick: tick, beforeTotalSpikes: totalSpikes,
      beforeTraversedEdges: traversedEdges, committed: false, committedRevision: null });
    return token;
  }

  function commitAdvance(token) {
    const candidate = preparedAdvances.get(token);
    if (!candidate || candidate.revision !== revision || candidate.committed) throw new Error('Stale or foreign prepared neural advance');
    potential = candidate.potential;
    firing = candidate.firing;
    refractory = candidate.refractory;
    tick = candidate.tick;
    totalSpikes = candidate.totalSpikes;
    traversedEdges = candidate.traversedEdges;
    candidate.committed = true;
    candidate.committedRevision = revision = Symbol();
    return summary();
  }
  function rollbackAdvance(token) {
    const candidate = preparedAdvances.get(token);
    if (!candidate || !candidate.committed || candidate.committedRevision !== revision) throw new Error('Stale or foreign committed neural advance');
    potential = candidate.beforePotential;
    firing = candidate.beforeFiring;
    refractory = candidate.beforeRefractory;
    tick = candidate.beforeTick;
    totalSpikes = candidate.beforeTotalSpikes;
    traversedEdges = candidate.beforeTraversedEdges;
    preparedAdvances.delete(token);
    revision = Symbol();
    return summary();
  }
  function releaseAdvance(token) {
    const candidate = preparedAdvances.get(token);
    if (!candidate) throw new Error('Unknown prepared neural advance');
    if (candidate.committed && candidate.committedRevision !== revision) throw new Error('Prepared neural advance was mutated');
    preparedAdvances.delete(token);
    return summary();
  }

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

  function step(inputs = []) {
    // Explicit one-step engineering input; no retained drive or episode authority.
    // Validate the complete sparse envelope before touching even scratch arrays.
    if (!Array.isArray(inputs) || inputs.length > Math.min(n, 4000)) throw new Error('Invalid sparse external input');
    const external = new Map(); let totalDeltaV = 0;
    for (const input of inputs) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2
        || !Object.hasOwn(input, 'index') || !Object.hasOwn(input, 'deltaV')
        || !Number.isInteger(input.index) || input.index < 0 || input.index >= n || external.has(input.index)
        || !Number.isFinite(input.deltaV) || input.deltaV < 0 || input.deltaV > 1.25) throw new Error('Invalid sparse external input');
      totalDeltaV += input.deltaV; if (totalDeltaV > 5000) throw new Error('External input sum exceeded');
      external.set(input.index, input.deltaV);
    }
    const hasExternal = external.size !== 0;
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
      const value = refractory[i] > 0 ? LIF_MODEL.reset : potential[i] * decay + incoming[i] + (hasExternal ? external.get(i) ?? 0 : 0);
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
    // Without retained plasticity/world/RNG state the export is byte-identical to
    // the original schema-version 1 record, so every earlier checkpoint and digest
    // stays valid.
    const base = { schemaVersion: extensions ? 2 : 1, kind: 'sparse-lif', individualId, dataset, graphSha256,
      model: { ...model }, tick, totalSpikes, traversedEdges,
      potential: Array.from(potential), firing: Array.from(firing), refractory: Array.from(refractory) };
    return extensions ? { ...base, extensions: structuredClone(extensions.value) } : base;
  }
  /** Explicit caller-owned mutable state. Passing null returns the kernel to schema 1. */
  function setCheckpointExtensions(value) {
    extensions = normalizeCheckpointExtensions(value);
    revision = Symbol();
    return extensions ? extensions.sha256 : null;
  }
  const readCheckpointExtensions = () => (extensions ? structuredClone(extensions.value) : null);
  const checkpointExtensionsSha256 = () => (extensions ? extensions.sha256 : null);
  function prepareRestore(saved) {
    const expected = ['schemaVersion', 'kind', 'individualId', 'dataset', 'graphSha256', 'model', 'tick', 'totalSpikes', 'traversedEdges', 'potential', 'firing', 'refractory'];
    // Schema 1 carries neural arrays only; schema 2 adds exactly one extension
    // block. Any other key, or a schema/extension mismatch, is still rejected.
    const extended = saved && typeof saved === 'object' && saved.schemaVersion === 2;
    const keys = extended ? [...expected, 'extensions'] : expected;
    let restoredExtensions = null;
    if (extended) {
      try { restoredExtensions = normalizeCheckpointExtensions(saved.extensions); } catch { throw new Error('Invalid neural checkpoint extension block'); }
      if (restoredExtensions === null) throw new Error('Invalid neural checkpoint extension block');
    }
    if (!saved || typeof saved !== 'object' || Object.keys(saved).length !== keys.length || keys.some(k => !Object.hasOwn(saved, k)) ||
      ![1, 2].includes(saved.schemaVersion) || saved.kind !== 'sparse-lif' || saved.individualId !== individualId || saved.dataset !== dataset || saved.graphSha256 !== graphSha256 ||
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
    preparedRestores.set(token, { revision, p, f, r, tick: saved.tick, totalSpikes: saved.totalSpikes, traversedEdges: saved.traversedEdges, extensions: restoredExtensions });
    return token;
  }
  function commitRestore(token) {
    const candidate = preparedRestores.get(token);
    if (!candidate || candidate.revision !== revision) throw new Error('Stale or foreign prepared neural restore');
    preparedRestores.delete(token);
    potential = candidate.p; firing = candidate.f; refractory = candidate.r;
    tick = candidate.tick; totalSpikes = candidate.totalSpikes; traversedEdges = candidate.traversedEdges;
    extensions = candidate.extensions;
    revision = Symbol();
    return summary();
  }
  function restore(saved) {
    return commitRestore(prepareRestore(saved));
  }

  /**
   * What this kernel's effective weights are currently derived from, reported
   * without copying a gain, trace or neural array. An effective weight is
   * `contacts * sign * contactGain` unless a retained plasticity block scales
   * it, so a viewer can name the basis instead of assuming one. `plasticity:
   * null` states that this kernel holds no retained gain block; it is not a
   * claim that learning was evaluated, and it is not a welfare or health value.
   */
  function retainedWeightState() {
    const gains = extensions ? extensions.value.plasticityGains ?? null : null;
    const readable = gains !== null && typeof gains === 'object' && !Array.isArray(gains);
    return { checkpointSchemaVersion: extensions ? 2 : 1, extensionsSha256: extensions ? extensions.sha256 : null,
      weightBasis: 'anatomicalContacts * engineeredSign * engineeredContactGain',
      contactGain: model.contactGain,
      plasticity: gains === null ? null : {
        rule: readable && typeof gains.rule === 'string' ? gains.rule : 'unknown',
        mappingManifestSha256: readable && typeof gains.mappingManifestSha256 === 'string' ? gains.mappingManifestSha256 : null,
        updates: readable && Number.isSafeInteger(gains.updates) ? gains.updates : null,
        gatedUpdates: readable && Number.isSafeInteger(gains.gatedUpdates) ? gains.gatedUpdates : null,
        edgeCount: readable && Array.isArray(gains.gains) ? gains.gains.length : null } };
  }
  if (checkpoint !== null) restore(checkpoint);
  // Graph ownership is transferred to the kernel; callers must not mutate CSR arrays.
  // Copies for small numerical diagnostics only; full graph benchmark uses summary().
  return { step, prepareAdvance, commitAdvance, rollbackAdvance, releaseAdvance, seedProbe, summary, sample, checkpoint: exportCheckpoint, restore, prepareRestore, commitRestore, individualId, graphSha256, model,
    setCheckpointExtensions, checkpointExtensions: readCheckpointExtensions, checkpointExtensionsSha256,
    retainedWeightState,
    inspect: () => ({ potential: potential.slice(), firing: firing.slice(), refractory: refractory.slice() }) };
}
