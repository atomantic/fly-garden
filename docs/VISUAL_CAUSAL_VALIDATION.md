# Gated full-graph causal validation tool

The tool was prepared and tested without full-graph stimulation, then the single campaign recorded below was explicitly authorized after code review. No further run is authorized by this document. Importing its modules does not load or advance neural state. The CLI requires explicit `--run` plus two graph directories; invoking it is an active stimulation experiment, not a setup/health command. It has no adjustable gain, seed search, retry, condition selector or enlarged-budget option.

After separate review and authorization only:

```sh
node scripts/run-visual-causal-validation.js --run --male-data /verified/male/graph --banc-data /verified/banc/graph
```

The command uses the existing pinned graph loader; it never downloads, reconverts or uses the app catalog. One temporary worker is owned at a time, and terminated before the next condition. Each temporary kernel gets a fresh research-only ID and starts at exact zero state. It validates the graph/manifest hashes against the checked-in mapping and resolves every input/output ID before arming. No production identity, browser, live camera, body, language or reward mechanism is involved.

## Fixed campaign

Exactly two profiles × four conditions, in this order per profile:

1. unchanged-black;
2. changed-left-half-onset;
3. encoder-disconnected (same changed raster, proposed encoding reserved, kernel input severed);
4. motor-disconnected (same changed raster and neural input, yaw output forced zero).

All begin with a synthetic black 32x16 frame at tick 0. At tick 20, conditions 2–4 receive a left-half-white raster; every later accepted frame is identical. Frame cadence is 20 simulated ticks. Thus at most one nonzero onset is admitted per run. Pixel content is defined in the script; it contains no hidden target data. This is a synthetic raster intervention, not retinal imagery rendered from a body camera.

Each run executes 160 shared-prefix steps, saves at tick 160, executes 20 native continuation steps, pauses, restores that exact checkpoint, explicitly resumes and executes 20 duplicate continuation steps. The hard count is 200 actual kernel.step calls; final neural clock is 180, not 200 unique simulated milliseconds. Eight runs consume at most 1,600 total executed steps. Native and restored continuations use zero input and identical reconstructed 100-tick readout histories. Checkpoint digest and every subsequent neural/DNa02/motor record must agree exactly. “Paused restore” refers to this private orchestrator refusing step calls until its explicit resume; it is not an application runtime/epoch integration test.

The onset gain/config is the unchanged reviewed v2 hypothesis: 1.25 threshold-relative delta-V per full-contrast port, one tick only, fixed episode bounds. No run may adapt gain or retry until motion appears. The script derives no new biological signs or weights. Yaw uses the existing fixed DNa02 readout; forward speed must remain zero.

The entire standalone campaign has a 120-second hard process deadline and a 2 GiB process-wide sampled RSS abort threshold, including sequential worker ownership and cleanup. This is stricter than allowing 120 seconds for each condition. RSS is sampled every 10ms; sampling can miss transient allocation peaks and is not an OS allocation quota. A timeout, missing graph, invalid mapping, numerical fault, report mismatch or failed continuation yields incomplete status, retains only completed reports, stops the campaign and never retries. The hard process deadline remains armed through cleanup, so an unresponsive worker cannot extend the campaign indefinitely.

## Evidence and limitations

Successful output includes dataset/model/source/graph/mapping/config hashes; source-frame hashes and onset reservations; actual delivered port counts and aggregate delta-V; global neural counters each tick; DNa02 firing flags and 100-tick readout/yaw; input-port firing and potential bounds initially and at ticks 21/160; exact checkpoint/continuation hashes; executed versus unique-clock accounting; process resource measurements. Port sampling is bounded in batches of 256 IDs. Reports omit paths, checkpoint arrays, credentials and production IDs.

Completed means the fixed computation and continuation checks completed. `downstreamResponseObserved` and `yawObserved` are observations, not assertions of natural control. The disconnected controls make the source chain inspectable, but a full causal conclusion requires reviewing their actual results together. Zero DNa02 activity or zero yaw is a valid negative; do not treat nonzero input-neuron spikes alone as motor control. Zero-drive operating-envelope evidence does not establish this active-edge workload's performance. No real-world behavior, learning, subjective interpretation or coupled embodiment claim follows.

Development tests use a six-neuron synthetic graph with a deliberately known one-edge path, injected worker doubles, a missing CLI gate and a resource/deadline refusal. They demonstrate condition semantics, one worker ownership, exact accounting, interruption and no-retry behavior without loading actual graph arrays.

```sh
node --test server/visual-causal.test.js
```

## Authorized result — September 12, 2026

After root code review and explicit authorization, the fixed campaign ran exactly once using Node v26.0.0 on Darwin arm64. All eight conditions completed in 5,960.77ms with 447.5MiB sampled process peak RSS, below the unchanged 120-second / 2 GiB bounds. No retry, gain adjustment, stimulation escalation, production state change or deployment occurred. The [complete machine-readable result](../connectome/visual-causal-result.json) preserves all reports and traces; it is semantically identical to the retained raw output. Original raw-output SHA-256: `de63a1f71eb7c6e7a9bf1785fe90334d0d1f3c22832b5338da6f88a099316695`.

| Dataset | Condition | Delivered delta-V sum | Input-port spikes at tick 21 | Final total spikes | Traversed active edges | DNa02 firing / yaw |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Male CNS | unchanged-black | 0 | 0 | 0 | 0 | zero / zero |
| Male CNS | changed-left-half-onset | 1093.75 | 875 | 875 | 13,333 | zero / zero |
| Male CNS | encoder-disconnected | 0 | 0 | 0 | 0 | zero / zero |
| Male CNS | motor-disconnected | 1093.75 | 875 | 875 | 13,333 | zero / zero |
| BANC | unchanged-black | 0 | 0 | 0 | 0 | zero / zero |
| BANC | changed-left-half-onset | 895 | 716 | 716 | 11,614 | zero / zero |
| BANC | encoder-disconnected | 0 | 0 | 0 | 0 | zero / zero |
| BANC | motor-disconnected | 895 | 716 | 716 | 11,614 | zero / zero |

Every run used 200 executed steps and ended at clock 180 under the declared 160+20+20 accounting. Exact checkpoint restoration and the native/restored continuation comparisons passed for all eight runs. Forward speed was zero throughout. Source-frame hashes match across changed and disconnected conditions; the encoder-disconnected condition retained proposed input reservations but delivered no kernel input.

This is a **completed negative motor-readout result**. The engineered raster caused the mapped input populations to spike and their outgoing edges to be traversed. No additional spikes arose beyond those input populations; DNa02 remained silent and yaw stayed zero. The motor-disconnected control is therefore non-discriminating for output behavior in this campaign. Input response alone does not satisfy issue #4's sensory→neural→motor acceptance, and there is no working visual body controller to deploy. Any new dynamics or intervention hypothesis requires a separate reviewed protocol; these results are not an invitation to increase gain until a fly appears to move.
