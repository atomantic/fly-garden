# Managed fixture visitors (service foundation)

The bridge is default off and supports only the synthetic 32-neuron fixture. It does not establish connectome execution, retained learning, subjective experience, or biological vision. The host supplies an **engineered gentle-patch spatial projection**, not rendered retinal imagery. That explicit source label accompanies the local input/motor trace. The host's procedural fly illustration has no humanoid puppet, ragdoll, combat, injury or physics authority.

The server integrates this service with an exclusive registry adapter and scoped HTTP routes. The visitor browser surface uses explicit discovery, admission and start controls. No production credentials, host visitors or network servers were created for validation.

## Explicit configuration

The server transport is enabled only with all three environment values:

- `FLY_GARDEN_PORTOS_URL`: exactly `http://127.0.0.1:5553`, `http://127.0.0.1:5555`, `http://[::1]:5553` or `http://[::1]:5555`.
- `FLY_GARDEN_MANAGED_APP_ID`: the owner-approved managed app ID.
- `FLY_GARDEN_VISITOR_CREDENTIAL`: the separately provisioned `mv1_` app credential. Keep this in the server process environment; never send it to the browser, checkpoint, recording, log or world payload.

### Why the bridge is off

A disabled bridge names the setting it is waiting on instead of reporting one generic "disabled"
line, so `unsupported`, `unauthorized` and each unmet local setting are all distinguishable
(FR-30, NFR-6). `transport.configuration`, surfaced as `bridge.configuration()`, reports a stable `code`, a
plain-language `reason` and `unresolved`, the list of every setting still to fix. The reason and the code appear in
`snapshot(id)` (as `reason` and `configurationCode`) and in `/api/health`'s `eidoverse` block
(plus `unresolvedSettings`). The visitor panel shows the reason; the code is API-only.

| Code | Meaning |
| --- | --- |
| `ready` | All three settings are valid. Explicit owner admission is still required for every visit. |
| `host-unset` | `FLY_GARDEN_PORTOS_URL` is unset, so no managed visitor host is claimed. |
| `host-unsupported` | The configured address is not one of the four approved loopback addresses. Remote hosts are refused and no request is attempted. |
| `app-unset` / `app-invalid` | `FLY_GARDEN_MANAGED_APP_ID` is missing or is not a valid managed app identifier. |
| `credential-unset` | No `mv1_` credential is provisioned. |
| `credential-invalid` | The configured credential is not a well-formed `mv1_` app credential. |
| `disabled` | There are no settings to inspect: no identity store, or a transport that publishes no diagnostic. |

`credential-unset` is the **NFR-5** case. PortOS's own instance password is optional, and an
instance running without one issues no scoped `mv1_` app credential. The bridge then stays off and
says so, rather than attempting an unauthenticated visit: admission always requires its own
separately provisioned grant. No configured value — and above all never the credential — is echoed
into a reason, a log or the browser; only setting names are.

The PortOS owner explicitly provisions individual/world allowlists. PortOS separately negotiates the host's `managedVisitors` version 1 capability, `fly-v1`, 8×4 RGB projection, expiry enforcement and `admissionDeadline:true`. Missing host support refuses admission. Existing Mind and peer travel are independent protocols.

### Negotiated contract fields

`capabilities()` still requires the original contract, and now also reads and caches two
**optional** negotiated capabilities. Both degrade gracefully: a host that publishes neither
negotiates exactly as before.

- `maxConcurrentVisitors` is optional. **An absent field means exactly one concurrent visitor**,
  never an unbounded host. When present it must be an integer from 1 to 64.
- Patch interaction is optional and is negotiated as a group of three fields: `interact` in
  `actions`, `patchObjects`, and `interactionEffects`. **A host that publishes none of the three
  negotiates successfully and keeps the existing move-only behaviour**, with interaction reported
  as unavailable rather than pending or failed.

When interaction *is* offered, every field is validated strictly and a half-published capability
is refused with `invalid-response`:

