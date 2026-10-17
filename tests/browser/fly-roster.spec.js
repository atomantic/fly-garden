import { describeRuntime, expect, test } from './cdp-browser.js';
import { podPresentation } from '../../client/src/visitor-phase.js';

/**
 * Rendered evidence for the per-fly roster (issue #21 acceptance criterion 6; PRD FR-35, FR-38,
 * FR-40 and NFR-4).
 *
 * WHAT THIS IS NOT. No PortOS host is contacted, no credential is read, no admission is requested,
 * no provider is called and no individual is created. Every visitor and language route the page
 * touches is fulfilled by this spec on loopback with synthetic replies, and the second fly exists in
 * the browser only: both runtime snapshots are the server's own `/api/state` read with identity,
 * residency and visitor fields rewritten, so the schema the page validates stays real. This
 * substantiates the browser path alone: that keyboard selection moves between flies, that each
 * row's controls post to that row's individual and listed session whichever fly is selected, and
 * that a provider reply arriving after a selection change is shown under its initiating fly and
 * never under the newly selected one. It is not host, transport, admission or provider evidence;
 * those remain in `server/*.test.js` and the fixture integration records.
 */

const B_ID = 'bbbbbbbb-0000-4000-8000-000000000002', B_SESSION = 'partner-session-b';
const WORLD = 'garden-world';
const INTERPRETATION = 'Uncertain synthetic interpretation for the first fly.';

