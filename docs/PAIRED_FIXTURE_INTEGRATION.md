# Paired fixture HTTP integration

Issue #21 extends the [bounded fixture harness](FIXTURE_INTEGRATION.md) from one fly to two
independently admitted flies. It is an **opt-in, fixture-only** run. It creates a disposable
identity store and capacity file, starts the production Fly Garden HTTP server on an ephemeral
loopback port, and supplies two original in-process doubles: a multi-visitor host at the visitor
transport seam and a synthetic language provider. It does not contact PortOS, Eidoverse, a real
language provider or a dataset service, and does not open existing individuals. The harness and
doubles are original code under the repository MIT license; no external asset or dataset is loaded.

```sh
npm run verify:paired -- --run > paired-fixture-result.json
```

Use `node scripts/run-paired-fixture-integration.js --run` for a stream without npm's banner. An
omitted `--run` or any other argument exits 2 before a store or listener exists. Exit 0 means the
fixture checks passed; exit 1 means a check, setup or cleanup failed. No exit code establishes
integrated product acceptance. Write the result outside the checkout (as above) or the output file
itself makes the tree dirty and the run diagnostic rather than attributable.

## What the run does

Two fixtures, labelled A and B in the report (their identifiers are never published), run through
these checks in order. Every check is an assertion against the real HTTP routes, the real visitor
bridge, the real registry ownership adapter and the real language gate; only the host and the
provider are doubles.

| Check | What it establishes |
| --- | --- |
| `local-capacity-admits-two-and-refuses-a-third` | A second fixture load is refused at the default resident ceiling of one, admitted after the operator raises it to two, and a third is refused with both residents untouched. Local capacity is a separate setting from host visitor capacity. |
| `home-state-per-individual` | Interleaved controller frames, nectar reservations and checkpoints on both flies. Each fly's exported artifact names only its own individual and session; a frame for A sent to B, and a replayed frame, are refused. |
| `per-individual-language-budgets` | Different call and spend ceilings per fly against a synthetic in-process provider. Each fly spends only its own ceiling and cooldown clock; the aggregate reservation is the sum; an over-ceiling request is refused with the budget reason. |
| `late-provider-reply-keeps-its-recipient` | A request pending for A when A departs is canceled and stays attributed to A; the provider's late text is dropped and appears under neither fly. B stays armed with its budget untouched. |
| `split-location-a-visits-b-home` | A visits while B keeps full home control and steps. The away fly refuses local control and does not step. Pod labels differ per fly. |
| `both-visiting-with-distinct-epochs` | Negotiated capacity 2. A duplicate admission of an owned fly is refused. Both fly distinct host leases, visit epochs and runtime sessions, and every trace read by an independent HTTP reader names its own individual, epoch and session. |
| `revocation-of-a-leaves-b-visiting` | A's grant is revoked on the host. A returns paused without a restore; B keeps the same epoch and keeps stepping. |
| `peer-scope-reply-for-a-cannot-command-b`, `stale-epoch-reply-for-a-cannot-command-b` | A host reply for A that carries B's scope, or a prior epoch, is refused without advancing A. B is unaffected and the host records zero requests issued outside any lease's scope. |
| `independent-return-in-both-directions` | B returns while A keeps visiting and stepping; A then returns from its own fresh grant. |
| `host-wide-disconnect-with-confirmed-cleanup` | Observations fail for every visitor; both return paused, ticks never rewind, sessions and checkpoints are unchanged. |
| `host-wide-unreachable-host-holds-both-paused` | Nothing is reachable, cleanup included. Both stay owned and paused, never claim to be home and refuse local control; when the host returns the retry confirms both. |
| `paired-round-trip-continuity` | Per fly: same identity, session, checkpoint lineage, stimulus-reservation ledger and chemical recovery clocks across every visit, no restore, no refunded language reservation. |
| `older-host-refuses-second-visitor` | A host that publishes no capacity field is read as one visitor. The second admission is refused before any host request, with the first visit stepping on undisturbed; the second is admitted after the first returns. |
| `saved-paused-reopen-pair` | Both individuals reopen from the store with the same identity and checkpoint, fresh sessions, paused, owned by no visitor, and with no host call. |

## FR-36–40 as this run can speak to them

The report carries a `requirements` list. Each requirement is evaluated clause by clause; a clause
no check here can see is `unavailable` with its reason, never inferred. `partial` means every
clause this run can evaluate passed and at least one named clause is unavailable.

