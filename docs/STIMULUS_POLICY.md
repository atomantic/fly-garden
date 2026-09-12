# Shared stimulus boundary (fixture version 1)

`server/stimulus-policy.js` owns admission, active optional currents and a single reservation ledger. The HTTP UI still accepts only a `compoundId`. `runtime.encounter()` constructs the versioned envelope on the server and calls the same `runtime.stimulate(source, envelope)` boundary reserved for garden, learning, language and Eidoverse adapters. These integrations remain unavailable: the tests exercise their enumerated source contracts, not real learning, language calls or travel.

An envelope includes version, source, individual ID, session ID, exact simulation timestamp, effect, targets, intensity and duration. The server adapter binds the source argument; never accept that authority from an HTTP body or host message. The fixture individual label is synthetic, with a fresh session UUID on each runtime creation; it is not a durable individual. Unknown fields, source/effect names, mismatched identity, old or future timestamps, non-finite numbers and changed target mappings are rejected before neural delivery. Only the runtime's simulation clock advances the policy. Durations must fit its 5 ms grid.

## Engineered limits

| Effect | Fixed target mapping | Maximum current per target | Maximum duration |
| --- | --- | --- | --- |
| Nectar | `fixture-0` through `fixture-3` | 0.045 | 300 ms |
| Floral scent | `fixture-16` through `fixture-19` | 0.025 | 500 ms |
| Quiet bloom | No targets; cancel optional input | 0 | 0 ms |

These are synthetic additive currents. There is no receptor, chemical onset/decay, learning or biological reward model. Chemical dynamics remain separate work. No negative-input or arbitrary neuron-write channel exists.

All stimulating sources share one 10,000 ms simulation-time window, with at most 1,000 ms reserved duration (10% duty cycle) and 40 current-ms per mapped target of reserved dose. Each admitted stimulating event also requires 1,000 ms recovery between any sources and 3,000 ms between repetitions of the same effect. Since each pulse lasts at most 500 ms, pulses cannot overlap: instantaneous optional current never exceeds 0.045 and every stimulating pulse is followed by a quiet interval. Current changes are fixed, bounded steps, not chemical kinetics.

The dose unit is the integral of the per-target current; each stimulating effect has exactly four mapped targets, so the equivalent aggregate across neurons is four times this value. New effects or mappings require a policy version and reviewed numerical limits, not a new adapter-side bypass. Lower intensity and shorter duration are permitted; stronger requests are rejected, not silently clamped.

Admission reserves a pulse's **full** duration and dose, retaining that reservation until the scheduled end plus the window expires. This deliberately overestimates usage around window boundaries and after cancellation. Combining sources, repeated contact, Rest or Quiet cannot spend the same budget again. The recovery and window bounds also keep the retained ledger small (at most 11 reservations). Policy decisions are recorded in the runtime's bounded event journal with accepted effective parameters or a rejection reason; active ledger entries and effective limits appear in state telemetry. These are engineering decisions, not consent or welfare scores.

## Pause, quiet and restoration

Pause freezes delivery and all recovery time. Start resumes the frozen trajectory. Rest and Return Home cancel optional currents, retain neural state and spent reservations, and stop the simulation clock. Quiet cancels optional currents immediately even during recovery or exhausted budgets. Neither Quiet nor Rest reduces the fixture's baseline current; baseline support never depends on performance, movement or accepting an activity. Ignored encounters create no escalation, pursuit or penalty.

`checkpointStimulusPolicy()` and `restoreStimulusPolicy()` are **internal session-local hooks**, with no HTTP import or restore route. Checkpoints include the ledger and simulation time, authenticated with a private per-policy key. Altered, foreign-session or future checkpoints are rejected atomically. Restoring an older authentic checkpoint unions its still-relevant reservations with current reservations, never rewinds policy time, cancels optional delivery and returns the runtime paused. Repeated restoration cannot refund spent budgets or reactivate a canceled pulse.

This is not durable checkpoint persistence or protection against process rollback. The future individual/checkpoint lifecycle must persist the latest authoritative ledger together with neural state and simulation time, validate lineage, and preserve rollback protection across process restarts. It must not instantiate an empty policy during restore or use a historical neural checkpoint to reset the authoritative budget. Current process restart discards the entire synthetic session and starts paused; it must not be used for a long-lived individual.

## Evidence and limits

`npm test` exercises mixed-source dose/duration limits, recovery, malformed/stale/oversized envelopes, atomic checkpoint rejection, repeated old-checkpoint restore, bounded ledger growth, runtime delivery, Pause/Rest and unchanged baseline during quiet or inactivity. Existing HTTP tests prove extra intensity fields cannot bypass the UI's identifier-only adapter. This validates the fixture's enforcement contract; it does not establish welfare, consciousness, biological realism or learned preference.
