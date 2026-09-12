# Managed fixture visitors (service foundation)

The bridge is default off and supports only the synthetic 32-neuron fixture. It does not establish connectome execution, retained learning, subjective experience, or biological vision. The host supplies an **engineered gentle-patch spatial projection**, not rendered retinal imagery. That explicit source label accompanies the local input/motor trace. The host's procedural fly illustration has no humanoid puppet, ragdoll, combat, injury or physics authority.

The server integrates this service with an exclusive registry adapter and scoped HTTP routes. The visitor browser surface uses explicit discovery, admission and start controls. No production credentials, host visitors or network servers were created for validation.

## Explicit configuration

The server transport is enabled only with all three environment values:

- `FLY_GARDEN_PORTOS_URL`: exactly `http://127.0.0.1:5553`, `http://127.0.0.1:5555`, `http://[::1]:5553` or `http://[::1]:5555`.
- `FLY_GARDEN_MANAGED_APP_ID`: the owner-approved managed app ID.
- `FLY_GARDEN_VISITOR_CREDENTIAL`: the separately provisioned `mv1_` app credential. Keep this in the server process environment; never send it to the browser, checkpoint, recording, log or world payload.

The PortOS owner explicitly provisions individual/world allowlists. PortOS separately negotiates the host's `managedVisitors` version 1 capability, `fly-v1`, 8×4 RGB projection, expiry enforcement and `admissionDeadline:true`. Missing host support refuses admission. Existing Mind and peer travel are independent protocols.

Requests use the fixed loopback broker paths, an eight-second response deadline, redirect rejection and a 16 KiB response ceiling. Constructing the service performs no request. Boot remains paused. Admission requests a 30-second lease and remains paused after acknowledgment; `start` is separate. A fresh explicit admission is required after return/expiry; there is no automatic restart or credential provisioning.

## Registry ownership adapter

`createManagedVisitorBridge({authority, transport, now})` requires `authority.claim(individualId, ownerId)` to synchronously return an opaque private handle:

```js
{ snapshot, control, prepareStep, previewStep, commitStep, isCurrent, release }
```

Claim must reject an unloaded/non-fixture identity, another visitor owner or incompatible joint ownership. It pauses the fixture and revokes individual visual leases and encounter authority before returning. All ordinary timer, camera-frame, control, save/restore and unload paths must respect this owner. Only this private handle can advance its resident runtime while owned. `isCurrent()` verifies both ownership and the original runtime session. `release()` must only remove its own owner token and must never mutate a replacement runtime. Do not serialize the token or handle. An explicit local lifecycle change must invoke `bridge.lifecycle(id)` before dropping authority; uncertain remote cleanup retains the owner until confirmation or trusted expiry.

The bridge does not perform checkpoint restore for temporary steps. It prepares one local candidate, previews the bounded motor output, requests one host move, then commits that same candidate only if ownership/session/expiry still hold. This is not a distributed atomic transaction: a host move might occur before a lost acknowledgment or a locally invalidated candidate. Such uncertainty pauses local evolution and triggers cleanup; it never retries a movement or claims the unconfirmed neural step happened.

## Service API

- `snapshot(id)` returns per-ID phase, ownership, running/pending state, world, runtime session, visit epoch, expiry, reason and the last bounded input/motor trace. No credential or neuron history is included.
- `capabilities(id, worldId?)` reads negotiated allowed worlds without acquiring a body.
- `admit(id, {worldId})` acquires exclusive local ownership, then requests a scoped paused body. Selection changes cannot retarget it.
- `control(id, 'start' | 'pause' | 'rest' | 'home')` is explicit. Pause/rest stop local evolution immediately. Home requests scoped unsequenced cleanup. A pause/rest during an outstanding request initiates cleanup to prevent the pending response restarting movement.
- `tick(id)` performs at most one observation/move/commit. Overlap returns immediately. Call from a bounded scheduler; it does not create a timer. Tick also detects pause, runtime replacement, backwards clocks and expiry and retries uncertain cleanup at most once per second.
- `lifecycle(id)` and `disconnectAll()` quiet local execution and request cleanup. Keep lifecycle processing active through pending requests and shutdown cleanup; never report an unconfirmed return as home.

Every host result must match the original individual, runtime session, app, world and visit epoch. Observation IDs strictly advance, captures must be no more than 250 ms old, RGB is exactly 96 bounded bytes, and poses remain inside the negotiated patch. Only the engineered motor action `{type:'move', forward, yaw, intervalMs:5}` leaves the process. No membrane values, weights, histories, checkpoint or caretaker messages leave.

A missing admission response may still correspond to a live body. The bridge cancels by the original scoped admission request through `/admissions/cancel`; it never guesses a host lease ID. A broker-confirmed cancellation releases ownership only after the local admission request has settled. Otherwise the broker's absolute admission deadline bounds quarantine. A failed leave retains paused local ownership until confirmed cleanup or that trusted bound. The UI must show returning/disconnected/timed-out state during quarantine and must not offer a second body or controller.

## Validation and limits

`node --test server/managed-visitor-bridge.test.js` uses real fixture runtimes with fake transports. It covers paired identity isolation, explicit paused admission/start, scope/replay/invalid input, pending movement revocation, uncertain admission, late cleanup, expiry, backwards time, runtime replacement and transport bounds/privacy. An additional temporary in-process check connected the real Fly Garden bridge, PortOS broker/transport and Eidoverse host factories: negotiated admission, 20 geometric observation/motor steps and confirmed return passed without starting a network server. That check is integration evidence, not a live deployment or browser journey.

## Local HTTP integration

`GET /api/individuals/:id/visitor` reads local state only. The exact query `?capabilities=1` explicitly asks the broker for currently negotiated allowed worlds. Discovery failure returns `capabilities.available:false` with a sanitized reason; it never acquires ownership or a remote body.

`POST /api/individuals/:id/visitor` uses the existing exact command envelope:

```json
{"protocolVersion":1,"individualId":"<id>","sessionId":"<current runtime session>","sequence":1,"operation":"admit","payload":{"worldId":"<allowed world>"}}
```

The sequence must be one greater than the latest state's `commandSequence`. The other operations are `start`, `pause`, `rest`, and `home`, each with exactly `payload:{}`. Unknown fields, stale session/sequence, other query parameters and cross-origin requests are refused. Replies contain `{state,visitor}`. Normal full states also include `visitor` and `externalOwner:null` or `{kind:"managed-visitor"}`. Neither contains the registry owner token, app bearer or host session authority.

The registry rejects shared members until explicit separation. Successful claim pauses the same runtime, revokes the home visual controller and encounters, disarms language, and marks home captures discontinuous. Ordinary persistence, input, frame, timer and control paths refuse external ownership. The server scheduler performs expiry/cleanup maintenance for owned visitors but runs the observation/motor loop only after explicit start. Server shutdown requests cleanup and pauses local execution; crash boot remains paused. Ownership itself is process-local, never a durable checkpoint authority. Host expiry and duplicate-individual admission guards remain required during recovery.

`node --test server/managed-visitor-authority.test.js server/managed-visitor-http.test.js` verifies registry isolation, shared membership refusal, scoped HTTP envelopes, disabled behavior, explicit start, and no doubled local stepping.

Browser validation used a temporary identity store and fake broker transport through the actual HTTP server: explicit discovery, paused admission, start, rest at tick 343, and confirmed return preserved tick 343 and restored home controls. The home body/controller was withheld while owned. This did not create a production host visitor. The complete suite passed 199 tests; the production build passed.
