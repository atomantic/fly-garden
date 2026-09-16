import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareControllerRasters, CONTROLLER_RETINA } from '../client/src/controller-retina.js';
import { encodeRetinalRgb, RETINAL_ADAPTER } from './environment-adapter.js';
import { createSceneChangeRasterHost } from '../client/src/scene-change-evidence.js';

/**
 * Guards the recorded GPU counterpart of `server/scene-change-causality.test.js`.
 *
 * That file runs the closed loop under `node --test`, which has no WebGL context, so its
 * rasterizer is the CPU projection stand-in. `scripts/gpu-scene-change-causality.mjs` runs the
 * same loop against a real graphics device and writes what it measured; this file re-derives
 * every claim in that artifact from the production comparison, the production luminance encoding
 * and the recorded rasters themselves, so a hand-edited or stale record cannot pass.
 *
 * Absolute bytes are hardware and driver specific and are deliberately not pinned here: they are
 * observations of the named device, never golden values another machine must reproduce. What is
 * asserted is the artifact's internal consistency and the claims it makes. Re-recording on other
 * hardware legitimately changes the numbers — re-record the artifact and the table in
 * docs/ENVIRONMENT_ADAPTER.md together, in the same commit, rather than loosening an assertion.
 */
const recorded = async () => JSON.parse(await readFile(new URL('../research/results/scene-change-causality-gpu.json', import.meta.url)));
const differing = (before, after) => before.filter((value, index) => value !== after[index]).length;
const CHANNELS = CONTROLLER_RETINA.width * CONTROLLER_RETINA.height * 3;
const conditions = report => ['noChangeControl', 'pinned', 'resolved', 'everyFlower']
  .map(key => [key, report.causality[key]]).filter(([, stage]) => stage);

test('the recorded GPU run names a real graphics device and the production interface it drove', async () => {
  const report = await recorded();
  assert.equal(report.kind, 'scene-change-causality-gpu-evidence');
  assert.equal(report.version, 1);
  assert.equal(report.provenance.available, true);
  assert.equal(report.provenance.measuredWith, 'real browser over CDP');
  // The point of this artifact is that it is not the CPU projection stand-in.
  assert.match(report.provenance.renderer, /\S/);
  assert.equal(/swiftshader|projection stand-in/i.test(report.provenance.renderer), false);
  assert.deepEqual(report.bounds, { maxForwardSpeed: RETINAL_ADAPTER.maxForwardSpeed,
    maxYawSpeed: RETINAL_ADAPTER.maxYawSpeed, maxAgeMs: RETINAL_ADAPTER.maxAgeMs });
  assert.deepEqual(report.baselinePose, { x: 0, z: -1, yaw: 0 });
  assert.match(report.disclosure, /no biological vision, natural locomotion, learning or inferred mental state/);
});

test('the landmark census covers every flower cluster and selects by a rule, not by an outcome', async () => {
  const { census, resolvedCluster, pinnedCluster } = (await recorded()).causality;
  assert.equal(census.clusters.length, census.flowerClusters);
  assert.deepEqual(census.clusters.map(cluster => cluster.index), census.clusters.map((_, index) => index));
  assert.equal(census.baselineRaster.length, CHANNELS);
  for (const cluster of census.clusters) {
    assert.equal(cluster.channels, CHANNELS);
    assert.equal(cluster.visible, false);
    assert.ok(cluster.meshes > 0);
  }
  // Re-rastering the unchanged scene, and restoring every hidden cluster, both return the exact
  // baseline bytes: this device is deterministic and the scene change is fully reversible.
  assert.deepEqual(census.repeat, { channels: CHANNELS, changedChannels: 0, absoluteDifference: 0 });
  assert.deepEqual(census.restored, { channels: CHANNELS, changedChannels: 0, absoluteDifference: 0 });
  // The selection rule is "lowest index the census resolved", re-derived here from the census.
  const lowest = census.clusters.find(cluster => cluster.changedChannels > 0)?.index ?? null;
  assert.equal(resolvedCluster, lowest);
  assert.ok(Number.isInteger(pinnedCluster) && pinnedCluster >= 0 && pinnedCluster < census.flowerClusters);
});

