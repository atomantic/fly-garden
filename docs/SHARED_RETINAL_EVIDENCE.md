# Static shared renderer sensory contrast

This check exercises the exact procedural world, controller-camera placement and
retinal raster code used by `SharedScene.jsx`, extracted into
`client/src/shared-visual-world.js`. It uses externally arranged static poses and
imports no runtime, checkpoint, registry or worker. It issues no app API calls.
It does not run a simulation or demonstrate neurally generated movement.

## Fixed procedure

Run the local Vite development server, open `/research/shared-retinal.html`, then
explicitly click **Run static renderer check once**. This development-only page
is not linked from the app or included as a production build entry. Six 8×4 RGB
rasters are rendered synchronously, with no animation loop, retry or tuning:

1. Recipient `(x=0,z=-1,yaw=0)`, partner A `(0,0.2,0)`.
2. Repeat A unchanged.
3. Partner B `(1.5,0.2,0)`, recipient unchanged.
4. Restore partner A.
5. Render the independent observer from `(6,5,7)`, then capture A.
6. Render the observer from `(-5,2,-4)`, then capture A.

Each recipient camera hides only its own original procedural body during the
raster. The partner, flowers, lights and floor remain present. No partner neural
state, hidden goals or observer-camera parameters enter the retinal encoder.
All comparisons are exact integer-byte comparisons with no tolerance widening.
Failure or WebGL unavailability is reported, not replaced with a fake raster.

## Recorded result

On September 12, 2026, Chrome on Darwin arm64 with Three.js revision 186 ran the
fixed procedure once on an isolated local page. Partner A→B changed **48 of 96
channels**, with **1,414 total absolute byte difference**. Repeat A, return to A,
and changed observer view each changed **zero channels**. The two distinct
rasters and lossless references for the four equal rasters are retained in
[the result](../research/results/shared-retinal-static.json).

This supports the narrow claim that a partner's externally arranged spatial
position changes the other body's engineered visual input through the production
renderer, while the tested observer manipulation does not. It is not a dynamic
trajectory, behavioral interaction, biological perception, consent, learning,
sex comparison or full-dataset paired simulation. One scene/pose pair does not
establish coverage of all orientations, occlusion cases or graphics hardware.
GPU implementations may produce different absolute bytes; future runs should
report their own contrasts and controls rather than require this raster golden.
That run predates the provenance rule below and recorded only "Chrome on Darwin
arm64": its renderer string was not captured, so it cannot be attributed to a
specific rasterizer. Every figure recorded after it names its browser and renderer.

## Neurally generated coupling (headless projection measurement)

The static check above uses externally arranged poses. This second check does not:
every pose it measures was produced by the ordinary fixture barrier from its own
engineered motor readout. `server/shared-neural-coupling.js` runs two synthetic
32-neuron runtimes through 4,000 real shared barriers (20,000 ms of simulation).
The recipient (member 0, starting at `x=0,z=-1,yaw=0`) receives an all-zero 8×4
raster; the partner (member 1, starting at `x=0,z=0.2,yaw=0`) receives an all-255
raster. No reward, objective, proximity target or partner neural state enters
either runtime. `scripts/shared-neural-coupling.mjs` records one run to
[the result](../research/results/shared-neural-coupling.json); the committed test
recomputes the same run and compares it exactly.

**Attribution control.** Each barrier's reported motor readout is integrated
independently, outside the session, using the same declared 5 ms integration. The
independently integrated trajectory equals the committed pose exactly, so the
movement is the motor readout's consequence and not an arranged trajectory. The
zero-input recipient is a benign control: its peak forward motor was 0.0005 and it
translated 6.4e-5 garden units, while the stimulated partner's peak forward motor
was 0.018375 and it translated 0.284 garden units, ending at
`x=0.004465, z=0.484194, yaw=0.016538`.