- `actions` must include `interact`.
- `patchObjects` must be a 1–16 entry allowlist of `{objectId, x, z, radius}`, each inside the
  negotiated patch (`|x| ≤ 2`, `|z| ≤ 2`, `0 < radius ≤ 0.5`) with unique IDs.
- `interactionEffects` must be a string array containing `settle`. Only `settle` is ever sent.

So `patchObjects` without `interact` in `actions`, `interact` with an empty allowlist, or an
allowlist with no usable effect are all refusals. There is **no compatibility break**: the existing
five-action managed host, including the one that produced the recorded live paired run, admits,
visits, moves and returns unchanged. Publishing the interaction fields is a separate, optional
change for the PortOS and Eidoverse repositories.

### Visitor capacity and second-admission refusal

Before `admit` touches `authority.claim`, the bridge compares the count of currently owned
visitors against the cached negotiated capacity. Exceeding it raises `visitorFailure('host-capacity', …)`
immediately, so an existing visit is never paused, re-leased or otherwise disturbed by a
rejected second admission. After the freshly negotiated contract arrives the check runs again;
if the host lowered its capacity in between, the refusal is recorded on the refused individual
with its specific message rather than the generic "Visitor admission was not confirmed."
`host-capacity` and `unsupported` both preserve their exact reason through the admission catch.

Requests use the fixed loopback broker paths, an eight-second response deadline, redirect rejection and a 16 KiB response ceiling. Constructing the service performs no request. Boot remains paused. Admission requests a 30-second lease and remains paused after acknowledgment; `start` is separate. A fresh explicit admission is required after return/expiry; there is no automatic restart or credential provisioning.

## Registry ownership adapter

`createManagedVisitorBridge({authority, transport, now})` requires `authority.claim(individualId, ownerId)` to synchronously return an opaque private handle:

```js
{ snapshot, control, prepareStep, previewStep, commitStep, isCurrent, release }
```

Claim must reject an unloaded/non-fixture identity, another visitor owner or incompatible joint ownership. It pauses the fixture and revokes individual visual leases and encounter authority before returning. All ordinary timer, camera-frame, control, save/restore and unload paths must respect this owner. Only this private handle can advance its resident runtime while owned. `isCurrent()` verifies both ownership and the original runtime session. `release()` must only remove its own owner token and must never mutate a replacement runtime. Do not serialize the token or handle. An explicit local lifecycle change must invoke `bridge.lifecycle(id)` before dropping authority; uncertain remote cleanup retains the owner until confirmation or trusted expiry.

The bridge does not perform checkpoint restore for temporary steps. It validates ownership, lease expiry and capture freshness after the awaited observation, then prepares one local candidate and previews the bounded motor output. Immediately before dispatching movement or interaction it checks ownership, cancellation, expiry and the 250 ms capture-age limit again. An observation arriving at or after expiry cannot authorize an outward action, even if its capture is fresh; local preview cannot extend a lease or refresh an old capture. The candidate commits only if ownership/session/expiry still hold after acknowledgment. This is not a distributed atomic transaction: a host move might occur before a lost acknowledgment or a locally invalidated candidate. Such uncertainty pauses local evolution and triggers cleanup; it never retries a movement or claims the unconfirmed neural step happened.

## Service API

- `snapshot(id)` returns per-ID phase, ownership, running/pending state, world, runtime session, visit epoch, expiry, reason, the last bounded input/motor trace, whether interaction was negotiated at all, the interaction arming flag, the last confirmed interaction, the allowlisted patch-object IDs and the negotiated/current host visitor counts. No credential or neuron history is included.

### Phases and the teleport pod

The phase sequence is `home` → `admission` → `departing` → `visiting` → `returning` → `home`, with
`reconnecting` for a retried unconfirmed cleanup and the terminal-looking `disconnected`,
`timed-out` and `blocked` states.

- `departing` covers the window between the outbound admission request and lease validation. A
  departure has been requested; **no body has been acknowledged**.
- `reconnecting` is a non-terminal retry of an unconfirmed remote cleanup, distinct from
  `disconnected` and `timed-out`, which report a cleanup that stopped being attempted.

