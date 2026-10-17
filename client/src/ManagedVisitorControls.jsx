import { podPresentation } from './visitor-phase.js';
import { useVisitorCommands } from './use-visitor-commands.js';

export default function ManagedVisitorControls({ state, disabled = false, onMutation, onBusyChange = () => {} }) {
  const visitor = state?.visitor, owned = Boolean(state?.externalOwner || visitor?.owned);
  const pod = podPresentation(visitor);
  // Bound to this panel's individual and session; a selection change remounts the panel (see main.jsx).
  const { capabilities, world, setWorld, busy, error, perform } = useVisitorCommands(
    state ? { individualId: state.individualId, sessionId: state.sessionId } : null, { onMutation, onBusyChange });
  const unavailable = disabled || busy || !state?.persistence?.resident;
  return <section className="card content-panel visitor-controls" aria-label="Managed Eidoverse visitor">
    <span className="eyebrow">EXPLICIT LOCAL VISITOR / SYNTHETIC FIXTURE</span>
    <h2>A scoped visit, with a way home.</h2>
    <p>Neural state stays here. The host renders an original fly body and supplies a disclosed geometric flower projection. This is not rendered vision, a humanoid avatar, retained learning or a claim about experience.</p>
    <p role="status"><strong>{pod.phase}</strong> · {pod.label}{pod.destination ? ` · ${pod.destination}` : ''}{visitor?.running ? ' · running' : ' · paused'}{visitor?.pending ? ` · ${visitor.pending} pending` : ''}</p>
    {['departing', 'reconnecting'].includes(pod.phase) && <p>{pod.phase === 'departing'
      ? 'Departure was requested. The host has not acknowledged a body; nothing has arrived and the local fixture stays paused.'
      : 'A previous return was not confirmed. The bridge is retrying remote cleanup and still holds this individual paused; this is not a terminal disconnection.'}</p>}
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
        {Number.isInteger(capabilities.maxConcurrentVisitors) && <p>Host negotiated capacity: {capabilities.maxConcurrentVisitors} concurrent managed visitor{capabilities.maxConcurrentVisitors === 1 ? '' : 's'}. A further admission is refused before any local ownership changes, so an existing visit is never disturbed.</p>}
        {capabilities.interactionAvailable
          ? <p>Optional patch interaction is negotiated. Allowlisted patch objects: {capabilities.patchObjects.join(', ')}.</p>
          : <p>Optional patch interaction is unavailable on this host; the visit uses bounded movement only.</p>}
        <p>{capabilities.reason}</p>
      </>}
    </>}
    {owned && <div className="actions">
      <button disabled={unavailable || visitor?.running || visitor?.phase !== 'visiting'} onClick={() => perform('start')}>Start visitor fixture</button>
      <button disabled={!state || !visitor?.running} onClick={() => perform('pause')}>Pause visitor</button>
      <button disabled={!state} onClick={() => perform('rest')}>Rest visitor</button>
      <button disabled={!state} onClick={() => perform('home')}>Return home (paused)</button>
      {visitor?.patchObjects?.length > 0 && <button disabled={unavailable || pod.phase !== 'visiting'} onClick={() => perform('interact')}>
        {visitor?.interactArmed ? 'Withdraw patch interaction' : 'Allow patch interaction'}</button>}
    </div>}
    {owned && (visitor?.patchObjects?.length > 0
      ? <p>Allowing interaction is a permission only. It names no object, effect or moment: contact is derived from the fixture's own pose and bounded motor readout, never from a caretaker or a host resident. Nothing inbound can drive the local fixture.</p>
      : <p>Patch interaction is unavailable: this host did not negotiate the optional interaction capability. The visit uses bounded movement only; nothing is pending and nothing failed.</p>)}
    <p>Visits expire without automatic renewal. Returning or disconnected status keeps the home controller unavailable until removal is confirmed or the trusted lease bound expires. Optional language, flower encounters and creative capture stay off during visits.</p>
    {visitor?.lastTrace && <p>Last confirmed engineered {visitor.lastTrace.action === 'interact' ? 'patch interaction' : 'movement'}: frame {visitor.lastTrace.frameId}, {visitor.lastTrace.inputSimTimeMs} → {visitor.lastTrace.outputSimTimeMs} ms. Source: {visitor.lastTrace.sensorySource}.</p>}
    {visitor?.lastInteraction && <p>Last confirmed patch interaction: {visitor.lastInteraction.objectId} · effect {visitor.lastInteraction.effect} · frame {visitor.lastInteraction.frameId} · sequence {visitor.lastInteraction.sequence}. A confirmed contact is an engineered host acknowledgment, not evidence of preference or intent.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
