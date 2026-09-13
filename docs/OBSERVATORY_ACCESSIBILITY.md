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
with `node server/index.js` on loopback port 8792 using its own empty identity directory, and makes no request
off the loopback interface. Nothing in the suite creates, starts, advances, checkpoints or steers an
individual.

Executed September 12, 2026 on the local Apple Silicon machine against revision
`eb18466927a7f81f2341004e48bc9b5a87004409` plus this branch, using Chrome Headless Shell 153.0.8010.12
(Playwright `chromium_headless_shell` v1243). 10 passed, 1 skipped by design, 0 failed. The pinned MaleCNS
v1.0 atlas under `data/atlas/` was made readable to the worktree for this run; `data/` remains gitignored.

### Two browsers, and which one produced which figure

The headless shell has **no display and no GPU**: it reports renderer
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)` and
throttles animation frames. Setting `FLY_GARDEN_CDP_ENDPOINT` now runs the identical specs over the DevTools
Protocol against an already running browser, in an isolated browser context of its own, so the same checks can
be recorded on real hardware. `tests/browser/cdp-browser.js` holds that fixture; unset, the suite launches the
headless shell exactly as before, and CI never sets it. Every spec prints its browser and renderer next to the
figures it records.

The real-GPU re-run was executed September 12, 2026 against Chrome 153.0.8010.36, renderer
`ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)`, on the same loopback build. **11 passed, 1 skipped by design, 0 failed**,
the same outcome as headless. Below, headless figures are kept and labelled rather than overwritten, and the
real-GPU figure is stated beside each one.

*Emulation caveat, unchanged by the hardware.* Both runs emulate `prefers-reduced-motion`, `forced-colors` and
the viewport through the browser context rather than the operating system, and both use Playwright's
`Desktop Chrome` descriptor, which overrides the user-agent string to a Windows one. The renderer string is
the real device in both cases; the user-agent is not.

**`prefers-reduced-motion: reduce` emulation.** On the Observatory both renderers reported
`data-orbit-damping="false"` and `data-motion-policy="state-commit control-interaction resize"`, and a probe
wrapping `requestAnimationFrame` before any application code counted **0 callbacks over 1.5 s (0.0/s)**. With
`no-preference` the same page reported `data-orbit-damping="true"`, `data-motion-policy="animation-frame"` and
a live loop: **46.7/s** in the final run, and 6.7/s, 17.3/s and 44.0/s in earlier runs of the same spec. A full orbit drag under the reduce
preference scheduled **0 animation-frame callbacks** and left **0.0/s** afterwards, while the canvas stayed
visible — the view repaints from the control-change event without opening a loop. Computed styles under the
reduce preference were `transition-duration: 0s`, `animation-name: none`, `scroll-behavior: auto`.

*The headless default-motion figure is not a frame-rate measurement.* The headless shell has no display and
throttles animation frames, which is why those recorded runs differ by roughly a factor of seven (6.7, 17.3,
44.0, 45.3, 46.7 and 64.0 across runs of the same spec). The assertion separates "a loop is open" from "no
loop is open"; on the headless shell it does not establish a frame rate.

**Real GPU, same spec.** On Chrome 153.0.8010.36 with the Apple M5 Max Metal renderer the reduce preference
again counted **0 callbacks over 1.5 s (0.0/s)**, and the orbit drag again scheduled **0 animation-frame
callbacks** and left **0.0/s** afterwards, with the canvas still visible — identical to headless, which is the
result that matters, because the claim is that no loop is held open. With `no-preference` the same page
reported **238.7/s, 240.0/s and 240.0/s** across three runs, against 45.3–64.0/s headless on the same day. The
real-hardware figure is stable where the headless one is not, and it is legible: the Observatory mounts **two**
`.scene` renderers, each holding its own `requestAnimationFrame` loop, on a 120 Hz display — two loops at
roughly 120 Hz each. So the real-GPU number is consistent with an unthrottled display refresh, while the
headless number was never a refresh rate at all. It is still not a rendering-performance measurement: it
counts scheduled callbacks, not drawn frames or GPU time.

**Teleport-pod phase tone under reduced motion.** The pod's phase tone is state, not motion, so
`client/src/Scene.jsx` writes the ring emissive colour and intensity on every draw and gates only the
sinusoidal vertical bob on the motion policy. The movement guard from the visitor-phase work is unchanged:
the pod moves only when `motion === true && phase === "visiting"`, never during `admission`, `departing` or
`blocked`, and under the reduce preference it does not move at all. In the recorded run both motion modes
reported the same pod disclosure — `phase: "home"`, tone class `pod-idle`, computed colour
`rgb(142, 163, 148)`, label text `◎ TELEPORT POD HOST BRIDGE NOT CONNECTED POD STILL · NO ACKNOWLEDGED BODY`
— so the phase is legible from text and tone with no animation-frame loop running. `server/reduced-motion.test.js`
additionally asserts that the emissive write is not nested inside the movement branch.

The real-GPU re-run reported byte-identical pod disclosure in both motion modes — `phase: "home"`, tone class
`pod-idle`, computed colour `rgb(142, 163, 148)`, the same label text — so the phase tone does not depend on
the rasterizer either.

*Still not verified, on either browser:* only the `home` phase was observable, because no managed visit was in
progress. Reaching `admission`, `visiting`, `returning` or a fault phase in a browser is not a display setting
that can be emulated: the bridge is off unless `FLY_GARDEN_PORTOS_URL`, `FLY_GARDEN_MANAGED_APP_ID` and a
separately provisioned `mv1_` visitor credential are all configured, and every other phase is entered only by
an explicit admission or departure command that claims an existing fixture individual. Per the agent
instructions the simulation and its lifecycle commands run only on an explicit user action, so no individual
was created and no admission was requested to obtain a more complete result. Those four colours remain
measured numerically instead (6.01:1 to 11.09:1 over the habitat surface), and their rendered tone remains
unverified in a browser.

**`forced-colors: active` emulation.** `matchMedia('(forced-colors: active)')` matched. The first Tab from the
document start landed on the brand link with a real substituted focus ring: `outline-style: solid`,
`outline-width: 3px`, `outline-color: rgba(55, 0, 110, 0.8)`. The Fixture garden, Fixture circuit, Eidoverse
and Nervous system navigation links, the habitat and fixture-circuit image alternatives, the
`DROSOPHILA · ORIGINAL PROCEDURAL MODEL` caption and the lifecycle label `○ PAUSED FIXTURE` were all still
present as text, so the lifecycle state does not depend on colour. The real-GPU re-run reproduced every one of
these values exactly, including the substituted outline colour `rgba(55, 0, 110, 0.8)`: forced-colors
substitution is a compositor and style decision, and it did not change with the rasterizer.

**390×844 viewport.** On both the Observatory and the Nervous system tab `documentElement.scrollWidth` was
**390 px against a 390 px client width**: no horizontal page scrolling. The sidebar collapsed into a
navigation strip laid out entirely above `main` rather than overlapping it. The widest element was a
navigation link ending at 789 px inside the navigation strip, which is a deliberate `overflow-x: auto` region
and does not scroll the page. The Nervous system tab loaded the pinned anatomy at that width, with the search
field visible; the spec also accepts and asserts the honest unavailable alert when `data/` is absent.

**A material difference on real hardware.** The same spec on Chrome 153.0.8010.36 reported
`scrollWidth` **375 px against a 375 px client width**, with `window.innerWidth` still 390 px. That 15 px gap
is a classic non-overlay scrollbar, which a real Chrome on this machine reserves out of the layout viewport
and the headless shell does not. The check itself is unaffected, because it compares `scrollWidth` against
`clientWidth` rather than against the requested viewport, and both browsers agree there is no horizontal page
scrolling. But it means the headless figure of "390 px against 390 px" was measuring a slightly wider layout
than a real browser gives at the same requested viewport, and any future figure quoted in absolute pixels has
to say which browser produced it.

**WebGL context loss.** Recorded in [atlas display evidence](ATLAS_DISPLAY_EVIDENCE.md).

## What was not verified

- No fixture individual existed during the run, so the Observatory was exercised in its paused,
  no-individual state. The reduced-motion cadence of an actual engineered controller-camera session, and the
  shared-population and managed-visitor panels, were **not** measured in a browser.
- The Connectome lab tab was not exercised in a browser in this pass.
- Chromium only, in two configurations: the headless shell and a real Chrome over CDP. No Firefox or WebKit
  run, and no real assistive technology: VoiceOver, NVDA and JAWS were not used, and no automated rule engine
  (axe or equivalent) was run.
- Both preferences were emulated through the browser context, not set in the operating system, in both
  configurations.
- The real-GPU run drove an already running browser over the DevTools Protocol in an isolated context of its
  own. It is one machine and one graphics device; it is not a hardware compatibility survey.
- Reflow, target size, zoom to 400 %, colour-blind simulation and prolonged keyboard-only task walkthroughs
  remain unmeasured. None of this certifies WCAG conformance; it records the specific checks that were run.
