import { useEffect, useRef, useState } from 'react';
import { readSharedCapture, newestSharedCapture } from './shared-capture-state.js';
async function request(path, signal, body) {
  const response = await fetch(path, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Shared artifact operation unavailable.');
  return value;
}
export default function SharedCreativeControls({ shared }) {
  const [captures, setCaptures] = useState([]), [selected, setSelected] = useState(shared?.sharedId ?? '');
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef({ selected, generation: 0 }); live.current.selected = selected;
  useEffect(() => { if (shared?.sharedId) setSelected(shared.sharedId); }, [shared?.sharedId]);
  useEffect(() => {
    const controller = new AbortController(), generation = ++live.current.generation;
    setStatus(null); setError('');
    let pending = false;
    async function refresh() {
      if (pending) return; pending = true;
      try {
        const list = await request('/api/shared/artifacts', controller.signal);
        const next = selected ? readSharedCapture(await request(`/api/shared/${selected}/artifacts`, controller.signal), selected) : null;
        if (generation !== live.current.generation || selected !== live.current.selected) return;
        if (!Array.isArray(list.captures)) throw new Error('Shared capture list unavailable.');
        setCaptures(list.captures.map(item => readSharedCapture(item, item.sharedId))); setStatus(previous => newestSharedCapture(previous, next)); setError('');
      } catch (e) { if (!controller.signal.aborted && generation === live.current.generation) setError(e.message); }
      finally { pending = false; }
    }
    void refresh(); const timer = setInterval(refresh, 1500);
    return () => { controller.abort(); clearInterval(timer); live.current.generation++; };
  }, [selected]);
  async function act(action) {
    const id = selected, generation = live.current.generation, controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    setBusy(true); setError('');
    try {
      const current = readSharedCapture(await request(`/api/shared/${id}/artifacts`, controller.signal), id);
      const world = action === 'start' ? (await request(`/api/shared/${id}`, controller.signal)).shared : null;
      if (id !== live.current.selected || generation !== live.current.generation) return;
      const next = await request(`/api/shared/${id}/artifacts`, controller.signal, { protocolVersion: 1, sharedId: id,
        worldEpoch: world?.worldEpoch ?? current.worldEpoch, captureSequence: current.captureSequence, action });
      if (id === live.current.selected && generation === live.current.generation) setStatus(previous => newestSharedCapture(previous, readSharedCapture(next, id)));
    } catch (e) { if (id === live.current.selected && generation === live.current.generation) setError(controller.signal.aborted ? 'Capture request timed out; refresh its status before retrying.' : e.message); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  const ids = [...new Set([shared?.sharedId, ...captures.map(c => c.sharedId)].filter(Boolean))];
  const current = selected && selected === shared?.sharedId;
  return <section aria-label="Joint movement artifacts">
    <h4>Joint music and pollen artwork</h4>
    <p>Capture accepted actions from both fixtures, including silent rest. Notes and marks have no reward feedback. JSON preserves the replay source; capture remains session-local until exported.</p>
    <label>Artifact source <select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
      <option value="">Select a shared session</option>{ids.map(id => <option key={id} value={id}>{id}{id === shared?.sharedId ? ' · current world' : ' · retained capture'}</option>)}
    </select></label>
    <button disabled={busy || !!error || !status || !current || shared.status !== 'running' || !!status.captureId} onClick={() => act('start')}>Start joint movement capture</button>
    <button disabled={busy || !status?.active} onClick={() => act('stop')}>Stop joint capture</button>
    <button disabled={busy || !status?.captureId || status.active} onClick={() => act('discard')}>Discard exported joint capture</button>
    {status?.captureId && <><p role="status">{status.active ? 'Capturing' : 'Stopped'} · {status.actionCount} attributed actions · {status.partial ? 'partial' : status.active ? 'active snapshot' : 'complete captured interval'}. {status.reason}</p>
      <p style={{ overflowWrap: 'anywhere' }}>Participants: {status.participantIds.join(', ')}</p>
      <p>{['json', 'mid', 'svg', 'png'].map(format => <a key={format} style={{ marginRight: 12 }} href={`/api/shared/${selected}/artifacts/export/${format}`} download>Export {format.toUpperCase()}</a>)}</p></>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
