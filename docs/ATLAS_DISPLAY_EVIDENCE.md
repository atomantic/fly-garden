# Full atlas display evidence

Recorded September 12, 2026 on the local Apple Silicon machine in the Codex in-app browser, with Fly Garden revision `682a8f752407dcea14a162f866718e7ba2ab2aea`. These are explicit static **display** measurements, not neural throughput or a portable hardware capacity guarantee. No neural worker was loaded or advanced.

Both profiles were opened through the production Nervous system view using their own pinned local assets. All valid coordinates were displayed with the default point settings, optional connections off, and no cell selection. The built-in **Measure 60 redraws** control was invoked once per profile.

| Profile | Retained cells | Positioned and displayed | Missing positions | 60 redraws | Redraws/s | Geometry buffer estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MaleCNS v1.0 | 165,122 | 140,024 | 25,098 | 493.8 ms | 121.5 | 4,623,428 bytes |
| BANC v888 | 155,858 | 138,159 | 17,699 | 494.6 ms | 121.3 | 4,364,036 bytes |

The control includes browser requestAnimationFrame scheduling and display refresh limits. It measures repeated static rendering after loading; it does not measure network transfer, parsing, initial load, end-to-end interaction latency, GPU execution time or sustained animation. Geometry estimates count the component's typed geometry buffers and exclude metadata, browser/Three.js overhead, driver copies and total process memory. This is one observation per profile, without uncertainty estimates. Edge-enabled performance and total browser peak memory remain unmeasured here.

Coordinates remain in each source's documented native frame and micrometer conversion. Missing coordinates are retained in the searchable table, never invented. No anatomical filtering modified a simulated graph. The running service retained zero neural residents throughout these checks, and the existing saved identity/checkpoint stayed unchanged.

See [atlas data provenance](ANATOMICAL_ATLAS.md), [connection display limits](ATLAS_CONNECTIVITY.md) and [operating envelope](OPERATING_ENVELOPE.md). Dataset display, complete sparse graph execution, and a causal body controller are separate capabilities.
