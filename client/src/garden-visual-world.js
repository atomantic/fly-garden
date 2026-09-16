import * as THREE from "three";

/**
 * The single-fly garden scene graph used by `Scene.jsx`, extracted verbatim so that
 * evidence harnesses can raster the production geometry instead of a stand-in fixture.
 * This mirrors what `shared-visual-world.js` already does for `SharedScene.jsx`.
 *
 * Original procedural art. Coordinates are illustrative, not anatomical data, and nothing
 * here reads a runtime, checkpoint, registry, worker or network response. Lights are added
 * by the caller in `Scene.jsx`; this builder adds them too so an isolated harness renders
 * exactly the same illuminated scene.
 */
export function createGardenVisualWorld(scene) {
  if (!scene?.isScene) throw new Error("Expected a Three.js scene");
  scene.add(new THREE.HemisphereLight(0xeaffdc, 0x214d48, 3));
  const light = new THREE.DirectionalLight(0xffe7af, 4);
  light.position.set(3, 8, 5);
  scene.add(light);

  const podRings = [];
  const material = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...extra });
  const mesh = (geometry, mat, parent = scene, pos = [0, 0, 0], scale = [1, 1, 1]) => {
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

  mesh(new THREE.CylinderGeometry(4.8, 5, 0.28, 80), material(0x2d4940), scene, [0, -0.25, 0]);
  mesh(new THREE.CylinderGeometry(4.7, 4.7, 0.04, 80), material(0x526249), scene, [0, -0.08, 0]);
  const grid = new THREE.GridHelper(18, 36, 0x36534a, 0x1e3832);
  grid.position.y = -0.42;
  scene.add(grid);
  // Raised sanctuary ring and a visible arrival pod. Ring tone and the only pod motion
  // are driven from the bridge phase by the caller; motion is withheld until host acknowledgment.
  mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.16, 48), material(0x213e38), scene, [2.2, 0.02, -1.7]);
  for (const y of [0.15, 2.25]) {
    const ring = mesh(
      new THREE.TorusGeometry(0.9, 0.035, 10, 64),
      material(0x8fc5ad, { emissive: 0x1f3c36 }),
      scene,
      [2.2, y, -1.7],
    );
    ring.rotation.x = Math.PI / 2;
    podRings.push({ ring, baseY: y, direction: y > 1 ? -1 : 1 });
  }
  for (const a of [0, Math.PI * 0.66, Math.PI * 1.33])
    line(
      [2.2 + 0.9 * Math.cos(a), 0.15, -1.7 + 0.9 * Math.sin(a)],
      [2.2 + 0.9 * Math.cos(a), 2.25, -1.7 + 0.9 * Math.sin(a)],
      material(0x668f7b),
    );
  const glass = mesh(
    new THREE.CylinderGeometry(0.88, 0.88, 2.05, 48, 1, true),
    material(0x81ccac, { transparent: true, opacity: 0.065, side: THREE.DoubleSide }),
    scene,
    [2.2, 1.2, -1.7],
  );
  glass.renderOrder = 1;
  const stem = material(0x567143),
    petal = material(0xf4d78f),
    center = material(0xc28e46);
  // Each flower's own meshes are kept together so an evidence harness can change one
  // landmark's appearance and record what that scene change does downstream. This is
  // presentation bookkeeping only; nothing here reads or writes runtime or policy state,
  // and the optional appetitive encounter policy is a separate server-side channel.
  const flowerClusters = [];
  for (let i = 0; i < 13; i++) {
    const a = i * 2.4,
      r = 2.4 + (i % 3) * 0.5,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (x > 1 && z < -0.6) continue;
    const h = 0.6 + (i % 4) * 0.13;
    const meshes = [
      line([x, 0, z], [x, h, z], stem, scene, 0.025),
      sphere(stem, scene, [x + 0.13, h * 0.4, z], [0.27, 0.035, 0.11]),
      ...Array.from({ length: 5 }, (_, j) =>
        sphere(
          petal,
          scene,
          [x + 0.18 * Math.cos(j * 1.256), h, z + 0.18 * Math.sin(j * 1.256)],
          [0.18, 0.06, 0.12],
        ),
      ),
      sphere(center, scene, [x, h + 0.03, z], [0.11, 0.07, 0.11]),
    ];
    flowerClusters.push({ x, z, meshes });
  }
  const fly = new THREE.Group();
  fly.position.set(-0.55, 0.67, 0.65);
  fly.rotation.y = -0.3;
  scene.add(fly);
  const chitin = material(0x52623d),
    gold = material(0xa79c61),
    dark = material(0x29382b),
    eye = material(0xb75538, { roughness: 0.34 });
  sphere(gold, fly, [0, 0, 0.65], [0.42, 0.34, 0.75]);
  for (let i = 0; i < 5; i++) {
    const o = mesh(new THREE.TorusGeometry(0.33 - i * 0.025, 0.027, 8, 32), dark, fly, [0, 0, 0.4 + i * 0.2]);
    o.scale.y = 0.85;
  }
  sphere(chitin, fly, [0, 0.1, 0], [0.44, 0.43, 0.52]);
  sphere(gold, fly, [0, 0.12, -0.57], [0.36, 0.3, 0.29]);
  for (const side of [-1, 1]) {
    sphere(eye, fly, [side * 0.27, 0.18, -0.68], [0.19, 0.25, 0.18]);
    const wing = sphere(
      material(0xd7edda, { transparent: true, opacity: 0.6, metalness: 0.15 }),
      fly,
      [side * 0.57, 0.43, 0.58],
      [0.35, 0.022, 0.9],
    );
    wing.rotation.y = side * 0.32;
    for (let k = 0; k < 3; k++)
      line([side * 0.2, 0.46, 0.1], [side * (0.55 + k * 0.13), 0.46, 1.2], gold, fly, 0.006);
    for (let i = 0; i < 3; i++) {
      const z = -0.35 + i * 0.4;
      line([side * 0.3, 0, z], [side * 0.78, -0.12, z - 0.13], dark, fly, 0.028);
      line([side * 0.78, -0.12, z - 0.13], [side * 1.0, -0.62, z - 0.32], gold, fly, 0.022);
    }
    line([side * 0.1, 0.23, -0.76], [side * 0.23, 0.4, -1], dark, fly, 0.017);
    sphere(dark, fly, [side * 0.23, 0.4, -1], [0.045, 0.045, 0.045]);
  }
  return { body: fly, podRings, flowerClusters };
}

/** The illustrated body's resting placement while no authoritative controller pose applies. */
export const GARDEN_DEFAULT_BODY = Object.freeze({ x: -0.55, y: 0.67, z: 0.65, rotationY: -0.3 });
