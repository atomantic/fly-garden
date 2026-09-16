/**
 * Records the GPU counterpart of `server/scene-change-causality.test.js`. Explicit manual
 * invocation only:
 *
 *   FLY_GARDEN_CDP_ENDPOINT=http://127.0.0.1:9222 node scripts/gpu-scene-change-causality.mjs
 *
 * That automated check proves a change in the production garden reaches sensory, neural and motor
 * output, but `node --test` has no WebGL context, so its rasterizer is the deterministic CPU
 * projection stand-in and its absolute bytes are not a GPU's. This script runs the same closed
 * loop with the real rasterizer: `research/scene-change-causality.html` builds the production
 * scene graph on the real graphics device and rasters the production 8x4 controller camera, while
 * this process holds the production runtime, the production environment adapter, the engineered
 * luminance encoding and the declared motor readout. Each frame is aimed by the authoritative pose
 * the previous frame produced, so the loop is closed through real pixels and not replayed.
 *
 * WHICH LANDMARK IS CHANGED, AND WHY THAT IS NOT A SEARCH FOR A RESULT. The CPU stand-in splats
 * mesh origins into whole pixels, so any landmark in view changes bytes there. A real rasterizer
 * point-samples 32 pixels, so a landmark smaller than a pixel footprint may change nothing at all.
 * This script therefore does not pick a landmark. It censuses every flower cluster once at the
 * baseline pose and records all of them, negatives included, before any loop runs. It then runs the
 * full closed loop on three conditions fixed here in code, and writes all three: the cluster
 * `server/scene-change-causality.test.js` pins, whatever the census says about it; the lowest-indexed
 * cluster the census found to change any byte; and every flower cluster hidden at once, a condition
 * defined by the scene rather than by any outcome. No condition is re-picked after its result is
 * seen, and a census with no resolvable cluster would be recorded as the negative it is.
 *
 * It starts a local Vite development server on a dedicated loopback port, connects to an already
 * running Chrome over the DevTools Protocol, and opens its own isolated browser context. It runs
 * no app simulation, creates no individual, issues no app API call and sends nothing off the
 * loopback interface. The fixture it does run is this script's own in-process one.
 *
 * Safety contract for the attached browser, which is a person's own live Chrome:
 * this script only ever creates its own context and pages, navigates them to 127.0.0.1, and closes
 * exactly what it created. It never enumerates, reads, navigates or closes a pre-existing page, and
 * it never calls `browser.close()`, which could terminate someone's browser session.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compareControllerRasters } from '../client/src/controller-retina.js';
import { BASELINE_POSE, OBSERVER_VIEWS } from '../client/src/controller-retina-evidence.js';
import { createEnvironmentAdapter, encodeRetinalRgb, RETINAL_ADAPTER } from '../server/environment-adapter.js';
import { createRuntime } from '../server/runtime.js';

const endpoint = process.env.FLY_GARDEN_CDP_ENDPOINT;
if (!endpoint) {
  console.error('Set FLY_GARDEN_CDP_ENDPOINT to the CDP endpoint of a browser with a real graphics device.');
  process.exit(1);
}
const port = Number(process.env.GPU_EVIDENCE_PORT ?? 8794);
const origin = `http://127.0.0.1:${port}`;
const pagePath = '/research/scene-change-causality.html';
const root = fileURLToPath(new URL('../', import.meta.url));
const resultsDir = fileURLToPath(new URL('../research/results/', import.meta.url));

// The same fixed constants `server/scene-change-causality.test.js` uses, so the two recordings
// differ only in the rasterizer and in which landmark each one could resolve. The baseline pose is
// the one the observer-isolation evidence already publishes, shared rather than restated.
const FRAMES = 200;
const PINNED_CLUSTER = 1;
const REST_FRAMES = 20;

const round = value => Number(value.toFixed(6));
const differing = (before, after) => before.filter((value, index) => value !== after[index]).length;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${origin}${pagePath}`);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local development server did not start on ${origin}`);
};

/** One resident: its own production GPU garden, runtime, adapter and authoritative pose. */
async function closedLoop(page, name, { occludeClusters = [] } = {}) {
  let clock = 1000;
  const garden = await page.evaluate(([gardenName, clusters]) =>
    window.flyGardenSceneChange.open(gardenName, { occludeClusters: clusters }), [name, occludeClusters]);
  const runtime = createRuntime({ individualId: 'a', sessionId: 's' });
  const adapter = createEnvironmentAdapter(runtime, { now: () => clock, initialPose: BASELINE_POSE });
  let frameId = 0;
  // Aimed by the authoritative pose alone; no observer camera, orbit state or target coordinate.
  const raster = () => page.evaluate(([gardenName, pose]) =>
    window.flyGardenSceneChange.raster(gardenName, pose), [name, adapter.snapshot().pose]);
  async function deliver(rgb = null, environmentEpoch = null) {
    const bytes = rgb ?? await raster();
    const state = runtime.snapshot();
    const trace = adapter.accept({ version: 1, individualId: 'a', sessionId: 's',
      environmentEpoch: environmentEpoch ?? adapter.snapshot().environmentEpoch,
      frameId: frameId++, simTimeMs: state.simTimeMs, capturedAtMs: clock,
      camera: 'controller', width: 8, height: 4, rgb: bytes });
    return { rgb: bytes, trace };
  }
  return {
    name, garden, runtime, adapter, deliver,
    /** Delivers a frame that is expected to be refused, and returns why it was. */
    async refuse(rgb = null, environmentEpoch = null) {
      try { await deliver(rgb, environmentEpoch); return null; } catch (error) { return error.message; }
    },
    async run(frames = FRAMES) {
      let last = null;
      for (let i = 0; i < frames; i++) last = await deliver();
      return last;
    },
    observe: index => page.evaluate(([gardenName, view]) =>
      window.flyGardenSceneChange.observe(gardenName, view), [name, index]),
    setClusterVisible: (index, visible) => page.evaluate(([gardenName, cluster, shown]) =>
      window.flyGardenSceneChange.setClusterVisible(gardenName, cluster, shown), [name, index, visible]),
    audit: () => page.evaluate(gardenName => window.flyGardenSceneChange.renderAudit(gardenName), name),
    close: () => page.evaluate(gardenName => window.flyGardenSceneChange.close(gardenName), name),
    elapse(ms) { clock += ms; },
    dynamics: () => runtime.checkpoint().dynamics,
    rates: () => runtime.snapshot().neural.neurons.map(neuron => neuron.rateHz),
    state() {
      const { motor, pose } = adapter.snapshot();
      const snapshot = runtime.snapshot();
      return { motor: { forward: round(motor.forward), yaw: round(motor.yaw) },
        pose: { x: round(pose.x), z: round(pose.z), yaw: round(pose.yaw) },
        dynamicsDigest: digest(runtime.checkpoint().dynamics),
        tick: snapshot.tick, status: snapshot.status, simTimeMs: snapshot.simTimeMs,
        meanRateHz: snapshot.neural.meanRateHz,
        stimulusPolicyEntries: snapshot.stimulusPolicy.entries.length };
    },
  };
}

