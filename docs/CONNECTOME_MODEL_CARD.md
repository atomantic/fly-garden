# MaleCNS sparse research backend

This is an offline feasibility baseline, separate from the observatory's **Synthetic LIF fixture** (32 invented neurons, 64 fixed edges). The app does not load or select this backend. Importing the backend module does nothing; explicitly opening a worker loads data and returns **paused**, and advancing requires a separate `start()` call. Missing, changed or unreadable data returns **unavailable**, with no synthetic substitution. No timer advances neural time, so wall-clock delays and sleep do not cause catch-up simulation.

This baseline has no sensory adapter, motor readout, body controller, plasticity, persistent individual, checkpoint restore, language, or travel. It does not establish biological fidelity, learning, subjective experience, or real-time embodied performance. Inactivity is an acceptable result.

## Data and component provenance

The dataset is **MaleCNS `male-cns:v1.0`**, acquired September 12, 2026 from the [official download page](https://male-cns.janelia.org/download/). The page identifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) as its dataset license. Credit: FlyEM (HHMI Janelia), University of Cambridge Department of Zoology, MRC Laboratory of Molecular Biology, and Google Research. Our derived representation filters annotated neurons, retains edges between them, reorders those edges, and adds an engineered transmitter sign; these modifications are not endorsed by the dataset authors. Keep this attribution, source and license with any redistributed derived graph.

[Source lock](../connectome/malecns-v1.lock.json) pins exact HTTPS URLs, byte sizes and SHA-256 hashes of the annotation, consensus transmitter and confidence-0.5 connectivity Feather files. [Derived graph lock](../connectome/graph.lock.json) pins every resulting array hash and the complete manifest hash, including all category counts. The importer fails if any source or derived hash differs; a newer upstream release requires an explicit new model/data selection. Sources and derived arrays remain outside version control.

Original importer, LIF kernel, worker, tests and documentation are project MIT code; no DOOMFLY, Shiu, Eon or other simulation implementation was copied. The acquisition environment uses [PyArrow 25.0.1](https://github.com/apache/arrow/blob/apache-arrow-25.0.1/LICENSE.txt) (Apache-2.0 with bundled component notices) and [NumPy 2.3.3](https://github.com/numpy/numpy/blob/v2.3.3/LICENSE.txt) (BSD-3-Clause with distribution-specific bundled library notices). Their installed wheels retain their own LICENSE/NOTICE files; preserve those when redistributing an environment. They are importer-only dependencies. Execution uses Node.js built-ins and the project's existing Node installation; the UI's dependency licenses remain in its package lock/distributions.

## Exact graph selection

All annotation rows with `status == "Traced"` are retained, across brain and ventral nerve cord, including neurons with no retained incident edges. There is no region, degree, edge-weight or performance filter. Body IDs remain exact decimal **strings** at the public boundary, ordered by integer body ID; zero-based uint32 array indices are internal and are never neuron identities. The source connectivity table already uses the release's confidence-0.5 filter; no additional confidence filter is invented here.

| Annotation status | Count | Treatment |
|---|---:|---|
| Traced | 165,122 | Retained |
| Orphan | 15,925 | Excluded |
| Glia | 11,864 | Excluded |
| Unimportant | 10,751 | Excluded |
| null | 5,472 | Excluded |
| Assign | 1,832 | Excluded |
| Anchor | 611 | Excluded |

These are upstream annotation labels, not our judgments of welfare or scientific value. The full annotation table has 211,577 rows. The transmitter table has 1,835,518 segment rows. Every retained superclass and its count is listed in the derived graph lock, including unclassified (`null`) neurons; no superclass is additionally filtered. This selected population differs from other importers' reported 166,700-neuron selections and must not inherit their counts or claims.

| Connectivity category | Directed edge rows | Synaptic contacts |
|---|---:|---:|
| Entire source segment graph | 151,856,684 | 311,833,243 |
| Both endpoints retained | 25,563,197 | 124,025,046 |
| Presynaptic endpoint excluded only | 4,802,106 | 6,388,721 |
| Postsynaptic endpoint excluded only | 112,538,237 | 170,769,707 |
| Both endpoints excluded | 8,953,144 | 10,649,769 |

A directed edge row joins one source/target pair; its integer weight counts synaptic contacts. Duplicate pairs cause an import error rather than implicit double-counting. All 10,292,924 single-contact retained edges and all 101 retained self edges (473 contacts) remain. No synapse coordinates, skeletons, EM images, ROI volumes or raw per-contact prediction tables are downloaded or modeled. Excluded segments and their connectivity are not simulated; this is the **full declared retained graph**, not the full raw segment table.

## Physiology and numerical contract

The original point-neuron model `malecns-traced-lif-v1` has dimensionless potential, threshold 1, reset/rest 0, no tonic current, no noise and no RNG. Timestep is 1 ms; membrane time constant is 20 ms. Each step applies exact exponential leak `v * exp(-1/20)` and then the previous step's presynaptic spikes as instantaneous jumps of `contacts * sign * 0.001`. All axonal delays are one timestep. Threshold equality fires; reset occurs on that step, followed by **two complete refractory steps**. Inputs during refractoriness are discarded. Negative potential is allowed and is an electrical model value, not a pain or punishment channel. The gain, voltage scale, homogeneous time constant, delay, refractory interval and threshold are engineering choices, not fitted physiology.

The source `consensus_nt` supplies an assumed presynaptic sign:

| Consensus transmitter | Neurons | Modeled sign |
|---|---:|---:|
| acetylcholine | 103,718 | +1 |
| gaba | 22,055 | -1 |
| glutamate | 29,296 | -1 |
| histamine | 5,910 | 0 |
| unclear | 3,100 | 0 |
| missing/unknown | 502 | 0 |
| dopamine | 392 | 0 |
| octopamine | 101 | 0 |
| serotonin | 48 | 0 |

Transmitter is not receptor effect: in particular, treating all glutamate as inhibitory is a simplifying assumption, not a universal biological claim. We do not guess effects for unmapped categories or add reward/modulatory currents. **1,104,763 retained directed edges have zero modeled efficacy**; they remain stored and counted anatomically. Effective nonzero connectivity is therefore 24,458,434 edges. Receptor types, co-transmission, dendritic dynamics, conductances, graded signaling, endogenous chemistry, electrical synapses, real conduction delays and plasticity are not modeled.

Storage uses outgoing CSR: uint32 offsets/targets/contact counts, int8 signs and float64 neural/incoming buffers, with O(neurons + edges) memory. Per-step work visits all neurons and outgoing edges of previously firing neurons; no dense all-neuron matrix exists. Double-buffered neural state commits only after the entire next step is finite. A numerical fault preserves the last completed step and stops the worker. Structural validation and pinned array hashes prevent partial/corrupt graph activation.

There is **no neural-to-motor readout**. Telemetry reports aggregate spikes, potential range, simulated time and traversed edges. The optional benchmark probe initializes a single spike in every hundredth retained index (1,652 neurons), puts those cells into refractory state, and never repeats the injection. This deterministic engineered perturbation is not sensory input, a reward, or a learned behavior. It is excluded from the `totalSpikes` counter, which counts subsequently generated spikes.

`server/connectome.js` exposes `openConnectomeBackend(directory)` returning `ready`, `snapshot()`, `start()`, `pause()`, `advance(1..1000)`, `probe(indices)` and `close()`. Operations use version-1 request/response messages with monotonically increasing request IDs. Advancement is explicit and bounded per request; callers should await each request before sending another. A future runtime adapter must preserve the fixture identity and explicit user backend/start selection, and must add welfare-bounded sensory and motor contracts before integrating this research worker into the habitat. Worker termination rejects outstanding requests; recovery requires reopening, which returns paused and does not claim persistence.

## Reproduce locally

Use Node.js 24+ and Python 3.11+ with compatible binary wheels. Allow roughly 4 GB disk for sources, derived arrays and an isolated import environment; retain a 16 GB memory budget for import/sorting. Execution has much smaller measured requirements below. Data acquisition needs public HTTPS access; import, verification, tests and simulation are local. Run these commands deliberately; neither app startup nor CI downloads data or benchmarks a connectome.

```sh
python3 -m venv .venv-connectome
.venv-connectome/bin/pip install --only-binary=:all: -r connectome/requirements.txt
.venv-connectome/bin/python scripts/connectome.py acquire --sources data/malecns-v1/sources
.venv-connectome/bin/python scripts/connectome.py verify --sources data/malecns-v1/sources
.venv-connectome/bin/python scripts/connectome.py import --sources data/malecns-v1/sources --output data/malecns-v1/graph
node scripts/benchmark-connectome.js --data data/malecns-v1/graph
npm test
python3 -m unittest discover -s tests -p '*_test.py'
```

Acquisition checks hashes before publishing files, uses unique temporary files, reuses only verified sources and refuses to overwrite corrupt ones. Import refuses an existing output directory and atomically publishes only the complete verified graph. To check reproducibility, import again into a different output directory; the pinned manifest verifies exact counts and all byte hashes. Array files use little-endian order; unsupported byte order reports unavailable.

## Validation and measured limits

Numerical tests compare 120 steps against an independently written timestamped-event reference with exact spike/refractory agreement and potential absolute error below **1e-12**. A separate 100-step analytic exponential-decay comparison uses the same tolerance. They exercise threshold equality, one-step delay, refractory rejection of self-input, inhibition, unknown-transmitter zero efficacy, stable IDs beyond JavaScript's safe-integer range, malformed arrays and unavailable data. This validates the stated discrete model; there is no tolerance claim against biological recordings, Shiu/Eon dynamics, or a different timestep/model.

The checked-in [benchmark result](../connectome/benchmark-result.json) records the local run, full graph identity, parameters, load time, process OS high-water RSS, sampled RSS, worker array bytes and 1/10 simulated-second timings. Full import was reproduced byte-for-byte twice. Rendering and plasticity are absent, so combined-workload feasibility is **not measured**. Reported load timings include reading, SHA-256 checking and structural validation, using a warm filesystem cache; they exclude download and import. Timings are observations on this run, not service-level guarantees.

Measured on local macOS arm64, Node.js 26.0.0, without another import running:

| Condition | Verified load | 1 simulated second | 10 simulated seconds | 10-second simulated/wall ratio |
|---|---:|---:|---:|---:|
| Quiet | 192 ms | 605 ms wall | 6.244 s wall | 1.602 |
| One-time probe | 183 ms | 757 ms wall | 7.109 s wall | 1.407 |

The process OS high-water RSS was 330,992 KiB (323.2 MiB), including parent and sequential workers. The probe worker reported about 200.2 MiB in array buffers. Import wall times were 103.97 s initially and 41.77 s on repetition; these are separate from runtime load measurements. No private machine name or identifier is required to reproduce the reported model/data configuration.

The quiet network produces no spikes. The single perturbation traverses 248,801 anatomical edges, but produces **zero subsequent spikes** and decays to silence. This is a negative result for self-sustaining activity under these parameters, not a failure to be punished or hidden. Most measured steps therefore have no active synaptic work; throughput must not be generalized to sustained spiking, visual control, retained learning, rendered embodiment or Eidoverse real-time admission. Those capabilities remain unvalidated and unavailable in the observatory.
