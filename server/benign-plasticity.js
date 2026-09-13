/**
 * Localized candidate plasticity for `benign-landmark-association-v1`.
 *
 * This module implements exactly the `plasticityCandidate` block of
 * `experiments/benign-learning-v1/protocol.json` and nothing else. It is an
 * engineered, preregistered hypothesis over an immutable graph: baseline signs
 * and topology never change, no edge is added or removed, a zero baseline weight
 * stays zero, and every gain is bounded.
 *
 * It is not a biological plasticity model, a reward signal, a dopamine proxy or
 * evidence of learning. The gate is a nonnegative scalar; there is no aversive
 * or punitive branch and no continuous drive. A changed gain proves only that
 * this rule ran.
 *
 * It also refuses to construct without an explicitly validated compartment-matched
 * edge set, so an unvalidated compartment claim cannot be smuggled in by passing
 * a convenient edge list.
 */
import { createHash } from 'node:crypto';

export const PLASTICITY_RULE = Object.freeze({
  id: 'benign-landmark-association-v1/kc-to-mbon-gain',
  status: 'unvalidated-assumption',
  traceTauMs: 100,
  traceRange: Object.freeze([0, 1]),
  gainRange: Object.freeze([0.8, 1.2]),
  initialGain: 1,
  etaPerSecond: 0.01,
  rule: 'gain = clip(gain - eta * gate * normalizedPreTrace * normalizedPostTrace * dtSeconds, 0.8, 1.2)',
  traceUpdate: 'decay by exp(-dtMs/100), add binary spike, clamp [0,1]; traces initially zero; update gains after spikes, effective weights next tick',
  testPhaseUpdates: false,
  baselineSignsAndTopology: 'immutable',
});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const fail = message => { throw new Error(message); };

/**
 * The edge set must arrive already validated by the mapping manifest, carrying
 * the manifest digest and an explicit compartment claim. `compartmentValidated`
 * false closes the gate here rather than downstream.
 */
