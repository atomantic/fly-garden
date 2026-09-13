import { PerspectiveCamera } from 'three';
import { topDownRetinalRGB } from './retinal-frame.js';

/** Engineered single-fly controller optics. Not natural fly optics or a receptor model. */
export const CONTROLLER_RETINA = Object.freeze({ width: 8, height: 4, fovDegrees: 90, aspect: 2,
  near: 0.05, far: 30, eyeForward: 0.95, eyeHeight: 1.0, lookAhead: 3 });

export function createControllerCamera() {
  return new PerspectiveCamera(CONTROLLER_RETINA.fovDegrees, CONTROLLER_RETINA.aspect, CONTROLLER_RETINA.near, CONTROLLER_RETINA.far);
}

/**
 * Places the dedicated controller camera from the server-authoritative pose alone.
 * No observer camera, orbit control, pointer state or hidden target coordinate is an input
 * here or anywhere downstream; an invalid pose yields no camera movement and no raster.
 */
export function aimControllerCamera(camera, pose) {
  if (!camera?.isPerspectiveCamera || !pose || ![pose.x, pose.z, pose.yaw].every(Number.isFinite)) return false;
  const { eyeForward, eyeHeight, lookAhead } = CONTROLLER_RETINA;
  camera.position.set(pose.x + Math.sin(pose.yaw) * eyeForward, eyeHeight, pose.z + Math.cos(pose.yaw) * eyeForward);
  camera.lookAt(pose.x + Math.sin(pose.yaw) * lookAhead, eyeHeight, pose.z + Math.cos(pose.yaw) * lookAhead);
  camera.updateMatrixWorld(true);
  return true;
}

/**
 * Renders the controller camera alone into the offscreen 8×4 target and returns the
 * top-to-bottom RGB bytes. The illustrated body is hidden during the raster to avoid
 * self-occlusion and always restored, including on a renderer fault.
 */
export function readControllerRaster({ renderer, scene, camera, target, rgba, body = null }) {
  const { width, height } = CONTROLLER_RETINA;
  if (!renderer || !scene || !camera || !target || !(rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new Error('Invalid controller raster request');
  }
  if (body) body.visible = false;
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, rgba);
    return topDownRetinalRGB(rgba, width, height);
  } finally {
    renderer.setRenderTarget(null);
    if (body) body.visible = true;
  }
}

/** Aim from the authoritative pose, then read. Returns null when the pose is unusable. */
export function deriveControllerRaster({ pose, camera, ...rest }) {
  return aimControllerCamera(camera, pose) ? readControllerRaster({ camera, ...rest }) : null;
}

/** Exact integer-byte raster comparison; no tolerance widening. */
export function compareControllerRasters(before, after) {
  const channels = CONTROLLER_RETINA.width * CONTROLLER_RETINA.height * 3;
  if (![before, after].every(rgb => Array.isArray(rgb) && rgb.length === channels
    && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255))) throw new Error('Expected two exact 8×4 RGB rasters');
  return { channels, changedChannels: before.filter((v, i) => v !== after[i]).length,
    absoluteDifference: before.reduce((sum, v, i) => sum + Math.abs(v - after[i]), 0) };
}
