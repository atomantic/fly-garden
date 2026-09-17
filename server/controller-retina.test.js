import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { CONTROLLER_RETINA, aimControllerCamera, compareControllerRasters, createControllerCamera,
  deriveControllerRaster, readControllerRaster } from '../client/src/controller-retina.js';
import { createProjectionRenderer } from './projection-renderer.js';

const { width, height } = CONTROLLER_RETINA;

/** Original neutral landmarks plus the illustrated body; no hidden goal markers. */
function gardenFixture() {
  const scene = new Scene();
  const add = (color, position) => {
    const mesh = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshStandardMaterial({ color }));
    mesh.position.set(...position); scene.add(mesh); return mesh;
  };
  for (let i = 0; i < 13; i++) {
    const angle = i * 2.4, radius = 2.4 + (i % 3) * 0.5;
    add(0xf4d78f + i * 0x000501, [Math.cos(angle) * radius, 0.6 + (i % 4) * 0.13, Math.sin(angle) * radius]);
  }
  for (const z of [-1.4, 1.4]) add(0x8fc5ad, [0, 1.0, z]);
  const body = add(0xa79c61, [0, 0.67, 0]);
  return { scene, body };
}

function harness() {
  const { scene, body } = gardenFixture();
  const renderer = createProjectionRenderer();
  const camera = createControllerCamera();
  const target = { isRenderTarget: true };
  const rgba = new Uint8Array(width * height * 4);
  const raster = pose => deriveControllerRaster({ pose, camera, renderer, scene, target, rgba, body });
  return { scene, body, renderer, camera, target, rgba, raster };
}

test('observer camera manipulation changes zero controller channels while the authoritative pose changes them', () => {
  const { scene, renderer, camera, raster } = harness();
  const pose = { x: 0, z: -1, yaw: 0 };
  const baseline = raster(pose);
  assert.equal(baseline.length, width * height * 3);

  // A freely orbiting observer with its own camera, controls target, field of view and aspect.
  const observer = new PerspectiveCamera(40, 1, 0.1, 60);
  const views = [[[6.5, 5.4, 8], [0, 0.6, 0], 40], [[-5, 2, -4], [0, 0.6, 0], 40],
    [[0, 12, 0.01], [0, 0, 0], 25], [[1.2, 0.8, 1.2], [2.2, 0.3, -1.7], 70]];
  const observerComparisons = views.map(([position, look, fov]) => {
    observer.position.set(...position); observer.lookAt(...look); observer.fov = fov;
    observer.updateProjectionMatrix(); observer.updateMatrixWorld(true);
    renderer.setRenderTarget(null); renderer.render(scene, observer);
    return compareControllerRasters(baseline, raster(pose));
  });
  for (const comparison of observerComparisons) {
    assert.equal(comparison.changedChannels, 0);
    assert.equal(comparison.absoluteDifference, 0);
  }

  // The same derivation is not merely insensitive: the authoritative pose does drive it.
  const translated = compareControllerRasters(baseline, raster({ x: 1.1, z: -1, yaw: 0 }));
  const rotated = compareControllerRasters(baseline, raster({ x: 0, z: -1, yaw: Math.PI / 2 }));
  const reversed = compareControllerRasters(baseline, raster({ x: 0, z: -1, yaw: Math.PI }));
  for (const comparison of [translated, rotated, reversed]) assert.ok(comparison.changedChannels > 0);

  // Recorded in docs/ENVIRONMENT_ADAPTER.md. Exact byte equality, no tolerance widening.
  assert.deepEqual([translated, rotated, reversed].map(c => c.changedChannels), [27, 18, 17]);
  assert.deepEqual([translated, rotated, reversed].map(c => c.absoluteDifference), [3055, 2114, 1687]);
  assert.deepEqual(compareControllerRasters(baseline, raster(pose)),
    { channels: 96, changedChannels: 0, absoluteDifference: 0 });

  // Every raster render used the controller camera and the offscreen target, never the observer.
  const rasterRenders = renderer.calls.filter(call => call.camera === camera);
  assert.equal(rasterRenders.length, renderer.calls.length - views.length);
  assert.ok(rasterRenders.every(call => call.target !== null));
  assert.equal(renderer.calls.some(call => call.camera === observer && call.target !== null), false);
});

