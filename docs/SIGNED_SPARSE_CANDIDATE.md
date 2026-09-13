# Candidate: bounded signed-deviation sparse dynamics

Tiny synthetic implementation only, September 12, 2026. Supersedes the stateless interface proposal as the next design candidate; The separate tiny kernel is implemented; full-graph execution remains disabled. Proposed model IDs: `malecns-signed-contract-v1` and `banc-signed-contract-v1`. This is an engineered graph dynamical system, not a biological fit, spiking model, or reinterpretation of an existing LIF checkpoint.

## Decision and physiological scope

A contraction-normalized recurrence is coherent as a bounded, input-driven hypothesis. It can propagate signed deviations across the actual sparse graph, including the inversion of a negative L1 response through a negative modeled edge, without tonic current. It does **not** establish the physiological operating point that makes reduced glutamate release depolarizing. Its useful falsifiable question is narrower: does a fixed, stable signed graph transform held-out visual changes into nontrivial, reproducible bilateral DNa02 signals through the retained wiring?

The primary basis for choosing signed input is L1 hyperpolarization to brighter contrast and depolarization to darker contrast, with sign inversion downstream. Voltage and calcium cannot be equated with binary spikes. [Behnia et al., 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4243710/), [Yang et al., 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5606228/). GluClα and GABAergic pathways jointly contribute to ON processing; cell-specific loss does not reproduce whole-system GluClα loss. Thus neither a uniform source sign nor this effective recurrence constitutes a receptor-resolved explanation. [Molina-Obando et al., 2019](https://elifesciences.org/articles/49373).

Published bilateral DNa02 recordings motivate a right-minus-left steering readout. They relate biological firing rates to walking, not the proposed dimensionless state to angle. The sign convention, gain, smoothing and zero forward speed below are engineering choices. [Rayshubskiy et al., 2025, Figure 3](https://elifesciences.org/articles/102230). No flight/leg mechanics or target-following claim follows.

## Immutable graph and versioned transformation

Retain exact graph IDs, directed edge order, raw contact counts, transmitter-policy signs, annotation/mapping hashes and graph/manifest hashes from the current importer. No pruning, added edges, sign correction, contact replacement, trained readout, receptor inference or data-dependent parameter search. Keep the BANC prediction/verified-transmitter discrepancy visible; this candidate does not silently fix it.

For existing source `i` → target `j`, define:

- `D[j] = max(1, sum of raw incoming contact counts to j)`, including contacts whose source sign is unknown/zero.
- `P[j,i] += sign[i] * contacts[i,j] / D[j]`.
- Unknown signs contribute zero modeled coupling but remain in topology, counts, and denominator. Zero-indegree rows remain zero. Duplicate contacts, if supported by the locked format, retain their exact summation order.

This is **target incoming absolute-contact normalization**, not outgoing normalization or a spectral-radius estimate. Store only the original CSR arrays plus one denominator per target; calculate products in canonical source/edge order. Require each denominator's integer sum to be exactly representable and verify the resulting row absolute sums are ≤1 within a declared floating-point tolerance. The original graph hash does not identify this new effective operator: include normalization algorithm/version, denominator digest, sign-policy ID and full config in a distinct model digest.

## Fixed recurrence and input contract

All constants below are prospective engineering choices selected before experiments, not fitted physiological quantities:

`alpha = 1/8`, `rho = 3/4`, `inputScale = 1/4`, `adaptationBeta = 1/16`, Float64, simultaneous double-buffer updates, `dt = 1 ms` as a simulation convention.

For each retained neuron, `x` is a signed dimensionless deviation; initially `x=0`. It is neither membrane voltage, firing rate, calcium nor absolute release. For each of the existing 32×16 visual pixels, maintain contrast adaptation `b`, initially zero:

```
c[t,p] = (I[t,p] - 0.5) / 0.5
u[t,i] = -0.25 * A[i]·(c[t] - b[t])      for existing mapped L1 input IDs
u[t,i] = 0                               for every other neuron
x[t+1] = (7/8) * x[t] + (1/8) * tanh((3/4) * P*x[t] + u[t])
b[t+1,p] = (15/16) * b[t,p] + (1/16) * c[t,p]
```

Admit finite normalized luminance only in `[0.25,0.75]`; therefore `c∈[−0.5,0.5]`. Refuse other ranges rather than clipping or changing exposure. Fixed gray 0.5 is an explicit nonzero image reference, **not a neuronal baseline injection**. Retain the existing spatial projection as a nonnegative averaging operator A with row sum 1: MaleCNS uses the checked-in synthetic affine hex-to-pixel projection; BANC averages the 256 pixels in the annotated left/right half. Record A’s exact version/digest and use only mapping entries with type L1. Duplicate IDs reject; several distinct L1 cells may legitimately share a pixel. This preserves the coarse BANC limitation rather than inventing retinotopy. Preserve the explicit mapped/excluded list and field-of-view limitations. No L2 input is synthesized. Brightening produces negative L1 input; darkening produces positive input. Compute both updates from the old `x,b` and the same accepted frame.

A frame is held for 20 explicitly requested neural ticks; each frame ID/session receipt is monotonic. This choice and the adaptation time are not physiology fits. Unchanged imagery drives the contrast residual toward zero. Freeze all state on pause/disconnection/deadline; there is no wall-clock catch-up or hidden decay while paused. Invalid/missing frames pause before the next step. The fixed validation scheduler supplies every frame explicitly. This design does not attach a camera or start any existing individual.

The reference-subtracted state is an abstraction of response around an unspecified operating point. It does not add tonic, reward or compensating currents. Calling it actual disinhibitory conductance would be false: that requires receptor/reversal-potential and background-current evidence absent here.

## Stability and quiet-state argument

By construction `||P||∞≤1`. Since tanh is 1-Lipschitz, for identical inputs:

`||F(x,u)-F(y,u)||∞ ≤ (7/8 + (1/8)(3/4)) ||x-y||∞ = (31/32)||x-y||∞`.

Thus the neuron recurrence is contractive, independent of graph size, sign pattern or cycles. For `x∈[−1,1]`, the convex update remains in that interval; `b∈[−0.5,0.5]` remains bounded, so `|u|≤1/4`. Zero contrast, zero state and zero adaptation remain exactly quiet in real arithmetic. With input severed, `||x[t+k]||∞≤(31/32)^k ||x[t]||∞`.

For different adaptation histories receiving the same frame sequence, `δb` contracts by `15/16` and `δx_next≤(31/32)δx+(1/32)δb`. In the weighted norm `max(||δx||∞,2||δb||∞)`, the combined system contracts by at most `63/64`. For any permanently held image `c=C`, `(x=0,b=C)` is its unique fixed point: image novelty fades without tonic neural drive. This is asymptotic quiet, not finite-time exact zero; report residuals honestly. These are elementary induced-norm bounds, not a claim that spectral radius alone proves stability. Floating-point roundoff must be bounded/tested; it does not receive a biological interpretation.

No spontaneous oscillation, bistability, persistent attractor memory or self-sustained activity can survive after input becomes constant. That loss is deliberate and substantial. Normalization also removes absolute incoming contact scale, treats high- and low-contact target populations comparably, dilutes deep signals, and can erase biologically significant excitation/inhibition balance. Long paths attenuate; apparent zeros are plausible. This is not guaranteed to yield useful DNa02 activity.

## DNa02 output and lifecycle

Use exactly the two published DNa02 IDs per profile from `VISUAL_SOURCES`; missing IDs reject. Set `d=(xRight-xLeft)/2`. Proposed readout state: `z_next=(7/8)z+(1/8)d`, initially zero, then `yawProxy=0.25*z` rad/s, clamped to ±0.25 only as a boundary guard. `forwardSpeed=0`. No division by observed maxima, fitted gain, rate conversion, target angle or observer-camera feedback. Label values `signed state` and `engineered yaw proxy`.

Paused/unavailable control emits zero motor output immediately while retaining `x,b,z`; resumption is explicit. This readout's filter is stable and converges to zero when `x` does, but normalized state is not validated firing-rate evidence. A future body controller would need a separate grant, renderer, motor contract and measured performance review.

New checkpoints must include new model/config/operator/source digests, exact ordered IDs, tick, `x`, pixel `b`, `z`, latest frame ID/hash and paused lifecycle metadata. Restore must validate the entire bounded state before replacement and return paused with a fresh session. Existing LIF checkpoints reject rather than convert. Input/operator evolution is immutable; no learning state or adaptation to task success exists.

## Meaningful tiny-graph gates, predeclared

The separately approved tiny implementation enforces a maximum of 16 nodes / 32 edges per synthetic graph, at most 16 cases and 288 actual updates per case including any 32-step restore replay, fixed deterministic fixtures and a hard 5-second total deadline. No source graph loading. Include independently calculated dense-matrix or exact early-tick oracles so tests do not merely repeat the sparse loop.

1. Direction/normalization: unequal fan-in/fan-out graph with mixed signs, unknown signs, zero-indegree and a self-loop. Verify incoming normalization, retention of unknown contacts in denominators, immutable source arrays and sparse/dense agreement. Uniform multiplication of all incoming contacts to one target preserves that target's effective row; changing one edge changes its relative contribution.
2. Graph causality: known inhibitory L1→medulla→two-output chain, plus a disconnected component. ON input first makes L1 negative; the inhibitory first hop makes the target positive only on the next simultaneous update. A disconnected component stays exactly zero. No target changes before its directed path can deliver input.
3. Worst-case feedback: positive cycle and mixed-sign recurrent cycle, two far-apart initial states under the same fixed input. Check the derived one-step contraction bound and interval invariants, not only absence of NaN. No edge duplication or omitted inhibitory input may pass.
4. Operating point/quiet: gray from zero is identically quiet; ON and OFF residuals invert; a held image converges toward zero and is bounded by the combined-state contraction estimate. Severed input uses the stricter `31/32` bound. Do not assert an arbitrary tiny epsilon at 256 ticks when the conservative bound does not imply it.
5. Determinism/atomicity: checkpoint at tick128, continue32 ticks, restore and repeat the same32 (actual execution count includes both). Malformed config, foreign graph/model, invalid contrast or nonfinite state rejects atomically; stopped lifecycle cannot advance. Opposite input and initial x, b, z with the same fixed graph operator have opposite `x,z` within fixed Float64 tolerance because the recurrence is odd.

Concrete fixture edges (source,target,contacts): direction test `(0,1,2),(0,2,8),(1,2,4),(2,2,3),(3,2,5)`, signs `[−1,+1,−1,0,+1]`, node4 isolated; chain `(0,1,2),(1,2,3)`, signs `[−1,+1,+1,+1]`, node3 disconnected; positive cycle `(0,1,1),(1,0,1)` with signs `[+1,+1]`; mixed cycle same edges with signs `[−1,+1]`. Use zero initial state for causality/quiet, and opposing all±0.75 states for contraction. Dense reference construction must sum target rows independently from the sparse implementation. These gates catch transpose errors, hidden instantaneous paths, sign loss, normalization mistakes, unstable recurrence and contaminated restore; they make no claim about a full connectome's useful behavior.

## Held-out causal design and stopping decision

Reserve the following eight cases before implementation; do not use them to choose gains, adaptation or output scaling: gray control; left-half bright onset; right-half bright onset; left-half dark onset; symmetric whole-field bright onset; a fixed two-frame left-to-right vertical bar at half contrast; the identical bar with encoder severed; the identical bar with readout severed. Freeze this exact zero-based schedule now: ticks0–39 all pixels I=0.5; for half/whole-field cases ticks40–79 set the named region to I=0.75 (bright) or0.25 (dark), leaving all other pixels0.5; ticks80–255 return to gray. For the bar and its two disconnections, ticks40–59 set columns8–11 to0.625, ticks60–79 set columns12–15 to0.625, otherwise gray. Gray control never changes. All16rows use the same column pattern. Archive the resulting rasters and hashes before execution. Save at tick224, complete native ticks224–255, restore the saved state and repeat exactly those32ticks: final clock256, actual updates288.

For a later full-graph proposal, both profiles × eight cases × (256 forward ticks + 32 duplicate restore-continuation ticks) = **4,608 actual steps maximum**, one worker at a time, 120 seconds for the whole campaign and 2 GiB sampled RSS threshold, no retries or automatic extension. This is an upper-bound proposal, not run authorization. Every nonzero state can cause a full edge pass; earlier silent-LIF throughput does not predict its cost. A full edge pass at every update would mean 89,694,413,568 edge visits across this candidate campaign. Its feasibility inside120seconds is unestablished; require separately reviewed model-specific cost evidence before authorizing it. If it cannot fit, revise and version the protocol before any experiment instead of executing/retrying a doomed budget. Any incomplete campaign remains incomplete rather than becoming a smaller success subset.

Record global state norms, input residual norm, mapped-input and DNa02 signed traces, readout, canonical source hashes, actual edge visits, step/restore counts and resource limits. Predeclare a distinguishable-readout threshold `|z|≥1e−6` for at least 10 consecutive ticks, solely an engineering detection floor; retain subthreshold values too. Encoder-severed gray-start neural state must stay zero. Readout severing must leave the complete neural trace unchanged while yaw is exactly zero. Opposite contrast should invert signed traces; bilateral anatomy need not be perfectly symmetric, so exact mirrored full-graph equality is **not** an acceptance requirement. Gray remains quiet. Do not label any bar-following direction “correct” without a separate predeclared body task.

A nonzero output below that threshold is numerical response evidence only. A threshold-crossing, input-dependent result surviving controls establishes an engineered causal graph path, not natural vision, a learned policy or successful body control. Silence, cancellation, wrong-way responses or deadline failure are publishable negatives and stop this candidate; no posthoc gain, sign or baseline adjustment. Advancing to any closed-loop body test requires a fresh reviewed protocol, held-out behavioral goals and explicit authorization.

## Implemented boundary and verification

`server/signed-sparse.js` accepts only synthetic `tiny:` IDs, at most16nodes/32edges, fixed constants, ordered source edges and explicit pixel averaging rows. It imports no dataset loader and has no application, worker, provider or body integration. Its model ID is `tiny-signed-contract-v1`; the profile model IDs above remain prospective. Inputs and checkpoints are copied; operator/config digests include the exact graph, mapping, output indices and incoming denominators. No externally supplied hash is treated as source verification.

Each `acceptFrame` explicitly supplies a monotonic ID and a512-element luminance raster, retained for20 explicit `step` calls. Invalid frame or step calls pause output while preserving neural arrays, adaptation, readout state and counters. Invalid restores leave the entire state unchanged. `start` arms calls only; `pause` freezes state and makes the disclosed yaw proxy zero. The readout uses newly committed x[t+1]. Checkpoints preserve the held raster/hash, remaining ticks, accepted-frame count and frame ID, including mid-frame tick224. Restore validates before mutation, creates a fresh session and stays paused. Lifetime actual-update accounting survives restore and caps each instance at288 and pauses it; the restored simulation tick is also capped at288; callers cannot reset the execution budget using a checkpoint. There is no automatic scheduler or catch-up.

The tests instantiate16 tiny execution cases grouped into8 numerical tests plus one protocol-only test, with at most288 updates per instance and a shared5-second deadline. Positive/mixed feedback contraction, independently specified dense target rows, exact directed early responses, zero-gray invariance, fixed-operator ON/OFF symmetry, constant-image convergence, immutable input copies, malformed restore atomicity and exact mid-frame continuation are covered. Float64 comparison uses absolute additive1e-12; normalized row sums admit at most1e-12 excess from roundoff. In finite arithmetic this permits an additional3e-12/32 in the Lipschitz bound before arithmetic roundoff; tests compare with additive1e-12 rather than claiming exact real-arithmetic inequalities. This is numerical tolerance, not biological variability.

The frozen future protocol is `research/signed-sparse-future-protocol.json`, with `executionAllowed:false`. BANC half-image averaging gives identical input for columns8–11 and12–15; a dedicated test demonstrates equality, so that sequence cannot establish motion-direction sensitivity under this mapping. The future protocol is not run by these tests. No source graph was loaded, stimulated or checkpoint-converted.
