/** Display-only motion policy. This module owns no runtime, neural, network, timer or camera authority.
 * It answers one question: may a view repaint continuously, or only when something actually changed? */

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Reads the operating-system preference. Absent or failing `matchMedia` is reported as "not reduced",
 * because a missing preference is unknown, not a request to stop motion. */
export function prefersReducedMotion(view = globalThis) {
  try {
    return view?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

/** Subscribes to later changes of the same preference. Returns an unsubscribe function.
 * Supports both the current `addEventListener` and the legacy `addListener` MediaQueryList APIs. */
export function observeReducedMotion(view, onChange) {
  let query = null;
  try {
    query = view?.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  } catch {
    return () => {};
  }
  if (!query || typeof onChange !== 'function') return () => {};
  const handler = event => onChange(event?.matches === true);
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }
  if (typeof query.addListener === 'function') {
    query.addListener(handler);
    return () => query.removeListener(handler);
  }
  return () => {};
}

/**
 * The single decision every WebGL view in this app shares.
 *
 * `continuous` false means: do not hold a `requestAnimationFrame` loop open. Repaint when the
 * observed state commits, when the viewer moves the camera, and when the container resizes.
 * `enableDamping` false means: an orbit control settles immediately instead of coasting, which
 * would otherwise require frames after the pointer has stopped.
 *
 * Honest limitation: with `continuous` false, any engineered controller-camera capture loop that a
 * view drives from its repaint is paced by state commits rather than by display refresh. It is not
 * disabled, and it never becomes faster than the observed state.
 */
export function motionRenderPolicy(reducedMotion) {
  const reduced = reducedMotion === true;
  return Object.freeze({
    reducedMotion: reduced,
    continuous: !reduced,
    enableDamping: !reduced,
    redrawOn: Object.freeze(reduced ? ['state-commit', 'control-interaction', 'resize'] : ['animation-frame']),
  });
}