test('controller aiming reads only the pose and rejects an unusable one without moving the camera', () => {
  const { camera, raster } = harness();
  assert.ok(aimControllerCamera(camera, { x: 0.5, z: -0.25, yaw: 0.4 }));
  const placed = camera.position.clone(), oriented = camera.quaternion.clone();
  for (const pose of [null, undefined, {}, { x: 0, z: 0 }, { x: NaN, z: 0, yaw: 0 },
    { x: 0, z: Infinity, yaw: 0 }, { x: 0, z: 0, yaw: '0' }]) {
    assert.equal(aimControllerCamera(camera, pose), false);
    assert.equal(raster(pose), null);
    assert.deepEqual(camera.position.toArray(), placed.toArray());
    assert.deepEqual(camera.quaternion.toArray(), oriented.toArray());
  }
  // Placement is a pure function of the pose: yaw zero looks toward +z from 0.95 units ahead.
  aimControllerCamera(camera, { x: 0, z: 0, yaw: 0 });
  assert.deepEqual(camera.position.toArray().map(v => Number(v.toFixed(6))), [0, 1, 0.95]);
  assert.ok(new Vector3(0, 0, 1).applyQuaternion(camera.quaternion).z < -0.999);
});

test('the illustrated body is hidden only for the raster and restored even when rendering faults', () => {
  const { body, renderer, camera, scene, target, rgba } = harness();
  const request = { renderer, scene, camera, target, rgba, body };
  aimControllerCamera(camera, { x: 0, z: -1, yaw: 0 });
  assert.ok(readControllerRaster(request));
  assert.equal(body.visible, true);
  assert.equal(renderer.boundTarget(), null);
  renderer.failNextRender(new Error('context lost'));
  assert.throws(() => readControllerRaster(request), /context lost/);
  assert.equal(body.visible, true);
  assert.equal(renderer.boundTarget(), null);
});

test('lost graphics contexts cannot return retained raster bytes before, during or after rendering', () => {
  for (const phase of ['before', 'render', 'readback']) {
    const { renderer, scene, camera, target, rgba, body } = harness();
    const request = { renderer, scene, camera, target, rgba, body };
    aimControllerCamera(camera, { x: 0, z: -1, yaw: 0 });
    const baseline = readControllerRaster(request);
    const retained = rgba.slice();
    let lost = phase === 'before', renders = 0, reads = 0;
    const render = renderer.render.bind(renderer);
    const read = renderer.readRenderTargetPixels.bind(renderer);
    renderer.getContext = () => ({ isContextLost: () => lost });
    renderer.render = (...args) => {
      renders++;
      if (phase === 'render') lost = true;
      if (!lost) render(...args);
    };
    renderer.readRenderTargetPixels = (...args) => {
      reads++;
      if (phase === 'readback') lost = true;
      if (!lost) read(...args);
    };
    assert.throws(() => readControllerRaster(request), /Controller graphics context lost/, phase);
    assert.equal(renders, phase === 'before' ? 0 : 1);
    assert.equal(reads, phase === 'readback' ? 1 : 0);
    assert.deepEqual(rgba, retained);
    assert.equal(body.visible, true);
    assert.equal(renderer.boundTarget(), null);
    renderer.render = render;
    renderer.readRenderTargetPixels = read;
    lost = false;
    assert.deepEqual(readControllerRaster(request), baseline);
  }
});

test('raster and comparison helpers refuse malformed buffers instead of padding a sensory frame', () => {
  const { renderer, scene, camera, target } = harness();
  for (const rgba of [null, new Uint8Array(127), new Uint8Array(129), new Array(128).fill(0)]) {
    assert.throws(() => readControllerRaster({ renderer, scene, camera, target, rgba }), /Invalid controller raster request/);
  }
  const valid = Array(96).fill(0);
  for (const bad of [Array(95).fill(0), Array(96).fill(256), Array(96).fill(-1), Array(96).fill(1.5), null]) {
    assert.throws(() => compareControllerRasters(valid, bad), /exact 8×4 RGB rasters/);
    assert.throws(() => compareControllerRasters(bad, valid), /exact 8×4 RGB rasters/);
  }
});
