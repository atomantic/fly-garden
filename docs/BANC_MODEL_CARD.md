# BANC v888 sparse research profile

`banc:v888` is an explicitly loaded, local research profile, separate from the observatory's synthetic fixture. It uses a distinct female brain-and-nerve-cord reconstruction with independent state and dataset-qualified neuron identities. The observatory does not select either real-data backend. Loading starts paused; only explicit `start()` and bounded `advance()` calls simulate time. Missing, changed, unsupported or unreadable BANC files report **unavailable** and do not replace or stop a MaleCNS worker.

No biological validation, retained learning, sensory/motor interface, body controller, persistence, language or Eidoverse participation is provided by this research tool. Differences between these two specimens are not controlled biological sex comparisons. Inactivity remains an acceptable outcome.

## Source, artifact terms and modifications

Primary publication: Bates, Phelps, Kim, Yang et al., [Distributed control circuits across a brain-and-cord connectome](https://www.nature.com/articles/s41586-026-10735-w), Nature (2026). Its data-availability section identifies materialization **v888**, dated April 17, 2026, and the [Harvard Dataverse deposit](https://doi.org/10.7910/DVN/7WTH1N). This profile pins **deposit version 3.0**, released July 1, 2026. It is not the older v626 preprint deposit or brain-only FlyWire.

Before acquisition on September 12, 2026, the deposit API identified **CC BY 4.0**, and both selected file records were explicitly unrestricted with no different file terms. The [version-specific metadata endpoint](https://dataverse.harvard.edu/api/datasets/:persistentId/versions/3.0?persistentId=doi:10.7910/DVN/7WTH1N) and [source lock](../connectome/banc-v888.lock.json) record the artifact IDs, exact sizes, publisher MD5 checksums, locally verified SHA-256 hashes, license and attribution. Downloaded bytes matched the publisher checksums before import. Future acquisition requires the pinned SHA-256 and size; a different artifact is rejected. Keep the BANC collaboration attribution, publication/deposit links, [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/), and modification notice with redistributed derived graphs. The original Fly Garden importer/kernel remain MIT; binary import dependencies retain the NumPy BSD and Apache Arrow Apache-2.0 terms. No upstream analysis code is executed or copied.

| Artifact | Dataverse file ID | Bytes | Purpose |
|---|---:|---:|---|
| `banc_888_meta.feather` | 14033740 | 57,550,610 | Frozen v888 IDs, proofreading flags, classes and predicted transmitter |
| `banc_888_edgelist_simple_v3.feather` | 13918810 | 359,161,658 | Sparse directed-pair contact counts |

The v3 edge list uses synapse detections of at least **10 voxels**. The deposit recommends v3 for new work; the paper's quantitative analyses used **v2** (a different detection model and cutoff). Upstream compilation excludes autapses. We do not reconstruct missing self-edges or compare v3 counts as though they reproduced the paper's v2 analysis. Bulk EM, meshes, raw per-contact tables and cross-specimen matching files are neither downloaded nor substituted.

## Exact selection and mapping

The imported metadata has **188,508 rows**, rather than the deposit description's 188,162. The downloaded connectivity has **13,620,865 rows**, rather than its description's 13,507,098. The lock follows the verified artifact bytes and measured counts, not those stale descriptions or the paper's headline neuron count.

Retain every row with `proofread == "TRUE"` or `roughly_proofread == "TRUE"`, except explicit `super_class` values `glia`, `trachea` and `not_a_neuron`. This excludes 13,107 non-neuronal rows and 19,543 remaining unproofread rows, leaving **150,802 proofread + 5,056 roughly proofread = 155,858 neurons**. No other region, status-note, degree, contact-strength or capacity filter applies. Unclassified proofread cells and cells without retained edges remain. Detailed superclass counts are in the [derived graph lock](../connectome/banc-v888.graph.lock.json).

Each retained `banc_888_id` must exactly match `root_888`; `root_id` and other materializations are not identity substitutes. IDs are validated as canonical decimal strings, converted directly to int64 for sorting/index construction, and never rounded through floating point. Duplicate IDs, wrong materialization mappings, non-integral contact counts and duplicate directed pairs fail import. The on-disk numeric IDs preserve source identity; the loader exposes `banc:v888/<decimal-id>` or `male-cns:v1.0/<decimal-id>`. Thus equal numeric IDs cannot alias across datasets. CSR indices are local implementation indexes, not identities or cross-specimen homology mappings. Mixed-profile identity arrays are rejected.

| Connectivity category | Directed edge rows | Synaptic contacts |
|---|---:|---:|
| Complete sparse source artifact | 13,620,865 | 42,309,621 |
| Both endpoints retained | 13,366,670 | 41,845,636 |
| Presynaptic endpoint excluded only | 98,417 | 191,938 |
| Postsynaptic endpoint excluded only | 151,305 | 264,782 |
| Both endpoints excluded | 4,473 | 7,265 |

The retained graph includes all **7,195,317 single-contact edges**. It has zero self edges, reflecting the upstream compilation policy. The integer `count` column supplies contact weight; normalized influence fields `norm`, `post_count` and `pre_count` are not physiological model parameters and are ignored. Pair count and contact count have different units. Our modifications are explicit filtering, canonical outgoing CSR ordering and an engineered presynaptic sign; no biological endorsement is implied.

## Physiology and numerical contract

`banc-proofread-lif-v1` uses the same original CPU float64 kernel and engineered parameters as the separately documented [MaleCNS profile](CONNECTOME_MODEL_CARD.md): 1 ms steps, 20 ms membrane time constant, exact exponential leak followed by delayed instantaneous jumps, unit threshold, zero reset and resting drive, one-step transmission delay, two complete refractory steps, and gain 0.001 per contact. Inputs arriving during refractory steps are discarded. No noise, tonic stimulation, reward or RNG is added. Numerical faults retain the last completed state and stop advancement.

For this profile, **only `neurotransmitter_predicted` from the frozen metadata** supplies the sign. The metadata also includes literature-verified and mixed-transmitter labels, but this baseline does not silently merge them with classifier calls or override them with MaleCNS mappings. Missing predictions remain unknown; no confidence threshold is invented. Classifier confidence, co-transmission and receptor-specific effect remain limitations. Transmitter identity is not itself an excitatory/inhibitory effect measurement.

| Prediction | Retained neurons | Engineered sign |
|---|---:|---:|
| acetylcholine | 85,501 | +1 |
| glutamate | 24,101 | -1 |
| gaba | 20,915 | -1 |
| dopamine | 8,092 | 0 |
| histamine | 7,130 | 0 |
| unknown | 6,158 | 0 |
| octopamine | 2,078 | 0 |
| serotonin | 1,671 | 0 |
| tyramine | 212 | 0 |

**1,710,158 stored directed edges have zero modeled efficacy**, leaving 11,656,512 nonzero edges. Zero-effect categories stay in anatomical counts and storage. Uniform inhibitory glutamate is an explicit simplifying assumption. Real delays, electrical coupling, dendritic dynamics, conductances, receptor distributions, peptides, graded signaling and plasticity are missing. The reconstruction also lacks the lamina and ocellar ganglion as described by the primary publication; no other graph is spliced in to fill them.

## Reproduce and select a profile

Use Node.js 24+ and Python 3.11+ with the existing pinned binary import dependencies. Acquisition totals about 417 MB for BANC alone; allow 2 GB disk for BANC sources/derived copies/environment, or 5 GB for both profiles and repeated imports. Import/sort memory is separate from measured runtime residency. Downloads and diagnostics run only when deliberately invoked; startup and CI do not acquire data or simulate either graph.

```sh
python3 -m venv .venv-connectome
.venv-connectome/bin/pip install --only-binary=:all: -r connectome/requirements.txt
.venv-connectome/bin/python scripts/connectome.py acquire --dataset banc:v888 --sources data/banc-v888/sources
.venv-connectome/bin/python scripts/connectome.py verify --dataset banc:v888 --sources data/banc-v888/sources
.venv-connectome/bin/python scripts/connectome.py import --dataset banc:v888 --sources data/banc-v888/sources --output data/banc-v888/graph
node scripts/verify-connectome-numerics.js --dataset banc:v888 --data data/banc-v888/graph
node scripts/benchmark-connectome.js --dataset banc:v888 --data data/banc-v888/graph
# Acquire/import MaleCNS using its model card, then measure a separate paired process:
node scripts/benchmark-connectome.js --dataset banc:v888 --data data/banc-v888/graph --dataset male-cns:v1.0 --data data/malecns-v1/graph
```

Without `--dataset`, acquisition/import/benchmark retain the MaleCNS default. Each dataset must have its own source and graph directories; importing over an existing output or acquiring over incompatible bytes is refused. A repeat import to a new directory must match every locked manifest/array byte. The public module API adds `openConnectomeBackend(directory, { dataset: 'banc:v888' })`; its existing one-argument call still opens MaleCNS. Model/provenance telemetry always identifies the selected dataset. Unsupported profile names never become filenames.

Benchmark output is **schemaVersion 2**, replacing the prior single-resident shape. Each `runs[]` entry contains `residents[]` with model/provenance/load information, combined verified load time, per-worker and aggregate array-buffer bytes, process-wide RSS, and 1/10-second `measurements[]`. Each measurement records `simulatedMsPerResident`, elapsed wall time, per-resident neural summaries, and `simulatedWallRatio = simulatedMsPerResident / wallMs`. It never doubles paired speed by summing simulated time. Workers advance concurrently with a barrier between one-second intervals. Quiet and probe conditions use newly loaded independent workers; each scenario is measured in a fresh process. The OS process RSS high-water mark includes transient loading and both conditions; do not sum process RSS across workers.

See [measured numerical and residency evidence](CONNECTOME_RESIDENCY.md) for results and limits to resource admission.
