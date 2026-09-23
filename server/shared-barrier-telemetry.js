/** Observation-only telemetry for fixed-step shared barriers. The recorder holds no
 * participant, worker or command authority: it cannot start, pause, advance, reset or
 * replace anything, and malformed input yields null timings instead of guessed numbers. */
export const BARRIER_TELEMETRY_RETENTION = 32;
export const BARRIER_FAILURE_REASONS = Object.freeze(['deadline', 'worker-failure', 'invalid-candidate', 'invalid-result', 'step-mismatch',
  'stale-epoch', 'participant-unavailable']);
const disclosure = 'Observational barrier timing only. Wall, queue and lag values describe this local process and explicit requests; they are not a real-time, capacity or biological claim.';
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const optionalDuration = value => value === null || duration(value);
const round = value => value === null ? null : Math.round(value * 1000) / 1000;

function permutationOf(order, ids, complete) {
  if (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => !ids.includes(id))) return false;
  return !complete || order.length === ids.length;
}

/** Returns normalized timing, `undefined` when the barrier reported none, or `null` when malformed. */
function normalizeTiming(timing, ids, committed) {
  if (timing === undefined) return undefined;
  if (!timing || typeof timing !== 'object' || !['queueWaitMs', 'prepareMs', 'commitMs'].every(key => optionalDuration(timing[key]))
    || !Array.isArray(timing.members) || timing.members.length !== ids.length
    || timing.members.some((member, index) => member?.individualId !== ids[index] || !optionalDuration(member.prepareMs) || !optionalDuration(member.commitMs))
    || !permutationOf(timing.completionOrder?.prepare, ids, committed) || !permutationOf(timing.completionOrder?.commit, ids, committed)) return null;
  if (committed && (timing.queueWaitMs === null || timing.prepareMs === null || timing.commitMs === null
    || timing.members.some(member => member.prepareMs === null || member.commitMs === null))) return null;
  return timing;
}

export function createBarrierTelemetry({ intervalMs, substeps, retention = BARRIER_TELEMETRY_RETENTION } = {}) {
  if (!duration(intervalMs) || intervalMs === 0 || !Number.isSafeInteger(substeps) || substeps < 1
    || !Number.isSafeInteger(retention) || retention < 1 || retention > 256) throw new Error('Invalid barrier telemetry configuration');
  const counts = { committed: 0, failed: 0, invalid: 0, pressurePauses: 0 };
  let index = 0, cumulativeLagMs = 0, latest = null, history = [], pressure = null;

  /** outcome is decided by the barrier path; telemetry only describes it. */
  function record({ outcome, reason = null, worldTick, startedAt, finishedAt, memberIds, timing, observedSubsteps = null }) {
    if (!['committed', 'failed'].includes(outcome) || !Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 64
      || new Set(memberIds).size !== memberIds.length || !Number.isSafeInteger(worldTick) || worldTick < 0) throw new Error('Invalid barrier telemetry record');
    const committed = outcome === 'committed';
    const normalized = normalizeTiming(timing, memberIds, committed);
    const observed = observedSubsteps && typeof observedSubsteps === 'object' ? memberIds.map(id => observedSubsteps[id] ?? null) : memberIds.map(() => null);
    const clockValid = duration(startedAt) && duration(finishedAt) && finishedAt >= startedAt;
    const substepsValid = observed.every(value => value === null || Number.isSafeInteger(value))
      && (!committed || observed.every(value => value === substeps));
    const valid = clockValid && normalized !== null && substepsValid;
    const safeReason = valid ? (committed ? null : BARRIER_FAILURE_REASONS.includes(reason) ? reason : 'worker-failure') : 'invalid-telemetry';
    const wallMs = valid ? finishedAt - startedAt : null;
    const lagMs = valid && committed ? Math.max(0, wallMs - intervalMs) : null;
    const summary = { index: ++index, outcome, reason: safeReason, worldTick, valid,
      wallMs: round(wallMs), queueWaitMs: round(valid ? normalized?.queueWaitMs ?? null : null),
      prepareMs: round(valid ? normalized?.prepareMs ?? null : null), commitMs: round(valid ? normalized?.commitMs ?? null : null), lagMs: round(lagMs),
      substepValidation: !valid ? 'unavailable' : committed ? 'exact' : observed.some(value => value !== null && value !== substeps) ? 'mismatch' : 'not-committed' };
    const prepareOrder = valid && normalized ? normalized.completionOrder.prepare : null;
    const commitOrder = valid && normalized ? normalized.completionOrder.commit : null;
    latest = { ...summary, completionOrder: prepareOrder ? { prepare: [...prepareOrder], commit: [...commitOrder] } : null,
      members: memberIds.map((individualId, position) => {
        const member = valid && normalized ? normalized.members[position] : null, value = valid ? observed[position] : null;
        return { individualId, prepareMs: round(member?.prepareMs ?? null), commitMs: round(member?.commitMs ?? null),
          prepareRank: prepareOrder && prepareOrder.includes(individualId) ? prepareOrder.indexOf(individualId) + 1 : null,
          commitRank: commitOrder && commitOrder.includes(individualId) ? commitOrder.indexOf(individualId) + 1 : null,
          observedSubsteps: value, skippedSubsteps: value === null ? null : Math.max(0, substeps - value), extraSubsteps: value === null ? null : Math.max(0, value - substeps) };
      }) };
    history = [...history, summary].slice(-retention);
    counts[committed ? 'committed' : 'failed']++;
    if (!valid) counts.invalid++;
    if (lagMs !== null) cumulativeLagMs += lagMs;
    return structuredClone(latest);
  }
  function recordPressure(worldTick, complete) {
    counts.pressurePauses++;
    pressure = { worldTick, reason: complete ? 'resource-pressure' : 'resource-pressure-incomplete' };
  }
  function view() {
    const lags = history.map(sample => sample.lagMs).filter(value => value !== null);
    return structuredClone({ protocolVersion: 1, kind: 'shared-barrier-telemetry', observational: true,
      retention: { maxSamples: retention }, intervalMs, substepsPerBarrier: substeps, counts,
      lag: { lastMs: latest?.lagMs ?? null, maxRetainedMs: lags.length ? Math.max(...lags) : null, cumulativeMs: round(cumulativeLagMs) },
      pressure, latest, history, disclosure });
  }
  return { record, recordPressure, view };
}

