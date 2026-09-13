# Bounded shared fixture population

Shared HTTP, procedural rendering and movement capture now accept 2–64 distinct
already admitted fixture residents. This is a structural bound, not a measured
64-body operating envelope. The default resident capacity remains one; joining
never loads, allocates, evicts or changes the capacity setting. Full-connectome
workers remain unavailable in this habitat. Existing pair envelopes and joint
checkpoint formats are unchanged, as are the first two bodies' geometry/colors.

Each group has one immutable ordered membership, one private camera lease and one
world epoch. There is one body/camera per member and one 96-byte RGB raster per
camera. The whole batch is captured synchronously from the same committed poses,
with only the recipient body hidden. No member is omitted to improve speed. An
elapsed raster budget of 125 ms is checked before and after every camera; exceeding
it discards the whole batch and stops the producer. A single synchronous GPU call
cannot be interrupted by this guard. The existing 250 ms server freshness rule
and pause-all watchdog remain unchanged, with no catch-up or deadline escalation.

HTTP bodies have a hard 65,536-byte bound, with exact schemas and per-member
identity/session/sequence validation. Tests fit the maximal 64-member raster
JSON envelope within that bound. Invalid count, duplicates, missing participants,
wrong clocks and stale controls reject the complete operation. Observer views do
not allocate residents or receive controller credentials.

Creative capture accepts 64 attributed participants while retaining the existing
1,024-total-action and 2 MiB output limits. It stops before an incomplete batch:
a 64-member population retains at most 16 complete barriers, a three-member one
at most 341. Prior artifacts and smaller participant counts remain readable.
Capture output labels individual/session provenance and the original human
arrangement; it does not supply reward feedback.

Rest freezes an individual's neural state. A version 1 group keeps the original
Rest/Home separation and Pause-all semantics unchanged. A version 2 group, chosen
explicitly at join time, adds per-member `active | resting` modes: a resting member
keeps its frame slot with a `null` raster, advances no neural time, holds its pose
and zero motor, and the barrier continues for the others. An all-resting group
reports status `resting` and refuses every batch rather than running silently.
Version 2 also supports partial withdrawal at the committed boundary: membership is
rebuilt in place, the boundary is recorded in the session event ring, survivors keep
their session and camera lease, and a withdrawal that would leave fewer than two
members is refused so the caller separates the whole group instead. Rest and
withdrawal carry no penalty, no escalation and no loss of baseline support.

Each member of a shared group also owns its own encounter adapter, keyed by its
individual ID and the owning shared session, fed only from its own committed pose
and bound only to its own stimulus policy. One member's dose, receipt or recovery
never reaches another member's aggregate budget.

Validation uses a three-fixture one-step HTTP transaction, missing-member atomic
rejection, joint paused restore, 64-member envelope doubles, 64-participant bounded
capture records, a three-body geometry check without WebGL, a three-member rest and
partial-withdrawal transaction, and a per-recipient shared encounter isolation run. No high-population
active simulation or full graph was run. Rendering cost includes every body in
every controller view, so large populations may be explicitly unavailable on the
local browser even when neural residency fits. No 64-body performance is claimed.
