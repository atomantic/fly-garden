# Bounded instantaneous connectome samples

This foundation provides read-only inspection of **1–256 exact namespaced neuron IDs** from one explicitly loaded research worker. The atlas cell inspector offers an explicit one-neuron read through the scoped HTTP route below; the canvas remains anatomical, with no activity overlay. It never loads a worker, starts a clock, advances a tick, sends a probe, changes inputs or saves a checkpoint. Unavailable workers and unknown IDs reject the entire request; missing values are not replaced with zeros.

## API and source scope

- Kernel: `kernel.sample(neuronIds)`.
- Session dispatch: `{action:'sample', value:neuronIds, sessionEpoch}`.
- Worker backend: `backend.sample(neuronIds)` uses its current worker epoch.
- Registry: `registry.sample(individualId, envelope)` returns a promise. The exact envelope is `{protocolVersion:1, individualId, dataset, graphSha256, sessionEpoch, neuronIds}`. The ID, dataset, graph and epoch must match the loaded recipient when the queued read executes.

IDs are strings such as `male-cns:v1.0/9007199254740993` or `banc:v888/9007199254740993`, never floating-point neuron numbers. Each ID is at most 128 characters. Empty, duplicate, foreign-namespace, malformed, oversized and partially unknown selections reject. Returned entries preserve request order.

A sample includes `protocolVersion:1`, `kind:'connectome-neuron-sample'`, `source:'connectome'`, `individualId`, `dataset`, `graphSha256`, `modelId`, `tick` and `simTimeMs`. The worker adds `sessionEpoch`, `status` and its source `provenance` (null if unavailable to an explicitly constructed numerical test session). The registry adds the current `commandSequence` without consuming it and preserves the registry's `resting` status.

`timeWindow` is `{kind:'instantaneous', startTick, endTick, startSimTimeMs, endSimTimeMs}`. Both endpoints equal the sample's committed tick/time: no interval history or firing-rate estimate is implied. `samples` contains only `{neuronId, potential, firing, refractoryStepsRemaining}` entries:

- `potential`: instantaneous dimensionless modeled membrane potential; firing neurons have already reset under this kernel's update ordering.
- `firing`: 0 or 1, the committed firing flag pending transmission on the next one-millisecond step. At tick zero it can reflect an explicitly requested numerical probe in research tests/tools; sampling never creates one.
- `refractoryStepsRemaining`: the current nonnegative refractory countdown. Newly firing neurons carry two full refractory steps under the present model.

These are engineered model variables, not measured firing rates, biological validation, learned behavior, subjective experience, welfare metrics or body-control evidence. A zero is returned only for an actual selected neuron's zero state.

## Ordering, bounds and failure

Registry reads share the individual's mutation queue. A read queued after an advance sees its completed tick. A read carrying the prior epoch queued after restore is rejected, even if its request arrived before the restore completed. Request IDs are copied after bounded schema validation so caller mutation cannot change a queued selection. Reads do not invalidate prepared checkpoint restore tokens or consume mutation sequences. A spontaneous worker exit invalidates pending sample publication.

Shape validation precedes lookup, and all IDs must resolve before output allocation. Lookup uses a map containing at most 256 requested IDs and one pass over the immutable graph IDs; there is no persistent all-neuron index, graph-array duplication or full neural-array copy. Complexity is O(retained neurons + requested IDs) time and O(requested IDs) temporary storage, independent of edge count. Large sample throughput has not been benchmarked; this is not a streaming API or a GPU performance claim.

Ordinary rejected reads do not send control commands or clear Rest. A worker deadline uses the existing fail-closed shutdown path: the worker is terminated, admission remains reserved until exit, and only a prior durable checkpoint can be explicitly reloaded paused. Returned data must always be matched against its full source scope before a future viewer presents it.

## Validation

`server/connectome-sample.test.js` compares exact samples with explicitly prepared nonzero small numerical fixtures, preserves checkpoint bytes and prepared restores across reads, tests the 256-ID bound and atomic rejection, verifies queued advance/restore ordering and Rest preservation, and checks an actual unavailable Worker returns an error rather than fabricated activity. These tests do not load or advance a full dataset or establish biological dynamics. HTTP and inspector boundary tests are described below.

## Explicit atlas inspector and HTTP

Select an individual in **Connectome lab**, explicitly load it paused, then open **Nervous system** and select an anatomical cell. **Read neuron sample once** performs one read; it never starts, advances or stimulates the individual. A running worker may also be sampled, but Start still only arms explicitly requested advances. If the individual is unloaded, unavailable or belongs to another graph, the inspector shows an error instead of fixture activity or invented zeros.

The inspector first reads current worker metadata and checks the individual, dataset and graph manifest against the loaded atlas. It sends `POST /api/connectomes/:id/samples` with the exact registry envelope documented above. Although POST carries the bounded selection body, this is a read-only operation: no command sequence is consumed. Same-origin checks apply, query parameters and unknown fields reject, and the body limit is 36 KiB (other existing API bodies retain their 4 KiB limit). The service admits at most one outstanding sample per individual, including requests whose clients disconnect; the bounded worker operation finishes or reaches its normal deadline before that slot is released.

The inspector validates all returned values and the exact neuron, graph, dataset, model and session. It then reads current metadata again before publishing, rejecting an unload, restore or worker replacement that occurred during the request. Selection changes, new requests and unmounts abort the browser request and invalidate late responses. Reads are not automatically retried or polled. The browser request deadline is 15 seconds; closing the client does not start or alter worker control.

Displayed values are a captured instantaneous snapshot, labeled with tick, simulation time and source epoch. Subsequent commands can make it out of date; request another sample to refresh it. A later same-session advance does not turn the older capture into a current rate or live overlay. No JavaScript neuron-number conversion, full-state array transfer, provider calls or fixture substitution is involved.

`server/connectome-http.test.js` covers read-only clocks/sequences, unloaded rejection, origin and size limits, unknown/duplicate/foreign/stale selections, restore invalidation and one outstanding read. `server/connectome-sample-ui.test.js` verifies exact graph-manifest matching, numerical validation and delayed-selection/session guards. These are small fixtures and pure UI-boundary tests, not a claim of full-dataset browser validation.

Explicit persistent observations use the separate [manual connectome recording](CONNECTOME_RECORDINGS.md) workflow. The read-only sample endpoint remains free of recording writes.
