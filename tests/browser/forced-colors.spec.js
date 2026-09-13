import { expect, test } from '@playwright/test';

/** Windows high-contrast / forced-colors emulation. Colour is replaced by the operating system,
 * so every state that the palette alone would carry must still be reachable by name and by focus. */
test('the observatory stays operable and keeps a visible focus indicator under forced colors', async ({ page }, info) => {
  await page.goto('/#Observatory');
  await expect(page.getByRole('heading', { name: 'Inside the circuit' })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);

  // Walk the keyboard order until focus lands on a real control, then read its actual outline.
  let focused = null;
  for (let step = 0; step < 30 && !focused; step++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const computed = getComputedStyle(element);
      return {
        tag: element.tagName,
        name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 60),
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineColor: computed.outlineColor,
      };
    });
  }
  expect(focused, 'keyboard focus must reach a control from the document start').not.toBeNull();
  console.log(`[${info.project.name}] first focused control: ${JSON.stringify(focused)}`);
  expect(focused.name.length, 'every focusable control needs an accessible name').toBeGreaterThan(0);
  expect(focused.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(focused.outlineWidth)).toBeGreaterThan(0);

  // Navigation, primary actions and the habitat alternative text survive colour substitution.
  for (const name of ['Fixture garden', 'Fixture circuit', 'Eidoverse', 'Nervous system']) {
    await expect(page.getByRole('link', { name, exact: false }).first()).toBeVisible();
  }
  await expect(page.getByRole('img', { name: /Original illustrated fly garden/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /Interactive synthetic neural graph/ })).toBeVisible();
});

test('status text, not colour alone, reports the fixture lifecycle under forced colors', async ({ page }, info) => {
  await page.goto('/#Observatory');
  const live = page.locator('.live-label');
  await expect(live).toBeVisible();
  const label = (await live.textContent()).trim();
  console.log(`[${info.project.name}] lifecycle label: ${label}`);
  expect(label).toMatch(/LIVE FIXTURE|PAUSED FIXTURE/);
  // The teleport-pod and habitat captions carry their disclosure as text, not as a coloured swatch.
  await expect(page.getByText('DROSOPHILA · ORIGINAL PROCEDURAL MODEL')).toBeVisible();
});
