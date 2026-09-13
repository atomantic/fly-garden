# Engineered visual mapping foundation

This module does not load a graph, stimulate a worker, advance simulation or move a body. It defines reproducible input/output ports and pure encoder/readout functions for future integration under issue #4. `executionValidated: false` is deliberate. Passing these tests establishes bounded software behavior, not natural control, physiological accuracy, learning or experience.

## Pinned source and mapping

The original `scripts/extract-visual-mapping.py` reads only selected metadata columns after checking the annotation file's exact byte count and SHA-256 against its source lockfile. Male CNS uses `status == Traced`; BANC v888 uses proofread or roughly-proofread TRUE and excludes non-neuronal superclasses. BANC IDs are checked against `root_888`. No numeric ID is converted through floating point. The Node builder uses the pinned graph manifest hash; canonical complete-graph hashes match the measured values documented in CONNECTOME_MEMORY.md. These hashes are provenance, not an admission estimate or graph execution.

Generated manifests live in `connectome/visual-mappings/`. They contain exact source-qualified neuron IDs, annotation/graph hashes, exclusions, fixed engineering configuration and a canonical SHA-256 digest. Rows are sorted independently of source order. IDs determine identity only; their order never determines camera position. The extractor is the trusted source-to-manifest boundary; the builder's checksum is not a cryptographic signature authenticating arbitrary caller-supplied metadata. Integration must load the checked-in manifest, verify it against the actual graph descriptor and resolve every ID before accepting input.

Male selects L1/L2 cells with explicit side and integer hex coordinates within the observed range. Missing side/hex entries are excluded; every member of a duplicate type/side/hex tuple is excluded. The resulting 3,532 input ports exclude both L2 right (25,10) candidates. BANC selects 3,217 L1/L2 cells with explicit side; it has no equivalent retinotopy and receives coarse side-pooled input. Excluded cells remain part of the complete graph; they simply receive no external input from this adapter.

DNa02 steering IDs are Male left `male-cns:v1.0/523769`, right `male-cns:v1.0/10360`; BANC left `banc:v888/720575941510475536`, right `banc:v888/720575941456897005`. The exact type/side pairs must appear in the extraction or generation fails.

## Frozen engineering hypothesis

Input is exactly `{frameId,width:32,height:16,pixels:[512 luminances]}`. Luminances must be finite in [0,1]. Unknown keys—including observer camera, object identities, target coordinates and proximity—are rejected. Frame IDs strictly increase until explicit reset. The caller supplies actual controller-camera pixels; this pure module cannot establish how the caller rendered them.

The first frame establishes a baseline and yields zero. Subsequent frames encode change from the previous accepted frame. BANC averages each camera half-field, maps positive change to same-side L1 and negative change to L2. Male samples each cell's annotated hex coordinate through the chosen synthetic projection `u=(q-1+0.5*(r-1))/54`, `v=(r-1)/38`, into the appropriate 16x16 camera half. Both eye projections use this same chosen orientation. This bypasses photoreceptors and is explicitly synthetic, not calibrated biological visual angles or a physiological ON/OFF claim.

Each side/type channel distributes a maximum total 0.02 engineered external delta-V per 1ms tick across its admitted ports, independent of census size. This is a preregistered numerical hypothesis, not physiological current. A new frame replaces the prior pulse; there is no accumulated input queue. Over 20 caller-driven ticks its multiplier falls linearly from 1 to 0.05, then stays zero. Maximum integrated delta-V per channel from one maximal frame is 0.21. Unchanged frames immediately set input to zero. No timer, adaptation, automatic gain increase or tune-to-force-response behavior exists.

The readout accepts exactly two binary firing flags per 1ms tick. A trailing 100-tick window, zero-padded on initialization, estimates each DNa02 rate. Yaw is `0.5*(min(1,rightHz/100)-min(1,leftHz/100))` radians/s. Positive yaw is a declared right-minus-left convention that a later renderer adapter must explicitly bind. Forward speed is always zero. Silent input flags yield zero yaw after prior window contents expire; reset clears the window immediately. No constant motion or fallback oscillator exists. Call reset at pause/rest/home, unload/restore, owner change and any frame/session discontinuity.

