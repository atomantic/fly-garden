# Benign landmark association v1: completed gate-closed evaluation

**Outcome: negative / gate-closed. No learning is claimed, and none may be claimed from this work.** The preregistered campaign in [protocol.json](../experiments/benign-learning-v1/protocol.json) was assigned 64 runs. Zero runs executed, because two of the protocol's own required gates are closed by evidence re-derived here from the pinned data. No neural step was advanced, no plasticity update was applied, no checkpoint was written and no trial score exists. This is a completed evaluation of the protocol's execution preconditions, not a completed behavioral experiment — and it is explicitly not a retained-learning result.

There are therefore **no seed scores and no bootstrap intervals to report**. The reason is stated in full below rather than replaced with a proxy measurement, a relaxed tolerance or a smaller subset of conditions.

## What was decided, and why

The campaign could not proceed under the existing engineered encoder hypothesis. Two paths were available:

- **(a)** revise the encoder hypothesis in `server/visual-mapping.js` under a new reviewed configuration; or
- **(b)** record the honest negative / incomplete evaluation.

**Path (b) was taken.** The decisive point is that the blocker is not a gain choice. Re-derivation shows the Male CNS failure is *amplitude-independent*: all 875 admitted onset ports have modeled source sign −1, so the first hop delivers no positive drive at any positive gain. Raising the onset amplitude changes how many input ports fire, never the sign of what they deliver. A new reviewed configuration would therefore have to change transmitter-policy signs or the threshold model itself — and [VISUAL_PROPAGATION.md](VISUAL_PROPAGATION.md) states that the existing diagnosis authorizes no sign flip and no gain tuning. Tuning until movement appeared would be exactly the failure mode this repository's ethos forbids. A separately reviewed dynamics proposal already exists as [SIGNED_SPARSE_CANDIDATE.md](SIGNED_SPARSE_CANDIDATE.md); it is a different protocol and is not run here.

## Gate 1 — `fixed-causal-motor-readout`: closed

Re-derived independently of the Node kernel that produced [visual-causal-result.json](../connectome/visual-causal-result.json), by reading the pinned CSR arrays with NumPy after verifying every locked byte count and SHA-256 ([`scripts/derive-learning-gates.py`](../scripts/derive-learning-gates.py), output in [gate-evidence.json](../experiments/benign-learning-v1/gate-evidence.json)). The recomputation reproduces the recorded campaign exactly.

| Quantity | Male CNS v1.0 | BANC v888 |
| --- | ---: | ---: |
| Neurons / directed edges | 165,122 / 25,563,197 | 155,858 / 13,366,670 |
| Admitted left-half onset ports | 875 | 716 |
| Aggregate delivered delta-V | 1,093.75 | 895 |
| Onset source signs (− / unknown / +) | 875 / 0 / 0 | 500 / 209 / 7 |
| Outgoing rows from those ports | 13,333 | 11,614 |
| First-hop eligible target voltage | −0.127 … 0 | −0.121 … 0.074 |
| Fraction of threshold reached | 0.0 | 0.074 |
| Direct signed contacts onto either DNa02 | 0 | 0 |
| Positive crossing possible at any positive gain | **no** | yes, but not reached |

A first positive threshold crossing from rest requires 1,000 net positive contacts at the fixed contact gain 0.001. Male CNS reaches 0% of threshold and cannot reach it at any positive amplitude under this sign policy. BANC peaks at 7.4%. Neither DNa02 receives a single direct signed contact from the selected volley. This matches the recorded 0/8 campaign (`downstreamResponseObserved: false`, `yawObserved: false` on every run) and confirms it is a property of the model, not an implementation mismatch.

## Gate 2 — `compartment-specific-plasticity-validation`: closed

The protocol admits plasticity on "validated compartment-matched existing KC→MBON edges only". Derived from the pinned annotations alone:

