import { useEffect, useState } from 'react';
import { restoreSavedCheckpoint, savedRestoreMemberIds } from './connectome-shared-restore.js';

const LABELS = { 'male-cns:v1.0': 'MaleCNS v1.0', 'banc:v888': 'BANC v888' };
async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Shared research request failed.');
  return value;
}

export default function ConnectomeSharedControls({ individuals = [] }) {
  const [view, setView] = useState(null), [shared, setShared] = useState(null), [chosen, setChosen] = useState([]);
  const [selectedSharedId, setSelectedSharedId] = useState('');
  const [checkpoints, setCheckpoints] = useState([]), [selectedCheckpoint, setSelectedCheckpoint] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    Promise.all([request('/api/connectomes/shared'), request('/api/connectomes/shared/checkpoints')]).then(([value, saved]) => {
      if (stopped) return;
      const first = value.sessions?.[0] ?? null;
      setView(value); setShared(first); setSelectedSharedId(first?.sharedId ?? ''); setCheckpoints(saved.checkpoints ?? []);
      setSelectedCheckpoint(saved.checkpoints?.[0]?.jointCheckpointId ?? '');
    }).catch(reason => { if (!stopped) setError(reason.message); });
    return () => { stopped = true; };
  }, []);
  async function refreshCheckpoints() {
    const value = await request('/api/connectomes/shared/checkpoints');
    setCheckpoints(value.checkpoints ?? []); setSelectedCheckpoint(current => value.checkpoints?.some(item => item.jointCheckpointId === current) ? current : value.checkpoints?.[0]?.jointCheckpointId ?? '');
  }
  async function act(path, body) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const value = await request(path, body);
      const next = value.shared?.status === 'separated' ? null : value.shared ?? null;
      setShared(next);
      setSelectedSharedId(next?.sharedId ?? '');
      setView(old => {
        const sessions = old?.sessions ?? [];
        return { ...old, sessions: next ? [...sessions.filter(item => item.sharedId !== next.sharedId), next] : sessions.filter(item => item.sharedId !== shared?.sharedId) };
      });
      if (body?.action === 'save') await refreshCheckpoints();
    }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  async function join() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const states = await Promise.all(chosen.map(id => request(`/api/connectomes/${encodeURIComponent(id)}`)));
      const value = await request('/api/connectomes/shared/join', { protocolVersion: 1, members: states.map(state => ({ protocolVersion: 1, individualId: state.individualId, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence })) });
      setShared(value.shared); setSelectedSharedId(value.shared.sharedId);
      setView(old => ({ ...old, sessions: [...(old?.sessions ?? []).filter(item => item.sharedId !== value.shared.sharedId), value.shared] })); setChosen([]);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  function control(action) {
    if (!shared) return;
    act(`/api/connectomes/shared/${shared.sharedId}/control`, { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, action });
  }
  function barrier() {
    if (!shared) return;
    act(`/api/connectomes/shared/${shared.sharedId}/barrier`, { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, action: 'barrier' });
  }
  function member(member, action) {
    if (!shared) return;
    act(`/api/connectomes/shared/${shared.sharedId}/member`, { protocolVersion: 1, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, sequence: shared.commandSequence + 1, individualId: member.individualId, action });
  }
  async function restore() {
    if (!selectedCheckpoint || busy || shared) return;
    setBusy(true); setError('');
    try {
      const checkpoint = checkpoints.find(item => item.jointCheckpointId === selectedCheckpoint);
      const value = await restoreSavedCheckpoint({ request, checkpoint,
        loadState: id => request(`/api/connectomes/${encodeURIComponent(id)}`) });
      setShared(value.shared); setSelectedSharedId(value.shared.sharedId); setView(old => ({ ...old, sessions: [...(old?.sessions ?? []).filter(item => item.sharedId !== value.shared.sharedId), value.shared] }));
      await refreshCheckpoints();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  const selectedSaved = checkpoints.find(item => item.jointCheckpointId === selectedCheckpoint);
  let savedIds = [];
  try { if (selectedSaved) savedIds = savedRestoreMemberIds(selectedSaved); } catch {}
  const resident = individuals.filter(item => item.resident && !['fault', 'loading', 'stopping'].includes(item.status));
  return <section className="lab-shared" aria-label="Full-connectome shared research barrier">
    <h3>Shared full-connectome research barrier</h3>
    <p>Explicitly join 2–64 already loaded MaleCNS/BANC individuals, then start and run one complete 5 ms world barrier. Each active graph advances exactly five 1 ms neural substeps. This path has no retinal input, motor output, body, learning, chemistry or biological sex comparison; it is not the illustrated fixture garden.</p>
    {view?.sessions?.length > 1 && <label>Shared research session <select value={selectedSharedId} disabled={busy} onChange={event => { const next = view.sessions.find(item => item.sharedId === event.target.value); setSelectedSharedId(event.target.value); setShared(next ?? null); }}>{view.sessions.map(item => <option key={item.sharedId} value={item.sharedId}>{item.status} · tick {item.tick} · {item.participants.length} members</option>)}</select></label>}
     {!view?.available && <p role="status">Full-connectome shared research is unavailable until a verified local catalog and matching paused workers are available.</p>}
     <fieldset disabled={busy || !view?.available || !!shared}><legend>Restore saved joint checkpoint</legend>
       <label>Saved joint checkpoint <select aria-label="Saved joint checkpoint" value={selectedCheckpoint} onChange={event => setSelectedCheckpoint(event.target.value)}>{checkpoints.map(item => <option key={item.jointCheckpointId} value={item.jointCheckpointId}>{item.jointCheckpointId} · tick {item.payload.tick}</option>)}</select></label>
       <p>Saved membership: {savedIds.length ? savedIds.join(' · ') : 'unavailable'}</p>
       <button disabled={!selectedSaved || savedIds.length < 2} onClick={restore}>Restore paused joint checkpoint</button>
       {shared && <p>Separate the current shared session before restoring independently.</p>}
     </fieldset>
     {!shared ? <fieldset disabled={busy || !view?.available}><legend>Select loaded research participants</legend>
      {resident.map(item => <label key={item.individualId} style={{ display: 'block', overflowWrap: 'anywhere' }}><input type="checkbox" checked={chosen.includes(item.individualId)} onChange={event => setChosen(ids => event.target.checked ? [...ids, item.individualId] : ids.filter(id => id !== item.individualId))} />{LABELS[item.dataset] ?? item.dataset} · {item.individualId} · {item.status}</label>)}
      <button disabled={busy || chosen.length < 2} onClick={join}>Join research population (paused)</button>
    </fieldset> : <>
      <p role="status">{shared.status} · world tick {shared.tick} · substeps {shared.substeps} · {shared.reason || 'No automatic execution.'}</p>
      <div className="lab-actions"><button disabled={busy || shared.status === 'running' || shared.participants.every(item => item.mode === 'resting')} onClick={() => control('start')}>Start research barrier</button>
        <button disabled={busy || shared.status !== 'running'} onClick={barrier}>Run one complete barrier</button>
        <button disabled={busy || shared.status !== 'running'} onClick={() => control('pause')}>Pause all</button>
        <button disabled={busy || shared.status === 'running'} onClick={() => control('save')}>Save joint checkpoint</button>
        <button disabled={busy} onClick={() => control('separate')}>Separate (all paused)</button></div>

      <fieldset disabled={busy}><legend>Per-member quiet state</legend>{shared.participants.map(item => <p key={item.individualId} style={{ overflowWrap: 'anywhere' }}>{LABELS[item.dataset] ?? item.dataset} · {item.individualId} · {item.mode} · {item.status}
        <button disabled={shared.status === 'resting' && item.mode === 'active'} onClick={() => member(item, item.mode === 'resting' ? 'resume' : 'rest')}>{item.mode === 'resting' ? 'Resume member' : 'Rest member'}</button>
        <button disabled={shared.participants.length < 3} onClick={() => member(item, 'withdraw')}>Withdraw member</button></p>)}</fieldset>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
