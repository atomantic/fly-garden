# Optional encounter dynamics

`server/encounter-dynamics.js` supplies a versioned catalog and a disabled-by-default per-recipient contact state machine. It does not independently deliver neural current, replace the shared stimulus policy, or implement biological receptors/pharmacology. The identity registry integrates contact updates and durable policy admission; the local HTTP route and observatory expose explicit caretaker enablement.

The catalog distinguishes a **floral contact sensory proxy** from a **fictional nectar modulation input**. Both use existing fixed synthetic current mappings from the shared policy; neither changes synaptic weights or implements receptor-mediated chemical dynamics. Each entry declares targets, intensity, duration, units, engineered evidence and uncertainty. Unsupported compounds and arbitrary geometry mappings are rejected.

The default flower positions reproduce the current procedural Scene's 13-candidate spiral exactly, including the pod-space exclusions. IDs are `garden-flower-<index>`. An engineered 0.35-garden-unit radius defines contact. Even indices offer floral; odd indices offer fictional nectar. This contact classification is a declared nonvisual proxy; positions never enter the retinal neural adapter as hidden visual targets. UI labels/markers must show this contact mapping before enabling it. Contact is not inferred consent.

Create one state machine per individual and runtime session, with trusted synchronous callbacks `admit`, `cancel` and `policySnapshot`. `setEnabled(true, environmentEpoch)` is a deliberate caretaker action. It offers nothing immediately, and the first valid observation establishes existing contacts without dosing. Only a later outside-to-inside transition can offer one pulse. Simultaneous new contacts use deterministic flower-ID order and offer at most one pulse. Dwell never retries, increases intensity or automatically redoses. A rejected offer remains habituated until withdrawal/reentry; a subsequent entry still faces the same shared policy recovery and aggregate budgets, including UI or other source exposure.

`update` accepts recipient/session/epoch, strictly increasing frame ID, current policy-aligned simulation time, authoritative x/z pose and runtime status. It must follow an accepted visual frame, never an untrusted client coordinate request. A session/recipient mismatch rejects. An environment epoch change disables encounters and cancels an active receipt; a new epoch requires explicit enablement. Rest/fault/pause cancels transient delivery without changing baseline support. Disabling and withdrawal are always available; no input escalation follows inactivity.

## Delivery and continuity boundary

The `admit({individualId,sessionId,source:"garden",effectId,flowerId,simTimeMs})` callback must stage the exact existing policy envelope, persist its reservation, and only then deliver the input. Failure before durable admission must not deliver anything. It returns the actual admitted receipt. It must be synchronous and atomic with respect to the recipient's clock. The adapter never writes currents or computes an alternative dose cap.

`cancel({individualId,sessionId,source:"garden",entryId,reason})` must synchronously end the identified receipt's delivery without deleting its reservation or refunding dose/recovery. The registry uses shared-policy `cancelEntry(source, entryId)` through the runtime: it validates source ownership and changes only that receipt's active endpoint. Other receipts and all spent reservations remain intact.

Onset is immediate at the next supported neural step. Delivery is a fixed bounded pulse, with immediate zero delivery on withdrawal and zero after expiry. This is a declared piecewise engineered dynamic, not guessed biological decay kinetics. Habituation means no renewed offer during the same contact. Recovery is read from the shared policy, never independently reset here. Snapshot phase, receipt, contacts and bounded event history distinguish transient washout, pulse expiry, rejection and recovery. Persistent plasticity is explicitly unavailable; stopping an input does not claim to reverse learning.

Encounter enablement/contact state is session-only and must not be automatically rearmed by startup or checkpoint restore. Durable neural checkpoints already retain policy reservations while canceling transient exposures. A future persisted encounter journal must preserve that distinction rather than reinstating exposure from a contact flag.

Six module tests cover no initial/disabled doses, overlapping contacts, long dwell habituation, withdrawal without refunds, repeated-entry recovery and aggregate caps, rest/epoch revocation, recipient isolation, failed durable admission and stale clock/sequence rejection. They use the actual shared stimulus policy, not a second budget implementation.


The fixture environment controls render the latest twelve encounter transitions for the selected individual and session, with the current synthetic reservation budget and shared-policy cooldown. This is a simulation-time event trail, not a chemical concentration curve. A checkpoint retains spent reservations and cancels transient delivery, but does not restore the session event trail; the UI keeps persistent learning explicitly unavailable.

## Registry integration

`encounterDynamicsControl(id, enabled)` and `encounterDynamicsSnapshot(id)` expose scoped control/status; individual snapshots also contain `encounterDynamics`. Enable requires an attached, running visual controller and remains bound to its current environment epoch. Disable never requires an active pulse. Every lifecycle command, controller takeover, stale observation, home, restore or unload revokes enablement. Starting again does not silently rearm encounters.

After accepting one retinal frame, the registry supplies only its authoritative resulting pose and clock to the contact state machine. An admitted garden encounter is staged on an isolated same-identity/runtime-session copy through the existing policy. Its checkpoint reservation is written before the live runtime admits the exact same effect. A write failure faults only that recipient, leaves the previous checkpoint intact, revokes encounter enablement and never delivers the new pulse. Receipt-scoped withdrawal cancels delivery without refunding budgets. The next neural step applies any admitted pulse normally through the common policy currents.

### Shared populations

A joined member is no longer excluded. Each shared member owns one adapter keyed by its
individual ID **and** the owning shared session ID; changing either scope discards the old
adapter rather than carrying its contact state across. The adapter is fed from the committed
barrier trace of that member alone — its own authoritative pose, its own frame ID, its own
neural clock and status — and is bound to that member's own `createStimulusPolicy` through its
own runtime. A partner's pose, receipts, recovery or `reservedDose` are never readable from it,
and one member's admission can never consume or alter another member's aggregate budget.

Enabling requires the shared world to be running and that member to be active; a paused world
or a resting member refuses enablement rather than queueing it. The shared world epoch is the
environment epoch, so starting, pausing or separating the world revokes every member's optional
input and never silently rearms it. Resting a member, withdrawing it, or faulting it cancels
only that member's transient delivery, retains its spent reservations without refund, and
leaves every other member's contact state, active receipt and recovery untouched. A failure
inside one member's update revokes only that recipient's enablement and never rewinds the
committed barrier.

Tests assert, on one shared flower with three members: two members holding independent
receipts from the same flower while the third never doses and keeps `reservedDose` at zero;
per-recipient habituation across 120 further barriers; a resting member's recovery clock frozen
while the active member's keeps recovering; and rest and withdrawal each canceling only their
own delivery.

Registry tests drive actual accepted fixture frames into a small declared test flower. They inspect the persistence boundary before live delivery, verify saved garden-source reservations, exercise lifecycle revocation, and inject a disk failure while another recipient remains unchanged. Production uses the original spiral flower geometry; the small test flower is constructor-injected for bounded numerical tests and is not configurable through the HTTP API.


`GET /api/individuals/:id/garden` returns the contact/catalog status. `POST` accepts the exact existing command envelope plus a boolean `enabled`; it shares the origin and recipient/session/sequence guards. The observatory's optional flower controls disclose the nonvisual contact proxy, bounds and catalog before enablement, show the current phase/contact IDs, and permit explicit disablement. Merely viewing the catalog or loading a saved individual never enables input. HTTP tests cover lifecycle revocation, malformed values, unsupported fields and cross-origin/recipient/session commands.
