import React, { useEffect, useRef, useState } from 'react';

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options), value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || 'Language request refused');
  return value;
}
const post = (runtime, operation, payload, signal) => jsonRequest(`/api/individuals/${runtime.individualId}/language`, {
  method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ protocolVersion: 1, individualId: runtime.individualId, sessionId: runtime.sessionId,
    sequence: runtime.commandSequence + 1, operation, payload }),
});
// Cancellation uses fresh command ordering for its original recipient, never a newly selected fly.
async function cancelRecipient(individualId, sessionId, requestId) {
  const runtime = await jsonRequest(`/api/individuals/${individualId}`);
  if (runtime.sessionId !== sessionId) return null;
  return post(runtime, 'cancel', requestId === undefined ? {} : { requestId });
}
const initialLimits = { maxCalls: '1', maxTokens: '4096', maxSpendMicros: '0', cooldownMs: '10000', detectorThresholdHz: '20' };

export default function LanguageControls({ state, disabled = false, onMutation = () => {} }) {
  const [view, setView] = useState(null), [readError, setReadError] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [canceling, setCanceling] = useState(false);
  const [providerChoice, setProviderChoice] = useState(''), [limits, setLimits] = useState(initialLimits);
  const [detectorEnabled, setDetectorEnabled] = useState(false), [message, setMessage] = useState(''), [windowId, setWindowId] = useState('');
  const selected = useRef(null), active = useRef(null), mounted = useRef(false), readEpoch = useRef(0);
  const key = state ? `${state.individualId}/${state.sessionId}` : null;
  selected.current = key;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setView(null); setReadError(''); setError(''); setMessage(''); setWindowId(''); setProviderChoice(''); setDetectorEnabled(false); setLimits(initialLimits);
    let stopped = false, timer, controller;
    const id = state?.individualId;
    async function poll() {
      if (!id) return;
      const epoch = ++readEpoch.current; controller = new AbortController();
      try {
        const next = await jsonRequest(`/api/individuals/${id}/language`, { signal: controller.signal });
        if (!stopped && selected.current === key && epoch === readEpoch.current) { setView(next); setReadError(''); }
      } catch (e) { if (!stopped && selected.current === key) setReadError(e.message); }
      finally { if (!stopped) timer = setTimeout(poll, 1000); }
    }
    poll();
    return () => {
      stopped = true; clearTimeout(timer); controller?.abort(); readEpoch.current++;
      const pending = active.current;
      if (pending?.key === key) {
        pending.controller.abort(); active.current = null;
        if (pending.operation === 'chat') void cancelRecipient(pending.individualId, pending.sessionId, pending.requestId).catch(e => {
          if (mounted.current) setError(`Previous recipient cancellation could not be confirmed: ${e.message}`);
        });
      }
    };
  }, [key]);
  async function mutate(operation, payload) {
    const source = state, sourceKey = key, controller = new AbortController();
    const request = { key: sourceKey, individualId: source.individualId, sessionId: source.sessionId, operation, requestId: payload.requestId, controller };
    active.current = request; setBusy(true); setError('');
    try {
      const next = await post(source, operation, payload, controller.signal);
      if (mounted.current && selected.current === sourceKey) {
        readEpoch.current++; setView(next.language);
        await onMutation(next.state);
        if (operation === 'chat') setMessage('');
      }
    } catch (e) { if (mounted.current && selected.current === sourceKey && !controller.signal.aborted) setError(e.message); }
    finally { if (active.current === request) active.current = null; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    const sourceKey = key, id = state.individualId, sessionId = state.sessionId;
    setCanceling(true); setError('');
    try {
      const next = await cancelRecipient(id, sessionId);
      if (mounted.current && selected.current === sourceKey) {
        if (active.current?.key === sourceKey) active.current.controller.abort();
        if (next) { readEpoch.current++; setView(next.language); await onMutation(next.state); }
        else setError('Source session changed; previous requests were invalidated. Refresh before arming again.');
      }
    } catch (e) { if (mounted.current && selected.current === sourceKey) setError(`Cancellation could not be confirmed: ${e.message}`); }
    finally { if (mounted.current) setCanceling(false); }
  }
  const provider = view?.providers.find(p => JSON.stringify([p.providerId, p.model]) === providerChoice);
  const unavailable = disabled || !!readError || !view?.available || !state?.persistence?.resident;
  const numericValid = Object.entries(limits).every(([name, value]) => value.trim() !== '' && Number.isFinite(Number(value))
    && (name === 'detectorThresholdHz' ? Number(value) >= 0 && Number(value) <= 10000 : Number.isSafeInteger(Number(value)) && Number(value) >= (name === 'maxSpendMicros' ? 0 : name === 'cooldownMs' ? 1000 : 1))) && Number(limits.maxCalls) <= 1000;
  return <section className="recordings-panel" aria-label="Optional telemetry interpreter">
    <h2>Optional telemetry interpreter</h2>
    <p>Generated telemetry interpretation with uncertainty — not the fly speaking, thought decoding, consent, or demonstrated language understanding. Text cannot change neural state, deliver stimuli, or invoke tools.</p>
    {readError && <p role="alert">Language status unavailable; displayed values may be stale. {readError}</p>}
    {error && <p role="alert">{error}</p>}
    {!view && !readError && <p role="status">Loading language availability…</p>}
    {view && <>
      {!view.available && <p role="status">{view.reason || 'No provider is configured. Language requests are unavailable.'} Provider installation and startup require separate explicit setup.</p>}
      {view.failure && <p role="alert">{view.failure}</p>}
      <p>{view.armed ? 'Armed' : 'Disarmed'} · {view.pending ? 'Request pending' : 'No pending request'} · automatic detector {view.detectorEnabled ? 'enabled' : 'disabled'}.</p>
      <fieldset disabled={unavailable || busy || canceling || view.pending}>
        <legend>Explicit provider and budget configuration</legend>
        <label>Provider / model <select value={providerChoice} onChange={event => setProviderChoice(event.target.value)}>
          <option value="">Select a configured provider and model</option>
          {view.providers.map(p => <option key={`${p.providerId}:${p.model}`} value={JSON.stringify([p.providerId, p.model])}>{p.providerId} / {p.model}</option>)}
        </select></label>
        {provider && <p>Each call reserves up to {provider.requestTokens} tokens and {provider.requestSpendMicros} spend micros, including prompt and output. Output cap: {provider.maxOutputTokens} tokens.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '12px 0' }}>
          {Object.entries({ maxCalls: 'Call ceiling (1–1000)', maxTokens: 'Total token ceiling', maxSpendMicros: 'Spend ceiling (micros)', cooldownMs: 'Cooldown (ms, at least 1000)', detectorThresholdHz: 'Detector threshold (Hz)' }).map(([name, label]) =>
            <label key={name}>{label}<input style={{ display: 'block', maxWidth: 180 }} type="number" min={name === 'maxSpendMicros' || name === 'detectorThresholdHz' ? 0 : name === 'cooldownMs' ? 1000 : 1} max={name === 'maxCalls' ? 1000 : name === 'detectorThresholdHz' ? 10000 : undefined} step={name === 'detectorThresholdHz' ? 'any' : 1} value={limits[name]} onChange={event => setLimits(old => ({ ...old, [name]: event.target.value }))} /></label>)}
        </div>
        <label><input type="checkbox" checked={detectorEnabled} onChange={event => setDetectorEnabled(event.target.checked)} /> Separately enable automatic requests when the running fixture meets the declared rate threshold and budgets permit.</label>
        <p>Arming permits caretaker chat while paused. The detector only runs after explicit simulation start. No generated request is made by selecting settings.</p>
        <button disabled={!provider || !numericValid} onClick={() => mutate('arm', { providerId: provider.providerId, model: provider.model,
          ...Object.fromEntries(Object.entries(limits).map(([name, value]) => [name, Number(value)])), detectorEnabled })}>Arm with these limits</button>
      </fieldset>
      {view.config && <p>Armed configuration: {view.config.providerId} / {view.config.model} · cooldown {view.config.cooldownMs} ms · detector threshold {view.config.detectorThresholdHz} Hz.</p>}
      <p>Reserved: {view.reserved.calls} calls / {view.config?.maxCalls ?? 'not set'}, {view.reserved.tokens} tokens / {view.config?.maxTokens ?? 'not set'}, {view.reserved.spendMicros} spend micros / {view.config?.maxSpendMicros ?? 'not set'}. Aggregate spend reservation: {view.aggregateReservedSpendMicros} / {view.aggregateSpendMicros} micros. Cancellation and rearming do not refund reservations.</p>
      <div className="recordings-actions">
        <button disabled={disabled || busy || canceling || !view.armed} onClick={() => mutate('disarm', {})}>Disarm</button>
        <button disabled={disabled || canceling || (!view.pending && active.current?.operation !== 'chat')} onClick={cancel}>Cancel request and disarm</button>
      </div>
      <form onSubmit={event => { event.preventDefault(); if (!unavailable && !busy && !view.pending && view.armed && message.trim()) void mutate('chat', { requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), message, windowId: windowId || null }); }}>
        <label>Evidence window <select value={windowId} disabled={busy} onChange={event => setWindowId(event.target.value)}>
          <option value="">Current server evidence</option>
          {view.evidenceWindows.map(w => <option key={w.windowId} value={w.windowId}>{w.startMs}–{w.endMs} ms · session {w.sessionId}</option>)}
        </select></label>
        <p>{view.evidenceDisclosure}</p>
        <label>Caretaker message (at most 1000 characters)<textarea style={{ display: 'block', width: '100%', minHeight: 80 }} maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} disabled={unavailable || busy} /></label>
        <button type="submit" disabled={unavailable || busy || canceling || view.pending || !view.armed || !message.trim() || (!!windowId && !view.evidenceWindows.some(w => w.windowId === windowId))}>Send explicit caretaker request</button>
      </form>
      <h3>Interpretation and request history</h3>
      {!view.events.length && <p>No language requests or configuration events.</p>}
      <div className="recordings-list">{[...view.events].reverse().map(event => <article key={event.eventId}>
        <h4>{event.status}</h4>
        {event.reason && <p>{event.reason}</p>}
        {event.interpretation && <p style={{ whiteSpace: 'pre-wrap' }}>{event.interpretation}</p>}
        {event.uncertainty && <p>{event.uncertainty}</p>}
        {event.requestId && <details><summary>Request provenance</summary><p>Request {event.requestId} · individual {event.individualId} · session {event.sessionId} · provider {event.providerId} / {event.model}</p>
          {event.evidence && <p>{event.evidence.source} source · {event.evidence.namespace} / {event.evidence.modelId} · window {event.evidence.startMs}–{event.evidence.endMs} ms · mean {event.evidence.meanRateHz} Hz · instantaneous spikes {event.evidence.spikeCount} · event IDs {event.evidence.eventIds.join(', ') || 'none'}</p>}
          {event.detector && <p>Detector {event.detector.version}, threshold {event.detector.thresholdHz} Hz.</p>}
        </details>}
      </article>)}</div>
    </>}
  </section>;
}
