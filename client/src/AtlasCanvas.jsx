import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { moveAtlasCamera, shouldFitAtlas } from './atlas-camera.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = [0x84d7bd, 0xe8be75, 0x9eacf5, 0xe8a7c8, 0xa8d779, 0x76c8e4, 0xd6cfe7];

/** Read-only measured point positions. This renderer owns no runtime/control API or animation loop. */
export default function AtlasCanvas({ positions, valid, groups, visibleGroups, selectedIndex, pointSize = 2, fitRevision = 0, edges = [], edgeOpacity = 0.15, onSelect }) {
  const host = useRef(null), view = useRef(null), select = useRef(onSelect);
  const [failure, setFailure] = useState(''), [measurement, setMeasurement] = useState(null), [measuring, setMeasuring] = useState(false);
  const benchmark = useRef(null);
  select.current = onSelect;
  useEffect(() => {
    setFailure(''); setMeasurement(null); setMeasuring(false);
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setFailure('WebGL is unavailable. All cells remain accessible in the searchable table.'); return; }
    const container = host.current;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x091817);
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Read-only anatomical point cloud. Use the camera buttons or searchable cell table for keyboard access.');
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; controls.minDistance = 0.01; controls.maxDistance = 50;
    const bounds = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < valid.length; i++) if (valid[i]) bounds.expandByPoint(v.fromArray(positions, i * 3));
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const scale = bounds.isEmpty() ? 1 : Math.max(...bounds.getSize(new THREE.Vector3()).toArray(), 1);
    const normalized = new Float32Array(positions.length), colors = new Float32Array(positions.length);
    const color = new THREE.Color();
    for (let i = 0; i < valid.length; i++) {
      for (let axis = 0; axis < 3; axis++) normalized[i * 3 + axis] = valid[i] ? (positions[i * 3 + axis] - center.getComponent(axis)) / scale * 8 : 0;
      color.setHex(COLORS[groups[i] % COLORS.length]); color.toArray(colors, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(normalized, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Reuse one bounded index buffer; filtering must not leave replaced GPU buffers behind.
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(valid.length), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    geometry.computeBoundingSphere();
    const material = new THREE.PointsMaterial({ size: pointSize, sizeAttenuation: false, vertexColors: true });
    const points = new THREE.Points(geometry, material); scene.add(points);
    const edgeGeometry = new THREE.BufferGeometry();
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x93b5a9, transparent: true, opacity: edgeOpacity, depthWrite: false });
    const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial); scene.add(edgeLines);
    const selectionGeometry = new THREE.BufferGeometry();
    selectionGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const selectionMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 9, sizeAttenuation: false, depthTest: false });
    const marker = new THREE.Points(selectionGeometry, selectionMaterial); marker.visible = false; marker.frustumCulled = false; marker.renderOrder = 2; scene.add(marker);
    let lost = false;
    const render = () => { if (!lost) renderer.render(scene, camera); };
    const fit = indices => {
      const box = new THREE.Box3();
      for (const i of indices) box.expandByPoint(v.fromArray(normalized, i * 3));
      if (box.isEmpty()) return;
      const target = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(camera.aspect, 1));
      const distance = Math.max(size / 2 / Math.sin(halfFov) * 1.1, 0.1);
      controls.maxDistance = Math.max(50, distance * 2); camera.far = Math.max(1000, distance * 4); camera.updateProjectionMatrix();
      controls.target.copy(target); camera.position.copy(target).add(new THREE.Vector3(0, 0, distance));
      controls.update(); render();
    };
    const resize = () => { const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return;
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
    const observer = new ResizeObserver(resize); observer.observe(container);
    controls.addEventListener('change', () => {
      if (benchmark.current) { benchmark.current(); setMeasuring(false); setMeasurement({ error: 'Camera changed; measurement cancelled.' }); }
      render();
    });
    let pointerDown;
    const cancel = () => { pointerDown = null; };
    const down = e => { pointerDown = e.button === 0 && e.isPrimary ? [e.clientX, e.clientY, e.pointerId] : null; };
    const click = e => {
      const start = pointerDown; cancel();
      if (!start || start[2] !== e.pointerId || e.button !== 0 || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height || lost) return;
      const ray = new THREE.Raycaster(); ray.params.Points.threshold = camera.position.distanceTo(controls.target) * 0.004;
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = ray.intersectObject(points)[0]; if (hit) select.current?.(hit.index);
    };
    const contextLost = e => { e.preventDefault(); benchmark.current?.(); setMeasuring(false); lost = true; setFailure('Graphics context lost. Reload the atlas to restore the view; the searchable cell table remains available.'); };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointerup', click);
    renderer.domElement.addEventListener('pointercancel', cancel);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    view.current = { edgeGeometry, edgeMaterial, geometry, material, marker, selectionGeometry, normalized, fit, render, camera, controls, indices: [], fitted: false, fitRevision };
    resize();
    return () => {
      benchmark.current?.(); view.current = null; observer.disconnect(); controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', click);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      edgeGeometry.dispose(); edgeMaterial.dispose(); geometry.dispose(); material.dispose(); selectionGeometry.dispose(); selectionMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
  }, [positions, valid, groups]);
  useEffect(() => {
    const current = view.current; if (!current) return;
    const enabled = new Set(visibleGroups), index = current.geometry.index;
    let count = 0;
    for (let i = 0; i < valid.length; i++) if (valid[i] && enabled.has(groups[i])) index.array[count++] = i;
    index.needsUpdate = true; current.geometry.setDrawRange(0, count);
    const indices = index.array.subarray(0, count); current.indices = indices;
    if (shouldFitAtlas(current.fitted, current.fitRevision, fitRevision, count)) { current.fit(indices); current.fitted = true; }
    current.fitRevision = fitRevision;
    current.render();
  }, [visibleGroups, positions, valid, groups, fitRevision]);
  useEffect(() => { const current = view.current; if (current) { current.material.size = pointSize; current.render(); } }, [pointSize]);
  useEffect(() => {
    const current = view.current; if (!current) return;
    current.marker.visible = Number.isInteger(selectedIndex) && valid[selectedIndex] === 1 && visibleGroups.includes(groups[selectedIndex]);
    if (current.marker.visible) { current.selectionGeometry.attributes.position.array.set(current.normalized.subarray(selectedIndex * 3, selectedIndex * 3 + 3)); current.selectionGeometry.attributes.position.needsUpdate = true; }
    current.render();
  }, [selectedIndex, visibleGroups, positions, valid, groups]);
  useEffect(() => {
    const current = view.current; if (!current) return;
    const values = [];
    for (const edge of edges.slice(0, 20000)) {
      const a = edge.sourceIndex, b = edge.targetIndex;
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !valid[a] || !valid[b]
        || !visibleGroups.includes(groups[a]) || !visibleGroups.includes(groups[b])) continue;
      for (const i of [a, b]) values.push(...current.normalized.subarray(i * 3, i * 3 + 3));
    }
    // Release the previous GPU allocation before replacing a sampled connection buffer.
    current.edgeGeometry.dispose();
    current.edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    current.edgeGeometry.computeBoundingSphere(); current.render();
  }, [edges, visibleGroups, positions, valid, groups]);
  useEffect(() => { const current = view.current; if (current) { current.edgeMaterial.opacity = edgeOpacity; current.render(); } }, [edgeOpacity]);
  useEffect(() => {
    if (benchmark.current) { benchmark.current(); setMeasuring(false); setMeasurement({ error: 'View changed; measurement cancelled. Run again for the current geometry.' }); }
  }, [positions, visibleGroups, edges, pointSize, edgeOpacity, selectedIndex]);
  function measureRedraws() {
    const current = view.current;
    if (!current || failure || benchmark.current) return;
    let frame = 0, timer, request, stopped = false;
    const start = performance.now();
    const points = current.indices.length, lines = (current.edgeGeometry.attributes.position?.count ?? 0) / 2;
    const bytes = Object.values(current.geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
      + current.geometry.index.array.byteLength + (current.edgeGeometry.attributes.position?.array.byteLength ?? 0) + 12;
    setMeasuring(true); setMeasurement(null);
    const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(request); clearTimeout(timer); benchmark.current = null; };
    benchmark.current = stop;
    timer = setTimeout(() => { stop(); setMeasuring(false); setMeasurement({ error: 'Measurement timed out after 10 seconds; no throughput result was recorded.' }); }, 10000);
    const redraw = () => {
      if (stopped || view.current !== current) return;
      current.render(); frame++;
      if (frame === 60) {
        const elapsedMs = performance.now() - start;
        stop(); setMeasuring(false); setMeasurement({ points, lines, bytes, elapsedMs, rate: 60000 / elapsedMs });
      } else request = requestAnimationFrame(redraw);
    };
    request = requestAnimationFrame(redraw);
  }
  function cameraCommand(action) {
    const current = view.current; if (!current) return;
    if (benchmark.current) { benchmark.current(); setMeasuring(false); setMeasurement({ error: 'Camera changed; measurement cancelled.' }); }
    const { camera, controls } = current;
    if (action === 'fit') return current.fit(current.indices);
    moveAtlasCamera(camera, controls, action); current.render();
  }
  return <div>
    <div role="group" aria-label="Anatomical camera controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {Object.entries({ fit: 'Fit visible anatomy', left: 'Rotate left', right: 'Rotate right', up: 'Rotate up', down: 'Rotate down', in: 'Zoom in', out: 'Zoom out', 'pan-left': 'Pan left', 'pan-right': 'Pan right', 'pan-up': 'Pan up', 'pan-down': 'Pan down' }).map(([action, label]) => <button key={action} disabled={Boolean(failure)} onClick={() => cameraCommand(action)}>{label}</button>)}
    </div>
    <p>All camera controls work with Tab and Enter or Space. Views change immediately without animation. Group checkboxes keep the camera fixed; named presets and Fit visible anatomy reframe explicitly.</p>
    <button disabled={measuring || Boolean(failure)} onClick={measureRedraws}>Measure 60 redraws</button>
    {measuring && <p role="status">Measuring 60 static browser redraws (10-second limit)…</p>}
    {measurement && <p role="status">{measurement.error || `${measurement.points.toLocaleString()} points and ${measurement.lines.toLocaleString()} lines; 60 redraws in ${measurement.elapsedMs.toFixed(1)} ms (${measurement.rate.toFixed(1)} redraws/s). Geometry buffer estimate: ${measurement.bytes.toLocaleString()} bytes.`}</p>}
    <p className="muted">Manual browser redraw throughput includes requestAnimationFrame scheduling and display refresh limits; it is not GPU timing or neural performance. Measurement does not move the camera or run a simulation.</p>
    {failure && <p role="alert">{failure}</p>}
    <div ref={host} style={{ height: 'min(60vh, 560px)', minHeight: 280, width: '100%' }} />
    <p className="muted">Static anatomical points in the source coordinate frame; no motion, neural activity, body silhouette or full morphology is inferred. Camera controls never start or steer an individual.</p>
  </div>;
}
