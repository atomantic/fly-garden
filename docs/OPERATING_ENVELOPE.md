# Explicit zero-drive operating-envelope measurement

`measure-operating-envelope.js` measures one or two independently owned temporary research workers. It requires `--measure` and one or two exact dataset/path pairs. It never reads or writes the app's individual catalog, capacity configuration, memory evidence or checkpoints. Importing its orchestration module performs no work. The separate older benchmark includes a probe mode; this tool never invokes that mode or the probe API.

The procedure verifies full pinned graphs, starts each temporary worker paused, explicitly advances a fixed zero-drive step budget, pauses, serializes its checkpoint, closes all original workers, and reopens the same temporary identities and exact clocks paused under fresh command epochs. Nothing is saved into the installation. A complete pair batch must finish before either worker begins the next batch. Every returned tick and simulated-time value must equal the requested budget exactly; missing/skipped/extra steps fail the measurement. These are independent workers, not a claim of a shared-world atomic transaction on a partial failure; failure discards the temporary run and produces no success report.

Default bounds are 1,000 neural steps per resident in batches of 100, a process-wide sampled RSS threshold of 2,048 MiB, and a 120-second wall deadline including loading and cleanup. The maximum accepted values are 10,000 steps, 1,000 steps per batch, 2,048 MiB and 120 seconds. RSS is sampled every 10 ms and checked around awaited operations; crossing the threshold aborts the standalone process, which also terminates its worker threads. The independent hard deadline remains armed during cleanup. RSS sampling can miss transient allocation peaks; the threshold is an abort rule, not an OS-enforced allocation quota. Budgets are never increased automatically. Missing/invalid graphs fail without fixture substitution.

After code review, run each scenario in its own process with the exact production Node executable. Examples below are explicit research actions, not startup instructions:

```sh
/opt/homebrew/Cellar/node/26.0.0/bin/node scripts/measure-operating-envelope.js --measure --dataset male-cns:v1.0 --data /absolute/path/to/malecns-v1/graph
/opt/homebrew/Cellar/node/26.0.0/bin/node scripts/measure-operating-envelope.js --measure --dataset banc:v888 --data /absolute/path/to/banc-v888/graph
/opt/homebrew/Cellar/node/26.0.0/bin/node scripts/measure-operating-envelope.js --measure --dataset male-cns:v1.0 --data /absolute/path/to/malecns-v1/graph --dataset banc:v888 --data /absolute/path/to/banc-v888/graph
```

Only successful completion emits JSON. The report contains model and dataset provenance, graph hashes, temporary individual IDs, exact completed clocks, per-batch and load/restart wall times, process CPU use, RSS baseline/peak, checkpoint serialization sizes, runtime, OS, CPU model/core count and physical memory. It does not emit local paths, checkpoint arrays, private identities or credentials. `totalWallMs` and CPU use span loading through successful paused reopen; final worker termination is excluded from those reported timings but remains covered by the hard process deadline. Pair throughput uses simulated time **per resident**, not the sum of both neural clocks. Process-wide RSS must not be added across worker threads.

The result is a narrow zero-drive throughput/residency measurement. Zero spikes mean no active-edge stress, sensory processing, embodiment rendering, optional chemistry, learning, recordings or provider activity is exercised. A ratio above one does not establish real-time interactive behavior. Measured capacity is not the configurable population ceiling or an admission authorization; fresh resource checks and the app's trusted per-profile memory evidence remain required. Renderer and active-workload costs remain outside this operating envelope.

Validation: `/opt/homebrew/Cellar/node/26.0.0/bin/node --test server/operating-envelope.test.js` passes five tests using lightweight backend doubles and a missing-data refusal. No full graph was loaded or stepped during tool development. The full single and paired runs below were subsequently authorized after review.

## Recorded full-dataset results — September 12, 2026

Three sequential processes used production Node **v26.0.0**, Darwin arm64, Apple M5 Max (18 logical CPUs), 128 GiB physical memory. Each scenario ran once, with the reviewed defaults: 1,000 zero-drive steps per resident, 100-step batches, a 2,048 MiB RSS abort threshold and 120-second deadline. No failed run, retry, tuning, probe, stimulation, automatic budget increase or production configuration change occurred. Source graphs were already installed and verified; no data was downloaded or reconverted.

| Scenario | Neurons / directed edges | Load ms | Fixed-step wall ms | Paused reopen ms | Sampled peak process RSS | Simulated / wall ratio per resident |
| --- | --- | --- | --- | --- | --- | --- |
| MaleCNS alone | 165,122 / 25,563,197 | 467.36 | 639.75 | 463.76 | 368.48 MiB | 1.563 |
| BANC alone | 155,858 / 13,366,670 | 301.93 | 605.18 | 313.17 | 280.77 MiB | 1.652 |
| MaleCNS + BANC | Both complete populations above | 767.65 | 654.64 | 798.50 | 568.59 MiB | 1.528 |

Every worker completed exactly 1,000 steps / 1,000 simulated milliseconds, with zero spikes and zero traversed active edges. All selected checkpoints reopened under the same temporary individual identity, preserved graph hash and clock, and a fresh command epoch, **paused**. The pair completed every barrier; neither worker began a later batch while the other was pending. All temporary workers were closed afterward. These facts validate this fixed zero-drive procedure, not retained learning or a shared embodied simulation.

The [sanitized machine-readable report](../connectome/operating-envelope-result.json) includes exact configuration, batch timings, CPU time, baseline/peak RSS, checkpoint sizes, model/provenance and hashes. The canonical graph hashes are `fa50e6e9add2a426f950cddc02b29b1c3dc267b98e1da33bf79cc1e5e1b3ce6a` (MaleCNS) and `b8e648ec2585061b91fb07ad22b33d41939e0b2c8b56e7f7dbf7d6f172025e99` (BANC), matching their pinned full graphs. Temporary IDs in this report were generated solely for these runs and are not installed individuals.

This establishes a measured **single and paired zero-drive envelope on this machine**, while configured capacity remains a separate operator ceiling. It does not validate larger populations, ongoing activity, renderer/recording costs, interactive latency, shared-world sensory coupling or operation under background memory pressure. One run per scenario supplies no uncertainty interval or sustained-load guarantee. The ratios above one must not be promoted to a real-time behavior claim. App admission still requires fresh total headroom and its separately trusted memory evidence; this report does not alter those inputs.
