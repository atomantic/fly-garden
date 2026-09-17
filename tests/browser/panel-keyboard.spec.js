import { describeRuntime, expect, test } from './cdp-browser.js';
import { PANELS, STATE_WORDS, markPanel, settledPanelText, tabThroughPanel } from './panel-accessibility.js';

/**
 * NFR-4 for the panels the earlier recorded run did not reach: the shared
 * population, the managed visitor, the language interpreter and the full
 * connectome lab. Each check presses Tab and reads text and computed styles.
 * No lifecycle, neural, provider or host command is issued by this spec.
 */
test('shared encounter controls allow deliberate per-member opt-in without an independent camera', async ({ page }) => {
  const baseline = await (await page.request.get('/api/state')).json();
  const shared = { version: 2, sharedId: 'browser-shared', worldEpoch: 1, commandSequence: 0,
    tick: 0, worldTimeMs: 0, status: 'running', participants: [
      { individualId: baseline.individualId, sessionId: baseline.sessionId, mode: 'active',
        simTimeMs: 0, pose: { x: 0, z: 0, yaw: 0 } },
      { individualId: 'browser-partner', sessionId: 'partner-session', mode: 'active',
        simTimeMs: 0, pose: { x: 1, z: 0, yaw: 0 } },
    ] };
  const member = { ...baseline, status: 'running', sharedSession: shared,
    persistence: { ...baseline.persistence, resident: true },
    environmentAdapter: { ...baseline.environmentAdapter, attached: false },
    encounterDynamics: { ...baseline.encounterDynamics, enabled: false } };
  const partner = { ...member, individualId: 'browser-partner', sessionId: 'partner-session' };
  const commands = [];
  await page.route('**/api/state', route => route.fulfill({ json: member }));
  await page.route('**/api/individuals', route => route.fulfill({ json: { individuals: [member, partner] } }));
  await page.route('**/api/shared/browser-shared', route => route.fulfill({ json: { shared, members: [member, partner] } }));
  await page.route(`**/api/individuals/${member.individualId}/garden`, async route => {
    const body = route.request().postDataJSON();
    commands.push(body);
    member.commandSequence = body.sequence;
    member.encounterDynamics = { ...member.encounterDynamics, enabled: body.enabled, phase: 'armed-awaiting-observation' };
    await route.fulfill({ json: member });
  });
  await page.goto('/#Observatory');
  const enable = page.getByRole('button', { name: 'Enable optional flower encounters', exact: true });
  const disable = page.getByRole('button', { name: 'Disable flower encounters', exact: true });
  await expect(page.getByRole('button', { name: 'Attach controller camera (paused)', exact: true })).toBeDisabled();
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(disable).toBeEnabled();
  expect(commands).toEqual([{ protocolVersion: 1, individualId: member.individualId,
    sessionId: member.sessionId, sequence: baseline.commandSequence + 1, enabled: true }]);
  expect(partner.encounterDynamics.enabled).toBe(false);
  await disable.click();
  await expect(enable).toBeEnabled();
  expect(commands[1]).toEqual({ ...commands[0], sequence: commands[0].sequence + 1, enabled: false });
  member.status = 'resting'; shared.participants[0].mode = 'resting';
  await expect(enable).toBeDisabled();
  member.status = 'running'; shared.participants[0].mode = 'active';
  await expect(enable).toBeEnabled();
  shared.status = 'paused';
  await expect(enable).toBeDisabled();
  shared.status = 'running';
  await expect(enable).toBeEnabled();
  member.externalOwner = { kind: 'managed-visitor' };
  await expect(enable).toBeDisabled();
  expect(commands).toHaveLength(2);
});

