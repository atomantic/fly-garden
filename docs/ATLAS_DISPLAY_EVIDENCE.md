# Full atlas display evidence

Recorded September 12, 2026 on the local Apple Silicon machine in the Codex in-app browser, with Fly Garden revision `682a8f752407dcea14a162f866718e7ba2ab2aea`. These are explicit static **display** measurements, not neural throughput or a portable hardware capacity guarantee. No neural worker was loaded or advanced.

Both profiles were opened through the production Nervous system view using their own pinned local assets. All valid coordinates were displayed with the default point settings, optional connections off, and no cell selection. The built-in **Measure 60 redraws** control was invoked once per profile.

| Profile | Retained cells | Positioned and displayed | Missing positions | 60 redraws | Redraws/s | Geometry buffer estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MaleCNS v1.0 | 165,122 | 140,024 | 25,098 | 493.8 ms | 121.5 | 4,623,428 bytes |
| BANC v888 | 155,858 | 138,159 | 17,699 | 494.6 ms | 121.3 | 4,364,036 bytes |

The control includes browser requestAnimationFrame scheduling and display refresh limits. It measures repeated static rendering after loading; it does not measure network transfer, parsing, initial load, end-to-end interaction latency, GPU execution time or sustained animation. Geometry estimates count the component's typed geometry buffers and exclude metadata, browser/Three.js overhead, driver copies and total process memory. This is one observation per profile, without uncertainty estimates. Edge-enabled performance and total browser peak memory remain unmeasured here.

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

Not measured here: context **restoration**. The handler deliberately prevents the default so the context is
not silently restored into a half-initialised scene, and recovery is an explicit reload. Automatic
restore-and-rebuild was not implemented or tested in this pass.

See [atlas data provenance](ANATOMICAL_ATLAS.md), [connection display limits](ATLAS_CONNECTIVITY.md) and [operating envelope](OPERATING_ENVELOPE.md). Dataset display, complete sparse graph execution, and a causal body controller are separate capabilities.