| Requirement | Outcome | Passing clauses | Unavailable clauses |
| --- | --- | --- | --- |
| FR-36 profiles | unavailable | none | Only the synthetic fixture is loaded; MaleCNS and BANC profile evidence lives in the model cards and descriptor tests. |
| FR-37 capacity | partial | Configured ceiling admits two and refuses a third without disturbing residents. | Memory headroom is not measured: the admission inputs are fixed synthetic constants. |
| FR-38 isolation | partial | Identity, session, checkpoint lineage, chemical and stimulus state, late-reply and budget recipients. | RNG and learning isolation: both are unsupported nulls in the fixture checkpoint, so there is nothing to compare. |
| FR-39 coupling | unavailable | none | No shared session is created; both flies run independently. |
| FR-40 visitors | partial | Two-at-home, split and two-visiting cases; one revocation or misrouted reply cannot control the other; host-wide disconnect; older-host preservation; independent language budgets. | A rendered host showing two distinct, correctly attributed flies to a second observer. |

## Limits that must travel with the result

- **The host is a double.** It publishes its own capacity and enforces its own leases. This
  validates Fly Garden's bridge, registry and HTTP surface against a two-visitor host contract; it
  says nothing about PortOS or Eidoverse publishing `maxConcurrentVisitors`, rendering a nonhumanoid
  second fly, or routing observations. Those need linked changes in their own repositories.
- **The second observer is an HTTP reader.** It uses the local read-only routes and sees structured
  state, not pixels. No browser, rendered scene or human observer was involved.
- **No browser selection is exercised.** Per-fly controls, keyboard selection and a late reply after
  a *browser* selection change are not tested here. The server contract behind them is: language and
  visitor commands are keyed by their envelope individual, and the server has no active-selection
  input.
- **The provider is a double.** Per-individual budgets were exercised with a deterministic
  in-process provider: no model, network or generated text from a real provider. Chat requests have a
  per-fly one-second cooldown, so the run waits it out before testing the call ceiling, and the
  reported refusal is the budget reason rather than the cooldown.
- **No learning claim follows.** RNG, plasticity, refractory state, delay buffers and embodiment are
  unsupported nulls in the fixture checkpoint and are listed in the report as not carried. Continuity
  of identity, lineage and chemical bookkeeping is not retained learning, and the preregistered
  learning campaign remains negative ([result](BENIGN_LEARNING_RESULT.md)).
- **No natural behavior or sex-difference claim.** Both flies are the same synthetic fixture with
  engineered sensory inputs and a fixed host pose. Any difference between A's and B's traces is
  not evidence of a population, social or sex-difference effect.
- **Lease expiry is not run.** Leases last 30 seconds and the run ends well before that; time-based
  expiry is covered only by the bridge unit tests.
- **Two flies only.** Nothing here supports a larger population. ID-keyed routing is exercised for
  two, and anything larger needs its own measured evidence.

Quiet outcomes are permitted. The run uses no stimulus escalation and forces no movement to
manufacture a creative result: both artifacts contain valid empty MIDI, SVG and PNG containers and
zero creative events.

## Reading the result

`outcome` applies only to `synthetic-fixture-http-paired-integration`. `integrationAcceptance`
remains `unavailable` even when every check passes. Every result includes the source revision,
dirty-tree status, harness, host-double and dependency-lock hashes, Node version,
platform/architecture and the pinned synthetic dataset identifier. It omits hostnames, temporary
paths, credentials, controller leases, neural arrays, individual and session identifiers, and raw
exception or response text. Artifact hashes include fresh session provenance and wall time, so they
are not golden outputs. `timing.wallMs` is one run's wall time with a 50 ms server scheduler: it is
not a capacity, latency or throughput measurement.

The harness is verified against its own failure modes by `server/fixture-paired-integration.test.js`:
a host that publishes capacity 1, a host that revokes every visitor when one grant is revoked, and a
host whose admission acknowledgment throws each produce a `failed` report at the expected check,
with FR-40 reported as failed and no exception text published.

## Recorded run

The [recorded result](../research/results/fixture-http-paired-integration.json) used clean revision
`1330173` on Node 26.10.0, Darwin arm64. All 15 fixture checks passed in 4.7 s of wall time. The two
flies were stepped from 12 to 26 (A) and 12 to 36 (B) fixture ticks; the host double issued nine
leases across the run (six for A, three for B, all with distinct epochs) and recorded zero requests
outside any lease's scope. Both flies spent an identical bounded nectar reservation before the first
visit, and each made exactly one chat request to the synthetic provider before the late-reply
check. FR-36 and FR-39 are unavailable, and FR-37, FR-38 and FR-40 are partial, for the reasons
tabulated above. Everything in this document is fixture-scoped evidence; see
[requirement evidence](REQUIREMENT_EVIDENCE.md) for the matrix and its known gates.

Issue #21 stays open for the live PortOS/Eidoverse both-visiting run, host-published capacity, a
rendered second observer, the admin-UI per-fly controls with keyboard selection, and paired RNG and
learning continuity.
