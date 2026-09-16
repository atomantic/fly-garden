import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene } from 'three';
import { CONTROLLER_RETINA, compareControllerRasters, createControllerCamera, deriveControllerRaster } from '../client/src/controller-retina.js';
import { createGardenVisualWorld } from '../client/src/garden-visual-world.js';
import { createProjectionRenderer } from './projection-renderer.js';
import { createEnvironmentAdapter, encodeRetinalRgb, RETINAL_ADAPTER } from './environment-adapter.js';
import { createRuntime } from './runtime.js';

/**
 * The end-to-end fixture loop the adapter's own tests could only exercise from hand-written
 * pixels: an actual change to the production garden scene graph, rastered through the production
 * controller-camera derivation, encoded by the production retinal adapter, stepped through the
 * actual synthetic fixture, and read back out as bounded motor output and authoritative pose.
 *
 * The rasterizer is the deterministic CPU stand-in in `projection-renderer.js`, because
 * `node --test` has no WebGL context; its absolute bytes are not a GPU's. Every number recorded
 * here is a property of that stand-in plus the real garden geometry and the real fixture, and is
 * recorded in docs/ENVIRONMENT_ADAPTER.md. They are pinned exactly, as the neighbouring
 * observer-isolation numbers are, so that a change in the art, the fixture or the stand-in has to
 * be noticed rather than absorbed. Editing any of those three legitimately changes these figures:
 * re-record them together with the table in that document, in the same commit, rather than
 * loosening an assertion until it passes.
 *
 * None of this is biological vision, natural locomotion, learning or an inferred mental state.
 * The scene change is a bounded, reversible change to one landmark's appearance. It withholds
 * nothing: the optional appetitive encounter policy is a separate server-side channel that these
 * frames neither reserve, spend nor refund, and inactivity remains a valid outcome throughout.
 */

const { width, height } = CONTROLLER_RETINA;
const BASELINE_POSE = Object.freeze({ x: 0, z: -1, yaw: 0 });
const FRAMES = 200;
// The flower cluster inside the controller camera's field of view at the baseline pose. At yaw
// zero the camera looks along +z, so this cluster at negative x falls in raster columns 5 and 6 —
// the half `readFixtureMotor` reads as the right one. Chosen once and fixed; it is not searched
// for, tuned against an outcome or re-picked.
const OCCLUDED_CLUSTER = 1;
const round = value => Number(value.toFixed(6));

/** One resident: its own production garden, runtime, adapter and controller camera. */
function closedLoop({ occludeCluster = null } = {}) {
  let clock = 1000;
  const scene = new Scene();
  const { body, flowerClusters } = createGardenVisualWorld(scene);
  const occludedMeshes = occludeCluster === null ? [] : flowerClusters[occludeCluster].meshes;
  for (const mesh of occludedMeshes) mesh.visible = false;
  const runtime = createRuntime({ individualId: 'a', sessionId: 's' });
  const adapter = createEnvironmentAdapter(runtime, { now: () => clock, initialPose: BASELINE_POSE });
  const renderer = createProjectionRenderer();
  const camera = createControllerCamera();
  const target = { isRenderTarget: true };
  const rgba = new Uint8Array(width * height * 4);
  // Aimed by the authoritative pose alone; no observer camera, orbit state or target coordinate.
  const raster = () => deriveControllerRaster({ pose: adapter.snapshot().pose, camera, renderer, scene, target, rgba, body });
  let frameId = 0;
  function deliver(rgb = raster(), environmentEpoch = adapter.snapshot().environmentEpoch) {
    const state = runtime.snapshot();
    const trace = adapter.accept({ version: 1, individualId: 'a', sessionId: 's',
      environmentEpoch, frameId: frameId++,
      simTimeMs: state.simTimeMs, capturedAtMs: clock, camera: 'controller', width: 8, height: 4, rgb });
    return { rgb, trace };
  }
  function run(frames = FRAMES) {
    let last = null;
    for (let i = 0; i < frames; i++) last = deliver();
    return last;
  }
  return { scene, occludedMeshes, runtime, adapter, renderer, camera, deliver, run,
    elapse(ms) { clock += ms; },
    dynamics: () => runtime.checkpoint().dynamics,
    rates: () => runtime.snapshot().neural.neurons.map(neuron => neuron.rateHz) };
}

const differing = (before, after) => before.filter((value, index) => value !== after[index]).length;

