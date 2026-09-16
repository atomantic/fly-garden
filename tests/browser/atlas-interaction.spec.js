import { summarizeHeap, summarizeLatency } from '../../client/src/atlas-performance-evidence.js';
import { ATLAS_PROFILES, REDRAW_MEASUREMENT, atlasCounts, atlasSettled, measureRedraws, notExercised, openNervousSystem } from './atlas-page.js';
import { describeRuntime, expect, test } from './cdp-browser.js';

/**
 * The two display figures acceptance criterion 7 of #29 still lacked: **edge-enabled** redraw
 * throughput at each bounded connection ceiling, and **interaction** latency on the fully loaded
 * atlas, with the renderer's real JavaScript heap beside them.
 *
 * Everything here is read-only display work. It loads no neural worker, creates no individual,
 * advances no simulated time, sends no stimulus and changes no setting; the only writes are the
 * viewer's own camera and selection, which the atlas already treats as display state. Enabling
 * connections reads the verified connectivity index and draws a bounded sample of it; the
 * simulated graph is never cropped or mutated by a display limit.
 *
 * A figure that is missing is recorded as missing and never estimated. `data/` is gitignored, so an
 * absent pinned atlas is not exercised rather than failed; so is a redraw the built-in control
 * abandons at its own 10-second limit, which a software rasterizer under load can exceed, and so is
 * a connectivity read the local server cannot complete.
 *
 * Figures belong in docs/ATLAS_DISPLAY_EVIDENCE.md with their renderer stated, because a software
 * rasterizer and a real GPU produce materially different numbers for the identical scene.
 */
const CEILINGS = [1000, 5000, 20000];

/**
 * The renderer's JavaScript heap in bytes, read through the DevTools Protocol.
 *
 * `performance.memory` is deliberately not used: outside a cross-origin-isolated page Chrome
 * returns a quantized, clamped value, and it was observed pinned at exactly 10,000,000 bytes for
 * every state of a 140,024-point atlas. Publishing that as a peak would be a fabricated figure.
 * `Performance.getMetrics` reports the real `JSHeapUsedSize`. Where no session can be opened the
 * reading is null, which `summarizeHeap` reports as unmeasured rather than as zero.
 */
async function heapBytes(session) {
  if (!session) return null;
  const { metrics } = await session.send('Performance.getMetrics').catch(() => ({ metrics: [] }));
  const used = metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
  return Number.isFinite(used) && used > 0 ? Math.round(used) : null;
}

/** A read-only metrics session, or null on any browser that will not give one. It sets nothing. */
async function openMetrics(page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    return session;
  } catch {
    return null;
  }
}

test('bounded connection ceilings publish edge-enabled redraw throughput and heap readings', async ({ page }, info) => {
  test.setTimeout(900_000);
  const session = await openMetrics(page);
  const readings = [{ label: 'before the atlas view opened', usedBytes: await heapBytes(session) }];
  await openNervousSystem(page);
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);

  const dataset = page.getByLabel('Atlas dataset');
  let recorded = 0;
  for (const profile of ATLAS_PROFILES) {
    if ((await dataset.inputValue()) !== profile.value) await dataset.selectOption(profile.value);
    const counts = await atlasSettled(page, info, `${profile.label} anatomy`);
    if (!counts) continue;
    readings.push({ label: `${profile.label} anatomy loaded`, usedBytes: await heapBytes(session) });
    console.log(`[${info.project.name}] ${profile.label} counts: ${counts}`);

    const settings = page.locator('details.atlas-display-settings');
    if (!(await settings.evaluate(element => element.open))) await settings.locator('summary').click();
    const connections = page.getByLabel(/Load the complete verified connectivity index/);
    if (!(await connections.isChecked())) await connections.check();

    for (const ceiling of CEILINGS) {
      await page.getByLabel('Sample ceiling').selectOption(String(ceiling));
      // Wait for the sample this ceiling actually produced before timing anything: a sample still
      // arriving would cancel the measurement it landed in.
      const sampling = page.getByText(/displayed after group filters/);
      const refused = page.getByRole('alert');
      await expect(sampling.or(refused).first()).toBeVisible({ timeout: 180_000 });
      if (!(await sampling.count())) {
        notExercised(info, `${profile.label} ceiling ${ceiling}`, (await refused.first().textContent()).trim());
        continue;
      }
      await expect(sampling).toContainText(`${ceiling.toLocaleString()} considered`, { timeout: 180_000 });
      const measured = await measureRedraws(page);
      readings.push({ label: `${profile.label} with a ${ceiling.toLocaleString()}-connection ceiling`, usedBytes: await heapBytes(session) });
      console.log(`[${info.project.name}] ${profile.label} ceiling ${ceiling}: ${(await sampling.textContent()).trim()}`);
      const parsed = measured.match(REDRAW_MEASUREMENT);
      if (!parsed) {
        notExercised(info, `${profile.label} ceiling ${ceiling} redraws`, measured);
        continue;
      }
      console.log(`[${info.project.name}] ${profile.label} ceiling ${ceiling} redraws: ${measured}`);
      info.annotations.push({ type: 'measured', description: `${profile.label} ceiling ${ceiling}: ${measured}` });
      // One observation per ceiling and no uncertainty estimate, so the assertion only checks that
      // lines were really drawn, never that throughput reached any particular rate.
      expect(Number(parsed[2].replaceAll(',', ''))).toBeGreaterThan(0);
      recorded++;
    }
    await connections.uncheck();
  }

  await session?.detach().catch(() => {});
  const heap = summarizeHeap(readings);
  console.log(`[${info.project.name}] renderer JavaScript heap: ${JSON.stringify(heap)}`);
  if (heap.available) info.annotations.push({ type: 'measured', description: `peak heap: ${JSON.stringify(heap.peak)}` });
  else notExercised(info, 'renderer heap', heap.reason);
  if (!recorded) notExercised(info, 'edge-enabled throughput', 'no ceiling produced a completed figure');
});

