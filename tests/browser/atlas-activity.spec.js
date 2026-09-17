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
        const data = { manifest: { graphManifestSha256: '${manifest}', coordinates: { units: 'micrometers' } },
          nodes: [['${neuronId}', '1', '', '', '', 'soma']], valid: new Uint8Array([1]), groups: new Uint8Array([0]) };
        function Harness() {
          const [overlay, onOverlay] = useState(null);
          return React.createElement(AtlasActivity, { data, dataset: '${dataset}', scope: 'test-scope',
            individualId: null, visibleGroups: [0], selectedIndex: null, overlay, onOverlay });
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

async function openActivity(page) {
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
  await page.addInitScript(({ session, replay }) => {
    window.reads = [];
    window.pendingReads = [];
    window.fetch = async (url, options = {}) => {
      window.reads.push({ url, method: options.method ?? 'GET' });
      if (url === '/api/connectome-recordings') return new Response(JSON.stringify({ sessions: [session] }));
      if (url === '/api/connectome-recordings/test-recording/replay') {
        return new Promise(resolve => window.pendingReads.push({ signal: options.signal,
          resolve: () => resolve(new Response(JSON.stringify(replay))) }));
      }
      throw new Error('Unexpected request in isolated activity test');
    };
  }, { session, replay });
  await page.goto('/atlas-activity-regression');
  await expect.poll(async () => ({ errors, mounted: await page.getByRole('radio', { name: 'Recorded replay', exact: true }).count() })).toEqual({ errors: [], mounted: 1 });
  await page.getByRole('radio', { name: 'Recorded replay', exact: true }).check();
  await page.getByRole('button', { name: 'Overlay recording test-recording', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.pendingReads.length)).toBe(1);
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
