# Fixture identity and checkpoint contract

The habitat still runs a synthetic 32-neuron fixture with fixed weights. Persistence does not establish retained learning, subjective experience, real connectome execution or biological continuity. The separate research worker is not checkpointed by this service. Dataset-backed persistence, full specimen state and external sensory leases remain in issue #2; resource admission/unload belongs to #22.

## Lifecycle

The service creates one durable primary fixture identity only when initializing a new store. Opening observer browsers never creates an individual. Boot loads the primary's selected checkpoint **paused**, creates a fresh command session, and advances no missed time. It never starts providers, travel or simulation automatically.

- Run/Resume explicitly advances the resident fixture. Wall-clock gaps never catch up.
- Pause freezes the neural clock and current optional exposure. Resume continues that paused state.
- Rest freezes the current fixture and cancels optional stimulation without refunding reservations. This is an engineered control, not a modeled rest preference.
- Return Home cancels optional stimulation and pauses. The fixture has no external embodiment to return from.
- Save records current valid dynamics without changing run/pause state. Explicit saves persist progress; accepted optional encounters also save their reservation before delivery so a crash cannot refund exposure. Process exit does not silently create a checkpoint.
- Restore validates first, selects a saved ancestor or descendant, creates a fresh command session, cancels active optional input and pauses. Neural arrays and spike windows are retained exactly; canceled exposure means the subsequent stimulated trajectory intentionally differs. Reserved dose/recovery is retained at saved simulation time. Restoring an older checkpoint is an explicit history branch, not uninterrupted continuity. A restore that would erase a currently retained stimulus reservation is rejected; it cannot refund the exposure budget.
- A failed save/restore faults and stops the resident, preserving neural state and the previous valid durable head. Successful explicit restore clears the fault; startup validation failure stops the service and preserves files.

The checkpoint UI serves the primary resident. The API can create an explicitly labeled research replica from a checkpoint. Replicas have new individual IDs, retain source individual/checkpoint lineage, and stay **saved-unloaded**. They cannot run or receive encounters; loading and configurable population admission are future work. There is no hard-coded two-individual registry and no shared-world scheduler.

## Storage, bounds and recovery

The default app-owned store is `data/identities/` (ignored by Git). `FLY_GARDEN_DATA_DIR` optionally selects another private local directory. Do not put paths or local settings in public issues or exported artifacts.

`identities.json` contains a version-1 registry, immutable identity records, checkpoint DAG parent references, source-replica references and checkpoint payloads with SHA-256 corruption checks. Checksums detect accidental changes; they are not authentication against a local file writer. Runtime validation independently rejects incompatible models, non-finite dynamics, malformed arrays and invalid policy ledgers. Unknown versions fail closed; no implicit migrations exist. A future migration must preserve the original file and explicitly produce a new version.

Writes serialize the complete bounded registry to a private temporary file, flush it, and rename it over the prior file. Data and lineage change together. SQLite supplies an exclusive local writer lock, released by the OS after process death; a second service cannot open the same store. This is local process-crash recovery, not a tested guarantee against hardware/power-loss corruption. Orphaned temporary files after a crash are not activated.

Each admitted non-quiet encounter adds a safety checkpoint before delivery. Storage ceilings are 16 MiB, 64 saved identities and 64 checkpoints per identity. Reaching a ceiling refuses the operation explicitly; no automatic history pruning deletes lineage. These metadata ceilings are not a measured worker-capacity limit. For manual backup, stop the service and copy the whole store. Restore a whole compatible store while stopped. Never splice records between stores or edit identity IDs. Backup automation, retention management and full-runtime operating envelopes remain planned.

Only modeled state is recorded: fixture voltages, firing flags, tick, trailing spike windows, fixed dataset/model namespace and bounded policy reservations. The schema explicitly marks RNG, plasticity, refractory/delay buffers and embodiment as unsupported/null for this fixture. No session credentials, provider configuration, raw chat, desktop images or visit grants are serialized. No biological chemical model is implied by the optional input ledger.

## HTTP contract

Production service uses protocol version 1. `GET /api/state` returns primary `individualId`, fresh `sessionId`, `commandSequence` and persistence/head metadata. Polls never mutate state. Existing in-memory test adapters retain their legacy command body for compatibility; production durable commands require the complete envelope.

Each POST body includes exactly `protocolVersion: 1`, `individualId`, `sessionId`, `sequence` (last observed commandSequence + 1), plus the operation field below. Sequences are scoped to individual ID. Invalid/repeated sequences and old sessions return 409; refresh state before retrying. An admitted command consumes its sequence even if the operation subsequently fails. No blind automatic retries.

| Route | Method | Extra field / result |
| --- | --- | --- |
| `/api/control` | POST | `action`: start, pause, rest or home; primary only |
| `/api/encounters` | POST | `compoundId`; primary only |
| `/api/individuals` | GET | Resident and saved-unloaded identity metadata |
| `/api/individuals/:id` | GET | Scoped state and lineage; reading a replica does not load it |
| `/api/individuals/:id/checkpoints` | GET | Checkpoint IDs, parent IDs, hashes and simulation times |
| `/api/individuals/:id/checkpoints` | POST | No extra field; save resident |
| `/api/individuals/:id/restore` | POST | `checkpointId`; same-individual resident restore only |
| `/api/individuals/:id/replicas` | POST | `checkpointId`; create a saved-unloaded research replica |

All mutation routes retain the service's Host, same-origin and cross-site checks. These are local-network controls, not user authentication. Replay/session recording belongs to #14; reading checkpoints here cannot advance the resident, call a provider or activate a replica.

## Evidence boundary

Automated tests cover exact fixture neural round trips, paused fresh-session recovery, canceled inputs with retained reservations, corrupt/version rejection, failed-write rollback, replica isolation, writer exclusion and stale-command rejection. No real dataset restore, learned-state retention, visual causal control or multi-worker capacity has been validated by these tests.
