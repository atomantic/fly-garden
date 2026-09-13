import { readConnectomeState } from './connectome-lab-state.js';

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;

/**
 * The four inspection layers this panel keeps separate, in display order. The
 * fourth exists so that "no learned change" is something the runtime says, in
 * numbers, against a named baseline — never something a viewer infers from an
 * unchanged colour or brightness.
 */
export const WEIGHT_LAYERS = Object.freeze([
  Object.freeze({ id: 'measured-structure', label: 'Measured structural wiring',
    origin: 'Pinned dataset annotations', claim: 'Directed anatomical contact counts. Not synaptic efficacy.' }),
  Object.freeze({ id: 'engineered-parameters', label: 'Engineered model parameters',
    origin: 'This project’s LIF constants', claim: 'Transmitter sign and contact gain chosen by this project. Not measured biology.' }),
  Object.freeze({ id: 'instantaneous-state', label: 'Instantaneous modeled state',
    origin: 'One bounded worker sample', claim: 'A zero-width snapshot of one neuron. Not a firing rate.' }),
  Object.freeze({ id: 'baseline-difference', label: 'Weight difference against a named baseline',
    origin: 'The named baseline selected below', claim: 'Every difference is stated as a number against one named, digested baseline. No difference is ever shown by changing how the graph is drawn.' }),
]);

export const GRAPH_MANIFEST_BASELINE = 'graph-manifest';

/**
 * The baselines this individual can actually be compared against, each carrying
 * its own digest. The pinned graph manifest is always first; durable checkpoints
 * follow in history order. `server/connectome-store.js` accepts only
 * `schemaVersion: 1` payloads whose `graphSha256` equals the verified profile
 * descriptor, so a listed checkpoint carries neither a retained gain block nor a
 * foreign graph. That store invariant is what makes `weightBasis` below true; it
 * is asserted in `server/weight-baseline.test.js`, not assumed here.
 */
export function namedWeightBaselines(state, checkpoints = []) {
  readConnectomeState(state);
  if (!sha(state.graphSha256) || !sha(state.provenance?.manifestSha256) || !Array.isArray(checkpoints)) return [];
  const baselines = [{ id: GRAPH_MANIFEST_BASELINE, kind: 'graph-manifest', tick: null,
    name: `${state.dataset} pinned graph manifest`, sha256: state.provenance.manifestSha256,
    weightBasis: 'Structural: anatomical contacts × engineered sign × engineered contact gain, with no retained gain block.' }];
  for (const item of checkpoints) {
    if (!item || typeof item.checkpointId !== 'string' || !item.checkpointId || !sha(item.sha256) || !uint(item.tick)) continue;
    baselines.push({ id: `checkpoint:${item.checkpointId}`, kind: 'checkpoint', tick: item.tick,
      name: `Durable checkpoint ${item.checkpointId} at tick ${item.tick}`, sha256: item.sha256,
      weightBasis: 'Structural: this store accepts only schema-1 checkpoints from this exact graph digest, so the baseline carries no retained gain block.' });
  }
  return baselines;
}

const refuse = (baseline, reason) => ({ layer: 'baseline-difference', outcome: 'refused', baseline, current: null,
  extent: null, differingEdges: null, rows: [], reason });

/**
 * Compare the loaded worker's weight-determining state against one named
 * baseline and report the per-edge consequence for the selected cell's sampled
 * connections.
 *
 * This compares declared state — graph digest, checkpoint schema and retained
 * gain block — and derives each edge weight from it. It is not an independent
 * recomputation from the baseline's stored bytes, and the returned reason says
 * so. A zero difference is therefore a statement that nothing in the runtime can
 * express a weight change, not a measurement that learning was attempted and
 * failed; that evaluation is recorded separately in docs/BENIGN_LEARNING_RESULT.md.
 */
export function weightDifferenceLayer({ state, baselineId, checkpoints = [], edges = [], totalMatching = null }) {
  readConnectomeState(state);
  const baseline = namedWeightBaselines(state, checkpoints).find(item => item.id === baselineId) ?? null;
  if (!baseline) return refuse(null, 'Select a named baseline. No comparison is made against an unnamed or unknown source.');
  if (state.resident !== true || !['paused', 'running', 'resting'].includes(state.status))
    return refuse(baseline, 'No resident worker holds this graph, so there is no current weight state to compare. Load the individual paused in Connectome lab.');
  const retained = state.retainedWeightState ?? null;
  if (!retained || typeof retained !== 'object' || !Number.isFinite(retained.contactGain)
    || ![1, 2].includes(retained.checkpointSchemaVersion) || (retained.extensionsSha256 !== null && !sha(retained.extensionsSha256)))
    return { layer: 'baseline-difference', outcome: 'unreported', baseline, current: null, extent: null, differingEdges: null, rows: [],
      reason: 'This runtime does not report its retained weight state. No comparison is made, and no absence of change is claimed on its behalf.' };
  const current = { graphSha256: state.graphSha256, checkpointSchemaVersion: retained.checkpointSchemaVersion,
    extensionsSha256: retained.extensionsSha256, contactGain: retained.contactGain, weightBasis: retained.weightBasis ?? null };
  if (!Array.isArray(edges)) return refuse(baseline, 'Selected-cell connections are unavailable, so no edge difference is reported.');
  const rows = [];
  for (const edge of edges) {
    if (!edge || !uint(edge.edgeIndex) || !['incoming', 'outgoing', 'self'].includes(edge.direction)
      || !Number.isSafeInteger(edge.anatomicalContacts) || edge.anatomicalContacts < 1
      || ![-1, 0, 1].includes(edge.engineeredSign) || !Number.isFinite(edge.engineeredWeight))
      return refuse(baseline, 'A selected connection did not carry exact contacts, sign and weight, so no difference is reported for any of them.');
    const structural = edge.anatomicalContacts * edge.engineeredSign * retained.contactGain;
    if (structural !== edge.engineeredWeight)
      return refuse(baseline, `The displayed connection weight does not equal contacts × sign × the worker's own contact gain (${retained.contactGain}). Anatomy and runtime disagree about the engineered mapping; nothing is compared until they agree.`);
    rows.push({ edgeIndex: edge.edgeIndex, direction: edge.direction, baselineWeight: structural, currentWeight: structural, delta: 0 });
  }
  const extent = { comparedEdges: rows.length, matchingEdges: uint(totalMatching) ? totalMatching : null,
    complete: uint(totalMatching) && rows.length === totalMatching };
  if (retained.plasticity !== null) {
    const gains = retained.plasticity ?? {};
    return { layer: 'baseline-difference', outcome: 'unattributable', baseline, current, extent, differingEdges: null, rows: [],
      reason: `This worker holds a retained gain block (rule ${gains.rule ?? 'unknown'}, ${gains.edgeCount ?? 'an unstated number of'} plastic edges, ${gains.updates ?? 'an unstated number of'} updates). This view cannot attribute those gains to individual anatomical edges without the mapping manifest that defines the plastic edge set, so it reports no per-edge difference rather than a zero one.` };
  }
  return { layer: 'baseline-difference', outcome: 'compared', baseline, current, extent, differingEdges: 0, rows,
    reason: `Compared as declared state, not by recomputing the baseline's stored bytes: the worker reports checkpoint schema ${current.checkpointSchemaVersion} with no retained gain block, and ${baseline.name} carries none either, so every listed weight is the same structural product on both sides and each difference is exactly 0. No learned weight change exists in this runtime to display.` };
}