test('a recorded change to the production garden reaches sensory, neural and motor output', () => {
  const unchanged = closedLoop();
  const occluded = closedLoop({ occludeCluster: OCCLUDED_CLUSTER });
  const control = closedLoop();
  for (const loop of [unchanged, occluded, control]) loop.runtime.control('start');

  // Sensory: the first accepted frame already differs, and only because the scene differs. Both
  // loops raster from the same initial authoritative pose, and that first frame leaves the pose
  // identical in both, so nothing downstream is yet confounded by a difference in viewpoint.
  const first = { unchanged: unchanged.deliver(), occluded: occluded.deliver(), control: control.deliver() };
  assert.deepEqual(unchanged.adapter.snapshot().pose, occluded.adapter.snapshot().pose);
  const sensory = compareControllerRasters(first.unchanged.rgb, first.occluded.rgb);
  assert.deepEqual(sensory, { channels: 96, changedChannels: 6, absoluteDifference: 772 });
  assert.equal(differing(encodeRetinalRgb(first.unchanged.rgb), encodeRetinalRgb(first.occluded.rgb)), 2);
  assert.equal(differing(first.unchanged.trace.retinalCurrents, first.occluded.trace.retinalCurrents), 2);

  // The matched control changes nothing at all: this loop is deterministic, so every difference
  // below is attributable to the recorded scene change and to nothing else.
  assert.deepEqual(compareControllerRasters(first.unchanged.rgb, first.control.rgb),
    { channels: 96, changedChannels: 0, absoluteDifference: 0 });

  const traces = { unchanged: unchanged.run(FRAMES - 1), occluded: occluded.run(FRAMES - 1), control: control.run(FRAMES - 1) };
  assert.deepEqual(unchanged.dynamics(), control.dynamics());
  assert.deepEqual(unchanged.adapter.snapshot().motor, control.adapter.snapshot().motor);
  assert.deepEqual(unchanged.adapter.snapshot().pose, control.adapter.snapshot().pose);

  // Neural: the actual fixture state diverges, in membrane potential and in trailing rate.
  assert.notDeepEqual(unchanged.dynamics(), occluded.dynamics());
  assert.equal(differing(unchanged.dynamics().potentials, occluded.dynamics().potentials), 15);
  assert.equal(differing(unchanged.rates(), occluded.rates()), 3);
  assert.deepEqual([unchanged, occluded].map(loop => loop.runtime.snapshot().neural.meanRateHz), [10.5, 10.375]);

  // Motor: the declared readout and the authoritative pose both change, and stay bounded.
  assert.deepEqual([traces.unchanged, traces.occluded].map(({ trace }) => round(trace.motor.forward)), [0.002, 0.0015]);
  assert.deepEqual([traces.unchanged, traces.occluded].map(({ trace }) => round(trace.motor.yaw)), [0.015, 0.005]);
  assert.deepEqual([unchanged, occluded].map(loop => round(loop.adapter.snapshot().pose.yaw)), [0.011525, 0.005438]);
  assert.equal(traces.occluded.trace.outputSimTimeMs, FRAMES * 5);
  for (const loop of [unchanged, occluded]) {
    const { motor, pose } = loop.adapter.snapshot();
    assert.ok(motor.forward >= 0 && motor.forward <= RETINAL_ADAPTER.maxForwardSpeed);
    assert.ok(Math.abs(motor.yaw) <= RETINAL_ADAPTER.maxYawSpeed);
    assert.ok(Math.abs(pose.x) <= 2 && Math.abs(pose.z) <= 2);
    // One second of simulated time moves the fly far less than one body length. No escalation,
    // no accumulating drive: the readout is a fixed function of trailing rates.
    assert.ok(Math.hypot(pose.x - BASELINE_POSE.x, pose.z - BASELINE_POSE.z) < 1e-4);
    assert.deepEqual(loop.runtime.snapshot().stimulusPolicy.entries, []);
  }
});