export function createBenignPlasticity({ edges, compartmentValidated, mappingManifestSha256, neuronCount, dtMs = 1 } = {}) {
  if (compartmentValidated !== true) fail('Localized plasticity requires a validated compartment-matched edge set; the gate is closed');
  if (typeof mappingManifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(mappingManifestSha256)) fail('Localized plasticity requires an exact mapping manifest digest');
  if (!Number.isSafeInteger(neuronCount) || neuronCount < 1) fail('Invalid neuron count');
  if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 1000) fail('Invalid plasticity time step');
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > 5_000_000) fail('Invalid plastic edge set');

  const preIndex = new Int32Array(edges.length);
  const postIndex = new Int32Array(edges.length);
  const baseline = new Float64Array(edges.length);
  const gain = new Float64Array(edges.length);
  const seen = new Set();
  const preNeurons = [];
  const postNeurons = [];
  const preSlot = new Map();
  const postSlot = new Map();
  edges.forEach((edge, i) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)
      || Object.keys(edge).length !== 3 || !['preIndex', 'postIndex', 'baselineWeight'].every(key => Object.hasOwn(edge, key))
      || !Number.isSafeInteger(edge.preIndex) || edge.preIndex < 0 || edge.preIndex >= neuronCount
      || !Number.isSafeInteger(edge.postIndex) || edge.postIndex < 0 || edge.postIndex >= neuronCount
      || !Number.isFinite(edge.baselineWeight)) fail('Invalid plastic edge');
    const key = `${edge.preIndex}:${edge.postIndex}`;
    if (seen.has(key)) fail('Duplicate plastic edge');
    seen.add(key);
    preIndex[i] = edge.preIndex;
    postIndex[i] = edge.postIndex;
    baseline[i] = edge.baselineWeight;
    gain[i] = PLASTICITY_RULE.initialGain;
    if (!preSlot.has(edge.preIndex)) { preSlot.set(edge.preIndex, preNeurons.length); preNeurons.push(edge.preIndex); }
    if (!postSlot.has(edge.postIndex)) { postSlot.set(edge.postIndex, postNeurons.length); postNeurons.push(edge.postIndex); }
  });
  const preTrace = new Float64Array(preNeurons.length);
  const postTrace = new Float64Array(postNeurons.length);
  const preEdgeSlot = Int32Array.from(preIndex, index => preSlot.get(index));
  const postEdgeSlot = Int32Array.from(postIndex, index => postSlot.get(index));
  const decay = Math.exp(-dtMs / PLASTICITY_RULE.traceTauMs);
  const dtSeconds = dtMs / 1000;
  const [gainLow, gainHigh] = PLASTICITY_RULE.gainRange;
  const [traceLow, traceHigh] = PLASTICITY_RULE.traceRange;

  // Effective weights are published one tick behind the gains, exactly as the
  // protocol declares; the kernel reads this snapshot, never the live gains.
  let effective = Float64Array.from(baseline);
  let updates = 0;
  let gatedUpdates = 0;

  const topologySha256 = digest({ rule: PLASTICITY_RULE.id, mappingManifestSha256,
    edges: edges.map(edge => [edge.preIndex, edge.postIndex, edge.baselineWeight]) });

  /**
   * One 1 ms tick. `firing` is the kernel's binary spike vector for this tick;
   * `gate` is the nonnegative appetitive scalar, and must be exactly zero in
   * every evaluation phase (`testPhaseUpdates: false`).
   */
  function tick({ firing, gate = 0, learningEnabled = true } = {}) {
    if (!firing || typeof firing.length !== 'number' || firing.length !== neuronCount) fail('Plasticity tick requires the exact kernel firing vector');
    if (!Number.isFinite(gate) || gate < 0 || gate > 1) fail('Plasticity gate must be a nonnegative scalar in [0, 1]');
    if (typeof learningEnabled !== 'boolean') fail('Invalid plasticity phase flag');
    // Publish the previous tick's gains before this tick's update.
    const published = effective;
    for (let i = 0; i < preTrace.length; i++) preTrace[i] = clamp(preTrace[i] * decay + (firing[preNeurons[i]] ? 1 : 0), traceLow, traceHigh);
    for (let i = 0; i < postTrace.length; i++) postTrace[i] = clamp(postTrace[i] * decay + (firing[postNeurons[i]] ? 1 : 0), traceLow, traceHigh);
    if (learningEnabled && gate > 0) {
      for (let e = 0; e < gain.length; e++) {
        const delta = PLASTICITY_RULE.etaPerSecond * gate * preTrace[preEdgeSlot[e]] * postTrace[postEdgeSlot[e]] * dtSeconds;
        gain[e] = clamp(gain[e] - delta, gainLow, gainHigh);
      }
      gatedUpdates++;
    }
    // Zero baseline weights stay zero; signs and topology are untouched.
    const next = new Float64Array(gain.length);
    for (let e = 0; e < gain.length; e++) next[e] = baseline[e] * gain[e];
    effective = next;
    updates++;
    return { effectiveWeights: published, updates, gatedUpdates };
  }

  const state = () => ({
    rule: PLASTICITY_RULE.id,
    mappingManifestSha256,
    updates,
    gatedUpdates,
    gains: Array.from(gain),
    preTrace: Array.from(preTrace),
    postTrace: Array.from(postTrace),
  });

  function restore(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)
      || Object.keys(saved).length !== 7
      || saved.rule !== PLASTICITY_RULE.id || saved.mappingManifestSha256 !== mappingManifestSha256
      || !Number.isSafeInteger(saved.updates) || saved.updates < 0
      || !Number.isSafeInteger(saved.gatedUpdates) || saved.gatedUpdates < 0 || saved.gatedUpdates > saved.updates
      || !Array.isArray(saved.gains) || saved.gains.length !== gain.length
      || !Array.isArray(saved.preTrace) || saved.preTrace.length !== preTrace.length
      || !Array.isArray(saved.postTrace) || saved.postTrace.length !== postTrace.length
      || saved.gains.some(value => !Number.isFinite(value) || value < gainLow || value > gainHigh)
      || [...saved.preTrace, ...saved.postTrace].some(value => !Number.isFinite(value) || value < traceLow || value > traceHigh)) {
      fail('Invalid plasticity checkpoint state; no partial restore performed');
    }
    gain.set(saved.gains);
    preTrace.set(saved.preTrace);
    postTrace.set(saved.postTrace);
    updates = saved.updates;
    gatedUpdates = saved.gatedUpdates;
    const next = new Float64Array(gain.length);
    for (let e = 0; e < gain.length; e++) next[e] = baseline[e] * gain[e];
    effective = next;
  }

  return {
    tick,
    state,
    restore,
    edgeCount: gain.length,
    topologySha256,
    stateSha256: () => digest(state()),
    gains: () => Array.from(gain),
    disclosure: 'Engineered bounded gain rule over immutable measured topology. Not biological plasticity, reward, memory or demonstrated learning.',
  };
}
