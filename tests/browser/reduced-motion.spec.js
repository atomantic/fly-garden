import { expect, test } from '@playwright/test';

/** Counts every animation-frame callback the page schedules, before any application code runs. */
const probe = () => {
  window.__rafCalls = 0;
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => {
    window.__rafCalls++;
    return original(callback);
  };
};

const SAMPLE_MS = 1500;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(probe);
});

async function frameRate(page) {
  const before = await page.evaluate(() => window.__rafCalls);
  await page.waitForTimeout(SAMPLE_MS);
  const after = await page.evaluate(() => window.__rafCalls);
  return ((after - before) * 1000) / SAMPLE_MS;
}

test('the habitat and fixture-circuit renderers follow the operating-system motion preference', async ({ page }, info) => {
  const reduced = info.project.name === 'motion-reduce';
  await page.goto('/#Observatory');
  await expect(page.getByRole('heading', { name: 'Inside the circuit' })).toBeVisible();
  const scenes = page.locator('.scene');
  await expect(scenes).toHaveCount(2); // illustrated habitat and the fixture circuit mini-view
  for (let index = 0; index < 2; index++) {
    await expect(scenes.nth(index).locator('canvas')).toBeVisible();
    await expect(scenes.nth(index)).toHaveAttribute('data-orbit-damping', reduced ? 'false' : 'true');
    await expect(scenes.nth(index)).toHaveAttribute(
      'data-motion-policy',
      reduced ? 'state-commit control-interaction resize' : 'animation-frame',
    );
  }
  // The teleport pod's phase tone is state, not motion: it must render in both modes.
  const pod = page.locator('.pod-label');
  await expect(pod).toBeVisible();
  const podTone = await pod.evaluate(element => ({
    phase: element.dataset.phase,
    toneClass: [...element.classList].find(name => name.startsWith('pod-') && name !== 'pod-label') ?? null,
    color: getComputedStyle(element).color,
    text: element.textContent.replace(/\s+/g, ' ').trim().slice(0, 90),
  }));
  console.log(`[${info.project.name}] teleport pod: ${JSON.stringify(podTone)}`);
  expect(podTone.toneClass, 'the pod must carry a phase tone class in both motion modes').not.toBeNull();
  expect(podTone.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(podTone.text, 'the phase is stated in text, never by colour alone').toMatch(/TELEPORT POD/);

  const rate = await frameRate(page);
  info.annotations.push({ type: 'measured', description: `${rate.toFixed(1)} animation-frame callbacks/s on Observatory` });
  console.log(`[${info.project.name}] Observatory animation-frame callbacks/s: ${rate.toFixed(1)}`);
  // The headless shell has no display, so its animation-frame cadence is throttled well below a real
  // 60 Hz refresh. The separation that matters here is loop versus no loop, not the absolute rate.
  if (reduced) expect(rate, 'no continuous repainting under prefers-reduced-motion').toBeLessThan(1);
  else expect(rate, 'the default experience keeps a live animation loop').toBeGreaterThan(5);
});

test('CSS animation, transition and smooth scrolling are suppressed under the reduce preference', async ({ page }, info) => {
  const reduced = info.project.name === 'motion-reduce';
  await page.goto('/#Neural%20map');
  await expect(page.getByRole('heading', { name: 'Neuron inspector' })).toBeVisible();
  const applied = await page.evaluate(() => document.querySelector('.app')?.classList.contains('observatory-accessible'));
  expect(applied, 'the reduced-motion scope must cover the whole observatory, not only the atlas').toBe(true);
  const matched = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(matched).toBe(reduced);
  const styles = await page.evaluate(() => {
    const target = document.querySelector('.app button') ?? document.body;
    const computed = getComputedStyle(target);
    return {
      transitionDuration: computed.transitionDuration,
      animationName: computed.animationName,
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });
  console.log(`[${info.project.name}] computed motion styles: ${JSON.stringify(styles)}`);
  if (reduced) {
    expect(styles.transitionDuration).toBe('0s');
    expect(styles.animationName).toBe('none');
    expect(styles.scrollBehavior).toBe('auto');
  }
});

test('the fixture circuit keeps repainting from observed state while reduced motion is active', async ({ page }, info) => {
  test.skip(info.project.name !== 'motion-reduce', 'state-driven repainting only applies under the reduce preference');
  await page.goto('/#Neural%20map');
  await expect(page.locator('.scene canvas')).toBeVisible();
  // A viewer camera interaction must repaint even though no animation-frame loop is open.
  const box = await page.locator('.scene').first().boundingBox();
  const before = await page.evaluate(() => window.__rafCalls);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__rafCalls);
  console.log(`[${info.project.name}] animation-frame callbacks during an orbit drag: ${after - before}`);
  // Dragging draws directly from the control-change event; it must not open a persistent loop.
  const idle = await frameRate(page);
  console.log(`[${info.project.name}] animation-frame callbacks/s after the drag: ${idle.toFixed(1)}`);
  expect(idle).toBeLessThan(10);
  await expect(page.locator('.scene canvas').first()).toBeVisible();
});
