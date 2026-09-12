import { useEffect, useRef, useState } from 'react';

async function request(path, body, signal) {
  const response = await fetch(path, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Shared operation refused.');
  return value;
}
export default function SharedControls({ individuals = [], shared = null, controllerToken = null, disabled = false, onCommandStart = () => null, onCommandEnd = () => {}, onMutation = () => {} }) {
  const [chosen, setChosen] = useState([]), [checkpoints, setCheckpoints] = useState([]), [checkpoint, setCheckpoint] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const live = useRef({ shared, onMutation }), epoch = useRef(0);
  live.current = { shared, onMutation };
  useEffect(() => { const controller = new AbortController();
    request('/api/shared/checkpoints', undefined, controller.signal).then(value => setCheckpoints(value.checkpoints)).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); epoch.current++; };
  }, []);
  async function act(action) {
    const generation = ++epoch.current, prior = live.current.shared, context = onCommandStart();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    setBusy(true); setError('');
    try {
      let next;
      if (action === 'join' || action === 'restore') {
        const ids = action === 'join' ? chosen : checkpoints.find(item => item.jointCheckpointId === checkpoint)?.payload.members.map(item => item.individualId);
        if (!ids || ids.length !== 2 || new Set(ids).size !== 2) throw new Error('Select exactly two loaded fixtures or a two-member checkpoint.');
        // Refresh both command sessions at explicit action time; reading does not load or allocate a resident.
        const states = await Promise.all(ids.map(id => request(`/api/individuals/${id}`, undefined, controller.signal)));
        const members = states.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionId: state.sessionId, sequence: state.commandSequence + 1 }));
        next = await request(`/api/shared/${action}`, { protocolVersion: 1, members, ...(action === 'restore' ? { jointCheckpointId: checkpoint } : {}) }, controller.signal);
      } else {
        next = await request(`/api/shared/${prior.sharedId}/control`, { protocolVersion: 1, sharedId: prior.sharedId, worldEpoch: prior.worldEpoch, sequence: prior.commandSequence + 1, action }, controller.signal);
      }
      if (generation !== epoch.current) return;
      // Parent extracts the private token into tab-local ownership, never public snapshots/history.
      live.current.onMutation(next, context);
      if (next.checkpoint) { setCheckpoints(items => [...items, next.checkpoint]); setCheckpoint(next.checkpoint.jointCheckpointId); }
    } catch (e) { if (generation === epoch.current) setError(e.message); }
    finally { clearTimeout(timeout); onCommandEnd(context); if (generation === epoch.current) setBusy(false); }
  }
  const resident = individuals.filter(item => item.resident);
  return <section className="card" aria-label="Shared two-fixture garden">
    <h3>Shared fixture garden</h3>
    <p>Explicit two-resident baseline. Both original bodies share one committed world; each camera supplies only its own 8×4 retinal pixels. This does not run the anatomical connectomes or establish learning, biological sensing or a sex comparison.</p>
    {!shared || shared.status === 'separated' ? <>
      <fieldset disabled={busy || disabled}><legend>Select exactly two already loaded individuals</legend>
        {resident.map(item => <label key={item.individualId} style={{ display: 'block', overflowWrap: 'anywhere' }}><input type="checkbox" checked={chosen.includes(item.individualId)}
          onChange={e => setChosen(ids => e.target.checked ? [...ids, item.individualId] : ids.filter(id => id !== item.individualId))} />{item.individualId}</label>)}
      </fieldset>
      <button disabled={busy || disabled || chosen.length !== 2} onClick={() => act('join')}>Join selected pair (paused)</button>
    </> : <>
      <p role="status">{shared.status} · world tick {shared.tick} · {shared.reason || 'One complete atomic retinal batch per 5 ms step.'}</p>
      <p>{controllerToken ? 'This tab owns the controller cameras.' : 'Observer only; no controller lease. Separate and explicitly rejoin here to acquire cameras.'}</p>
      {['start', 'pause', 'save', 'separate'].map(action => <button key={action} disabled={busy || disabled || (action === 'start' && (!controllerToken || shared.status === 'running'))} onClick={() => act(action)}>
        {{ start: 'Start shared pair', pause: 'Pause both', save: 'Save joint checkpoint', separate: 'Separate (both paused)' }[action]}</button>)}
    </>}
    <label>Joint checkpoint <select value={checkpoint} disabled={busy || disabled} onChange={e => setCheckpoint(e.target.value)}><option value="">Select joint save</option>
      {checkpoints.filter(item => item.payload.members.length === 2).map(item => <option key={item.jointCheckpointId} value={item.jointCheckpointId}>{item.createdAt} · tick {item.payload.tick}</option>)}</select></label>
    <button disabled={busy || disabled || !checkpoint} onClick={() => act('restore')}>Restore joint checkpoint (paused)</button>
    <p>Restore requires both saved members already admitted and loaded. Pause or loss of either camera pauses both; separate to permit independent rest. No proximity objective, automatic encounters, language, or creative capture is enabled by joining. Shared movement capture is currently unavailable.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
