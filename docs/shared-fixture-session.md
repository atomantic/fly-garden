# Shared fixture session primitives

This increment joins already admitted, loaded synthetic 32-neuron fixtures. It does not run either source connectome, prove biological sensing or learning, compare biological sex, or establish a full-dataset shared world. The registry uses `server/fixture-shared-session.js` with its existing runtimes as the sole neural authority. The [two-fixture browser integration](SHARED_BROWSER.md) renders separate controller cameras over one committed world.

## Registry API

- `sharedJoin(individualIds, version = 1)` accepts 2–64 distinct loaded, unowned, nonfaulted fixture IDs and an explicit barrier version (1 or 2; an unsupported value is refused). Resource admission remains the caller's responsibility. It pauses all members, revokes their individual visual leases and encounter adapters, and returns a shared snapshot plus a one-time `controllerToken`. Existing visual poses are preserved; otherwise the declared initial pose is `{x:0,z:0,yaw:0}`. No relocation or separation objective is inferred.
- `sharedSnapshot(sharedId)` returns the shared ID, epoch, status/reason, fixed 5 ms interval, tick/world time, bounded lifecycle events and each participant's ID, runtime session, dataset, simulation time, status, pose and motor. Individual snapshots expose the same public summary as `sharedSession`; reads never advance or allocate residents. Tokens are absent from every snapshot and checkpoint.
- `sharedMemberControl(sharedId, individualId, 'rest' | 'resume' | 'withdraw')` acts on exactly one member. `rest`/`resume` require a version 2 session; `withdraw` works in both. None of them rotate the world epoch, so another member's still valid controller state is never revoked by a neighbour's quiet choice.
- `sharedControl(sharedId, 'start' | 'pause')` operates on the coupled session. Both actions rotate the world epoch; start is explicit and requires every member to be available. The controller token stays valid for the lifetime of that shared session.
- `sharedFrame(sharedId, batch)` validates and commits exactly one complete barrier synchronously. It returns attributed traces with sensory currents, input/output times, bounded motors and resulting poses. No other participant's neural telemetry enters a controller.
- `sharedLeave(sharedId)` pauses and releases all members at the current committed boundary, revokes the shared token, and returns a final snapshot with `status: 'separated'`. Neural state and lineage remain intact. A later join is explicit.
- `sharedSave(sharedId)` appends one real checkpoint per member and one joint record in a single atomic identity-file replacement. It returns the joint record.
- `sharedRestore(jointCheckpointId)` requires every referenced member to be explicitly loaded and admitted. It validates all identity, pose and policy-continuity constraints and the durable write before changing any runtime or owner. Overlapping sessions containing other members must first be separated. Success creates fresh runtime sessions, a new shared ID/epoch/token and a paused joint session.
- `sharedCheckpoints()` lists durable joint records. Each record contains `jointCheckpointId`, `createdAt`, `sha256` and a payload of `{intervalMs:5,tick,members:[{individualId,checkpointId,simTimeMs,pose}]}`. A version 2 session instead writes `{version:2,intervalMs:5,tick,members:[{individualId,checkpointId,simTimeMs,pose,mode}]}`, where `mode` is `active` or `resting`. Checkpoint references carry the immutable dataset namespace in the referenced individual payload; they are not fabricated labels.

The caller must keep the existing registry `step()` watchdog running. For joined members it checks freshness and never steps a neural runtime. A controller delay beyond 250 ms or unavailable member pauses the whole session; explicit shared start rotates the epoch before observations can resume. Wall time may exceed simulated time; no elapsed-time catch-up or skipped neural steps occurs.

## Complete retinal batch

```js
{
  controllerToken, // secret delivered only by join/restore, never record or log
  worldEpoch,
  worldTick,
  frames: [
    {
      version: 1, // must equal the session version; a version 2 frame also carries `mode`
      individualId,
      sessionId, // that participant's runtime session
      environmentEpoch: worldEpoch,
      frameId: worldTick, // scoped by individual ID; one frame per member
      simTimeMs, // that participant's current neural clock
      capturedAtMs, // epoch milliseconds, at most 250 ms old, never future
      camera: 'controller',
      width: 8,
      height: 4,
      rgb // exactly 96 integer bytes, RGB raster order
    }
    // Every other member must be present exactly once.
  ]
}
```

A version 2 batch adds exactly one key, `mode`, to every frame. It must equal that member's
committed mode. A resting member still occupies its frame slot — so the batch stays complete and
every member stays attributable — but its `rgb` must be exactly `null`: it receives no retinal
current, runs no neural step, and keeps its committed pose and a zero motor while the barrier
advances world time for the others. When every member is resting the session status becomes
`resting` and `accept` refuses the batch, so the world can never silently run with nobody active.

Only these keys are accepted. Frame order does not change results. Individual neural clocks can have different starting offsets; each advances exactly 5 ms per shared barrier. The common world clock starts at zero on join and is preserved on joint restore. Observations must be rendered for all controller cameras from the same committed world poses before submitting the batch. The server cannot establish that supplied pixels came from a truthful renderer; the browser integration must implement and validate that contract. Observer cameras must never submit retinal frames.

