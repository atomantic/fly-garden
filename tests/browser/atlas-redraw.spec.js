import { describeRuntime, expect, test } from './cdp-browser.js';

/**
 * Re-runs the atlas's own built-in **Measure 60 redraws** control through the production Nervous
 * system view, once per pinned profile, and prints the counts line, the measurement line and the
 * browser and renderer that produced them. It is a static **display** measurement: it never loads a
 * neural worker, creates an individual, advances simulated time or moves the camera.
 *
 * The recorded figures belong in docs/ATLAS_DISPLAY_EVIDENCE.md with their renderer stated, because
 * a software rasterizer and a real GPU produce materially different numbers for the same scene.
 * `data/` is gitignored, so an absent profile is recorded as not exercised rather than failed.
 */
const PROFILES = [
  { value: 'male-cns-v1', label: 'MaleCNS v1.0' },
  { value: 'banc-v888', label: 'BANC v888' },
];

test('the built-in 60-redraw display measurement runs on each pinned atlas profile', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('/#Nervous%20system');
  await expect(page.getByRole('heading', { name: 'Brain and nerve cord' })).toBeVisible();
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);

  const table = page.getByRole('region', { name: 'Searchable anatomical cells' });
  const alert = page.getByRole('alert');
  await expect(table.or(alert).first()).toBeVisible({ timeout: 120_000 });
  if (!(await table.count())) {
    const message = (await alert.first().textContent()).trim();
    console.log(`[${info.project.name}] pinned atlas unavailable, redraw measurement not exercised: ${message}`);
    info.annotations.push({ type: 'not-exercised', description: 'no pinned atlas data; the redraw control was not invoked' });
    return;
  }

  // Regression for #78: re-selecting the already-active profile must leave the loaded atlas in
  // place rather than blanking it (the selector used to clear `data` unconditionally on change,
  // even when the parent's profile prop did not actually change).
  const dataset = page.getByLabel('Atlas dataset');
  const activeValue = await dataset.inputValue();
  await dataset.selectOption(activeValue);
  await expect(table).toBeVisible();

  for (const profile of PROFILES) {
    if ((await dataset.inputValue()) !== profile.value) await dataset.selectOption(profile.value);
    const measure = page.getByRole('button', { name: 'Measure 60 redraws' });
    await expect(measure).toBeEnabled({ timeout: 120_000 });
    const counts = (await page.getByRole('status').first().textContent()).trim();
    await measure.click();
    const result = page.getByRole('status').filter({ hasText: /60 redraws in|timed out/ });
    await expect(result).toBeVisible({ timeout: 30_000 });
    const measured = (await result.textContent()).trim();
    console.log(`[${info.project.name}] ${profile.label} counts: ${counts}`);
    console.log(`[${info.project.name}] ${profile.label} redraws: ${measured}`);
    info.annotations.push({ type: 'measured', description: `${profile.label}: ${measured}` });
    // One observation per profile with no uncertainty estimate. The assertion only checks that a
    // real throughput line was produced, never that it reached any particular rate.
    expect(measured).toMatch(/60 redraws in [\d.]+ ms \([\d.]+ redraws\/s\)/);
  }
});
