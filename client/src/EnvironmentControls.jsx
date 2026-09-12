import React, { useEffect, useRef, useState } from 'react';

export default function EnvironmentControls({ state, disabled = false, onMutation = () => {} }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latest = useRef(state), mounted = useRef(true);
  latest.current = state;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attached = state?.environmentAdapter?.attached;
  async function change(action) {
    const individualId = state.individualId, sessionId = state.sessionId;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/individuals/${state.individualId}/environment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 1, individualId: state.individualId, sessionId: state.sessionId,
          sequence: state.commandSequence + 1, action }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(typeof next.error === 'string' ? next.error : next.error?.message || 'Environment command refused');
      // The parent extracts the private lease before storing the public snapshot.
      if (mounted.current && latest.current?.individualId === individualId && latest.current?.sessionId === sessionId
        && next.commandSequence >= latest.current.commandSequence) await onMutation(next);
    } catch (e) { if (mounted.current && latest.current?.individualId === individualId) setError(e.message); }
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
    {error && <p role="alert">{error}</p>}
  </section>;
}