test('camera and selection interactions publish measured latency on the loaded atlas', async ({ page }, info) => {
  test.setTimeout(300_000);
  await openNervousSystem(page);
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);
  const counts = await atlasSettled(page, info, 'atlas interaction latency');
  if (!counts) return;
  console.log(`[${info.project.name}] counts: ${counts}`);

  const camera = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find(element => element.textContent.trim() === 'Rotate left');
    if (!button) return null;
    const handlerMs = [], toFrameMs = [];
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const started = performance.now();
      button.click();
      handlerMs.push(performance.now() - started);
      await new Promise(resolve => requestAnimationFrame(resolve));
      toFrameMs.push(performance.now() - started);
    }
    return { handlerMs, toFrameMs };
  });
  expect(camera, 'the atlas camera controls were not rendered').not.toBeNull();
  const handler = summarizeLatency(camera.handlerMs), toFrame = summarizeLatency(camera.toFrameMs);
  console.log(`[${info.project.name}] camera command handler: ${JSON.stringify(handler)}`);
  console.log(`[${info.project.name}] camera command to next animation frame: ${JSON.stringify(toFrame)}`);
  info.annotations.push({ type: 'measured', description: `camera handler median ${handler.medianMs.toFixed(2)} ms` });

  // Selection through the searchable table rather than canvas picking, so the figure does not
  // depend on what a pointer ray happens to hit and is recorded on the keyboard-reachable path.
  const selection = await page.evaluate(async () => {
    const heading = document.querySelector('section[aria-label="Anatomical cell inspector"] h3');
    const rows = [...document.querySelectorAll('[aria-label="Searchable anatomical cells"] tbody tr button')].slice(0, 10);
    if (!heading || rows.length < 2) return null;
    const samples = [], labels = [];
    for (const row of rows) {
      const before = heading.textContent;
      const settled = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (heading.textContent === before) return;
          observer.disconnect(); resolve(performance.now());
        });
        observer.observe(heading, { childList: true, characterData: true, subtree: true });
      });
      const started = performance.now();
      row.click();
      samples.push(await settled - started);
      labels.push(heading.textContent);
    }
    return { samples, labels };
  });
  expect(selection, 'fewer than two selectable cells were listed').not.toBeNull();
  // Every timed click selected a different cell, so no sample measured a no-op re-selection.
  expect(new Set(selection.labels).size).toBe(selection.labels.length);
  const select = summarizeLatency(selection.samples);
  console.log(`[${info.project.name}] table selection to inspector heading: ${JSON.stringify(select)}`);
  info.annotations.push({ type: 'measured', description: `selection median ${select.medianMs.toFixed(2)} ms` });

  // The camera and the selection are display state only: the counts line and the mode are unchanged.
  await expect(atlasCounts(page)).toHaveText(counts);
  await expect(page.getByRole('status').filter({ hasText: /Current mode:/ }).first()).toContainText('Anatomy only');
});
