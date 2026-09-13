# Named-baseline weight differences

This is the fourth inspection layer required by FR-14, delivered under [issue #3](https://github.com/atomantic/fly-garden/issues/3). It adds no plasticity, no learning and no evaluation. It exists so that "no weight has changed" is a statement the runtime makes, in numbers, against a baseline with a name and a digest — rather than something a viewer is left to infer from an unchanged picture.

## What a weight is in this project

The sparse-LIF kernel holds no per-edge weight array. An effective weight is derived at each step as `anatomicalContacts × engineeredSign × contactGain`, with `contactGain = 0.001`. Contacts are measured; the sign mapping and the gain are engineered by this project. The only thing that could ever make an effective weight differ from that product is a retained plasticity gain block, carried in a schema-2 checkpoint extension under `plasticityGains`.

`createBenignPlasticity` refuses to construct without a compartment-validated edge set, and [that gate is closed by the pinned annotations](BENIGN_LEARNING_RESULT.md), so at this revision no plasticity instance can legally exist. This layer is therefore expected to report a zero difference. Reporting it is the point: an absent layer and a measured zero look identical to a reader, and only one of them is honest.

## What the runtime now publishes

`createSparseLif` gains `retainedWeightState()`:

```json
{ "checkpointSchemaVersion": 1, "extensionsSha256": null,
  "weightBasis": "anatomicalContacts * engineeredSign * engineeredContactGain",
  "contactGain": 0.001, "plasticity": null }
```

It is a summary, never a copy: no gain, trace or neural array leaves the kernel through it. When an extension block is present, `plasticity` carries the rule id, the mapping manifest digest, the update and gated-update counts and the plastic edge count. An extension block whose gain record is unreadable is reported as present and `unknown`, never as absent.

`server/connectome-worker.js` publishes it in the session snapshot and `server/connectome-registry.js` in `publicState`, so an individual with no resident worker reports `null` rather than a default.

## Named baselines

`client/src/weight-baseline.js` offers two kinds, each carrying its own digest:

- **The pinned graph manifest** — `manifestSha256` from the worker's own provenance. Always available while a worker is resident.
- **A durable checkpoint** — any entry in the individual's checkpoint history, named by id, tick and `sha256`.

A checkpoint baseline is trustworthy for this purpose because of a store invariant, not an assumption: `server/connectome-store.js` accepts only `schemaVersion: 1` payloads whose `graphSha256` equals the verified profile descriptor. A durable checkpoint therefore carries neither a retained gain block nor a foreign graph. `server/weight-baseline.test.js` asserts that refusal directly rather than restating it.

## Outcomes

`weightDifferenceLayer()` returns exactly one of four outcomes, each with a stated reason:

| Outcome | Meaning |
| --- | --- |
| `compared` | The worker and the named baseline both derive every weight from the same structural product with no retained gain block, so every listed difference is exactly 0. |
| `unreported` | The runtime does not publish `retainedWeightState`. Nothing is compared, and no absence of change is claimed on its behalf. |
| `unattributable` | A retained gain block exists, but this view cannot attribute gains to individual anatomical edges without the mapping manifest that defines the plastic edge set. No per-edge difference is shown — not a zero one. |
| `refused` | No named baseline, no resident worker, malformed connection data, or anatomy and runtime disagreeing about the engineered mapping. |

That last refusal is a real cross-check: the layer recomputes `contacts × sign × the worker's own contactGain` and compares it to the `engineeredWeight` the atlas served. If the two disagree, the whole comparison stops rather than displaying a difference that is really a configuration mismatch.

## Honest limits

- **This compares declared state, not stored bytes.** The zero follows from the graph digest matching and neither side holding a gain block. It is not a re-read of the baseline checkpoint's arrays, and the displayed reason says so.
- **A zero difference is not a negative learning result.** Nothing was trained, and nothing failed to train. The evaluated negative results are recorded separately in [BENIGN_LEARNING_RESULT.md](BENIGN_LEARNING_RESULT.md) and [VISUAL_CAUSAL_VALIDATION.md](VISUAL_CAUSAL_VALIDATION.md).
- **The extent is a sample.** Differences are reported for the connections currently listed for the selected cell, and the panel states how many of the cell's matching connections that is. It is not a whole-graph weight audit.
- **The `unattributable` branch is unreachable at this revision**, because the plasticity gate is closed. It is implemented and tested so that a future gain block produces an honest refusal to attribute rather than a silent zero.
- No part of this layer loads, starts, advances, stimulates or checkpoints a worker. It reads runtime metadata and checkpoint history over the existing read-only routes.

## Where it appears

**Nervous system** → select a cell → *Weight difference against a named baseline*, beside the instantaneous sample and the adjacency table, under one legend that names all four layers and what each is not. A difference is always a number in a table; no layer is expressed by changing how the graph is drawn.

## Validation

`node --test server/weight-baseline.test.js` covers the kernel summary and its no-copy contract, worker and registry propagation, the store's refusal of schema-2 and foreign-graph checkpoints, baseline naming and digests, the explicit zero with its extent, and each refusal path. These are small numerical fixtures and pure UI-boundary tests; no full graph was loaded or advanced.
