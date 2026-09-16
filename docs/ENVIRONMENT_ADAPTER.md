# Controller retina and fixture motor adapter

`server/environment-adapter.js` defines an original engineered visual interface for the synthetic 32-neuron fixture. It is not a connectome receptor mapping, natural fly vision, biological motor control or evidence of learning. The observatory's visual asset remains illustrative until the browser/supervisor integration actually supplies its dedicated controller-camera raster and applies returned movement.

Version 1 accepts exactly an 8×4 row-major RGB raster (96 integer bytes). Its envelope contains `version`, `individualId`, runtime `sessionId`, adapter `environmentEpoch`, monotonic `frameId`, exact current `simTimeMs`, local wall-clock `capturedAtMs`, `camera: "controller"`, `width`, `height`, and `rgb`. Extra fields, including hidden target coordinates or observer-camera metadata, are rejected. Frames must be at most 250 ms old and cannot be future-dated. Every frame is bound to one recipient, runtime session and environment epoch. Runtime restore/unload requires a new adapter; scene replacement/disconnect uses `invalidate()` to pause and rotate the environment epoch.

The scene must render a dedicated camera attached to the fly's body into a small offscreen target, separate from the freely movable observer camera. Only those RGB pixels cross this interface; observer motion must never affect the controller camera. Renderer world coordinates are not part of the sensory payload. Original visual assets and raster orientation must be documented by that integration.

Each pixel's luminance is `(0.2126 R + 0.7152 G + 0.0722 B) / 255`, mapped to the correspondingly indexed fixture neuron as nonnegative current no greater than 0.02 for exactly one 5 ms neural step. These are engineered coefficients applied directly to RGB byte values, not a calibrated photoreceptor model. `server/stimulus-policy.js` enumerates and validates this continuous sensory class through `SENSORY_LIMITS` and `validateRetinalCurrents`. It is distinct from optional nectar/floral appetitive inputs: retinal frames neither reserve nor refund optional dose/recovery budgets. Existing optional currents still pass their original shared policy and combine with the bounded sensory current under the runtime's existing numerical fault guards. No frame schedules future stimulation or survives a checkpoint restore.

The motor readout uses mean trailing spike rates in the raster's left and right halves, not decorative region names. Forward speed is zero below mean 10 Hz, saturating at 0.12 garden units/second at 40 Hz. Yaw is right-minus-left rate divided by 20 Hz, clamped to ±0.8 radians/second. These deliberately simple controller parameters establish inspectable causal wiring, not natural locomotion. Paused/resting/faulted states output zero motion. Inactivity never escalates input or changes baseline support.

## Supervisor integration contract

Create one adapter per resident and its current runtime session. A recipient attached to a visual adapter must not also advance through the free-running supervisor timer: `accept(frame)` owns exactly one neural step and returns a trace with input/output simulation times, mapped currents and bounded motor output. Apply movement only once for that accepted frame using its 5 ms simulation interval, never elapsed wall time. This runs slower when rendering is slow; it does not catch up or skip steps. Frame and motor recipient IDs/epochs must remain bound across asynchronous responses and UI selection.

Call `checkFreshness()` on the supervisor timer while waiting for frames. Explicit start permits up to 250 ms to receive the first frame without advancing neural time. A missing/stale observation pauses the runtime and rotates its epoch; explicit resume and fresh observations are required. Observer disconnect must likewise invalidate the adapter. `snapshot()` exposes current epoch, latest frame and motor trace, with the engineered disclosure.

Fixture tests record dark versus left-bright rasters and verify changes in actual neural state and bounded motor output after 200 accepted steps. They also cover invalid pixels, hidden fields, observer camera rejection, recipient/session/epoch isolation, duplicate timestamps, stale rendering, rest, optional ledger preservation, and checkpoint nonretention. Those rasters are hand-written pixel arrays rather than rendered ones; the recording of an actual change to the rendered garden travelling the same path is below, and the camera-isolation browser measurement is recorded further down.

