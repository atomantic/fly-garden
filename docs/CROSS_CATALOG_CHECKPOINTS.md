# Cross-catalog research checkpoint coordinator

`server/cross-catalog-checkpoint.js` coordinates one joint checkpoint save or restore across independent catalogs: the synthetic fixture identity catalog and one or more full-connectome research catalogs. It adds a declared adapter contract, a durable recovery journal and fail-closed operator recovery. It is a cross-catalog research transaction. It is not embodied, sensory, learned or biological behavior, and it never starts a simulation.

**Scope of this increment.** The coordinator, journal and contract are implemented and tested with contract-conforming catalog doubles that model both families. The real `identity-store.js` and `connectome-store.js`/registry adapters are **not wired yet**, and no HTTP route or UI exposes the coordinator. No mixed live session exists yet (see the [render-only mixed world shell](MIXED_WORLD_SHELL.md)), so nothing in the running app can reach this path. The catalog-local joint transactions ([fixture](shared-fixture-session.md), [full-connectome](CONNECTOME_STORE.md)) are unchanged and remain the only supported persistence paths.

## Trust boundary

Adapters are trusted server-side integrations configured by the application. Browser or network input can select only stable individual IDs and catalog namespaces. It cannot choose directories, payloads, heads or adapters. The coordinator validates every value an adapter returns (exact keys, UUIDs, hashes, membership and clocks) and treats disagreement as a refusal or an uncertainty, never as a fallback. No credential, directory, neural array or worker handle enters the journal. It is local only, with no cloud coordinator, network relay or public posting.

## Adapter contract (version 1)

Each adapter declares `contractVersion: 1`, `catalogType` (`fixture-identity` or `full-connectome`) and a unique `catalogId` namespace (for example `fixture`, `connectome:male`, `connectome:banc`). Undeclared versions, unknown types, duplicate namespaces and missing methods are refused at construction.

| Method | Contract |
| --- | --- |
| `epoch()` | Current catalog epoch. A change during a transaction aborts it. |
| `member(id)` | Exact view `{individualId, catalogType, head, dataset, graphSha256, modelId, status, mode, sessionEpoch, simTimeMs}`, or `null` when the ID is not in this catalog. |
| `reserve(ids)` | Refuses when the adapter already has work in flight for those IDs. Returns a release function. While reserved, the integration must refuse samples, lifecycle commands, joins, withdrawals and barriers for those IDs. |
| `preflight(request)` | Checks schema, recipient, namespace, parent head, history, restore lineage/hash, byte/file capacity and durability requirements. It writes nothing. |
| `stage(request)` | Writes immutable, unselected payloads keyed by `transactionId`. For restore it also prepares paused runtime candidates. It returns the planned head for each member. |
| `commit({transactionId})` | Selects every planned head for this catalog in one catalog-local commit. A post-rename durability failure throws `code: 'CATALOG_DURABILITY_UNCERTAIN'` with the complete `selectedHeads`. |
| `cancel({transactionId})` | Removes only transaction-owned, unreferenced staged payloads and discards any prepared runtime candidates. It is idempotent and keyed by `transactionId`, so it also works after a restart. |
| `revert({transactionId, heads})` | Reselects content equal to each prior head. It must be idempotent per `transactionId`: a repeat call reports the heads the first call selected and appends nothing. A fixture catalog reselects the prior checkpoint. A full-connectome catalog appends a restore lineage entry. History is never deleted. |
| `activate({transactionId, members})` | Swaps prepared runtime candidates in, paused. It returns `{individualId, checkpointId, sessionEpoch, status}`, where the checkpoint must equal the selected head and the session epoch must be fresh. |
| `evict({transactionId, ids})` | Unloads runtimes so they reload paused from the durable head. It throws if unloading cannot be verified. |

## Transaction

`save({protocolVersion:1, intervalMs:5, tick, members:[{individualId, catalogId}]})` and `restore({protocolVersion:1, jointCheckpointId, members})` run one at a time. A second transaction, including a concurrent restore, is refused with `CROSS_CATALOG_BUSY`.

1. **Snapshot.** Before any state changes, the coordinator resolves each of 2–64 distinct members to exactly one namespace. If the same ID appears in another catalog, the request is refused as a cross-namespace conflict. The coordinator records catalog type, namespace, epoch, current head, dataset/graph/model namespace, session epoch and active/resting mode. Every member must be explicitly `paused`. A running or withdrawn member is refused. Restore requires the complete saved membership with the same namespaces, and the saved dataset, graph and model must still match.
2. **Reserve and re-read.** Every participant is reserved in the coordinator and in its adapter. The views are then re-read, and any changed head, session epoch or status aborts the transaction.
3. **Preflight.** The projected journal size, the transaction history limit and the joint-record history limit are checked first. Then each catalog runs its own preflight. A refusal here writes nothing.
4. **Stage.** Each catalog stages immutable payloads. The results must match the membership exactly. Restore payload hashes and clocks must equal the saved checkpoint. Duplicate planned IDs are refused. Any failure cancels only transaction-owned staging. If a cancellation itself fails, the transaction enters `recovery-required` with its members still reserved, rather than being recorded as a clean abort; an explicit rollback re-issues the cancellation.
5. **Journal `staged`.** The complete record (membership, prior and planned heads, catalog epochs and sources) is written atomically and the directory is fsynced before any head changes. Epochs and heads are then verified again. A change produces an `aborted` record and cancels the staging.
6. **Commit in fixed order.** Catalogs commit by catalog type, then namespace (`fixture-identity` before `full-connectome`), regardless of request or completion order. The journal is updated after every catalog. If a later catalog refuses before selection, every committed catalog is compensated in reverse order (each revert is journaled as `reverting` before it runs) and the transaction ends `rolled-back` (`CROSS_CATALOG_ROLLED_BACK`). A durability uncertainty, a head that disagrees with the plan, or a failed compensation enters `recovery-required`.
7. **Save completion.** A `committed` record and the cross-catalog joint record are appended in one journal write. The joint payload is `{version:1, kind:'cross-catalog-joint', intervalMs:5, tick, members:[{individualId, catalogType, catalogId, dataset, graphSha256, modelId, checkpointId, checkpointSha256, simTimeMs, mode}]}`.
8. **Restore activation.** After every durable head is selected, each catalog activates its paused candidates. Each result is verified: the checkpoint must equal the selected head, the session epoch must be fresh and the status must be paused. If any activation fails, **every** member in every catalog is evicted, so no selected head is paired with an unverified runtime. The record ends `unloaded` (`CROSS_CATALOG_RUNTIME_EVICTED`), and members reload paused explicitly. If eviction cannot be verified, the transaction enters recovery instead. A successful restore returns fresh session epochs and status `paused`, or `resting` when every saved member was resting.

