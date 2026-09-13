import * as THREE from "three";
import { createGardenVisualWorld } from "./garden-visual-world.js";
import { CONTROLLER_RETINA, compareControllerRasters, createControllerCamera, deriveControllerRaster } from "./controller-retina.js";

/** The exact observer manipulations `server/controller-retina.test.js` performs against its
 * deterministic CPU projection stand-in, so the GPU run is comparable line for line. */
export const OBSERVER_VIEWS = Object.freeze([
  { name: "orbit-high", position: [6.5, 5.4, 8], look: [0, 0.6, 0], fov: 40 },
  { name: "orbit-opposite", position: [-5, 2, -4], look: [0, 0.6, 0], fov: 40 },
  { name: "top-down-fov-25", position: [0, 12, 0.01], look: [0, 0, 0], fov: 25 },
  { name: "close-pod-fov-70", position: [1.2, 0.8, 1.2], look: [2.2, 0.3, -1.7], fov: 70 },
]);

export const BASELINE_POSE = Object.freeze({ x: 0, z: -1, yaw: 0 });
export const POSE_CHANGES = Object.freeze([
  { name: "translate-x-1.1", pose: { x: 1.1, z: -1, yaw: 0 } },
  { name: "yaw-half-pi", pose: { x: 0, z: -1, yaw: Math.PI / 2 } },
  { name: "yaw-pi", pose: { x: 0, z: -1, yaw: Math.PI } },
]);

/**
 * Byte-level GPU measurement of single-fly controller-retina observer isolation.
 *
 * This renders the real `Scene.jsx` garden scene graph through the production
 * `WebGLRenderer`, the production controller camera and the production 8×4 offscreen target.
 * It runs no simulation, opens no socket, issues no app API call and starts nothing. It only
 * asks whether observer-camera manipulation changes the controller raster bytes, and whether
 * the authoritative pose does. A zero result on the pose changes would be a real negative
 * result and must be recorded as one, not retuned.
 */
export function measureControllerRetinaGpuEvidence(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 360);
  renderer.setClearColor(0x112423, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x112423, 12, 25);
  const { body } = createGardenVisualWorld(scene);
  const camera = createControllerCamera();
  const target = new THREE.WebGLRenderTarget(CONTROLLER_RETINA.width, CONTROLLER_RETINA.height,
    { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const rgba = new Uint8Array(CONTROLLER_RETINA.width * CONTROLLER_RETINA.height * 4);
  const raster = pose => {
    const rgb = deriveControllerRaster({ pose, camera, renderer, scene, target, rgba, body });
    if (!rgb) throw new Error("Unusable controller pose");
    return rgb;
  };
  // The freely orbiting observer is a different camera with its own field of view and aspect.
  const observer = new THREE.PerspectiveCamera(40, 640 / 360, 0.1, 60);
  try {
    const baseline = raster(BASELINE_POSE);
    const observerChanges = OBSERVER_VIEWS.map(view => {
      observer.position.set(...view.position);
      observer.lookAt(...view.look);
      observer.fov = view.fov;
      observer.updateProjectionMatrix();
      observer.updateMatrixWorld(true);
      renderer.setRenderTarget(null);
      renderer.render(scene, observer);
      return { ...view, ...compareControllerRasters(baseline, raster(BASELINE_POSE)) };
    });
    const poseChanges = POSE_CHANGES.map(change =>
      ({ ...change, ...compareControllerRasters(baseline, raster(change.pose)) }));
    const repeat = compareControllerRasters(baseline, raster(BASELINE_POSE));
    const passed = observerChanges.every(c => c.changedChannels === 0 && c.absoluteDifference === 0)
      && repeat.changedChannels === 0 && poseChanges.every(c => c.changedChannels > 0);
    return {
      version: 1,
      kind: "controller-retina-gpu-evidence",
      threeRevision: THREE.REVISION,
      width: CONTROLLER_RETINA.width, height: CONTROLLER_RETINA.height, channels: 3,
      baselinePose: BASELINE_POSE,
      baselineRaster: baseline,
      observerChanges, poseChanges, repeat, passed,
      disclosure: "Production single-fly garden scene graph rastered through the production WebGL controller camera. Engineered fixture optics, one scene and pose pair, no simulation, no biological vision, behaviour or learning established.",
    };
  } finally {
    target.dispose();
    scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
    renderer.dispose();
  }
}

/** Reports the live WebGL renderer string so every published number states its hardware. */
export function describeRenderer(canvas) {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) return { available: false, renderer: null, vendor: null, version: null };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    available: true,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
  };
}