## Integrated local API

The identity registry now owns per-recipient adapters. `GET /api/individuals/:id/environment` returns `{attached, ...adapterSnapshot}`. `POST` to the same path accepts the standard command envelope plus `action: "attach"` or `"detach"`; attach pauses and uses the retained checkpoint/home pose, or the origin when unavailable. `POST /api/individuals/:id/environment/frames` accepts the exact retinal envelope, independent of caretaker command sequence, and returns `{trace, environment, state}`. Every mutation uses the existing host/origin guard. Individual snapshots also expose `environmentAdapter`.

The registry timer skips neural advancement for attached recipients and checks sensory freshness instead. Manual lifecycle commands rotate observation epochs, preserving the current pose while rejecting queued frames. Home, restore and unload detach the visual adapter. Unbound recipients retain their original independent fixture clock.

Accepted frames update authoritative `{x,z,yaw}` exactly once with their simulated interval, with yaw zero toward +z and x motion proportional to sin(yaw). Coordinates are clamped to ±2 garden units. The registry checkpoint envelope retains this pose with its neural payload. Restore/load remain detached and paused; the next explicit attachment uses the retained pose with a fresh token. Legacy checkpoints without a pose explicitly attach at the origin. The UI must disclose that boundary; this is engineered pose continuity, not a biological embodiment claim. An optional `createServer({onEnvironmentFrame})` hook receives a detached resulting snapshot plus `environmentTrace` for local artifact capture. Capture failure is reported in health without undoing an accepted neural frame or enabling a retry to duplicate motion.

## Browser rendering integration

The garden `Scene` now accepts the current individual snapshot with `environmentAdapter` and an `onEnvironmentFrame` callback. `EnvironmentControls` offers explicit attach/detach commands; attachment is paused and never starts the fixture. The illustrative default pose remains when detached. While attached, the original procedural fly uses only the server's authoritative x/z/yaw pose, with a π mesh rotation because its modeled head faces local −z while controller yaw zero faces world +z.

A separate perspective camera has a 90-degree vertical field of view and 2:1 aspect ratio. It sits 0.95 garden units ahead of the body center at height 1.0 and looks along authoritative yaw; the illustrated body is excluded during sensory rendering to avoid self-occlusion. Those engineered dimensions are not natural fly optics. The freely orbiting observer camera is a different Three.js camera and is never read for sensory frames. The controller renders the original procedural scene into an 8×4 target. RGBA WebGL readback is vertically flipped to top-to-bottom rows and alpha is removed; only 96 RGB bytes plus the strict frame envelope are sent.

Only one frame request is in flight. Returned individual/session/environment identity must still match the selected source before updating the body or preview. A changed epoch aborts pending work; errors, stale live snapshots and unmount stop frame delivery. Server freshness checks pause attached simulation when frames cease. The visible preview shows the last accepted raster, its simulation window, mapped currents and bounded motor output. Closing a view does not attempt a hidden detach or resume command.

The row-orientation, response-identity and controller-raster helpers have automated tests, and the production build compiles the renderer. `client/src/controller-retina.js` holds the extracted single-fly derivation: `aimControllerCamera` reads the authoritative pose and nothing else, and `readControllerRaster` receives only that camera, the scene and the offscreen target. `client/src/garden-visual-world.js` holds the scene graph those cameras render, extracted out of `Scene.jsx` so the same production geometry can be built outside React; `server/garden-visual-world.test.js` guards its composition and the illustrated body's resting placement. `client/src/garden-raster-source.js` assembles that scene graph, the production `WebGLRenderer`, the controller camera and the 8×4 offscreen target into the one configuration every GPU evidence harness uses, so two harnesses cannot drift apart and publish incomparable bytes. The GPU-rendered scene-change measurement those checks could not supply is recorded below.

