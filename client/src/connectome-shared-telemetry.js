/** Pure, read-only presentation of shared barrier telemetry. Nothing here issues requests. */
export const MEASUREMENT_BARRIERS = 100;

const ms = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(3)} ms` : 'unavailable';
const bytes = value => Number.isSafeInteger(value) ? `${(value / 1024 ** 2).toFixed(1)} MiB` : 'unavailable';
const CAPACITY_REASONS = {
  'no-measurement': 'no explicit active-pair measurement in this session',
  'measurement-incomplete': 'the last measurement stopped before completion',
  'measurement-malformed': 'the last measurement was malformed',
  'runtime-mismatch': 'the measurement came from another Node runtime or platform',
  'membership-mismatch': 'the measurement does not match the current active membership',
  'not-pinned-full-graph': 'a measured graph is not a canonical pinned full graph',
  'insufficient-barriers': 'too few barriers were measured',
};

export function measurementEnvelope(shared, barriers = MEASUREMENT_BARRIERS) {
  return { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, barriers };
}

export function describeTelemetry(telemetry) {
  if (!telemetry || telemetry.kind !== 'shared-barrier-telemetry') return null;
  const latest = telemetry.latest;
  const capacity = telemetry.capacity?.validatedConnectomeCapacity;
  const measurement = telemetry.measurement;
  return {
    health: telemetry.health?.state ?? 'unavailable',
    reasons: (telemetry.health?.reasons ?? []).map(reason => reason.individualId ? `${reason.code} (${reason.individualId})` : reason.code),
    counts: `${telemetry.counts.committed} committed · ${telemetry.counts.failed} failed · ${telemetry.counts.invalid} invalid · ${telemetry.counts.pressurePauses} pressure pauses`,
    retention: `Last ${telemetry.history.length} of at most ${telemetry.retention.maxSamples} barrier samples retained`,
    lag: `Lag beyond ${telemetry.intervalMs} ms: last ${ms(telemetry.lag.lastMs)} · max retained ${ms(telemetry.lag.maxRetainedMs)} · cumulative ${ms(telemetry.lag.cumulativeMs)}`,
    latest: latest ? `#${latest.index} ${latest.outcome}${latest.reason ? ` (${latest.reason})` : ''} · world tick ${latest.worldTick} · wall ${ms(latest.wallMs)} · queue ${ms(latest.queueWaitMs)} · prepare ${ms(latest.prepareMs)} · commit ${ms(latest.commitMs)} · substeps ${latest.substepValidation}` : 'No barrier observed yet.',
    members: (latest?.members ?? []).map(member => `${member.individualId} · prepare #${member.prepareRank ?? '–'} ${ms(member.prepareMs)} · commit #${member.commitRank ?? '–'} ${ms(member.commitMs)} · substeps ${member.observedSubsteps ?? 'unavailable'}`),
    history: telemetry.history.map(sample => `#${sample.index} ${sample.outcome} · tick ${sample.worldTick} · wall ${ms(sample.wallMs)} · queue ${ms(sample.queueWaitMs)} · lag ${ms(sample.lagMs)}`),
    resources: telemetry.resources?.aggregate
      ? `Configured ceiling ${telemetry.resources.aggregate.maxResidentFlies ?? 'unavailable'} residents · ${telemetry.resources.aggregate.residentCount ?? 'unavailable'} resident · pressure ${telemetry.resources.aggregate.pressure} · aggregate ${bytes(telemetry.resources.aggregate.aggregateMemoryBytes)} · available ${bytes(telemetry.resources.aggregate.availableMemoryBytes)}`
      : 'Resource monitoring unavailable.',
    measurement: measurement ? `Measurement ${measurement.status}${measurement.stopReason ? ` (${measurement.stopReason})` : ''} · ${measurement.completedBarriers}/${measurement.requestedBarriers} barriers${measurement.wall ? ` · median ${ms(measurement.wall.medianMs)} · max ${ms(measurement.wall.maxMs)}` : ''}` : 'No explicit measurement in this session.',
    capacity: capacity
      ? `Validated for this exact ${capacity.residentCount}-member pinned membership on ${capacity.runtime.node}: ${capacity.completedBarriers} zero-drive barriers, simulated/wall ${capacity.simulatedToWallRatio.toFixed(3)}.`
      : `Validated connectome capacity unavailable: ${CAPACITY_REASONS[telemetry.capacity?.reason] ?? 'unknown'}.`,
  };
}
