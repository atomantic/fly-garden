import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import AtlasCanvas from './AtlasCanvas.jsx';

const PROFILES = [['male-cns-v1', 'MaleCNS v1.0'], ['banc-v888', 'BANC v888']];
const LABELS = { 'visual-system': 'Visual system', 'central-brain': 'Central brain', 'ventral-nerve-cord': 'Ventral nerve cord', interregional: 'Interregional', unknown: 'Unclassified' };
async function json(url, signal) {
  const response = await fetch(url, { signal }), result = await response.json();
  if (!response.ok) throw new Error(typeof result.reason === 'string' ? result.reason : typeof result.error === 'string' ? result.error : 'Anatomical data could not be read.');
  return result;
}
const count = value => Number.isSafeInteger(value) && value >= 0;
function validateEdges(result, data, limit) {
  const n = data.nodes.length;
  if (result.available !== true || result.dataset !== data.manifest.dataset || result.atlasManifestSha256 !== data.manifestSha256 || result.graphManifestSha256 !== data.manifest.graphManifestSha256
    || !['retainedEdges', 'anatomicalContacts'].every(key => count(result[key])) || result.retainedNeurons !== n
    || !Array.isArray(result.edges) || result.edges.length > limit) throw new Error('Connectivity does not match this exact anatomical dataset.');
  const seen = new Set();
  for (const edge of result.edges) {
    if (!edge || !count(edge.edgeIndex) || edge.edgeIndex >= result.retainedEdges || seen.has(edge.edgeIndex)
      || !count(edge.sourceIndex) || edge.sourceIndex >= n || !count(edge.targetIndex) || edge.targetIndex >= n
      || edge.sourceId !== data.nodes[edge.sourceIndex][0] || edge.targetId !== data.nodes[edge.targetIndex][0]
      || !count(edge.anatomicalContacts) || edge.anatomicalContacts < 1 || ![-1, 0, 1].includes(edge.engineeredSign)
      || !Number.isFinite(edge.engineeredWeight) || typeof edge.positioned !== 'boolean') throw new Error('Invalid anatomical connection data.');
    seen.add(edge.edgeIndex);
  }
}


