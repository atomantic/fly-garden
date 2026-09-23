# Explicit complete-connectome research controls

The local API connects the pinned research kernels to a separate durable catalog. It does not attach a connectome to the synthetic garden body, infer learning, or implement sensory/motor mapping. Research workers have no automatic timer, startup probe or implicit stimulus. Starting arms a worker for a separately requested bounded advance; it does not advance time by itself. New identities are saved-unloaded, and every load/restore starts paused.

## Trusted local configuration

The fixed profiles are `male-cns:v1.0` and `banc:v888`. No browser request can supply a directory, descriptor, memory estimate or neural checkpoint payload. Server startup verifies the configured pinned graph manifest and every fixed file using 64 KiB streaming buffers. It derives the same graph digest used by the kernel without allocating graph arrays or starting a worker. The worker revalidates pinned files again when explicitly loaded.

| Profile | Default graph directory | Default memory report | Environment overrides |
|---|---|---|---|
| MaleCNS v1.0 | `data/malecns-v1/graph` | `data/malecns-v1/paused-memory.json` | `FLY_GARDEN_MALE_CONNECTOME_DIR`, `FLY_GARDEN_MALE_MEMORY_EVIDENCE` |
| BANC v888 | `data/banc-v888/graph` | `data/banc-v888/paused-memory.json` | `FLY_GARDEN_BANC_CONNECTOME_DIR`, `FLY_GARDEN_BANC_MEMORY_EVIDENCE` |

Paths are relative to the repository for these defaults. Environment values are local server configuration. Missing or corrupt files show the affected profile as unavailable. An incompatible existing catalog is preserved and unavailable rather than reset. The research catalog resides at `FLY_GARDEN_DATA_DIR/connectomes` (under the default identity data directory if that environment value is absent).

Memory reports come from an explicit run of `scripts/measure-connectome-memory.js`; startup never measures automatically. Accepted reports must match the graph digest, manifest provenance, exact engineered model, current Node version, platform and architecture, with `status:"measured-paused"`, `statusAfter:"paused"` and checkpoint serialization included. The suggested admission size must include the report's measured RSS increment, 50% engineering margin and 64 MiB allowance. Repository benchmark figures are never silently used as universal admission limits. Missing/mismatched evidence permits saved identity creation but blocks loading before a worker is constructed.

When at least one full graph verifies, the synthetic fixture remains saved-unloaded at boot so it does not silently consume the first resident slot. If no graph verifies, the previous fixture-only startup behavior is retained. Neither mode starts neural advancement. A pinned full graph's availability does not establish biological validity or operational capacity for a pair.

## HTTP protocol

All POSTs require the existing same-origin boundary and JSON content type. Unknown fields, stale epoch/sequence, query parameters and client paths are refused. Error messages redact private filesystem details. Read the current state after any error.

`GET /api/connectomes` returns `{protocolVersion:1,catalogEpoch,commandSequence,available,reason,profiles,individuals,population}`. Each profile includes availability, verified graph/manifest hashes, node/edge counts, model ID and local measurement availability. Individual snapshots include stable ID/profile, residency/status, session epoch, command sequence, selected checkpoint, bounded neural summary, provenance and explicit unsupported capabilities. Private configuration directories and neural arrays are absent. The population view includes fixture residents and loading/stopping research reservations.

`POST /api/connectomes` creates one unloaded identity with exactly:

```json
{"protocolVersion":1,"catalogEpoch":"<from list>","commandSequence":0,"dataset":"male-cns:v1.0"}
```

Use the **current** catalog `commandSequence`, not the fixture command convention of adding one. The reply includes `{state,catalogEpoch,commandSequence,population}`. Repeating the old creation envelope cannot allocate another identity.

`GET /api/connectomes/:id` returns the current individual snapshot. `GET /api/connectomes/:id/history` returns `{individualId,checkpoints}` with bounded checkpoint lineage/hash metadata.

`POST /api/connectomes/:id/commands` requires exactly:

```json
{"protocolVersion":1,"individualId":"<id>","sessionEpoch":"<current epoch>","commandSequence":0,"action":"load","steps":null,"checkpointId":null}
```

Use the **current** per-individual sequence. Actions are `load`, `start`, `advance`, `pause`, `rest`, `home`, `save`, `unload`, and `restore`. Only `advance` accepts integer `steps` from 1 through 1000; otherwise it must be null. Only `restore` accepts a saved checkpoint UUID; otherwise `checkpointId` must be null. Restore reads the exact selected source through the trusted store and retains its explicit lineage. Replies contain `{state,population}`. Load and restore issue fresh epochs; refresh before another command. Home pauses locally; this research backend has no external body or travel.