Rest and withdrawal keep their existing meaning. A resting mode is saved and restored as resting, is never penalized, and does not block a transaction. Withdrawal is represented only by membership: the coordinator includes exactly the members named in the request, never adds one implicitly, and a restore needs the complete saved membership.

## Durable journal and recovery

`openCrossCatalogJournal(directory)` keeps one checksummed `journal.json` (schema 1, 2 MiB, 64 joint records, 256 transaction records). It replaces the file atomically (exclusive temp file, fsync, rename, directory fsync) under the same SQLite OS-backed writer lock pattern as the other stores. It refuses to initialize a directory holding anything other than its own lock database or temp file (which an interrupted first initialization can leave behind), and it refuses a corrupt document, an incompatible schema, more than one open transaction, or an open transaction that is not the newest. Existing files are preserved in every case. Reaching a limit refuses new work and deletes no history. If a directory fsync fails after rename, the journal is marked uncertain in memory and must be closed and reopened before recovery.

An open record (`staged`, `committing`, `activating` or `recovery-required`), whether found on reopen or produced in memory, blocks every new transaction with `CROSS_CATALOG_RECOVERY_REQUIRED`. `status().recovery` reports the complete affected-head set: `priorHead`, `plannedHead` and `selectedHead` for every member, plus per-catalog state. `reserved(id)` stays true for those members, so integrations continue to refuse other work on them.

**Operator action.** Call `recover({protocolVersion:1, transactionId, action})` with `rollback` or `complete`. The coordinator first re-reads every catalog. Each live head must equal a head the record can explain (prior, planned or last selected). Otherwise it refuses with `CROSS_CATALOG_DISAGREEMENT` and recovery stays pending.

- `rollback` first re-issues any interrupted `reverting` compensation. Idempotence makes a lineage head appended just before a crash explainable. It then reverts every catalog that selected a planned head, journaling each intent as `reverting` before it runs, cancels transaction-owned staging, and (for restore) evicts all members. The record ends `rolled-back`.
- `complete` requires every catalog to select its planned head. It is refused while any compensation was interrupted. For a save it then appends the joint record. For a restore it evicts every member, because the runtime was not verified, and ends `unloaded`.

Any partial failure keeps recovery pending. Recovery never resumes a runtime or starts a simulation.

## Validation and limits

`node --test server/cross-catalog-checkpoint.test.js` exercises a fixture catalog plus two full-connectome catalogs (MaleCNS and BANC namespaces). It covers fixed commit order, a mixed save and restore with fresh epochs and resting modes, and an all-resting restore. Membership tests cover stale, extra, duplicate, missing, cross-namespace, unknown-namespace and unpaused members, plus graph-namespace disagreement. Transaction tests cover staged-hash disagreement and a catalog epoch change after staging. They also cover a refused later commit with compensation, post-rename uncertainty with the complete affected-head set, a journal write failure mid-commit that survives restart, a crash after an appending revert that recovery reconciles idempotently, a crash during operator rollback, a failed staging cancellation that stays recoverable, re-initialization after an interrupted first open, unexplained heads during recovery, and operator rollback and completion. Runtime tests cover activation failure with verified eviction, and eviction failure that fails closed. Serialization tests cover concurrent restore/save refusal, adapter reservations blocking lifecycle probes, and shutdown aborting before staging. The final tests cover journal lock, schema, corruption, nonempty-directory and capacity refusal, and adapter version/type/method refusal.

**Negative results and unresolved failure modes.**

- The tests use doubles, not the real stores. The real fixture store currently commits joint saves only through a live fixture shared session, and it has no staged per-member API. The real connectome store stages restore only for its own joint records.
- Compensation is only as good as each adapter's `revert`. An individual with no prior head (a full-connectome identity before its first save) cannot be compensated, so a later failure enters recovery.
- Atomicity across catalogs is not claimed. Between two catalog commits a crash leaves a journaled, explicitly recoverable split state, not a single atomic switch.
- Filesystem durability remains subject to platform fsync guarantees.

Provenance and licenses are unchanged. The coordinator stores only IDs, namespaces, hashes, clocks and modes from catalogs whose own provenance/license rules apply, and it adds no dataset or third-party component.
