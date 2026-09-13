#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConnectome } from '../server/connectome-data.js';
import { contactLedger, decayedVolley } from '../server/visual-propagation-ledger.js';
const { values } = parseArgs({ options: { 'male-data': { type: 'string' }, 'banc-data': { type: 'string' } } });
const bytes = readFileSync(new URL('../connectome/visual-causal-result.json', import.meta.url));
const campaign = JSON.parse(bytes), results = [];
for (const [dataset, name, key] of [['male-cns:v1.0', 'male-cns-v1', 'male-data'], ['banc:v888', 'banc-v888', 'banc-data']]) {
  if (!values[key]) throw new Error('Both verified graph directories required');
  const mapping = JSON.parse(readFileSync(new URL(`../connectome/visual-mappings/${name}.json`, import.meta.url)));
  const { graph, manifestSha256 } = await loadConnectome(values[key], dataset);
  const trial = campaign.results.find(r => r.dataset === dataset && r.condition === 'changed-left-half-onset');
  if (mapping.graphManifestSha256 !== manifestSha256 || trial.graphManifestSha256 !== manifestSha256 || trial.mappingSha256 !== mapping.mappingSha256) throw new Error('Provenance mismatch');
  const ledger = contactLedger(graph, mapping.inputs.filter(p => p.type === 'L1' && p.side === 'left').map(p => p.neuronId), mapping.motor);
  if (ledger.maximum.signedContacts * trial.model.contactGain >= trial.model.threshold) throw new Error('Subthreshold recurrence not applicable');
  let maximumAbsoluteError = 0, checkedRows = 0;
  for (const row of trial.trace.filter(r => r.tick >= 22)) {
    if (row.spikes !== 0 || row.deliveredPorts !== 0) throw new Error('Recurrence assumptions violated');
    for (const field of ['minimum', 'maximum']) maximumAbsoluteError = Math.max(maximumAbsoluteError, Math.abs(row[field] - decayedVolley(ledger[field].signedContacts, row.tick - 22, trial.model)));
    checkedRows++;
  }
  if (maximumAbsoluteError > 1e-12) throw new Error('Recorded trace mismatch');
  results.push({ dataset, graphManifestSha256: manifestSha256, graphSha256: trial.graphSha256, annotationSha256: mapping.annotationSha256, mappingSha256: mapping.mappingSha256, model: trial.model, ledger, recurrence: { arrivalTick: 22, checkedRows, maximumAbsoluteError, absoluteTolerance: 1e-12 } });
}
console.log(JSON.stringify({ schemaVersion: 1, kind: 'static-visual-contact-ledger', neuralStepsExecuted: 0, campaignSha256: createHash('sha256').update(bytes).digest('hex'), results }, null, 2));
