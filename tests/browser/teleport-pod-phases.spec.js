import { describeRuntime, expect, test } from './cdp-browser.js';
import { VISITOR_PHASES, podPresentation } from '../../client/src/visitor-phase.js';

/**
 * Rendered evidence for the teleport pod's phase presentation (PRD FR-35, issue #9).
 *
 * WHAT THIS IS NOT. No PortOS host is contacted, no `mv1_` credential is read, no admission is
 * requested and no individual is created. The simulation stays paused throughout. The phase values
 * below are injected into the browser's own loopback read, so this substantiates the **client
 * rendering path only** — that a given `state.visitor.phase` renders the right tone, label and
 * motion wording in a real browser. It is not evidence that any visit occurred, and it may not be
 * cited as host, transport or admission evidence. Those live in `server/managed-visitor-*.test.js`
 * and `docs/LIVE_VISITOR_FIXTURE_EVIDENCE.md`.
 *
 * HOW THE PHASE IS SET. The route handler fetches the server's genuine `GET /api/state` response
 * and replaces exactly one field, `visitor`. Every other value the page renders stays real, so this
 * spec cannot drift away from the runtime payload schema the way a hand-written fixture would.
 *
 * BOTH MOTION MODES. The spec runs twice. Under `prefers-reduced-motion: reduce` it asserts that
 * every phase tone still reaches the rendered pod rings while the geometry never leaves its resting
 * height — the charter requirement that pod tone is *state*, not motion. Under the default
 * preference it asserts that `visiting`, and only `visiting`, actually moves that geometry.
 *
 * WHY A READBACK ATTRIBUTE. `Scene.jsx` publishes `data-pod-emissive`, `data-pod-intensity` and
 * `data-pod-offset` by reading back out of the three.js material and transform after writing them,
 * alongside the existing `data-motion-*` disclosures. Comparing rendered canvas pixels instead was
 * tried and rejected: the pod label is positioned over the scene box, so captures differed between
 * phases even with the tone forced to a constant, which would have made the check vacuous.
 */

const WORLD = 'garden-world';

/** The tone each phase must present, restated here so a silent edit to the phase table fails. */
const EXPECTED_TONE = {
  home: 'idle',
  admission: 'pending',
  departing: 'pending',
  visiting: 'active',
  returning: 'pending',
  reconnecting: 'fault',
  disconnected: 'fault',
  'timed-out': 'fault',
  blocked: 'fault',
};

/** The emissive colour each tone must actually write into the pod ring material, from `Scene.jsx`. */
const TONE_EMISSIVE = { idle: '1f3c36', pending: '5a5326', active: '35665a', fault: '6a3322' };

/** Mutable phase for the single route handler installed below. */
let injected = { phase: 'home' };

test.beforeEach(async ({ page }) => {
  injected = { phase: 'home' };
  await page.route('**/api/state', async route => {
    const response = await route.fetch();
    const body = await response.json();
    // Only `visitor` is synthetic; the rest of the runtime snapshot is the server's own.
    await route.fulfill({ response, json: { ...body, visitor: { ...body.visitor, ...injected } } });
  });
});

/** Drives the page to a phase and waits for the rendered pod to report it. */
async function showPhase(page, phase, worldId = WORLD) {
  injected = { phase, worldId };
  await expect(page.locator('.pod-label')).toHaveAttribute('data-phase', phase, { timeout: 10_000 });
}

async function readPod(page) {
  return page.locator('.pod-label').evaluate(element => ({
    phase: element.dataset.phase,
    tone: [...element.classList].find(name => name.startsWith('pod-') && name !== 'pod-label') ?? null,
    color: getComputedStyle(element).color,
    visible: getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0,
    text: element.textContent.replace(/\s+/g, ' ').trim(),
  }));
}

