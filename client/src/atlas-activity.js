/**
 * Atlas activity modes. Pure logic over already-validated anatomy and already-validated
 * worker/recording payloads: it owns no fetch, timer, renderer or runtime authority and it
 * never starts, advances or stimulates a neural worker.
 *
 * The kernel caps one sample at MAX_NEURON_SAMPLE exact IDs and a recording fixes the same
 * bounded selection, so an activity overlay is always an explicitly sampled subset of the
 * atlas. Cells outside that subset carry no mark at all: absence of a sample is absence of
 * data, never zero firing.
 */

/** Mirrors MAX_NEURON_SAMPLE in server/sparse-lif.js; a larger request is refused there. */
export const MAX_ATLAS_ACTIVITY_CELLS = 256;

export const ATLAS_ACTIVITY_MODES = Object.freeze({
  anatomy: Object.freeze({
    id: 'anatomy', eyebrow: 'ANATOMY ONLY / PINNED DATASET', label: 'Anatomy only',
    claim: 'Measured cell locations from the pinned dataset. No modeled activity is read, drawn or inferred.',
  }),
  live: Object.freeze({
    id: 'live', eyebrow: 'BOUNDED SAMPLE / RESIDENT WORKER', label: 'Active neural state (bounded sample)',
    claim: 'Instantaneous modeled potentials and pending one-step firing flags for a bounded sample of displayed cells, read once from a resident worker on this exact graph. Not firing rates, not measured biology, not a whole-network activity view.',
  }),
  replay: Object.freeze({
    id: 'replay', eyebrow: 'RECORDED REPLAY / INERT DATA', label: 'Recorded replay',
    claim: 'One stored observation from an inert manual recording of this exact graph. Nothing is loaded, restored or advanced, and the recorded individual is not selected as live.',
  }),
  fixture: Object.freeze({
    id: 'fixture', eyebrow: 'SYNTHETIC FIXTURE / NOT ANATOMY', label: 'Synthetic fixture',
    claim: 'The garden body runs a synthetic 32-neuron fixture. It shares no identity or coordinate frame with this dataset, so it can never supply an atlas mark and is never presented as anatomical evidence.',
  }),
  stale: Object.freeze({
    id: 'stale', eyebrow: 'STALE / SUPERSEDED VALUES', label: 'Stale or unavailable',
    claim: 'The source this overlay came from changed or became unreachable. Every canvas mark is withdrawn and the last values are kept only as labelled superseded text.',
  }),
});

/** Modes whose values may be drawn on the canvas at all. */
const DRAWABLE = new Set(['live', 'replay']);

const uint = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/**
 * Identity of the anatomy an overlay was read against. Profile is kept alongside dataset
 * rather than derived from it, so a future profile that is not a pure function of the
 * dataset cannot silently share a key. No individual is part of this scope: replay is
 * historical and must stay reachable while no neural backend is running at all.
 */
export function atlasActivityScope({ profile, dataset, graphManifestSha256 }) {
  if (typeof profile !== 'string' || !profile || typeof dataset !== 'string' || !dataset
    || !sha(graphManifestSha256)) return null;
  return JSON.stringify([profile, dataset, graphManifestSha256]);
}

/**
 * A delayed or superseded overlay never attaches to different anatomy, and a worker-sourced
 * overlay additionally belongs to exactly one individual: selecting another drops it outright
 * rather than leaving old activity on the new selection. A recording is explicitly historical
 * and names its own past individual, so it is not tied to the current one.
 */
export function overlayForScope(overlay, scope, individualId = null) {
  if (!overlay || !scope || overlay.scope !== scope) return null;
  return overlay.source?.kind === 'worker' && overlay.source.individualId !== individualId ? null : overlay;
}

/**
 * Deterministic evenly-strided selection over exactly the cells currently drawn: valid
 * position and visible display group. The selected cell is always included when it is
 * drawn, so picking and sampling agree. No hidden, unpositioned or filtered-out cell is
 * ever sampled, and the stride is published rather than implied.
 */
export function atlasActivitySelection({ nodes, valid, groups, visibleGroups, selectedIndex = null, max = MAX_ATLAS_ACTIVITY_CELLS }) {
  if (!Array.isArray(nodes) || !valid || !groups || valid.length !== nodes.length || groups.length !== nodes.length
    || !Number.isSafeInteger(max) || max < 1 || max > MAX_ATLAS_ACTIVITY_CELLS) throw new Error('Invalid atlas sampling request.');
  const visible = new Set(visibleGroups);
  const drawn = [];
  for (let i = 0; i < valid.length; i++) if (valid[i] === 1 && visible.has(groups[i])) drawn.push(i);
  if (!drawn.length) throw new Error('No displayed cell has a valid position, so there is nothing to sample. Show a display group first; no position or value is invented.');
  // A fractional step fills the whole budget: an integer stride would halve coverage just past
  // the cap (257 drawn cells would request 129 rather than 256) while claiming "at most 256".
  const requested = Math.min(drawn.length, max), step = drawn.length / requested;
  const indices = [];
  for (let k = 0; k < requested; k++) indices.push(drawn[Math.floor(k * step)]);
  if (Number.isInteger(selectedIndex) && valid[selectedIndex] === 1 && visible.has(groups[selectedIndex]) && !indices.includes(selectedIndex)) {
    indices[indices.length - 1] = selectedIndex;
    indices.sort((a, b) => a - b);
  }
  return { indices, neuronIds: indices.map(i => nodes[i][0]), drawnCells: drawn.length, requestedCells: indices.length, stride: step };
}

