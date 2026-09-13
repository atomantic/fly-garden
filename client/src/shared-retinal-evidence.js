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
