# Anatomical point atlas: data contract

This atlas is independent of the neural worker and visual controller. Importing and reading its files only handles anatomical point metadata. It never advances neural time, sends stimuli, acquires a controller lease, invokes a provider or travels. No geometry or code from the caretaker's reference site was reused. The importer and loader are original project code; the underlying annotation datasets retain CC BY 4.0 and the attribution in their source locks.

## Exact sources and coverage

Both annotation files were acquired and their full SHA-256 and byte sizes verified against the existing source locks on September 12, 2026. Only annotations were acquired for this atlas; no connectivity, EM imagery, ROI meshes, synapse-point volumes or skeleton collections were downloaded.

| Profile | Source annotation rows | Same retained graph IDs | Positioned | Missing | Point meaning |
|---|---:|---:|---:|---:|---|
| MaleCNS v1.0 | 211,577 | 165,122 | 140,024 | 25,098 | `somaLocation`, annotated soma positions |
| BANC v888 | 188,508 | 155,858 | 138,159 | 17,699 | `root_position_nm`, root/representative points; not a blanket soma-location claim |

Source annotation rows include excluded categories and must not be labeled the anatomical neuron population. Every retained ID is preserved even when no position exists. The importer verifies the ordered raw-ID list against the existing graph lock's `ids.json` hash. It applies exactly the graph selection: MaleCNS `Traced`; BANC proofread or roughly proofread, excluding explicitly non-neuronal classes, with the v888 ID/root mapping checked. No spatial, degree or performance filter changes that population.

