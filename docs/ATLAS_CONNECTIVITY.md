# Read-only atlas connectivity

`server/atlas-connectivity.js` exposes display samples and selected-cell adjacency from the complete pinned CSR graph. It uses the existing `loadConnectome` hash/schema validator, checks the atlas dataset and graph-manifest hash, requires identical namespaced ID ordering, and verifies the full anatomical contact total. No synthetic edges, coordinate-based guesses, fallback graph or neural worker are created.

The application should cache one `loadAtlasConnectivity(graphDirectory, dataset, loadedAtlas)` result per profile. It rejects absent or corrupt data; the UI must show connectivity unavailable while preserving independently valid point anatomy. The service exposes only `status()`, `sample(options)` and asynchronous `adjacency(id, options)`—no stepping, stimulus, movement, provider, checkpoint or travel authority.

## Display sampling

`sample({density = 0.001, maxEdges = 20000})` accepts density from zero through one and a cap from zero through 20,000. The requested sample count is `floor(retainedEdges × density)`, limited by the explicit cap. It chooses evenly spaced indices across the canonical outgoing CSR array, deterministically and without randomness. Only selected edges whose two endpoints have valid anatomical positions are returned for drawing. Missing endpoints are counted in `omittedMissingPositions`; no replacement edge is invented to meet a display target.

Every response keeps the full retained neuron/edge/contact counts separate from considered/displayed counts. Sampling is only a visual selection, is not statistically representative sampling for biological inference, and never changes the graph used by a simulation. Density zero legitimately displays no edges. A capped sample must not be labeled all connections.

Rows carry canonical `edgeIndex`, source/target array indices and exact namespaced string IDs, `anatomicalContacts`, `engineeredSign`, `engineeredWeight` and a `positioned` flag. Contact count is the original anatomical edge measurement. Sign derives from the pinned model's transmitter mapping, including zero for unmapped/silent types; it is not a measured universal excitatory/inhibitory property. Weight explicitly uses the disclosed engineered contact gain 0.001 from `LIF_MODEL`; it is not a learned weight or a synaptic measurement. Direction is always source → target. Straight lines are connectivity illustrations, not reconstructed neurites.

## Selected-cell adjacency

`await adjacency(id, {direction = 'both', offset = 0, limit = 100, signal})` accepts only an exact ID in that profile; limit is 1–1,000. It computes full incoming/outgoing edge and contact totals while returning one bounded page in canonical CSR order. A self edge counts once in the combined page and once in each incoming/outgoing total. Direction on each returned row is `incoming`, `outgoing` or `self`. Missing-position neighbors remain in the table with `positioned: false`; they are never plotted at an invented location.

`totalMatching`, `returnedEdges`, `nextOffset` and `omittedPageEdges` disclose pagination. These rows are a deterministic adjacency page, not the overview's density sample. Empty adjacency is valid and distinct from unavailable source data. No network fetch occurs during a query once graph data is loaded.

Incoming selection currently scans the full outgoing CSR, using O(page size) result storage. It yields to the event loop every 65,536 edges rather than building a large reverse index or blocking the neural timer for the full scan. Only one adjacency scan per service can run at once. Concurrent attempts fail explicitly; canceled scans release their slot and return no partial success. Routes should bind an AbortSignal to observer disconnection and the UI should cancel superseded selections. This is a bounded display query, not additional neural computation.

## Acquired data and validation boundary

The exact locked MaleCNS weights (1,051,241,946 bytes) and transmitter annotations (43,282,834 bytes), plus BANC weights (359,161,658 bytes), were downloaded after explicit acquisition authorization. Each source's size and SHA-256 were checked before publishing its `.feather` name. Existing annotation files were reused without substituting another release. Sources remain under ignored `data/malecns-v1/sources` and `data/banc-v888/sources`; the existing original importer publishes graph directories only after all derived hashes and counts agree with the repository locks.

Run imports without any worker or simulation advancement:

```sh
.venv-atlas/bin/python scripts/connectome.py import --dataset male-cns:v1.0 --sources data/malecns-v1/sources --output data/malecns-v1/graph
.venv-atlas/bin/python scripts/connectome.py import --dataset banc:v888 --sources data/banc-v888/sources --output data/banc-v888/graph
node --test server/atlas-connectivity.test.js
```

Focused tests verify exact contact/sign provenance, deterministic bounded sampling, zero density, missing-coordinate accounting, adjacency direction and self edges, complete counts with paging, namespace/hash mismatch rejection, unavailable files, event-loop yielding and canceled/concurrent scans. Full-dataset query timings and browser-rendering evidence must be recorded separately; passing these small boundary tests alone does not demonstrate interactive performance at full scale.

## Full-data verification on September 12, 2026

Both imports completed and matched the existing manifest and array hashes. No simulation steps were executed. MaleCNS import took 42.81 seconds; BANC import took 14.55 seconds. Their retained graphs contain 25,563,197 directed edges / 124,025,046 contacts and 13,366,670 edges / 41,845,636 contacts respectively.

A subsequent local read-only service check measured:

| Profile | Graph load + service validation | Overview query | Full adjacency query | Considered / positioned overview edges |
|---|---:|---:|---:|---:|
| MaleCNS | 348 ms | 4.38 ms | 129 ms | 20,000 / 18,161 |
| BANC | 221 ms | 4.11 ms | 60 ms | 13,366 / 12,216 |

The overview used density 0.001 and a cap of 20,000. Selected IDs were the first exact ordered IDs: `male-cns:v1.0/10001` had 695 incoming / 313 outgoing edges, while `banc:v888/720575940387110289` had zero of either in the retained graph. Zero adjacency was returned honestly rather than substituted. A 1 ms event-loop timer fired 127 and 60 times during the respective full scans, confirming yielding in these runs. These are single warm-machine observations, not throughput guarantees or browser frame-rate evidence. The service retains only the small copied validity mask alongside graph arrays and ID lookup; it does not retain duplicate point-cloud metadata or asset buffers.

## Browser verification

The local in-app browser rendered the complete MaleCNS point atlas with a 1,000-edge request: 25,563,197 retained directed edges and 124,025,046 anatomical contacts, with 913 positioned lines and 87 sample edges omitted for missing endpoints. The explicit 60-redraw benchmark displayed 140,024 points and 913 lines in 497.0 ms (120.7 redraws/s), estimating 4,645,340 geometry-buffer bytes. This is one static browser redraw-throughput measurement at the normal approximately 687-pixel-wide viewport, not GPU execution timing, peak browser memory, neural throughput or a cross-device guarantee. The same control at each of the 1,000, 5,000 and 20,000 ceilings, on both profiles and with the renderer JavaScript heap beside it, is tabulated in [display evidence](ATLAS_DISPLAY_EVIDENCE.md); there, twenty times more lines cost no measurable throughput because the point cloud dominates the frame.

Keyboard selection of `male-cns:v1.0/10001` showed 695 incoming / 313 outgoing edges and 16,051 incoming / 1,186 outgoing anatomical contacts, with 100 of 1,008 matching rows on the first page. The fixture remained paused; no retinal/controller requests or neural steps were involved. Dataset changes clear the old sample and selection, abort old reads, and require explicit connectivity enablement again. Missing neighbor positions remain in adjacency.
