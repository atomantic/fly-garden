/**
 * Gated campaign runner for `benign-landmark-association-v1`.
 *
 * Importing this module starts nothing. Nothing here runs on boot, on a timer,
 * or as a side effect of a health check. Execution requires an explicit call
 * from the `--run` CLI, and even then the gate preflight must pass first.
 *
 * The runner enforces the protocol's own budgets: 64 assigned runs, one worker
 * at a time, 116,000 steps per run including the restored retention branch, a
 * five-minute per-run wall clock, a six-hour campaign wall clock, three
 * checkpoints per run, a 1 GiB experimental checkpoint ceiling and zero
 * automatic retries. Exhausting any limit produces an incomplete evaluation; it
 * never shortens, omits or retries a trial, and it never enlarges a budget.
 *
 * There is no aversive branch anywhere in this file. The appetitive gate is a
 * bounded nonnegative scalar, "no contact" is a valid scored outcome, and rest
 * carries no cost.
 */
import { createHash } from 'node:crypto';
import { analyzeDataset } from './benign-learning-analysis.js';
import { buildMappingManifest, promotableManifestSha256 } from './benign-learning-manifest.js';

export const REQUIRED_GATES = Object.freeze([
  'exact-per-neuron-sensory-mapping',
  'fixed-causal-motor-readout',
  'compartment-specific-plasticity-validation',
  'complete-plasticity-world-rng-checkpoint',
  'isolated-experiment-catalog-and-capacity',
  'reviewed-bound-manifest-and-explicit-start',
]);

const fail = message => { throw new Error(message); };
export const artifactDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Exactly the derivation declared in protocol.json, including its separators. */
export function deriveSeed(protocolArtifactSha256, dataset, seedIndex, streamName) {
  if (!/^[0-9a-f]{64}$/.test(protocolArtifactSha256 ?? '')) fail('Seed derivation requires the exact protocol artifact digest');
  if (typeof dataset !== 'string' || !dataset || typeof streamName !== 'string' || !streamName) fail('Seed derivation requires dataset and stream names');
  if (!Number.isSafeInteger(seedIndex) || seedIndex < 0) fail('Invalid seed index');
  const hex = createHash('sha256').update(`${protocolArtifactSha256}|${dataset}|${seedIndex}|${streamName}`).digest('hex');
  return BigInt(`0x${hex.slice(0, 16)}`);
}

/**
 * The complete assigned-run table is built before any gate is consulted, so an
 * incomplete or refused campaign still reports every run it was assigned.
 */
export function assignedRuns(protocol, protocolArtifactSha256 = null) {
  // The digest binds every derived seed to the exact frozen protocol artifact.
  const artifact = protocolArtifactSha256 ?? artifactDigest(protocol);
  if (!/^[0-9a-f]{64}$/.test(artifact)) fail('Invalid protocol artifact digest');
  const runs = [];
  for (const dataset of protocol.datasets) {
    for (const condition of protocol.conditions) {
      for (const seedIndex of protocol.seedIndices) {
        runs.push({
          runId: `${dataset}|${condition}|${seedIndex}`,
          dataset,
          condition,
          seedIndex,
          targetCategory: seedIndex % 2 === 0 ? 'ring' : 'bar',
          streamSeeds: Object.fromEntries(protocol.streams.map(stream => [stream, deriveSeed(artifact, dataset, seedIndex, stream).toString()])),
          status: 'not-run',
          executedSteps: 0,
        });
      }
    }
  }
  if (runs.length !== protocol.budget.runs) fail('Assigned run table does not match the declared run budget');
  return { protocolArtifactSha256: artifact, runs };
}

/**
 * Evaluate every required gate. `exact-per-neuron-sensory-mapping` and the two
 * derived gates come from the independent derivation; the checkpoint, catalog
 * and reviewed-manifest gates are properties of this build.
 */
