import { createFixtureSharedSession } from './fixture-shared-session.js';
import { createRuntime } from './runtime.js';

export const COUPLING_BARRIERS = 4000;
const START = [{ x: 0, z: -1, yaw: 0 }, { x: 0, z: 0.2, yaw: 0 }];

/** One fixed, deterministic, neurally generated shared run.
 *
 * Member 0 is the recipient and receives an all-zero retinal raster; member 1 receives an
 * all-255 raster. Both runtimes are the ordinary synthetic 32-neuron fixtures and remain the
 * sole neural authority: every pose below is produced by the engineered motor readout of a
 * committed barrier, never arranged externally. No reward, objective, proximity target or
 * partner neural state enters either member.
 */
export function driveSharedCoupling(barriers = COUPLING_BARRIERS) {
  const runtimes = [createRuntime({ individualId: 'coupling-recipient' }), createRuntime({ individualId: 'coupling-partner' })];
  let time = 1000;
  const session = createFixtureSharedSession(runtimes.map((runtime, index) => ({ runtime, pose: { ...START[index] } })), { now: () => time });
  session.start();
  const initial = session.snapshot().participants.map(participant => ({ ...participant.pose }));
  // Independently integrate the reported motor readout to confirm the committed pose is that
  // readout's consequence rather than an externally supplied trajectory.
  const integrated = initial.map(pose => ({ ...pose }));
  const peakMotor = [0, 0];
  for (let i = 0; i < barriers; i++) {
    const state = session.snapshot();
    const frames = state.participants.map((participant, index) => ({ version: 1, individualId: participant.individualId,
      sessionId: participant.sessionId, environmentEpoch: state.worldEpoch, frameId: state.tick, simTimeMs: participant.simTimeMs,
      capturedAtMs: time, camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(index ? 255 : 0) }));
    const result = session.accept({ worldEpoch: state.worldEpoch, worldTick: state.tick, frames });
    for (const [index, trace] of result.traces.entries()) {
      peakMotor[index] = Math.max(peakMotor[index], Math.abs(trace.motor.forward));
      const pose = integrated[index];
      pose.yaw = ((pose.yaw + trace.motor.yaw * 0.005 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      pose.x += Math.sin(pose.yaw) * trace.motor.forward * 0.005;
      pose.z += Math.cos(pose.yaw) * trace.motor.forward * 0.005;
    }
  }
  const final = session.snapshot().participants.map(participant => ({ ...participant.pose }));
  return { barriers, simTimeMs: barriers * 5, initial, final, integrated, peakMotor,
    displacement: final.map((pose, index) => Math.hypot(pose.x - initial[index].x, pose.z - initial[index].z)) };
}

/** Measures the committed trajectory's consequence in the other member's production camera. */
export async function runSharedNeuralCoupling(barriers = COUPLING_BARRIERS) {
  const THREE = await import('three');
  const { createSharedVisualWorld } = await import('../client/src/shared-visual-world.js');
  const { measureRetinalFootprint } = await import('../client/src/shared-retinal-evidence.js');
  const run = driveSharedCoupling(barriers);
  const scene = new THREE.Scene();
  // The renderer is only needed for GPU rasters; geometry, poses and cameras are production code.
  const visual = createSharedVisualWorld({}, scene, 2);
  const footprint = poses => {
    if (!visual.applyPoses({ participants: poses.map(pose => ({ pose })) })) throw new Error('Invalid committed poses');
    return measureRetinalFootprint(visual, 0, 1);
  };
  const before = footprint(run.initial), after = footprint(run.final);
  const control = footprint(run.initial);
  visual.dispose();
  const changedCells = [...new Set([...before.cells, ...after.cells])].filter(cell => before.cells.includes(cell) !== after.cells.includes(cell)).sort((a, b) => a - b);
  return { version: 1, kind: 'neural-shared-coupling-evidence', threeRevision: THREE.REVISION,
    runtime: process.version, ...run,
    measurement: { before, after, control, changedCells,
      visibleVertexDelta: after.visibleVertices - before.visibleVertices,
      repeatIsIdentical: JSON.stringify(control) === JSON.stringify(before) },
    disclosure: 'Neurally generated committed poses from the ordinary fixture barrier, measured through the production shared scene graph and controller camera. The 8×4 cell footprint is a declared geometric proxy for the rendered raster, not GPU bytes; no biological perception, learning, consent or sex comparison is established.' };
}
