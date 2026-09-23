import React, { useEffect, useRef, useState } from 'react';
import { encounterTimelineModel } from './encounter-timeline.js';

export default function EnvironmentControls({ state, disabled = false, onMutation = () => {} }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = useRef(state), mounted = useRef(true);
  latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attached = state?.environmentAdapter?.attached;
  const shared = state?.sharedSession;
  const member = shared?.participants?.find(participant => participant.individualId === state?.individualId
    && participant.sessionId === state?.sessionId);
  const encounterReady = state?.status === 'running' && (shared
    ? shared.status === 'running' && Boolean(member) && member.mode !== 'resting'
    : attached);
  const timeline = encounterTimelineModel(state);
  const unavailable = disabled || Boolean(state?.externalOwner) || !state?.persistence?.resident;
  async function change(action) {
    const garden = action === 'enable-encounters' || action === 'disable-encounters';
    const individualId = state.individualId, sessionId = state.sessionId;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/individuals/${state.individualId}/${garden ? 'garden' : 'environment'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 1, individualId: state.individualId, sessionId: state.sessionId,
          sequence: state.commandSequence + 1, ...(garden ? { enabled: action === 'enable-encounters' } : { action }) }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(typeof next.error === 'string' ? next.error : next.error?.message || 'Environment command refused');
      // The parent extracts the private lease before storing the public snapshot.
      if (mounted.current && latest.current?.individualId === individualId && latest.current?.sessionId === sessionId
        && next.commandSequence >= latest.current.commandSequence) await onMutation(next);
    } catch (e) { if (mounted.current && latest.current?.individualId === individualId && latest.current?.sessionId === sessionId) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="environment-controls" aria-label="Engineered visual controller">
    <h3>Visual fixture loop</h3>
    <p>{shared ? 'Shared controller cameras own this body. Independent camera attachment is unavailable while joined.' : attached ? 'Dedicated controller camera attached. Each accepted frame owns one 5 ms neural step and applies only its returned engineered motor pose.' : 'Garden body is illustrative. Attach the controller camera explicitly to enable the experimental visual fixture loop.'}</p>
    {state?.environmentAdapter?.pauseReason && <p role="status">{state.environmentAdapter.pauseReason}</p>}
    <p>Attaching starts paused. Use Run fixture to begin; a missing camera pauses the simulation. No biological vision, retained learning, or subjective experience is established.</p>
    <button disabled={busy || unavailable || Boolean(shared)} onClick={() => change(attached ? 'detach' : 'attach')}>
      {attached ? 'Detach controller camera (pause)' : 'Attach controller camera (paused)'}
    </button>
    <div aria-label="Optional garden encounters">
      <h4>Optional flower encounters</h4>
      <p>Flower contact is a nonvisual geometry proxy, separate from controller-camera pixels. Floral scent and fictional nectar inputs use bounded synthetic currents; no receptor, pheromone, pharmacology or consent claim.</p>
      <button disabled={busy || unavailable || (!state?.encounterDynamics?.enabled && !encounterReady)}
        onClick={() => change(state?.encounterDynamics?.enabled ? 'disable-encounters' : 'enable-encounters')}>
        {state?.encounterDynamics?.enabled ? 'Disable flower encounters' : 'Enable optional flower encounters'}
      </button>
      <p role="status">{state?.encounterDynamics?.enabled ? `Enabled · ${state.encounterDynamics.phase}` : shared ? 'Disabled · start the shared world and resume this member before deliberate enablement.' : 'Disabled · attach and run the visual fixture before deliberate enablement.'}
        {state?.encounterDynamics?.contactIds?.length > 0 && ` · Contact: ${state.encounterDynamics.contactIds.join(', ')}`}</p>
      <p>Enablement gives no immediate dose. A later entry can offer one bounded pulse; staying near a flower never increases or repeats it. Leaving stops that pulse without refunding its budget. Pause, rest, home, restore and camera takeover disable encounters.</p>
      <details><summary>Engineered catalog and contact mapping</summary>
        {(state?.encounterDynamics?.catalog ?? []).map(effect => <p key={effect.id}>
          <strong>{effect.label}</strong>: {effect.intensity} synthetic current per mapped neuron for at most {effect.durationMs} simulation ms.
          {' '}{effect.evidence} {effect.persistentPlasticity}
        </p>)}
        <p>Contact radius: 0.35 garden units from the listed original flower centers. No hidden target coordinates are supplied to controller vision.</p>
        <ul>{(state?.encounterDynamics?.geometry ?? []).map(flower => <li key={flower.id}>
          {flower.id}: {flower.effectId}; center ({flower.x.toFixed(2)}, {flower.z.toFixed(2)})
        </li>)}</ul>
      </details>
      {timeline && <div className="encounter-timeline">
        <h5>Recent synthetic encounter activity</h5>
        {timeline.available ? <>
          <p>Simulation time only. This per-individual, per-session trail records policy events; it is not a chemical concentration curve. Checkpoints retain spent reservations and cancel transient exposure, but do not restore this event trail.</p>
          <p><strong>Active synthetic input:</strong> {timeline.activeUnavailable
            ? 'unavailable from this encounter snapshot.'
            : timeline.activePulse
              ? `${timeline.activePulse.label}; ${timeline.activePulse.intensity} synthetic current per mapped neuron until t = ${timeline.activePulse.activeUntilMs} ms.`
              : 'none.'}</p>
          <p><strong>Shared policy budget:</strong> {timeline.budget
            ? `${timeline.budget.reservedDose} of ${timeline.budget.maxDose} synthetic intensity-ms reserved; ${timeline.budget.reservedDurationMs} of ${timeline.budget.maxDurationMs} simulation ms in the ${timeline.budget.windowMs} ms window.`
            : 'unavailable from this encounter snapshot.'}</p>
          <p><strong>Longest shared-policy cooldown remaining:</strong> {timeline.recoveryRemainingMs === null
            ? 'unavailable from this encounter snapshot.'
            : `${timeline.recoveryRemainingMs} simulation ms. This is an engineering limit, not receptor kinetics.`}</p>
          <p><strong>Persistent learning:</strong> {timeline.persistentLearning}</p>
          {timeline.events.length
            ? <ol aria-label="Recent synthetic encounter events">
              {timeline.events.map(row => <li key={row.key}>
                <strong>t = {row.simTimeMs} ms:</strong> {row.message}
                {row.effect && <> {row.effect.label}{row.admitted && ` · ${row.effect.intensity} synthetic current per mapped neuron for at most ${row.effect.durationMs} simulation ms.`}</>}
              </li>)}
            </ol>
            : <p>No encounter events are recorded for this session.</p>}
          {timeline.omittedOlderEvents > 0 && <p>Showing the twelve most recent valid events.</p>}
          {timeline.unavailableEventCount > 0 && <p>{timeline.unavailableEventCount} event record{timeline.unavailableEventCount === 1 ? '' : 's'} unavailable and omitted.</p>}
        </> : <p role="status">{timeline.reason}</p>}
      </div>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
