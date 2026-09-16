import { useEffect, useRef, useState } from "react";
import { environmentKey } from "./retinal-frame.js";
import { CONTROLLER_RETINA, createControllerCamera, deriveControllerRaster } from "./controller-retina.js";
import { createGardenVisualWorld, GARDEN_DEFAULT_BODY } from "./garden-visual-world.js";
import { podPresentation } from "./visitor-phase.js";
import { motionRenderPolicy, observeReducedMotion, prefersReducedMotion } from "./reduced-motion.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Original procedural art. Coordinates are illustrative, not anatomical data.
const POD_TONE = { idle: { emissive: 0x1f3c36, intensity: 0.35 }, pending: { emissive: 0x5a5326, intensity: 0.7 },
  active: { emissive: 0x35665a, intensity: 1 }, fault: { emissive: 0x6a3322, intensity: 0.8 } };

export default function Scene({ neural, brain = false, state = null, visitor = null, controllerToken = null, onEnvironmentFrame = () => {} }) {
  const host = useRef(null);
  const pod = podPresentation(visitor);
  // The render loop reads the latest phase without rebuilding the scene graph.
  const podState = useRef(pod);
  // Last pod tone/displacement published to the DOM, so the readback below writes only on change.
  const podDrawn = useRef(null);
  useEffect(() => { podState.current = podPresentation(visitor); }, [visitor?.phase, visitor?.worldId, visitor?.running]);
  const live = useRef(neural);
  const source = useRef({ state, controllerToken, onEnvironmentFrame, observedAt: performance.now() });
  const [retinal, setRetinal] = useState(null);
  const [frameError, setFrameError] = useState('');
  useEffect(() => { source.current = { state, controllerToken, onEnvironmentFrame, observedAt: performance.now() }; }, [state]);
  useEffect(() => { source.current.controllerToken = controllerToken; }, [controllerToken]);
  useEffect(() => { source.current.onEnvironmentFrame = onEnvironmentFrame; }, [onEnvironmentFrame]);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion(globalThis));
  // Redraw callback published by the renderer only while it is not holding an animation-frame loop.
  const redraw = useRef(null);
  useEffect(() => observeReducedMotion(globalThis, setReducedMotion), []);
  useEffect(() => {
    live.current = neural;
  }, [neural]);
  useEffect(() => {
    const container = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(brain ? 0x091817 : 0x112423, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(brain ? 0x091817 : 0x112423, 12, 25);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
    camera.position.set(brain ? 0 : 6.5, brain ? 2 : 5.4, brain ? 7 : 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, brain ? 0 : 0.6, 0);
    const motion = motionRenderPolicy(reducedMotion);
    controls.enableDamping = motion.enableDamping;
    controls.minDistance = 3;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI / 2.05;
    let podRings = [];
    let points, pointIds, body;
    const controllerCamera = createControllerCamera();
    const retinalTarget = new THREE.WebGLRenderTarget(CONTROLLER_RETINA.width, CONTROLLER_RETINA.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    retinalTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const rgba = new Uint8Array(CONTROLLER_RETINA.width * CONTROLLER_RETINA.height * 4);
    let stopped = false, inFlight = false, requestController = null, boundKey = null, boundToken = null, acceptedState = null, faulted = false, previousStatus = null;
    async function sendRetina() {
      const current = source.current.state, key = environmentKey(current), token = source.current.controllerToken;
      if (key !== boundKey || token !== boundToken) {
        requestController?.abort(); boundKey = key; boundToken = token; acceptedState = null; faulted = false; setFrameError(''); setRetinal(null);
      }
      if (previousStatus !== 'running' && current?.status === 'running') { faulted = false; setFrameError(''); }
      previousStatus = current?.status;
      if (brain || stopped || inFlight || !key || typeof token !== 'string' || !token || current.status !== 'running' || faulted) return;
      if (performance.now() - source.current.observedAt > 1000) { faulted = true; setFrameError('Live state is stale. Controller frames stopped; reconnect and explicitly resume.'); return; }
      const latest = acceptedState && acceptedState.commandSequence === current.commandSequence && acceptedState.simTimeMs > current.simTimeMs ? acceptedState : current;
      const environment = latest.environmentAdapter, pose = environment.pose;
      if (!pose || ![pose.x, pose.z, pose.yaw].every(Number.isFinite)) { faulted = true; setFrameError('Authoritative controller pose unavailable.'); return; }
      inFlight = true; requestController = new AbortController();
      const timeout = setTimeout(() => requestController?.abort(), 1000);
      try {
        // Only original garden geometry enters the offscreen controller camera, aimed solely by the
        // authoritative pose. Never sample the desktop or the freely orbiting observer camera.
        const rgb = deriveControllerRaster({ pose, camera: controllerCamera, renderer, scene, target: retinalTarget, rgba, body });
        if (!rgb) throw new Error('Authoritative controller pose unavailable');
        const response = await fetch(`/api/individuals/${current.individualId}/environment/frames`, {
          method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ controllerToken: token, version: 1, individualId: current.individualId, sessionId: current.sessionId,
            environmentEpoch: environment.environmentEpoch, frameId: environment.lastFrameId + 1,
            simTimeMs: latest.simTimeMs, capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || 'Controller frame rejected');
        if (stopped || source.current.controllerToken !== token || environmentKey(source.current.state) !== key || environmentKey(value.state) !== key) return;
        const observed = source.current.state;
        if (value.state.commandSequence < observed.commandSequence || value.state.simTimeMs < observed.simTimeMs
          || value.state.environmentAdapter.lastFrameId < observed.environmentAdapter.lastFrameId) return;
        acceptedState = value.state;
        setRetinal({ rgb, trace: value.trace });
        source.current.onEnvironmentFrame(value.state);
      } catch (error) {
        if (!stopped && source.current.controllerToken === token && environmentKey(source.current.state) === key) { faulted = true; setFrameError(`Controller frames stopped: ${error.message}. Pause and explicitly resume after recovery.`); }
      } finally {
        clearTimeout(timeout); if (!stopped) { renderer.setRenderTarget(null); if (body) body.visible = true; } inFlight = false;
      }
    }
    if (brain) {
      const nodes = live.current?.neurons || [];
      pointIds = nodes.map((n) => n.id);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          nodes.flatMap((n) => [n.x, n.y, n.z]),
          3,
        ),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          nodes.flatMap(() => [0.3, 0.65, 0.55]),
          3,
        ),
      );
      points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: 0.11,
          vertexColors: true,
          sizeAttenuation: true,
        }),
      );
      scene.add(points);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const positions = (live.current?.edges || []).flatMap((e) => {
        const a = byId.get(e.source),
          b = byId.get(e.target);
        return a && b ? [a.x, a.y, a.z, b.x, b.y, b.z] : [];
      });
      const edges = new THREE.BufferGeometry();
      edges.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      scene.add(
        new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: 0x3a7468,
            transparent: true,
            opacity: 0.25,
          }),
        ),
      );
    } else {
      const world = createGardenVisualWorld(scene);
      body = world.body;
      podRings = world.podRings;
    }
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!motion.continuous) draw();
    };
    let frame;
    // Pod phase tone is state, not motion: which visit phase the bridge is in must be visible whether
    // or not an animation-frame loop is running. Only the sinusoidal bob is motion, so `animate` is
    // false under prefers-reduced-motion and every ring holds its resting height.
    const applyPod = animate => {
      if (!podRings.length) return;
      const current = podState.current, tone = POD_TONE[current.tone] ?? POD_TONE.idle;
      // Acceptance criterion: the pod may only move once phase === 'visiting'. Every other
      // phase, including a requested but unacknowledged admission, holds it exactly still.
      const moving = animate && current.motion === true && current.phase === "visiting";
      const offset = moving ? Math.sin(performance.now() / 900) * 0.05 : 0;
      for (const { ring, baseY, direction } of podRings) {
        ring.material.emissive.setHex(tone.emissive);
        ring.material.emissiveIntensity = tone.intensity;
        ring.position.y = baseY + offset * direction;
      }
      // Disclosed verification readback, in the same spirit as the data-motion-* attributes above.
      // These values are read back OUT of the pod ring material and transform AFTER they are
      // written, so a browser check can confirm that the phase tone and the stillness rule reached
      // the rendered geometry rather than only the text label. Nothing in the app reads them, and
      // they carry no welfare, experience or admission claim — only which tone was drawn.
      // Displacement is published as a magnitude rather than a moved/still boolean: the bob passes
      // through its resting height twice a cycle, so a boolean would read "still" for single frames
      // in the middle of an acknowledged visit. A checker takes the maximum over a window instead.
      // Written only on change, so a phase that holds the rings still writes nothing per frame.
      const [{ ring, baseY }] = podRings;
      const drawn = `${ring.material.emissive.getHexString()} ${ring.material.emissiveIntensity} ${Math.abs(ring.position.y - baseY).toFixed(4)}`;
      if (host.current && drawn !== podDrawn.current) {
        podDrawn.current = drawn;
        const [emissive, intensity, offset] = drawn.split(" ");
        Object.assign(host.current.dataset, { podEmissive: emissive, podIntensity: intensity, podOffset: offset });
      }
    };
    // No controls.update() here: OrbitControls dispatches its own change event from update(),
    // and the reduced-motion path draws from that event. Damping is the only reason to poll it,
    // and damping is off whenever the loop is off.
    const draw = () => {
      applyPod(motion.continuous);
      if (points) {
        const current = new Map(
          (live.current?.neurons || []).map((n) => [n.id, n]),
        );
        const colors = points.geometry.attributes.color;
        pointIds.forEach((id, i) => {
          const n = current.get(id);
          colors.setXYZ(
            i,
            n?.firing ? 1 : 0.3,
            n?.firing ? 0.84 : 0.65,
            n?.firing ? 0.43 : 0.55,
          );
        });
        colors.needsUpdate = true;
      }
      const current = source.current.state;
      const key = environmentKey(current);
      const shown = key && environmentKey(acceptedState) === key && acceptedState.commandSequence === current.commandSequence && acceptedState.simTimeMs > current.simTimeMs ? acceptedState : current;
      const pose = shown?.environmentAdapter?.attached && shown.environmentAdapter.pose;
      if (body && pose) { body.position.set(pose.x, 0.67, pose.z); body.rotation.y = pose.yaw + Math.PI; }
      else if (body) { body.position.set(GARDEN_DEFAULT_BODY.x, GARDEN_DEFAULT_BODY.y, GARDEN_DEFAULT_BODY.z); body.rotation.y = GARDEN_DEFAULT_BODY.rotationY; }
      renderer.render(scene, camera);
      void sendRetina();
    };
    // Continuous repainting is decorative here. Under prefers-reduced-motion the view redraws on an
    // observed state commit, on viewer camera interaction and on resize instead. The engineered
    // controller-camera capture still runs from those redraws, paced by state rather than display
    // refresh; it is never disabled and never outruns the observed state.
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const loop = () => { frame = requestAnimationFrame(loop); controls.update(); draw(); };
    if (motion.continuous) { resize(); loop(); }
    else {
      controls.update();
      controls.addEventListener("change", draw);
      redraw.current = draw;
      resize();
    }
    return () => {
      stopped = true; requestController?.abort();
      redraw.current = null;
      controls.removeEventListener("change", draw);
      cancelAnimationFrame(frame);
      retinalTarget.dispose();
      observer.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [brain, neural?.neurons?.length, reducedMotion]);
  // One redraw per React commit while no animation-frame loop is running.
  useEffect(() => { redraw.current?.(); });
  return (
    <>
    {/* data-motion-* disclose, for accessibility verification, which repaint schedule this renderer uses. */}
    <div
      className="scene"
      ref={host}
      data-motion-policy={motionRenderPolicy(reducedMotion).redrawOn.join(" ")}
      data-orbit-damping={String(motionRenderPolicy(reducedMotion).enableDamping)}
      role="img"
      aria-label={
        brain
          ? "Interactive synthetic neural graph; values available in the neuron table"
          : `Original illustrated fly garden with flowers and a decorative Eidoverse teleport pod. Bridge phase: ${pod.detail}.`
      }
    >
      {failed && (
        <div className="scene-fallback">
          3D rendering unavailable. Neural values and controls remain available
          below.
        </div>
      )}
    </div>
    {!brain && state?.environmentAdapter?.attached && <section className="retinal-inspector" aria-label="Controller retina">
      <p>Engineered fixture control · dedicated 8×4 controller camera. Observer orbit does not supply pixels. No biological vision or learned movement claim.</p>
      {!controllerToken && <p>Observer only. This view has no controller lease; detach and explicitly attach here to control the camera.</p>}
      {frameError && <p role="alert">{frameError}</p>}
      {retinal ? <>
        <div role="img" aria-label="Latest accepted controller-camera RGB pixels, 8 columns and 4 rows" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 18px)', width: 144 }}>
          {Array.from({ length: 32 }, (_, i) => <span key={i} style={{ height: 18, background: `rgb(${retinal.rgb.slice(i * 3, i * 3 + 3).join(',')})` }} />)}
        </div>
        <p>Accepted frame {retinal.trace.frameId} · simulation {retinal.trace.inputSimTimeMs}→{retinal.trace.outputSimTimeMs} ms · forward {retinal.trace.motor.forward.toFixed(4)} units/s · yaw {retinal.trace.motor.yaw.toFixed(4)} rad/s</p>
        <details><summary>32 engineered luminance currents (maximum 0.02 each)</summary><p>{retinal.trace.retinalCurrents.map(v => v.toFixed(4)).join(', ')}</p></details>
      </> : <p>No accepted controller frame. Use Run fixture after explicitly attaching the camera.</p>}
    </section>}
    </>
  );
}