export function evaluateGates({ protocol, gateEvidence, manifest, checkpointContractValidated, isolatedCatalogValidated }) {
  const derived = gateEvidence?.gates ?? {};
  const sensoryResolved = Array.isArray(manifest?.manifest?.sensoryMapping)
    && manifest.manifest.sensoryMapping.length === protocol.datasets.length
    && manifest.manifest.sensoryMapping.every(entry => /^[0-9a-f]{64}$/.test(entry.visualMappingSha256 ?? '') && entry.admittedOnsetPortCount > 0);
  const status = {
    'exact-per-neuron-sensory-mapping': sensoryResolved
      ? { status: 'open', evidence: 'Every admitted port resolves to an exact source-qualified graph ID in the pinned manifest.' }
      : { status: 'closed', evidence: 'Per-neuron sensory mapping is not resolved for every dataset.' },
    'fixed-causal-motor-readout': derived['fixed-causal-motor-readout']
      ?? { status: 'closed', evidence: 'No derived causal evidence supplied.' },
    'compartment-specific-plasticity-validation': derived['compartment-specific-plasticity-validation']
      ?? { status: 'closed', evidence: 'No derived compartment evidence supplied.' },
    'complete-plasticity-world-rng-checkpoint': checkpointContractValidated === true
      ? { status: 'open', evidence: 'The sparse-LIF checkpoint contract carries plasticity gains, eligibility traces, world/layout phase, body pose and RNG state with exact-digest restore equivalence.' }
      : { status: 'closed', evidence: 'Extended checkpoint contract not validated in this build.' },
    'isolated-experiment-catalog-and-capacity': isolatedCatalogValidated === true
      ? { status: 'open', evidence: 'Experimental branches use research-only identities and never replace a resident individual.' }
      : { status: 'closed', evidence: 'Isolated experiment catalog and capacity not validated in this build.' },
    'reviewed-bound-manifest-and-explicit-start': manifest?.complete === true
      ? { status: 'open', evidence: 'A complete reviewed manifest is bound and execution was explicitly requested.' }
      : { status: 'closed', evidence: `Mapping manifest is incomplete; unresolved sections: ${(manifest?.unresolvedSections ?? ['unknown']).join(', ')}.` },
  };
  const closed = REQUIRED_GATES.filter(gate => status[gate]?.status !== 'open');
  return { gates: status, closedGates: closed, allOpen: closed.length === 0 };
}

const PER_TRIAL_RECORD_FIELDS = Object.freeze([
  'protocolArtifactSha256', 'mappingManifestSha256', 'dataset', 'graphSha256', 'annotationSha256',
  'individualId', 'parentCheckpointId', 'parentCheckpointSha256', 'condition', 'seedIndex', 'streamSeeds',
  'phase', 'trialIndex', 'startTick', 'endTick', 'worldVariant', 'layoutVariant', 'cueVariant',
  'firstContactCategory', 'firstContactMs', 'noContact', 'trialScore', 'gateEvents', 'gateOnMs',
  'fixedReadoutSha256', 'mutableGainSha256', 'externalReadoutGainSha256', 'faults', 'wallMs', 'checkpointLineage',
]);
export { PER_TRIAL_RECORD_FIELDS };

export function validateTrialRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).length !== PER_TRIAL_RECORD_FIELDS.length
    || PER_TRIAL_RECORD_FIELDS.some(field => !Object.hasOwn(record, field))) fail('Trial record does not match the required result record');
  if (!Number.isSafeInteger(record.startTick) || !Number.isSafeInteger(record.endTick) || record.endTick < record.startTick) fail('Invalid trial tick range');
  if (![1, -1, 0].includes(record.trialScore)) fail('Invalid trial score');
  if (record.noContact !== (record.firstContactCategory === null)) fail('Inconsistent contact record');
  if (record.noContact && record.trialScore !== 0) fail('No contact must score zero');
  if (!Number.isFinite(record.gateOnMs) || record.gateOnMs < 0) fail('Invalid gate exposure');
  return record;
}

/**
 * Execute the campaign. `executeRun` is injected so the orchestration, budget
 * and refusal behavior can be validated without loading a pinned dataset; the
 * CLI supplies the real executor. There is no default executor, so a caller can
 * never silently run a stand-in and report it as the real evaluation.
 */
