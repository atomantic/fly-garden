import * as THREE from 'three';
import { createSharedVisualWorld } from './shared-visual-world.js';

export function compareRasters(before, after) {
  if (![before, after].every(rgb => Array.isArray(rgb) && rgb.length === 96 && rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255))) throw new Error('Expected two exact 8×4 RGB rasters');
  return { changedChannels: before.filter((v, i) => v !== after[i]).length,
    absoluteDifference: before.reduce((sum, v, i) => sum + Math.abs(v - after[i]), 0) };
}

/** Explicit static rendering only. No neural model, timers, fetch or simulated movement. */
export function measureSharedRetinalEvidence(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(640, 360); renderer.setClearColor(0x112423); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), visual = createSharedVisualWorld(renderer, scene);
  const observer = new THREE.PerspectiveCamera(45, 640 / 360, 0.05, 40);
  const recipient = { x: 0, z: -1, yaw: 0 }, partnerA = { x: 0, z: 0.2, yaw: 0 }, partnerB = { x: 1.5, z: 0.2, yaw: 0 };
  const capture = partner => {
    if (!visual.applyPoses({ participants: [{ pose: recipient }, { pose: partner }] })) throw new Error('Invalid fixed poses');
    return visual.readRetina(0);
  };
  try {
    const a = capture(partnerA), repeatedA = capture(partnerA), b = capture(partnerB), restoredA = capture(partnerA);
    observer.position.set(6, 5, 7); observer.lookAt(0, 0.5, 0); renderer.render(scene, observer);
    const observerA = capture(partnerA);
    observer.position.set(-5, 2, -4); observer.lookAt(0, 0.5, 0); renderer.render(scene, observer);
    const observerB = capture(partnerA);
    const comparisons = { partnerChange: compareRasters(a, b), repeat: compareRasters(a, repeatedA), poseReturn: compareRasters(a, restoredA), observerChange: compareRasters(observerA, observerB) };
    const passed = comparisons.partnerChange.changedChannels > 0 && ['repeat', 'poseReturn', 'observerChange'].every(key => comparisons[key].changedChannels === 0);
    return { version: 1, kind: 'static-shared-renderer-evidence', threeRevision: THREE.REVISION,
      width: 8, height: 4, channels: 3, recipient, partnerA, partnerB,
      rasters: { a, repeatedA, b, restoredA, observerA, observerB }, comparisons, passed,
      disclosure: 'Fixed externally arranged poses using the production procedural renderer. No neural execution, behavioral movement, biological sensing or learning established.' };
  } finally {
    visual.dispose(); scene.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); }); renderer.dispose();
  }
}

/** Geometric retinal footprint of one member's body in another member's controller camera.
 *
 * DISCLOSURE: this is NOT a GPU raster. It uses the exact production scene graph, body meshes
 * and controller-camera transform from `createSharedVisualWorld`, projects the partner body's
 * real vertices through the real camera, and reports which of the 8×4 retinal cells that body
 * occupies. It is a declared geometric proxy for the rendered bytes, usable without WebGL.
 * Byte-level rendered evidence still requires `measureSharedRetinalEvidence` in a browser.
 */
export function measureRetinalFootprint(visual, recipientIndex, partnerIndex) {
  const camera = visual.cameras[recipientIndex], body = visual.bodies[partnerIndex];
  if (!camera || !body || recipientIndex === partnerIndex) throw new Error('Expected two distinct shared members');
  camera.updateMatrixWorld(true); body.updateMatrixWorld(true);
  const point = new THREE.Vector3(), cells = new Set();
  let vertices = 0, visibleVertices = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  body.traverse(object => {
    const position = object.geometry?.attributes?.position;
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      vertices++;
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld).project(camera);
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1) continue;
      visibleVertices++;
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      const column = Math.min(7, Math.max(0, Math.floor((point.x + 1) / 2 * 8)));
      const row = Math.min(3, Math.max(0, Math.floor((1 - point.y) / 2 * 4)));
      cells.add(row * 8 + column);
    }
  });
  const round = value => Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : null;
  return { vertices, visibleVertices, cells: [...cells].sort((a, b) => a - b),
    ndcBounds: { minX: round(minX), maxX: round(maxX), minY: round(minY), maxY: round(maxY) } };
}

/** Byte-level GPU replay of one recorded neurally generated trajectory. Explicit click only.
 * It renders the recipient's production 8×4 raster at the recorded initial and final committed
 * poses of `research/results/shared-neural-coupling.json`. It runs no simulation itself: the
 * poses were produced by the fixture barrier, and this only asks whether the production
 * renderer turns that movement into different retinal bytes. */
export function measureNeuralSharedRetinalEvidence(canvas, record) {
  if (record?.kind !== 'neural-shared-coupling-evidence' || !Array.isArray(record.initial) || !Array.isArray(record.final)
    || record.initial.length !== 2 || record.final.length !== 2) throw new Error('Expected a recorded two-member neural coupling run');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1); renderer.setSize(640, 360); renderer.setClearColor(0x112423); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), visual = createSharedVisualWorld(renderer, scene, 2);
  const capture = poses => {
    if (!visual.applyPoses({ participants: poses.map(pose => ({ pose })) })) throw new Error('Invalid recorded poses');
    return visual.readRetina(0);
  };
  try {
    // The recipient's own pose barely moved; the partner's is the neurally generated change.
    const before = capture(record.initial), repeated = capture(record.initial), after = capture(record.final);
    const comparisons = { neuralPartnerChange: compareRasters(before, after), repeat: compareRasters(before, repeated) };
    return { version: 1, kind: 'neural-shared-retinal-evidence', threeRevision: THREE.REVISION,
      barriers: record.barriers, simTimeMs: record.simTimeMs, initial: record.initial, final: record.final,
      rasters: { before, repeated, after }, comparisons,
      passed: comparisons.neuralPartnerChange.changedChannels > 0 && comparisons.repeat.changedChannels === 0,
      disclosure: 'Production renderer replay of neurally generated committed poses. A zero result is a real negative result and must be recorded as such, not retuned. No biological perception, learning, consent or sex comparison is established.' };
  } finally {
    visual.dispose(); scene.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); }); renderer.dispose();
  }
}