`client/src/visitor-phase.js` is the single source of truth for how these render. Every phase has a
distinct label, and the teleport pod is the away-state indicator: it stays visible while a visit is
active instead of being hidden. **Pod motion is permitted only in `visiting`**, that is, strictly after
host acknowledgment. Animation during `admission`, `departing` or `blocked` would imply that
admission succeeded, so the pod is held still and no phase label uses arrival wording.
`/api/health`'s `eidoverse.individuals[]` carries phase, ownership, running state and world for every
individual, so both flies' pod states are readable without changing the browser selection.

#### Rendered pod evidence, and what it does not establish

`tests/browser/teleport-pod-phases.spec.js` (Playwright projects `pod-phases` and
`pod-phases-reduce`, run by `npm run test:browser`) renders all nine phases in Chromium and records,
per phase, the pod's tone class and computed colour, its label and destination text, the habitat's
`aria-label`, and the emissive colour, intensity and ring displacement read back out of the three.js
material after the renderer wrote them. `Scene.jsx` publishes that readback as `data-pod-emissive`,
`data-pod-intensity` and `data-pod-offset`, alongside the existing `data-motion-*` disclosures;
nothing in the application reads those attributes.

Two results are asserted in both motion modes: the four tones are four distinct rendered colours,
and the pod rings leave their resting height **only** in `visiting` under the default motion
preference, never in any phase under `prefers-reduced-motion: reduce`. Phase tone is therefore
state, not motion.

**This is client-rendering evidence only.** The spec reaches those phases by intercepting the
browser's own loopback `GET /api/state` and replacing exactly one field, `visitor`. No PortOS host
is contacted, no `mv1_` credential is read, no admission is requested, no individual is created and
the simulation stays paused. It establishes that a given `state.visitor.phase` renders correctly; it
is **not** evidence that any visit occurred and may not be cited as host, transport or admission
evidence. Those remain `server/managed-visitor-*.test.js` and
[live visitor fixture evidence](LIVE_VISITOR_FIXTURE_EVIDENCE.md).

Because `tests/browser/` is not part of `npm test` or CI, `server/managed-visitor-ui.test.js` guards
the readback contract the spec depends on, so the browser evidence cannot silently degrade into
measuring nothing.
- `capabilities(id, worldId?)` reads negotiated allowed worlds without acquiring a body.
- `admit(id, {worldId})` acquires exclusive local ownership, then requests a scoped paused body. Selection changes cannot retarget it.
- `control(id, 'start' | 'pause' | 'rest' | 'home' | 'interact')` is explicit. `interact` only toggles a local
  permission: it sends nothing, names no object, effect or moment, and is refused unless the visit is
  acknowledged and unexpired. Pause/rest stop local evolution immediately. Home requests scoped unsequenced cleanup. A pause/rest during an outstanding request initiates cleanup to prevent the pending response restarting movement.
- `tick(id)` performs at most one observation/move/commit. Overlap returns immediately. Call from a bounded scheduler; it does not create a timer. Tick also detects pause, runtime replacement, backwards clocks and expiry and retries uncertain cleanup at most once per second.
- `lifecycle(id)` and `disconnectAll()` quiet local execution and request cleanup. Keep lifecycle processing active through pending requests and shutdown cleanup; never report an unconfirmed return as home.

Every host result must match the original individual, runtime session, app, world and visit epoch. Observation IDs strictly advance, captures must be no more than 250 ms old, RGB is exactly 96 bounded bytes, and poses remain inside the negotiated patch. Only two engineered actions leave the process: `{type:'move', forward, yaw, intervalMs:5}` and `{type:'interact', objectId, effect:'settle', intervalMs:5}`. No membrane values, weights, histories, checkpoint or caretaker messages leave.

### Patch-object interaction (optional capability)

