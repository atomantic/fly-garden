# Paused connectome memory measurements

The standalone `scripts/measure-connectome-memory.js` measures a complete verified local graph load, checkpoint export, JSON serialization/parsing and paused restore. It starts no neural steps or probes. Explicit `--measure` is required; imports or app boot never invoke it. An isolated process owns the worker and enforces a 120-second deadline and sampled 4096 MiB RSS limit by default, including during loading. Exceeding a bound or missing data fails without successful measurement output.

```sh
node scripts/measure-connectome-memory.js --measure --dataset male-cns:v1.0 --data data/malecns-v1/graph
node scripts/measure-connectome-memory.js --measure --dataset banc:v888 --data data/banc-v888/graph
```

Output includes exact graph/manifest hashes, model parameters, runtime/platform, process-wide sampled peak RSS, baseline, checkpoint JSON bytes and unchanged neural summary. Optional `--max-memory-mib` accepts 256–8192; `--timeout-seconds` accepts 1–120. No filesystem path, checkpoint arrays or private configuration is printed.

## Recorded evidence, 2026-09-12

Separate Node v24.14.1 processes on Darwin arm64 loaded the pinned full graphs already acquired locally. Both round-trips finished paused at tick zero, with zero spikes and zero traversed edges. No real neural graph was advanced.

| Profile | Neurons / directed edges | Baseline RSS | Sampled peak RSS | Increment | Checkpoint JSON | Wall time |
| --- | --- | --- | --- | --- | --- | --- |
| MaleCNS v1.0 | 165,122 / 25,563,197 | 49,774,592 B | 382,337,024 B | 332,562,432 B | 991,275 B | 510.0 ms |
| BANC v888 | 155,858 / 13,366,670 | 49,594,368 B | 293,240,832 B | 243,646,464 B | 935,687 B | 332.7 ms |

Graph SHA-256 values were `fa50e6e9add2a426f950cddc02b29b1c3dc267b98e1da33bf79cc1e5e1b3ce6a` and `b8e648ec2585061b91fb07ad22b33d41939e0b2c8b56e7f7dbf7d6f172025e99`, respectively. Their exact manifest hashes are recorded by the command and match the pinned graph manifests; this is not a sampled/cropped network.

The suggested admission estimate is **1.5 × measured RSS increment + 64 MiB**, giving 565,952,512 B for MaleCNS and 432,578,560 B for BANC in these runs. This explicit engineering margin is not a measured maximum or a universal default. The existing 512 MiB aggregate policy cannot admit MaleCNS under this estimate; increasing local limits must be deliberate and still account for current resident/UI/service resources and free memory.

Sampling may miss transient peaks. The recorded initial zero-valued checkpoint is smaller than later nonzero-valued JSON; the added margin does not establish a hard upper bound. Measurements exclude rendered embodiment, plasticity, sustained activity, pair throughput and application identity history retention. Rerun for a changed machine/runtime/backend and use fresh aggregate headroom before admission. The app must not silently convert these historical figures into validated full-population capacity.
