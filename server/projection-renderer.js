import { Matrix4, Vector3 } from 'three';
import { CONTROLLER_RETINA } from '../client/src/controller-retina.js';

/**
 * Deterministic CPU projection stand-in for the WebGL path, shared by the automated checks that
 * need a rasterizer under `node --test`, which has no WebGL context.
 *
 * It is NOT the production rasterizer and produces different bytes than a GPU would: it splats
 * each mesh origin through the supplied camera's own matrices, nearest-depth wins, with no
 * lights, materials beyond flat colour, fog or transparency. What it does reproduce exactly is
 * the contract under test — pixels are a function of the camera handed to `render`, of the scene
 * graph's contents and visibility, and of nothing else. Rows are written bottom-origin, matching
 * `WebGLRenderer.readRenderTargetPixels`, so `readControllerRaster` flips them as it does in the
 * browser. Absolute bytes recorded through it are observations of this stand-in, never golden
 * values for real graphics hardware; `docs/ENVIRONMENT_ADAPTER.md` records the GPU counterpart.
 */
export function createProjectionRenderer(background = [17, 36, 35]) {
  const { width, height } = CONTROLLER_RETINA;
  const pixels = new Uint8Array(width * height * 4);
  const calls = [];
  let bound = null, fault = null;
  const visible = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  return {
    calls,
    failNextRender(error) { fault = error; },
    boundTarget: () => bound,
    setRenderTarget(target) { bound = target; },
    render(scene, camera) {
      calls.push({ camera, target: bound });
      if (fault) { const error = fault; fault = null; throw error; }
      const depth = new Float64Array(width * height).fill(Infinity);
      for (let i = 0; i < width * height; i++) pixels.set([...background, 255], i * 4);
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
      const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      scene.traverse(object => {
        if (!object.isMesh || !visible(object)) return;
        const world = new Vector3().setFromMatrixPosition(object.matrixWorld);
        const distance = world.distanceTo(camera.position);
        if (distance <= camera.near || distance >= camera.far) return;
        const ndc = world.clone().applyMatrix4(viewProjection);
        if (![ndc.x, ndc.y, ndc.z].every(v => Number.isFinite(v) && Math.abs(v) <= 1)) return;
        const x = Math.min(width - 1, Math.floor((ndc.x * 0.5 + 0.5) * width));
        const y = Math.min(height - 1, Math.floor((ndc.y * 0.5 + 0.5) * height));
        const index = y * width + x;
        if (distance >= depth[index]) return;
        depth[index] = distance;
        const { r, g, b } = object.material.color;
        pixels.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], index * 4);
      });
    },
    readRenderTargetPixels(target, x, y, w, h, out) {
      if (target !== bound) throw new Error('Read a render target that is not bound.');
      if (x !== 0 || y !== 0 || w !== width || h !== height) throw new Error('Read an unexpected retinal region.');
      out.set(pixels);
    },
  };
}