Interaction exists only when the host negotiated it. When it did not, `snapshot(id).interactionAvailable`
is `false`, `patchObjects` is empty, `control(id, 'interact')` is refused with `unsupported`, the UI
states that interaction is unavailable on this host, and the bridge never emits an `interact` action.
Everything below applies only to a host that published the capability.

Interaction is derived, never puppeted. In a tick the bridge substitutes `interact` for `move` only when
all of the following hold: the local permission is armed, the fixture's own bounded forward readout has
settled at or below 0.012 units/s, and the host-reported pose is already inside the reach radius of an
allowlisted `patchObjects` entry. The object, the moment and the effect come from that derivation. No
caretaker, host resident or inbound payload supplies a target, and nothing inbound reaches
`handle.control`, whose only inputs remain the explicit local `start`/`pause`/`rest` lifecycle actions.

The acknowledgment has its own schema: the reply must carry exactly one extra `interaction`
object of `{objectId, effect, accepted}`, naming the same object, an effect inside the negotiated
`interactionEffects`, `accepted:true`, and a confirmed pose still inside that object's reach. Any extra
field, mismatched object, unallowlisted effect or out-of-patch pose refuses the step, stops outward
authority and leaves the fixture paused without advancing its clock. A confirmed interaction is an
engineered host acknowledgment, not evidence of preference, intent or experience.

`interact` is also available through the HTTP command envelope as `operation:"interact"` with
`payload:{}`, and confirmed interactions appear beside `lastTrace` in the visitor panel.

A missing admission response may still correspond to a live body. The bridge cancels by the original scoped admission request through `/admissions/cancel`; it never guesses a host lease ID. A broker-confirmed cancellation releases ownership only after the local admission request has settled. Otherwise the broker's absolute admission deadline bounds quarantine. A failed leave retains paused local ownership until confirmed cleanup or that trusted bound. The UI must show returning/disconnected/timed-out state during quarantine and must not offer a second body or controller.

## Validation and limits

### Dispatch freshness boundary (#9)

The local regression suite covers an observation returning exactly at lease expiry with a fresh capture, and expiry, capture aging or clock rollback during local candidate preview. Both movement and armed interaction must emit no additional action, commit no step and preserve the last confirmed trace while returning paused. A positive boundary case accepts a capture exactly 250 ms old while the lease remains live. These tests use synthetic runtimes, injected clocks and fake transports; they do not contact a production host or establish host enforcement.

Validation for this slice: all 490 Node tests and the production build passed after installing the locked dependencies. The first full-suite attempt failed because the fresh worktree had no `three` installation; rerunning after installation passed. The build retains its large-chunk warning. No lint or typecheck script is configured. Browser tests were not rerun because this slice changes no presentation code.

**Remaining for #9:** linked PortOS-side capability/admission delivery and production-route validation, plus an authorized managed-host journey proving acknowledgment, expiry/revocation/disconnection and fresh re-entry across the deployed components. The existing [isolated running-host evidence](LIVE_VISITOR_FIXTURE_EVIDENCE.md) excludes production middleware and rendered-observer proof. No production host, credentials or sibling-repository code were accessed for this slice. Fixture state continuity is not retained-learning evidence. This partial delivery does not close #9.

`node --test server/managed-visitor-bridge.test.js` uses real fixture runtimes with fake transports. It covers paired identity isolation, explicit paused admission/start, scope/replay/invalid input, pending movement revocation, uncertain admission, late cleanup, expiry, backwards time, runtime replacement and transport bounds/privacy. It additionally covers the negative admission paths (`available:false` → `unsupported`; individual or world outside the allowlist → `unauthorized`; nine separate contract mismatches → refusal without a remote body), mid-visit 401/403 revocation from both `action` and `observe`, an explicit stale-epoch replay after re-admission, negotiated capacity including the absent-field default of one, paired faults that leave the other visitor's tick count and lease untouched, `disconnectAll()` with two owned visitors, the interaction negatives (out-of-patch pose, unallowlisted effect, wrong object, smuggled extra fields, interaction after expiry or revocation, and an inbound-command attempt), and an explicit backward-compatibility case: a legacy five-action host with none of the optional interaction fields admits, visits, takes twelve move-only steps and returns cleanly, with interaction reported unavailable and unarmable.

