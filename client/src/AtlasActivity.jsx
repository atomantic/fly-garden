import { useEffect, useRef, useState } from 'react';
import { apiJson } from './api-json.js';
import { matchingSampleResident, readNeuronSamples, confirmNeuronSample } from './connectome-sample-state.js';
import { readRecordedListing, readRecordedReplay } from './connectome-recording-state.js';
import { ATLAS_ACTIVITY_MODES, MAX_ATLAS_ACTIVITY_CELLS, atlasActivitySelection, liveAtlasActivity, replayAtlasActivity, staleAtlasActivity } from './atlas-activity.js';

const json = apiJson('Modeled activity could not be read.');

/**
 * Bounded activity overlay for the anatomical atlas. Every request here is a single read:
 * nothing on this path loads, starts, advances, restores or stimulates a worker, moves the
 * camera, spends provider budget or issues an outward action. Replay needs no neural backend
 * at all; only the live mode requires a resident individual, and it says so.
 */
export default function AtlasActivity({ data, dataset, individualId, scope, visibleGroups, selectedIndex, overlay, onOverlay }) {
  const [mode, setMode] = useState('anatomy'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sessions, setSessions] = useState(null), [sessionsError, setSessionsError] = useState('');
  const [replay, setReplay] = useState(null), [observation, setObservation] = useState(0);
  const live = useRef({ key: '', generation: 0, mounted: true }), active = useRef(null);
  const key = JSON.stringify([scope, individualId]);
  live.current.key = key;
  const graphManifestSha256 = data.manifest.graphManifestSha256;
  const sampleScope = { individualId, dataset, graphManifestSha256 };

  // Any change of anatomy or of the selected individual retires and aborts every in-flight
  // request and drops the previous overlay: old activity never attaches to a new source.
  useEffect(() => {
    live.current.generation++; live.current.mounted = true;
    active.current?.abort(); active.current = null;
    setMode('anatomy'); setError(''); setBusy(false); setReplay(null); setObservation(0); setSessions(null); setSessionsError('');
    onOverlay(null);
    return () => { live.current.mounted = false; live.current.generation++; active.current?.abort(); active.current = null; };
  }, [key]);

  function run(work) {
    if (active.current) return;
    const generation = ++live.current.generation, requested = key, controller = new AbortController();
    active.current = controller;
    const current = () => live.current.mounted && live.current.generation === generation && live.current.key === requested;
    const timer = setTimeout(() => controller.abort(), 20000);
    setBusy(true); setError('');
    work(controller.signal, current)
      .catch(e => { if (current()) setError(controller.signal.aborted ? 'The read timed out. No modeled values were substituted.' : e.message); })
      .finally(() => { clearTimeout(timer); if (active.current === controller) active.current = null; if (current()) setBusy(false); });
  }

  async function readLive(signal, current) {
    const base = `/api/connectomes/${encodeURIComponent(individualId)}`;
    const selection = atlasActivitySelection({ ...data, visibleGroups, selectedIndex, max: MAX_ATLAS_ACTIVITY_CELLS });
    const state = matchingSampleResident(await json(base, signal), sampleScope);
    if (!current()) return;
    const sample = readNeuronSamples(await json(`${base}/samples`, signal, { protocolVersion: 1, individualId, dataset,
      graphSha256: state.graphSha256, sessionEpoch: state.sessionEpoch, neuronIds: selection.neuronIds }), state, sampleScope, selection.neuronIds);
    if (!current()) return;
    const read = liveAtlasActivity({ scope, sample, selection, valid: data.valid });
    // The confirming re-read is awaited outside the catch, so a timeout or transport failure
    // surfaces as an error instead of masquerading as a superseded reading. Only a worker that
    // genuinely moved on publishes stale values, and those carry no canvas mark.
    const latest = await json(base, signal);
    if (!current()) return;
    try { confirmNeuronSample(sample, latest, sampleScope); }
    catch (e) { onOverlay(staleAtlasActivity(read, e.message)); return; }
    onOverlay(read);
  }

  async function listRecordings(signal, current) {
    try {
      const value = readRecordedListing(await json('/api/connectome-recordings', signal));
      if (current()) { setSessions(value.sessions.filter(s => s.source.dataset === dataset && s.source.graphManifestSha256 === graphManifestSha256)); setSessionsError(''); }
    } catch (e) { if (current()) { setSessions([]); setSessionsError(e.message); } }
  }
  // Depends on busy so that choosing replay while another read is in flight still lists
  // recordings once that read finishes, rather than waiting for a manual refresh.
  useEffect(() => { if (mode === 'replay' && !sessions && !busy) run(listRecordings); }, [mode, sessions, busy]);

  function openReplay(session) {
    run(async (signal, current) => {
      const value = readRecordedReplay(await json(`/api/connectome-recordings/${session.id}/replay`, signal));
      if (value.session.id !== session.id) throw new Error('Replay belongs to another recording.');
      if (!value.records.length) throw new Error('That recording holds no intact observation.');
      if (!current()) return;
      setReplay(value); setObservation(0);
      onOverlay(replayAtlasActivity({ scope, replay: value, recordIndex: 0, nodes: data.nodes, valid: data.valid, dataset, graphManifestSha256 }));
    });
  }
  function showObservation(index) {
    setObservation(index);
    try { onOverlay(replayAtlasActivity({ scope, replay, recordIndex: index, nodes: data.nodes, valid: data.valid, dataset, graphManifestSha256 })); setError(''); }
    catch (e) { onOverlay(staleAtlasActivity(overlay, e.message)); setError(e.message); }
  }
  function chooseMode(next) {
    live.current.generation++;
    active.current?.abort(); active.current = null;
    setBusy(false);
    setMode(next); setError(''); onOverlay(null);
    if (next !== 'replay') { setReplay(null); setObservation(0); }
  }

  const descriptor = ATLAS_ACTIVITY_MODES[mode];
  return <section aria-label="Atlas activity mode">
    <h3>Activity mode</h3>
    <fieldset><legend>What this atlas is showing right now</legend>
      {['anatomy', 'live', 'replay', 'fixture'].map(id => <label key={id} style={{ display: 'block' }}>
        <input type="radio" name="atlas-activity-mode" value={id} checked={mode === id} onChange={() => chooseMode(id)} /> {ATLAS_ACTIVITY_MODES[id].label}
      </label>)}
    </fieldset>
    <p>{descriptor.claim}</p>
    <p className="muted">Choosing a mode reads nothing by itself. The panel heading keeps naming the mode of the values actually on screen, which stays anatomy only until a read succeeds.</p>

    {mode === 'live' && (individualId
      ? <>
        <p>One read of at most {MAX_ATLAS_ACTIVITY_CELLS} displayed cells, evenly spaced across the cells currently drawn and always including the selected cell. The kernel refuses a larger request, so this is a sample and never a whole-network activity view. Cells outside the sample keep no mark: not sampled is not zero firing.</p>
        <button disabled={busy} onClick={() => run(readLive)}>{busy ? 'Reading bounded sample…' : 'Read bounded activity sample once'}</button>
        <p className="muted">Reading does not load, start, advance, step or stimulate the worker, and it does not refresh on its own. A later command makes this snapshot out of date.</p>
      </>
      : <p>Select a full-connectome individual in Connectome lab first. No fixture or placeholder activity is substituted.</p>)}

    {mode === 'replay' && <>
      <p>Inert stored observations only, available with no neural backend running. Opening one neither selects its individual as live nor restores any checkpoint.</p>
      <button disabled={busy} onClick={() => run(listRecordings)}>Refresh matching recordings</button>
      {sessionsError && <p role="alert">Recording status is stale: {sessionsError}</p>}
      {sessions && !sessions.length && !sessionsError && <p>No stored recording names this dataset and anatomical graph manifest. Recordings from another specimen or graph are never reinterpreted against this atlas.</p>}
      {sessions?.map(session => <p key={session.id}>
        <button disabled={busy} onClick={() => openReplay(session)}>Overlay recording {session.id}</button>{' '}
        {session.status} · {session.selection.selectedCount} fixed neurons · {session.nextSequence} observation slots
      </p>)}
      {replay && <label>Observation {observation + 1} of {replay.records.length}
        <input type="range" min="0" max={replay.records.length - 1} value={observation} onChange={e => showObservation(Number(e.target.value))} />
      </label>}
    </>}

    {mode === 'fixture' && <p role="status">No marks are drawn. The garden fixture has its own 32 synthetic identifiers and no anatomical coordinate frame, so its values cannot be placed on this dataset even approximately.</p>}

    {error && <p role="alert">{error}</p>}
    {overlay && <AtlasActivityReport overlay={overlay} units={data.manifest.coordinates.units} />}
  </section>;
}

