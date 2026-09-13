import { expect, test } from '@playwright/test';

/** Forces a real GPU drawing-context loss on the atlas point cloud and checks that anatomy stays
 * reachable. Losing a context is a display failure; it must never look like missing cells. */
test('a forced WEBGL_lose_context on the atlas keeps every cell in the searchable table', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.goto('/#Nervous%20system');
  await expect(page.getByRole('heading', { name: 'Brain and nerve cord' })).toBeVisible();

  const table = page.getByRole('region', { name: 'Searchable anatomical cells' });
  const alert = page.getByRole('alert');
  await expect(table.or(alert).first()).toBeVisible({ timeout: 120_000 });

  if (!(await table.count())) {
    // data/ is gitignored. Without pinned anatomy there is no context to lose; record the honest state.
    const message = (await alert.first().textContent()).trim();
    console.log(`[${info.project.name}] pinned atlas unavailable, context loss not exercised: ${message}`);
    expect(message).toMatch(/pinned atlas|unavailable/i);
    info.annotations.push({ type: 'not-exercised', description: 'no pinned atlas data; WEBGL_lose_context was not triggered' });
    return;
  }

  const canvas = page.locator('canvas[aria-label*="anatomical point cloud"]');
  await expect(canvas).toBeVisible();
  const countsBefore = (await page.getByRole('status').first().textContent()).trim();
  const rowsBefore = await table.locator('tbody tr').count();
  const fit = page.getByRole('button', { name: 'Fit visible anatomy' });
  await expect(fit).toBeEnabled();
  console.log(`[${info.project.name}] before loss: ${rowsBefore} listed rows · ${countsBefore}`);

  const triggered = await page.evaluate(() => {
    const element = document.querySelector('canvas[aria-label*="anatomical point cloud"]');
    if (!element) return 'no canvas';
    const gl = element.getContext('webgl2') || element.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return 'no WEBGL_lose_context extension';
    extension.loseContext();
    return 'lost';
  });
  console.log(`[${info.project.name}] WEBGL_lose_context trigger: ${triggered}`);
  expect(triggered, 'the headless browser must expose WEBGL_lose_context to produce this evidence').toBe('lost');

  await expect(page.getByRole('alert')).toContainText('Graphics context lost');
  await expect(page.getByRole('alert')).toContainText('searchable cell table remains available');
  // Camera commands and the redraw benchmark are disabled; nothing can pretend the view is current.
  await expect(fit).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Measure 60 redraws' })).toBeDisabled();

  // The anatomy itself is untouched: the same counts and the same searchable rows remain.
  const rowsAfter = await table.locator('tbody tr').count();
  expect(rowsAfter).toBe(rowsBefore);
  await expect(page.getByRole('status').first()).toHaveText(countsBefore);
  const search = page.getByLabel(/Search cells by exact ID/);
  const firstCell = (await table.locator('tbody tr td button').first().textContent()).trim();
  await search.fill(firstCell);
  await expect(table.locator('tbody tr')).not.toHaveCount(0);
  console.log(`[${info.project.name}] after loss: ${rowsAfter} listed rows, exact-ID search for ${firstCell} still resolves`);
});
