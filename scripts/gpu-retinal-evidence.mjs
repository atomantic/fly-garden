/**
 * Drives the two research retinal-evidence pages on a real graphics device and records what they
 * measured. Explicit manual invocation only:
 *
 *   FLY_GARDEN_CDP_ENDPOINT=http://127.0.0.1:9222 node scripts/gpu-retinal-evidence.mjs
 *
 * It starts a local Vite development server on a dedicated loopback port, connects to an already
 * running Chrome over the DevTools Protocol, and opens its own isolated browser context. It runs no
 * simulation, creates no individual, issues no app API call and sends nothing off the loopback
 * interface.
 *
 * Safety contract for the attached browser, which is a person's own live Chrome:
 * this script only ever creates its own context and pages, navigates them to 127.0.0.1, and closes
 * exactly what it created. It never enumerates, reads, navigates or closes a pre-existing page, and
 * it never calls `browser.close()`, which could terminate someone's browser session.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const endpoint = process.env.FLY_GARDEN_CDP_ENDPOINT;
if (!endpoint) {
  console.error('Set FLY_GARDEN_CDP_ENDPOINT to the CDP endpoint of a browser with a real graphics device.');
  process.exit(1);
}
const port = Number(process.env.GPU_EVIDENCE_PORT ?? 8793);
const origin = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('../', import.meta.url));
const resultsDir = fileURLToPath(new URL('../research/results/', import.meta.url));

const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${origin}/research/shared-retinal.html`);
      if (response.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local development server did not start on ${origin}`);
};

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
let browser = null, context = null;
try {
  await waitForServer();
  browser = await chromium.connectOverCDP(endpoint);
  // An isolated context of this script's own, never the attached browser's existing one.
  context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', message => console.log(`[page] ${message.text()}`));

  const device = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return { available: false };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      available: true,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      glVersion: gl.getParameter(gl.VERSION),
    };
  });
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const provenance = { ...device, userAgent, measuredWith: 'real browser over CDP', date: new Date().toLocaleDateString('en-CA') };
  console.log(`device: ${JSON.stringify(provenance)}`);

  const run = async (path, buttonId) => {
    await page.goto(`${origin}${path}`, { waitUntil: 'load' });
    await page.locator(`#${buttonId}`).click();
    await page.waitForFunction(() => document.querySelector('#result').textContent.trim().length > 0
      || document.querySelector('#status').textContent.startsWith('Unavailable'), null, { timeout: 60_000 });
    const status = (await page.locator('#status').textContent()).trim();
    const text = (await page.locator('#result').textContent()).trim();
    if (!text) throw new Error(`${path} produced no result: ${status}`);
    console.log(`${path}: ${status}`);
    return JSON.parse(text);
  };

  mkdirSync(resultsDir, { recursive: true });
  const write = (name, value) => {
    writeFileSync(`${resultsDir}${name}`, `${JSON.stringify(value, null, 1)}\n`);
    console.log(`wrote research/results/${name}`);
  };

  const neural = await run('/research/shared-retinal.html', 'neural');
  write('shared-neural-retinal-gpu.json', { ...neural, provenance });
  console.log(`shared coupling: ${JSON.stringify(neural.comparisons)}`);

  const controller = await run('/research/controller-retina.html', 'run');
  write('controller-retina-gpu.json', { ...controller, provenance });
  console.log(`observer: ${JSON.stringify(controller.observerChanges.map(c => [c.name, c.changedChannels, c.absoluteDifference]))}`);
  console.log(`pose: ${JSON.stringify(controller.poseChanges.map(c => [c.name, c.changedChannels, c.absoluteDifference]))}`);

  await page.close();
} finally {
  await context?.close().catch(() => {});
  // Deliberately no browser.close(): the attached browser belongs to the person running this.
  vite.kill('SIGTERM');
}
process.exit(0);