Controller ownership is a per-recipient private lease. Every successful explicit attach returns a fresh top-level `controllerToken` only in that command response and pauses with a new environment epoch. Attaching an already attached individual deliberately transfers control while preserving its current pose. The controlling tab keeps the token locally and includes it with every frame; the registry validates and removes it before sensory processing. Ordinary state/environment reads, traces, checkpoints, health, recordings and artifact hooks never include the token. Read-only observers therefore cannot become frame producers simply by opening a tab. Pause/start/rest rotate observation epochs but retain the lease; detach/home/restore/unload revoke it. A closed or reloaded controlling tab requires explicit attachment to regain control.

## Browser integration evidence

On September 12, 2026, an isolated local browser session explicitly attached and ran the controller camera. Accepted 8×4 renders advanced fixture time and exposed nonzero bounded motor output. A 717-action movement capture exported all four formats, with 717 marks and zero notes; the original flower regions were not entered during that interval. A second observer visibly reported no controller lease. Navigating the controller tab away from the garden stopped rendering, and the server paused at tick 2620 while the other observer remained open. These are synthetic-fixture integration results, not real-connectome validation. The automated dark/left-bright comparison provides the causal numerical control; the dedicated observer and controller cameras are separate Three.js objects.

## Recorded garden scene change through the whole loop

The tests above start from hand-written pixel arrays, which proves the adapter but not that anything
in the rendered garden reaches it. `server/scene-change-causality.test.js` closes that gap by running
the whole chain from a real change to the production scene graph: the same
`client/src/garden-visual-world.js` the observatory builds, rastered by the production
`deriveControllerRaster`, encoded by the production `encodeRetinalRgb`, stepped through the actual
synthetic fixture, and read back through the declared `readFixtureMotor` into the authoritative pose.
Nothing is mocked between the scene graph and the pose.

**The recorded change.** One flower cluster — the eight meshes of the flower whose stem stands at
`x ≈ −2.14, z ≈ 1.96` — is made invisible. At the baseline pose `(x=0, z=-1, yaw=0)` the controller
camera looks along `+z`, so that flower sits in raster columns 5 and 6: the half `readFixtureMotor`
reads as the right one, which is why the recorded yaw falls. The builder now returns `flowerClusters` so a harness
can name one flower instead of matching material colours. The cluster is fixed in the test, not
searched for or re-picked against an outcome, and the change is reversible presentation only: it
reserves, spends and refunds nothing in the optional appetitive encounter policy, which is a separate
server-side channel. Two hundred frames are then accepted, each aimed by the authoritative pose the
previous frame produced, so this is the closed loop and not a replayed fixed viewpoint.

| Stage | Unchanged garden | One flower cluster occluded | Difference |
| --- | ---: | ---: | :--- |
| Controller raster (8×4 RGB) | baseline | — | **6 of 96 channels**, absolute difference **772** |
| Engineered luminance currents | baseline | — | **2 of 32** currents |
| Membrane potentials after 200 frames | baseline | — | **15 of 32** differ |
| Trailing 1 s rates after 200 frames | baseline | — | **3 of 32** differ |
| Mean fixture rate | 10.500 Hz | 10.375 Hz | −0.125 Hz |
| Motor forward | 0.0020 units/s | 0.0015 units/s | −25% |
| Motor yaw | 0.0150 rad/s | 0.0050 rad/s | −67% |
| Authoritative yaw after 1 s simulated | 0.011525 rad | 0.005438 rad | −0.006087 rad |

A third loop with no scene change at all is byte-identical to the unchanged one — same raster, same
checkpointed dynamics, same motor, same pose — so this loop is deterministic and every number in the
table is attributable to the recorded scene change and to nothing else. Both loops stay far inside
the declared bounds: forward never leaves `[0, 0.12]` units/s, yaw never leaves `±0.8` rad/s, and one
second of simulated time translates the body by less than `1e-4` garden units. Nothing escalates,
because the readout is a fixed function of trailing rates with no accumulating drive.

