#!/usr/bin/env node
/**
 * Explicit entry point for the gated benign-learning campaign.
 *
 * Running this command is an active experiment, not a setup or health command.
 * It requires `--run`. It has no gain, seed-search, retry, condition-selector or
 * enlarged-budget option, and it refuses to execute while any required gate is
 * closed. A refusal is a completed gate-closed evaluation and is written out as
 * such; it is never a reason to relax the protocol.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { runBenignLearningCampaign } from '../server/benign-learning-campaign.js';
import { buildMappingManifest } from '../server/benign-learning-manifest.js';

const { values } = parseArgs({ options: {
  run: { type: 'boolean', default: false },
  protocol: { type: 'string' },
  'gate-evidence': { type: 'string' },
  out: { type: 'string' },
  'manifest-out': { type: 'string' },
} });
if (!values.run || !values.protocol || !values['gate-evidence']) {
  throw new Error('Explicit --run --protocol and --gate-evidence are required; this command runs an experiment.');
}
const protocolText = readFileSync(values.protocol, 'utf8');
const protocol = JSON.parse(protocolText);
const gateEvidence = JSON.parse(readFileSync(values['gate-evidence'], 'utf8'));
const protocolArtifactSha256 = createHash('sha256').update(protocolText).digest('hex');

if (values['manifest-out']) {
  const built = buildMappingManifest(gateEvidence);
  writeFileSync(values['manifest-out'], `${JSON.stringify(built.manifest, null, 2)}\n`);
}

const result = await runBenignLearningCampaign({
  protocol,
  gateEvidence,
  protocolArtifactSha256,
  explicitRun: true,
  // Both are properties of this build, verified by `server/benign-learning.test.js`
  // and `server/sparse-checkpoint.test.js`.
  checkpointContractValidated: true,
  isolatedCatalogValidated: true,
  executeRun: null,
});
const report = { ...result, runtime: process.version, platform: process.platform, architecture: process.arch };
const text = JSON.stringify(report, null, 2);
if (values.out) writeFileSync(values.out, `${text}\n`);
else console.log(text);
if (result.status === 'gate-closed') {
  console.error(`Gate-closed evaluation recorded. Closed gates: ${result.closedGates.join(', ')}. No neural step executed.`);
  process.exitCode = 2;
} else if (result.status !== 'completed') {
  process.exitCode = 1;
}
