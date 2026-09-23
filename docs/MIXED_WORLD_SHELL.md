# Render-only mixed shared world shell

This slice (issue #104, part of #20) adds an observation view that lists and draws, together, the participants of every live **synthetic fixture** shared session and every live **full-connectome research** shared session. It only renders. It does not attach either backend to a body. It supplies no retinal pixels, contact or scent, and no motor stream. It does not couple or synchronize the sessions, compare biological sex, or claim learning or embodiment. A drawn fixture body is an original procedural illustration placed at an engineered fixture pose. A full-connectome participant is a research marker, not a fly.

## Where it is

In **Connectome lab**, open **Mixed shared world shell (render-only observation)**. Opening the disclosure mounts the observer and closing it unmounts the renderer. The shell reads `GET /api/mixed-world` about every 1.5 s while open. The fixture garden and research barrier controls are unchanged. Every lifecycle action (join, start, advance, rest, withdraw, save, restore, separate) stays in those controls.

## Presentation contract (version 1)

`shared/mixed-world-presentation.js` builds the presentation on the server and validates it again in the browser with the same strict reader. It has the kind `fly-garden.mixed-world-presentation` and the version `1`.

- **Participants.** Each one has a stable `individualId` and a `source` of `fixture` or `connectome`. It also has a dataset/model `namespace` (`synthetic-fixture`, `male-cns:v1.0` or `banc:v888`) and a `modelId`, plus a `graphSha256` for research participants when the source reports one. The session fields are `sessionEpoch` (the fixture runtime session or the research worker epoch), `cohortId` (the shared session ID) and `worldEpoch`. The state fields are `lifecycle` (`paused`, `running`, `resting`, `fault` or `unavailable`) and `mode` (`active` or `resting`). Every participant also has a `boundary` and a `body`.
- **Cohorts.** There is one cohort per source session. Each has its version, world epoch, tick, status, ordered member IDs and the withdrawals recorded in that session's event ring. A withdrawn individual appears only in that record and is never drawn.
- **Bodies.** A fixture with a valid committed pose (finite, |x|,|z| ≤ 2, |yaw| ≤ π) gets `fixture-procedural` with that pose. A fixture with a missing or invalid pose gets `unavailable`, and no body is drawn or animated for it. A research participant's body is **always** `unavailable` with a fixed disclosure. The builder ignores any pose, motor or neural field the research input carries.
- **Allowlist.** Only the fields above are copied. The builder drops controller tokens, neural state and simulation clocks, motor output, private paths and free-form session failure reasons. The source session's own controls still show the recorded reason.

The builder withholds the **whole** batch in any of these cases:

- the total is outside 2–64;
- an individual appears twice, or a session ID is duplicated;
- an identity, epoch, status, lifecycle, mode or namespace is missing or unknown;
- a research participant declares or omits `sensoryMotor: false` and `embodiment: false`;
- a source read fails, or a source reports itself unavailable while still listing sessions.

When the batch is withheld, `cohorts` and `participants` are empty and `reason` says why. A source that is simply not configured presents nothing, and the per-source summary says it is unavailable. The builder never truncates to fit, fills in a pose, or quietly drops a participant.

Cohorts are sorted by session ID, so neither registry iteration order nor response order affects the layout.

## Renderer

`createMixedVisualWorld` in `client/src/shared-visual-world.js` builds exactly one object per participant. Each fixture session gets its own garden plot that reuses the original procedural flowers and body geometry. `createSharedVisualWorld` now shares those helpers, and its output is unchanged. Each research session gets a separate research pad with an outlined boundary and one wireframe octahedron marker per participant. A fixture with a missing pose gets an open amber ring outside its plot. Shape as well as colour tells the marker kinds apart. Plots are separate, so participants of independent sessions are never shown sharing space they do not share. Committed poses are applied as reported, and coincident poses are not pushed apart. The shell never pairs, groups, attracts or moves anyone, and each participant keeps its own independent quiet space.

The ordered membership key (session, individual, session epoch, body kind) decides when to rebuild. A pose change within the same membership updates the drawn bodies in place. Any membership or body-kind change, such as a withdrawal, rejoin, restore or lost pose, tears the whole scene down and rebuilds it from one validated batch. No participant is duplicated or removed mid-update.

The scene has no animation loop. It repaints only when a newer committed batch arrives, when the orbit camera moves (damping is off) or when the container resizes. This also satisfies reduced motion. Position and display order identify no one. The participant table lists every stable ID with its source, namespace, session and lifecycle, and each row's keyboard-accessible **Locate** button highlights exactly that participant's object.

## Failing closed

- **Stale data.** If the last accepted batch is older than 5 s, a read fails, or the clock goes backwards, both the drawing and the table stop. The shell does not show older data as current.
- **Out-of-order responses.** An older `generatedAtMs` never replaces a newer batch.
- **Graphics context loss or renderer failure.** Drawing stops and the table of the current batch stays. **Rebuild the view (reads only)** remounts only the renderer.
- **Pause, rest and withdrawal** are shown as reported lifecycle, mode and recorded withdrawal boundaries. Nothing is interpolated.
- **Refresh.** A refreshed or second observer runs the same GET-only read and cannot join, start, advance, load, checkpoint, restore, pause or otherwise change a participant. It holds no controller lease.

## Tests

`server/mixed-world.test.js` uses injected presentation state and tiny two-neuron named graphs only. It covers:

- complete provenance output;
- that a research body is never invented, even when the input carries a pose;
- allowlist leakage checks for tokens, neural and motor fields, private paths and failure reasons;
- order independence;
- every fail-closed rule above, including 65+ members, duplicates, capability claims, failed and unavailable sources, and tampered batches in the strict reader;
- membership-key behaviour;
- one object per participant, pose updates, refused in-place membership changes and single-object highlighting in the Three.js scene, built without WebGL;
- the stale, read-failure, context-loss and out-of-order observer rules;
- a GET-only, query-free HTTP handler that does not leak read-failure text;
- a static check that the shell's only network call is the read route.

An app-level test joins two real fixture runtimes and two tiny-graph research workers through their own explicit routes, reads the mixed world twice and checks two things. The reads leave every individual session, command sequence, status, tick and shared sequence/epoch unchanged. A POST to the shell is refused.

No pinned full dataset was loaded and no simulation was run for these tests.

On 2026-09-23 a one-off headless Chromium smoke check ran against the production build. It used software rasterization and served two joined fixtures and two joined tiny-graph research workers. The canvas and participant table rendered at 1280 px and 375 px widths. There was no horizontal page overflow and no console error, and the observer made no API request other than GET. This first run also exposed a defect, now fixed: a batch received between one-second clock ticks was judged against the older tick and shown as stale. The smoke check is not part of the repository suite. It measures no rendering cost, and 64-participant performance has not been measured.

The existing Playwright accessibility suite has not been extended to this panel. The panel uses the lab's existing focus, reduced-motion and forced-colour styles, but those behaviours are unverified here.

## Prerequisites for a later adapter/evidence slice

This shell deliberately exposes no adapter authority. Before any full-connectome participant is drawn as a body, or before any sensory input reaches it, a later slice must provide all of the following:

1. **Adapter.** A declared, versioned sensory/motor adapter with an enumerated, bounded input list and a documented readout. The visual causal campaign so far is a recorded negative ([visual causal validation](VISUAL_CAUSAL_VALIDATION.md)).
2. **Coordinator.** A heterogeneous cross-catalog coordinator (#108) that owns one mixed membership, one world epoch and explicit per-backend substeps, instead of this shell's side-by-side display of independent sessions.
3. **Contract version.** A new presentation contract version that adds a declared-adapter body kind, with a pose produced by that adapter, never by the renderer.
4. **Measurements.** Active-pair resource and lag measurements (#103), and causal evidence that adapter input changes output, before any embodiment or behaviour claim.

Until then, the markers mean only that a loaded research participant exists and is a member of a research session.
