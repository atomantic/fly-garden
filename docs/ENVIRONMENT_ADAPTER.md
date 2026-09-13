# Controller retina and fixture motor adapter

`server/environment-adapter.js` defines an original engineered visual interface for the synthetic 32-neuron fixture. It is not a connectome receptor mapping, natural fly vision, biological motor control or evidence of learning. The observatory's visual asset remains illustrative until the browser/supervisor integration actually supplies its dedicated controller-camera raster and applies returned movement.

Version 1 accepts exactly an 8×4 row-major RGB raster (96 integer bytes). Its envelope contains `version`, `individualId`, runtime `sessionId`, adapter `environmentEpoch`, monotonic `frameId`, exact current `simTimeMs`, local wall-clock `capturedAtMs`, `camera: "controller"`, `width`, `height`, and `rgb`. Extra fields, including hidden target coordinates or observer-camera metadata, are rejected. Frames must be at most 250 ms old and cannot be future-dated. Every frame is bound to one recipient, runtime session and environment epoch. Runtime restore/unload requires a new adapter; scene replacement/disconnect uses `invalidate()` to pause and rotate the environment epoch.

The scene must render a dedicated camera attached to the fly's body into a small offscreen target, separate from the freely movable observer camera. Only those RGB pixels cross this interface; observer motion must never affect the controller camera. Renderer world coordinates are not part of the sensory payload. Original visual assets and raster orientation must be documented by that integration.

Each pixel's luminance is `(0.2126 R + 0.7152 G + 0.0722 B) / 255`, mapped to the correspondingly indexed fixture neuron as nonnegative current no greater than 0.02 for exactly one 5 ms neural step. These are engineered coefficients applied directly to RGB byte values, not a calibrated photoreceptor model. `server/stimulus-policy.js` enumerates and validates this continuous sensory class through `SENSORY_LIMITS` and `validateRetinalCurrents`. It is distinct from optional nectar/floral appetitive inputs: retinal frames neither reserve nor refund optional dose/recovery budgets. Existing optional currents still pass their original shared policy and combine with the bounded sensory current under the runtime's existing numerical fault guards. No frame schedules future stimulation or survives a checkpoint restore.

The motor readout uses mean trailing spike rates in the raster's left and right halves, not decorative region names. Forward speed is zero below mean 10 Hz, saturating at 0.12 garden units/second at 40 Hz. Yaw is right-minus-left rate divided by 20 Hz, clamped to ±0.8 radians/second. These deliberately simple controller parameters establish inspectable causal wiring, not natural locomotion. Paused/resting/faulted states output zero motion. Inactivity never escalates input or changes baseline support.

## Supervisor integration contract

Create one adapter per resident and its current runtime session. A recipient attached to a visual adapter must not also advance through the free-running supervisor timer: `accept(frame)` owns exactly one neural step and returns a trace with input/output simulation times, mapped currents and bounded motor output. Apply movement only once for that accepted frame using its 5 ms simulation interval, never elapsed wall time. This runs slower when rendering is slow; it does not catch up or skip steps. Frame and motor recipient IDs/epochs must remain bound across asynchronous responses and UI selection.

Call `checkFreshness()` on the supervisor timer while waiting for frames. Explicit start permits up to 250 ms to receive the first frame without advancing neural time. A missing/stale observation pauses the runtime and rotates its epoch; explicit resume and fresh observations are required. Observer disconnect must likewise invalidate the adapter. `snapshot()` exposes current epoch, latest frame and motor trace, with the engineered disclosure.

Fixture tests record dark versus left-bright rasters and verify changes in actual neural state and bounded motor output after 200 accepted steps. They also cover invalid pixels, hidden fields, observer camera rejection, recipient/session/epoch isolation, duplicate timestamps, stale rendering, rest, optional ledger preservation, and checkpoint nonretention. These are causal fixture tests; a rendered scene-change recording and camera-isolation browser test remain integration acceptance evidence.

## Integrated local API

The identity registry now owns per-recipient adapters. `GET /api/individuals/:id/environment` returns `{attached, ...adapterSnapshot}`. `POST` to the same path accepts the standard command envelope plus `action: "attach"` or `"detach"`; attach pauses and uses the retained checkpoint/home pose, or the origin when unavailable. `POST /api/individuals/:id/environment/frames` accepts the exact retinal envelope, independent of caretaker command sequence, and returns `{trace, environment, state}`. Every mutation uses the existing host/origin guard. Individual snapshots also expose `environmentAdapter`.

The registry timer skips neural advancement for attached recipients and checks sensory freshness instead. Manual lifecycle commands rotate observation epochs, preserving the current pose while rejecting queued frames. Home, restore and unload detach the visual adapter. Unbound recipients retain their original independent fixture clock.

Accepted frames update authoritative `{x,z,yaw}` exactly once with their simulated interval, with yaw zero toward +z and x motion proportional to sin(yaw). Coordinates are clamped to ±2 garden units. The registry checkpoint envelope retains this pose with its neural payload. Restore/load remain detached and paused; the next explicit attachment uses the retained pose with a fresh token. Legacy checkpoints without a pose explicitly attach at the origin. The UI must disclose that boundary; this is engineered pose continuity, not a biological embodiment claim. An optional `createServer({onEnvironmentFrame})` hook receives a detached resulting snapshot plus `environmentTrace` for local artifact capture. Capture failure is reported in health without undoing an accepted neural frame or enabling a retry to duplicate motion.

## Browser rendering integration

