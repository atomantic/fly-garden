import { ATLAS_PROFILES, REDRAW_MEASUREMENT, atlasSettled, measureRedraws, notExercised, openNervousSystem } from './atlas-page.js';
import { describeRuntime, expect, test } from './cdp-browser.js';

/**
 * Runs the atlas's own built-in **Measure 60 redraws** control through the production Nervous
 * system view, once per pinned profile with connections off, and prints the counts line, the
 * measurement line and the browser and renderer that produced them. It is a static **display**
 * measurement: it never loads a neural worker, creates an individual, advances simulated time or
 * moves the camera. Edge-enabled ceilings are measured in `atlas-interaction.spec.js`.
 *
 * The recorded figures belong in docs/ATLAS_DISPLAY_EVIDENCE.md with their renderer stated, because
 * a software rasterizer and a real GPU produce materially different numbers for the same scene.
 * `data/` is gitignored, so an absent profile is recorded as not exercised rather than failed.
 */
test('the built-in 60-redraw display measurement runs on each pinned atlas profile', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openNervousSystem(page);
  console.log(`[${info.project.name}] runtime: ${JSON.stringify(await describeRuntime(page))}`);
  if (!(await atlasSettled(page, info, 'the redraw control'))) return;

  // Regression for #78: re-selecting the already-active profile must leave the loaded atlas in
  // place rather than blanking it (the selector used to clear `data` unconditionally on change,
  // even when the parent's profile prop did not actually change).
  const dataset = page.getByLabel('Atlas dataset');
  const table = page.getByRole('region', { name: 'Searchable anatomical cells' });
  await dataset.selectOption(await dataset.inputValue());
  await expect(table).toBeVisible();

  for (const profile of ATLAS_PROFILES) {
    if ((await dataset.inputValue()) !== profile.value) await dataset.selectOption(profile.value);
    const counts = await atlasSettled(page, info, `${profile.label} redraws`);
    if (!counts) continue;
    const measured = await measureRedraws(page);
    console.log(`[${info.project.name}] ${profile.label} counts: ${counts}`);
    if (!REDRAW_MEASUREMENT.test(measured)) {
      // The control gives up after its own 10-second limit, which a software rasterizer under load
      // can exceed. That is a recorded absence of a figure, not a slow figure to publish.
      notExercised(info, `${profile.label} redraws`, measured);
      continue;
    }
    console.log(`[${info.project.name}] ${profile.label} redraws: ${measured}`);
    // One observation per profile with no uncertainty estimate, so nothing here asserts a rate.
    info.annotations.push({ type: 'measured', description: `${profile.label}: ${measured}` });
  }
});
