# Atlas activity modes

The Nervous system view separates measured anatomy from modeled activity and never merges them into one
number or one colour. This document is the contract for that separation. Nothing described here loads,
starts, advances, steps, restores or stimulates a neural worker, acquires a controller lease, moves the
garden camera, spends provider budget or issues any outward action. Anatomy only, recorded replay,
synthetic fixture and stale are all reachable while no neural backend is running at all; the live mode
says plainly that it needs a resident individual rather than substituting anything.

## The five modes

The mode is chosen explicitly in a native radio group. Choosing one reads nothing by itself: the panel
eyebrow and status line name the mode of the values **actually on screen**, so they stay anatomy only
until a read succeeds, and the chosen mode's own claim is shown next to the radio group.
`client/src/atlas-activity.js` owns the descriptors and the transitions; it holds no fetch, timer,
renderer or runtime authority.

| Mode | Eyebrow | What a mark means | What it does not mean |
| --- | --- | --- | --- |
| `anatomy` | `ANATOMY ONLY / PINNED DATASET` | Nothing is marked. Only pinned measured positions are drawn. | Not an assertion that the modeled network is idle. |
| `live` | `BOUNDED SAMPLE / RESIDENT WORKER` | One instantaneous modeled potential and pending one-step firing flag per sampled cell, read once from a resident worker on this exact graph. | Not a firing rate, not measured biology, not a whole-network activity view, not learning or welfare evidence. |
| `replay` | `RECORDED REPLAY / INERT DATA` | One stored observation of an inert manual recording made from this exact dataset and graph manifest. | Not a live individual, not a restore, and not a complete event stream. |
| `fixture` | `SYNTHETIC FIXTURE / NOT ANATOMY` | Nothing is marked, by construction. | The garden's synthetic 32-neuron fixture shares no identity or coordinate frame with these datasets and is never anatomical evidence. |
| `stale` | `STALE / SUPERSEDED VALUES` | Nothing is marked. The previously read values remain only as labelled superseded text, alongside the mode they were read in. | Not current state, and not a reason to keep the last picture on screen. |

Mode descriptors are checked for distinct eyebrows, labels and claims in `server/atlas-activity.test.js`,
so two modes cannot quietly collapse into the same visible state.

## Why the overlay is a bounded sample, and what that costs

`MAX_NEURON_SAMPLE` in `server/sparse-lif.js` caps one kernel sample at 256 exact namespaced IDs, and a
recording fixes the same bounded selection at start. There is therefore no supported way to read modeled
state for all 140,024 positioned MaleCNS cells, and the atlas does not pretend otherwise:
`MAX_ATLAS_ACTIVITY_CELLS` is asserted equal to the kernel cap rather than chosen independently.

A live request selects cells by walking exactly the cells currently drawn — valid position **and** visible
display group — at a fractional step of `drawn / min(drawn, 256)`, and always includes the selected cell so
that picking and sampling agree. The step is fractional deliberately: an integer stride would halve coverage
just past the cap (257 drawn cells would request 129, not 256) while still claiming "at most 256". The
report prints the drawn total, the requested total and the spacing, so the coverage fraction is visible
rather than implied.

**Unsampled cells carry no mark at all.** Absence of a sample is absence of data, never a reported zero
firing, and the searchable table prints `Not sampled` rather than a value. A cell whose display group is
hidden loses its mark with the group. A recorded ID this atlas does not carry, or carries without a valid
position, is counted as unmatched or unpositioned and is never matched to a neighbouring cell.

## Counts are separate, never merged

The anatomical line (retained / positioned / missing / displayed) and the sample line
(sampled / matched / not present in this atlas / markable / firing flag set) are rendered separately and
neither replaces the other. Potentials are dimensionless engineered model values and are labelled as such
next to the atlas coordinate units, which are micrometers.

## Matching, and refusing to match

A live read goes through the same contracts as the single-cell inspector in `docs/CONNECTOME_SAMPLES.md`:

1. `matchingSampleResident` requires a resident worker with this exact individual, dataset, graph SHA-256
   and atlas graph-manifest SHA-256.
2. `readNeuronSamples` requires the reply to carry this worker session's epoch, model and graph, an
   instantaneous zero-width time window, and the exact requested IDs in the requested order. The
   single-cell inspector is now literally the one-ID case of this validator.
3. `confirmNeuronSample` re-reads the worker afterwards. If the session epoch, graph or command sequence
   moved, the values are published as `stale` rather than as current state.

A replay read additionally requires the recording's `source.dataset` and `source.graphManifestSha256` to
equal this atlas profile's own. A recording from another specimen or another graph is refused with a
message naming why; it is never reinterpreted against these coordinates.

An overlay is tagged with the anatomy it was read against — profile, dataset and graph manifest — and is
displayed only while that scope is current. A worker-sourced overlay additionally belongs to exactly one
individual: selecting a different individual, or none, drops it outright. A recording names its own
historical individual instead, which is why replay stays reachable while no neural backend is running.
Changing anatomy or the selected individual retires **and aborts** every in-flight request, so old activity
can never end up attached to new anatomy. This is exercised in `server/atlas-activity.test.js`.

## Accessibility

The canvas marks use two redundant channels, colour **and** point size: a larger amber point is a sampled
cell whose pending one-step firing flag is set, a smaller blue point is a sampled cell whose flag is
clear. Neither channel is the only carrier of the information. Every sampled value is also printed as
text in the sample report table and in a `Sampled activity` column of the searchable cell table, both of
which stay available when WebGL is unavailable or its drawing context is lost. The canvas `aria-label`
states when marks are present. Mode choice is a native radio group and every control is a native button
or input, so keyboard access needs no custom key handling.

## Not yet measured

Interaction latency and browser peak memory with the overlay enabled, and edge-enabled redraw throughput,
have not been measured on real GPU hardware; `docs/ATLAS_DISPLAY_EVIDENCE.md` records what has. Sampled
activity has not been exercised against a loaded full-connectome worker in a browser, because that
requires an explicitly created and loaded individual. The contracts above are unit-tested, which is not
the same as an integrated run, and this document does not claim that gate passed.
