# Bounded fixture HTTP integration

Issue #16 now has a committed, reproducible **fixture-only** integration harness.
It creates a disposable identity store and its own production Fly Garden HTTP
server on an ephemeral loopback port. It supplies an original, in-process host
double at the visitor transport seam. It does not contact PortOS, Eidoverse, a
language provider or a dataset service, and does not open existing individuals.
All original harness code and procedural exports use the repository MIT license;
no external asset or dataset is loaded.

Use the repository's declared dependencies and Node 24 or newer:

```sh
npm run verify:fixture -- --run > fixture-integration-result.json
```

For a pure JSON stream without npm's banner, use
`node scripts/run-fixture-integration.js --run > fixture-integration-result.json`.
An omitted `--run` or an unknown argument exits 2 before a store or listener is
created. Exit 0 means the fixture checks passed; exit 1 means a fixture check,
setup or cleanup failed. No exit code establishes integrated product acceptance.
The exported function is also exercised by `npm test` in a temporary store.

The sequence verifies:

1. Paused boot and repeated HTTP observers with no host calls or neural steps.
2. Explicit controller attachment, start and capture; 40 accepted synthetic
   white retinal frames; correctly attributed JSON and MIDI/SVG/PNG exports.
3. Rejection of a replayed controller frame without another neural step.
4. Explicit acknowledged paused admission; rejection of local control and a
   duplicate admission; bounded host-double advancement and confirmed return
   preserving identity, runtime session and checkpoint lineage.
5. Owner denial, an incompatible contract version, stale observations, a prior
   visit epoch and an observation disconnect, all without advancing the fixture.
6. Explicit save and service/store reopen with the same identity, tick and
   checkpoint, a fresh session, no controller lease and paused recovery.

The server scheduler runs only in this disposable fixture. Home input is bounded
to 40 frames and the host double refuses further observations after three per
visit. Polls have a five-second deadline and HTTP requests have five-second
timeouts. Closing the harness stops its listener and removes its temporary store.
The host double confirms cleanup even in the observation-disconnect case; this
does **not** test an unreachable host's unconfirmed-leave quarantine.

## Reading the result

`outcome` applies only to `synthetic-fixture-http-integration`.
`integrationAcceptance` remains `unavailable`, even when every fixture check
passes. Every result includes source revision, dirty-tree status, harness,
host-double and dependency-lock hashes, Node version, platform/architecture and the pinned synthetic
dataset/model identifier. It omits hostnames, temporary paths, credentials,
controller leases, neural arrays and raw exception/response text. Run from a
clean committed checkout for attributable evidence; a dirty run is diagnostic.
Generated fixture artifacts are hashed in memory, not published or saved.
Hashes include fresh session provenance and wall time, so are not golden outputs.

The measured initial trajectory produced **40 accepted actions and zero creative
events**. It exported valid empty MIDI/SVG/PNG containers; it did not produce a
melody or pollen marks. Quiet behavior is permitted, and no stimulus escalation
or forced target motion is used to manufacture a creative result. Visitor
interaction is an independently reported observed boolean, not an assumed pass.
The supplied images and stationary host pose are engineered test inputs, not
rendered observations or evidence of natural behavior.

No live managed host, rendered second observer, full-connectome embodiment,
retained learning, provider call, fresh-clone/PM2 restart, worker crash, or complete
fault campaign is verified here. RNG and plasticity are absent from the fixture;
their continuity is not asserted. The separate preregistered learning campaign
remains negative. See [requirement evidence](REQUIREMENT_EVIDENCE.md),
[learning results](BENIGN_LEARNING_RESULT.md), and the earlier, distinct
[running-sequencer evidence](LIVE_VISITOR_FIXTURE_EVIDENCE.md).

Issue #16 stays open for the rendered session and real managed-host campaign,
source/version compatibility, complete failure evidence and published demonstration.
The paired #21 gate is not satisfied by this single-fixture harness.
