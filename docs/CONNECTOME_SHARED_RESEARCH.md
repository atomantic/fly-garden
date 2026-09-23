# Full-connectome shared research barrier

This increment adds a separate, explicit research path for already loaded MaleCNS v1.0 and BANC v888 identities. It does not extend the synthetic fixture renderer, create a body controller, supply retinal pixels, attach chemistry, enable retained learning, compare biological sex, or provide a cloud fallback. A shared participant is a real sparse-LIF worker with its pinned graph namespace and checkpoint lineage.

## Boundary

The existing fixture shared garden remains unchanged. The new path is available at `/api/connectomes/shared` and is shown in the full-connectome lab as a research barrier. It requires two to 64 already loaded, admitted research residents; join does not create, load, reset, crop, or replace an identity. The configured resident ceiling and trusted per-profile memory evidence still apply at load time.

The world interval is 5 ms. Each active full-connectome participant receives exactly five explicit 1 ms sparse-LIF substeps per complete barrier. The service waits for every participant, validates each prepared candidate before committing, and rolls every committed candidate back to its in-memory pre-barrier state and pauses the group if a worker reports a failure. A worker that cannot be rolled back is evicted with its durable checkpoint retained; no skipped or extra neural time is reported as success.

Completion order is not an authority. The public traces are returned in the requested membership order, include the stable individual ID and session epoch, and report the exact substep count and before/after clocks. The path has no observation payload, so there is no way to inject a partner's neural state, hidden target, camera metadata, or action into another worker.

## Lifecycle

`POST /api/connectomes/shared/join` accepts exact membership envelopes containing `protocolVersion`, `individualId`, `sessionEpoch`, and the current individual `commandSequence`. Joining pauses all members and creates a new shared ID and world epoch. `POST /api/connectomes/shared/:id/control` supports explicit `start`, `pause`, and `separate`. `POST /api/connectomes/shared/:id/barrier` runs one complete barrier and advances the shared sequence only after all participants commit. `POST /api/connectomes/shared/:id/member` supports per-member `rest`, `resume`, and `withdraw`; withdrawal stops at the two-member floor and records the boundary.

Reads and mutations use the existing same-origin, host, content-type, and bounded JSON checks. Joining invalidates individual command envelopes, while the ordinary individual research command route refuses lifecycle control for a joined identity; separation and withdrawal invalidate the affected envelopes again. The full-connectome lab displays the research-only disclosure and never presents this path as a garden body or sensory result.

## Persistence and remaining work

This first slice is an in-memory shared session over independently durable connectome workers. It deliberately does not add a cross-store joint checkpoint or restore transaction, a rendered mixed fixture/connectome world, a declared visual or contact adapter, active-pair throughput/memory measurement, or biological validation. A later implementation must add those contracts without silently substituting a fixture, dropping a full-graph step, sharing a graph namespace, or presenting a zero-drive result as embodiment or learning.

The targeted regression tests use tiny named graphs and injected worker scheduling. They do not load the pinned full datasets, measure production pair capacity, run a simulation automatically, or establish a biological result.
