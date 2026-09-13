# Manual connectome sample recording

This is a typed observational history for exact selected neurons, separate from fixture rate recordings and neural checkpoints. It does not estimate firing rates, record all spikes, provide learning evidence or restore an individual. No recording operation starts or advances a worker, injects a probe, delivers input or calls a provider.

## Explicit workflow

1. Explicitly load an individual paused in **Connectome lab**. In **Nervous system**, select a cell from its matching anatomical dataset.
2. **Start recording selected neuron** checks the exact graph, model, individual and worker epoch and resolves the ID through one bounded read-only sample. It appends **no observation**. There is no recording timer.
3. **Capture fixed selection once** reads and writes one instantaneous observation. Repeated captures at the same tick are allowed and remain separate observation sequences; they are not separate neural events. The ordinary **Read neuron sample once** button never writes, even when a recording is active.
4. **Stop recording** finishes after any pending capture. A recording with no observations is partial, not complete. Export or inspect the stored history using the replay slider. The list/replay is also available in Connectome lab without loaded atlas data or a resident worker.

Selection is frozen at start. Navigating to another neuron or individual does not retarget an existing recording: its controls continue to name its recorded individual and fixed selection. Restore, unload or worker loss ends the old source partial. Pause and Rest retain the same session and permit explicit manual reads. A concurrent control change can cause a capture to be dropped explicitly instead of attributing values to an uncertain checkpoint/session. An already accepted old-session sample may finish writing after the boundary; the recording stays partial and never gains new-session values. Restart never resumes capture.

## Format and limits

The store lives at `FLY_GARDEN_DATA_DIR/connectome-recordings/`, with an exclusive writer lock, `samples.sqlite` index version 2, and generated UUID/sequence JSON chunks. Its typed export is `{schemaVersion:1, kind:'connectome-sample-recording-export', session, records, gaps, complete}`. These version numbers describe a new separate format; fixture `recordings/` and its index/export version 1 remain unchanged. Unknown versions are rejected without implicit migration.

The session contains the exact individual, dataset, graph SHA-256, graph manifest SHA-256, worker epoch, complete engineered model parameters and checkpoint-at-start. Its selection declares 1–256 unique ordered namespaced string IDs, selected count and total retained count. This is a declared extent of observation, not a whole-graph event stream. Equal numeric IDs in MaleCNS and BANC never match without their namespace.

Each record contains its stable event ID and observation sequence, integer tick and simulation time, a zero-width instantaneous source window, wall timestamp, command sequence, status and checkpoint reference at capture. Each selected neuron has dimensionless `potential`, a 0/1 pending one-step `firing` flag and `refractoryStepsRemaining`. Negative modeled potential is permitted and is not a punishment channel. No `ratesHz`, fictional world clock, arbitrary prose, provider configuration or credentials are accepted. Wall timestamps are provenance, not a guarantee of monotonic wall-clock passage.

The defaults are **32 MiB of chunks, 100 sessions, 10,000 observation slots and 64 KiB per chunk**. These are separate from the fixture recording store's default 32 MiB: when both are configured, their total chunk allowance is **64 MiB**, with additional bounded SQLite metadata. The UI displays configured combined allowance. This does not raise neural memory admission. There is one writer at a time and one pending capture per recording; a busy writer, quota exhaustion or failed write ends the affected capture partial. No automatic retention eviction deletes evidence. Delete removes only that recording, never a checkpoint or dataset.

Indexed chunks are checked against their lengths, hashes and strict typed schema. Missing or corrupt chunks are explicit gaps while valid observations remain readable. Reserved sequences whose writes never committed also remain gaps. The record index and last-tick metadata commit together; only known generated orphan chunk filenames are removed after interruption. Recording durability is observational and does not establish biological continuity or an arbitrary-filesystem power-loss guarantee.

## HTTP contract

- `GET /api/connectome-recordings`: availability, typed sessions, storage limits, configured combined chunk allowance and failure status.
- `POST /api/connectome-recordings`: exact `{protocolVersion:1,individualId,dataset,graphSha256,sessionEpoch,neuronIds}`. Validates against the loaded source and creates an empty manual recording.
- `POST /api/connectome-recordings/:id/capture`, `/stop`, `/delete`: exact empty JSON object. The recording ID already fixes the recipient and selection. Capture never accepts client-supplied electrical values.
- `GET /api/connectome-recordings/:id`, `/export`, `/replay`: stored observations only. Replay adds `mode:'read-only', canResume:false`; it does not receive a runtime or provider capability.

Mutation-shaped requests require the same origin. Start accepts at most 36 KiB; other bodies retain the 4 KiB limit. Unknown fields, routes and query parameters reject. UI request generations prevent late responses from attaching to another selected source. Replay does not change the app's selected live identity, clock or dataset.

## Offline backup and validation

Unified `backup-all`/`restore-all` includes the optional typed directory under application archive version 2. Version 1 archives remain supported and retain the absence of the new component. All writers must be stopped; the typed store's writer lock is checked separately. Every indexed chunk must be intact for backup; previously unindexed gaps remain explicit history. Restore validates all formats, hashes, extents, finite values, chronology and aggregate limits before creating a destination. It recreates an inert partial recording if capture was active at backup, without loading a worker or starting capture.

Small-fixture tests cover negative potential, exact large IDs, empty start, unchanged neural clocks and command sequences, ordinary read purity, stale epoch and restore races, writer exclusion, quotas and disk failure, interrupted/orphan/corrupt chunks, secret-field rejection, pure replay boundaries and version 1/version 2 unified backup round trips. These tests do not constitute full-dataset browser replay or biological validation; any later actual full-profile observation must be documented separately.