async function fixtures(page) {
  const baseline = await (await page.request.get('/api/state')).json();
  const a = { ...baseline, status: 'paused', externalOwner: null, sharedSession: null,
    persistence: { ...baseline.persistence, resident: true },
    visitor: { ...baseline.visitor, available: true, phase: 'home', owned: false, running: false, worldId: null,
      reason: 'Local bridge configured; explicit admission is required.' } };
  const b = { ...a, individualId: B_ID, sessionId: B_SESSION, externalOwner: { kind: 'managed-visitor' },
    visitor: { ...a.visitor, phase: 'visiting', owned: true, running: false, worldId: WORLD } };
  const pods = {
    [a.individualId]: { individualId: a.individualId, phase: 'home', owned: false, running: false, worldId: null },
    [B_ID]: { individualId: B_ID, phase: 'visiting', owned: true, running: false, worldId: WORLD },
  };
  const snapshots = { [a.individualId]: a, [B_ID]: b };
  const visitorCommands = [], languageCommands = [];
  let releaseChat = null;
  const chatReleased = new Promise(resolve => { releaseChat = resolve; });
  const languageView = id => ({ individualId: id, sessionId: snapshots[id].sessionId, available: true, reason: null,
    providers: [{ providerId: 'test', model: 'fixture', requestTokens: 4096, requestSpendMicros: 0, maxOutputTokens: 10 }],
    armed: id === a.individualId, pending: false, transportPending: false,
    config: id === a.individualId ? { providerId: 'test', model: 'fixture', maxCalls: 1, maxTokens: 4096, maxSpendMicros: 0, cooldownMs: 10000, detectorThresholdHz: 20 } : null,
    reserved: { calls: 0, tokens: 0, spendMicros: 0 }, aggregateReservedSpendMicros: 0, aggregateSpendMicros: 100000,
    events: [], detectorEnabled: false, failure: null, evidenceWindows: [],
    evidenceDisclosure: 'Synthetic browser fixture; no provider was called.', disclosure: 'Synthetic browser fixture.' });
  const views = { [a.individualId]: languageView(a.individualId), [B_ID]: languageView(B_ID) };

  await page.route('**/api/state', route => route.fulfill({ json: snapshots[a.individualId] }));
  await page.route('**/api/individuals', route => route.fulfill({ json: { protocolVersion: 1, individuals: Object.values(snapshots).map(
    item => ({ individualId: item.individualId, resident: true, sessionId: item.sessionId, checkpointId: item.persistence.checkpointId, branchOf: null })) } }));
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, eidoverse: { ...body.eidoverse, configured: true, individuals: Object.values(pods) } } });
  });
  for (const id of Object.keys(snapshots)) {
    await page.route(`**/api/individuals/${id}`, route => route.fulfill({ json: snapshots[id] }));
    await page.route(`**/api/individuals/${id}/visitor?capabilities=1`, route => route.fulfill({ json: { visitor: snapshots[id].visitor,
      capabilities: { available: true, worldIds: [WORLD], maxConcurrentVisitors: 2, interactionAvailable: false, patchObjects: [], interactionEffects: [],
        reason: 'Synthetic browser fixture; no host was contacted.' } } }));
    await page.route(`**/api/individuals/${id}/visitor`, async route => {
      const body = route.request().postDataJSON();
      visitorCommands.push({ url: id, ...body });
      const phase = body.operation === 'admit' ? 'admission' : body.operation === 'home' ? 'returning' : snapshots[id].visitor.phase;
      const owned = body.operation === 'admit' || snapshots[id].visitor.owned;
      snapshots[id] = { ...snapshots[id], commandSequence: body.sequence, externalOwner: owned ? { kind: 'managed-visitor' } : null,
        visitor: { ...snapshots[id].visitor, phase, owned, worldId: body.operation === 'admit' ? body.payload.worldId : snapshots[id].visitor.worldId } };
      pods[id] = { ...pods[id], phase, owned, worldId: snapshots[id].visitor.worldId };
      await route.fulfill({ json: { state: snapshots[id], visitor: snapshots[id].visitor } });
    });
    await page.route(`**/api/individuals/${id}/language`, async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: views[id] });
      const body = route.request().postDataJSON();
      languageCommands.push({ url: id, ...body });
      if (body.operation !== 'chat') return route.fulfill({ json: { state: snapshots[id], language: views[id], result: null } });
      views[id] = { ...views[id], pending: true };
      await chatReleased;
      const result = { status: 'complete', interpretation: INTERPRETATION, uncertainty: 'Generated interpretation may be incorrect.',
        requestId: body.payload.requestId, individualId: id, sessionId: body.sessionId, providerId: 'test', model: 'fixture' };
      views[id] = { ...views[id], pending: false, reserved: { calls: 1, tokens: 4096, spendMicros: 0 }, events: [{ eventId: 'event-1', ...result }] };
      snapshots[id] = { ...snapshots[id], commandSequence: body.sequence };
      await route.fulfill({ json: { state: snapshots[id], language: views[id], result } });
    });
  }
  return { a, b, pods, snapshots, visitorCommands, languageCommands, releaseChat: () => releaseChat() };
}

const row = (page, id) => page.locator(`.fly-roster-row[data-individual="${id}"]`);
const radio = (page, id) => row(page, id).getByRole('radio');
const toolbarSelect = page => page.locator('.toolbar-individual select');

