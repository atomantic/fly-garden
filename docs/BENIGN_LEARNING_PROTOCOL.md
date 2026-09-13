# Benign landmark association: gated protocol v1

This is a versioned pre-execution design for issue #6, not an executed experiment or a claim of retained learning. The evaluation against this design has since been carried out and closed negatively: see [BENIGN_LEARNING_RESULT.md](BENIGN_LEARNING_RESULT.md). Nothing in the preregistration below was rewritten after that outcome. The machine-readable [protocol](../experiments/benign-learning-v1/protocol.json) intentionally has `executionAllowed: false`. No runner, stimulation, neural advancement or training is introduced here. Freeze a reviewed successor manifest binding all unresolved mappings before an explicit experiment start; changing a rule after observing results requires a new protocol version.

## Question and conditions

Can a stated, localized plasticity assumption improve voluntary contact with a previously paired landmark category, relative to frozen and shuffled controls, with the effect retained across exact checkpoint restoration? This tests an engineered cue-association model. It does not establish biological place learning, subjective reward or experience.

Each dataset receives eight matched world-seed contexts and four conditions: localized paired plasticity; frozen neural weights and fixed readout; localized plasticity with balanced shuffled cue assignments; and frozen neural weights with an external readout trained separately. All four start from the same dataset-specific initial checkpoint per context. Every experimental branch gets its own individual ID and records its exact parent checkpoint digest; none replaces a resident user's identity. Seeds are engineering replications, not independent biological animals. Analyze Male CNS and BANC separately, without a sex-effect inference.

The target category is counterbalanced by seed parity. A candidate scene contains a ring and a bar, constant baseline support, and a quiet area. Layout changes move landmarks only at declared trial boundaries; they never reset neural state or teleport the body. The eventual mapping manifest must specify scene dimensions, contact geometry, motion bounds, ring/bar dimensions, luminance bounds, fixed readout coefficients and exact training/held-out variant lists. These remain unresolved because no causal input/output adapter is validated. They must be fixed before execution, not chosen using evaluation outcomes. Held-out trials use previously unseen layouts and render variants of the same category; transfer to a genuinely new category is a separate future question.

Training has at most one 50 ms nonnegative scalar learning gate per trial, conditional on voluntary contact; no contact is a valid outcome. Baseline support never depends on performance. No neural dopamine injection is implied. Frozen controls face the same cue opportunities; realized contact and gate exposure must be reported rather than assumed identical. Shuffled assignment uses eight target-A and eight target-B training trials in a seed-derived permutation, breaking a consistent category association. The external-readout condition uses the same opportunities and the separate bounded rule below.

The global gate refractory period crosses trial boundaries: suppress an otherwise eligible contact until 1,950 ms have elapsed since the previous pulse ended, and truncate a pulse at the training boundary. Never queue or replay suppressed rewards. Candidate neural traces start at zero, decay by `exp(-dtMs / 100)` each tick, then add the binary spike indicator and clamp to `[0, 1]`. Update existing edge gains after that tick's spikes using the JSON rule; apply the resulting effective weight only on the next tick. Zero baseline weights remain zero. Traces and gains stop updating during all evaluation phases and must be checkpointed exactly.

For the external-readout control, preregister a two-channel multiplicative gain on the same fixed left/right motor readout, initialized to one and constrained to `[0.8, 1.2]`. On each permitted gate tick, update each channel by `gain += 0.01 * gate * clamp(abs(baseChannel), 0, 1) * dtSeconds`, then clamp. Neural weights remain frozen. This is an explicitly engineered competing explanation, with no claim that the chosen sign or rule is biologically realistic. Its fixed base readout and units still require the same causal mapping gate as every condition. Report external gain changes and behavior separately; its success cannot establish localized neural learning.

## Budget, retention and interpretation

The JSON fixes 64 runs, one worker at a time, and at most 116,000 one-millisecond steps per run including the restored branch: 7,424,000 total. The two retention branches share their preceding history, not a mutable live worker. Each run stops at five wall-clock minutes; the entire campaign stops at six hours or 1 GiB of experimental checkpoint storage, whichever limit arrives first. There are no automatic retries, enlarged budgets or automatic deletion of evidence. Exhausting capacity produces an incomplete evaluation, not a reason to shorten or omit unfavorable trials.

Save at most three checkpoints per run: initial, post-training and pre-retention. The final checkpoint includes plasticity gains/traces, neural state, fixed controller configuration, pose, world phase and RNG state. Native and restored retention must begin with equal digests and yield exactly equal deterministic event, motor and choice sequences; restore boots paused and requires an explicit start. Current checkpoint support must be extended and validated before claiming this contract for plasticity/world state.

