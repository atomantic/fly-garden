/** Explicit numerical diagnostic; compares the locked graph to an independent event reference. */
import { parseArgs } from 'node:util';
import { loadConnectome } from '../server/connectome-data.js';
import { createSparseLif } from '../server/sparse-lif.js';

const { values } = parseArgs({ options: { data: { type: 'string' }, dataset: { type: 'string', default: 'male-cns:v1.0' } } });
if (!values.data) throw new Error('--data is required');
const { graph, manifestSha256 } = await loadConnectome(values.data, values.dataset);
const kernel = createSparseLif(graph);
const n = graph.ids.length;
const probe = Array.from({ length: Math.ceil(n / 100) }, (_, i) => i * 100);
kernel.seedProbe(probe);
const voltage = new Float64Array(n), blockedUntil = new Uint32Array(n);
for (const i of probe) blockedUntil[i] = 2;
let previousSpikes = probe, maxAbsoluteVoltageError = 0;
let comparedSpikes = 0;
for (let time = 1; time <= 120; time++) {
  // Timestamped arrivals and absolute refractory deadlines, independent of kernel buffers.
  const arrivals = new Map();
  for (const from of previousSpikes) {
    for (let edge = graph.offsets[from]; edge < graph.offsets[from + 1]; edge++) {
      const to = graph.targets[edge];
      arrivals.set(to, (arrivals.get(to) ?? 0) + graph.signs[from] * graph.contacts[edge] / 1000);
    }
  }
  const spikes = [];
  for (let i = 0; i < n; i++) {
    voltage[i] = time <= blockedUntil[i] ? 0 : voltage[i] / Math.exp(1 / 20) + (arrivals.get(i) ?? 0);
    if (voltage[i] >= 1) {
      spikes.push(i);
      voltage[i] = 0;
      blockedUntil[i] = time + 2;
    }
  }
  kernel.step();
  const actual = kernel.inspect();
  const spikeSet = new Set(spikes);
  for (let i = 0; i < n; i++) {
    maxAbsoluteVoltageError = Math.max(maxAbsoluteVoltageError, Math.abs(actual.potential[i] - voltage[i]));
    if (actual.firing[i] !== Number(spikeSet.has(i)) || actual.refractory[i] !== Math.max(0, blockedUntil[i] - time)) {
      throw new Error('Spike/refractory reference mismatch');
    }
  }
  comparedSpikes += spikes.length;
  previousSpikes = spikes;
}
if (!Number.isFinite(maxAbsoluteVoltageError) || maxAbsoluteVoltageError >= 1e-12) throw new Error('Voltage reference mismatch');
console.log(JSON.stringify({ dataset: values.dataset, manifestSha256, backend: 'CPU float64 sparse LIF',
  steps: 120, probeNeuronCount: probe.length, comparedSpikes, maxAbsoluteVoltageError,
  tolerance: { voltageAbsolute: 1e-12, spikes: 'exact', refractory: 'exact' }, result: 'pass',
  limitations: 'Agreement with the declared engineered discrete model, not biological validation. Probe is initialized once; no reward or sensory controller.' }, null, 2));
