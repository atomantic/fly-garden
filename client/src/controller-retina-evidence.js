import * as THREE from "three";
import { CONTROLLER_RETINA, compareControllerRasters } from "./controller-retina.js";
import { createGardenRasterSource, GARDEN_PREVIEW } from "./garden-raster-source.js";

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

/** A freely orbiting observer: its own camera, its own field of view, its own aspect. */
export function createObserverCamera() {
  return new THREE.PerspectiveCamera(40, GARDEN_PREVIEW.width / GARDEN_PREVIEW.height, 0.1, 60);
}

/** Places the observer for one named view. Nothing here is ever an input to a raster. */
export function aimObserverCamera(observer, view) {
  observer.position.set(...view.position);
  observer.lookAt(...view.look);
  observer.fov = view.fov;
  observer.updateProjectionMatrix();
  observer.updateMatrixWorld(true);
  return observer;
}

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
  const source = createGardenRasterSource(canvas);
  const observer = createObserverCamera();
  try {
    const baseline = source.raster(BASELINE_POSE);
    const observerChanges = OBSERVER_VIEWS.map(view => {
      source.renderObserver(aimObserverCamera(observer, view));
      return { ...view, ...compareControllerRasters(baseline, source.raster(BASELINE_POSE)) };
    });
    const poseChanges = POSE_CHANGES.map(change =>
      ({ ...change, ...compareControllerRasters(baseline, source.raster(change.pose)) }));
    const repeat = compareControllerRasters(baseline, source.raster(BASELINE_POSE));
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
    source.dispose();
  }
}