Validation of all frames precedes preparation. Each runtime's opaque prepared token is previewed, its engineered motor is validated, and every body pose is computed before the synchronous commit loop. No durable checkpoint is restored during stepping. Missing, malformed, stale, duplicate and cross-wired observations leave neural/world state unchanged. An expired controller deadline or backward clock also pauses the session and rotates its epoch, even if the watchdog has not run. A numerical fault preview pauses the coupled session without committing either participant or pose. The supervisor watchdog separately handles prolonged missing observations.

## Ownership and welfare boundaries

Independent timer steps, visual attach/frame calls, save, restore and unload cannot act on a joined recipient. An individual Pause pauses the entire session.

In a **version 1** session an individual Rest or Home still explicitly separates the whole population, leaves the others paused, and applies the requested quiet state to the recipient. That original contract is unchanged.

In a **version 2** session an individual Rest freezes only that body: its neural clock, pose and motor hold while the world barrier continues for everyone else, and its status is visibly `resting` inside the still-running session. An individual Home withdraws only that body when at least two members would remain joined, and otherwise separates the whole session, so nobody is ever trapped in a group. Withdrawal is recorded in the bounded session event ring at the committed boundary, rebuilds membership in place, and never forces the survivors to re-join or re-acquire a controller lease. It is refused when fewer than two members would remain; separate the session instead. Rest and withdrawal are permitted outcomes: they carry no penalty, no escalation, no deprivation and no loss of baseline support, and resuming needs only an explicit resume.

Encounter input is now available per member while joined. Each member gets its own `createEncounterDynamics` adapter keyed by its individual ID and the owning shared session, fed only from that member's own committed pose and clock, and bound only to that member's own stimulus policy. A partner's pose, policy, receipts or reserved dose never reach it. Enabling requires the shared world to be running and that member to be active. Resting, withdrawing, pausing the world, separating or faulting revokes that member's optional input alone. Existing same-session reservations/input survive ordinary neural steps. Explicit restore cancels optional input while retaining spent reservations; a joint restore cannot refund any member's exposure.

Neural recording attribution remains integration work. The browser produces paired controller observations and separately enabled movement-derived flower/drawing capture attributes complete action batches. Neither is a full-connectome integration. There are no forced proximity, pursuit, aggression, deprivation or continuous reward objectives.

## Persistence, recovery and bounds

The first joint save migrates the identity document from schema 1 to schema 2 by adding `jointCheckpoints`; a pose-carrying checkpoint migrates to schema 3; the first version 2 joint save migrates to schema 4. Schemas 1, 2 and 3 remain loadable and fully validated, and a schema 4 document may still contain unversioned (version 1) joint payloads. A `version: 2` joint payload is rejected below schema 4, a `mode` outside `active | resting` is rejected, and a missing `mode` in a version 2 payload is rejected. Joint records reference retained real individual checkpoints; checkpoint/time, pose, digest and member uniqueness validation reject inconsistent documents. Histories remain append-only, bounded to 64 checkpoints per individual and 64 joint records, within the existing 16 MiB document limit. Reaching a limit rejects the complete save. Nothing is pruned, so earlier joint references cannot become orphaned.

An atomic-write failure leaves every previous durable head and joint record intact. A failed joint save pauses the session. A failed joint restore leaves the current live ownership, poses and neural state unchanged. Validation of every recipient's current policy precedes any restored runtime switch. Successful restore is paused and creates new runtime sessions and controller authority.

Backup's existing identity validator accepts identity schemas 1, 2, 3 and 4 and preserves joint records. Offline backup/restore copies no controller tokens. Process startup loads only caller-admitted residents, paused, with no automatic shared ownership. Select a joint checkpoint and explicitly restore it to reunite its members; independent restores and branches do not silently rejoin.

Tests cover complete atomic barriers, reversed frame order, invalid batch immutability, single authority, stale-session shutdown, numerical-fault previews, actual movement/pose persistence, individual policy reservations, failed writes, corrupt references, bounded history, backup and paused recovery. Version 2 adds coverage for a frozen resting clock beside a running barrier, an all-resting world that refuses to run, membership rebuilt by partial withdrawal, the two-member floor, per-member schema 4 joint modes across save and restore, a failed version 2 joint save, the sequenced HTTP member envelope, and per-recipient encounter isolation. This establishes fixture primitives only. Static renderer coupling has a bounded [pose-contrast check](SHARED_RETINAL_EVIDENCE.md), and neurally generated coupling has both a recorded headless [projection measurement](SHARED_RETINAL_EVIDENCE.md) and, since PR #77, a real-GPU byte-level replay of that same committed trajectory: 49 of 96 rendered channels changed with a 1,022 absolute byte difference, against 0 of 96 for the repeat control. Integrated full-dataset peak memory/throughput/telemetry measurements are still required before the issue's broader acceptance criteria can be claimed.