The same file records three controls on the same closed loop. Orbiting an independent observer camera
through four positions and fields of view between every accepted frame leaves the dynamics, motor and
pose bit-identical to an unobserved run, and no observer render ever writes to the offscreen target.
That repeats the four manipulations of the isolation measurement below, which compares rasters only;
what is new is that the fixture's neural state, motor readout and pose are also unchanged by them.
Resting mid-loop zeroes motor output, refuses every further frame and freezes tick, dynamics and pose
— and restoring the occluded flower while resting does not restart anything, so inactivity through a
scene change stays a valid outcome with no escalation. Letting frames cease past the 250 ms bound
pauses the runtime, rotates the epoch, zeroes motor output and refuses the last raster on the retired
epoch, so no movement is produced from a stale frame.

**Limits.** `node --test` has no WebGL context, so the rasterizer here is the deterministic CPU
projection stand-in in `server/projection-renderer.js`, shared with the observer-isolation test below.
Its absolute bytes are not a GPU's, and the channel and potential counts in the table are properties
of that stand-in plus the real garden geometry and the real fixture, recorded as observations rather
than as golden values another rasterizer must reproduce. **They are not predictions about real
hardware, and the section immediately below shows that this table's specific cluster does not
reproduce on one**: on a real GPU, hiding that flower changes zero bytes. One scene, one cluster, one
pose, one 32-neuron engineered fixture. This is a traceable engineered control path, not biological
vision, natural locomotion, learning or an inferred mental state, and it says nothing about the
separate full-connectome result recorded in
[VISUAL_CAUSAL_VALIDATION.md](VISUAL_CAUSAL_VALIDATION.md).

### The same loop on a real graphics device

`research/scene-change-causality.html` builds the same production scene graph on the real graphics
device and rasters the same production controller camera, while
`node scripts/gpu-scene-change-causality.mjs` holds the production runtime, the production
environment adapter, the engineered luminance encoding and the declared motor readout, and aims
every frame with the pose the previous frame produced. The loop is therefore closed through real
pixels rather than replayed from recorded ones. The result is
[the GPU record](../research/results/scene-change-causality-gpu.json), and
`server/scene-change-causality-gpu.test.js` re-derives every claim in it from the recorded rasters
through the production comparison and the production encoding, so a stale or hand-edited record
cannot pass.

