import { test, expect } from './cdp-browser.js';
import { build } from 'vite';

let scripts, entryFile;
const dataset = 'male-cns:v1.0', manifest = 'a'.repeat(64);
const neuronId = `${dataset}/1`;
const session = {
  schemaVersion: 1, kind: 'connectome-sample-recording', id: 'test-recording', status: 'complete',
  startedAtMs: 0, nextSequence: 1, droppedSamples: 0,
  source: { dataset, individualId: 'historical-test', sessionEpoch: 'test-epoch', graphSha256: 'b'.repeat(64),
    graphManifestSha256: manifest, model: { id: 'test-model', dtMs: 1 } },
  selection: { mode: 'explicit-ids', neuronIds: [neuronId], selectedCount: 1, retainedNeuronCount: 1 },
};
const replay = {
  schemaVersion: 1, kind: 'connectome-sample-recording-export', mode: 'read-only', canResume: false,
  session, complete: true, gaps: [], records: [{ tick: 0, sequence: 0, simTimeMs: 0, wallTimeMs: 0,
    timeWindow: { kind: 'instantaneous', startTick: 0, endTick: 0, startSimTimeMs: 0, endSimTimeMs: 0 },
    samples: [{ neuronId, potential: 0.25, firing: 1, refractoryStepsRemaining: 0 }] }],
};
// Protocol fixtures for the real component, not a loaded worker or anatomical evidence.
const worker = {
  protocolVersion: 1, source: 'connectome', individualId: 'current-test', dataset,
  sessionEpoch: 'test-epoch', commandSequence: 2, resident: true, status: 'paused',
  graphSha256: 'b'.repeat(64), model: { id: 'test-model', dtMs: 1, refractorySteps: 2 },
  provenance: { manifestSha256: manifest },
  neural: { tick: 5, simTimeMs: 5, spikes: 0, totalSpikes: 0, traversedEdges: 0, minimum: 0, maximum: 0 },
};
const liveSample = {
  protocolVersion: 1, kind: 'connectome-neuron-sample', source: 'connectome',
  individualId: worker.individualId, dataset, graphSha256: worker.graphSha256,
  sessionEpoch: worker.sessionEpoch, modelId: worker.model.id, commandSequence: worker.commandSequence,
  status: worker.status, provenance: worker.provenance, tick: 5, simTimeMs: 5,
  timeWindow: { kind: 'instantaneous', startTick: 5, endTick: 5, startSimTimeMs: 5, endSimTimeMs: 5 },
  samples: replay.records[0].samples,
};

test.beforeAll(async () => {
  const component = new URL('../../client/src/AtlasActivity.jsx', import.meta.url).pathname;
  const entry = new URL('./atlas-activity-regression.jsx', import.meta.url).pathname;
  const result = await build({
    configFile: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'atlas-activity-regression', resolveId: id => id === entry ? entry : null,
      load: id => id === entry ? `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import AtlasActivity from ${JSON.stringify(component)};
        import { drawableAtlasActivity } from ${JSON.stringify(new URL('../../client/src/atlas-activity.js', import.meta.url).pathname)};
        const data = { manifest: { graphManifestSha256: '${manifest}', coordinates: { units: 'micrometers' } },
          nodes: [['${neuronId}', '1', '', '', '', 'soma']], valid: new Uint8Array([1]), groups: new Uint8Array([0]) };
        function Harness() {
          const [overlay, onOverlay] = useState(null);
          return React.createElement(React.Fragment, null,
            React.createElement('output', { 'aria-label': 'Drawable activity marks' }, String(drawableAtlasActivity(overlay)?.length ?? 0)),
            React.createElement(AtlasActivity, { data, dataset: '${dataset}', scope: 'test-scope',
              individualId: '${worker.individualId}', visibleGroups: [0], selectedIndex: null, overlay, onOverlay }));
        }
        createRoot(document.getElementById('root')).render(React.createElement(Harness));
      ` : null }],
    oxc: { jsx: { runtime: 'automatic', development: false } },
    build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
  });
  const chunks = (Array.isArray(result) ? result[0] : result).output.filter(chunk => chunk.type === 'chunk');
  scripts = new Map(chunks.map(chunk => [`/${chunk.fileName}`, chunk.code]));
  entryFile = chunks.find(chunk => chunk.isEntry).fileName;
});

