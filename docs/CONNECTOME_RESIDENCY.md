# Local connectome numerical and residency evidence

Measured September 12, 2026 with Node.js 26.0.0 on local macOS arm64. The [machine-readable result](../connectome/residency-benchmark.json) contains exact graph-manifest hashes, all model parameters, timings, OS process peak RSS, worker array-buffer sizes and numerical comparisons. No graph arrays, private machine identifier or local filesystem path is committed. These are research measurements of the [BANC profile](BANC_MODEL_CARD.md) and [MaleCNS profile](CONNECTOME_MODEL_CARD.md), independent of the observatory's synthetic fixture.

## Reproducibility and compatibility

BANC sources matched publisher MD5 checksums, then were pinned by SHA-256 and size. Repeated locked imports reproduced every array byte and manifest. Initial BANC import took 11.58 seconds; MaleCNS re-import took 36.95 seconds and reproduced its existing manifest exactly. Import time is separate from runtime verified load time, and filesystem cache was warm for load measurements.

The final BANC graph retains **155,858 neurons / 13,366,670 directed edges / 41,845,636 contacts**. MaleCNS retains **165,122 / 25,563,197 / 124,025,046** with unchanged source and array hashes. Selection policies differ and are documented per profile; neither is silently cropped to meet a benchmark budget.

Live checks against both full graphs confirmed that swapping profile locks is rejected, missing or incompatible BANC reports unavailable while a valid MaleCNS worker remains usable, both load paused, each reports its own model identity, and advancing BANC leaves MaleCNS time unchanged. Unit tests cover namespace collisions (including IDs beyond JavaScript's safe integer), mixed-profile graph rejection, malformed metadata/mappings, unsupported profile selection, acquisition failures and independent dynamics. Data-free CI runs these tests without network acquisition.

## Numerical comparisons

Run `node scripts/verify-connectome-numerics.js --dataset <profile> --data <graph>` deliberately for each profile. The diagnostic loads and verifies the full locked graph, initializes one spike at every hundredth retained index, and compares 120 timesteps with an independently written arrival-event reference using absolute refractory deadlines. It checks **every retained neuron's voltage, firing and refractory state at every step**. Reference and kernel use the same declared engineered model; this is not agreement with biological recordings or a different published simulation.

| Profile / CPU float64 sparse backend | Initial probe cells | Maximum absolute voltage error | Spike/refractory agreement |
|---|---:|---:|---|
| BANC v888 | 1,559 | 2.776e-16 | Exact |
| MaleCNS v1.0 | 1,652 | 9.992e-16 | Exact |

The voltage tolerance is **1e-12 absolute**. Both full-graph probes produce nonzero decaying voltages and zero subsequent spikes. This negative outcome is recorded, not hidden by trivial no-input testing. Independent synthetic reference tests also exercise recurrent spike cascades, threshold equality, one-step delay, complete refractory intervals, inhibitory signs and zero-effect transmitter edges. Small-graph analytic decay tests use the same tolerance. Only the CPU float64 backend is implemented; no Metal, GPU, Shiu/Eon or biological parity is claimed.

## Single and paired residency

The CLI starts one fresh process per scenario, loads each requested worker paused, then measures separate quiet and single-probe conditions. Loads are sequential while earlier residents remain loaded; neural advancement is concurrent with a barrier after every simulated second. Each resident completes 10,000 steps. Reported paired simulation/wall ratios use **10 seconds per resident**, not a misleading 20-second sum. These benchmarks have no rendering or plasticity, and the one-time probe is an engineered diagnostic rather than a sensory or reward signal.

| Scenario | Condition | Combined verified load | Wall time for 1 simulated second | Wall time for 10 simulated seconds | Simulated/wall ratio |
|---|---|---:|---:|---:|---:|
| BANC alone | Quiet | 171 ms | 576 ms | 5.743 s | 1.741 |
| BANC alone | One-time probe | 159 ms | 700 ms | 6.722 s | 1.488 |
| MaleCNS alone | Quiet | 244 ms | 626 ms | 6.229 s | 1.605 |
| MaleCNS alone | One-time probe | 243 ms | 752 ms | 7.424 s | 1.347 |
| BANC + MaleCNS resident | Quiet | 416 ms | 653 ms | 6.584 s | 1.519 |
| BANC + MaleCNS resident | One-time probe | 429 ms | 807 ms | 7.809 s | 1.281 |

| Scenario | OS peak process RSS, including loading and both conditions |
|---|---:|
| BANC alone | 252.6 MiB |
| MaleCNS alone | 340.1 MiB |
| Both resident | 530.4 MiB |

The BANC probe traversed 129,712 anatomical edges; MaleCNS traversed 248,801. Both produced **zero subsequent spikes** and decayed to silence. Most measured steps therefore do little synaptic work. Ratios above one do not establish real-time control, sustained spiking capacity, benign learning, embodied performance or sex-specific behavior. Timing variance and shared system load were not controlled as a hardware study.

## Input to resource admission

For [resource-aware capacity #22](https://github.com/atomantic/fly-garden/issues/22), the measured pair establishes that these exact graph/model versions can be resident together in this local research process without cropping or cloud execution. OS RSS is process-wide, while `residentArrayBufferBytes` is per-worker: **do not add process RSS reported by individual workers**. The scenario high-water values include load/validation overhead and may include transient allocations; differences between scenarios are not guaranteed marginal worker costs.

These values are evidence inputs, not hard admission thresholds. Operational admission must still measure headroom and concurrent rendered/active workloads, include worker/telemetry/checkpoint overhead and a safety margin, count paused loaded workers, and preserve current individuals when capacity decreases. This result explicitly records `operationalCapacityEstablished: false`. More than two residents, sustained activity, rendering and plasticity remain unmeasured. No configured population ceiling or fallback to cloud is introduced here.