The primary trial score is +1 target first contact, -1 foil first contact, and zero for no contact or simultaneous contact. Negative numbers exist only in analysis and never feed an aversive signal. Compare the seed-paired retention-minus-baseline change against both frozen and shuffled controls. The JSON requires an effect of at least 0.15 and a positive lower bound for each two-sided 98.75% percentile paired bootstrap interval (10,000 resamples, resample the eight matched seed indices as blocks). Four contrasts across two datasets receive a Bonferroni family-wise 0.05 allocation. Report all individual seed scores and intervals; eight contexts offer limited precision. Immediate held-out scores and external-readout results are descriptive secondary outcomes.

No choice, no effect, worse performance or changed weights without improved held-out behavior are valid negative results. A completed negative evaluation can satisfy the evaluation deliverable while prohibiting a learning claim. Faults, missing trials, retention mismatch or budget termination make the evaluation incomplete; report all assigned runs and reasons. Never quietly exclude a seed. No experiment has been performed by this change.

## Annotation evidence and unresolved mappings

The checked-in [inventory](../experiments/benign-learning-v1/annotation-inventory.json) comes from pinned local annotation Feather files, read with the existing PyArrow environment. The original inspection script verifies their lockfile byte counts and SHA-256 before reading selected metadata columns. It neither loads synaptic weights nor advances a model. IDs remain decimal strings with their source namespace; BANC v888 IDs are checked against `root_888`.

| Candidate annotation query | Male CNS v1.0 | BANC v888 |
| --- | ---: | ---: |
| Retained neurons | 165,122 | 155,858 |
| Kenyon-cell class | 4,064 | 4,447 |
| Mushroom-body output class | 97 | 104 |
| PAM type prefix | 316 | 279 |
| Visual / photoreceptor class | 4,107 | 1,842 |
| Descending class query | 1,314 | 1,318 |
| Motor superclass query | 815 | 805 |

These are candidate queries, not interchangeable biological categories or finalized adapters. In Male CNS, 4,078 of 4,107 visual-class cells lack `somaSide`, and none has a complete pair of assigned optic-lobe hex coordinates. BANC photoreceptor labels are asymmetric (1,597 right, 245 left), and the source schema lacks equivalent retinotopy fields. BANC's PAM subclass count is 278 rather than the 279 type-prefix matches; its descending superclass is also distinct from the class query. Ambiguous labels must remain unresolved. Never map camera bins or left/right steering by row order, numeric ID, count balancing, transmitter prediction or convenient class membership.

Execution requires an immutable manifest of exact sensory IDs and geometry, a causal fixed motor readout, and verified compartment-matched existing KC→MBON edges. It must preserve source ID namespace and graph/annotation hashes, record excluded ambiguous labels, and state assumptions per dataset. The candidate gain-depression rule in JSON is an engineered hypothesis with immutable baseline topology/signs and bounded gains, not an inference of biological plasticity signs. Its trace definition and compartment specificity require validation before enabling it. Missing mapping or causal support means the gate stays closed.

## Primary-source basis

MBON cell types and compartment structure motivate a localized candidate investigation, rather than treating all mushroom-body output as a single action channel. [Aso et al., 2014](https://elifesciences.org/articles/04580). Dopaminergic neuron types and stimulus timing have differentiated memory effects, so a PAM label alone cannot license a generic reward drive. [Aso and Rubin, 2016](https://elifesciences.org/articles/16135). Anatomical visual pathways to mushroom bodies motivate further mapping work but do not provide a validated retinal adapter for these selected graphs. [Vogt et al., 2016](https://elifesciences.org/articles/14009).

Dataset annotations retain their own attribution and CC-BY-4.0 provenance: [Male CNS download release](https://male-cns.janelia.org/download/) and [BANC deposit](https://doi.org/10.7910/DVN/7WTH1N). See the repository lockfiles and dataset model cards for exact releases. No third-party implementation or experimental aversive procedure is copied.

## Required eventual result record

Each trial record must include protocol and mapping digests; dataset namespace and graph/annotation hashes; individual and parent checkpoint IDs/digests; condition, seed index and named stream seeds; phase/trial; exact start/end neural tick; world/layout/cue variant; first-contact category/time or explicit no-contact; gate events; fixed readout digest; mutable gain digest; numerical/policy faults; wall time; and checkpoint lineage. Save source versions, hardware/runtime evidence and the complete assigned-run table. Keep camera/neuron mapping assumptions visible in every result summary. Do not put credentials, private paths, caretaker chat or unrelated identity history into research artifacts.