export const SHARED_MEASUREMENT_BOUNDS = Object.freeze({ minBarriers: 10, maxBarriers: 1000, minValidatedBarriers: 100, deadlineMs: 60000 });
const capacityScope = 'Zero-drive shared barrier on this Node runtime, platform and exact pinned membership only. Not a rendered, sensory, active-input, learning or larger-population capacity, and not an admission authorization.';
const count = value => Number.isSafeInteger(value) && value >= 0;
const sameRuntime = (a, b) => !!a && !!b && ['node', 'platform', 'arch'].every(key => typeof a[key] === 'string' && a[key] === b[key]);

/** Validated capacity is derived, never configured: it stays null unless a complete bounded
 * measurement matches the live active membership, the canonical pinned full graphs/models and
 * this runtime. Fixture or reduced graphs cannot match a pinned full-graph hash. */
export function assessSharedCapacity({ measurement, participants, runtime, pinned, modelIds, substeps, intervalMs }) {
  const unavailable = reason => ({ validatedConnectomeCapacity: null, reason });
  if (!measurement) return unavailable('no-measurement');
  const wall = measurement.wall;
  if (typeof measurement !== 'object' || measurement.schemaVersion !== 1 || measurement.kind !== 'shared-barrier-measurement'
    || measurement.backend !== 'connectome' || !Array.isArray(measurement.members) || !count(measurement.completedBarriers)
    || measurement.substepsPerBarrier !== substeps || measurement.intervalMs !== intervalMs) return unavailable('measurement-malformed');
  if (measurement.status !== 'complete') return unavailable('measurement-incomplete');
  if (!wall || ![wall.totalMs, wall.minMs, wall.medianMs, wall.maxMs].every(duration) || wall.totalMs === 0
    || !(wall.minMs <= wall.medianMs && wall.medianMs <= wall.maxMs && wall.maxMs <= wall.totalMs)
    || !(typeof measurement.simulatedToWallRatio === 'number' && Number.isFinite(measurement.simulatedToWallRatio) && measurement.simulatedToWallRatio > 0)
    || (measurement.memory !== null && !(measurement.memory && [measurement.memory.baselineRssBytes, measurement.memory.sampledPeakRssBytes, measurement.memory.incrementBytes].every(count)))
    || measurement.members.some(member => member?.completedSubsteps !== measurement.completedBarriers * substeps)) return unavailable('measurement-malformed');
  if (!sameRuntime(measurement.runtime, runtime)) return unavailable('runtime-mismatch');
  if (!Array.isArray(participants) || participants.length < 2 || participants.length !== measurement.members.length
    || participants.some(participant => participant.mode !== 'active' || !['running', 'paused'].includes(participant.status))) return unavailable('membership-mismatch');
  const measured = new Map(measurement.members.map(member => [member.individualId, member]));
  if (measured.size !== participants.length || participants.some(participant => {
    const member = measured.get(participant.individualId);
    return !member || member.dataset !== participant.dataset || member.modelId !== (participant.model?.id ?? null) || member.graphSha256 !== participant.graphSha256;
  })) return unavailable('membership-mismatch');
  if (measurement.members.some(member => !pinned?.[member.dataset]?.graphSha256 || pinned[member.dataset].graphSha256 !== member.graphSha256
    || modelIds?.[member.dataset] !== member.modelId)) return unavailable('not-pinned-full-graph');
  if (measurement.completedBarriers < SHARED_MEASUREMENT_BOUNDS.minValidatedBarriers) return unavailable('insufficient-barriers');
  return { reason: 'matching-measurement', validatedConnectomeCapacity: {
    residentCount: participants.length, datasets: measurement.members.map(member => member.dataset).sort(),
    completedBarriers: measurement.completedBarriers, simulatedToWallRatio: measurement.simulatedToWallRatio,
    medianBarrierWallMs: wall.medianMs, maxBarrierWallMs: wall.maxMs, memoryIncrementBytes: measurement.memory?.incrementBytes ?? null,
    measuredAt: measurement.measuredAt, runtime: { ...measurement.runtime }, scope: capacityScope } };
}
