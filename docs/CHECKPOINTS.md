# Fixture identity and checkpoint contract

The habitat still runs a synthetic 32-neuron fixture with fixed weights. Persistence does not establish retained learning, subjective experience, real connectome execution or biological continuity. Complete-graph individuals use the separate [research catalog](CONNECTOME_STORE.md) and checkpoint backend. Their supported dynamics and exact lineage are durable; no RNG or learned state is invented for models that do not implement them. Resource admission is described in [capacity](POPULATION_CAPACITY.md).

## Lifecycle

The service creates one durable primary fixture identity only when initializing a new store. Additional fresh identities require an explicit creation command; they have new IDs and independent initial state, rather than inheriting the primary's progress. Opening observer browsers never creates an individual. Boot loads each selected resident's checkpoint **paused**, creates a fresh command session per individual, and advances no missed time. It never starts providers, travel or simulation automatically.

- Run/Resume explicitly advances the resident fixture. Wall-clock gaps never catch up.
- Pause freezes the neural clock and current optional exposure. Resume continues that paused state.
- Rest freezes the current fixture and cancels optional stimulation without refunding reservations. This is an engineered control, not a modeled rest preference.
- Return Home cancels optional stimulation and pauses. A local controller is detached; an admitted managed visitor uses its separately scoped return flow and retains ownership until cleanup is acknowledged or its trusted expiry passes. No remote credential is restored.
- Save records current valid dynamics without changing run/pause state. Explicit saves persist progress; accepted optional encounters also save their reservation before delivery so a crash cannot refund exposure. Process exit does not silently create a checkpoint.
- Restore validates first, selects a saved ancestor or descendant, creates a fresh command session, cancels active optional input and pauses. Neural arrays and spike windows are retained exactly; canceled exposure means the subsequent stimulated trajectory intentionally differs. Reserved dose/recovery is retained at saved simulation time. Restoring an older checkpoint is an explicit history branch, not uninterrupted continuity. A restore that would erase a currently retained stimulus reservation is rejected; it cannot refund the exposure budget.
- A failed save/restore or stimulus-reservation write faults and stops only the selected resident, preserving its neural state and previous valid durable head. Other independent residents retain their state, clock, inputs and errors. A failed fresh-identity creation changes no resident. Successful explicit restore clears the selected fault; startup validation failure stops the service and preserves files.

The checkpoint UI serves the selected individual. The registry can explicitly create a fresh fixture identity or a research replica from a checkpoint. Replicas have new individual IDs and retain source individual/checkpoint lineage. Both start **saved-unloaded**. Explicit load constructs a paused runtime with a fresh session; repeated load of a resident leaves it unchanged. Explicit unload saves before releasing the runtime; failed saves retain the resident in a fault pause. Production startup loads the primary paused only after capacity admission; other saved individuals remain unloaded. The programmatic `residentIds` initialization option remains available for fixture integration tests, while production admission uses explicit load/unload.

Every resident has separate neural arrays, exposure ledger, clock, control and fault state. Saves and restores address one identity and reject another identity's checkpoint. Registry read results are detached from stored metadata. The service applies capacity admission separately. Independent residents keep independent clocks; explicitly joined shared fixtures use an atomic retinal barrier and joint checkpoints. The browser baseline accepts two members while the registry supports a bounded population. See [shared fixture sessions](shared-fixture-session.md). This store accepts only the synthetic fixture namespace; cross-dataset checkpoints fail before activation. Its RNG and learned parameters remain explicitly unsupported. Complete-graph individuals use independent dataset-qualified identities in the research catalog.

## Storage, bounds and recovery

The default app-owned store is `data/identities/` (ignored by Git). `FLY_GARDEN_DATA_DIR` optionally selects another private local directory. Do not put paths or local settings in public issues or exported artifacts.

`identities.json` retains stable identity records and a bounded checkpoint DAG. Version 1 contains individual checkpoints; version 2 additionally supports joint checkpoint references and poses. Version 3 adds optional version-1 `engineered-home-pose` metadata to an individual checkpoint. A new save with a known pose or joint save upgrades the document atomically; opening legacy versions does not rewrite them. Existing checkpoint IDs, payloads and digests remain unchanged. Unknown versions fail closed.

Legacy checkpoint digests cover the neural payload. A pose-bearing checkpoint digest covers the exact `{payload, embodiment}` envelope, and strict validation independently checks the pose's finite x/z bounds (±2) and yaw (±π), version and field set. Joint references must agree with a referenced pose-bearing checkpoint. Corruption checks are not authentication against a local writer. The neural payload and model compatibility contract are unchanged.

