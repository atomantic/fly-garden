import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { createGardenVisualWorld, GARDEN_DEFAULT_BODY } from '../client/src/garden-visual-world.js';

/**
 * The single-fly garden scene graph was extracted out of `Scene.jsx` so a browser evidence harness
 * can raster the production geometry rather than a stand-in fixture. These are structural guards on
 * that extraction: they build the world with no WebGL context and check its composition, the
 * illustrated body's resting placement and the pod ring geometry the phase tone is written onto.
 * They assert nothing about rendered pixels, which needs a real browser, and nothing about neural
 * state, behaviour or learning.
 */
test('the extracted garden world builds the production landmark scene and returns the illustrated body', () => {
  const scene = new Scene();
  const { body, podRings } = createGardenVisualWorld(scene);

  let meshes = 0, lights = 0;
  scene.traverse(object => { if (object.isMesh) meshes++; if (object.isLight) lights++; });
  assert.equal(meshes, 131);
  assert.equal(lights, 2); // one hemisphere and one directional light, as Scene.jsx added inline.

  let bodyMeshes = 0, vertices = 0;
  body.traverse(object => {
    if (object.isMesh) bodyMeshes++;
    vertices += object.geometry?.attributes?.position?.count ?? 0;
  });
  assert.equal(bodyMeshes, 34);
  assert.equal(vertices, 6350);
  assert.equal(body.parent, scene);
  // The resting placement the renderer restores whenever no authoritative controller pose applies.
  assert.deepEqual(body.position.toArray(), [GARDEN_DEFAULT_BODY.x, GARDEN_DEFAULT_BODY.y, GARDEN_DEFAULT_BODY.z]);
  assert.equal(body.rotation.y, GARDEN_DEFAULT_BODY.rotationY);
});

test('every flower is returned as its own cluster of meshes covering the whole flower population', () => {
  const scene = new Scene();
  const { flowerClusters } = createGardenVisualWorld(scene);
  // Eleven of the thirteen candidate positions survive the arrival-pod exclusion, each a stem,
  // a leaf, five petals and a centre.
  assert.equal(flowerClusters.length, 11);
  const meshes = flowerClusters.flatMap(cluster => cluster.meshes);
  assert.equal(meshes.length, 88);
  assert.equal(new Set(meshes).size, 88);
  for (const { x, z, meshes: cluster } of flowerClusters) {
    assert.equal(cluster.length, 8);
    assert.ok(cluster.every(mesh => mesh.isMesh && mesh.parent === scene && mesh.visible));
    // The cluster is grouped around its own stem position, not scattered across the garden.
    assert.ok(cluster.every(mesh => Math.hypot(mesh.position.x - x, mesh.position.z - z) < 0.3));
    // Excluded from the arrival-pod sanctuary corner, as the builder's own filter requires.
    assert.equal(x > 1 && z < -0.6, false);
  }
});

test('the pod rings keep their resting heights and opposed bob directions', () => {
  const { podRings } = createGardenVisualWorld(new Scene());
  assert.equal(podRings.length, 2);
  assert.deepEqual(podRings.map(entry => entry.baseY), [0.15, 2.25]);
  assert.deepEqual(podRings.map(entry => entry.direction), [1, -1]);
  for (const { ring, baseY } of podRings) {
    assert.equal(ring.position.y, baseY);
    // The phase tone is written to this emissive colour on every draw, motion or not.
    assert.ok(ring.material.emissive);
  }
});

test('the builder refuses anything that is not a scene instead of constructing a partial world', () => {
  for (const value of [null, undefined, {}, { isScene: false }, []]) {
    assert.throws(() => createGardenVisualWorld(value), /Expected a Three.js scene/);
  }
});
