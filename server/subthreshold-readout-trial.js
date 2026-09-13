/**
 * One bounded trial for visual-subthreshold-readout-v1
 * (research/visual-subthreshold-readout-protocol.json). Caller owns graph and
 * mapping validation. Reuses the existing pinned encoder/episode machinery
 * (server/visual-mapping.js, server/visual-onset.js) unmodified — this file
 * adds no new stimulus encoding, only new frame patterns and a subthreshold
 * feature reading at the protocol's frozen tick.
 */
import { createOnsetEpisode } from './visual-onset.js';
import { resolveHopTwoGroups, subthresholdFeature, buildGraphIndex } from './subthreshold-population.js';

export const READOUT_CONDITIONS = Object.freeze([
  'unchanged-black', 'changed-left-half-onset', 'changed-right-half-onset', 'changed-whole-field-onset',
]);

/** Row-major 32x16 pixel frame. `region` selects which half (or all) flips to full contrast at the onset frame. */
function frame(frameId, region) {
  const pixels = new Array(512).fill(0);
  if (region) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const on = region === 'left' ? x < 16 : region === 'right' ? x >= 16 : true;
      if (on) pixels[y * 32 + x] = 1;
    }
  }
  return { frameId, width: 32, height: 16, pixels };
}

const REGION_BY_CONDITION = Object.freeze({
  'unchanged-black': null,
  'changed-left-half-onset': 'left',
  'changed-right-half-onset': 'right',
  'changed-whole-field-onset': 'whole',
});

/** Bounded: 25 kernel.step() calls total. The encoder measures DIFFERENCE from the previously
 * accepted frame (server/visual-onset.js), so — matching the reviewed campaign's own cadence in
 * server/visual-causal-trial.js — a black baseline frame is accepted at loop-tick 0 (establishing
 * `previous`) and the condition's actual frame at loop-tick 20, the first tick able to register a
 * real onset relative to that baseline; the feature is read at the frozen tick 22, one tick after
 * the onset's synaptic delay. `graph` (the raw CSR structure the kernel was constructed from) is
 * required separately from `kernel` — the kernel exposes neuron IDs via `inspectIds` but not the
 * outgoing-edge arrays hop-2 resolution needs. */
export async function runSubthresholdTrial({ kernel, graph, mapping, condition }) {
  if (!READOUT_CONDITIONS.includes(condition)) throw new Error('Unsupported subthreshold readout condition');
  const initial = kernel.checkpoint();
  if (initial.tick !== 0 || initial.totalSpikes !== 0 || initial.firing.some(Boolean) || initial.potential.some(v => v !== 0)) throw new Error('Trial requires exact zero initial state');
  const graphIds = kernel.inspectIds;
  if (!Array.isArray(graphIds)) throw new Error('Trial ID resolver missing');
  if (graph.ids !== graphIds && JSON.stringify(graph.ids) !== JSON.stringify(graphIds)) throw new Error('Graph/kernel ID mismatch');
  const index = buildGraphIndex(graphIds);
  const groups = resolveHopTwoGroups(graph, mapping, index);
  const episode = createOnsetEpisode(mapping);
  episode.arm();
  const region = REGION_BY_CONDITION[condition];
  const trace = [];
  let featureAtReadTick = null;
  const MAX_STEPS = 25, READ_TICK = 22;
  for (let loopTick = 0; loopTick < MAX_STEPS; loopTick++) {
    if (loopTick % 20 === 0) episode.accept(frame(loopTick / 20, loopTick === 0 ? null : region));
    const proposed = episode.tick();
    const inputs = proposed.map(p => ({ index: index.get(p.neuronId), deltaV: p.deltaV }));
    kernel.step(inputs);
    const global = kernel.summary();
    if (!Object.values(global).every(Number.isFinite)) throw new Error('Invalid trial numerical output');
    const row = { executedStep: loopTick + 1, ...global };
    if (global.tick === READ_TICK) {
      const { potential } = kernel.inspect();
      featureAtReadTick = subthresholdFeature(potential, groups);
      row.subthresholdFeature = featureAtReadTick;
    }
    trace.push(row);
  }
  if (featureAtReadTick === null) throw new Error('Trial did not reach the frozen read tick');
  return {
    condition, status: 'completed-bounded-trial', model: initial.model, executedSteps: MAX_STEPS,
    finalClockTicks: kernel.summary().tick, readTick: READ_TICK, feature: featureAtReadTick, trace,
    interpretation: 'Synthetic raster intervention and engineered subthreshold-voltage readout only; no rendered body, natural control, learning, spiking claim or subjective inference.',
  };
}
