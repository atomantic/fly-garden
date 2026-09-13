# Observatory accessibility follow-up

This bounded follow-up advances #3/#29. It does not certify every accessibility requirement or change neural, dataset, recording or embodiment behavior.

- Atlas camera pan now has the same native-button keyboard access as orbit, zoom and fit. Pan moves camera and target together in screen coordinates; zoom respects the existing distance bounds. Failed WebGL disables the camera controls while keeping the searchable table available.
- Group checkboxes keep the camera fixed after the initial fit. Named Whole/Brain/Nerve cord presets and **Fit visible anatomy** explicitly reframe, without interpolation, damping or automatic animation. Camera actions and filters own no simulation authority.
- **Skip spatial controls to searchable cells** moves directly to the search input without changing the application hash route. Choosing a search result or following a connection focuses the exact cell's inspector heading, so replacement of an adjacency list does not strand keyboard focus on the page body. The heading scrolls into view without smooth animation.
- Search, adjacency and checkpoint tables expose named keyboard-focusable scroll regions. Display group and selected-cell state have visible text alternatives, in addition to native control states and coloring. A high-contrast focus outline also follows system forced colors.
- The lab/atlas scope suppresses CSS animation, transitions and smooth scrolling under `prefers-reduced-motion`. The atlas itself is already rendered on demand, without automatic orbit; its optional redraw measurement remains static and explicit.

## Verification

`node --test server/atlas-camera.test.js` tests camera pan geometry, zoom bounds, orbit target preservation and unknown-command rejection with local numerical camera objects. Production build passes. No full graph or worker was loaded or advanced for this task.

`node --test server/reduced-motion.test.js` covers the preference read, its subscription on both MediaQueryList
APIs, the render policy in each state, and that each WebGL view actually consults the policy instead of holding
an unconditional loop. `node --test server/observatory-contrast.test.js` measures the palette. `node --test
server/atlas-context-loss.test.js` covers the drawing-context guard. All 420 tests in `npm test` pass, and the
production build still succeeds.

An isolated browser preview mounted the actual atlas component with two explicitly synthetic rows: one positioned and one missing coordinates. Chrome keyboard interaction followed the skip link, typed an exact ID, tabbed through the scroll region to the result, and used Enter to select it. The accessibility tree confirmed focus on the exact-ID inspector heading, and the screenshot confirmed its visible focus outline and textual selected/group/missing-position labels. The same journey passed with WebGL deliberately unavailable and a requested 390×844 viewport; the browser override was reset afterward. The temporary preview performed no neural-server requests and was removed.

## Scope beyond the atlas

The `observatory-accessible` scope is now applied at the application root in `client/src/main.jsx`, so the
Observatory, Neural map, Encounters, Language, Eidoverse and visitor panels carry the same visible keyboard
focus, forced-colors focus colour and suppression of CSS animation, transition and smooth scrolling that the
atlas and the full-connectome lab already had.

Continuous WebGL repainting is now a decision, not a default. `client/src/reduced-motion.js` reads
`(prefers-reduced-motion: reduce)` once, subscribes to later changes, and returns the single policy every
renderer follows. Under the reduce preference `client/src/Scene.jsx` and `client/src/SharedScene.jsx` hold no
`requestAnimationFrame` loop open and turn orbit damping off; they repaint on an observed state commit, on a
viewer camera interaction and on resize. `client/src/AtlasCanvas.jsx` already repainted only on demand and
keeps damping off unconditionally.

**Honest limitation of that change.** The engineered controller-camera capture in the habitat and shared views
is driven from the same repaint. Under the reduce preference it is not disabled, but it is paced by committed
state (the 500 ms client poll and each accepted frame response) instead of by display refresh. A visual-control
session therefore runs at a lower frame cadence when the viewer has asked for reduced motion. No neural step,
timer or command is started, skipped or accelerated by this; drawing has no runtime authority.

## Measured contrast

`client/src/contrast.js` computes WCAG 2.2 relative luminance and contrast ratios and reads the palette
straight out of `client/src/style.css`, so a later palette edit that regresses contrast fails a test rather
than shipping. `node --test server/observatory-contrast.test.js` asserts 4.5:1 for 47 text pairings across the
sidebar, cards, habitat overlays, tables, alerts, inputs and buttons, and 3:1 for status indicators and
interactive control boundaries.

Four tokens failed and were corrected to the nearest passing value rather than by lowering a threshold:

| Token | Before | After | Measured worst case |
| --- | --- | --- | --- |
| `button` boundary | `#3d5044` (2.16:1 on the page) | `#6a786e` | 3.28:1 on a compound tile |
| `input` boundary | `#435640` (2.18:1 on a card) | `#6a7a67` | 3.33:1 on a compound tile |
| `.language select/textarea/number` boundary | `#45594c` (2.30:1 on a card) | `#6a7a6f` | 3.36:1 on a compound tile |
| `td button[aria-pressed="true"]` | `#526a42` background, inherited `#d8e1d2` text at 4.46:1 | `#86997a` background with `#101c0d` text | 5.73:1 text; 4.83:1 against the unpressed button |

**Negative result, recorded rather than hidden.** Purely decorative separators stay below 3:1 and were not
changed, because WCAG 1.4.11 covers the information needed to identify a control or its state, not ornamental
rules: card outline `#2c4037` 1.68:1, sidebar rule `#24332c` 1.41:1, table row rule `#2c4033` 1.56:1, journal
rule `#263c2e` 1.46:1, adjacency rule `#2b3d2e` 1.49:1, statistic divider `#354937` 1.78:1, notice rules
`#344435` 1.80:1, inspector outline `#344a39` 1.80:1, travel-step rule `#334833` 1.74:1, language fieldset
`#34453c` 1.70:1, compound outline `#3b5140` 2.01:1, pill outline `#40503b` 2.16:1, empty-state and
language-path outlines `#486044` 2.50:1, habitat footer rule `#334b3c` 1.85:1. Anyone who disagrees with that
scope has the numbers here to argue from.