/**
 * Every flower cluster hidden once at the baseline pose, before any loop runs. Rasters come back
 * raw and are compared here by the production comparison, so the page decides nothing.
 */
async function censusClusters(page) {
  const captured = await page.evaluate(([name, pose]) => {
    const host = window.flyGardenSceneChange;
    const info = host.open(name, { occludeClusters: [] });
    const baselineRaster = host.raster(name, pose);
    const hidden = [];
    for (let index = 0; index < info.flowerClusters; index++) {
      const meta = host.setClusterVisible(name, index, false);
      hidden.push({ ...meta, rgb: host.raster(name, pose) });
      host.setClusterVisible(name, index, true);
    }
    const repeatRaster = host.raster(name, pose);
    for (let index = 0; index < info.flowerClusters; index++) host.setClusterVisible(name, index, false);
    const allHiddenRaster = host.raster(name, pose);
    for (let index = 0; index < info.flowerClusters; index++) host.setClusterVisible(name, index, true);
    const restoredRaster = host.raster(name, pose);
    host.close(name);
    return { flowerClusters: info.flowerClusters, baselineRaster, hidden, repeatRaster, allHiddenRaster, restoredRaster };
  }, ['census', BASELINE_POSE]);
  const compare = rgb => compareControllerRasters(captured.baselineRaster, rgb);
  return {
    flowerClusters: captured.flowerClusters,
    baselineRaster: captured.baselineRaster,
    clusters: captured.hidden.map(({ rgb, ...meta }) => ({ ...meta, ...compare(rgb) })),
    repeat: compare(captured.repeatRaster),
    allHidden: compare(captured.allHiddenRaster),
    restored: compare(captured.restoredRaster),
  };
}