test('every recorded stage re-derives from its own rasters through the production encoding', async () => {
  const report = await recorded();
  const { unchanged } = report.causality;
  assert.equal(unchanged.firstRaster.length, CHANNELS);
  for (const [key, stage] of conditions(report)) {
    assert.equal(stage.firstRaster.length, CHANNELS, key);
    assert.deepEqual(stage.sensory, compareControllerRasters(unchanged.firstRaster, stage.firstRaster), key);
    assert.equal(stage.currentsDiffer,
      differing(encodeRetinalRgb(unchanged.firstRaster), encodeRetinalRgb(stage.firstRaster)), key);
    assert.equal(stage.traceCurrentsDiffer, stage.currentsDiffer, key);
    assert.equal(stage.potentialsDiffer, differing(unchanged.potentials, stage.potentials), key);
    assert.equal(stage.ratesDiffer, differing(unchanged.rates, stage.rates), key);
    assert.equal(stage.outputSimTimeMs, report.causality.frames * 5, key);
  }
  // A census entry and the loop that hid the same single cluster are independent gardens; they
  // must still agree on how many channels that landmark moves.
  for (const [key, stage] of conditions(report)) {
    if (stage.occludedClusters.length !== 1) continue;
    const entry = report.causality.census.clusters[stage.occludedClusters[0]];
    assert.equal(stage.sensory.changedChannels, entry.changedChannels, key);
    assert.equal(stage.sensory.absoluteDifference, entry.absoluteDifference, key);
  }
});

test('the matched no-change control is byte-identical, so every difference is the scene change', async () => {
  const report = await recorded();
  const { unchanged, noChangeControl } = report.causality;
  assert.equal(report.causality.initialPosesAgree, true);
  assert.deepEqual(noChangeControl.occludedClusters, []);
  assert.deepEqual(noChangeControl.sensory, { channels: CHANNELS, changedChannels: 0, absoluteDifference: 0 });
  assert.deepEqual(noChangeControl.state, unchanged.state);
});

test('no recorded stage claims a neural or motor change its own rasters did not carry', async () => {
  const report = await recorded();
  const { unchanged } = report.causality;
  for (const [key, stage] of conditions(report)) {
    if (stage.sensory.changedChannels === 0) {
      // A landmark below this device's 8x4 sampling resolution is a real negative, and the whole
      // deterministic loop must then be identical rather than drifting on its own.
      assert.equal(stage.potentialsDiffer, 0, key);
      assert.deepEqual(stage.state, unchanged.state, key);
    }
    if (stage.state.dynamicsDigest !== unchanged.state.dynamicsDigest) assert.ok(stage.sensory.changedChannels > 0, key);
    const motorChanged = stage.state.motor.forward !== unchanged.state.motor.forward
      || stage.state.motor.yaw !== unchanged.state.motor.yaw;
    if (motorChanged) assert.ok(stage.ratesDiffer > 0, key);
  }
});

test('at least one recorded scene change reaches sensory, neural and motor output on the real device', async () => {
  const report = await recorded();
  const { unchanged } = report.causality;
  // The acceptance claim for this artifact, on the hardware its provenance names. A re-record that
  // cannot satisfy it is a negative result to report, not an assertion to loosen.
  const causal = conditions(report).filter(([, stage]) => stage.sensory.changedChannels > 0
    && stage.potentialsDiffer > 0 && stage.ratesDiffer > 0
    && (stage.state.motor.forward !== unchanged.state.motor.forward || stage.state.motor.yaw !== unchanged.state.motor.yaw)
    && stage.state.pose.yaw !== unchanged.state.pose.yaw);
  assert.ok(causal.length > 0, 'no recorded condition changed sensory, neural and motor output together');
});

test('recorded movement stays inside the declared bounds and escalates nothing', async () => {
  const report = await recorded();
  const states = [report.causality.unchanged.state, ...conditions(report).map(([, stage]) => stage.state),
    report.observer.observed, report.observer.still, report.rest.moving, report.cessation.steering];
  for (const state of states) {
    assert.ok(state.motor.forward >= 0 && state.motor.forward <= RETINAL_ADAPTER.maxForwardSpeed);
    assert.ok(Math.abs(state.motor.yaw) <= RETINAL_ADAPTER.maxYawSpeed);
    assert.ok(Math.abs(state.pose.x) <= 2 && Math.abs(state.pose.z) <= 2);
    // One second of simulated time moves the body far less than one body length.
    assert.ok(Math.hypot(state.pose.x - report.baselinePose.x, state.pose.z - report.baselinePose.z) < 1e-4);
    // Nothing on this path reserves, spends or refunds the optional appetitive encounter policy.
    assert.equal(state.stimulusPolicyEntries, 0);
    assert.equal(state.simTimeMs, report.causality.frames * 5);
  }
});