for (const panel of PANELS) {
  test(`${panel.region} is fully keyboard reachable with a visible focus outline`, async ({ page }, info) => {
    // Each Tab press is one round trip, and these panels sit deep in the document's
    // focus order, so the default per-test timeout is not enough for the walk.
    test.setTimeout(120_000);
    await page.goto(`/#${encodeURIComponent(panel.tab)}`);
    const region = page.getByRole('region', { name: panel.region }).or(page.locator(`[aria-label="${panel.region}"]`));
    await expect(region.first()).toBeVisible({ timeout: 60_000 });
    await settledPanelText(page, panel.region);
    const marked = await markPanel(page, panel.region);
    expect(marked, `panel ${panel.region} was not found`).not.toBeNull();
    if (info.project.name === 'panels') console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);
    console.log(`[${info.project.name}] ${panel.region}: ${marked.controls.length} reachable controls ${JSON.stringify(marked.controls)}`);

    // Every enabled control in the panel has an accessible name, so a keyboard or
    // screen-reader user is never told only "button".
    for (const control of marked.controls) expect(control.name, `unnamed ${control.tag} in ${panel.region}`).not.toEqual('');

    // A panel can legitimately have no enabled control: the language interpreter
    // disables everything when no provider is configured. That state is recorded as
    // itself — the panel must still say what it is — rather than passing vacuously.
    if (marked.controls.length === 0) {
      console.log(`[${info.project.name}] ${panel.region}: no enabled controls in this state; text: ${marked.text.slice(0, 200)}`);
      expect(marked.text).toMatch(STATE_WORDS);
      return;
    }

    const stops = await tabThroughPanel(page, marked.precedingFocusable + marked.controls.length + 25);
    const reached = new Set(stops.map(stop => stop.stop));
    const missing = marked.controls.filter(control => !reached.has(control.index));
    console.log(`[${info.project.name}] ${panel.region}: reached ${reached.size} of ${marked.controls.length} by Tab after ${marked.precedingFocusable} preceding stops of ${marked.documentFocusable} in the document; missing ${JSON.stringify(missing)}`);
    expect(missing).toEqual([]);
    expect(stops.length).toBeGreaterThan(0);

    // The focus outline is measured on each stop rather than assumed from the stylesheet.
    const outlines = stops.map(stop => `${stop.outlineStyle} ${stop.outlineWidth}px ${stop.outlineColor}`);
    console.log(`[${info.project.name}] ${panel.region}: focus outlines ${JSON.stringify([...new Set(outlines)])}`);
    for (const stop of stops) {
      expect(stop.outlineStyle, `no focus outline style on ${stop.tag}`).not.toEqual('none');
      expect(stop.outlineWidth, `zero-width focus outline on ${stop.tag}`).toBeGreaterThan(0);
    }
  });

  test(`${panel.region} states its condition as text, not only as colour`, async ({ page }, info) => {
    await page.goto(`/#${encodeURIComponent(panel.tab)}`);
    const region = page.getByRole('region', { name: panel.region }).or(page.locator(`[aria-label="${panel.region}"]`));
    await expect(region.first()).toBeVisible({ timeout: 60_000 });
    await settledPanelText(page, panel.region);
    const marked = await markPanel(page, panel.region);
    console.log(`[${info.project.name}] ${panel.region} live regions: ${JSON.stringify(marked.statuses)}`);
    console.log(`[${info.project.name}] ${panel.region} text: ${marked.text.slice(0, 300)}`);
    // Whatever state this panel is in, it is legible from its rendered text.
    expect(marked.text).toMatch(STATE_WORDS);
    for (const status of marked.statuses) expect(status).not.toEqual('');
    // Pressed and current controls expose their state to assistive technology rather
    // than only by colour.
    const stateful = await page.evaluate(name => {
      const panel = [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === name);
      return [...panel.querySelectorAll('[aria-pressed],[aria-current],[aria-expanded],[aria-checked]')]
        .map(element => ({ tag: element.tagName.toLowerCase(), state: element.getAttribute('aria-pressed') ?? element.getAttribute('aria-current')
          ?? element.getAttribute('aria-expanded') ?? element.getAttribute('aria-checked'), text: element.innerText.replace(/\s+/g, ' ').trim().slice(0, 40) }));
    }, panel.region);
    console.log(`[${info.project.name}] ${panel.region} exposed control states: ${JSON.stringify(stateful)}`);
    for (const control of stateful) expect(control.state).not.toBeNull();
  });
}
