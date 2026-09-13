# Threshold-referenced onset foundation v2

This separate pure foundation leaves the v1 0.02 aggregate encoder unchanged. No server route, worker command, graph loading, registry integration, automatic arm or production action is introduced. Tests characterize two-neuron synthetic arrays only. The source mapping remains pinned and steering remains yaw-only with zero forward speed.

## Fixed numerical hypothesis

`createOnsetEpisode(mapping)` validates the pinned v1 mapping and starts disarmed. Explicit `arm()` enables caller-driven processing. A first frame establishes baseline without input. Subsequent 32x16 luminance frames use the same disclosed Male hex projection / BANC coarse side pools and rectified L1/L2 contrast. Each positive port receives `min(1.25, 1.25 * rectifiedContrast)` engineered external delta-V for exactly one 1ms tick. No aggregate population normalization suppresses the threshold scale. The model threshold is 1, so contrast 0.8 yields delta-V 1 from zero if the cell is not refractory. This is a numerical threshold ratio, not biological current, reward or a claim of effective neural steering.

Limits are immutable: 4,000 nonzero ports and 5,000 aggregate delta-V per accepted frame; 8 nonzero onset frames and 40,000 aggregate delta-V per episode; 200 armed caller ticks; at least 20 such ticks between frames. Zero/static frames do not consume the nonzero-frame quota but do consume the frame cadence. A pending impulse cannot be replaced or queued. Each accepted nonzero frame reserves its count and sum before returning a receipt. Tick returns it once and clears it. Pulse delivery does not repeat when rendering stops.

Reset/disarm clear pending input and baseline, preserve all consumed ticks/frame IDs/reservations and require explicit re-arm. Re-arm cannot revive an exhausted episode. Dropped admitted pulses remain charged. There is no API to refund or import a smaller budget. The last admitted impulse may still be delivered once after its admission exhausts the frame quota; disarming discards it irreversibly. Exhausting 200 ticks disarms automatically. Read-only status exposes the fixed limits, counts and `pure-characterization-only-no-full-graph-validation` disclosure.

A future trusted controller must own creation of new episode objects, bind them to exact individual/owner/session authority, and durably reserve exposure before kernel delivery. Reconstructing a new object must never be used to bypass a saved episode budget. This pure object provides no durable authority, wall-clock freshness or cross-restart enforcement and therefore is not independently safe to expose over HTTP. A future controller must also revoke on wall-clock stalls, detach/rest/home/unload/restore and preserve reservations across those boundaries.

## Minimal kernel input primitive

`kernel.step()` retains existing behavior. `kernel.step([{index,deltaV}, ...])` adds explicit nonnegative sparse delta-V for that call only. It validates the entire list before touching scratch or authoritative arrays: unique in-range integer indices, exact keys, finite 0..1.25 values, at most min(neuronCount,4000) entries, sum at most 5000. Unknown or invalid entries reject the entire step without changing arrays, clocks, counters or prepared-restore validity.

Integration order is unchanged delayed synaptic accumulation, exact exponential leak, then external delta-V, then threshold/reset. Refractory neurons ignore external input and remain reset; pending spikes propagate on the next tick through existing edges. The kernel retains no external drive or episode counters. Neural model/checkpoint keys remain compatible because intrinsic parameters, delayed propagation and no-input behavior are unchanged; explicit input changes only the recorded neural state. Exact restored neural arrays continue deterministically with no input. Controller exposure history and future pending-frame authority must be handled separately, never inferred from the neural checkpoint.

Tiny synthetic tests establish input threshold ordering, normal refractory suppression, delayed outgoing propagation, complete rejection of malformed input, unchanged no-input dynamics and restored-array continuation. They do not demonstrate whole-graph activity, motor output, welfare, memory or behavior. The kernel primitive supplies per-step numeric bounds only; it must not be mistaken for authorization to stimulate any actual dataset.

## Later review boundary

No actual connectome trial is authorized by this module. The proposed separately reviewed campaign remains at most two datasets × four conditions × 200 neural ticks =1,600 aggregate ticks, at most 8 onset frames per condition, no automatic retries or gain adaptation. Fixed black/left/right raster interventions and disconnected input/readout controls must precede any natural-control claim. Real-graph active-edge load may differ substantially from prior zero-drive measurements. Failure to propagate to DNa02 or produce yaw is a valid negative result, not a reason to increase input or invent motion.

Run only the tiny tests for this foundation:

```sh
node --test server/visual-onset.test.js server/visual-mapping.test.js server/connectome.test.js
```