**Provenance.** September 16, 2026, Darwin arm64, Three.js revision 186, Chrome 153.0.8010.48
driven over CDP, renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)` — a real hardware Metal rasterizer, not a software device and
not the CPU projection stand-in. Baseline pose `(x=0, z=-1, yaw=0)`, 200 accepted frames per loop.

**The landmark census comes first, and every entry of it is published.** The CPU stand-in splats
each mesh origin into a whole pixel, so any landmark in view moves bytes there. A real rasterizer
point-samples the 32 retinal pixels, so a landmark smaller than a pixel footprint may move nothing
at all. The script therefore does not choose a flower. It hides each of the eleven flower clusters
once at the baseline pose, records all eleven results, and only then runs the closed loop.

| Hidden flower cluster | Stem at | GPU changed channels | GPU absolute difference |
| --- | --- | ---: | ---: |
| 0 | `x=2.40, z=0.00` | 0 of 96 | 0 |
| **1** (the cluster pinned above) | `x=−2.14, z=1.96` | **0 of 96** | **0** |
| 2 | `x=0.30, z=−3.39` | 0 of 96 | 0 |
| **3** | `x=1.46, z=1.90` | **3 of 96** | **61** |
| 4 | `x=−2.86, z=−0.51` | 0 of 96 | 0 |
| 5 | `x=−0.62, z=2.32` | 0 of 96 | 0 |
| 6 | `x=−1.34, z=−2.57` | 0 of 96 | 0 |
| 7 | `x=3.19, z=1.17` | 0 of 96 | 0 |
| **8** | `x=−2.22, z=0.92` | **3 of 96** | **156** |
| 9 | `x=1.02, z=3.24` | 0 of 96 | 0 |
| 10 | `x=−2.08, z=−1.20` | 0 of 96 | 0 |
| All eleven hidden at once | — | **6 of 96** | **217** |

Re-rastering the unchanged scene, and restoring every hidden cluster afterwards, each return the
exact baseline bytes, so this device is deterministic and the change is fully reversible.

**Three conditions, fixed in code before any of them ran.** The closed loop is then run on the
cluster the CPU table pins whatever the census says about it, on the lowest-indexed cluster the
census resolved, and on every flower cluster at once — a condition defined by the scene rather than
by any outcome. All three are published. The unchanged loop reads motor forward 0.00175 units/s,
yaw 0.0100 rad/s, authoritative yaw 0.008263 rad and mean fixture rate 10.4375 Hz.

| Condition | Raster | Currents | Potentials | Rates | Motor forward | Authoritative yaw |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No scene change at all (control) | 0 of 96 (0) | 0 of 32 | 0 of 32 | 0 of 32 | 0.00175 | 0.008263 |
| Cluster 1, the CPU-pinned one | **0 of 96 (0)** | 0 of 32 | 0 of 32 | 0 of 32 | 0.00175 | 0.008263 |
| Cluster 3, lowest the census resolved | 3 of 96 (61) | 1 of 32 | **4 of 32** | 0 of 32 | 0.00175 | **0.008450** |
| Every flower cluster hidden | 6 of 96 (217) | 2 of 32 | **10 of 32** | **2 of 32** | **0.00150** | **0.006788** |

The matched no-change control is byte-identical to the unchanged loop at every stage — same raster,
same checkpointed dynamics, same motor, same pose — so every difference in the table is attributable
to the recorded scene change and to nothing else. Mean fixture rate falls 10.4375 → 10.375 Hz under
the every-flower condition. Two independent runs, each starting a fresh development
server and a fresh page load, produced every figure in both tables identically.

**What this establishes, and what it withdraws.** A recorded change to the rendered garden does
reach sensory, neural and motor output on real hardware: hiding every flower moves 6 of 96 raster
channels, 2 of 32 engineered luminance currents, 10 of 32 membrane potentials and 2 of 32 trailing
rates, and drops the declared motor readout from 0.00175 to 0.00150 units/s and the authoritative
yaw from 0.008263 to 0.006788 rad after one second of simulated time. It also withdraws a reading of
the CPU table. Cluster 1's "6 of 96 channels" is a property of the origin-splatting stand-in, not of
this garden on a GPU, where that flower changes nothing; nine of the eleven clusters change nothing
individually. A single flower head spans roughly 0.36 × 0.12 garden units at about 2.9 units of
range, far less than one of the 32 retinal pixel footprints, so whether it moves a byte depends on
where a pixel-centre sample lands. Cluster 3 is an intermediate case worth naming: it moves the
raster, the currents, the membrane potentials and the integrated authoritative pose, but the
trailing-rate motor readout at frame 200 is identical to the unchanged loop's. Only the every-flower
condition moves the final motor sample as well.

**The same controls, re-run on this loop.** Orbiting an independent observer camera through the four
fixed positions and fields of view between every accepted frame leaves the dynamics, motor and pose
bit-identical to an unobserved run of the same condition. That isolation is measured rather than
assumed: across those 200 frames the observed garden recorded 200 controller renders into the
offscreen sensory target, 0 controller renders to the canvas, 0 observer renders into the offscreen
target and 200 observer renders to the canvas. Resting mid-loop zeroes motor output, refuses all 20
further frames with "Explicitly run the fixture before sending controller observations." and freezes
tick, dynamics and pose — and restoring the hidden flower while resting restarts nothing, so
inactivity through a scene change stays a valid outcome with no escalation. Letting frames cease
past the 250 ms bound pauses the runtime, rotates the epoch, zeroes motor output, retains the pose,
refuses the last raster on the retired epoch and refuses it again while paused; the explicit resume
continues from the same simulated time, so the stale frames bought no neural time.

**Limits.** One graphics device, one scene, one baseline pose, one 32-neuron engineered fixture, and
a headless Chrome rather than a windowed one. Absolute bytes are hardware and driver specific and
are recorded as observations, never as golden values another machine must reproduce; re-record the
artifact and this table together in one commit rather than loosening the test. The census speaks
only for the baseline pose — a landmark unresolvable from there may well be resolvable from another
pose, and none was tried. This remains a traceable engineered control path, not biological vision,
natural locomotion, learning or an inferred mental state, and it says nothing about the separate
full-connectome result recorded in
[VISUAL_CAUSAL_VALIDATION.md](VISUAL_CAUSAL_VALIDATION.md).

## Single-fly observer-isolation measurement

`server/controller-retina.test.js` exercises the extracted derivation with the deterministic CPU
projection stand-in in `server/projection-renderer.js`, because `node --test` has no WebGL context.
That stand-in is not the
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

### The same manipulations on a real graphics device

The stand-in above proves the wiring but not the pixels. The single-fly garden scene graph has
therefore been extracted out of `Scene.jsx` into `client/src/garden-visual-world.js`, exactly as
`SharedScene.jsx` already delegates to `shared-visual-world.js`, so the production geometry can be
rastered through the production `WebGLRenderer`. `client/src/controller-retina-evidence.js` runs the
identical seven manipulations — the same four observer views and field-of-view changes, the same
three authoritative pose changes — reachable from an explicit button on
`/research/controller-retina.html`. `node scripts/gpu-retinal-evidence.mjs` drives that button over
the DevTools Protocol and records the result in
[the GPU result](../research/results/controller-retina-gpu.json). Nothing is started, created,
attached or advanced.

**Provenance.** September 12, 2026, Darwin arm64, Three.js revision 186, Chrome 153.0.8010.36
driven over CDP, renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)` — a real hardware Metal rasterizer, not a software device and
not the CPU projection stand-in. Baseline pose `(x=0, z=-1, yaw=0)`.

