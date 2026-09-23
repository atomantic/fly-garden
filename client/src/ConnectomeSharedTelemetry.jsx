import { describeTelemetry, MEASUREMENT_BARRIERS } from './connectome-shared-telemetry.js';

/** Displays observational telemetry. Refresh is a read; only the measurement button mutates, and only on explicit click. */
export default function ConnectomeSharedTelemetry({ shared, busy, onRefresh, onMeasure }) {
  const summary = describeTelemetry(shared?.telemetry);
  if (!summary) return <p role="status">Barrier telemetry unavailable.</p>;
  const measurable = shared.status === 'running' && shared.participants.every(item => item.mode === 'active');
  return <details className="lab-shared-telemetry">
    <summary>Barrier telemetry · {summary.health}{summary.reasons.length ? ` · ${summary.reasons.join(', ')}` : ''}</summary>
    <p>Observation only: reading or refreshing this panel never starts, advances or pauses anyone. Queue wait and lag describe this local process, not biological timing.</p>
    <p>{summary.counts}</p>
    <p>{summary.lag}</p>
    <p>Latest: {summary.latest}</p>
    {summary.members.length > 0 && <ul>{summary.members.map(line => <li key={line} style={{ overflowWrap: 'anywhere' }}>{line}</li>)}</ul>}
    <p>{summary.retention}</p>
    {summary.history.length > 0 && <ol>{summary.history.map(line => <li key={line}>{line}</li>)}</ol>}
    <p>{summary.resources}</p>
    <p>{summary.measurement}</p>
    <p>{summary.capacity} Configured capacity is an operator ceiling, not measured throughput.</p>
    <div className="lab-actions"><button disabled={busy} onClick={onRefresh}>Refresh telemetry (read only)</button>
      <button disabled={busy || !measurable} onClick={onMeasure}>Measure {MEASUREMENT_BARRIERS} barriers (explicit, advances all active members)</button></div>
  </details>;
}
