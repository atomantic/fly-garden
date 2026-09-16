import * as THREE from "three";
import { createGardenVisualWorld } from "./garden-visual-world.js";
import { CONTROLLER_RETINA, createControllerCamera, deriveControllerRaster } from "./controller-retina.js";

/** Preview-canvas settings shared by every GPU evidence harness, so two harnesses cannot
 * silently drift apart in renderer configuration and produce incomparable bytes. */
export const GARDEN_PREVIEW = Object.freeze({ width: 640, height: 360, clearColor: 0x112423, fogNear: 12, fogFar: 25 });

/**
 * One resident's production garden on the real graphics device: the `Scene.jsx` scene graph from
 * `garden-visual-world.js`, the production `WebGLRenderer`, the production controller camera and
 * the production 8×4 offscreen target.
 *
 * It runs no simulation, opens no socket, issues no app API call and starts nothing. `raster`
 * is aimed by the authoritative pose it is handed and by nothing else: no observer camera, orbit
 * state, pointer input or hidden target coordinate reaches it. Every render is recorded in
 * `calls` with the camera that drew it and whether the offscreen target was bound, so a harness
 * can show that observer renders never wrote to the sensory target rather than asserting it.
 */
export function createGardenRasterSource(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(GARDEN_PREVIEW.width, GARDEN_PREVIEW.height);
  renderer.setClearColor(GARDEN_PREVIEW.clearColor, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(GARDEN_PREVIEW.clearColor, GARDEN_PREVIEW.fogNear, GARDEN_PREVIEW.fogFar);
  const { body, flowerClusters } = createGardenVisualWorld(scene);
  const camera = createControllerCamera();
  const target = new THREE.WebGLRenderTarget(CONTROLLER_RETINA.width, CONTROLLER_RETINA.height,
    { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const rgba = new Uint8Array(CONTROLLER_RETINA.width * CONTROLLER_RETINA.height * 4);
  const calls = [];
  let bound = null;
  // The exact surface `readControllerRaster` uses, wrapped only to record what drew what.
  const audited = {
    setRenderTarget(next) { bound = next; renderer.setRenderTarget(next); },
    render(drawnScene, drawnCamera) {
      calls.push({ camera: drawnCamera === camera ? "controller" : "observer", offscreen: bound !== null });
      renderer.render(drawnScene, drawnCamera);
    },
    readRenderTargetPixels(...args) { return renderer.readRenderTargetPixels(...args); },
  };
  return {
    scene, body, camera, flowerClusters, calls,
    /** The 96 top-to-bottom RGB bytes the controller camera sees from this authoritative pose. */
    raster(pose) {
      const rgb = deriveControllerRaster({ pose, camera, renderer: audited, scene, target, rgba, body });
      if (!rgb) throw new Error("Unusable controller pose");
      return rgb;
    },
    /** Draws the freely movable observer to the visible canvas; never to the sensory target. */
    renderObserver(observer) {
      audited.setRenderTarget(null);
      audited.render(scene, observer);
    },
    /** Reversible presentation change to one named landmark. Reserves and spends nothing. */
    setClusterVisible(index, visible) {
      const cluster = flowerClusters[index];
      if (!cluster) throw new Error(`No flower cluster ${index}`);
      for (const mesh of cluster.meshes) mesh.visible = visible;
      return { index, x: cluster.x, z: cluster.z, meshes: cluster.meshes.length, visible };
    },
    dispose() {
      target.dispose();
      scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      });
      renderer.dispose();
    },
  };
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
