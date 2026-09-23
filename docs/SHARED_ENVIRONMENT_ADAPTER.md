# Shared environment adapter contract

`server/shared-environment-adapter.js` defines version 1 of a declared sensory and motor boundary for shared research worlds. It is engineered, versioned and opt-in. It is a contract and a coordinator with tests, not a coupled world: no route, renderer, timer or production backend uses its coupled path yet, and no full-connectome worker can declare a channel.

## What a channel means

Every channel is a declared, bounded proxy. None is measured anatomy, and none claims to model a receptor or inferred physiology.

| Channel | Direction | Payload | Meaning |
|---|---|---|---|
| `visual-frame` | input | `{width: 8, height: 4, luminance: [32 integer bytes]}` | Engineered controller-camera luminance, not validated fly vision |
| `acoustic-event` | input | `{event: 'arranged-tone', level: 0–1}` | A human-arranged garden tone, with no auditory receptor model |
| `scent-proxy` | input | `{proxy: 'floral', intensity: 0–1}` | A catalogued scent proxy, not a receptor, pheromone or chemistry model |
| `contact-proxy` | input | `{surface: 'petal' \| 'leaf' \| 'ground', side: 'left' \| 'right' \| 'both', magnitude: 0–1}` | A surface-contact proxy, with no mechanoreceptor, injury or pain model |
| `motor-proposal` | output | `{forward: 0–0.12, yaw: −0.8–0.8}` | A bounded proposal from an engineered readout. It moves no body by itself |

There is no reward, punishment, deprivation or chemistry channel. The payloads carry no individual ID, coordinate, goal or neural field, so one participant's payload cannot name or carry another's state.

## Declarations and admission

Each participant must present an exact declaration before admission:

```json
{ "contractVersion": 1, "individualId": "…", "sessionEpoch": "…", "backend": "connectome | synthetic-double",
  "inputs": ["visual-frame"], "outputs": ["motor-proposal"],
  "capabilities": { "sensoryMotor": true, "embodiment": false, "chemistry": false, "learning": false } }
```

The following fail closed:

- a missing declaration (`undeclared-capability`);
- an unknown, duplicated or misdirected channel, an extra key, another contract version, or a `sensoryMotor` flag that disagrees with the channel list (`invalid-declaration`);
- `embodiment`, `chemistry` or `learning` set to `true` (`capability-unavailable`). These stay unavailable in version 1. Enabling any of them needs separately reviewed evidence and a new contract version.

A `connectome` backend may declare no channel. `connectomeDeclaration(state)` is the only declaration a full-connectome registry state can produce. It requires all four registry capability flags to be exactly `false`; a missing flag is refused rather than read as uncoupled. The [full-connectome shared barrier](CONNECTOME_SHARED_RESEARCH.md) now uses this declaration for join and restore admission, and reports it read-only as `shared.adapter` (`coupled: false`). Its barrier envelope is unchanged, so it still accepts no observation or action payload.

## One batch at one world tick

`createSharedEnvironmentAdapter` starts paused. It has no timer and never starts itself. `resume({worldEpoch})` is the only way to run, and it rotates the world epoch. `step(batch)` then processes one complete observation batch:

1. **Structural validation, with no state change.** The adapter rejects a malformed batch or observation envelope, a foreign shared ID, an unknown individual (`cross-session`), a duplicate observation, an observation for a resting member, a channel absent from the recipient's declaration (`undeclared-channel`) and an out-of-range payload (`malformed-channel`). A rejected batch changes no status, epoch, clock or backend.
2. **Freshness and completeness, which pause the session.** A stale world or member session epoch (`stale-epoch`) pauses the session. So do an observation for another tick, a capture more than 250 ms old or future-dated (`stale-observation`), and a missing active member (`partial-batch`). Pausing rotates the epoch, and an explicit resume is required.
3. **Staging.** Each active backend gets a frozen request with only its own ID, session epoch, world epoch and tick, the fixed interval and substep count, and its own declared channels. Completion order is ignored. Each stage has a bounded deadline (2 s by default). A timed-out stage cannot be cancelled inside its backend, so resume is refused (`stage-pending`) until the late result settles and is discarded.
4. **Response validation.** A response must name its own individual, session epoch and tick, and report exactly `tick + substeps` and `simTimeMs + intervalMs`. It may return a proposal only when it declared `motor-proposal`, and `null` otherwise. An extra field such as a partner's neural state is `invalid-response`, a non-finite value is `numerical-fault`, a wrong clock is `step-mismatch`, a rejected stage is `worker-fault` and a missed deadline is `timeout`. On any of these, every staged candidate is discarded and the session pauses. Nobody advances.
5. **Commit in membership order.** If a commit fails, the failing member and every member already committed are rolled back in reverse order, and the rest are discarded. A backend's `rollback` restores the pre-batch state for that batch reference and does nothing if that batch was never applied, so a commit that applies and then throws is still undone. If a rollback fails, the session enters `fault`. Rest, wake and withdrawal do not clear it, and it cannot be resumed; it must be separated.

A committed batch returns traces in membership order. Each trace records the recipient, its session epoch, the world tick, the exact `[startMs, endMs)` interval, the channel names it received, its bounded proposal, and its clock after the batch.

## Rest and withdrawal

A resting member receives no observation and is not staged. Its clock stays still, and that is a quiet outcome, not a penalty. When every member rests, the session is `resting` and the world clock is frozen. Waking a member returns an all-resting session to `paused`, and an explicit resume is required. As in the shared-session contract, a member woken while the world runs joins the next batch. A batch captured without it is partial, and it pauses the session. Withdrawal removes only that member's declaration and scope. The other members keep their epoch, clocks and running state. Withdrawal stops at the two-member floor, as the shared-session contract does.

## Evidence and limitations

`server/shared-environment-adapter.test.js` uses only tiny, named four-neuron sparse-LIF graphs, wrapped by a transactional synthetic double. The double's engineered map sends luminance to one input neuron and contact to another. The tests cover the following:

- declaration refusal and the fail-closed connectome declaration;
- no auto-start;
- structural rejection with no change of state;
- exact five-substep, 5 ms clocks under reversed completion order and injected latency;
- recipient isolation: a visual change or contact proxy changes only its declared recipient, while a zero-input control stays at zero potential and no spikes, and no backend sees another participant's ID or payload;
- partner-state and undeclared-output refusal;
- stale, partial, timeout, numerical, step-mismatch and worker-fault pauses;
- commit rollback and the unrecoverable-rollback fault;
- rest, withdrawal and the all-resting freeze;
- the connectome session's uncoupled summary, and refusal of a participant whose capabilities are incomplete.

No pinned MaleCNS/BANC dataset is loaded, and no production simulation is started.

The tests show that the boundary validates and routes correctly. They do not show biological sensing, embodiment, learning, intent or experience. The synthetic double's input map is an engineered test fixture. It is not a proposal for a full-connectome sensory mapping, and the visual causal campaign for the full graph remains a recorded negative ([visual causal validation](VISUAL_CAUSAL_VALIDATION.md)). Connecting this contract to the [render-only mixed world shell](MIXED_WORLD_SHELL.md), or to any production backend, is later work with its own evidence prerequisites. That work must go through this contract, not around it.