test('observer camera motion across the same loop changes no sensory, neural or motor output', () => {
  const observed = closedLoop({ occludeCluster: OCCLUDED_CLUSTER });
  const still = closedLoop({ occludeCluster: OCCLUDED_CLUSTER });
  for (const loop of [observed, still]) loop.runtime.control('start');

  // A freely orbiting observer with its own camera, target and field of view, rendered to the
  // screen between every accepted controller frame.
  const observer = new PerspectiveCamera(40, 1, 0.1, 60);
  const views = [[[6.5, 5.4, 8], [0, 0.6, 0], 40], [[-5, 2, -4], [0, 0.6, 0], 40],
    [[0, 12, 0.01], [0, 0, 0], 25], [[1.2, 0.8, 1.2], [2.2, 0.3, -1.7], 70]];
  for (let i = 0; i < FRAMES; i++) {
    const [position, look, fov] = views[i % views.length];
    observer.position.set(...position); observer.lookAt(...look); observer.fov = fov;
    observer.updateProjectionMatrix(); observer.updateMatrixWorld(true);
    observed.renderer.setRenderTarget(null); observed.renderer.render(observed.scene, observer);
    observed.deliver(); still.deliver();
  }
  assert.deepEqual(observed.dynamics(), still.dynamics());
  assert.deepEqual(observed.adapter.snapshot().motor, still.adapter.snapshot().motor);
  assert.deepEqual(observed.adapter.snapshot().pose, still.adapter.snapshot().pose);
  // Every raster used the controller camera and the offscreen target; the observer never did.
  const rasters = observed.renderer.calls.filter(call => call.camera === observed.camera);
  assert.equal(rasters.length, FRAMES);
  assert.ok(rasters.every(call => call.target !== null));
  assert.equal(observed.renderer.calls.some(call => call.camera === observer && call.target !== null), false);
});

test('resting through the same scene change advances nothing and holds motor output at zero', () => {
  const loop = closedLoop({ occludeCluster: OCCLUDED_CLUSTER });
  loop.runtime.control('start');
  loop.run();
  const moving = loop.adapter.snapshot();
  assert.ok(moving.motor.forward > 0 || Math.abs(moving.motor.yaw) > 0);

  loop.runtime.control('rest');
  const resting = loop.runtime.snapshot(), restingDynamics = loop.dynamics();
  assert.equal(resting.status, 'resting');
  assert.deepEqual(loop.adapter.snapshot().motor, { forward: 0, yaw: 0 });
  // Restoring the occluded landmark is a second scene change. Neither it nor continued frames
  // restart the fixture, raise input or move the body; the pose is simply retained.
  for (const mesh of loop.occludedMeshes) mesh.visible = true;
  for (let i = 0; i < 20; i++) {
    assert.throws(() => loop.deliver(), /Explicitly run the fixture/);
    loop.elapse(5);
  }
  assert.equal(loop.runtime.snapshot().tick, resting.tick);
  assert.deepEqual(loop.dynamics(), restingDynamics);
  assert.deepEqual(loop.adapter.snapshot().motor, { forward: 0, yaw: 0 });
  assert.deepEqual(loop.adapter.snapshot().pose, moving.pose);
  assert.deepEqual(loop.runtime.snapshot().stimulusPolicy.entries, []);
});

test('frames ceasing after a scene change pauses the loop instead of steering from the last raster', () => {
  const loop = closedLoop({ occludeCluster: OCCLUDED_CLUSTER });
  loop.runtime.control('start');
  const last = loop.run();
  const before = loop.runtime.snapshot(), epoch = loop.adapter.snapshot().environmentEpoch;
  const steering = loop.adapter.snapshot().motor, dynamics = loop.dynamics();
  assert.ok(steering.forward > 0 || Math.abs(steering.yaw) > 0);

  loop.elapse(RETINAL_ADAPTER.maxAgeMs + 1);
  assert.equal(loop.adapter.checkFreshness(), false);
  const stopped = loop.adapter.snapshot();
  assert.equal(loop.runtime.snapshot().status, 'paused');
  assert.notEqual(stopped.environmentEpoch, epoch);
  assert.deepEqual(stopped.motor, { forward: 0, yaw: 0 });
  assert.equal(loop.runtime.snapshot().tick, before.tick);
  assert.deepEqual(loop.dynamics(), dynamics);
  assert.deepEqual(stopped.pose, last.trace.pose);

  // The stale raster cannot be re-delivered on the retired epoch, and even a frame rebuilt on the
  // rotated epoch is refused until the fixture is explicitly resumed.
  assert.throws(() => loop.deliver(last.rgb, epoch), /environment epoch mismatch/);
  assert.throws(() => loop.deliver(last.rgb), /Explicitly run the fixture/);
  loop.runtime.control('start');
  loop.elapse(1);
  const resumed = loop.deliver();
  assert.equal(resumed.trace.environmentEpoch, stopped.environmentEpoch);
  assert.equal(resumed.trace.inputSimTimeMs, before.simTimeMs);
});
