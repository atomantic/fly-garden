import React, { useEffect, useRef, useState } from 'react';
import './recordings.css';

async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || `Recording request failed (${response.status})`);
  return value;
}
const bytes = value => `${(value / 1024 / 1024).toFixed(2)} MiB`;

/** Replay remains local observation data; this component has no runtime-control capability. */
export default function Recordings({ state, disabled = false, onMutation = () => {} }) {
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState(null);
  const [sampleIndex, setSampleIndex] = useState(0);
  const mounted = useRef(false);
  const listEpoch = useRef(0);
  async function refresh() {
    const epoch = ++listEpoch.current;
    try {
      const value = await request('/api/recordings');
      if (mounted.current && epoch === listEpoch.current) { setListing(value); setListError(''); }
    } catch (e) { if (mounted.current && epoch === listEpoch.current) setListError(e.message); }
  }
  useEffect(() => {
    mounted.current = true;
    let timer, cancelled = false;
    const poll = async () => { await refresh(); if (!cancelled) timer = setTimeout(poll, 2000); };
    poll();
    return () => { cancelled = true; mounted.current = false; listEpoch.current++; clearTimeout(timer); };
  }, []);
  async function action(work, mutates = false) {
    setBusy(true); setError('');
    try { await work(); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally {
      if (mutates) {
        try { await onMutation(); } catch (e) { if (mounted.current) setError(`State refresh failed: ${e.message}`); }
        await refresh();
      }
      if (mounted.current) setBusy(false);
    }
  }
  const active = listing?.sessions.some(s => s.individualId === state?.individualId && s.status === 'recording');
  const sample = replay?.records[sampleIndex];
  return <section className="recordings-panel" aria-label="Session recordings">
    <h2>Session recordings</h2>
    <p>Sampled fixture telemetry, stored locally. Recording does not start the simulation. Replay is read-only and cannot restore a checkpoint, deliver inputs, or call a provider.</p>
    <div className="recordings-actions">
      <button disabled={disabled || busy || !listing || !!listError || !state?.persistence?.resident || active}
        onClick={() => action(() => request('/api/recordings', {
          protocolVersion: 1, individualId: state.individualId, sessionId: state.sessionId, sequence: state.commandSequence + 1,
        }), true)}>Start recording selected fly</button>
      <button disabled={busy} onClick={() => action(refresh)}>Refresh recordings</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {listError && <p role="alert">Recording list unavailable; displayed records may be stale. {listError}</p>}
    {listing?.failure && <p role="alert">Recording service failure: {listing.failure}</p>}
    {listing && <p>Chunk storage: {bytes(listing.storage.usedBytes)} / {bytes(listing.storage.maxBytes)} · {listing.sessions.length} / {listing.storage.maxSessions} sessions · up to {listing.storage.maxRecords} samples. SQLite index uses additional space.</p>}
    {!listing && !listError && <p role="status">Loading recordings…</p>}
    {listing?.sessions.length === 0 && <p>No recordings yet.</p>}
    <div className="recordings-list">
      {listing?.sessions.map(session => <article key={session.id}>
        <h3>{session.status} · {session.nextSequence} attempted samples</h3>
        <dl>
          <dt>Recording</dt><dd>{session.id}</dd>
          <dt>Individual / world</dt><dd>{session.individualId} / {session.worldId}</dd>
          <dt>Source session</dt><dd>{session.sessionId}</dd>
          <dt>Model / dataset</dt><dd>{session.modelVersion} / {session.datasetVersion}</dd>
          <dt>Checkpoint / seed</dt><dd>{session.checkpointId ?? 'No checkpoint'} / {session.seed ?? 'No RNG seed (fixture)'}</dd>
          <dt>Sampling</dt><dd>Every {session.sampleIntervalMs} ms · {session.droppedSamples} dropped samples · {session.participantIds.length} declared participants</dd>
        </dl>
        {session.failure && <p role="status">{session.failure}</p>}
        <div className="recordings-actions">
          {session.status === 'recording' && <button disabled={busy || disabled} onClick={() => action(() => request(`/api/recordings/${session.id}/stop`, {}), true)}>Stop recording</button>}
          <button disabled={busy} onClick={() => action(async () => {
            const value = await request(`/api/recordings/${session.id}/replay`);
            if (mounted.current) { setReplay(value); setSampleIndex(0); }
          })}>View read-only replay</button>
          <button disabled={busy} onClick={() => action(async () => {
            const value = await request(`/api/recordings/${session.id}/export`);
            const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = `fly-garden-recording-${session.id}.json`;
            document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>Download JSON</button>
          <button disabled={busy || disabled || session.status === 'recording'} onClick={() => action(async () => {
            await request(`/api/recordings/${session.id}/delete`, {});
            if (mounted.current && replay?.session.id === session.id) setReplay(null);
          }, true)}>Delete recording</button>
        </div>
        <small>Deletion removes this recording only; its live checkpoint is preserved.</small>
      </article>)}
    </div>
    {replay && <section className="recordings-replay" aria-label="Read-only recording replay">
      <h3>Read-only replay · {replay.complete ? 'Complete sampled recording' : 'Partial / still recording'}</h3>
      <p>Recording {replay.session.id}. {replay.records.length} intact samples; {replay.gaps.length} missing/corrupt chunks; {replay.session.droppedSamples} dropped samples.</p>
      {replay.missingParticipants.length > 0 && <p role="status">Missing participant data: {replay.missingParticipants.join(', ')}</p>}
      {replay.gaps.length > 0 && <details><summary>Chunk gaps</summary><ul>{replay.gaps.map(gap => <li key={gap.sequence}>Sequence {gap.sequence}: {gap.reason}</li>)}</ul></details>}
      {sample ? <>
        <label className="recordings-slider">Recorded sample {sampleIndex + 1} of {replay.records.length}
          <input type="range" min="0" max={replay.records.length - 1} value={sampleIndex} onChange={event => setSampleIndex(Number(event.target.value))} />
        </label>
        <p>Event {sample.eventId} · individual {sample.individualId} · world {sample.worldId}</p>
        <p>Individual time {sample.simulationTimeMs} ms · world time {sample.worldTimeMs} ms · wall time {sample.wallTimeMs} ms · source window {sample.sourceStartMs}–{sample.sourceEndMs} ms</p>
        <details><summary>{sample.ratesHz.length} sampled neuron rates (Hz)</summary><p className="recordings-rates">{sample.ratesHz.map(rate => rate.toFixed(2)).join(', ')}</p></details>
      </> : <p>No intact samples to replay.</p>}
      <button onClick={() => setReplay(null)}>Close replay</button>
    </section>}
  </section>;
}
