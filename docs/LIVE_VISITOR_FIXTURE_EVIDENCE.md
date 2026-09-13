# Isolated running-host visitor evidence

On September 12, 2026 (local time), a fresh local Eidoverse sequencer,
a separate local HTTP broker harness, and the actual Fly Garden transport
and visitor bridge completed one bounded two-fixture round trip.
[The compact receipt](live-visitor-fixture-evidence.json) records exact source
commits, raw evidence digests, individual/session IDs and clock outcomes.

## What ran

The Eidoverse `server/server.ts` process used a fresh world directory, an
unused loopback port, a disposable test door and a test-only managed visitor
grant for `managedscratch`. A WebSocket spectator joined that world and
received the sequencer's actual `managed-flies` presence messages.

The PortOS `createManagedVisitorBroker` and `createManagedVisitorHost`
implementations used temporary credential storage and real HTTP requests to
that sequencer. A small test HTTP dispatcher called the actual broker
methods after actual credential authentication. It did **not** exercise
PortOS's production Express routes, owner provisioning UI, password gate or
managed-app lookup; the latter was a test adapter. Fly Garden's actual HTTP
transport rewrote its approved loopback base to the unused test broker port
through its existing injected fetch function. No fabricated host responses
were supplied.

The actual Fly Garden visitor bridge used two fresh synthetic runtimes and
a test ownership adapter. Admission left both paused. Explicit Start and
bounded tick calls then advanced A and B by 20 fixture ticks each. Returning
A released only A; B advanced another five ticks. Returning B left both
paused at home with their original identities and runtime sessions.
The observer received population counts 1, 2, 1 and 0.

The test executed 45 fixture steps and zero full-connectome steps. It stopped
both temporary servers and revoked the temporary broker credential. Production
Fly Garden identities and the existing PortOS/Eidoverse processes were not
used or restarted.

## What this establishes

- Real sequencer acknowledgment and independent host presence for two IDs.
- Compatibility of the current host, broker, transport and fixture bridge
  across actual local HTTP connections.
- Split-location continuity: returning A did not release or advance A again,
  and did not prevent B's subsequent five steps.
- Both local runtimes ended paused, with independent clocks preserved.

This was one run, not a capacity or latency benchmark. The spectator checked
presence messages, not rendered pixels. Neural stepping used the disclosed
engineered patch projection and synthetic fixture motor readout. No learning,
full-connectome embodiment, joint checkpoint round trip, production deployment,
chat, creative interaction, expiry/revocation fault campaign or old-host
compatibility claim follows from this result. Existing unit tests cover
additional protocol boundaries but are not substituted for live evidence.

Issues #9, #10 and #21 remain open for their outstanding acceptance criteria.
