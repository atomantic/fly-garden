/**
 * Pure graph-topology helper for the visual-subthreshold-readout-v1 protocol
 * (research/visual-subthreshold-readout-protocol.json). No kernel, filesystem,
 * timers or network. Computes, for a pinned visual mapping and its graph, the
 * set of hop-2 neuron indices reached from left-side vs right-side input
 * ports — the exact "hop2Targets" definition the protocol freezes.
 *
 * A hop-2 neuron reached from ports on both sides contributes to both sets;
 * this file performs no exclusive partition, weighting or invented mapping.
 */

const fail = message => { throw new Error(message); };

/** O(n) once, reused by both hop-2 resolution and per-tick input-port lookups — avoids a repeated
 * O(n) Array#indexOf scan over a 165k+-neuron ID array in a caller's per-frame loop. */
export function buildGraphIndex(ids) {
  const index = new Map();
  ids.forEach((id, i) => index.set(id, i));
  return index;
}

/**
 * @param {{ids: string[], offsets: Uint32Array, targets: Uint32Array}} graph
 * @param {{inputs: Array<{neuronId: string, side: 'left'|'right'}>}} mapping
 * @param {Map<string, number>} [index] - reuse a prebuilt buildGraphIndex(graph.ids) if the caller has one
 * @returns {{leftTargets: Set<number>, rightTargets: Set<number>, sourceIndexBySide: {left: number[], right: number[]}}}
 */
export function resolveHopTwoGroups(graph, mapping, index = buildGraphIndex(graph?.ids ?? [])) {
  if (!graph || !Array.isArray(graph.ids) || !(graph.offsets instanceof Uint32Array) || !(graph.targets instanceof Uint32Array)) fail('Invalid graph for hop-2 resolution');
  if (!mapping || !Array.isArray(mapping.inputs) || !mapping.inputs.length) fail('Invalid visual mapping for hop-2 resolution');
  const groups = { left: new Set(), right: new Set() };
  const sourceIndexBySide = { left: [], right: [] };
  for (const port of mapping.inputs) {
    if (port.side !== 'left' && port.side !== 'right') fail('Visual input port missing a resolved side');
    const sourceIndex = index.get(port.neuronId);
    if (sourceIndex === undefined) fail('Visual input port is absent from the graph');
    sourceIndexBySide[port.side].push(sourceIndex);
    const start = graph.offsets[sourceIndex], end = graph.offsets[sourceIndex + 1];
    for (let e = start; e < end; e++) groups[port.side].add(graph.targets[e]);
  }
  if (!groups.left.size || !groups.right.size) fail('Hop-2 resolution produced an empty side group');
  return { leftTargets: groups.left, rightTargets: groups.right, sourceIndexBySide };
}

/** meanPotential(rightTargets) - meanPotential(leftTargets), per the protocol's frozen feature definition. */
export function subthresholdFeature(potential, groups) {
  if (!(potential instanceof Float64Array)) fail('Invalid potential array');
  const mean = indices => {
    let sum = 0;
    for (const i of indices) sum += potential[i];
    return sum / indices.size;
  };
  return mean(groups.rightTargets) - mean(groups.leftTargets);
}