- [MaleCNS source lock](../connectome/malecns-v1.lock.json) pins the [official annotation Feather](https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/body-annotations-male-cns-v1.0-minconf-0.5.feather). `somaLocation` is a three-element int64 list. [Official dataset documentation](https://male-cns.janelia.org/download/) identifies native EM coordinates and dataset licensing. The [maintainer's soma-coordinate documentation](https://natverse.org/malecns/reference/mcns_soma_side.html) identifies the source field; its [unit conversion at a pinned commit](https://github.com/natverse/malecns/blob/daf8e2a9849cc77695b14bb6b9d4c02456cd3b3c/R/xyz.R) establishes 8 nm per raw coordinate unit. This implementation was inspected only to verify the data convention; none was copied or executed. Our conversion independently multiplies by 0.008 to store micrometers.
- [BANC source lock](../connectome/banc-v888.lock.json) pins [Dataverse annotation file 14033740](https://dataverse.harvard.edu/api/access/datafile/14033740). Its verified `root_position_nm` column contains comma-separated numeric triplets explicitly denominated in nanometers. The importer uses that column directly and scales by 0.001. It does not derive positions from the separate raw `position` or `root_position` fields. Those fields can refer to different annotation points, so their agreement is not assumed. [Deposit version 3 metadata](https://dataverse.harvard.edu/api/datasets/:persistentId/versions/3.0?persistentId=doi:10.7910/DVN/7WTH1N) records source attribution and CC BY 4.0.

The current public GCS BANC metadata file differs in size from the pinned Dataverse file and was not substituted. Dataverse prose also describes a different row count; the table above comes from the verified pinned bytes. Source replacement requires a new explicit lock, not an automatic fallback.

Native X/Y/Z ordering is preserved with no translation, reflection or specimen registration. Axis labels are source-coordinate X/Y/Z, in micrometers. Anatomical anterior/posterior/dorsal/ventral directions have not been independently established by this import and must not be invented in the UI. Neither profile supplies neurite skeletons through this layer. Straight connection lines between these points would be connectivity illustrations, not reconstructed morphology or proof of peripheral coverage.

## Files and loader

`connectome/atlas.lock.json` pins each generated `manifest.json` SHA-256. The manifest in turn pins every asset. An atlas directory contains only these application-selected files:

| File | Format | Contract |
|---|---|---|
| `manifest.json` | JSON, maximum 64 KiB | Version 1, dataset, source/graph hashes, units/transform/evidence, counts, groups, bounds and asset hashes |
| `positions.f32` | little-endian Float32, N×3 | Native XYZ in micrometers, ordered exactly like metadata |
| `valid.u8` | N bytes | 1 means a valid point; 0 means missing/invalid. Zero coordinate bytes in invalid rows are storage padding and must never become displayed neurons |
| `groups.u8` | N bytes | Index into the manifest's group array; changes display visibility only |
| `nodes.json` | JSON array of N compact row arrays | Columns are `id`, `rawId`, `type`, `superclass`, `region`, `positionStatus`; missing labels are empty strings |

IDs are exact strings, including BANC IDs beyond JavaScript Number precision. Public identity is `<dataset>/<rawId>`. Types/regions are source labels, not inferred neural function. Position status is `soma`, `root-representative`, `missing`, or `invalid-coordinate` as appropriate. An invalid numeric triplet remains inspectable and contributes to missing-reason counts; it is never repaired by sampling or transplanting another specimen's coordinates.

Groups are `visual-system`, `central-brain`, `ventral-nerve-cord`, `interregional`, and `unknown`. Male groups derive from its explicit `ol_`, `visual_`, `cb_`, `vnc_` superclass families and enumerated ascending/descending classes. BANC uses its own `region` labels plus enumerated interregional superclasses. Unknown is preserved. These display groupings are not new biological annotation claims. `bounds` contains `whole`, `brain`, `cord` and group boxes (`min`/`max` XYZ), or null when no eligible point exists. Whole bounds are calculated from valid Float32 points; no missing point contributes.

`loadAtlas(directory, dataset, {signal})` in `server/atlas-data.js` returns validated `manifest`, `manifestSha256`, typed `positions`, `valid`, `groups`, compact `nodes`, and `assets` containing the exact verified Buffers by filename. Cache this result per profile for read-only HTTP serving. Serve those buffers rather than rereading paths after validation or reserializing JSON under the original hash. Profile, manifest, file sizes/hashes, source/transform schema, exact IDs, masks, groups, coverage and whole bounds are checked before returning. Aborted reads reject rather than delivering a partial population. Missing/incompatible data must surface as unavailable with no fixture substitution.

## Reproduce

Prepare the pinned importer environment with `python3 -m venv .venv-atlas` and `.venv-atlas/bin/pip install --only-binary=:all: -r connectome/requirements.txt`. Download only the annotation URL from each source lock to the ignored paths below. The importer independently verifies full source hashes before reading Feather.

```sh
.venv-atlas/bin/python scripts/atlas.py --dataset male-cns:v1.0 --annotations data/atlas-sources/male-cns-v1/annotations.feather --output data/atlas/male-cns-v1
.venv-atlas/bin/python scripts/atlas.py --dataset banc:v888 --annotations data/atlas-sources/banc-v888/annotations.feather --output data/atlas/banc-v888
.venv-atlas/bin/python -m unittest discover -s tests -p 'atlas_test.py'
node --test server/atlas-data.test.js
```

The importer refuses an existing output directory and writes to a private staging directory before an atomic rename. It caps input rows at 250,000 and metadata at 64 MiB. All four assets are bounded; no dense connectivity allocation exists. Generated data and virtual environments remain ignored and are not committed.

## Evidence and remaining UI acceptance

Full imports completed locally in approximately 0.54 s (MaleCNS) and 0.76 s (BANC) after data acquisition, including selected-column decoding and output writing. These are individual warm-machine measurements, not performance guarantees. Raw assets total 13,349,686 bytes and 20,488,217 bytes respectively. A subsequent Node load/hash/schema-validation pass measured approximately 99 ms / 85 ms, with process RSS increases of 154,894,336 / 133,169,152 bytes and heap-used increases of 47,304,568 / 77,870,136 bytes. These single-process deltas include parsing/allocation behavior, are not isolated peak-memory measurements, and show why decoded atlases should be cached deliberately. Browser load, GPU memory, picking, mobile interaction, WebGL loss and rendered anatomical orientation still require separate measurements; this data deliverable does not claim those gates passed.

Tests cover unit conversion, exact IDs and specimen separation, retained missing/unclassified cells, invalid-coordinate masking, changed-source rejection, manifest limits, corrupted masks/positions, count/bounds mismatches and loader rejection of unpinned data. The loader was also run successfully on both complete generated atlases. Activity matching, sampled edge rendering, accessible selection and late profile-load handling remain UI/API integration responsibilities.

## Initial browser integration

The lazy-loaded Nervous system tab reads only `/api/atlas/<profile>` and four allowlisted verified assets. API loading is lazy, read-only and fails closed; cached responses retain the exact verified bytes and discard decoded node objects after validation. Profile switches abort previous loads and reset selection. The GPU uses one indexed point buffer with valid-position masks and per-group visibility; no per-cell meshes or neural stepping loop are created. Camera changes render on demand without animation, including reduced-motion use. Keyboard-accessible camera buttons and the bounded searchable table provide alternatives to pointer picking. WebGL failure preserves the table.

Browser verification on September 12, 2026 used the complete pinned data at the local test app: MaleCNS rendered 140,024 positioned cells; the brain preset displayed 122,977. Searching `missing` returned 25,098 cells, and keyboard Tab/Return selected `male-cns:v1.0/10262` with an explicit no-position message. Switching profiles reset selection and displayed 138,159 BANC root points; its nerve-cord preset displayed 21,411. The same synthetic individual remained paused at 0 simulated milliseconds throughout. The normal approximately 687-pixel-wide viewport showed wrapping controls and a horizontally scrollable table. This verifies interaction and source separation, not a formal frame-rate/GPU-memory/mobile benchmark.

Connections, adjacency inspection and matching live/replay activity remain separate follow-ups under issue #29. No unavailable overlay is shown as zero activity. Anatomical axis directions, reconstructed neurites and full peripheral coverage remain unclaimed.
