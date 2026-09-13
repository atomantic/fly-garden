import { describeRuntime, expect, test } from './cdp-browser.js';
import { PANELS, STATE_WORDS, markPanel, settledPanelText, tabThroughPanel } from './panel-accessibility.js';

/**
 * The same NFR-4 panel checks, plus FR-12's small-screen layout, with the
 * primary fixture individual explicitly loaded **paused**.
 *
 * This is the only spec in the suite that issues a lifecycle command, so it runs
 * only when a person sets `FLY_GARDEN_BROWSER_FIXTURE=1` for that run. Unset — CI
 * included — it skips and records why. Even when it runs it loads and then
 * unloads: no start, no advance, no probe, no stimulus, no provider call, and the
 * suite's own empty identity directory is left as it was found.
 */
const enabled = process.env.FLY_GARDEN_BROWSER_FIXTURE === '1';
const VIEWPORT = { width: 390, height: 844 };

async function envelope(page) {
  const state = await (await page.request.get('/api/state')).json();
  return { protocolVersion: 1, individualId: state.individualId, sessionId: state.sessionId, sequence: state.commandSequence + 1 };
}

async function lifecycle(page, operation) {
  const body = await envelope(page);
  const response = await page.request.post(`/api/individuals/${body.individualId}/${operation}`, { data: body });
  expect(response.ok(), `${operation} failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.describe('with one explicitly loaded, paused fixture individual', () => {
  test.skip(!enabled, 'No lifecycle command is issued unless FLY_GARDEN_BROWSER_FIXTURE=1 is set for this run.');
  let loaded = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    loaded = await lifecycle(page, 'load');
    expect(loaded.persistence.resident).toBeTruthy();
    // Loading is paused by contract. Assert the field the runtime actually publishes:
    // an earlier draft checked `loaded.running`, which this snapshot does not carry, so
    // it passed on undefined and proved nothing.
    expect(loaded).toHaveProperty('status');
    expect(loaded.status, 'load must not leave the individual running').not.toEqual('running');
    console.log(`[resident-fixture] loaded ${loaded.individualId} · status ${loaded.status} · resident ${loaded.persistence.resident}`);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    const unloaded = await lifecycle(page, 'unload');
    expect(unloaded.persistence.resident, 'the run must leave the store as it found it').toBeFalsy();
    console.log(`[resident-fixture] unloaded ${unloaded.individualId} · status ${unloaded.status} · resident ${unloaded.persistence.resident}`);
    await page.close();
  });

  for (const panel of PANELS) {
    test(`${panel.region} stays keyboard reachable and text-legible with a resident individual`, async ({ page }, info) => {
      test.setTimeout(120_000);
      await page.goto(`/#${encodeURIComponent(panel.tab)}`);
      const region = page.getByRole('region', { name: panel.region }).or(page.locator(`[aria-label="${panel.region}"]`));
      await expect(region.first()).toBeVisible({ timeout: 60_000 });
      await settledPanelText(page, panel.region);
      const marked = await markPanel(page, panel.region);
      expect(marked).not.toBeNull();
      console.log(`[${info.project.name}] ${panel.region} resident controls: ${JSON.stringify(marked.controls)}`);
      console.log(`[${info.project.name}] ${panel.region} resident text: ${marked.text.slice(0, 300)}`);
      for (const control of marked.controls) expect(control.name).not.toEqual('');
      expect(marked.text).toMatch(STATE_WORDS);
      if (marked.controls.length === 0) {
        console.log(`[${info.project.name}] ${panel.region}: no enabled controls even with a resident individual`);
        return;
      }
      const stops = await tabThroughPanel(page, marked.precedingFocusable + marked.controls.length + 25);
      const reached = new Set(stops.map(stop => stop.stop));
      console.log(`[${info.project.name}] ${panel.region}: reached ${reached.size} of ${marked.controls.length} by Tab after ${marked.precedingFocusable} preceding stops`);
      expect(marked.controls.filter(control => !reached.has(control.index))).toEqual([]);
      for (const stop of stops) {
        expect(stop.outlineStyle).not.toEqual('none');
        expect(stop.outlineWidth).toBeGreaterThan(0);
      }
    });
  }

  test('the Observatory fits 390 by 844 with a resident individual and its lifecycle stays readable', async ({ page }, info) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/#Observatory');
    await expect(page.getByRole('heading', { name: 'Inside the circuit' })).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth, innerWidth: window.innerWidth }));
    console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);
    console.log(`[${info.project.name}] resident Observatory at 390x844: ${JSON.stringify(overflow)}`);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    const lifecycleText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    expect(lifecycleText).toMatch(/PAUSED|RESTING|RUNNING/i);
    const nav = await page.locator('nav').boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(nav.y + nav.height).toBeLessThanOrEqual(main.y + 1);
  });
});