| Quantity | Male CNS v1.0 | BANC v888 |
| --- | ---: | ---: |
| Kenyon cells / MBONs retained | 4,064 / 97 | 4,447 / 104 |
| MBONs with a parsed compartment string | 97 | **0** |
| Kenyon cells with a resolved lobe | 4,062 | 4,088 |
| Existing KC→MBON edges in the pinned graph | 61,209 | 17,598 |
| Edges where the MBON compartment label exists | 61,209 | 0 |
| Edges that are *lobe*-consistent only | 57,878 | 0 |
| Per-synapse neuropil available | no | no |

Male CNS `instance` strings do carry the compartment label (for example `MBON01(y5B'2a)_R`). BANC annotations carry no mushroom-body compartment field at all — its MBON `cell_type` is just `MBON01`, and one entry is the ambiguous `MBON25,MBON34`. More importantly, Kenyon cells carry only a **lobe**-level subtype in both datasets, and neither pinned weights table has a per-synapse neuropil column (Male CNS: `body_pre, body_post, weight`; BANC: `pre, post, count, norm, post_count, pre_count`). A single KC axon passes through every compartment of its lobe, so lobe consistency cannot be upgraded to compartment identity from these files.

**The compartment match cannot be established from the pinned annotations.** Lobe consistency is the strongest relation derivable and is strictly coarser than the protocol requires. No mapping was invented to close the gap, and no external literature table was silently imported as if it were dataset evidence.

## Gate 3 — `reviewed-bound-manifest-and-explicit-start`: closed as a consequence

[mapping-manifest.json](../experiments/benign-learning-v1/mapping-manifest.json) freezes everything that *is* resolvable — arena and quiet-area geometry, contact radius and contact rule, motion and luminance bounds, ring/bar dimensions, the fixed readout coefficients, and the training / held-out / retention variant lists — and records `causalMotorReadout: null` and `compartmentMatchedEdges: null` with explicit reasons. Its digest is `2b21bfb9253f6c8839238c3c2c43f23846076bf7c8438561205a3c44d1082154`, recorded in `protocol.json` as `incompleteMappingManifestSha256`. **`mappingManifestSha256` remains `null`**: only a manifest with every section resolved is promotable, and promoting an incomplete one would falsely signal that the gate opened.

## The campaign that did not run

`node scripts/run-benign-learning-campaign.js --run --protocol … --gate-evidence …` was invoked explicitly. It built the complete assigned-run table first, then refused at the gate preflight and exited 2. The full record is [result.json](../experiments/benign-learning-v1/result.json).

- Protocol artifact SHA-256: `80ea544b12412a28273d2256dca7218bfb85d50fe649878fa589cff43764cbd8`
- Assigned runs: **64** (2 datasets × 4 conditions × 8 seeds), every one reported with `status: "not-run"`. None was quietly excluded.
- Executed runs: **0**. Executed neural steps: **0**. Checkpoints written: **0**. Gate events: **0**.
- Closed gates: `fixed-causal-motor-readout`, `compartment-specific-plasticity-validation`, `reviewed-bound-manifest-and-explicit-start`.
- Open gates: `exact-per-neuron-sensory-mapping`, `complete-plasticity-world-rng-checkpoint`, `isolated-experiment-catalog-and-capacity`.

Every run's five named stream seeds are derived and recorded anyway, so a future authorized execution reproduces exactly the same assignment. Runtime: Node v26.0.0 on Darwin arm64; the derivation used Python 3.14.7 with the pinned PyArrow 25.0.1 / NumPy 2.3.3 acquisition environment.

## What was built and validated anyway

The machinery the protocol requires is implemented and tested on small explicitly synthetic fixtures. Passing these tests establishes bounded software behavior only — not learning, not biological plasticity and not a body loop.

