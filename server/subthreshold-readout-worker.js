import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadConnectome } from './connectome-data.js';
import { createSparseLif } from './sparse-lif.js';
import { runSubthresholdTrial } from './subthreshold-readout-trial.js';

if (parentPort) {
  try {
    const { dataset, directory, condition } = workerData;
    const name = dataset === 'male-cns:v1.0' ? 'male-cns-v1' : dataset === 'banc:v888' ? 'banc-v888' : null;
    if (!name) throw new Error('Unsupported dataset');
    const mapping = JSON.parse(readFileSync(new URL(`../connectome/visual-mappings/${name}.json`, import.meta.url)));
    const { graph, manifest, manifestSha256 } = await loadConnectome(directory, dataset);
    const kernel = createSparseLif(graph, { dataset, individualId: randomUUID() });
    kernel.inspectIds = graph.ids;
    if (mapping.graphManifestSha256 !== manifestSha256 || mapping.graphSha256 !== kernel.graphSha256) throw new Error('Mapping graph mismatch');
    const result = await runSubthresholdTrial({ kernel, graph, mapping, condition });
    parentPort.postMessage({ ok: true, result: { ...result, dataset, graphSha256: kernel.graphSha256, graphManifestSha256: manifestSha256, neuronCount: manifest.neuronCount, edgeCount: manifest.edgeCount } });
  } catch {
    parentPort.postMessage({ ok: false, reason: 'Graph, mapping or numerical validation failed; run incomplete.' });
  }
}
