import React, { useEffect, useRef, useState } from 'react';

export default function EnvironmentControls({ state, disabled = false, onMutation = () => {} }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = useRef(state), mounted = useRef(true);
  latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attached = state?.environmentAdapter?.attached;
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
    <p>{attached ? 'Dedicated controller camera attached. Each accepted frame owns one 5 ms neural step and applies only its returned engineered motor pose.' : 'Garden body is illustrative. Attach the controller camera explicitly to enable the experimental visual fixture loop.'}</p>
    {state?.environmentAdapter?.pauseReason && <p role="status">{state.environmentAdapter.pauseReason}</p>}
    <p>Attaching starts paused. Use Run fixture to begin; a missing camera pauses the simulation. No biological vision, retained learning, or subjective experience is established.</p>
    <button disabled={busy || disabled || !state?.persistence?.resident} onClick={() => change(attached ? 'detach' : 'attach')}>
      {attached ? 'Detach controller camera (pause)' : 'Attach controller camera (paused)'}
    </button>
    <div aria-label="Optional garden encounters">
      <h4>Optional flower encounters</h4>
      <p>Flower contact is a nonvisual geometry proxy, separate from controller-camera pixels. Floral scent and fictional nectar inputs use bounded synthetic currents; no receptor, pheromone, pharmacology or consent claim.</p>
      <button disabled={busy || disabled || !state?.persistence?.resident || (!state?.encounterDynamics?.enabled && (!attached || state?.status !== 'running'))}
        onClick={() => change(state?.encounterDynamics?.enabled ? 'disable-encounters' : 'enable-encounters')}>
        {state?.encounterDynamics?.enabled ? 'Disable flower encounters' : 'Enable optional flower encounters'}
      </button>
      <p role="status">{state?.encounterDynamics?.enabled ? `Enabled · ${state.encounterDynamics.phase}` : 'Disabled · attach and run the visual fixture before deliberate enablement.'}
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
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
