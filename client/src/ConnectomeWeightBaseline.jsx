import { useEffect, useId, useRef, useState } from 'react';
import { readConnectomeState, readConnectomeHistory } from './connectome-lab-state.js';
import { WEIGHT_LAYERS, GRAPH_MANIFEST_BASELINE, namedWeightBaselines, weightDifferenceLayer } from './weight-baseline.js';

const OUTCOMES = { compared: 'Compared', refused: 'Not compared', unreported: 'Not compared', unattributable: 'Compared runtime state only' };

async function json(url, signal) {
  const response = await fetch(url, { signal }), value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error
    : 'Runtime weight state is unavailable. Refresh the selected connectome before retrying.');
  return value;
}

/**
 * The fourth inspection layer: a difference against one explicitly named,
 * digested baseline. It reads runtime metadata and checkpoint history only. It
 * never loads, starts, advances, stimulates or checkpoints a worker, and it
 * never expresses a difference by changing how anything is drawn.
 */
export default function ConnectomeWeightBaseline({ individualId, dataset, selectionKey, edges = null, totalMatching = null }) {
  const selectId = useId();
  const scope = `${individualId ?? ''} ${dataset ?? ''} ${selectionKey ?? ''}`;
  const live = useRef({ scope, generation: 0 }), active = useRef(null);
  live.current.scope = scope;
  const [baselines, setBaselines] = useState([]), [choice, setChoice] = useState(GRAPH_MANIFEST_BASELINE);
  const [checkpoints, setCheckpoints] = useState([]), [result, setResult] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    live.current.generation++; active.current?.abort(); active.current = null;
    setBaselines([]); setCheckpoints([]); setChoice(GRAPH_MANIFEST_BASELINE); setResult(null); setError(''); setBusy(false);
    return () => { live.current.generation++; active.current?.abort(); active.current = null; };
  }, [scope]);

  async function run(compare) {
    if (active.current || !individualId) return;
    const generation = ++live.current.generation, controller = new AbortController();
    active.current = controller;
    const current = () => live.current.scope === scope && live.current.generation === generation;
    const timer = setTimeout(() => controller.abort(), 15000);
    setBusy(true); setError(''); if (compare) setResult(null);
    try {
      const base = `/api/connectomes/${encodeURIComponent(individualId)}`;
      const state = readConnectomeState(await json(base, controller.signal));
      if (state.individualId !== individualId || state.dataset !== dataset)
        throw new Error('The runtime metadata does not match the selected individual and dataset.');
      const history = readConnectomeHistory(await json(`${base}/history`, controller.signal), individualId);
      if (!current()) return;
      const available = namedWeightBaselines(state, history);
      if (available.length === 0) throw new Error('This individual reports no digested graph manifest, so no baseline can be named.');
      setBaselines(available); setCheckpoints(history);
      const selected = available.some(item => item.id === choice) ? choice : GRAPH_MANIFEST_BASELINE;
      if (selected !== choice) setChoice(selected);
      if (compare) setResult({ scope, baselineId: selected,
        at: { sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, tick: state.neural?.tick ?? null },
        value: weightDifferenceLayer({ state, baselineId: selected, checkpoints: history, edges: edges ?? [], totalMatching }) });
    } catch (e) {
      if (current()) setError(controller.signal.aborted
        ? 'The baseline read timed out. No difference was reported and no value was substituted.' : e.message);
    } finally {
      clearTimeout(timer);
      if (active.current === controller) { active.current = null; if (current()) setBusy(false); }
    }
  }

  const layer = WEIGHT_LAYERS[3], shown = result?.scope === scope ? result : null, value = shown?.value ?? null;
  return <section aria-label="Weight difference against a named baseline">
    <h4>{layer.label}</h4>
    <p>{layer.claim} Reading a baseline never loads, starts, advances, stimulates or checkpoints a worker.</p>
    {!individualId && <p>Select a full-connectome individual in Connectome lab first. No fixture baseline is substituted.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      <button disabled={!individualId || busy} onClick={() => run(false)}>{busy ? 'Reading runtime state…' : 'List named baselines'}</button>
      <label htmlFor={selectId}>Named baseline</label>
      <select id={selectId} value={choice} disabled={busy || baselines.length === 0} onChange={event => { setChoice(event.target.value); setResult(null); }}>
        {baselines.length === 0 ? <option value={GRAPH_MANIFEST_BASELINE}>No baseline listed yet</option>
          : baselines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button disabled={!individualId || busy || baselines.length === 0 || !edges} onClick={() => run(true)}>Compare this cell&rsquo;s connections</button>
    </div>
    {!edges && <p>Enable <strong>Optional anatomical connections</strong> and select a cell to compare its connections against a baseline.</p>}
    {error && <p role="alert">{error}</p>}
    {baselines.length > 0 && <details><summary>Baseline names and digests</summary>
      <dl>{baselines.map(item => <div key={item.id}><dt style={{ overflowWrap: 'anywhere' }}>{item.name}</dt>
        <dd style={{ overflowWrap: 'anywhere' }}>{item.kind === 'checkpoint' ? 'Durable checkpoint' : 'Pinned graph manifest'} · SHA-256 {item.sha256}<br />{item.weightBasis}</dd></div>)}</dl></details>}
    {value && <>
      <p role="status">{OUTCOMES[value.outcome]} against {value.baseline?.name ?? 'no named baseline'} · worker epoch {shown.at.sessionEpoch} · command sequence {shown.at.commandSequence} · tick {shown.at.tick ?? 'unavailable'}. {value.reason}</p>
      {value.extent && <p>Sampled extent: {value.extent.comparedEdges.toLocaleString()} of {value.extent.matchingEdges === null ? 'an unstated number of' : value.extent.matchingEdges.toLocaleString()} matching connections{value.extent.complete ? ' — every matching connection for this cell' : ' — a displayed subset, not the whole cell'}.</p>}
      {value.outcome === 'compared' && <div tabIndex={0} role="region" aria-label="Weight difference against the named baseline" style={{ overflowX: 'auto' }}>
        <table><caption>{value.differingEdges.toLocaleString()} of {value.rows.length.toLocaleString()} listed connections differ from the baseline.</caption>
          <thead><tr><th>Direction</th><th>Baseline weight</th><th>Current weight</th><th>Difference</th></tr></thead>
          <tbody>{value.rows.map(row => <tr key={`${row.direction}-${row.edgeIndex}`}>
            <td>{row.direction}</td><td>{row.baselineWeight.toPrecision(4)}</td><td>{row.currentWeight.toPrecision(4)}</td>
            <td>{row.delta === 0 ? '0 · no change' : row.delta.toPrecision(4)}</td></tr>)}</tbody></table></div>}
      {value.current && <details><summary>What was compared</summary><p style={{ overflowWrap: 'anywhere' }}>
        Graph SHA-256: {value.current.graphSha256}<br />Checkpoint schema version: {value.current.checkpointSchemaVersion}<br />
        Retained extension digest: {value.current.extensionsSha256 ?? 'none'}<br />Engineered contact gain: {value.current.contactGain}<br />
        Weight basis: {value.current.weightBasis ?? 'unstated'}</p></details>}
    </>}
    <p>{checkpoints.length.toLocaleString()} durable checkpoints are listed for this individual. A difference here is a difference in engineered weights against a named source; it is never a welfare, health, learning or experience measure.</p>
  </section>;
}
