import * as THREE from "three";
import { createGardenRasterSource, describeRenderer } from "./garden-raster-source.js";
import { OBSERVER_VIEWS, aimObserverCamera, createObserverCamera } from "./controller-retina-evidence.js";

export const SCENE_CHANGE_DISCLOSURE = "Production single-fly garden scene graph rastered through the production WebGL controller camera on a real graphics device. The 32-neuron fixture, the engineered luminance encoding and the declared motor readout all run in the driving Node process, not here. Engineered fixture optics and an engineered controller; no biological vision, natural locomotion, learning or inferred mental state is established.";

/**
 * Browser half of the GPU scene-change recording: a named set of independent production gardens
 * that a driving process can raster, orbit an observer over, and reversibly change one landmark in.
 *
 * It owns no neural model, clock, timer, socket or app API call, and it never starts anything.
 * Every raster is aimed by an authoritative pose the driver hands in; nothing here derives a pose,
 * and no observer state, pointer input or hidden target coordinate is an input to any raster.
 * `scripts/gpu-scene-change-causality.mjs` closes the loop around it.
 */
export function createSceneChangeRasterHost(createCanvas) {
  if (typeof createCanvas !== "function") throw new Error("Expected a canvas factory");
  const sources = new Map();
  const observer = createObserverCamera();
  const need = name => {
    const source = sources.get(name);
    if (!source) throw new Error(`No open garden named "${name}"`);
    return source;
  };
  return {
    /** Renderer provenance for the recorded artifact. Creates no garden and renders no frame. */
    describe() {
      return { threeRevision: THREE.REVISION, device: describeRenderer(createCanvas()), disclosure: SCENE_CHANGE_DISCLOSURE };
    },
    /** One independent garden with a fixed set of named flower clusters hidden, possibly none. */
    open(name, { occludeClusters = [] } = {}) {
      if (sources.has(name)) throw new Error(`Garden "${name}" is already open`);
      if (!Array.isArray(occludeClusters)) throw new Error("Expected an array of flower cluster indices");
      const source = createGardenRasterSource(createCanvas(name));
      sources.set(name, source);
      return {
        name,
        flowerClusters: source.flowerClusters.length,
        occluded: occludeClusters.map(index => source.setClusterVisible(index, false)),
      };
    },
    raster(name, pose) { return need(name).raster(pose); },
    /** Draws one of the fixed observer views to the visible canvas. Never to the sensory target. */
    observe(name, viewIndex) {
      const view = OBSERVER_VIEWS[viewIndex];
      if (!view) throw new Error(`No observer view ${viewIndex}`);
      need(name).renderObserver(aimObserverCamera(observer, view));
      return view.name;
    },
    setClusterVisible(name, index, visible) { return need(name).setClusterVisible(index, visible); },
    /** What actually drew, and whether the offscreen sensory target was bound while it did. */
    renderAudit(name) {
      const calls = need(name).calls;
      const count = (camera, offscreen) => calls.filter(call => call.camera === camera && call.offscreen === offscreen).length;
      return {
        controllerToOffscreen: count("controller", true), controllerToCanvas: count("controller", false),
        observerToOffscreen: count("observer", true), observerToCanvas: count("observer", false),
      };
    },
    close(name) { need(name).dispose(); sources.delete(name); },
    closeAll() { for (const source of sources.values()) source.dispose(); sources.clear(); },
  };
}