test('orbiting the observer over the same GPU loop changes no neural, motor or pose state', async () => {
  const { observer, causality } = await recorded();
  assert.equal(observer.frames, causality.frames);
  assert.equal(observer.views.length, 4);
  assert.deepEqual(observer.observed, observer.still);
  // Measured, not assumed: every controller raster went to the offscreen sensory target and no
  // observer render ever did, on both the observed and the unobserved garden.
  for (const audit of [observer.audit, observer.stillAudit]) {
    assert.equal(audit.controllerToOffscreen, observer.frames);
    assert.equal(audit.controllerToCanvas, 0);
    assert.equal(audit.observerToOffscreen, 0);
  }
  assert.equal(observer.audit.observerToCanvas, observer.frames);
  assert.equal(observer.stillAudit.observerToCanvas, 0);
  assert.equal(causality.audit.observerToOffscreen, 0);
  assert.equal(causality.audit.controllerToOffscreen, causality.frames);
});

test('resting through the GPU scene change advances nothing, even when the landmark is restored', async () => {
  const { rest } = await recorded();
  assert.ok(rest.moving.motor.forward > 0 || Math.abs(rest.moving.motor.yaw) > 0);
  assert.equal(rest.resting.status, 'resting');
  assert.deepEqual(rest.resting.motor, { forward: 0, yaw: 0 });
  // Restoring the occluded landmark is a second scene change; it restarts nothing.
  assert.equal(rest.restored.visible, true);
  assert.equal(rest.restored.index, rest.cluster);
  assert.equal(rest.refusedFrames, rest.offeredFrames);
  assert.deepEqual(rest.refusals, ['Explicitly run the fixture before sending controller observations.']);
  assert.deepEqual(rest.after, rest.resting);
  assert.deepEqual(rest.after.pose, rest.moving.pose);
  assert.equal(rest.after.tick, rest.moving.tick);
});

test('frames ceasing after the GPU scene change pauses instead of steering from the last raster', async () => {
  const { cessation } = await recorded();
  assert.ok(cessation.steering.motor.forward > 0 || Math.abs(cessation.steering.motor.yaw) > 0);
  assert.equal(cessation.fresh, false);
  assert.equal(cessation.epochRotated, true);
  assert.equal(cessation.stopped.status, 'paused');
  assert.deepEqual(cessation.stopped.motor, { forward: 0, yaw: 0 });
  assert.equal(cessation.stopped.tick, cessation.steering.tick);
  assert.equal(cessation.stopped.dynamicsDigest, cessation.steering.dynamicsDigest);
  assert.equal(cessation.poseRetained, true);
  assert.deepEqual(cessation.stopped.pose, cessation.steering.pose);
  assert.match(cessation.retiredEpochRefusal, /environment epoch mismatch/);
  assert.match(cessation.pausedRefusal, /Explicitly run the fixture/);
  // Resuming continues from the paused simulation time; the stale frames bought no neural time.
  assert.equal(cessation.resumedOnRotatedEpoch, true);
  assert.equal(cessation.resumedInputSimTimeMs, cessation.pausedSimTimeMs);
});

test('the browser raster host refuses a missing canvas factory and unopened gardens', () => {
  assert.throws(() => createSceneChangeRasterHost(null), /canvas factory/);
  const host = createSceneChangeRasterHost(() => { throw new Error('no canvas in node --test'); });
  for (const call of [() => host.raster('absent', { x: 0, z: 0, yaw: 0 }), () => host.observe('absent', 0),
    () => host.setClusterVisible('absent', 0, true), () => host.renderAudit('absent'), () => host.close('absent')]) {
    assert.throws(call, /No open garden named "absent"/);
  }
  // `closeAll` on an empty host is a no-op, never an error on a page that armed but never ran.
  assert.doesNotThrow(() => host.closeAll());
});