The garden `Scene` now accepts the current individual snapshot with `environmentAdapter` and an `onEnvironmentFrame` callback. `EnvironmentControls` offers explicit attach/detach commands; attachment is paused and never starts the fixture. The illustrative default pose remains when detached. While attached, the original procedural fly uses only the server's authoritative x/z/yaw pose, with a π mesh rotation because its modeled head faces local −z while controller yaw zero faces world +z.

A separate perspective camera has a 90-degree vertical field of view and 2:1 aspect ratio. It sits 0.95 garden units ahead of the body center at height 1.0 and looks along authoritative yaw; the illustrated body is excluded during sensory rendering to avoid self-occlusion. Those engineered dimensions are not natural fly optics. The freely orbiting observer camera is a different Three.js camera and is never read for sensory frames. The controller renders the original procedural scene into an 8×4 target. RGBA WebGL readback is vertically flipped to top-to-bottom rows and alpha is removed; only 96 RGB bytes plus the strict frame envelope are sent.

Only one frame request is in flight. Returned individual/session/environment identity must still match the selected source before updating the body or preview. A changed epoch aborts pending work; errors, stale live snapshots and unmount stop frame delivery. Server freshness checks pause attached simulation when frames cease. The visible preview shows the last accepted raster, its simulation window, mapped currents and bounded motor output. Closing a view does not attempt a hidden detach or resume command.

The row-orientation, response-identity and controller-raster helpers have automated tests, and the production build compiles the renderer. `client/src/controller-retina.js` holds the extracted single-fly derivation: `aimControllerCamera` reads the authoritative pose and nothing else, and `readControllerRaster` receives only that camera, the scene and the offscreen target. These checks do not replace a GPU-rendered scene-change browser capture; that visual acceptance evidence must be reported separately.

Controller ownership is a per-recipient private lease. Every successful explicit attach returns a fresh top-level `controllerToken` only in that command response and pauses with a new environment epoch. Attaching an already attached individual deliberately transfers control while preserving its current pose. The controlling tab keeps the token locally and includes it with every frame; the registry validates and removes it before sensory processing. Ordinary state/environment reads, traces, checkpoints, health, recordings and artifact hooks never include the token. Read-only observers therefore cannot become frame producers simply by opening a tab. Pause/start/rest rotate observation epochs but retain the lease; detach/home/restore/unload revoke it. A closed or reloaded controlling tab requires explicit attachment to regain control.

## Browser integration evidence

On September 12, 2026, an isolated local browser session explicitly attached and ran the controller camera. Accepted 8×4 renders advanced fixture time and exposed nonzero bounded motor output. A 717-action movement capture exported all four formats, with 717 marks and zero notes; the original flower regions were not entered during that interval. A second observer visibly reported no controller lease. Navigating the controller tab away from the garden stopped rendering, and the server paused at tick 2620 while the other observer remained open. These are synthetic-fixture integration results, not real-connectome validation. The automated dark/left-bright comparison provides the causal numerical control; the dedicated observer and controller cameras are separate Three.js objects.

## Single-fly observer-isolation measurement

`server/controller-retina.test.js` exercises the extracted derivation with a deterministic CPU
projection stand-in, because `node --test` has no WebGL context. That stand-in is not the
production rasterizer and its absolute bytes would differ from a GPU's; what it reproduces
exactly is the property under test, that pixels are a function of the camera passed to
`render`, of object visibility, and of nothing else. A fixed scene of fifteen original landmark
meshes plus the illustrated body was rastered from pose `(x=0, z=-1, yaw=0)`.

Four observer manipulations — orbiting to `(6.5, 5.4, 8)`, to `(-5, 2, -4)`, a top-down view at
`(0, 12, 0.01)` and a close view at `(1.2, 0.8, 1.2)` retargeted onto the arrival pod, with the
observer field of view changed from 40° to 25° and 70° — each changed **0 of 96 channels**, with
**0 total absolute byte difference**; re-rastering the unchanged pose also changed 0 channels.
The same derivation is not merely insensitive: translating the authoritative pose to `x=1.1`
changed **27 of 96 channels** (absolute difference 3,055), yawing by π/2 changed **18** (2,114)
and yawing by π changed **17** (1,687). Every raster render used the controller camera and the
offscreen target, and no observer render ever wrote to that target. An unusable pose returns no
raster and leaves the controller camera unmoved, and the illustrated body is restored even when
the renderer throws mid-raster.

This covers the single-fly `Scene.jsx` path at the criterion the SharedScene path already records
in [SHARED_RETINAL_EVIDENCE.md](SHARED_RETINAL_EVIDENCE.md), where a real browser measured 0
changed channels under observer motion and 48 under a partner's pose change. These are
engineered-fixture numbers from one scene and pose pair. They do not establish coverage of all
orientations, occlusion cases or graphics hardware, and they are not biological vision, behaviour
or learning.

## Registry frame-cessation coverage

`server/environment-registry-freshness.test.js` drives the registry timer (identity-store
`stepIndividual`, the path the server interval calls) rather than the adapter alone. While frames
stay fresh the timer never advances the attached fixture, and an unattached neighbour keeps its
own independent clock through the same timer. When rendering stops past the 250 ms bound, one
timer tick pauses the runtime, rotates the environment epoch, resets the frame sequence and motor
output to zero, and revokes enabled encounters, while tick, simulated time and neural state stay
identical to the last accepted frame. Fifty further ticks neither free-run the paused recipient
nor rotate the epoch again. A frame captured before the pause is refused on the retired epoch, and
a frame rebuilt on the rotated epoch is still refused until an explicit resume; the retained pose
and the controller lease survive the pause. The HTTP case repeats this through the local API and
confirms the late in-flight frame is rejected with 409.