test('every bridge phase renders its own tone, label and motion wording in a browser', async ({ page }, info) => {
  await page.goto('/#Observatory');
  await expect(page.locator('.pod-label')).toBeVisible();
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);

  const seen = [];
  for (const phase of VISITOR_PHASES) {
    await showPhase(page, phase);
    const pod = await readPod(page);
    const expected = podPresentation({ phase, worldId: WORLD });

    expect(pod.visible, `${phase} must keep the pod on screen`).toBe(true);
    expect(pod.tone, `${phase} tone class`).toBe(`pod-${EXPECTED_TONE[phase]}`);
    expect(pod.tone).toBe(`pod-${expected.tone}`);
    // A tone that renders transparent, or inherits the body colour, is not a rendered tone.
    expect(pod.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(pod.text, `${phase} label`).toContain(expected.label);
    expect(pod.text).toContain('TELEPORT POD');

    // Acceptance criterion 1: the pod may only claim motion once the host has acknowledged.
    if (phase === 'visiting') expect(pod.text, 'acknowledged visit states pod motion').toContain('POD MOTION');
    else {
      expect(pod.text, `${phase} must not imply pod motion`).toContain('POD STILL');
      expect(pod.text, `${phase} must not imply arrival`).not.toMatch(/ARRIV|LANDED|WELCOME/i);
    }

    // The destination is named whenever one is requested, without claiming presence.
    if (phase === 'home') expect(pod.text).not.toContain('DESTINATION');
    else expect(pod.text, `${phase} destination`).toContain(`DESTINATION · ${WORLD}`);

    // The phase also reaches the habitat's accessible description, not only the text label.
    await expect(page.locator('.scene[role="img"]').first())
      .toHaveAttribute('aria-label', new RegExp(`Bridge phase: ${expected.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    seen.push({ phase, tone: pod.tone, color: pod.color });
  }

  console.log(`[${info.project.name}] rendered pod phases: ${JSON.stringify(seen)}`);
  // All nine phases were actually rendered, and the four tones are four distinct rendered colours.
  expect(seen).toHaveLength(VISITOR_PHASES.length);
  expect(new Set(seen.map(entry => entry.color)).size, 'each tone must render its own colour').toBe(4);
});

/** Largest ring displacement seen over a window. The bob passes through its resting height twice a
 * cycle, so a single sample could read zero mid-visit; the maximum cannot. */
async function peakOffsetDuring(page, ms) {
  const scene = page.locator('.scene').first();
  const deadline = Date.now() + ms;
  let peak = 0;
  do {
    peak = Math.max(peak, Number(await scene.getAttribute('data-pod-offset')) || 0);
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  return peak;
}

test('each phase tone reaches the pod ring material, and only an acknowledged visit moves it', async ({ page }, info) => {
  const reduced = info.project.name === 'pod-phases-reduce';
  await page.goto('/#Observatory');
  const scene = page.locator('.scene').first();
  await expect(scene.locator('canvas')).toBeVisible();
  await expect(scene).toHaveAttribute('data-motion-policy',
    reduced ? 'state-commit control-interaction resize' : 'animation-frame');
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);

  const drawn = [];
  for (const phase of VISITOR_PHASES) {
    await showPhase(page, phase);
    const tone = EXPECTED_TONE[phase];
    // Read back out of the three.js material, so this is the tone the renderer actually drew and
    // not a restatement of the React prop that produced it.
    await expect(scene, `${phase} emissive`).toHaveAttribute('data-pod-emissive', TONE_EMISSIVE[tone], { timeout: 10_000 });
    const intensity = await scene.getAttribute('data-pod-intensity');
    expect(Number(intensity), `${phase} emissive intensity`).toBeGreaterThan(0);

    // Acceptance criterion 1, measured on the rendered geometry: the rings may leave their resting
    // height only once the host has acknowledged, and never while reduced motion is requested.
    const shouldMove = phase === 'visiting' && !reduced;
    const peak = await peakOffsetDuring(page, shouldMove ? 1200 : 400);
    if (shouldMove) expect(peak, 'an acknowledged visit must move the pod rings').toBeGreaterThan(0);
    else expect(peak, `${phase} must hold the pod rings exactly still (reduced motion: ${reduced})`).toBe(0);
    drawn.push({ phase, tone, emissive: TONE_EMISSIVE[tone], intensity, peakOffset: peak });
  }

  console.log(`[${info.project.name}] pod ring material readback: ${JSON.stringify(drawn)}`);
  // The four tones are four distinct emissive colours on the rendered rings, not just four CSS rules.
  expect(new Set(drawn.map(entry => entry.emissive)).size).toBe(4);
  // Exactly one phase ever displaced the geometry, and under reduced motion no phase did.
  expect(drawn.filter(entry => entry.peakOffset > 0).map(entry => entry.phase)).toEqual(reduced ? [] : ['visiting']);
});
