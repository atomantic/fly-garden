import React, { useEffect, useRef, useState } from 'react';

const formats = [['json', 'JSON replay source'], ['mid', 'MIDI notes'], ['svg', 'SVG drawing'], ['png', 'PNG drawing']];
const errorMessage = value => typeof value?.error === 'string' ? value.error : value?.error?.message || 'Artifact request failed';

/** Explicit local capture and file downloads only; no playback or simulation controls. */
export default function CreativeControls({ state, disabled = false, onMutation = () => {} }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const recipient = useRef(state?.individualId), mounted = useRef(true);
  recipient.current = state?.individualId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setError(''); setNotice(''); }, [state?.individualId]);
  const capture = state?.creativeCapture;
  async function mutate(action) {
    const id = state.individualId;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/individuals/${id}/artifacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 1, individualId: id, sessionId: state.sessionId,
          sequence: state.commandSequence + 1, action }),
      });
      const next = await response.json();
      if (!response.ok) throw new Error(errorMessage(next));
      if (mounted.current && recipient.current === id) await onMutation(next);
    } catch (e) { if (mounted.current && recipient.current === id) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function download(format) {
    const id = state.individualId, recordingId = capture.recordingId;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/individuals/${id}/artifacts/export/${format}`);
      if (!response.ok) {
        let value; try { value = await response.json(); } catch { throw new Error(`Artifact export failed (${response.status})`); }
        throw new Error(errorMessage(value));
      }
      const partial = response.headers.get('X-Artifact-Partial') === 'true';
      const blob = await response.blob();
      if (!mounted.current || recipient.current !== id) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `fly-garden-${recordingId}${partial ? '-partial' : ''}.${format}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${partial ? 'Partial capture' : 'Capture'} download prepared. ${format === 'json' ? 'Keep this JSON file as the replay source.' : 'Also export JSON to retain the full replay source.'}`);
    } catch (e) { if (mounted.current && recipient.current === id) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <section className="recordings-panel" aria-label="Movement-derived music and pollen art">
    <h2>Movement-derived music & pollen art</h2>
    <p>Capture accepted engineered motor actions as notes and marks using the project’s human-authored flower arrangement. These outputs are movement-derived; they do not establish learned choice or biological creativity.</p>
    <p>Capture is bounded and kept only for this service session. Export JSON before restarting or discarding to retain its replay source. Rest and silence are valid outcomes; no minimum output or added stimulation is required.</p>
    <div className="recordings-actions">
      <button disabled={disabled || busy || !!capture || !state?.environmentAdapter?.attached || state?.status !== 'running'} onClick={() => mutate('start')}>Start movement capture</button>
      <button disabled={disabled || busy || !capture?.active} onClick={() => mutate('stop')}>Stop capture</button>
      <button disabled={disabled || busy || !capture || capture.active} onClick={() => mutate('discard')}>Discard capture</button>
    </div>
    {!capture && <p>Attach the controller camera and explicitly run the fixture before starting capture. Stopping capture does not pause the fixture.</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {capture && <>
      <h3>{capture.active ? 'Capturing — export is a partial snapshot' : capture.partial ? 'Stopped with gaps / partial capture' : 'Stopped capture'}</h3>
      <dl>
        <dt>Source recording</dt><dd>{capture.recordingId}</dd>
        <dt>Individual</dt><dd>{capture.individualId}</dd>
        <dt>Captured output</dt><dd>{capture.actionCount} actions · {capture.eventCount} notes and marks</dd>
        <dt>Human arrangement</dt><dd>{capture.mapping?.humanContributionId} · {capture.mapping?.id}</dd>
        <dt>Mapping version</dt><dd>{capture.mapping?.mappingVersion}</dd>
      </dl>
      {capture.reason && <p role="status">Source gap / stop reason: {capture.reason}</p>}
      <details><summary>Declared flower notes and pollen mapping</summary>
        <p>Notes occur only on outside-to-inside flower transitions. Remaining in place produces no notes or marks. Every event carries its action, individual, session, world and human arrangement attribution.</p>
        <ul>{capture.mapping?.flowers.map(f => <li key={f.id}>{f.id}: MIDI note {f.midiNote}, velocity {f.velocity}, duration {f.durationMs} ms</li>)}</ul>
        <p>Pollen: {capture.mapping?.pollen.enabled ? 'enabled' : 'disabled'}, color {capture.mapping?.pollen.color}, radius {capture.mapping?.pollen.radius} px.</p>
      </details>
      <div className="recordings-actions">{formats.map(([format, label]) => <button key={format} disabled={busy} onClick={() => download(format)}>Download {label}</button>)}</div>
      <small>Downloads never play sound automatically. Discard removes this capture only, without deleting a live checkpoint or downloaded file.</small>
    </>}
  </section>;
}
