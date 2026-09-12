import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { openConnectomeBackend } from '../server/connectome.js';
import { connectomeProfile } from '../server/connectome-profiles.js';

const { values } = parseArgs({ options: {
  measure: { type: 'boolean', default: false }, dataset: { type: 'string' }, data: { type: 'string' },
  'max-memory-mib': { type: 'string', default: '4096' }, 'timeout-seconds': { type: 'string', default: '120' },
} });
if (!values.measure || !values.dataset || !values.data) throw new Error('Explicit --measure --dataset <profile> --data <local graph directory> required. This loads and checkpoints a paused research worker.');
connectomeProfile(values.dataset);
const maxBytes = Number(values['max-memory-mib']) * 1024 ** 2, timeoutMs = Number(values['timeout-seconds']) * 1000;
if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 * 1024 ** 2 || maxBytes > 8192 * 1024 ** 2
  || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('Memory bound must be 256–8192 MiB; deadline must be 1–120 seconds.');
const baselineRssBytes = process.memoryUsage().rss, started = performance.now();
let sampledPeakRssBytes = baselineRssBytes;
// This standalone process owns its worker. Exiting the process also terminates a
// still-loading worker, so the guard does not depend on a ready handshake.
const deadline = setTimeout(() => { console.error('Paused memory measurement deadline exceeded.'); process.exit(1); }, timeoutMs);
const sampler = setInterval(() => {
  sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
  if (sampledPeakRssBytes > maxBytes) { console.error('Paused memory measurement exceeded its RSS bound.'); process.exit(1); }
}, 10);
let backend;
try {
  backend = await openConnectomeBackend(values.data, { dataset: values.dataset });
  if (!backend.ready.available || backend.ready.status !== 'paused') throw new Error('Pinned graph unavailable; no fixture substituted.');
  const initial = backend.ready.neural;
  const checkpoint = await backend.checkpoint();
  const serialized = JSON.stringify(checkpoint), restored = JSON.parse(serialized);
  const state = await backend.restore(restored);
  sampledPeakRssBytes = Math.max(sampledPeakRssBytes, process.memoryUsage().rss);
  if (sampledPeakRssBytes > maxBytes) throw new Error('Paused memory measurement exceeded its RSS bound.');
  if (state.status !== 'paused' || JSON.stringify(state.neural) !== JSON.stringify(initial)) throw new Error('Paused checkpoint round-trip changed numerical state.');
  const measuredIncrementBytes = Math.max(0, sampledPeakRssBytes - baselineRssBytes);
  console.log(JSON.stringify({ schemaVersion: 1, status: 'measured-paused', dataset: values.dataset,
    runtime: process.version, platform: process.platform, architecture: process.arch,
    graphSha256: state.graphSha256, provenance: state.provenance, model: state.model,
    baselineRssBytes, sampledPeakRssBytes, measuredIncrementBytes,
    suggestedAdmissionBytes: Math.ceil(measuredIncrementBytes * 1.5 + 64 * 1024 ** 2),
    checkpointJsonBytes: Buffer.byteLength(serialized), wallMs: performance.now() - started,
    statusAfter: state.status, neuralAfter: state.neural,
    includesCheckpointSerialization: true,
    limitations: 'Single-process sampled RSS during verified graph load, JSON checkpoint serialization/parsing and paused restore. No neural steps or probes, renderer, live activity, chemistry, plasticity or pair throughput. The suggested admission budget adds an engineering margin; this is not a hard peak guarantee or evidence for other machines/configurations.' }, null, 2));
} finally {
  if (backend) await backend.close();
  clearTimeout(deadline); clearInterval(sampler);
}