- [`server/benign-plasticity.js`](../server/benign-plasticity.js) implements exactly the declared rule: traces decaying by `exp(-dt/100)` clamped to `[0,1]`, `gain = clip(gain - 0.01 * gate * preTrace * postTrace * dtSeconds, 0.8, 1.2)`, immutable baseline signs and topology, zero baseline weights staying zero, no gain update during any evaluation phase, and the effective weight published one tick late. It **refuses to construct** unless it is handed a compartment-validated edge set and an exact manifest digest, so the closed gate cannot be bypassed by passing a convenient edge list.
- [`server/external-readout-learner.js`](../server/external-readout-learner.js) implements the competing two-channel external readout rule in its own module, importing nothing from the plasticity module and sharing no state with it. The reporting separation between neural plasticity and external readout training is structural, not editorial. Its success could never establish localized neural learning.
- The sparse-LIF checkpoint contract now carries plasticity gains, eligibility traces, world/layout phase, body pose and RNG state under schema version 2, with exact-digest restore equivalence over 30 continuation steps. A checkpoint with no retained extension state is byte-identical to the original schema version 1 record, so **every existing checkpoint stays loadable**; restoring a legacy checkpoint explicitly clears the extension block, and malformed or non-finite extension blocks reject atomically.
- [`server/benign-learning-analysis.js`](../server/benign-learning-analysis.js) implements the paired block bootstrap (10,000 resamples, two-sided 98.75%, Bonferroni over four contrasts, minimum effect 0.15, `poolDatasets: false`) and returns `incomplete` for a missing seed rather than dropping or imputing it.
- [`server/benign-learning-campaign.js`](../server/benign-learning-campaign.js) never starts automatically, requires an explicit run request, evaluates all six gates before anything else, and — when gates are open — enforces the per-run step and wall-clock budgets, the three-checkpoint and 1 GiB ceilings, the exact restore contract and zero retries, marking any violation incomplete without retrying.

## Interpretation and limits

No contact, no choice and no effect are all valid observed outcomes under this protocol; so is a closed gate. What this evaluation establishes is narrow and negative: **under the frozen engineered encoder, transmitter-sign policy and LIF threshold model, the pinned Male CNS and BANC graphs produce no downstream motor response to the preregistered visual onset, and the pinned annotations cannot establish the compartment-matched KC→MBON edge set that the plasticity candidate is restricted to.** Issue #6's behavioral acceptance criteria are consequently unreachable under protocol v1 without a new, separately reviewed protocol version.

This says nothing about whether these animals learn, whether the connectomes are correct, or whether a different dynamics model would propagate. It is a result about an engineered model's operating point and about the resolution of the pinned metadata. Changing a rule now to make the gate open would require a new protocol version, reviewed before results are observed — not an edit to this one.

## Reproduction

Both commands read only already-verified local files. The derivation advances nothing; the campaign command is an explicit experiment request that, with the current evidence, refuses at the gate.

```sh
python scripts/derive-learning-gates.py \
  --male-graph /verified/male/graph --banc-graph /verified/banc/graph \
  --male-annotations /verified/male/annotations.feather \
  --banc-annotations /verified/banc/annotations.feather \
  > experiments/benign-learning-v1/gate-evidence.json

node scripts/run-benign-learning-campaign.js --run \
  --protocol experiments/benign-learning-v1/protocol.json \
  --gate-evidence experiments/benign-learning-v1/gate-evidence.json \
  --manifest-out experiments/benign-learning-v1/mapping-manifest.json \
  --out experiments/benign-learning-v1/result.json

node --test server/benign-learning.test.js server/benign-learning-protocol.test.js
```

Use an existing PyArrow/NumPy environment; the derivation installs nothing and downloads nothing. Dataset annotations retain their CC-BY-4.0 provenance in the repository lockfiles: [Male CNS](https://male-cns.janelia.org/download/) and [BANC](https://doi.org/10.7910/DVN/7WTH1N). Mushroom-body compartment structure and the differentiated effects of dopaminergic types motivate the compartment restriction that this evaluation could not satisfy: [Aso et al., 2014](https://elifesciences.org/articles/04580), [Aso and Rubin, 2016](https://elifesciences.org/articles/16135). No dataset, checkpoint or large binary is committed by this work.
