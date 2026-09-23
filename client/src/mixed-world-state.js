/** Observer-side decisions for the render-only mixed world shell. Pure: no renderer, network,
 * timer, command or neural authority. A refreshed or reopened observer only reads. */

export const MIXED_WORLD_POLL_MS = 1500;
/** An observer whose last complete batch is older than this stops presenting rather than show old poses as current. */
export const MIXED_WORLD_STALE_MS = 5000;
export const MIXED_CONTEXT_LOST = 'Graphics context lost. The mixed world presentation stopped; the participant table remains from the current batch. Rebuild the view explicitly.';

/** Responses can arrive out of order. An older server batch never replaces a newer one. */
export function acceptMixedPresentation(previous, next) {
  if (previous && next.generatedAtMs < previous.generatedAtMs) return previous;
  return next;
}

/**
 * @returns {{present: boolean, table: boolean, message: string|null, alert: boolean}}
 * `present` allows drawing the scene; `table` allows listing participants. Stale data, read failure
 * and an unavailable world withhold both. Graphics loss or renderer failure withholds only drawing,
 * because the table is built from validated metadata, not from the GPU context.
 */
export function mixedWorldView({ presentation = null, receivedAtMs = null, nowMs, readError = '', contextLost = false, rendererError = '' }) {
  if (readError) return { present: false, table: false, alert: true, message: `Mixed world read failed: ${readError.replace(/\.?$/, '.')} Presentation stopped; older data is not shown as current.` };
  if (!presentation) return { present: false, table: false, alert: false, message: 'Reading committed shared snapshots…' };
  if (!presentation.available) return { present: false, table: false, alert: false, message: `Mixed world unavailable: ${presentation.reason}` };
  if (!Number.isFinite(receivedAtMs) || !Number.isFinite(nowMs) || nowMs < receivedAtMs || nowMs - receivedAtMs > MIXED_WORLD_STALE_MS) {
    return { present: false, table: false, alert: true, message: 'Shared snapshots are stale. Presentation stopped until a fresh complete batch arrives; no participant is moved, added or removed.' };
  }
  if (contextLost) return { present: false, table: true, alert: true, message: MIXED_CONTEXT_LOST };
  if (rendererError) return { present: false, table: true, alert: true, message: rendererError };
  return { present: true, table: true, alert: false, message: null };
}
