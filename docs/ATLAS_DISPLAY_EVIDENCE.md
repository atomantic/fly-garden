# Full atlas display evidence

Recorded September 12, 2026 on the local Apple Silicon machine in the Codex in-app browser, with Fly Garden revision `682a8f752407dcea14a162f866718e7ba2ab2aea`. These are explicit static **display** measurements, not neural throughput or a portable hardware capacity guarantee. No neural worker was loaded or advanced.

Both profiles were opened through the production Nervous system view using their own pinned local assets. All valid coordinates were displayed with the default point settings, optional connections off, and no cell selection. The built-in **Measure 60 redraws** control was invoked once per profile.

| Profile | Retained cells | Positioned and displayed | Missing positions | 60 redraws | Redraws/s | Geometry buffer estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MaleCNS v1.0 | 165,122 | 140,024 | 25,098 | 493.8 ms | 121.5 | 4,623,428 bytes |
| BANC v888 | 155,858 | 138,159 | 17,699 | 494.6 ms | 121.3 | 4,364,036 bytes |

The control includes browser requestAnimationFrame scheduling and display refresh limits. It measures repeated static rendering after loading; it does not measure network transfer, parsing, initial load, end-to-end interaction latency, GPU execution time or sustained animation. Geometry estimates count the component's typed geometry buffers and exclude metadata, browser/Three.js overhead, driver copies and total process memory. This is one observation per profile, without uncertainty estimates. Edge-enabled performance and total browser peak memory remain unmeasured here.

## The same control on a known renderer

The table above was recorded in the Codex in-app browser, whose renderer string was not captured, so its
throughput cannot be attributed to a specific rasterizer. `tests/browser/atlas-redraw.spec.js` now invokes the
same built-in **Measure 60 redraws** control through the production Nervous system view under
`npm run test:browser`, printing the browser and renderer with every figure. It loads no neural worker, creates
no individual and moves no camera, and it records the honest not-exercised state when `data/` is absent.

Recorded September 12, 2026 on the same machine. The counts, displayed totals and geometry buffer estimates
were byte-identical to the table above on both browsers; only throughput differed.

| Renderer | Browser | MaleCNS v1.0 | BANC v888 |
| --- | --- | --- | --- |
| `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)` | Chrome Headless Shell 153.0.8010.12 | 5,132.9–5,149.4 ms · 11.7 redraws/s | 4,984.1–5,020.5 ms · 12.0 redraws/s |
| `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)` | Chrome 153.0.8010.36 over CDP | 656.3–763.0 ms · 78.6–91.4 redraws/s | 623.3–807.4 ms · 74.3–96.3 redraws/s |

**This difference is material and cuts both ways.** The software rasterizer is roughly **seven times slower**
than the real GPU on the identical geometry, so the headless shell must never be quoted as a display-capability
figure. But the real-GPU figure is *also* not a GPU throughput measurement, and it is **lower** than the 121.5
and 121.3 redraws/s originally recorded in the in-app browser. The control drives its 60 redraws through
`requestAnimationFrame`, so it is bounded by display refresh and by how the browser schedules a window: the
original ~121/s is almost exactly a 120 Hz display refresh limit in a foreground window, while the CDP run's
74–96/s reflects a background context on the same hardware. Two runs of each are recorded above rather than
one, because the real-GPU figure varies between runs and the headless one does not. None of these numbers is
GPU execution time, and none should be compared across browsers without its renderer and window state.

Coordinates remain in each source's documented native frame and micrometer conversion. Missing coordinates are retained in the searchable table, never invented. No anatomical filtering modified a simulated graph. The running service retained zero neural residents throughout these checks, and the existing saved identity/checkpoint stayed unchanged.

## WebGL drawing-context loss

Recorded September 12, 2026 on the same machine, headless, with Playwright 1.63.0 driving Chrome Headless
Shell 153.0.8010.12 against the production build served on loopback port 8792
(`tests/browser/webgl-context-loss.spec.js`, run with `npm run test:browser`). This is a **display** failure
check; no neural worker was loaded or advanced, and no individual was created or started.

The MaleCNS v1.0 profile was opened through the production Nervous system view and reported 165,122 retained
cells · 140,024 positioned · 25,098 without a valid position · 140,024 displayed. The atlas canvas exposed the
`WEBGL_lose_context` extension, and `loseContext()` was called on the live context.

Observed after the forced loss:

- The visible alert read `Graphics context lost. Reload the atlas to restore the view; the searchable cell
  table remains available.`
- **Fit visible anatomy** and **Measure 60 redraws** were observed disabled, so no stale framebuffer or
  throughput number can be presented as current. Every camera button shares the same failure guard, but only
  these two were asserted in the run.
