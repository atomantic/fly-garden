import { expect } from './cdp-browser.js';

/**
 * Shared page plumbing for the Nervous system specs, so the redraw and interaction specs agree on
 * what "loaded", "unavailable" and "measured" mean rather than each deciding for itself.
 *
 * Nothing here loads a neural worker, creates an individual, advances simulated time or sends a
 * stimulus. `data/` is gitignored, so an absent pinned atlas is recorded as not exercised rather
 * than failed, and a figure that is missing is recorded as missing and never estimated.
 */
export const ATLAS_PROFILES = Object.freeze([
  { value: 'male-cns-v1', label: 'MaleCNS v1.0' },
  { value: 'banc-v888', label: 'BANC v888' },
]);

/** A completed throughput line from the built-in control: points, lines, elapsed, rate, bytes. */
export const REDRAW_MEASUREMENT = /(\d[\d,]*) points and (\d[\d,]*) lines; 60 redraws in ([\d.]+) ms \(([\d.]+) redraws\/s\)\. Geometry buffer estimate: (\d[\d,]*) bytes\./;

/** The counts line, which names retained/positioned/missing/displayed cells rather than the mode. */
export const atlasCounts = page => page.getByRole('status').filter({ hasText: /retained cells/ }).first();

export const redrawControl = page => page.getByRole('button', { name: 'Measure 60 redraws' });

/** Record an absent figure with the reason the page itself gave, instead of inventing one. */
export function notExercised(info, what, message) {
  console.log(`[${info.project.name}] ${what} not exercised: ${message}`);
  info.annotations.push({ type: 'not-exercised', description: `${what}: ${message}` });
}

export async function openNervousSystem(page) {
  await page.goto('/#Nervous%20system');
  await expect(page.getByRole('heading', { name: 'Brain and nerve cord' })).toBeVisible();
}

/**
 * Wait for the atlas to reach one of its honest end states and return the counts line, or null
 * where it reported a failure or loaded verified metadata without geometry to draw. Never waited
 * out, and never both states at once.
 */
export async function atlasSettled(page, info, what) {
  const counts = atlasCounts(page), failure = page.getByRole('alert');
  await expect(counts.or(failure).first()).toBeVisible({ timeout: 120_000 });
  if (!(await counts.count())) {
    notExercised(info, what, (await failure.first().textContent()).trim());
    return null;
  }
  const text = (await counts.textContent()).trim();
  if (await redrawControl(page).count()) return text;
  notExercised(info, what, 'verified cell metadata loaded without geometry; nothing is drawn');
  return null;
}

/** Invoke the built-in control and return its own line, completed or abandoned, verbatim. */
export async function measureRedraws(page) {
  const measure = redrawControl(page);
  await expect(measure).toBeEnabled({ timeout: 120_000 });
  await measure.click();
  const result = page.getByRole('status').filter({ hasText: /60 redraws in|timed out/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  return (await result.textContent()).trim();
}
