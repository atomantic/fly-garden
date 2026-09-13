/** Atlas WebGL drawing-context loss. Pure state transition over injected callbacks:
 * it owns no renderer, runtime, neural, dataset or network authority, and it never
 * removes a cell from the searchable table. Losing a GPU context is a display failure,
 * never silent neural or anatomical cropping. */

export const CONTEXT_LOST_MESSAGE =
  'Graphics context lost. Reload the atlas to restore the view; the searchable cell table remains available.';

/**
 * @param {object} handlers
 * @param {() => void} handlers.cancelBenchmark stops an in-flight redraw measurement, if any.
 * @param {(measuring: boolean) => void} handlers.setMeasuring clears the measuring status message.
 * @param {(failure: string) => void} handlers.setFailure publishes the visible alert text.
 */
export function createAtlasContextGuard({ cancelBenchmark, setMeasuring, setFailure }) {
  let lost = false;
  return {
    /** True only while the drawing context is usable. */
    get lost() {
      return lost;
    },
    handleContextLost(event) {
      // Default handling would make the context unrestorable; the atlas prefers an honest reload.
      event?.preventDefault?.();
      if (lost) return false;
      lost = true;
      cancelBenchmark?.();
      setMeasuring?.(false);
      setFailure?.(CONTEXT_LOST_MESSAGE);
      return true;
    },
    /** Drawing is suppressed after loss; a stale framebuffer must not be presented as current anatomy. */
    canRender() {
      return !lost;
    },
    /** Picking needs a live context to raycast against, and a laid-out canvas to map pointer coordinates. */
    canPick(rect) {
      return !lost && Boolean(rect?.width) && Boolean(rect?.height);
    },
    /**
     * The searchable cell table is rendered from validated metadata, not from the GPU context.
     * This guard never disables it, so keyboard and screen-reader access to every cell survives loss.
     */
    searchableTableAvailable() {
      return true;
    },
  };
}
