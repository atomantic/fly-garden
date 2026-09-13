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

The fixture's frozen Rest semantics remain unchanged. Shared resting coexistence,
full-worker transactional barriers and integrated active-pair resource measurements
remain separate work for issue #20.
