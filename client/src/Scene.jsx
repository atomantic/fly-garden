import { useEffect, useRef, useState } from "react";
import { environmentKey, topDownRetinalRGB } from "./retinal-frame.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Original procedural art. Coordinates are illustrative, not anatomical data.
export default function Scene({ neural, brain = false, state = null, controllerToken = null, onEnvironmentFrame = () => {} }) {
  const host = useRef(null);
  const live = useRef(neural);
  const source = useRef({ state, controllerToken, onEnvironmentFrame, observedAt: performance.now() });
  const [retinal, setRetinal] = useState(null);
  const [frameError, setFrameError] = useState('');
  useEffect(() => { source.current = { state, controllerToken, onEnvironmentFrame, observedAt: performance.now() }; }, [state]);
  useEffect(() => { source.current.controllerToken = controllerToken; }, [controllerToken]);
  useEffect(() => { source.current.onEnvironmentFrame = onEnvironmentFrame; }, [onEnvironmentFrame]);
  const [failed, setFailed] = useState(false);
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
    controls.enableDamping = true;
    controls.minDistance = 3;
    controls.maxDistance = 15;
    controls.maxPolarAngle = Math.PI / 2.05;
    scene.add(new THREE.HemisphereLight(0xeaffdc, 0x214d48, 3));
    const light = new THREE.DirectionalLight(0xffe7af, 4);
    light.position.set(3, 8, 5);
    scene.add(light);
    const material = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
    const mesh = (
      geometry,
      mat,
      parent = scene,
      pos = [0, 0, 0],
      scale = [1, 1, 1],
    ) => {
      const object = new THREE.Mesh(geometry, mat);
      object.position.set(...pos);
      object.scale.set(...scale);
      parent.add(object);
      return object;
    };
    const sphere = (mat, parent, pos, scale) =>
      mesh(new THREE.SphereGeometry(1, 24, 16), mat, parent, pos, scale);
    const line = (a, b, mat, parent = scene, radius = 0.024) => {
      const start = new THREE.Vector3(...a),
        end = new THREE.Vector3(...b);
      const o = mesh(
        new THREE.CylinderGeometry(radius, radius, start.distanceTo(end), 8),
        mat,
        parent,
      );
      o.position.copy(start.add(end).multiplyScalar(0.5));
      o.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        end.sub(new THREE.Vector3(...a)).normalize(),
      );
      return o;
    };
    let points, pointIds, body;
    const controllerCamera = new THREE.PerspectiveCamera(90, 2, 0.05, 30);
    const retinalTarget = new THREE.WebGLRenderTarget(8, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    retinalTarget.texture.colorSpace = THREE.SRGBColorSpace;
    const rgba = new Uint8Array(8 * 4 * 4);
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
      controllerCamera.position.set(pose.x + Math.sin(pose.yaw) * 0.95, 1.0, pose.z + Math.cos(pose.yaw) * 0.95);
      controllerCamera.lookAt(pose.x + Math.sin(pose.yaw) * 3, 1.0, pose.z + Math.cos(pose.yaw) * 3);
      inFlight = true; requestController = new AbortController();
      const timeout = setTimeout(() => requestController?.abort(), 1000);
      try {
        // Only original garden geometry enters the offscreen controller camera. Never sample desktop or observer camera.
        if (body) body.visible = false;
        renderer.setRenderTarget(retinalTarget); renderer.render(scene, controllerCamera);
        renderer.readRenderTargetPixels(retinalTarget, 0, 0, 8, 4, rgba);
        renderer.setRenderTarget(null); if (body) body.visible = true;
        const rgb = topDownRetinalRGB(rgba);
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
      mesh(
        new THREE.CylinderGeometry(4.8, 5, 0.28, 80),
        material(0x2d4940),
        scene,
        [0, -0.25, 0],
      );
      mesh(
        new THREE.CylinderGeometry(4.7, 4.7, 0.04, 80),
        material(0x526249),
        scene,
        [0, -0.08, 0],
      );
      const grid = new THREE.GridHelper(18, 36, 0x36534a, 0x1e3832);
      grid.position.y = -0.42;
      scene.add(grid);
      // Raised sanctuary ring and a visible, inactive arrival pod.
      mesh(
        new THREE.CylinderGeometry(1.05, 1.15, 0.16, 48),
        material(0x213e38),
        scene,
        [2.2, 0.02, -1.7],
      );
      for (const y of [0.15, 2.25]) {
        const ring = mesh(
          new THREE.TorusGeometry(0.9, 0.035, 10, 64),
          material(0x8fc5ad, { emissive: 0x35665a }),
          scene,
          [2.2, y, -1.7],
        );
        ring.rotation.x = Math.PI / 2;
      }
      for (const a of [0, Math.PI * 0.66, Math.PI * 1.33])
        line(
          [2.2 + 0.9 * Math.cos(a), 0.15, -1.7 + 0.9 * Math.sin(a)],
          [2.2 + 0.9 * Math.cos(a), 2.25, -1.7 + 0.9 * Math.sin(a)],
          material(0x668f7b),
        );
      const glass = mesh(
        new THREE.CylinderGeometry(0.88, 0.88, 2.05, 48, 1, true),
        material(0x81ccac, {
          transparent: true,
          opacity: 0.065,
          side: THREE.DoubleSide,
        }),
        scene,
        [2.2, 1.2, -1.7],
      );
      glass.renderOrder = 1;
      const stem = material(0x567143),
        petal = material(0xf4d78f),
        center = material(0xc28e46);
      for (let i = 0; i < 13; i++) {
        const a = i * 2.4,
          r = 2.4 + (i % 3) * 0.5,
          x = Math.cos(a) * r,
          z = Math.sin(a) * r;
        if (x > 1 && z < -0.6) continue;
        const h = 0.6 + (i % 4) * 0.13;
        line([x, 0, z], [x, h, z], stem, scene, 0.025);
        sphere(stem, scene, [x + 0.13, h * 0.4, z], [0.27, 0.035, 0.11]);
        for (let j = 0; j < 5; j++)
          sphere(
            petal,
            scene,
            [x + 0.18 * Math.cos(j * 1.256), h, z + 0.18 * Math.sin(j * 1.256)],
            [0.18, 0.06, 0.12],
          );
        sphere(center, scene, [x, h + 0.03, z], [0.11, 0.07, 0.11]);
      }
      const fly = new THREE.Group();
      body = fly;
      fly.position.set(-0.55, 0.67, 0.65);
      fly.rotation.y = -0.3;
      scene.add(fly);
      const chitin = material(0x52623d),
        gold = material(0xa79c61),
        dark = material(0x29382b),
        eye = material(0xb75538, { roughness: 0.34 });
      sphere(gold, fly, [0, 0, 0.65], [0.42, 0.34, 0.75]);
      for (let i = 0; i < 5; i++) {
        const o = mesh(
          new THREE.TorusGeometry(0.33 - i * 0.025, 0.027, 8, 32),
          dark,
          fly,
          [0, 0, 0.4 + i * 0.2],
        );
        o.scale.y = 0.85;
      }
      sphere(chitin, fly, [0, 0.1, 0], [0.44, 0.43, 0.52]);
      sphere(gold, fly, [0, 0.12, -0.57], [0.36, 0.3, 0.29]);
      for (const side of [-1, 1]) {
        sphere(eye, fly, [side * 0.27, 0.18, -0.68], [0.19, 0.25, 0.18]);
        const wing = sphere(
          material(0xd7edda, {
            transparent: true,
            opacity: 0.6,
            metalness: 0.15,
          }),
          fly,
          [side * 0.57, 0.43, 0.58],
          [0.35, 0.022, 0.9],
        );
        wing.rotation.y = side * 0.32;
        for (let k = 0; k < 3; k++)
          line(
            [side * 0.2, 0.46, 0.1],
            [side * (0.55 + k * 0.13), 0.46, 1.2],
            gold,
            fly,
            0.006,
          );
        for (let i = 0; i < 3; i++) {
          const z = -0.35 + i * 0.4;
          line(
            [side * 0.3, 0, z],
            [side * 0.78, -0.12, z - 0.13],
            dark,
            fly,
            0.028,
          );
          line(
            [side * 0.78, -0.12, z - 0.13],
            [side * 1.0, -0.62, z - 0.32],
            gold,
            fly,
            0.022,
          );
        }
        line(
          [side * 0.1, 0.23, -0.76],
          [side * 0.23, 0.4, -1],
          dark,
          fly,
          0.017,
        );
        sphere(dark, fly, [side * 0.23, 0.4, -1], [0.045, 0.045, 0.045]);
      }
    }
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    let frame;
    const render = () => {
      frame = requestAnimationFrame(render);
      controls.update();
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
      else if (body) { body.position.set(-0.55, 0.67, 0.65); body.rotation.y = -0.3; }
      renderer.render(scene, camera);
      void sendRetina();
    };
    render();
    return () => {
      stopped = true; requestController?.abort();
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
  }, [brain, neural?.neurons?.length]);
  return (
    <>
    <div
      className="scene"
      ref={host}
      role="img"
      aria-label={
        brain
          ? "Interactive synthetic neural graph; values available in the neuron table"
          : "Original illustrated fly garden with flowers and an inactive Eidoverse teleport pod"
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