export async function runBenignLearningCampaign({
  protocol, gateEvidence, checkpointContractValidated = false, isolatedCatalogValidated = false,
  executeRun = null, now = () => Date.now(), explicitRun = false, protocolArtifactSha256 = null,
} = {}) {
  if (explicitRun !== true) fail('The benign learning campaign requires an explicit run request; it never starts automatically');
  if (!protocol || typeof protocol !== 'object' || protocol.protocolId !== 'benign-landmark-association-v1') fail('Campaign requires the frozen protocol artifact');
  const table = assignedRuns(protocol, protocolArtifactSha256);
  const manifest = buildMappingManifest(gateEvidence);
  const gates = evaluateGates({ protocol, gateEvidence, manifest, checkpointContractValidated, isolatedCatalogValidated });
  const base = {
    schemaVersion: 1,
    kind: 'benign-learning-campaign-result',
    protocolId: protocol.protocolId,
    protocolArtifactSha256: table.protocolArtifactSha256,
    mappingManifestSha256: promotableManifestSha256(manifest),
    incompleteMappingManifestSha256: manifest.complete ? null : manifest.manifest.manifestSha256,
    gates: gates.gates,
    closedGates: gates.closedGates,
    assignedRuns: table.runs,
    budget: protocol.budget,
    disclosure: 'Engineered evaluation of a stated plasticity assumption. Weight changes and appealing footage do not establish learning or subjective experience.',
  };

  if (!gates.allOpen) {
    // The gate is closed. No worker is spawned, no neural step is executed, no
    // checkpoint is written and no score is produced. This is a completed
    // gate-closed evaluation, not a failure to be retried or worked around.
    return {
      ...base,
      status: 'gate-closed',
      executionPerformed: false,
      executedRuns: 0,
      executedSteps: 0,
      trialRecords: [],
      datasetResults: [],
      reason: `Required gates remain closed: ${gates.closedGates.join(', ')}. The protocol forbids execution, tolerance widening or condition removal to open them.`,
    };
  }
  if (typeof executeRun !== 'function') fail('Campaign execution requires an explicit run executor');

  const started = now();
  const trialRecords = [];
  const executed = [];
  let executedSteps = 0;
  let checkpointBytes = 0;
  let incompleteReason = null;
  for (const run of table.runs) {
    if (now() - started >= protocol.budget.maxWallSecondsTotal * 1000) { incompleteReason = 'Campaign wall-clock budget reached'; break; }
    if (executedSteps >= protocol.budget.maxStepsTotal) { incompleteReason = 'Campaign step budget reached'; break; }
    const runStarted = now();
    let outcome;
    try {
      outcome = await executeRun(run);
    } catch (error) {
      // No automatic retry, ever.
      incompleteReason = `Run ${run.runId} faulted: ${error instanceof Error ? error.message : 'unknown fault'}`;
      break;
    }
    const wallMs = now() - runStarted;
    if (wallMs > protocol.budget.maxWallSecondsPerRun * 1000) { incompleteReason = `Run ${run.runId} exceeded its wall-clock budget`; break; }
    if (!outcome || !Array.isArray(outcome.trialRecords) || !Number.isSafeInteger(outcome.executedSteps)
      || outcome.executedSteps > protocol.budget.maxStepsPerRunIncludingRestoreBranch
      || !Number.isSafeInteger(outcome.checkpointCount) || outcome.checkpointCount > protocol.budget.maxCheckpointsPerRun
      || !Number.isSafeInteger(outcome.checkpointBytes) || outcome.checkpointBytes < 0
      || outcome.restoreEquivalent !== true) { incompleteReason = `Run ${run.runId} violated a declared budget or the exact restore contract`; break; }
    checkpointBytes += outcome.checkpointBytes;
    if (checkpointBytes > protocol.budget.maxCheckpointBytesTotal) { incompleteReason = 'Experimental checkpoint storage budget reached'; break; }
    for (const record of outcome.trialRecords) validateTrialRecord(record);
    executedSteps += outcome.executedSteps;
    run.status = 'complete';
    run.executedSteps = outcome.executedSteps;
    trialRecords.push(...outcome.trialRecords);
    executed.push(run);
  }

  const complete = executed.length === table.runs.length;
  const datasetResults = complete ? protocol.datasets.map(dataset => analyzeDataset({
    dataset,
    seedIndices: protocol.seedIndices,
    scores: datasetScores(trialRecords, dataset, protocol),
    analysisSeed: deriveSeed(table.protocolArtifactSha256, dataset, 0, 'analysis'),
    resamples: protocol.analysis.bootstrapResamples,
    confidence: protocol.analysis.twoSidedConfidence,
    minimumEffect: protocol.analysis.minimumEffect,
  })) : [];

  return {
    ...base,
    status: complete ? 'completed' : 'incomplete',
    executionPerformed: true,
    executedRuns: executed.length,
    executedSteps,
    checkpointBytes,
    trialRecords,
    datasetResults,
    reason: incompleteReason,
  };
}

/** Mean baseline and retention-native trial scores per condition and seed. */
export function datasetScores(trialRecords, dataset, protocol) {
  const scores = {};
  for (const condition of protocol.conditions) {
    scores[condition] = {};
    for (const seedIndex of protocol.seedIndices) {
      const pick = phase => trialRecords.filter(record => record.dataset === dataset && record.condition === condition
        && record.seedIndex === seedIndex && record.phase === phase);
      const baseline = pick('baseline');
      const retention = pick('retention-native');
      if (!baseline.length || !retention.length) continue;
      scores[condition][seedIndex] = {
        baseline: baseline.reduce((sum, r) => sum + r.trialScore, 0) / baseline.length,
        retentionNative: retention.reduce((sum, r) => sum + r.trialScore, 0) / retention.length,
      };
    }
  }
  return scores;
}