- The counts line was byte-for-byte unchanged, and the searchable cell table still listed the same 50 rows.
  An exact-ID search for cell `10001` still resolved after the loss.
- Nothing was removed from the dataset. Losing a drawing context degrades display only; it never crops
  anatomy or a simulated graph.

`node --test server/atlas-context-loss.test.js` covers the same transition numerically against
`client/src/webgl-context-loss.js`: the in-flight redraw benchmark is cancelled, the measuring status is
cleared, the lost state is set once and is idempotent, rendering is suppressed, picking is disabled (also for
an unlaid-out canvas), and the searchable table is never disabled.

**Repeated on a real graphics device.** The same spec was re-run September 12, 2026 over the DevTools Protocol
against Chrome 153.0.8010.36, renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified
Version)`, `WebGL 2.0 (OpenGL ES 3.0 Chromium)` — a real hardware Metal rasterizer rather than the SwiftShader
software device above. Every observation was identical: the same 165,122 · 140,024 · 25,098 · 140,024 counts
line before and after, `WEBGL_lose_context` present and `loseContext()` effective, the same visible alert
text, **Fit visible anatomy** and **Measure 60 redraws** both disabled, the same 50 listed rows retained, and
the exact-ID search for cell `10001` still resolving. Losing a real GPU context degrades display exactly as
losing a software one does. Nothing here differed by renderer.

Not measured here: context **restoration**. The handler deliberately prevents the default so the context is
not silently restored into a half-initialised scene, and recovery is an explicit reload. Automatic
restore-and-rebuild was not implemented or tested in this pass.


## Edge-enabled redraw throughput, heap and interaction latency

The tables above measured the point cloud alone, with connections off. `tests/browser/atlas-interaction.spec.js`
adds the three figures that were still missing: **edge-enabled** redraw throughput at each bounded connection
ceiling the UI offers, the renderer's **JavaScript heap** beside each of those states, and **interaction
latency** for a camera command and a cell selection. It runs under `npm run test:browser` in the
`motion-default` project, through the production Nervous system view.

It loads no neural worker, creates no individual, advances no simulated time and sends no stimulus. Enabling
connections reads the verified connectivity index and draws a bounded sample of it; a display ceiling never
crops or mutates the simulated graph, and the retained/positioned/displayed counts below are identical at
every ceiling.

Recorded September 16, 2026 on the same local Apple Silicon machine, headless, Playwright 1.63.0 driving
Chrome Headless Shell 153.0.8010.12, renderer
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)`. Two consecutive runs are given because this figure varies
between runs. **This is a software rasterizer, so none of it is a display-capability figure**; the section above
measured the same control roughly seven times faster on a real Metal device with connections off.

| Profile | Ceiling | Considered · omitted for missing positions · displayed lines | Points | 60 redraws, run 1 | run 2 | Geometry buffer estimate |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| MaleCNS v1.0 | 1,000 | 1,000 · 87 · 913 | 140,024 | 5,860.3 ms · 10.2/s | 5,152.2 ms · 11.6/s | 4,645,340 bytes |
| MaleCNS v1.0 | 5,000 | 5,000 · 471 · 4,529 | 140,024 | 4,855.1 ms · 12.4/s | 5,891.2 ms · 10.2/s | 4,732,124 bytes |
| MaleCNS v1.0 | 20,000 | 20,000 · 1,839 · 18,161 | 140,024 | 4,863.0 ms · 12.3/s | 4,927.8 ms · 12.2/s | 5,059,292 bytes |
| BANC v888 | 1,000 | 1,000 · 91 · 909 | 138,159 | 4,244.2 ms · 14.1/s | 4,304.0 ms · 13.9/s | 4,385,852 bytes |
| BANC v888 | 5,000 | 5,000 · 437 · 4,563 | 138,159 | 6,100.6 ms · 9.8/s | 4,482.2 ms · 13.4/s | 4,473,548 bytes |
| BANC v888 | 20,000 | 20,000 · 1,679 · 18,321 | 138,159 | 6,217.4 ms · 9.7/s | 4,699.8 ms · 12.8/s | 4,803,740 bytes |

**Twenty times more lines did not cost measurable throughput here.** Between the 1,000 and 20,000 ceilings the
run-to-run spread is wider than the difference between ceilings, so on this rasterizer 140,024 points dominate
the frame and up to 18,321 line segments are not the limiting cost. That is a statement about this software
renderer at these bounds, not a claim that edges are free on other hardware or above a 20,000 ceiling.
The count of lines actually drawn is always below the ceiling, because edges whose endpoints have no valid
position are omitted rather than invented, and hidden display groups are filtered out.

### Renderer JavaScript heap

