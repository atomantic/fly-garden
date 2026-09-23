import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMixedVisualWorld } from './shared-visual-world.js';
import { mixedMembershipKey, readMixedWorldPresentation } from '../../shared/mixed-world-presentation.js';
import { MIXED_WORLD_POLL_MS, acceptMixedPresentation, mixedWorldView } from './mixed-world-state.js';

const NAMESPACE_LABELS = { 'male-cns:v1.0': 'MaleCNS v1.0', 'banc:v888': 'BANC v888', 'synthetic-fixture': 'Synthetic 32-neuron fixture' };
const SOURCE_LABELS = { fixture: 'Fixture', connectome: 'Full connectome (research only)' };
const BODY_LABELS = { 'fixture-procedural': 'Procedural fixture body at committed engineered pose', unavailable: 'Unavailable marker' };

/**
 * Render-only mixed shared-world shell. Its only network call is `GET /api/mixed-world`; opening,
 * refreshing or reopening it never joins, starts, advances, loads, checkpoints, restores or pauses a
 * participant and never holds a controller lease. There is no animation loop: the view repaints
 * only when a new committed batch arrives, the camera moves or the container resizes.
 */
export default function MixedWorldScene() {
  const [presentation, setPresentation] = useState(null), [receivedAt, setReceivedAt] = useState(null), [readError, setReadError] = useState('');
  const [now, setNow] = useState(() => Date.now()), [contextLost, setContextLost] = useState(false), [rendererError, setRendererError] = useState('');
  const [selected, setSelected] = useState(''), [rendererGeneration, setRendererGeneration] = useState(0);
  const host = useRef(null), world = useRef(null), redraw = useRef(null), latest = useRef(null), selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    let stopped = false, timer, controller;
    async function poll() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch('/api/mixed-world', { signal: controller.signal });
        const value = await response.json();
        if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Mixed world presentation unavailable.');
        const next = readMixedWorldPresentation(value);
        if (stopped) return;
        const accepted = acceptMixedPresentation(latest.current, next);
        // The display clock advances with the receipt, so a batch is never judged against an older clock tick.
        if (accepted === next) { const at = Date.now(); latest.current = next; setPresentation(next); setReceivedAt(at); setNow(at); }
        setReadError('');
      } catch (error) { if (!stopped) setReadError(controller.signal.aborted ? 'The read timed out.' : error.message); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, MIXED_WORLD_POLL_MS); }
    }
    void poll();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); controller?.abort(); };
  }, []);
  const view = mixedWorldView({ presentation, receivedAtMs: receivedAt, nowMs: now, readError, contextLost, rendererError });
  const key = view.present ? mixedMembershipKey(presentation) : null;
  // One complete scene per ordered membership. A membership change tears the whole scene down and
  // rebuilds it from one validated batch, so nobody is duplicated or silently dropped mid-update.
  useEffect(() => {
    if (!key) return undefined;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setRendererError('WebGL renderer unavailable. The participant table remains available; nothing is drawn.'); return undefined; }
    const container = host.current, scene = new THREE.Scene();
    let visual;
    try { visual = createMixedVisualWorld(scene, latest.current); }
    catch { renderer.dispose(); setRendererError('The mixed presentation could not be drawn; nothing is shown in its place.'); return undefined; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x112423); renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const [cx, cz] = visual.center, distance = Math.max(7, visual.span * 0.6);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, distance * 6); camera.position.set(cx + distance * 0.6, distance * 0.7, cz + distance);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.target.set(cx, 0.4, cz); controls.update();
    let stopped = false;
    const draw = () => { if (!stopped) renderer.render(scene, camera); };
    const resize = () => { const { width, height } = container.getBoundingClientRect(); if (width && height) { renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); draw(); } };
    const lost = event => { event.preventDefault(); stopped = true; setContextLost(true); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    controls.addEventListener('change', draw);
    const observer = new ResizeObserver(resize); observer.observe(container);
    world.current = visual; redraw.current = draw;
    visual.highlight(selectedRef.current); resize(); draw();
    return () => {
      stopped = true; world.current = null; redraw.current = null;
      observer.disconnect(); controls.removeEventListener('change', draw); controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      visual.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [key, rendererGeneration]);
  useEffect(() => { if (world.current && view.present && world.current.apply(presentation)) redraw.current?.(); }, [presentation, view.present]);
  useEffect(() => { world.current?.highlight(selected); redraw.current?.(); }, [selected, key]);
  const participants = view.table ? presentation.participants : [];
  const cohorts = view.table ? presentation.cohorts : [];
  return <section className="mixed-world" aria-label="Render-only mixed shared world shell">
    <h3>Mixed shared world shell (render-only)</h3>
    <p>{presentation?.disclosure ?? 'Render-only observation of committed shared sessions.'}</p>
    <p><strong>Research-only boundary:</strong> full-connectome participants appear as octahedron markers on a separate research pad. They have no body, pose, retinal input, motor output, learning or garden coupling. An open amber ring marks a fixture whose committed pose is missing; no body is invented for it.</p>
    <p>This view only reads. Opening or refreshing it never joins, starts, advances, loads, saves, restores or pauses anyone. Use the fixture garden and research barrier controls for lifecycle actions.</p>
    {view.message && <p role={view.alert ? 'alert' : 'status'}>{view.message}</p>}
    {(contextLost || rendererError) && <button type="button" onClick={() => { setContextLost(false); setRendererError(''); setRendererGeneration(value => value + 1); }}>Rebuild the view (reads only)</button>}
    {key && <div className="mixed-world-canvas" ref={host} role="img" aria-label="Separated session plots: procedural fixture bodies at committed poses and research-only markers. Position and order do not identify anyone; use the participant table and Locate buttons." />}
    {view.table && <>
      <p role="status">{participants.length} participants in {cohorts.length} independent sessions · fixture source {presentation.sources.fixture.available ? 'readable' : 'unavailable'} · research source {presentation.sources.connectome.available ? 'readable' : 'unavailable'}</p>
      <div className="mixed-world-table" role="region" aria-label="Mixed world participants" tabIndex={0}><table>
        <caption>Each row is identified by its stable individual ID, not by position or order.</caption>
        <thead><tr><th scope="col">Stable individual ID</th><th scope="col">Source</th><th scope="col">Dataset / model namespace</th><th scope="col">Session epoch</th>
          <th scope="col">Shared session · world epoch</th><th scope="col">Lifecycle · quiet state</th><th scope="col">Body</th><th scope="col">Locate</th></tr></thead>
        <tbody>{participants.map(item => <tr key={item.individualId}>
          <th scope="row">{item.individualId}</th><td>{SOURCE_LABELS[item.source]}</td>
          <td>{NAMESPACE_LABELS[item.namespace]} · model {item.modelId ?? 'unavailable'}{item.graphSha256 ? ` · graph ${item.graphSha256}` : ''}</td>
          <td>{item.sessionEpoch}</td><td>{item.cohortId} · {item.worldEpoch}</td><td>{item.lifecycle} · {item.mode}</td>
          <td>{BODY_LABELS[item.body.kind]}{item.body.kind === 'unavailable' ? `: ${item.body.reason}` : ''}</td>
          <td><button type="button" aria-pressed={selected === item.individualId} aria-label={`Locate ${item.individualId} in the view`} disabled={!view.present} onClick={() => setSelected(old => old === item.individualId ? '' : item.individualId)}>
            Locate</button></td>
        </tr>)}</tbody></table></div>
      <ul className="mixed-world-cohorts">{cohorts.map(cohort => <li key={cohort.cohortId}>
        {SOURCE_LABELS[cohort.source]} session {cohort.cohortId} · version {cohort.sessionVersion} · {cohort.status} · world tick {cohort.tick} · {cohort.memberIds.length} members
        {cohort.withdrawals.length > 0 && <> · withdrawn at recorded boundaries: {cohort.withdrawals.map(item => `${item.individualId} (tick ${item.tick})`).join(', ')}</>}
      </li>)}</ul>
    </>}
  </section>;
}