/** The recorded scene changes travelling the whole loop, plus their matched no-change control. */
async function measureCausality(page, census, resolvedCluster) {
  const everyFlower = census.clusters.map(cluster => cluster.index);
  const loops = {
    unchanged: await closedLoop(page, 'unchanged'),
    control: await closedLoop(page, 'control'),
    pinned: await closedLoop(page, 'pinned', { occludeClusters: [PINNED_CLUSTER] }),
  };
  if (resolvedCluster !== null) loops.resolved = await closedLoop(page, 'resolved', { occludeClusters: [resolvedCluster] });
  loops.everyFlower = await closedLoop(page, 'every-flower', { occludeClusters: everyFlower });
  for (const loop of Object.values(loops)) loop.runtime.control('start');

  // Every loop rasters from the same initial authoritative pose, so a first frame differs only
  // because the scene differs; nothing downstream is yet confounded by a difference in viewpoint.
  const first = {};
  for (const [key, loop] of Object.entries(loops)) first[key] = await loop.deliver();
  const initialPosesAgree = new Set(Object.values(loops).map(loop => digest(loop.adapter.snapshot().pose))).size === 1;
  const last = {};
  for (const [key, loop] of Object.entries(loops)) last[key] = await loop.run(FRAMES - 1);

  const stage = key => ({
    occludedClusters: loops[key].garden.occluded.map(cluster => cluster.index),
    sensory: compareControllerRasters(first.unchanged.rgb, first[key].rgb),
    currentsDiffer: differing(encodeRetinalRgb(first.unchanged.rgb), encodeRetinalRgb(first[key].rgb)),
    traceCurrentsDiffer: differing(first.unchanged.trace.retinalCurrents, first[key].trace.retinalCurrents),
    potentialsDiffer: differing(loops.unchanged.dynamics().potentials, loops[key].dynamics().potentials),
    ratesDiffer: differing(loops.unchanged.rates(), loops[key].rates()),
    outputSimTimeMs: last[key].trace.outputSimTimeMs,
    firstRaster: first[key].rgb,
    potentials: loops[key].dynamics().potentials,
    rates: loops[key].rates(),
    state: loops[key].state(),
  });
  const result = {
    frames: FRAMES,
    census,
    pinnedCluster: PINNED_CLUSTER,
    resolvedCluster,
    initialPosesAgree,
    unchanged: { firstRaster: first.unchanged.rgb, outputSimTimeMs: last.unchanged.trace.outputSimTimeMs,
      potentials: loops.unchanged.dynamics().potentials, rates: loops.unchanged.rates(), state: loops.unchanged.state() },
    noChangeControl: stage('control'),
    pinned: stage('pinned'),
    resolved: resolvedCluster === null ? null : stage('resolved'),
    everyFlower: stage('everyFlower'),
    audit: await loops.unchanged.audit(),
  };
  for (const loop of Object.values(loops)) await loop.close();
  return result;
}

/** Orbiting an independent observer over the same closed loop, between every accepted frame. */
async function measureObserverIsolation(page, cluster) {
  const observed = await closedLoop(page, 'observed', { occludeClusters: [cluster] });
  const still = await closedLoop(page, 'still', { occludeClusters: [cluster] });
  for (const loop of [observed, still]) loop.runtime.control('start');
  const views = [];
  for (let i = 0; i < FRAMES; i++) {
    views.push(await observed.observe(i % OBSERVER_VIEWS.length));
    await observed.deliver();
    await still.deliver();
  }
  const result = { frames: FRAMES, cluster, views: [...new Set(views)],
    observed: observed.state(), still: still.state(),
    audit: await observed.audit(), stillAudit: await still.audit() };
  for (const loop of [observed, still]) await loop.close();
  return result;
}

/** Inactivity through the same scene change, including restoring the occluded landmark. */
async function measureRest(page, cluster) {
  const loop = await closedLoop(page, 'resting', { occludeClusters: [cluster] });
  loop.runtime.control('start');
  await loop.run();
  const moving = loop.state();
  loop.runtime.control('rest');
  const resting = loop.state();
  const restored = await loop.setClusterVisible(cluster, true);
  const refusals = [];
  for (let i = 0; i < REST_FRAMES; i++) {
    refusals.push(await loop.refuse());
    loop.elapse(5);
  }
  const after = loop.state();
  await loop.close();
  return { frames: FRAMES, cluster, moving, resting, after, restored,
    offeredFrames: REST_FRAMES, refusedFrames: refusals.filter(Boolean).length, refusals: [...new Set(refusals)] };
}