## Browser verification

Run with `npm run test:browser` (Playwright 1.63.0, pinned; deliberately not part of `npm test` and not added
to CI, which has no browser runner). Specs live in `tests/browser/`. The command builds the client, serves it
with `node server/index.js` on loopback port 8792, and makes no request off the loopback interface. Nothing in
the suite creates, starts, advances, checkpoints or steers an individual.

Executed September 12, 2026 on the local Apple Silicon machine against revision
`eb18466927a7f81f2341004e48bc9b5a87004409` plus this branch, using Chrome Headless Shell 153.0.8010.12
(Playwright `chromium_headless_shell` v1243). 10 passed, 1 skipped by design, 0 failed. The pinned MaleCNS
v1.0 atlas under `data/atlas/` was made readable to the worktree for this run; `data/` remains gitignored.

**`prefers-reduced-motion: reduce` emulation.** On the Observatory both renderers reported
`data-orbit-damping="false"` and `data-motion-policy="state-commit control-interaction resize"`, and a probe
wrapping `requestAnimationFrame` before any application code counted **0 callbacks over 1.5 s (0.0/s)**. With
`no-preference` the same page reported `data-orbit-damping="true"`, `data-motion-policy="animation-frame"` and
a live loop: **46.7/s** in the final run, and 6.7/s, 17.3/s and 44.0/s in earlier runs of the same spec. A full orbit drag under the reduce
preference scheduled **0 animation-frame callbacks** and left **0.0/s** afterwards, while the canvas stayed
visible — the view repaints from the control-change event without opening a loop. Computed styles under the
reduce preference were `transition-duration: 0s`, `animation-name: none`, `scroll-behavior: auto`.

*The default-motion figure is not a 60 Hz measurement.* The headless shell has no display and throttles
animation frames, which is why the recorded runs differ by roughly a factor of seven. The assertion separates "a loop is open" from "no loop is
open"; it does not establish a frame rate.

**Teleport-pod phase tone under reduced motion.** The pod's phase tone is state, not motion, so
`client/src/Scene.jsx` writes the ring emissive colour and intensity on every draw and gates only the
sinusoidal vertical bob on the motion policy. The movement guard from the visitor-phase work is unchanged:
the pod moves only when `motion === true && phase === "visiting"`, never during `admission`, `departing` or
`blocked`, and under the reduce preference it does not move at all. In the recorded run both motion modes
reported the same pod disclosure — `phase: "home"`, tone class `pod-idle`, computed colour
`rgb(142, 163, 148)`, label text `◎ TELEPORT POD HOST BRIDGE NOT CONNECTED POD STILL · NO ACKNOWLEDGED BODY`
— so the phase is legible from text and tone with no animation-frame loop running. `server/reduced-motion.test.js`
additionally asserts that the emissive write is not nested inside the movement branch.

*Not verified:* only the `home` phase was observable, because no managed visit was in progress. The tone for
`admission`, `visiting`, `returning` and the fault phases was not rendered in a browser during this run; those
four colours were measured numerically instead (6.01:1 to 11.09:1 over the habitat surface).

**`forced-colors: active` emulation.** `matchMedia('(forced-colors: active)')` matched. The first Tab from the
document start landed on the brand link with a real substituted focus ring: `outline-style: solid`,
`outline-width: 3px`, `outline-color: rgba(55, 0, 110, 0.8)`. The Fixture garden, Fixture circuit, Eidoverse
and Nervous system navigation links, the habitat and fixture-circuit image alternatives, the
`DROSOPHILA · ORIGINAL PROCEDURAL MODEL` caption and the lifecycle label `○ PAUSED FIXTURE` were all still
present as text, so the lifecycle state does not depend on colour.

**390×844 viewport.** On both the Observatory and the Nervous system tab `documentElement.scrollWidth` was
**390 px against a 390 px client width**: no horizontal page scrolling. The sidebar collapsed into a
navigation strip laid out entirely above `main` rather than overlapping it. The widest element was a
navigation link ending at 789 px inside the navigation strip, which is a deliberate `overflow-x: auto` region
and does not scroll the page. The Nervous system tab loaded the pinned anatomy at that width, with the search
field visible; the spec also accepts and asserts the honest unavailable alert when `data/` is absent.

**WebGL context loss.** Recorded in [atlas display evidence](ATLAS_DISPLAY_EVIDENCE.md).

## What was not verified

- No fixture individual existed during the run, so the Observatory was exercised in its paused,
  no-individual state. The reduced-motion cadence of an actual engineered controller-camera session, and the
  shared-population and managed-visitor panels, were **not** measured in a browser.
- The Connectome lab tab was not exercised in a browser in this pass.
- Chromium headless shell only. No Firefox or WebKit run, and no real assistive technology: VoiceOver, NVDA
  and JAWS were not used, and no automated rule engine (axe or equivalent) was run.
- Both preferences were emulated through the browser context, not set in the operating system.
- Reflow, target size, zoom to 400 %, colour-blind simulation and prolonged keyboard-only task walkthroughs
  remain unmeasured. None of this certifies WCAG conformance; it records the specific checks that were run.
