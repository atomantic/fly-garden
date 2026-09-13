/**
 * Shared keyboard and non-colour measurements for the Observatory's panels.
 *
 * Nothing here creates, starts, advances, checkpoints or steers an individual.
 * It presses Tab, reads computed styles and reads rendered text.
 */

/** The panels NFR-4 had no recorded browser evidence for, by their accessible names. */
export const PANELS = [
  { tab: 'Observatory', region: 'Shared fixture population' },
  { tab: 'Eidoverse', region: 'Managed Eidoverse visitor' },
  { tab: 'Language', region: 'Optional telemetry interpreter' },
  { tab: 'Connectome lab', region: 'Full connectome research lab' },
];

const CONTROLS = 'a[href],button,input,select,textarea,summary,[tabindex="0"]';

/**
 * Tag every control a keyboard user should be able to reach in this panel, and
 * read back its accessible name, the panel's text and its live-region text.
 * Controls inside a closed `details` or a disabled fieldset are deliberately not
 * counted: they are not reachable yet, and claiming them would overstate the result.
 */
export async function markPanel(page, regionName) {
  return page.evaluate(({ name, selector }) => {
    const panel = [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === name);
    if (!panel) return null;
    const named = element => (element.getAttribute('aria-label') || element.labels?.[0]?.textContent
      || element.textContent || element.title || element.placeholder || '').replace(/\s+/g, ' ').trim();
    const controls = [...panel.querySelectorAll(selector)].filter(element =>
      !element.disabled && !element.closest('fieldset[disabled]') && element.offsetParent !== null);
    controls.forEach((element, index) => { element.dataset.kbdStop = String(index); });
    return {
      controls: controls.map((element, index) => ({ index, tag: element.tagName.toLowerCase(), name: named(element).slice(0, 70) })),
      text: panel.innerText.replace(/\s+/g, ' ').trim(),
      statuses: [...panel.querySelectorAll('[role="status"],[role="alert"]')].map(element => element.innerText.replace(/\s+/g, ' ').trim()),
    };
  }, { name: regionName, selector: CONTROLS });
}

/**
 * Press Tab from the document start until focus enters the marked panel, record
 * every stop inside it with the focus outline the browser actually computed, and
 * stop at the first stop outside it. Real key presses, so `:focus-visible`
 * applies exactly as it does for a keyboard user.
 */
export async function tabThroughPanel(page, limit = 500) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const stops = [];
  let entered = false;
  for (let index = 0; index < limit; index++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return { stop: element.dataset?.kbdStop ?? null, tag: element.tagName.toLowerCase(),
        outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineColor: style.outlineColor, hidden: element.offsetParent === null };
    });
    if (focused?.stop != null) { entered = true; stops.push({ ...focused, stop: Number(focused.stop) }); }
    else if (entered) break;
  }
  return stops;
}

/** Panel state words that must be legible as text, not only as colour or position. */
export const STATE_WORDS = /paused|resting|running|unavailable|unloaded|not connected|no provider|separated|home|saved/i;