function AtlasActivityReport({ overlay, units }) {
  const stale = overlay.mode === 'stale', source = overlay.source;
  return <section aria-label="Modeled activity sample report">
    <h4>{ATLAS_ACTIVITY_MODES[overlay.mode].label}</h4>
    {stale && <p role="alert">{overlay.staleReason} These values were read in {ATLAS_ACTIVITY_MODES[overlay.supersededMode].label} and are no longer current; every canvas mark has been withdrawn.</p>}
    <p role="status">{overlay.counts.sampled.toLocaleString()} sampled cells · {overlay.counts.matched.toLocaleString()} matched to this atlas · {overlay.counts.unmatched.toLocaleString()} not present in it · {overlay.counts.positioned.toLocaleString()} with a valid position and markable · {overlay.counts.firing.toLocaleString()} with the pending one-step firing flag set. These are separate counts from the anatomical totals above, and neither replaces the other.</p>
    <p>Tick {overlay.tick} · {overlay.simTimeMs} ms modeled time · window [{overlay.timeWindow.startSimTimeMs}, {overlay.timeWindow.endSimTimeMs}] ms (instantaneous). Potentials are dimensionless engineered model values; they are not millivolts, firing rates or {units}.</p>
    {source.kind === 'worker'
      ? <p style={{ overflowWrap: 'anywhere' }}>Individual {source.individualId} · {source.dataset} · worker epoch {source.sessionEpoch} · command sequence {source.commandSequence} · status {source.status} at read · model {source.modelId} · graph SHA-256 {source.graphSha256}. Evenly spaced at about one cell in every {source.stride.toFixed(1)} of {source.drawnCells.toLocaleString()} drawn, for {source.requestedCells.toLocaleString()} requested.</p>
      : <p style={{ overflowWrap: 'anywhere' }}>Recording {source.recordingId} ({source.status}{source.complete ? ', complete' : ', partial'}) · observation {source.observation} of {source.observations} · {source.gaps} missing or corrupt chunks · {source.droppedSamples} dropped captures · historical individual {source.individualId} · {source.dataset} · source epoch {source.sessionEpoch} · model {source.modelId} · graph SHA-256 {source.graphSha256} · captured at wall time {source.wallTimeMs} ms since the Unix epoch.</p>}
    <div tabIndex={0} role="region" aria-label="Sampled modeled values" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 320, border: '1px solid #2c4033', borderRadius: 8 }}>
      <table><thead><tr><th>Exact neuron ID</th><th>Modeled potential</th><th>Pending firing flag</th><th>Refractory steps</th><th>Atlas placement</th></tr></thead><tbody>
        {overlay.cells.map(cell => <tr key={cell.neuronId}><td style={{ overflowWrap: 'anywhere' }}>{cell.neuronId}</td><td>{cell.potential}</td><td>{cell.firing}</td><td>{cell.refractoryStepsRemaining}</td>
          <td>{cell.index === null ? 'Not in this atlas' : cell.positioned ? (stale ? 'Mark withdrawn' : 'Marked') : 'No valid position'}</td></tr>)}
      </tbody></table></div>
    <p className="muted">Every value above is printed as text, so the canvas marks add no information that colour alone carries. Marks are drawn only for sampled cells with a valid position in a visible display group.</p>
  </section>;
}
