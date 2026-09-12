# Prepare the complete pinned datasets locally

The explicit preparation command acquires the pinned release files, imports the complete **declared retained population** into a sparse graph, and prepares the anatomical point atlas. It does not downsample the retained graph to fit the display or available memory. MaleCNS retains 165,122 traced neurons; BANC retains its own 155,858 proofread/roughly-proofread neurons. Excluded unproofread segments, glia and missing source coverage remain exclusions documented by each source lock, not invented neurons. Neither dataset is a complete physiological model or a recovered individual mind.

Use Python 3.11+ and a local virtual environment with the checked-in binary dependencies. Setup is separate and explicit:

```sh
python3 -m venv .venv-connectome
.venv-connectome/bin/pip install --only-binary=:all: -r connectome/requirements.txt
```

The pinned versions are NumPy 2.3.3 and PyArrow 25.0.1. On Windows use `.venv-connectome\Scripts\python.exe` and its `pip.exe`. Allow approximately 5 GB disk for both profiles, generated graphs/atlases and the environment, and a 16 GB memory budget during import/sorting. These are planning allowances, not enforced peak guarantees. The command checks conservative remaining disk headroom before new stages; it never crops a graph when resources are insufficient. Source downloads total approximately 1.1 GB for MaleCNS and 417 MB for BANC. Imports can take time; a slow import is not neural simulation.

From the repository root, run one command per desired profile:

```sh
.venv-connectome/bin/python scripts/prepare-connectome.py --prepare --dataset male-cns:v1.0 --sources data/malecns-v1/sources --graph data/malecns-v1/graph --atlas data/atlas/male-cns-v1
.venv-connectome/bin/python scripts/prepare-connectome.py --prepare --dataset banc:v888 --sources data/banc-v888/sources --graph data/banc-v888/graph --atlas data/atlas/banc-v888
```

These graph and atlas paths match the app's local discovery conventions. Existing annotation-only atlas sources can instead be supplied through `--sources`; acquisition will reuse the verified annotations and fetch only the missing pinned source files. Each source directory is dedicated to one profile. Do not run concurrent preparation commands targeting the same directories.

`--prepare`, the exact profile and all three paths are required. There is no implicit network action on import, app startup or recovery. Preparation starts no workers, probes, benchmarks, neural steps, provider calls or browser actions. A final JSON report includes the retained counts, profile, source-lock/graph/atlas hashes and separate dataset attribution. The report's `prepared` status means the data files passed verification, not that a runtime load was admitted or a biological behavior validated.

## Verification and recovery

The command reuses the existing acquisition, graph importer and atlas importer. Every source has a pinned HTTPS URL, byte count and SHA-256; oversized downloads fail. Existing sources must match exactly. Graph and atlas manifests must match their checked-in SHA-256 before their asset names or hashes are trusted; every allowlisted asset then passes a size/hash check. Manifests are capped at 2 MiB and assets at 512 MiB. Final outputs are verified again. No untrusted manifest path can select a different file.

A corrupt or incompatible existing output stops preparation before download or conversion. Nothing is silently deleted, repaired, overwritten or replaced with a fixture. Preserve the suspect directory for inspection and deliberately choose fresh output paths after diagnosing it. Each importer publishes its own complete stage atomically. If a later stage fails, earlier verified stages remain reusable: rerun the same command after fixing the cause. Abandoned private staging directories are not successful outputs; the command does not erase them. Hashing complete existing files costs disk reads but avoids unnecessary downloads and reconversion.

The ignored `data/` directory and virtual environments are never bundled into Git. Back up raw sources/derived files separately if desired; model checkpoints and identity backups have their own continuity contract. Do not move runtime checkpoint directories into preparation output paths.

## Runtime admission is a separate action

The graph can be installed without loading a brain. Loading requires a trusted local paused-memory measurement and operator capacity settings. The explicitly invoked [measurement tool](CONNECTOME_MEMORY.md) produces evidence for the exact graph, model and local runtime; never manufacture an estimate or automatically benchmark during installation. For the app's conventional evidence path, redirect that tool's successful JSON output to `data/malecns-v1/paused-memory.json` or `data/banc-v888/paused-memory.json`. A missing or stale measurement blocks load. Measurement itself deliberately loads a paused worker and is separate from these preparation commands.

## Provenance and licenses

Original preparation code is MIT. Both pinned datasets retain **CC BY 4.0**, with independent source attribution and release selection in [MaleCNS source lock](../connectome/malecns-v1.lock.json) and [BANC source lock](../connectome/banc-v888.lock.json). NumPy and Apache Arrow retain their own BSD-3-Clause and Apache-2.0 terms respectively; dataset licenses do not license dependency code or third-party body assets. See the [MaleCNS model card](CONNECTOME_MODEL_CARD.md), [BANC model card](BANC_MODEL_CARD.md) and [atlas provenance](ANATOMICAL_ATLAS.md). No receptor physiology, learning or fly-body control is established by installing measured wiring.

Validation: `python3 -m unittest discover -s tests -p 'prepare_connectome_test.py'` uses tiny local fixtures and no network or full graph. It checks opt-in, exact provenance, corruption/no-overwrite, stage reuse and interrupted-stage recovery.

The complete local MaleCNS and BANC bundles were also checked with this command on September 12, 2026. Both returned `prepared` with graph/atlas `verified-existing`, sources `verified`, the exact counts above, and `simulationStarted:false`. No files were downloaded or reimported during that verification.