It also covers the six unmet-setting codes above: all six produce different wordings, none echoes a
configured address or credential, none reaches the network, and a disabled reason stays distinct
from the `unsupported` and `unauthorized` host refusals. A further test covers re-entry — after a
confirmed return the fly keeps its runtime session and tick, every control and scheduler tick is
refused for want of a fresh grant, a re-admission re-runs discovery so an allowlist narrowed since
the last visit is enforced, and a granted re-entry arrives paused under a new visit epoch with the
retained local state intact. `server/managed-visitor-http.test.js` drives the same unmet-setting
case through the real transport and asserts the specific reason, code and unresolved setting in
both `/api/health` and individual visitor state.

`node --test server/managed-visitor-ui.test.js` checks the pod presentation contract: every bridge phase has a distinct label, the away habitat keeps the pod visible, the pod label reads live visitor state, no motion or arrival wording appears before host acknowledgment, and the roster exposes each fly's pod state. An additional temporary in-process check connected the real Fly Garden bridge, PortOS broker/transport and Eidoverse host factories: negotiated admission, 20 geometric observation/motor steps and confirmed return passed without starting a network server. That check is integration evidence, not a live deployment or browser journey.

## Local HTTP integration

`GET /api/individuals/:id/visitor` reads local state only. The exact query `?capabilities=1` explicitly asks the broker for currently negotiated allowed worlds. Discovery failure returns `capabilities.available:false` with a sanitized reason; it never acquires ownership or a remote body.

`POST /api/individuals/:id/visitor` uses the existing exact command envelope:

```json
{"protocolVersion":1,"individualId":"<id>","sessionId":"<current runtime session>","sequence":1,"operation":"admit","payload":{"worldId":"<allowed world>"}}
```

The sequence must be one greater than the latest state's `commandSequence`. The other operations are `start`, `pause`, `rest`, `home` and `interact`, each with exactly `payload:{}`. `interact` is refused with `unsupported` unless the host negotiated the optional interaction capability. Unknown fields, stale session/sequence, other query parameters and cross-origin requests are refused. Replies contain `{state,visitor}`. Normal full states also include `visitor` and `externalOwner:null` or `{kind:"managed-visitor"}`. Neither contains the registry owner token, app bearer or host session authority.

The registry rejects shared members until explicit separation. Successful claim pauses the same runtime, revokes the home visual controller and encounters, disarms language, and marks home captures discontinuous. Ordinary persistence, input, frame, timer and control paths refuse external ownership. The server scheduler performs expiry/cleanup maintenance for owned visitors but runs the observation/motor loop only after explicit start. Server shutdown requests cleanup and pauses local execution; crash boot remains paused. Ownership itself is process-local, never a durable checkpoint authority. Host expiry and duplicate-individual admission guards remain required during recovery.

`node --test server/managed-visitor-authority.test.js server/managed-visitor-http.test.js` verifies registry isolation, shared membership refusal, scoped HTTP envelopes, disabled behavior, explicit start, and no doubled local stepping. A paired two-fly round trip additionally checks that the spent stimulus-reservation ledger, its limits and the chemical recovery clocks survive the visit (active optional input is truncated at the ownership boundary by design, so it may only shrink), and that checkpoint lineage — head checkpoint, checkpoint count and branch — is unchanged with no restore.

**Not preserved, because unsupported.** RNG state, plasticity, refractory state, delay buffers and
embodiment are `UNSUPPORTED` in `server/runtime.js`; checkpoints record them as `null`. The
continuity result above says nothing about retained learning or reproducible stochastic dynamics,
and must not be described as preserving them.

Browser validation used a temporary identity store and fake broker transport through the actual HTTP server: explicit discovery, paused admission, start, rest at tick 343, and confirmed return preserved tick 343 and restored home controls. The home body/controller was withheld while owned. This did not create a production host visitor. The complete suite passed 199 tests; the production build passed.