async function mountActivity(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/atlas-activity-regression') return route.fulfill({ contentType: 'text/html',
      body: `<!doctype html><html><body><h1>Synthetic component regression; not anatomical evidence</h1><div id="root"></div><script type="module" src="/${entryFile}"></script></body></html>` });
    if (scripts.has(path)) return route.fulfill({ contentType: 'text/javascript', body: scripts.get(path) });
    return route.abort();
  });
  await page.addInitScript(({ session, replay, worker, liveSample }) => {
    window.reads = [];
    window.pendingReads = [];
    window.workerState = worker;
    window.holdWorker = false;
    window.confirmation = null;
    let stateReads = 0;
    window.fetch = async (url, options = {}) => {
      window.reads.push({ url, method: options.method ?? 'GET', body: options.body });
      if (url === '/api/connectomes/current-test') {
        stateReads++;
        if (window.holdWorker) return new Promise((resolve, reject) => {
          window.pendingReads.push({ signal: options.signal,
            resolve: () => resolve(new Response(JSON.stringify(window.workerState))),
            reject: () => reject(new Error('Worker unavailable in synthetic regression')) });
          options.signal.addEventListener('abort', () => reject(new Error('Read aborted')), { once: true });
        });
        return new Response(JSON.stringify(stateReads % 2 === 0 && window.confirmation ? window.confirmation : window.workerState));
      }
      if (url === '/api/connectomes/current-test/samples') return new Response(JSON.stringify(liveSample));
      if (url === '/api/connectome-recordings') return new Response(JSON.stringify({ sessions: [session] }));
      if (url === '/api/connectome-recordings/test-recording/replay') {
        return new Promise(resolve => window.pendingReads.push({ signal: options.signal,
          resolve: () => resolve(new Response(JSON.stringify(replay))) }));
      }
      throw new Error('Unexpected request in isolated activity test');
    };
  }, { session, replay, worker, liveSample });
  await page.goto('/atlas-activity-regression');
  await expect.poll(async () => ({ errors, mounted: await page.getByRole('radio', { name: 'Recorded replay', exact: true }).count() })).toEqual({ errors: [], mounted: 1 });
}

async function openActivity(page) {
  await mountActivity(page);
  await page.getByRole('radio', { name: 'Recorded replay', exact: true }).check();
  await page.getByRole('button', { name: 'Overlay recording test-recording', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
}

async function readLiveActivity(page) {
  await page.getByRole('radio', { name: 'Active neural state (bounded sample)', exact: true }).check();
  await page.getByRole('button', { name: 'Read bounded activity sample once', exact: true }).click();
}

async function expectOnlySampleReads(page) {
  expect(await page.evaluate(() => window.reads.every(read =>
    read.url === '/api/connectomes/current-test' && read.method === 'GET'
    || read.url === '/api/connectomes/current-test/samples' && read.method === 'POST'
      && JSON.parse(read.body).neuronIds.length === 1))).toBe(true);
}

for (const outcome of ['unavailable', 'timeout']) {
  test(`refresh withdraws prior live marks even when the worker read ends in ${outcome}`, async ({ page }) => {
    await page.clock.install();
    await mountActivity(page);
    await readLiveActivity(page);
    const marks = page.getByLabel('Drawable activity marks');
    await expect(marks).toHaveText('1');
    await page.evaluate(() => { window.holdWorker = true; });
    await page.getByRole('button', { name: 'Read bounded activity sample once', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
    await expect(marks).toHaveText('0');
    const report = page.getByRole('region', { name: 'Modeled activity sample report', exact: true });
    await expect(report).toContainText('Stale or unavailable');
    await expect(report).toContainText('0.25');
    if (outcome === 'timeout') await page.clock.fastForward(20_001);
    else await page.evaluate(() => window.pendingReads[0].reject());
    await expect(page.getByRole('alert').filter({ hasText: outcome === 'timeout' ? 'The read timed out' : 'Worker unavailable in synthetic regression' })).toBeVisible();
    await expect(marks).toHaveText('0');
    await page.evaluate(() => { window.holdWorker = false; });
    await page.getByRole('button', { name: 'Read bounded activity sample once', exact: true }).click();
    await expect(marks).toHaveText('1');
    await expect(report).toContainText('Active neural state (bounded sample)');
    await expectOnlySampleReads(page);
  });
}

for (const change of ['command', 'tick']) {
  test(`a newer ${change} at live confirmation publishes superseded text without marks`, async ({ page }) => {
    await mountActivity(page);
    await page.evaluate(change => {
      window.confirmation = structuredClone(window.workerState);
      if (change === 'command') window.confirmation.commandSequence++;
      else { window.confirmation.neural.tick++; window.confirmation.neural.simTimeMs++; }
    }, change);
    await readLiveActivity(page);
    const report = page.getByRole('region', { name: 'Modeled activity sample report', exact: true });
    await expect(report).toContainText('Stale or unavailable');
    await expect(report).toContainText('0.25');
    await expect(report).toContainText('Mark withdrawn');
    await expect(page.getByLabel('Drawable activity marks')).toHaveText('0');
    await expectOnlySampleReads(page);
  });
}

for (const next of ['Anatomy only', 'Synthetic fixture', 'Active neural state (bounded sample)']) {
  test(`late replay cannot republish activity after choosing ${next}`, async ({ page }) => {
    await openActivity(page);
    await page.getByRole('radio', { name: next, exact: true }).check();
    await page.evaluate(async () => {
      window.pendingReads[0].resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(page.getByRole('region', { name: 'Modeled activity sample report', exact: true })).toHaveCount(0);
    await page.getByRole('radio', { name: 'Recorded replay', exact: true }).check();
    const open = page.getByRole('button', { name: 'Overlay recording test-recording', exact: true });
    await expect(open).toBeEnabled();
    await open.click();
    await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(2);
    await expect(page.getByRole('region', { name: 'Modeled activity sample report', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.pendingReads[0].signal.aborted)).toBe(true);
    await page.evaluate(() => window.pendingReads[1].resolve());
    const report = page.getByRole('region', { name: 'Modeled activity sample report', exact: true });
    await expect(report).toContainText('1 sampled cells');
    await expect(report).toContainText('historical-test');
    expect(await page.evaluate(() => window.reads.every(read => read.method === 'GET'
      && read.url.startsWith('/api/connectome-recordings')))).toBe(true);
  });
}
