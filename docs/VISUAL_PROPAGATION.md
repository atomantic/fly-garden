# Static diagnosis of the visual causal result

The fixed campaign's lack of downstream spikes agrees with the implemented model. This analysis executes **zero neural steps** and changes neither gains nor the immutable [campaign report](../connectome/visual-causal-result.json). The [reproducible ledger](../connectome/visual-propagation-ledger.json) identifies graph, annotation, mapping and campaign hashes. Issue #4 remains incomplete: no effective full-connectome visual body loop is demonstrated.

## Exact recurrence and evidence

At tick 21 the left L1 onset fires 875 MaleCNS or 716 BANC input cells. At tick 22 each outgoing contact contributes `sourceSign × rawContactCount × 0.001`. There is no row, fan-in or fan-out normalization. Just-fired inputs are refractory, so their incoming values are suppressed. Threshold is 1; reset is 0; refractory duration is two ticks; synaptic delay is one tick. Subsequent zero-input, zero-spike values are `V(22) × exp(-(tick-22)/20)`.

| Profile | Source signs (-1 / 0 / +1) | Outgoing rows | Contacts | Global voltage at tick 22 |
|---|---|---:|---:|---|
| MaleCNS | 875 / 0 / 0 | 13,333 | 272,233 | -0.127 to 0 |
| BANC | 500 / 209 / 7 | 11,614 | 134,906 | -0.121 to 0.074 |

Male minimum is `male-cns:v1.0/52186` (-127 signed contacts); all nonzero eligible targets are negative. BANC minimum is `banc:v888/720575941575662843` (-121), maximum `banc:v888/720575941689813260` (+74). Both profiles' exact DNa02 pairs receive zero direct signed contacts from the selected input volley. Full motor IDs are in the ledger. Every recorded row from tick 22, including both continuation branches, agrees with the recurrence within absolute tolerance 1e-12. Binary output spikes do not become stronger when the external onset amplitude is raised above threshold.

A first positive threshold crossing from rest requires at least 1000 net positive contacts under this model. The Male first-hop volley cannot cross a positive threshold at any positive contact gain because all selected sources have negative signs. BANC reaches only 7.4% of threshold. This explains the measured outcome without a numerical implementation mismatch. It does not establish an appropriate biological operating point.

## Source-policy limits and next decision

Read-only annotation inspection found all selected Male sources have consensus glutamate. BANC selected-source predictions were glutamate 481, GABA 19, histamine 147, serotonin 23, acetylcholine 7 and null 39; all 716 verified-transmitter entries were glutamate. The pinned importer deliberately uses predictions, not verified entries. That discrepancy is a model policy limitation, not evidence that changing signs would validate behavior. Replacing predictions with verified glutamate under the existing sign convention would remove the positive tail.

Uniform transmitter signs, binary spikes, zero resting drive and a positive L1 onset are engineered assumptions. Primary experimental work describes multisynaptic glutamatergic and GABAergic contributions to ON selectivity; it does not justify declaring these measured cells uniformly excitatory or supplying missing receptor/operating-point parameters. [Molina-Obando et al., eLife 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6845231/).

The next model proposal must explicitly choose whether to retain this negative baseline or introduce a separately versioned, source-grounded operating-point/graded-signal hypothesis. It must specify signs, baseline and transfer function before testing, distinguish engineering assumptions from measurements, and preserve the current checkpoint/model identity. No sign flip, tonic drive, gain tuning or further experiment is authorized by this diagnosis.

## Reproduction

Run `node scripts/analyze-visual-propagation.js --male-data /verified/male/graph --banc-data /verified/banc/graph` under Node 26. It reads and hash-verifies existing local graph arrays, performs static integer contact sums, and checks the saved trace; it never constructs a runtime, stimulates neurons or downloads data. Output contains no local paths. Source arrays and provenance remain governed by the two model cards; this original analysis code is MIT. Tiny analytical tests cover signed raw contacts, refractory self-input exclusion and exponential decay.
