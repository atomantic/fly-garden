import { readConnectomeState } from './connectome-lab-state.js';

const uint = value => Number.isSafeInteger(value) && value >= 0;
const count = value => (uint(value) ? value.toLocaleString() : null);

/**
 * FR-16's seven admin values, in display order, as one surface. Each entry
 * names where its value came from, and an absent value stays unavailable
 * instead of being filled in from a neighbouring source.
 */
export const ADMIN_VALUE_IDS = Object.freeze(['model-identity', 'loaded-counts', 'numerical-health',
  'simulation-speed', 'state-age', 'checkpoint-lineage', 'admission-state']);

/** Attached to numerical health wherever it is shown. Asserted, not only written in prose. */
export const NUMERICAL_HEALTH_DISCLOSURE =
  'Numerical health is a finite-bounds check on engineered model variables. It is never happiness, consciousness, welfare, wellbeing or a validated health score for an individual.';

const RUNTIME = 'Selected runtime', PROFILE = 'Pinned local profile (no resident worker)',
  HOST = 'Host admission service', BROWSER = 'This browser’s last accepted receipt', NONE = 'Unavailable';

const entry = (id, label, value, source, note = null) => ({ id, label,
  value: value ?? 'Unavailable', available: value !== null && value !== undefined, source: value == null ? NONE : source, note });

/**
 * `state` is the selected individual's published runtime metadata; `profile` the
 * pinned local dataset profile; `population` the host admission summary;
 * `history` its durable checkpoint list. Nothing here reads, starts or advances
 * a worker, and nothing is inferred across sources.
 */
export function runtimeAdminValues({ state, profile = null, population = null, history = [], receiptAgeMs = null, disconnected = false } = {}) {
  readConnectomeState(state);
  const resident = state.resident === true, neural = state.neural ?? null;
  const counts = state.provenance ? { neurons: state.provenance.neuronCount, edges: state.provenance.edgeCount, source: RUNTIME }
    : profile && uint(profile.neuronCount) ? { neurons: profile.neuronCount, edges: profile.edgeCount, source: PROFILE } : null;
  const health = state.status === 'fault' ? 'Fault reported; inspect the stated reason'
    : neural && [neural.minimum, neural.maximum].every(Number.isFinite) ? `Finite potential bounds ${neural.minimum} → ${neural.maximum}`
      : null;
  const lineage = Array.isArray(history) && history.length > 0
    ? `${history.length.toLocaleString()} durable checkpoints · head ${state.checkpointId ?? 'none recorded'}`
    : state.checkpointId ? `Head ${state.checkpointId}; no history was read` : null;
  const admission = population && uint(population.residentCount)
    ? `${population.residentCount.toLocaleString()} resident of ${count(population.settings?.maxResidentFlies) ?? 'an unstated'} ceiling · pressure ${population.pressure || 'unstated'} · this individual ${resident ? 'holds' : 'does not hold'} admission`
    : resident ? 'This individual holds admission; no host capacity summary was read' : null;
  return [
    entry('model-identity', 'Model identity', state.model?.id ?? null, RUNTIME,
      `Individual ${state.individualId} · dataset ${state.dataset} · worker epoch ${state.sessionEpoch}.`),
    entry('loaded-counts', 'Actually loaded counts', counts ? `${count(counts.neurons)} retained neurons · ${count(counts.edges)} directed edges` : null,
      counts?.source ?? NONE, counts?.source === PROFILE ? 'No worker is resident, so these are the pinned profile’s counts, not a loaded graph’s.' : 'Reported by the worker holding the graph.'),
    entry('numerical-health', 'Numerical health', health, RUNTIME, NUMERICAL_HEALTH_DISCLOSURE),
    // Owned by FR-10/#22: no timed batch measurement exists, so this stays unavailable rather than
    // reporting the browser's polling cadence as throughput.
    entry('simulation-speed', 'Simulation speed', null, NONE,
      'No timed batch measurement is supplied. Polling cadence is not simulated throughput, so no speed is displayed.'),
    entry('state-age', 'State age', uint(receiptAgeMs) ? `${receiptAgeMs.toLocaleString()} ms since the last accepted receipt` : null, BROWSER,
      disconnected ? 'Disconnected or stale: this snapshot is not current.' : 'Receipt freshness, not the age of neural activity.'),
    entry('checkpoint-lineage', 'Checkpoint lineage', lineage, RUNTIME, 'Durable heads and their parents, as recorded by the store.'),
    entry('admission-state', 'Environment admission', admission, population ? HOST : resident ? RUNTIME : NONE,
      'Paused, loading and stopping workers retain admission capacity.'),
  ];
}