| Manipulation | GPU changed channels | GPU absolute difference | CPU stand-in changed channels |
| --- | ---: | ---: | ---: |
| Observer to `(6.5, 5.4, 8)`, 40° | **0 of 96** | **0** | 0 |
| Observer to `(-5, 2, -4)`, 40° | **0 of 96** | **0** | 0 |
| Observer top-down at `(0, 12, 0.01)`, 25° | **0 of 96** | **0** | 0 |
| Observer close on the pod at `(1.2, 0.8, 1.2)`, 70° | **0 of 96** | **0** | 0 |
| Re-raster of the unchanged pose | **0 of 96** | **0** | 0 |
| Authoritative pose translated to `x=1.1` | **12 of 96** | **770** | 27 (3,055) |
| Authoritative pose yawed by π/2 | **66 of 96** | **1,944** | 18 (2,114) |
| Authoritative pose yawed by π | **27 of 96** | **449** | 17 (1,687) |

Two independent runs, each in a fresh page load, produced these numbers identically.

**Reading the difference honestly.** The observer column is the claim, and it is the same on both:
every observer manipulation changes exactly zero controller channels, on a real GPU as on the
stand-in. The pose column is only the sensitivity control, and its numbers are **not** expected to
agree, because the two rasterizers draw different things: the stand-in splats fifteen synthetic
landmark mesh origins with nearest-depth wins, while the GPU shades the real 131-mesh garden with
its lights, materials, fog and transparency. The GPU finds a yaw of π/2 far more consequential
(66 channels) and a sideways translation far less (12) than the stand-in did. Neither ordering is a
property of the interface; both are properties of the scene each rasterizer drew. What both agree on
is the asymmetry that matters: observer motion changes nothing, authoritative pose changes
something.

One scene and pose pair on one graphics device. Absolute bytes are hardware and driver specific and
are recorded as an observation, never as a golden value another machine must reproduce. This is an
engineered fixture interface, not biological vision, behaviour or learning.

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