test('arrow keys move the selection between flies, and each row reports its own pod phase as text', async ({ page }, info) => {
  const { a } = await fixtures(page);
  await page.goto('/#Eidoverse');
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);
  const roster = page.getByRole('region', { name: 'Fly roster' });
  await expect(roster).toBeVisible();
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true');
  await expect(radio(page, B_ID)).toHaveAttribute('aria-checked', 'false');
  await expect(toolbarSelect(page)).toHaveValue(a.individualId);
  // The phases are legible as text, per row, not only as a tone class.
  await expect(row(page, a.individualId).getByRole('status')).toContainText(podPresentation({ phase: 'home' }).label);
  await expect(row(page, a.individualId).getByRole('status')).toContainText('home controller available');
  await expect(row(page, B_ID).getByRole('status')).toContainText(podPresentation({ phase: 'visiting', worldId: WORLD }).label);
  await expect(row(page, B_ID).getByRole('status')).toContainText(`destination ${WORLD}`);
  await expect(row(page, B_ID).getByRole('status')).toContainText('owned by the bridge');
  await expect(row(page, a.individualId)).toHaveClass(/pod-idle/);
  await expect(row(page, B_ID)).toHaveClass(/pod-active/);

  // Only the checked radio is in the Tab order; the group is one stop.
  await expect(radio(page, a.individualId)).toHaveAttribute('tabindex', '0');
  await expect(radio(page, B_ID)).toHaveAttribute('tabindex', '-1');
  await radio(page, a.individualId).focus();
  const focused = async () => page.evaluate(() => ({ id: document.activeElement?.closest('.fly-roster-row')?.dataset.individual ?? null,
    outline: getComputedStyle(document.activeElement).outlineStyle, width: parseFloat(getComputedStyle(document.activeElement).outlineWidth) || 0 }));
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, B_ID)).toHaveAttribute('aria-checked', 'true');
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'false');
  await expect(toolbarSelect(page)).toHaveValue(B_ID);
  expect((await focused()).id).toBe(B_ID);
  // The selected fly's own visitor panel now describes the second fly's acknowledged visit.
  await expect(page.getByRole('region', { name: 'Managed Eidoverse visitor' }).getByRole('status'))
    .toContainText(podPresentation({ phase: 'visiting', worldId: WORLD }).label);
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
  await expect(toolbarSelect(page)).toHaveValue(a.individualId);
  await page.keyboard.press('End');
  await expect(radio(page, B_ID)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Home');
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true');
  expect((await focused()).id).toBe(a.individualId);
  const style = await focused();
  console.log(`[${info.project.name}] roster focus outline: ${JSON.stringify(style)}`);
  // Keyboard focus is visible on the roster radio when reached by keyboard.
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  const back = await focused();
  expect(back.id).toBe(a.individualId);
  expect(back.outline).not.toBe('none');
  expect(back.width).toBeGreaterThan(0);
});

test('each row\'s Visit and Return controls post to that row\'s fly and session, whichever fly is selected', async ({ page }, info) => {
  const { a, visitorCommands } = await fixtures(page);
  await page.goto('/#Eidoverse');
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true');
  // A is selected. B's row, the visiting fly, offers only Return; A's row, at home, offers a visit.
  const returnB = row(page, B_ID).getByRole('button', { name: 'Return home (paused)' });
  await expect(returnB).toBeVisible();
  await expect(row(page, B_ID).getByRole('button', { name: 'Check worlds' })).toHaveCount(0);
  await expect(row(page, a.individualId).getByRole('button', { name: 'Return home (paused)' })).toHaveCount(0);
  await returnB.click();
  await expect.poll(() => visitorCommands.length).toBe(1);
  expect(visitorCommands[0]).toEqual({ url: B_ID, protocolVersion: 1, individualId: B_ID, sessionId: B_SESSION, sequence: a.commandSequence + 1, operation: 'home', payload: {} });
  // The reply is reflected on B's row at once, while A stays selected and untouched.
  await expect(row(page, B_ID).getByRole('status')).toContainText(podPresentation({ phase: 'returning' }).label);
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, a.individualId).getByRole('status')).toContainText(podPresentation({ phase: 'home' }).label);

  // Now select B by keyboard and request a visit for A from A's own row.
  await radio(page, a.individualId).focus();
  await page.keyboard.press('ArrowDown');
  await expect(radio(page, B_ID)).toHaveAttribute('aria-checked', 'true');
  await row(page, a.individualId).getByRole('button', { name: 'Check worlds' }).click();
  const world = row(page, a.individualId).getByRole('combobox');
  await expect(world).toHaveValue(WORLD);
  await row(page, a.individualId).getByRole('button', { name: 'Request visit (paused)' }).click();
  await expect.poll(() => visitorCommands.length).toBe(2);
  expect(visitorCommands[1]).toEqual({ url: a.individualId, protocolVersion: 1, individualId: a.individualId, sessionId: a.sessionId,
    sequence: a.commandSequence + 1, operation: 'admit', payload: { worldId: WORLD } });
  await expect(row(page, a.individualId).getByRole('status')).toContainText(podPresentation({ phase: 'admission', worldId: WORLD }).label);
  await expect(row(page, a.individualId).getByRole('status')).not.toContainText(/ARRIV|LANDED|WELCOME/i);
  // B remained the selection throughout and received no admission.
  await expect(radio(page, B_ID)).toHaveAttribute('aria-checked', 'true');
  expect(visitorCommands.filter(command => command.url === B_ID).map(command => command.operation)).toEqual(['home']);
  expect(visitorCommands.every(command => command.url === command.individualId)).toBe(true);
  console.log(`[${info.project.name}] per-row visitor commands: ${JSON.stringify(visitorCommands.map(({ url, individualId, sessionId, operation }) => ({ url, individualId, sessionId, operation })))}`);
});