One public operation per individual can be pending. Different identities remain independent. Loads share an admission queue with fixture loads; paused, loading and stopping workers consume capacity until shutdown is confirmed. Queued fixture loads recheck their original session and command sequence before activation, so an older queued load cannot undo a newer unload or restore. An unknown footprint refuses a load. Current global memory/free-headroom pressure also pauses and refuses explicit start/advance without charging an existing resident as another load, evicting it or deleting saved state.

Pre-selection write failure preserves the prior durable head. A post-selection directory-sync failure reports uncertain durability and all affected selected heads; the service fails closed, evicts affected workers, and blocks new loads or mutations until the store is recovered. The store must be recovered before constructing/loading a fresh paused research session; no cached arrays bypass this boundary. See [catalog recovery](CONNECTOME_STORE.md).

## Shared research persistence

The full-connectome shared barrier has a separate, catalog-local persistence contract. `GET /api/connectomes/shared/checkpoints` lists bounded joint records. A paused shared session accepts `POST /api/connectomes/shared/:id/control` with `action:"save"`; the service checkpoints every member, validates dataset/graph/model/checkpoint lineage, projects the physical checkpoint-file bound, and replaces all selected heads plus one joint record in one catalog commit. The saved checkpoint selector is available independently of a live shared session, but `POST /api/connectomes/shared/restore` still requires the exact complete saved membership and current paused envelopes; it returns a new shared epoch with fresh paused worker sessions, or `resting` when every saved member is resting. Restore preparation reserves members, drains queued work, validates history/byte/catalog/staged durability, and rolls back prior ticks, modes and epochs on a pre-selection failure. Successful restore invokes the existing recording lifecycle callback for every member. Save and restore never start a worker, render a body, inject sensory input or call a provider. Shared responses also carry read-only barrier telemetry and capacity status, and `POST /api/connectomes/shared/:id/measure` runs an explicit, bounded zero-drive measurement on an already started session; see [barrier telemetry](CONNECTOME_SHARED_RESEARCH.md#barrier-telemetry-measurement-and-capacity). The fixture identity catalog remains separate; this endpoint is not a heterogeneous cross-store transaction.

## Validation boundary

Tests use tiny kernels, temporary catalogs and injected worker handles. They cover pinned verification/evidence matching, exact creation/command envelopes, cross-profile isolation, paused load/restore, no automatic advancement, precise restore lineage, schema-1 reopen, malformed joint catalog rejection, history/catalog/file capacity refusal, staged cleanup, unavailable measurements, shared capacity reservations, delayed admission, staged rollback with preserved tick/mode/epoch, all-resting status, storage-fault fail-closed behavior, command/sample/withdrawal/barrier restore reservations, recording invalidation, standalone saved-membership restore, and newer lifecycle commands. They do not claim full-graph throughput, body mapping, learning, live deployment or machine-independent resource limits.

## Complete local graph and browser evidence

Validation on September 12, 2026 used Node 24.14.1 on macOS arm64, a temporary identity store and an explicit 1 GiB test capacity budget. Production capacity settings were not changed. Both conventional graph bundles and their independently measured paused-memory reports passed descriptor validation.

- MaleCNS loaded all 165,122 neurons / 25,563,197 edges paused at tick zero. The browser saved that checkpoint, explicitly started, advanced one 100 ms batch, rested, restored the exact tick-zero source under a fresh session epoch, then saved and unloaded.
- BANC independently loaded all 155,858 neurons / 13,366,670 edges paused, saved, advanced one explicit 100 ms batch, then saved and unloaded at tick 100. The MaleCNS identity and checkpoint head remained separate.
- Both batches stayed silent under the declared zero-drive baseline: zero spikes, zero traversed active edges, and zero membrane potential. Every retained neuron participated in the numerical loop; no sensory input, probe, learning or body movement was tested.
- Restarting the isolated server preserved both identities and histories with zero research residents. Recovery required another explicit paused load; no elapsed wall time was replayed.
- BANC selection carried its dataset into the atlas. Changing the atlas dataset cleared the selected identity. The UI also tests atomic identity/dataset selection against delayed replies, and preserves checkpoint source selection by exact ID.
- A 390×844 browser viewport retained readable controls and wrapped identifiers. Keyboard navigation from the individual selector reached Start, and Enter activated it without advancing time. The viewport override was reset after testing.

The atlas remains anatomy-only in this change; no activity values are attached to cell positions. These checks establish local graph lifecycle and UI behavior, not biological motor control, learning, complete physiology or paired throughput. The 1 GiB test budget is not a universal admission recommendation. `/api/health` reports research availability, resident/running counts, per-profile memory evidence availability and the absence of embodiment separately from the fixture's status.

The final selection regression was also checked by selecting an unloaded BANC identity and immediately navigating to the atlas, before selected-detail polling completed. The atlas retained the BANC profile with that exact identity; returning to the lab retained the same selection.
