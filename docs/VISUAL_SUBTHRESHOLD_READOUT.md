# Trained external readout over real subthreshold connectome voltage

Frozen protocol: [`research/visual-subthreshold-readout-protocol.json`](../research/visual-subthreshold-readout-protocol.json), committed before any code was written or any trial run. Complete machine-readable campaign output: [`connectome/subthreshold-readout-result.json`](../connectome/subthreshold-readout-result.json).

This is new, additional work — it does not reopen or close #4. #4's claim (a spiking causal chain from the visual encoder through the real anatomical wiring to DNa02) remains a valid, disclosed negative: DNa02 receives zero signed contact from the visual onset volley and never fires under the binary LIF model. What this document tests is different: the kernel already tracks continuous subthreshold membrane potential for every neuron regardless of spiking, and that potential is known to vary with real visual input one hop downstream of the encoder (`docs/VISUAL_PROPAGATION.md`). This asks whether that subthreshold signal carries decodable left/right information a trained, honestly-labeled external readout could use — the same "trained readout" fallback PLAN.md already anticipated and PRD.md NR-4 already constrains.

## Method

For each of MaleCNS v1.0 and BANC v888, four bounded trials (25 kernel steps each, real pinned graph, real visual encoder): `unchanged-black`, `changed-left-half-onset`, `changed-right-half-onset`, `changed-whole-field-onset`. Each trial accepts a black baseline frame at tick 0 (establishing the encoder's difference baseline) and the condition's actual frame at tick 20, matching the cadence of the already-reviewed campaign in `server/visual-causal-trial.js`. The feature — `meanPotential(hop2TargetsOfRightSideInputPorts) − meanPotential(hop2TargetsOfLeftSideInputPorts)`, read from `kernel.inspect().potential` at the frozen tick 22 — is computed over the real, pinned CSR graph's actual outgoing contacts from the visual encoder's real input ports, split by their already-annotated `side` field. No new stimulus encoding, dataset, or dynamics model was introduced.

A single scale is fit from the two onset conditions only (`scale = 0.25 / max(|feature(left)|, |feature(right)|)`), producing bounded `yawRadiansPerSecond` for every condition. Neural weights are frozen throughout; this readout lives in its own module (`server/visual-subthreshold-readout.js`) sharing no state with any plasticity code.

**A predeclared control was dropped before execution, not after seeing results:** the original protocol specified a "side-label-swap" consistency check, but the feature's own formula (`right − left`) makes swapping the grouping labels algebraically equivalent to negation — a control guaranteed to pass by construction is not evidence. It was replaced with a stronger, real constraint: the black condition's feature must be *exactly* zero (not just small), since with no onset ever injected, no target's potential can move from its initial zero at all.

## Result — completed campaign, both profiles

All 8 trials completed in 4.30 seconds wall time (well inside the 60-second budget), peak sampled RSS 446 MiB (well inside the 1 GiB budget), using the real pinned MaleCNS (165,122 neurons / 25.6M edges) and BANC (155,858 neurons / 13.4M edges) graphs.

| Dataset | black | left-onset | right-onset | whole-field | separates | black exactly 0 | whole-field within ±0.01 rad/s |
|---|---:|---:|---:|---:|:---:|:---:|:---:|
| MaleCNS | 0 | 0.017678 | −0.019002 | −0.001324 | ✓ | ✓ | **✗** (yaw = −0.0174) |
| BANC | 0 | 0.006935 | −0.012351 | −0.005416 | ✓ | ✓ | **✗** (yaw = −0.1096) |

**This is a negative result on the predeclared threshold, on both profiles.** Left and right onsets produce a real, measurable, oppositely-signed separation — the black baseline is exactly zero as required — but the whole-field control, which stimulates both sides identically and should therefore cancel to near zero once scaled to a usable steering range, does not stay inside the predeclared band. For BANC especially, the whole-field yaw (−0.110) is *larger* than either onset's individual contribution once scaled, meaning the observed left/right split is substantially contaminated by a directionally-nonspecific "something changed" component at this tick, not a clean side-selective signal. The subthreshold voltage at hop 2 carries real information that a stimulus occurred, but not, at this specific tick and feature definition, information that reliably isolates *which side* it occurred on to the predeclared tolerance.

Per the frozen protocol's outcome rule, this negative result is complete and final for this feature/tick/threshold combination — no gain, tick, or band adjustment was made after seeing it. No live body-rendering integration was built, since there is nothing passing to wire up.

**Correction, 2026-09-16.** The parenthetical that stood here claimed no live neural-to-body wiring existed anywhere in this app, real or fixture. That was wrong about the fixture. `server/runtime.js`'s `bodyPose` is indeed an `UNSUPPORTED` null — the fixture's own checkpoint carries no pose — but the engineered pose lives in `server/environment-adapter.js`, which has driven `Scene.jsx`'s illustrated fly from the fixture's own spike rates since [`702587a`](https://github.com/atomantic/fly-garden/commit/702587a), well before this campaign ran. That wiring is recorded end to end in [ENVIRONMENT_ADAPTER.md](ENVIRONMENT_ADAPTER.md). It changes nothing about this document's result, which concerns the real connectome and never touched the fixture adapter: what would have been wired up is a *real-connectome* readout, and that is what does not exist.

## What would be needed to revisit this

A different tick, a different feature (e.g. integrating potential over a window rather than one instant, or normalizing per-target-count rather than raw mean), or accepting a wider band, could plausibly change this outcome — but per this project's own discipline, that is a *new*, separately reviewed and separately predeclared protocol, not a retroactive adjustment of this one. This document reports what was predeclared and what happened; it does not recommend a specific next attempt.

## Reproduction

```sh
node scripts/run-subthreshold-readout-campaign.js --run \
  --male-data /path/to/malecns/graph --banc-data /path/to/banc/graph
```

`node --test server/subthreshold-population.test.js server/subthreshold-readout-trial.test.js server/subthreshold-readout-campaign.test.js server/visual-subthreshold-readout.test.js` covers hop-2 topology resolution (disjoint groups, shared-target contribution to both means, absent-port/empty-group refusal), trial cadence and exact-tick reading against a tiny synthetic graph with known, hand-verified feature values, campaign worker discipline (one at a time, no retry, resource/deadline refusal before worker creation), and the fit/verdict logic's pass and fail paths independently of any real graph.
