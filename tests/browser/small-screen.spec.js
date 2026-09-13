import { expect, test } from '@playwright/test';

const VIEWPORT = { width: 390, height: 844 };

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const widest = [...document.querySelectorAll('body *')]
      .map(element => ({ element, right: element.getBoundingClientRect().right }))
      .sort((a, b) => b.right - a.right)[0];
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      widest: widest ? `${widest.element.tagName}.${widest.element.className}`.slice(0, 80) : null,
      widestRight: widest ? Math.round(widest.right) : null,
    };
  });
}

test('the Observatory fits a 390 by 844 viewport without horizontal scrolling', async ({ page }, info) => {
  expect(page.viewportSize()).toEqual(VIEWPORT);
  await page.goto('/#Observatory');
  await expect(page.getByRole('heading', { name: 'Inside the circuit' })).toBeVisible();
  await expect(page.locator('.scene canvas').first()).toBeVisible();
  const overflow = await horizontalOverflow(page);
  console.log(`[${info.project.name}] Observatory layout: ${JSON.stringify(overflow)}`);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  // The sidebar collapses into a horizontal navigation strip rather than overlapping the content.
  const nav = await page.locator('nav').boundingBox();
  const main = await page.locator('main').boundingBox();
  expect(nav.y + nav.height).toBeLessThanOrEqual(main.y + 1);
  await expect(page.getByRole('link', { name: /Fixture garden/ })).toBeVisible();
});

test('the Nervous system tab fits the same viewport in whichever state its pinned data is in', async ({ page }, info) => {
  await page.goto('/#Nervous%20system');
  await expect(page.getByRole('heading', { name: 'Brain and nerve cord' })).toBeVisible();
  const loaded = page.getByRole('region', { name: 'Searchable anatomical cells' });
  const unavailable = page.getByRole('alert');
  await expect(loaded.or(unavailable).first()).toBeVisible({ timeout: 60_000 });
  const available = await loaded.count();
  if (available) {
    console.log(`[${info.project.name}] Nervous system rendered pinned anatomy`);
    await expect(page.getByLabel(/Search cells by exact ID/)).toBeVisible();
  } else {
    // data/ is gitignored, so a fresh checkout legitimately has no pinned atlas. Assert the honest state.
    const message = (await unavailable.first().textContent()).trim();
    console.log(`[${info.project.name}] Nervous system unavailable state: ${message}`);
    expect(message).toMatch(/pinned atlas|unavailable/i);
  }
  const overflow = await horizontalOverflow(page);
  console.log(`[${info.project.name}] Nervous system layout: ${JSON.stringify(overflow)}`);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});
