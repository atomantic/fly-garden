import { useEffect, useRef, useState } from 'react';
import { postVisitorCommand, visitorJson } from './visitor-api.js';

export default function ManagedVisitorControls({ state, disabled = false, onMutation, onBusyChange = () => {} }) {
  const [capabilities, setCapabilities] = useState(null), [world, setWorld] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const active = useRef(null), generation = useRef(0), mounted = useRef(true);
  const visitor = state?.visitor, owned = Boolean(state?.externalOwner || visitor?.owned);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; active.current?.abort(); onBusyChange(false); }; }, []);
  async function perform(operation) {
    if (!state || busy && !['home', 'pause', 'rest'].includes(operation)) return;
    const ticket = ++generation.current, controller = new AbortController();
    active.current?.abort(); active.current = controller; setBusy(true); onBusyChange(true); setError('');
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (operation === 'discover') {
        const value = await visitorJson(`/api/individuals/${encodeURIComponent(state.individualId)}/visitor?capabilities=1`, { signal: controller.signal });
        if (!mounted.current || ticket !== generation.current) return;
        const next = value.capabilities;
        if (!next || !Array.isArray(next.worldIds) || !next.worldIds.every(id => typeof id === 'string')) throw new Error(next?.reason || 'Host capability discovery unavailable.');
        setCapabilities(next); setWorld(next.worldIds.includes(world) ? world : next.worldIds[0] ?? '');
      } else {
        const value = await postVisitorCommand(state, operation, operation === 'admit' ? { worldId: world } : {}, controller.signal);
        if (!mounted.current || ticket !== generation.current) return;
        if (value.state?.individualId !== state.individualId || value.state?.sessionId !== state.sessionId) throw new Error('Visitor reply belongs to a different runtime session.');
        onMutation(value.state);
      }
    } catch (e) {
      if (mounted.current && ticket === generation.current) setError(controller.signal.aborted
        ? 'Visitor response unavailable. Check the current phase; an unconfirmed admission or return may still hold this individual paused.' : e.message);
    } finally {
      clearTimeout(timer);
      if (mounted.current && ticket === generation.current) { setBusy(false); onBusyChange(false); active.current = null; }
    }
  }
  const unavailable = disabled || busy || !state?.persistence?.resident;
  return <section className="card content-panel visitor-controls" aria-label="Managed Eidoverse visitor">
    <span className="eyebrow">EXPLICIT LOCAL VISITOR / SYNTHETIC FIXTURE</span>
    <h2>A scoped visit, with a way home.</h2>
    <p>Neural state stays here. The host renders an original fly body and supplies a disclosed geometric flower projection. This is not rendered vision, a humanoid avatar, retained learning or a claim about experience.</p>
    <p role="status"><strong>{visitor?.phase ?? 'home'}</strong>{visitor?.worldId ? ` · ${visitor.worldId}` : ''}{visitor?.running ? ' · running' : ' · paused'}{visitor?.pending ? ` · ${visitor.pending} pending` : ''}</p>
    <p>{visitor?.reason ?? 'The local visitor bridge is unavailable until explicitly configured.'}</p>
    {!owned && <>
      <button disabled={unavailable || !visitor?.available || Boolean(state?.sharedSession)} onClick={() => perform('discover')}>Check owner-approved worlds</button>
      {state?.sharedSession && <p>Separate the shared garden before requesting an individual visit.</p>}
      {capabilities && <>
        <label>World <select value={world} disabled={unavailable} onChange={event => setWorld(event.target.value)}>
          {!capabilities.worldIds.length && <option value="">No approved worlds</option>}
          {capabilities.worldIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <button disabled={unavailable || !capabilities.available || !world} onClick={() => perform('admit')}>Request visit (paused)</button>
        <p>{capabilities.reason}</p>
      </>}
    </>}
    {owned && <div className="actions">
      <button disabled={unavailable || visitor?.running || visitor?.phase !== 'visiting'} onClick={() => perform('start')}>Start visitor fixture</button>
      <button disabled={!state || !visitor?.running} onClick={() => perform('pause')}>Pause visitor</button>
      <button disabled={!state} onClick={() => perform('rest')}>Rest visitor</button>
      <button disabled={!state} onClick={() => perform('home')}>Return home (paused)</button>
    </div>}
    <p>Visits expire without automatic renewal. Returning or disconnected status keeps the home controller unavailable until removal is confirmed or the trusted lease bound expires. Optional language, flower encounters and creative capture stay off during visits.</p>
    {visitor?.lastTrace && <p>Last confirmed engineered movement: frame {visitor.lastTrace.frameId}, {visitor.lastTrace.inputSimTimeMs} → {visitor.lastTrace.outputSimTimeMs} ms. Source: {visitor.lastTrace.sensorySource}.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