function overlayCell(index, entry, valid) {
  if (!entry || typeof entry.neuronId !== 'string' || !Number.isFinite(entry.potential)
    || ![0, 1].includes(entry.firing) || !uint(entry.refractoryStepsRemaining)) throw new Error('Modeled values are invalid; no activity is substituted.');
  return { index, neuronId: entry.neuronId, potential: entry.potential, firing: entry.firing,
    refractoryStepsRemaining: entry.refractoryStepsRemaining, positioned: index !== null && valid[index] === 1 };
}

function summarize(mode, scope, cells, timing, source) {
  const matched = cells.filter(cell => cell.index !== null);
  return { mode, scope, cells, ...timing, source,
    counts: { sampled: cells.length, matched: matched.length, unmatched: cells.length - matched.length,
      positioned: matched.filter(cell => cell.positioned).length, firing: cells.filter(cell => cell.firing === 1).length } };
}

/**
 * One instantaneous worker sample, already validated against the resident session by
 * readNeuronSamples, projected onto the exact atlas rows that were requested. The size and
 * order checks below repeat that validator deliberately: this module must hold its own
 * contract so a future caller cannot reach it through an unvalidated path.
 */
export function liveAtlasActivity({ scope, sample, selection, valid }) {
  if (!scope) throw new Error('A resident individual on this exact anatomical graph is required.');
  if (!sample || !Array.isArray(sample.samples) || sample.samples.length !== selection.indices.length) throw new Error('Sample size does not match the requested cells.');
  const cells = selection.indices.map((index, at) => {
    const entry = sample.samples[at];
    if (entry?.neuronId !== selection.neuronIds[at]) throw new Error('Sample order does not match the requested cells.');
    return overlayCell(index, entry, valid);
  });
  return summarize('live', scope, cells,
    { tick: sample.tick, simTimeMs: sample.simTimeMs, timeWindow: sample.timeWindow },
    { kind: 'worker', individualId: sample.individualId, dataset: sample.dataset, graphSha256: sample.graphSha256,
      sessionEpoch: sample.sessionEpoch, modelId: sample.modelId, commandSequence: sample.commandSequence, status: sample.status,
      drawnCells: selection.drawnCells, requestedCells: selection.requestedCells, stride: selection.stride });
}

/**
 * One stored observation of an inert recording. The recording must name this exact dataset
 * and graph-manifest hash; its IDs are resolved against the loaded atlas rather than assumed
 * to be in atlas order, and any ID this atlas does not carry is reported, never dropped
 * silently or matched to a neighbour.
 */
export function replayAtlasActivity({ scope, replay, recordIndex, nodes, valid, dataset, graphManifestSha256 }) {
  if (!scope) throw new Error('No validated atlas profile is loaded to place this recording against.');
  const session = replay?.session;
  if (session?.source?.dataset !== dataset || session.source.graphManifestSha256 !== graphManifestSha256)
    throw new Error('This recording was made from a different dataset or anatomical graph manifest.');
  const record = replay.records?.[recordIndex];
  if (!record || !Array.isArray(record.samples) || !record.samples.length) throw new Error('That recorded observation is missing or corrupt; no values are substituted.');
  const rows = new Map(nodes.map((row, index) => [row[0], index]));
  const cells = record.samples.map(entry => overlayCell(rows.has(entry?.neuronId) ? rows.get(entry.neuronId) : null, entry, valid));
  return summarize('replay', scope, cells,
    { tick: record.tick, simTimeMs: record.simTimeMs, timeWindow: record.timeWindow },
    { kind: 'recording', recordingId: session.id, status: session.status, individualId: session.source.individualId,
      dataset: session.source.dataset, graphSha256: session.source.graphSha256, sessionEpoch: session.source.sessionEpoch,
      modelId: session.source.model.id, observation: recordIndex + 1, observations: replay.records.length,
      gaps: replay.gaps.length, droppedSamples: session.droppedSamples, wallTimeMs: record.wallTimeMs, complete: replay.complete });
}

/** A superseded or unreachable source withdraws every mark but keeps its values as labelled text. */
export function staleAtlasActivity(overlay, reason) {
  if (!overlay) return null;
  return { ...overlay, mode: 'stale', supersededMode: overlay.supersededMode ?? overlay.mode, staleReason: reason };
}

/** Only a drawable overlay reaches the renderer; callers pass the scope-checked overlay. */
export function drawableAtlasActivity(overlay) {
  return overlay && DRAWABLE.has(overlay.mode) ? overlay.cells.filter(cell => cell.positioned) : null;
}

/** Per-row values for the searchable table, so colour is never the only activity channel. */
export function atlasActivityByIndex(overlay) {
  const cells = overlay?.cells ?? [];
  return new Map(cells.filter(cell => cell.index !== null).map(cell => [cell.index, cell]));
}

/** Row text for the searchable cell table. A superseded value is never printed as a current one,
 * and an unsampled cell reports that it was not sampled rather than any number. */
export function atlasActivityCellText(overlay, cell) {
  if (!cell) return 'Not sampled';
  return `${overlay?.mode === 'stale' ? 'Superseded' : 'Sampled'}: potential ${cell.potential}, firing flag ${cell.firing}`;
}

export const atlasActivityMode = overlay => ATLAS_ACTIVITY_MODES[overlay?.mode ?? 'anatomy'] ?? ATLAS_ACTIVITY_MODES.anatomy;