A known single-fixture home pose is retained on save, unload, explicit replica and restart. Restore selects the exact checkpoint pose, pauses and detaches the controller. The next explicit attach starts at that pose with a fresh private lease and fresh sensory epoch; no frame history, encounter enablement, motor command, observer camera or credential is restored. Detach and Return Home retain the latest local home pose. Shared separation transfers the last joint pose into this detached state. An older checkpoint without pose reports `pose: null` (unavailable); explicitly attaching it initializes the documented origin. It never inherits an unrelated later pose.

Writes serialize the complete bounded registry to a private temporary file, flush it, and rename it over the prior file. Data and lineage change together. SQLite supplies an exclusive local writer lock, released by the OS after process death; a second service cannot open the same store. This is local process-crash recovery, not a tested guarantee against hardware/power-loss corruption. Orphaned temporary files after a crash are not activated.

Each admitted non-quiet encounter adds a safety checkpoint before delivery. Storage ceilings are 16 MiB, 64 saved identities and 64 checkpoints per identity. Reaching a ceiling refuses the operation explicitly; no automatic history pruning deletes lineage. These metadata ceilings are not a measured worker-capacity limit. Use the explicit offline [backup/restore CLI](BACKUP_RECOVERY.md) while the app is stopped; unified backup preserves fixture and research catalogs plus recordings. Never splice records or edit identity IDs. Incomplete restore markers block startup. Historical measured workloads are documented in [operating envelopes](OPERATING_ENVELOPE.md); they are not universal capacity guarantees.

Only modeled state is recorded: fixture voltages, firing flags, tick, trailing spike windows, fixed dataset/model namespace and bounded policy reservations. The schema explicitly marks RNG, plasticity, refractory/delay buffers as unsupported/null inside the neural fixture payload. Supported engineered body pose is separately versioned in the registry checkpoint envelope. No session credentials, provider configuration, raw chat, desktop images or visit grants are serialized. No biological chemical model is implied by the optional input ledger.

## HTTP contract

Production service uses protocol version 1. `GET /api/state` returns primary `individualId`, fresh `sessionId`, `commandSequence` and persistence/head metadata. Polls never mutate state. Existing in-memory test adapters retain their legacy command body for compatibility; production durable commands require the complete envelope.

Each POST body includes exactly `protocolVersion: 1`, `individualId`, `sessionId`, `sequence` (last observed commandSequence + 1), plus the operation field below. Sequences are scoped to individual ID. Dataset/model namespace is fixed for each checkpoint and exposed in identity listings; it cannot be changed through creation or control commands. Raw neuron IDs are local to the dataset and individual context, never global population keys. Invalid/repeated sequences and old sessions return 409; refresh state before retrying. An admitted command consumes its sequence even if the operation subsequently fails. No blind automatic retries.

| Route | Method | Extra field / result |
| --- | --- | --- |
| `/api/control` | POST | `action`: start, pause, rest or home; primary only |
| `/api/encounters` | POST | `compoundId`; primary only |
| `/api/individuals` | GET | Resident and saved-unloaded identity and dataset metadata |
| `/api/individuals` | POST | No extra field; primary command envelope explicitly creates one fresh saved-unloaded fixture |
| `/api/individuals/:id` | GET | Scoped state and lineage; reading a replica does not load it |
| `/api/individuals/:id/control` | POST | `action`: start, pause, rest or home; selected resident only |
| `/api/individuals/:id/encounters` | POST | `compoundId`; selected resident only |
| `/api/individuals/:id/checkpoints` | GET | Checkpoint IDs, parent IDs, hashes and simulation times |
| `/api/individuals/:id/checkpoints` | POST | No extra field; save resident |
| `/api/individuals/:id/restore` | POST | `checkpointId`; same-individual resident restore only |
| `/api/individuals/:id/replicas` | POST | `checkpointId`; create a saved-unloaded research replica |

Creation consumes the primary command sequence; its response describes the new individual with its own sequence (zero). Refresh the primary before another creation. A duplicate creation envelope returns 409 without creating a second identity. Replica creation similarly consumes the source sequence and returns the replica state.

All mutation routes retain the service's Host, same-origin and cross-site checks. These are local-network controls, not user authentication. Replay/session recording belongs to #14; reading checkpoints here cannot advance the resident, call a provider or activate a replica.

## Evidence boundary

Automated tests cover exact fixture neural round trips, paused fresh-session recovery, canceled inputs with retained reservations, corrupt/version rejection, failed-write rollback, replica and multiple-resident isolation, save-before-unload recovery, targeted persistence faults, writer exclusion and stale-command rejection. No real dataset restore, learned-state retention, visual causal control or multi-worker capacity has been validated by these tests.
