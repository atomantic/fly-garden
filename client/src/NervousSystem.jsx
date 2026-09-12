import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import AtlasCanvas from './AtlasCanvas.jsx';

const PROFILES = [['male-cns-v1', 'MaleCNS v1.0'], ['banc-v888', 'BANC v888']];
const LABELS = { 'visual-system': 'Visual system', 'central-brain': 'Central brain', 'ventral-nerve-cord': 'Ventral nerve cord', interregional: 'Interregional', unknown: 'Unclassified' };
async function json(url, signal) { const response = await fetch(url, { signal }); if (!response.ok) throw new Error('Anatomical data could not be read.'); return response.json(); }

export default function NervousSystem() {
  const [profile, setProfile] = useState(PROFILES[0][0]), [data, setData] = useState(null), [error, setError] = useState('');
  const [visibleGroups, setVisibleGroups] = useState([]), [filter, setFilter] = useState(''), [selectedIndex, setSelectedIndex] = useState(null), [pointSize, setPointSize] = useState(2);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setData(null); setError(''); setFilter(''); setSelectedIndex(null); setVisibleGroups([]);
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
      if (current) { setData({ ...status, positions, valid, groups, nodes }); setVisibleGroups(manifest.groups.map((_, i) => i)); }
    }
    load().catch(e => { if (current) setError(e.message); });
    return () => { current = false; controller.abort(); };
  }, [profile]);
  const deferredFilter = useDeferredValue(filter);
  const matches = useMemo(() => {
    if (!data) return { count: 0, rows: [] };
    const query = deferredFilter.trim().toLowerCase(), rows = []; let count = 0;
    for (let i = 0; i < data.nodes.length; i++) {
      const row = data.nodes[i];
      if (query && !row.some(value => value.toLowerCase().includes(query))) continue;
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
  const selected = data && selectedIndex !== null ? data.nodes[selectedIndex] : null;
  return <section className="card content-panel" aria-label="Full nervous-system atlas">
    <span className="eyebrow">ANATOMY ONLY / PINNED DATASET</span>
    <h2>Brain and nerve cord</h2>
    <p>Measured anatomical positions, independently browsed from the live fixture. These are cell locations, not complete skeletons, synaptic morphologies or a full peripheral nervous system. No activity or learning is inferred from their appearance.</p>
    <label>Atlas dataset <select value={profile} onChange={e => setProfile(e.target.value)}>{PROFILES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {error && <p role="alert">{error} Generate the pinned atlas with the documented local importer, then reload this view.</p>}
    {!data && !error && <p role="status">Loading and validating pinned anatomical data…</p>}
    {data && <>
      <p role="status">{data.manifest.counts.retained.toLocaleString()} retained cells · {data.manifest.counts.positioned.toLocaleString()} positioned · {data.manifest.counts.missing.toLocaleString()} without a valid position · {displayed.toLocaleString()} displayed. Loaded positions cover the retained selection; hidden and missing cells remain searchable.</p>
      <p>{data.manifest.coordinates.field} · {data.manifest.coordinates.units} · {data.manifest.coordinates.orientation}</p>
      <div role="group" aria-label="Anatomical presets" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => preset('whole')}>Whole retained nervous system</button><button onClick={() => preset('brain')}>Brain</button><button onClick={() => preset('cord')}>Nerve cord</button>
      </div>
      <fieldset style={{ margin: '12px 0' }}><legend>Display groups (classification from source annotations)</legend>
        {data.manifest.groups.map((name, index) => <label key={name} style={{ display: 'inline-flex', gap: 5, marginRight: 15 }}><input type="checkbox" checked={visibleGroups.includes(index)} onChange={e => setVisibleGroups(current => e.target.checked ? [...current, index] : current.filter(value => value !== index))} />{LABELS[name] || name}</label>)}
      </fieldset>
      <label>Point size <input type="range" min="1" max="6" step="0.5" value={pointSize} onChange={e => setPointSize(Number(e.target.value))} /> {pointSize} pixels</label>
      <AtlasCanvas positions={data.positions} valid={data.valid} groups={data.groups} visibleGroups={visibleGroups} selectedIndex={selectedIndex} pointSize={pointSize} onSelect={setSelectedIndex} />
      <p>Connections are not loaded in this atlas increment. Activity overlay is unavailable: the running 32-neuron fixture does not match either anatomical dataset. Brain/cord presets use annotation groups; unclassified and interregional cells remain available in the whole-system view.</p>
      <label>Search cells by exact ID, type or region <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Exact ID, type or annotation" /></label>
      <p>{matches.count.toLocaleString()} matches; showing the first {matches.rows.length}. Search includes cells without coordinates.</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Cell</th><th>Type</th><th>Region</th><th>Position</th></tr></thead><tbody>
        {matches.rows.map(i => <tr key={data.nodes[i][0]}><td><button aria-pressed={i === selectedIndex} onClick={() => setSelectedIndex(i)}>{data.nodes[i][1]}</button></td><td>{data.nodes[i][2] || 'Unclassified'}</td><td>{data.nodes[i][4] || 'Unclassified'}</td><td>{data.nodes[i][5]}</td></tr>)}
      </tbody></table></div>
      <section aria-label="Anatomical cell inspector" aria-live="polite"><h3 style={{overflowWrap: "anywhere"}}>{selected ? selected[0] : 'Select an anatomical cell'}</h3>
        {selected && <><p>Type: {selected[2] || 'Unclassified'} · class: {selected[3] || 'Unclassified'} · region: {selected[4] || 'Unclassified'}.</p><p>{selected[5]} {data.valid[selectedIndex] ? `Coordinates (${data.manifest.coordinates.units}): ${Array.from(data.positions.subarray(selectedIndex * 3, selectedIndex * 3 + 3)).map(v => v.toFixed(3)).join(', ')}. ${visibleGroups.includes(data.groups[selectedIndex]) ? '' : 'Its display group is currently hidden.'}` : 'No point is drawn; coordinates are never invented.'}</p></>}
      </section>
      <details><summary>Dataset provenance and display limitations</summary><p>{data.manifest.source.attribution} · {data.manifest.source.license}</p>
        <p>Source SHA-256: <code style={{overflowWrap: "anywhere"}}>{data.manifest.source.sha256}</code></p><p>Atlas manifest SHA-256: <code style={{overflowWrap: "anywhere"}}>{data.manifestSha256}</code></p>
        <p>{data.manifest.coordinates.frame}. This view preserves the declared source axes and conversion; camera orientation does not establish anatomical direction. Separate profiles never reuse neuron IDs or coordinate transforms.</p>
      </details>
    </>}
  </section>;
}
