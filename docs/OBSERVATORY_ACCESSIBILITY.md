# Observatory accessibility follow-up

This bounded follow-up advances #3/#29. It does not certify every accessibility requirement or change neural, dataset, recording or embodiment behavior.

- Atlas camera pan now has the same native-button keyboard access as orbit, zoom and fit. Pan moves camera and target together in screen coordinates; zoom respects the existing distance bounds. Failed WebGL disables the camera controls while keeping the searchable table available.
- Group filters keep the camera fixed after the initial fit. Reframing is an explicit **Fit visible anatomy** action, without interpolation, damping or automatic animation. Camera actions and filters own no simulation authority.
- **Skip spatial controls to searchable cells** moves directly to the search input. Choosing a search result or following a connection focuses the exact cell's inspector heading, so replacement of an adjacency list does not strand keyboard focus on the page body. The heading scrolls into view without smooth animation.
- Search, adjacency and checkpoint tables expose named keyboard-focusable scroll regions. Display group and selected-cell state have visible text alternatives, in addition to native control states and coloring. A high-contrast focus outline also follows system forced colors.
- The lab/atlas scope suppresses CSS animation, transitions and smooth scrolling under `prefers-reduced-motion`. The atlas itself is already rendered on demand, without automatic orbit; its optional redraw measurement remains static and explicit.

## Verification

`node --test server/atlas-camera.test.js` tests camera pan geometry, zoom bounds, orbit target preservation and unknown-command rejection with local numerical camera objects. Production build passes. No full graph or worker was loaded or advanced for this task.

An isolated browser preview mounted the actual atlas component with two explicitly synthetic rows: one positioned and one missing coordinates. Chrome keyboard interaction followed the skip link, typed an exact ID, tabbed through the scroll region to the result, and used Enter to select it. The accessibility tree confirmed focus on the exact-ID inspector heading, and the screenshot confirmed its visible focus outline and textual selected/group/missing-position labels. The same journey passed with WebGL deliberately unavailable and a requested 390×844 viewport; the browser override was reset afterward. The temporary preview performed no neural-server requests and was removed.

OS reduced-motion/forced-colors emulation and a full assistive-technology audit were not performed in this pass. To extend acceptance, check both OS settings in the actual app, navigate the atlas and lab using only Tab/Shift+Tab/Enter/Space and scroll keys, follow incoming/outgoing neighbor links, and verify focus remains visible after asynchronous responses. Verify checkpoint tables at narrow width with long hashes. Keep any actual load/advance independently explicit and use an isolated identity; accessibility checks do not authorize neural execution.