test('a provider reply that lands after a selection change is kept with its initiating fly and never shown under the other', async ({ page }, info) => {
  const { a, languageCommands, releaseChat } = await fixtures(page);
  await page.goto('/#Language');
  const panel = page.getByRole('region', { name: 'Optional telemetry interpreter' });
  await expect(panel).toContainText(`Recipient: individual ${a.individualId}`);
  await expect(panel).toContainText('Armed · No pending request');
  // Keyboard only: the message is typed and the request submitted without a pointer (NFR-4).
  await panel.getByLabel('Caretaker message (at most 1000 characters)').focus();
  await page.keyboard.type('Describe the current telemetry.');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Send explicit caretaker request' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => languageCommands.length).toBe(1);
  expect(languageCommands[0].url).toBe(a.individualId);
  expect(languageCommands[0].operation).toBe('chat');
  const requestId = languageCommands[0].payload.requestId;
  await expect(panel).toContainText(`Caretaker request ${requestId} for this fly is still with the provider`);

  // Change the selection while the provider is still "thinking".
  await toolbarSelect(page).selectOption(B_ID);
  await expect(panel).toContainText(`Recipient: individual ${B_ID}`);
  await expect(panel).toContainText('No language requests or configuration events.');
  await expect(panel).not.toContainText(requestId);
  // No cancellation was issued for the first fly by the selection change.
  expect(languageCommands.map(command => command.operation)).toEqual(['chat']);

  releaseChat();
  // Give the reply every chance to leak into the second fly's panel: it must not.
  await page.waitForTimeout(1500);
  await expect(panel).toContainText(`Recipient: individual ${B_ID}`);
  await expect(panel).not.toContainText(INTERPRETATION);
  await expect(panel).not.toContainText(requestId);

  // The roster attributes the received reply to the first fly, not the second.
  await page.goto('/#Eidoverse');
  await expect(row(page, a.individualId).getByRole('status')).toContainText('interpreter reply received · kept with this fly');
  await expect(row(page, B_ID).getByRole('status')).not.toContainText('interpreter');
  // Return to the first fly by keyboard; its panel shows the reply under its own recipient line.
  await radio(page, B_ID).focus();
  await page.keyboard.press('ArrowUp');
  await expect(radio(page, a.individualId)).toHaveAttribute('aria-checked', 'true');
  await page.goto('/#Language');
  await expect(panel).toContainText(`Recipient: individual ${a.individualId}`);
  const held = panel.locator('.language-held[data-request]');
  await expect(held).toHaveAttribute('data-request', requestId);
  await expect(held).toContainText(INTERPRETATION);
  await expect(held).toContainText(`individual ${a.individualId}`);
  await expect(held).toContainText('was not shown under any other fly');
  await expect(panel).toContainText('Reserved: 1 calls');
  await page.goto('/#Eidoverse');
  await expect(row(page, a.individualId).getByRole('status')).toContainText('interpreter reply shown under this fly');
  expect(languageCommands.map(command => [command.url, command.operation])).toEqual([[a.individualId, 'chat']]);
  console.log(`[${info.project.name}] language commands: ${JSON.stringify(languageCommands.map(({ url, individualId, sessionId, operation }) => ({ url, individualId, sessionId, operation })))}`);
});
