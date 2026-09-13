import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { driveSharedCoupling, runSharedNeuralCoupling, COUPLING_BARRIERS } from './shared-neural-coupling.js';

const recorded = async () => JSON.parse(await readFile(new URL('../research/results/shared-neural-coupling.json', import.meta.url)));

test('a shared member\'s committed pose is the consequence of its own motor readout, not an arranged trajectory', () => {
  const run = driveSharedCoupling(2000);
  // The independently integrated motor readout reproduces the committed pose exactly.
  assert.deepEqual(run.final, run.integrated);
  // The stimulated member actually moved; the zero-input control member barely did.
  assert.equal(run.displacement[1] > 0.05, true);
  assert.equal(run.displacement[0] < 1e-3, true);
  assert.equal(run.peakMotor[1] > run.peakMotor[0], true);
  // Neural time advanced exactly one 5 ms step per barrier for both members.
  assert.equal(run.simTimeMs, 2000 * 5);
});

test('recorded neurally generated coupling changes the partner footprint in the production retinal camera', async t => {
  const report = await recorded();
  assert.equal(report.kind, 'neural-shared-coupling-evidence');
  assert.equal(report.barriers, COUPLING_BARRIERS);
  // Recompute the whole recorded run: the fixture barrier and production geometry are deterministic.
  const measured = await runSharedNeuralCoupling(report.barriers).catch(error => { t.diagnostic(`Coupling measurement unavailable: ${error.message}`); return null; });
  assert.notEqual(measured, null);
  assert.deepEqual(measured.final, report.final);
  assert.deepEqual(measured.measurement, report.measurement);
  // Positive coupling: the partner's own movement changed which retinal cells it occupies.
  assert.equal(report.measurement.changedCells.length > 0, true);
  assert.notDeepEqual(report.measurement.before.cells, report.measurement.after.cells);
  // Benign control: re-measuring the unchanged initial poses reproduces the first measurement exactly.
  assert.equal(report.measurement.repeatIsIdentical, true);
  assert.deepEqual(report.measurement.control, report.measurement.before);
  // This is a geometric footprint, never a claim about GPU bytes.
  assert.equal(report.disclosure.includes('geometric proxy'), true);
});

test('the retinal footprint proxy refuses malformed members and stays inside the 8x4 cell grid', async () => {
  const THREE = await import('three');
  const { createSharedVisualWorld } = await import('../client/src/shared-visual-world.js');
  const { measureRetinalFootprint } = await import('../client/src/shared-retinal-evidence.js');
  const scene = new THREE.Scene(), visual = createSharedVisualWorld({}, scene, 2);
  assert.equal(visual.applyPoses({ participants: [{ pose: { x: 0, z: -1, yaw: 0 } }, { pose: { x: 0, z: 0.2, yaw: 0 } }] }), true);
  const footprint = measureRetinalFootprint(visual, 0, 1);
  assert.equal(footprint.cells.every(cell => Number.isInteger(cell) && cell >= 0 && cell < 32), true);
  assert.equal(footprint.visibleVertices <= footprint.vertices, true);
  assert.throws(() => measureRetinalFootprint(visual, 0, 0), /distinct/);
  assert.throws(() => measureRetinalFootprint(visual, 0, 9), /distinct/);
  visual.dispose();
});