**Measured consequence.** Node v26.0.0, Three.js revision 186, Darwin arm64, one
run, no tuning. The committed initial and final poses were applied through the
production `createSharedVisualWorld` scene graph and the production controller
camera, and the partner body's real mesh vertices were projected through that
camera into the 8×4 retinal cell grid. The partner's footprint fell from **20 of
32 cells to 9 of 32**, changing occupancy in **11 cells**
(`0,1,2,5,6,7,18,26,27,28,29`). Its normalized-device bounds shrank from
x `[-0.927, 0.927]`, y `[-0.890, 0.973]` to x `[-0.616, 0.730]`, y `[-0.490, 0.439]`,
and 50 more of its 1,549 vertices came inside the frustum as it receded. Repeating
the measurement on the unchanged initial poses reproduced the first measurement
byte for byte, so the change is the movement's consequence and not measurement noise.

**Disclosed limitation of this measurement.** The paragraph above is a geometric
projection through the production camera, **not a GPU raster**. On its own it does not
assert that any of the 96 rendered bytes changed, because Three.js `WebGLRenderer`
needs WebGL and `node --test` has none. The byte-level run that closes that gap is
recorded in the next section; the geometric numbers are kept here because they are
the WebGL-free control that any machine can recompute.

This is not a dynamic behavioral interaction, biological perception, consent,
learning, sex comparison or full-dataset paired simulation.

## Neurally generated coupling (real-GPU byte measurement)

The byte-level consequence of that exact recorded trajectory has now been measured.
`measureNeuralSharedRetinalEvidence` in `client/src/shared-retinal-evidence.js`,
reachable from the second button on `/research/shared-retinal.html`, replays the
committed initial and final poses of
[the coupling run](../research/results/shared-neural-coupling.json) through the
production `WebGLRenderer`, the production shared scene graph and the production
controller camera. It renders no other pose, runs no simulation, tunes nothing and
issues no app API call. `node scripts/gpu-retinal-evidence.mjs` drives that button
over the DevTools Protocol against an already running browser and records what it
measured.

**Provenance.** September 12, 2026, Darwin arm64, Three.js revision 186, Chrome
153.0.8010.36 driven over CDP, renderer
`ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)`. **This is a real hardware Metal rasterizer, not
the software SwiftShader device in the headless shell**, and not the CPU projection
above. The full result, including all three rasters, is in
[the GPU result](../research/results/shared-neural-retinal-gpu.json).

| Comparison | Changed channels | Absolute byte difference |
| --- | ---: | ---: |
| Initial → final committed pose (the neurally generated movement) | **49 of 96** | **1,022** |
| Initial pose rendered twice (control) | 0 of 96 | 0 |

Two independent runs, each in a fresh page load, produced these numbers identically.

**What this changes.** The honest statement earlier in this document was that the
byte-level rendered consequence of that specific trajectory had not been measured.
It has now: the partner's neurally generated movement changes **49 of the 96 bytes**
the recipient's production retinal encoder actually receives, and re-rendering the
unchanged initial poses changes none. The result is positive, so no negative result
had to be recorded here; had it come back zero it would have been recorded as one
rather than retuned.

**How it compares to the measurements it stands beside.** The static externally
arranged partner move (A→B, 1.5 garden units sideways) changed 48 of 96 channels
with 1,414 total absolute difference. The neurally generated move changes a
comparable count of channels, 49, with a smaller total magnitude, 1,022, which is
consistent with the partner receding along +z and shrinking rather than translating
across the field of view. The geometric proxy for the same trajectory reported the
partner's footprint falling from 20 of 32 cells to 9, changing occupancy in 11 cells.
Cell occupancy and rendered channels are different quantities and the counts are not
expected to match; what the GPU run adds is that the rendered bytes move at all,
which the projection could not assert.

**Still not established.** One scene, one pose pair, one graphics device, one
renderer revision. Absolute bytes are hardware and driver specific and are recorded
as an observation, never as a golden value another machine must reproduce. This
remains an engineered sensory interface on a synthetic 32-neuron fixture: it is not
a dynamic behavioral interaction, biological perception, consent, learning, sex
comparison or full-dataset paired simulation.

## Remaining work

Shared resting coexistence and partial withdrawal now ship; see
[the session contract](shared-fixture-session.md). Full-worker transactional
barriers and integrated active-pair resource measurements remain separate work for
issue #20.
