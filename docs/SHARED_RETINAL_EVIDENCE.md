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

**Disclosed limitation, and the negative part of this result.** This is a geometric
projection through the production camera, **not a GPU raster**. It does not assert
that any of the 96 rendered bytes changed. That byte-level claim is still
unmeasured: Three.js `WebGLRenderer` needs WebGL, which is unavailable in this
headless Node environment, and no browser run was performed here. The harness for
it now exists — `measureNeuralSharedRetinalEvidence` in
`client/src/shared-retinal-evidence.js`, reachable from the second button on
`/research/shared-retinal.html` — and replays exactly these recorded committed
poses through the real renderer. Until someone runs it and records the numbers
here, the honest statement is: **neurally generated movement measurably changes the
partner's footprint in the other member's production retinal camera, and the
byte-level rendered consequence of that specific trajectory has not been measured.**
A future run reporting zero changed channels is a real negative result and must be
recorded as one rather than retuned.

This is not a dynamic behavioral interaction, biological perception, consent,
learning, sex comparison or full-dataset paired simulation.

## Remaining work

Shared resting coexistence and partial withdrawal now ship; see
[the session contract](shared-fixture-session.md). Full-worker transactional
barriers and integrated active-pair resource measurements remain separate work for
issue #20.