## Integration gates and validation

No runtime/kernel/registry API changes are included. Later integration must resolve source IDs against the complete graph, preserve fixed dose/step reservations, limit one frame in flight, bind individual/session/owner epochs, reject stale/replayed frames, and pause after 250ms without fresh rendering. It must clear both pure components on lifecycle changes and validate motor output against the body coordinate convention. Static imagery being zero input is an explicit temporal-contrast model assumption, not a claim about tonic biological vision.

Tests cover shuffled source order, duplicate/missing annotations, exact source/graph provenance, black/left/right frames, bounded finite pixels, forbidden hidden metadata, first/static zero, decay expiry, clipped steering and zero forward drive. No full-graph causal intervention ran. A later separately authorized black/left/right raster intervention with disconnected-input/readout controls must trace image → delta-V ports → neural changes → DNa02 window → yaw before claiming an effective causal loop. No downstream response is an acceptable negative outcome; do not increase gain until movement appears or label a synthetic test as natural control.

## Reproduction

Use an existing PyArrow environment; no installation or data download is required by these scripts. Replace the two annotation arguments with the already verified local files. These commands write only explicitly chosen metadata outputs:

```sh
python scripts/extract-visual-mapping.py --dataset male-cns:v1.0 --annotations /path/to/male/annotations.feather | node scripts/build-visual-mapping.js > /tmp/male-visual-mapping.json
python scripts/extract-visual-mapping.py --dataset banc:v888 --annotations /path/to/banc/annotations.feather | node scripts/build-visual-mapping.js > /tmp/banc-visual-mapping.json
node --test server/visual-mapping.test.js
```

Source annotations retain CC-BY-4.0 attribution in their lockfiles: [Male CNS](https://male-cns.janelia.org/download/) and [BANC](https://doi.org/10.7910/DVN/7WTH1N). Primary anatomical work describes optic-lobe hex coordinates: [visual-system reconstruction](https://www.nature.com/articles/s41586-025-08746-0). Primary dual recordings motivate the bilateral DNa02 steering candidate: [steering control study](https://elifesciences.org/articles/102230). These findings do not establish the present gain, synthetic projection, LIF response or body mechanics. No third-party code or models were copied.

## Analytic limitation: the current example cannot elicit spikes from rest

With model threshold 1, zero resting drive and no initial spikes, distributing 0.02 across the smallest actual group (716 cells) gives at most 0.00002794 delta-V per cell per tick. A single full pulse integrates to at most 0.21/716 = 0.00029330 even without leak. Even replacing the pulse every tick cannot exceed the leaky steady-state bound `(0.02/716)/(1-exp(-1/20)) < 0.000573`, far below threshold. Since no cell first spikes, recurrent connectivity cannot change that conclusion. This is a deliberately nonspiking-by-construction example. Do not spend a full-graph intervention budget demonstrating its predetermined zero downstream response.

A separate, unimplemented threshold-referenced proposal is a single 1ms onset impulse of `1.25 * rectifiedContrast` per selected port, capped at 1.25, applied after leak and before threshold comparison. A contrast of at least 0.8 would reach threshold from zero in a non-refractory isolated cell; this is an engineered numerical convention, not physiology. Static frames remain zero, and normal reset/refractory behavior remains intact. A maximal Male frame could target at most 3,532 ports and therefore at most 4,415 aggregate delta-V; BANC at most 3,217 ports / 4,021.25 delta-V. That much simultaneous activation may traverse many real edges, so neither safety/performance nor successful steering follows from the scalar threshold argument.

Before adopting that proposal, freeze separate per-frame and per-session admitted-port/aggregate-delta-V ceilings, owner/epoch rules and a small total step budget. Pure tiny-kernel characterization should verify threshold ordering, refractory suppression, all-or-none input validation and rollback on nonfinite values before any real graph trial. This PR does not implement that proposal, change the fixed 0.02 example, or run characterization or full-graph interventions. Any later gain choice must be reviewed before observing full-graph results, never tuned until appealing motion appears.