export default function NervousSystem({ dataset = "male-cns:v1.0", individualId = null, onDatasetChange = () => {} }) {
  const [connectionsEnabled, setConnectionsEnabled] = useState(false), [edgeLimit, setEdgeLimit] = useState(1000), [edgeOpacity, setEdgeOpacity] = useState(0.15);
  const [connectivity, setConnectivity] = useState(null), [connectivityError, setConnectivityError] = useState('');
  const [adjacency, setAdjacency] = useState(null), [adjacencyError, setAdjacencyError] = useState(''), [edgeOffset, setEdgeOffset] = useState(0);
  const profile = dataset === 'banc:v888' ? 'banc-v888' : 'male-cns-v1';
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [visibleGroups, setVisibleGroups] = useState([]), [filter, setFilter] = useState(''), [selectedIndex, setSelectedIndex] = useState(null), [pointSize, setPointSize] = useState(2);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setData(null); setError(''); setConnectionsEnabled(false); setConnectivity(null); setConnectivityError(''); setAdjacency(null); setAdjacencyError(''); setEdgeOffset(0); setFilter(''); setSelectedIndex(null); setVisibleGroups([]);
    async function load() {
      const status = await json(`/api/atlas/${profile}`, controller.signal);
      if (!status.available) throw new Error(status.reason || 'Pinned anatomical data is unavailable. No synthetic anatomy is substituted.');
      const manifest = status.manifest;
      const n = manifest?.counts?.retained;
      if (!Number.isSafeInteger(n) || n < 1 || n > 250000 || !Array.isArray(manifest.groups) || manifest.groups.length !== 5
        || !manifest.files || !['positions.f32', 'valid.u8', 'groups.u8', 'nodes.json'].every(name => Number.isSafeInteger(manifest.files[name]?.bytes)
          && manifest.files[name].bytes > 0 && manifest.files[name].bytes <= 64 * 1024 * 1024)) throw new Error('Invalid anatomical manifest limits.');
      const files = await Promise.all(['positions.f32', 'valid.u8', 'groups.u8', 'nodes.json'].map(async filename => {
        const response = await fetch(`/api/atlas/${profile}/${filename}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Anatomical asset is unavailable.');
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== manifest.files[filename].bytes) throw new Error('Anatomical asset length mismatch.');
        return buffer;
      }));
      if (!Number.isSafeInteger(n) || n < 1 || n > 250000 || files[0].byteLength !== n * 12 || files[1].byteLength !== n || files[2].byteLength !== n) throw new Error('Invalid anatomical dimensions.');
      const positions = new Float32Array(n * 3), raw = new DataView(files[0]);
      for (let i = 0; i < positions.length; i++) positions[i] = raw.getFloat32(i * 4, true);
      const valid = new Uint8Array(files[1]), groups = new Uint8Array(files[2]);
      const nodes = JSON.parse(new TextDecoder().decode(files[3]));
      if (!Array.isArray(nodes) || nodes.length !== n) throw new Error('Anatomical cell index does not match positions.');
      for (let i = 0; i < n; i++) if (![0, 1].includes(valid[i]) || groups[i] >= manifest.groups.length
        || !Array.isArray(nodes[i]) || nodes[i].length !== 6 || nodes[i].some(value => typeof value !== 'string')
        || !positions.subarray(i * 3, i * 3 + 3).every(Number.isFinite)) throw new Error('Invalid anatomical cell data.');
      if (current) { setData({ ...status, profile, positions, valid, groups, nodes }); setVisibleGroups(manifest.groups.map((_, i) => i)); }
    }
    load().catch(e => { if (current) setError(e.message); });
    return () => { current = false; controller.abort(); };
  }, [profile]);
  function selectCell(index) { setSelectedIndex(index); setEdgeOffset(0); setAdjacency(null); setAdjacencyError(''); }
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setConnectivity(null); setConnectivityError('');
    if (connectionsEnabled && data?.profile === profile) json(`/api/atlas/${profile}/connectivity?limit=${edgeLimit}`, controller.signal).then(result => {
      if (result.available === false) throw new Error(result.reason || 'Verified connectivity is unavailable.');
      validateEdges(result, data, edgeLimit);
      if (!result.sampling || !['consideredEdges', 'omittedMissingPositions', 'displayedEdges'].every(key => count(result.sampling[key]))
        || result.sampling.displayedEdges !== result.edges.length || result.sampling.consideredEdges > edgeLimit
        || result.sampling.omittedMissingPositions + result.edges.length !== result.sampling.consideredEdges) throw new Error('Invalid anatomical sample counts.');
      if (current) setConnectivity(result);
    }).catch(e => { if (current) setConnectivityError(e.message); });
    return () => { current = false; controller.abort(); };
  }, [connectionsEnabled, data, profile, edgeLimit]);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setAdjacency(null); setAdjacencyError('');
    if (connectionsEnabled && data?.profile === profile && selectedIndex !== null) {
      const id = data.nodes[selectedIndex][0];
      json(`/api/atlas/${profile}/adjacency?neuron=${encodeURIComponent(id)}&offset=${edgeOffset}&limit=100&direction=both`, controller.signal).then(result => {
        if (result.available === false) throw new Error(result.reason || 'Adjacency is unavailable.');
        validateEdges(result, data, 100);
        if (result.selectedId !== id || result.selectedIndex !== selectedIndex || result.offset !== edgeOffset || result.limit !== 100
          || result.direction !== 'both' || !['totalIncoming', 'totalOutgoing', 'incomingContacts', 'outgoingContacts', 'returnedEdges', 'totalMatching'].every(key => count(result[key]))
          || result.returnedEdges !== result.edges.length || result.returnedEdges > result.totalMatching
          || (result.nextOffset !== null && (!count(result.nextOffset) || result.nextOffset !== edgeOffset + result.returnedEdges || result.nextOffset >= result.totalMatching))
          || result.edges.some(edge => !['incoming', 'outgoing', 'self'].includes(edge.direction) || (edge.sourceIndex !== selectedIndex && edge.targetIndex !== selectedIndex))) throw new Error('Adjacency source does not match the selected cell.');
        if (current) setAdjacency(result);
      }).catch(e => { if (current) setAdjacencyError(e.message); });
    }
    return () => { current = false; controller.abort(); };
  }, [connectionsEnabled, data, profile, selectedIndex, edgeOffset]);
  const deferredFilter = useDeferredValue(filter);
  const matches = useMemo(() => {
    if (!data) return { count: 0, rows: [] };
    const query = deferredFilter.trim().toLowerCase(), rows = []; let count = 0;
    const exactId = /^[1-9]\d*$/.test(query) || query.startsWith(`${data.manifest.dataset}/`);
    for (let i = 0; i < data.nodes.length; i++) {
      const row = data.nodes[i];
      if (query && (exactId ? row[0] !== query && row[1] !== query : !row.some(value => value.toLowerCase().includes(query)))) continue;
      count++; if (rows.length < 50) rows.push(i);
    }
    return { count, rows };
  }, [data, deferredFilter]);
  const displayed = useMemo(() => { if (!data) return 0; let count = 0;
    for (let i = 0; i < data.valid.length; i++) if (data.valid[i] && visibleGroups.includes(data.groups[i])) count++;
    return count;
  }, [data, visibleGroups]);
  function preset(kind) {
    setVisibleGroups(data.manifest.groups.map((name, index) => ({ name, index })).filter(({ name }) => kind === 'whole'
      || kind === 'brain' && ['visual-system', 'central-brain'].includes(name)
      || kind === 'cord' && name === 'ventral-nerve-cord').map(({ index }) => index));
  }
  const displayEdges = useMemo(() => connectivity?.edges.filter(edge => data?.valid[edge.sourceIndex] && data.valid[edge.targetIndex]
    && visibleGroups.includes(data.groups[edge.sourceIndex]) && visibleGroups.includes(data.groups[edge.targetIndex])) ?? [], [connectivity, data, visibleGroups]);
  const selected = data && selectedIndex !== null ? data.nodes[selectedIndex] : null;
  return <section className="card content-panel" aria-label="Full nervous-system atlas">
    <span className="eyebrow">ANATOMY ONLY / PINNED DATASET</span>
    <h2>Brain and nerve cord</h2>
    <p>Measured cell locations across the brain and nerve cord. Anatomy only; no activity or learning is inferred from this view.</p>
    <label>Atlas dataset <select value={profile} onChange={e => { setData(null); setConnectionsEnabled(false); setConnectivity(null); selectCell(null); onDatasetChange(e.target.value === 'banc-v888' ? 'banc:v888' : 'male-cns:v1.0'); }}>{PROFILES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {individualId && <p>Selected connectome individual: <code>{individualId}</code>. This anatomy view has no live activity overlay. Viewing does not load or start its simulation.</p>}
    <p><a href="#Connectome%20lab">Open full-connectome individuals and paused controls →</a></p>
    {error && <p role="alert">{error} Generate the pinned atlas with the documented local importer, then reload this view.</p>}
    {!data && !error && <p role="status">Loading and validating pinned anatomical data…</p>}
    {data && <>
      <p role="status">{data.manifest.counts.retained.toLocaleString()} retained cells · {data.manifest.counts.positioned.toLocaleString()} positioned · {data.manifest.counts.missing.toLocaleString()} without a valid position · {displayed.toLocaleString()} displayed. Hidden and missing cells remain searchable.</p>
      <div role="group" aria-label="Anatomical presets" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => preset('whole')}>Whole retained nervous system</button><button onClick={() => preset('brain')}>Brain</button><button onClick={() => preset('cord')}>Nerve cord</button>
      </div>
      <p className="muted">Source X/Y/Z axes · {data.manifest.coordinates.units} · anatomical direction labels not independently established</p>
      <AtlasCanvas edges={displayEdges} edgeOpacity={edgeOpacity} positions={data.positions} valid={data.valid} groups={data.groups} visibleGroups={visibleGroups} selectedIndex={selectedIndex} pointSize={pointSize} onSelect={selectCell} />
      <details className="atlas-display-settings"><summary>Display groups, point size and optional connections</summary>
      <fieldset style={{ margin: '12px 0' }}><legend>Display groups (classification from source annotations)</legend>
        {data.manifest.groups.map((name, index) => <label key={name} style={{ display: 'inline-flex', gap: 5, marginRight: 15 }}><input type="checkbox" checked={visibleGroups.includes(index)} onChange={e => setVisibleGroups(current => e.target.checked ? [...current, index] : current.filter(value => value !== index))} />{LABELS[name] || name}</label>)}
      </fieldset>
      <label>Point size <input type="range" min="1" max="6" step="0.5" value={pointSize} onChange={e => setPointSize(Number(e.target.value))} /> {pointSize} pixels</label>
      <fieldset><legend>Optional anatomical connections</legend>
        <label><input type="checkbox" checked={connectionsEnabled} onChange={e => setConnectionsEnabled(e.target.checked)} /> Load the complete verified connectivity index and display a bounded sample</label>
        <p>This explicit read may require hundreds of megabytes of local memory. Lines connect measured cell positions; they are not neurite paths. The full graph remains unchanged.</p>
        {connectionsEnabled && <><label>Sample ceiling <select value={edgeLimit} onChange={e => setEdgeLimit(Number(e.target.value))}>{[1000, 5000, 20000].map(n => <option key={n} value={n}>{n.toLocaleString()} connections</option>)}</select></label>
          <label>Line opacity <input type="range" min="0.02" max="0.6" step="0.02" value={edgeOpacity} onChange={e => setEdgeOpacity(Number(e.target.value))} /></label>
          {connectivityError ? <p role="alert">{connectivityError}</p> : !connectivity ? <p role="status">Loading verified connectivity…</p> : <p>{connectivity.retainedEdges.toLocaleString()} retained directed edges · {connectivity.anatomicalContacts.toLocaleString()} anatomical contacts. Evenly spaced CSR sample: {connectivity.sampling.consideredEdges.toLocaleString()} considered, {connectivity.sampling.omittedMissingPositions.toLocaleString()} omitted for missing positions, {displayEdges.length.toLocaleString()} displayed after group filters. Display capping never alters the neural graph.</p>}
        </>}
      </fieldset>
      </details>
      <p>Cell locations and straight connection lines are not reconstructed neurites or full peripheral anatomy. No activity overlay is attached. Brain/cord presets use source annotation groups.</p>
      <label>Search cells by exact ID, type or region <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Exact ID, type or annotation" /></label>
      <p>{matches.count.toLocaleString()} matches; showing the first {matches.rows.length}. Search includes cells without coordinates.</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Cell</th><th>Type</th><th>Region</th><th>Position</th></tr></thead><tbody>
        {matches.rows.map(i => <tr key={data.nodes[i][0]}><td><button aria-pressed={i === selectedIndex} onClick={() => selectCell(i)}>{data.nodes[i][1]}</button></td><td>{data.nodes[i][2] || 'Unclassified'}</td><td>{data.nodes[i][4] || 'Unclassified'}</td><td>{data.nodes[i][5]}</td></tr>)}
      </tbody></table></div>
      <section aria-label="Anatomical cell inspector" aria-live="polite"><h3 style={{overflowWrap: "anywhere"}}>{selected ? selected[0] : 'Select an anatomical cell'}</h3>
        {selected && <><p>Type: {selected[2] || 'Unclassified'} · class: {selected[3] || 'Unclassified'} · region: {selected[4] || 'Unclassified'}.</p><p>{selected[5]} {data.valid[selectedIndex] ? `Coordinates (${data.manifest.coordinates.units}): ${Array.from(data.positions.subarray(selectedIndex * 3, selectedIndex * 3 + 3)).map(v => v.toFixed(3)).join(', ')}. ${visibleGroups.includes(data.groups[selectedIndex]) ? '' : 'Its display group is currently hidden.'}` : 'No point is drawn; coordinates are never invented.'}</p></>}
        {selected && connectionsEnabled && <>
          <h4>Incoming and outgoing anatomical connections</h4>
          {adjacencyError ? <p role="alert">{adjacencyError}</p> : !adjacency ? <p role="status">Reading selected-cell adjacency…</p> : <>
            <p>{adjacency.totalIncoming.toLocaleString()} incoming / {adjacency.totalOutgoing.toLocaleString()} outgoing edges; {adjacency.incomingContacts.toLocaleString()} incoming / {adjacency.outgoingContacts.toLocaleString()} outgoing contacts. Showing {adjacency.returnedEdges} of {adjacency.totalMatching.toLocaleString()} matching edges. Signs and weights below are engineered model mappings, not measured synaptic efficacy or learning.</p>
            <div style={{overflowX: 'auto'}}><table><thead><tr><th>Direction</th><th>Neighbor</th><th>Contacts</th><th>Engineered sign</th><th>Engineered weight</th><th>Position</th></tr></thead><tbody>{adjacency.edges.map(edge => {
              const neighbor = edge.sourceIndex === selectedIndex ? edge.targetIndex : edge.sourceIndex;
              return <tr key={edge.edgeIndex}><td>{edge.direction}</td><td><button onClick={() => selectCell(neighbor)}>{data.nodes[neighbor][1]}</button></td><td>{edge.anatomicalContacts}</td><td>{edge.engineeredSign === -1 ? 'Inhibitory' : edge.engineeredSign === 1 ? 'Excitatory' : 'Unmapped'}</td><td>{edge.engineeredWeight.toPrecision(4)}</td><td>{data.nodes[neighbor][5]}</td></tr>;
            })}</tbody></table></div>
            <button disabled={edgeOffset === 0} onClick={() => { setAdjacency(null); setEdgeOffset(Math.max(0, edgeOffset - 100)); }}>Previous connections</button>
            <button disabled={adjacency.nextOffset === null} onClick={() => { setAdjacency(null); setEdgeOffset(adjacency.nextOffset); }}>Next connections</button>
          </>}
        </>}
      </section>
      <details><summary>Dataset provenance and display limitations</summary><p>{data.manifest.coordinates.field} · {data.manifest.coordinates.units} · {data.manifest.coordinates.orientation}</p><p>{data.manifest.source.attribution} · {data.manifest.source.license}</p>
        <p>Source SHA-256: <code style={{overflowWrap: "anywhere"}}>{data.manifest.source.sha256}</code></p><p>Atlas manifest SHA-256: <code style={{overflowWrap: "anywhere"}}>{data.manifestSha256}</code></p>
        <p>{data.manifest.coordinates.frame}. This view preserves the declared source axes and conversion; camera orientation does not establish anatomical direction. Separate profiles never reuse neuron IDs or coordinate transforms.</p>
      </details>
    </>}
  </section>;
}