/** Frames ceasing past the freshness bound, rather than steering on from the last raster. */
async function measureFrameCessation(page, cluster) {
  const loop = await closedLoop(page, 'ceasing', { occludeClusters: [cluster] });
  loop.runtime.control('start');
  const last = await loop.run();
  const steering = loop.state();
  const epoch = loop.adapter.snapshot().environmentEpoch;

  loop.elapse(RETINAL_ADAPTER.maxAgeMs + 1);
  const fresh = loop.adapter.checkFreshness();
  const stopped = loop.state();
  const rotatedEpoch = loop.adapter.snapshot().environmentEpoch;
  const poseRetained = digest(loop.adapter.snapshot().pose) === digest(last.trace.pose);
  const retiredEpochRefusal = await loop.refuse(last.rgb, epoch);
  const pausedRefusal = await loop.refuse(last.rgb);

  loop.runtime.control('start');
  loop.elapse(1);
  const resumed = await loop.deliver();
  const result = { frames: FRAMES, cluster, steering, fresh, stopped,
    epochRotated: rotatedEpoch !== epoch, poseRetained, retiredEpochRefusal, pausedRefusal,
    resumedOnRotatedEpoch: resumed.trace.environmentEpoch === rotatedEpoch,
    resumedInputSimTimeMs: resumed.trace.inputSimTimeMs, pausedSimTimeMs: steering.simTimeMs };
  await loop.close();
  return result;
}

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
let browser = null, context = null;
try {
  await waitForServer();
  browser = await chromium.connectOverCDP(endpoint);
  // An isolated context of this script's own, never the attached browser's existing one.
  context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => console.log(`[page error] ${error.message}`));

  await page.goto(`${origin}${pagePath}`, { waitUntil: 'load' });
  await page.locator('#arm').click();
  await page.waitForFunction(() => Boolean(window.flyGardenSceneChange), null, { timeout: 60_000 });
  const described = await page.evaluate(() => window.flyGardenSceneChange.describe());
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const provenance = { ...described.device, threeRevision: described.threeRevision, userAgent,
    measuredWith: 'real browser over CDP', date: new Date().toLocaleDateString('en-CA') };
  console.log(`device: ${JSON.stringify(provenance)}`);
  if (!provenance.available) throw new Error('The attached browser exposed no WebGL context.');

  const census = await censusClusters(page);
  const resolvedCluster = census.clusters.find(cluster => cluster.changedChannels > 0)?.index ?? null;
  console.log(`census: ${census.clusters.filter(c => c.changedChannels > 0).length} of ${census.flowerClusters} clusters change any byte; all hidden ${JSON.stringify(census.allHidden)}`);
  console.log(`pinned cluster ${PINNED_CLUSTER}: ${JSON.stringify(census.clusters[PINNED_CLUSTER])}`);
  console.log(`lowest resolvable cluster: ${resolvedCluster}`);

  const causality = await measureCausality(page, census, resolvedCluster);
  for (const key of ['noChangeControl', 'pinned', 'resolved', 'everyFlower']) {
    const stage = causality[key];
    if (stage) console.log(`${key}: raster ${JSON.stringify(stage.sensory)} currents ${stage.currentsDiffer}/32 potentials ${stage.potentialsDiffer}/32 rates ${stage.ratesDiffer}/32 motor ${JSON.stringify(stage.state.motor)}`);
  }
  // Every control runs on whichever landmark this hardware could actually resolve, so that they
  // are controls on a loop that demonstrably moved rather than on an inert one.
  const controlCluster = resolvedCluster ?? PINNED_CLUSTER;
  const observer = await measureObserverIsolation(page, controlCluster);
  console.log(`observer isolation: ${JSON.stringify(observer.audit)} identical=${observer.observed.dynamicsDigest === observer.still.dynamicsDigest}`);
  const rest = await measureRest(page, controlCluster);
  console.log(`rest: refused ${rest.refusedFrames}/${rest.offeredFrames}, motor ${JSON.stringify(rest.after.motor)}`);
  const cessation = await measureFrameCessation(page, controlCluster);
  console.log(`cessation: fresh=${cessation.fresh} rotated=${cessation.epochRotated} motor ${JSON.stringify(cessation.stopped.motor)}`);
  await page.evaluate(() => window.flyGardenSceneChange.closeAll());

  const report = {
    version: 1,
    kind: 'scene-change-causality-gpu-evidence',
    baselinePose: BASELINE_POSE,
    bounds: { maxForwardSpeed: RETINAL_ADAPTER.maxForwardSpeed, maxYawSpeed: RETINAL_ADAPTER.maxYawSpeed, maxAgeMs: RETINAL_ADAPTER.maxAgeMs },
    provenance, controlCluster, causality, observer, rest, cessation,
    disclosure: described.disclosure,
  };
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(`${resultsDir}scene-change-causality-gpu.json`, `${JSON.stringify(report, null, 1)}\n`);
  console.log('wrote research/results/scene-change-causality-gpu.json');

  await page.close();
} finally {
  await context?.close().catch(() => {});
  // Deliberately no browser.close(): the attached browser belongs to the person running this.
  vite.kill('SIGTERM');
}
process.exit(0);