`Performance.getMetrics.JSHeapUsedSize` over the DevTools Protocol, sampled after each state above.
`performance.memory` is deliberately not used: outside a cross-origin-isolated page Chrome returns a
quantized, clamped value, and it was observed **pinned at exactly 10,000,000 bytes for every state** of the
140,024-point atlas, so publishing it as a peak would have been a fabricated figure.

| State | Run 1 | Run 2 |
| --- | ---: | ---: |
| Before the atlas view opened | 534,528 | 534,528 |
| MaleCNS v1.0 anatomy loaded | 32,452,832 | 33,185,980 |
| MaleCNS v1.0, 1,000-connection ceiling | 49,775,080 | 38,849,212 |
| MaleCNS v1.0, 5,000-connection ceiling | 51,161,052 | 64,338,524 |
| MaleCNS v1.0, 20,000-connection ceiling | 59,793,664 | 71,246,376 |
| BANC v888 anatomy loaded | 76,908,104 | 83,980,328 |
| BANC v888, 1,000-connection ceiling | **80,142,904** | 85,326,112 |
| BANC v888, 5,000-connection ceiling | 79,424,344 | 82,528,116 |
| BANC v888, 20,000-connection ceiling | 67,559,744 | **92,531,852** |

Peak observed: **80.1 MB** in run 1 and **92.5 MB** in run 2, both after a profile switch. These are live
readings taken without forcing collection, so they include garbage not yet collected, which is why a larger
ceiling can read lower than a smaller one and why the BANC rows sit above the MaleCNS rows that preceded them.
This is the renderer process's **JavaScript** heap only: it excludes GPU buffers, the browser's non-JS
renderer memory, every other browser process, and the local server process.

Server-side memory is separate and was measured separately, in a bare Node 24 process that called the
repository's own `loadAtlas` and `loadAtlasConnectivity` and read `process.memoryUsage()`: resident set grew
from 47 MiB to **412 MiB** after loading the MaleCNS v1.0 atlas plus its 25,563,197-edge connectivity index
(1,258 ms), and to **690 MiB** with BANC v888's 13,366,670-edge index also resident (995 ms). Drawing a
20,000-edge sample from a loaded index took 10-14 ms and added no measurable memory. The running service
holds one profile's index at a time, so a profile switch drops the previous one.

### Interaction latency

Measured in-page on the fully loaded MaleCNS v1.0 atlas (165,122 retained · 140,024 positioned · 25,098
without a valid position · 140,024 displayed), connections off, same two runs and same renderer.

| Interaction | Samples | Run 1 min · median · max | Run 2 min · median · max |
| --- | ---: | --- | --- |
| **Rotate left** click handler returns | 20 | 0.30 · 0.40 · 1.50 ms | 0.20 · 0.30 · 1.10 ms |
| **Rotate left** click to next animation frame | 20 | 155.5 · 170.3 · 255.4 ms | 128.4 · 141.4 · 146.7 ms |
| Table cell click to inspector heading updated | 10 | 0.70 · 1.30 · 11.40 ms | 0.40 · 0.55 · 6.80 ms |

The handler figure is the synchronous camera update plus the draw call the view issues; GPU work is
asynchronous and is not included in it. The next-animation-frame figure does include that work, and on this
software rasterizer it is dominated by drawing 140,024 points — it is a rasterizer figure, not a latency
guarantee. Selection is timed through the searchable table rather than canvas picking, so the figure does not
depend on what a pointer ray happens to hit and is recorded on the keyboard-reachable path; a MutationObserver
resolves it on the DOM change itself rather than at the next frame. Each of the ten timed clicks selected a
distinct cell, so none measured a no-op re-selection. After both interactions the counts line and the
`Anatomy only` mode line were asserted unchanged: camera and selection are display state only.

`server/atlas-performance-evidence.test.js` covers the reductions behind these tables against
`client/src/atlas-performance-evidence.js`, including the rule that a reading the browser refused to expose is
reported as unmeasured rather than as zero bytes.

**Not measured here.** No real-GPU repeat of the edge-enabled or latency figures; no non-Chromium browser; no
GPU memory, renderer non-JS memory or process total; no sustained animation, and no ceiling above the 20,000
the UI offers. There is no uncertainty estimate beyond the two runs shown. During earlier attempts, while the
machine was under heavy concurrent load, the OS terminated the local server mid-run; the view showed its
honest failure state, the spec recorded the affected figures as not exercised rather than estimating them, and
those runs are not reported above.

See [atlas data provenance](ANATOMICAL_ATLAS.md), [connection display limits](ATLAS_CONNECTIVITY.md) and [operating envelope](OPERATING_ENVELOPE.md). Dataset display, complete sparse graph execution, and a causal body controller are separate capabilities.
