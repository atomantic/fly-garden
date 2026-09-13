# Successful atlas load measurements

The Nervous system view reports one successful local load's elapsed time, using the browser's monotonic clock. Timing starts immediately before the metadata request, marks completion after all four decoded asset buffers arrive and pass byte-length checks, and ends after position conversion, JSON parsing and structural validation. The first interval includes metadata parsing, local server work, requests and browser scheduling; it is not a pure network-transfer measurement. The second covers browser parsing/validation. Their sum is the displayed total before React publication.

Byte counts sum the manifest declarations for `positions.f32`, `valid.u8`, `groups.u8` and `nodes.json`, compared against actual decoded ArrayBuffer lengths. They exclude the metadata response and HTTP overhead. Cache/compression can change wire traffic, so the UI does not describe these as measured wire bytes or download throughput. Existing source validation and cancellation remain unchanged.

The measurement lives in the same successfully validated, profile-tagged data object as the atlas. Clearing data on profile change/failure clears metrics, and a mismatching profile cannot display old values. Aborted or rejected loads publish no success measurement. Measurements exclude GPU allocation/upload, first paint, connectivity loading, total browser memory, neural throughput and biological validity. Displaying these values never loads or advances a neural worker.

## Development evidence

Three small tests cover elapsed partitioning, invalid clocks/incomplete byte counts, and missing/mismatched profile suppression. Build passes with the existing bundle-size warning.

An isolated Vite UI read the already available local atlas API in Chrome on September 12, 2026. No service restart/configuration change or neural command was issued. One observed load per profile:

| Profile | Metadata + asset reads | Browser parse/validation | Total | Declared / decoded bytes |
| --- | ---: | ---: | ---: | ---: |
| MaleCNS v1.0 | 143.7 ms | 174.6 ms | 318.3 ms | 13,349,686 / 13,349,686 |
| BANC v888 | 147.4 ms | 152.8 ms | 300.2 ms | 20,488,217 / 20,488,217 |

Switching to BANC replaced the Male measurement with matching BANC metadata; the test helper additionally verifies profile-mismatch suppression. These dev-server observations have unknown cache warmth and no uncertainty estimate, and are not production startup or portable performance promises. The local catalog still reported zero resident workers after verification. The temporary UI server and browser tab were closed.
