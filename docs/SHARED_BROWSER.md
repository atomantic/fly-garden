# Shared two-fixture browser integration

The observatory supports an explicit pair of already loaded, admitted **synthetic 32-neuron fixtures**. It uses the actual resident runtimes described in [shared session primitives](shared-fixture-session.md). It does not execute the MaleCNS/BANC anatomical graphs, establish biological sensing or retained learning, or compare biological sex. Registry population primitives retain their broader bound; the HTTP/browser baseline deliberately accepts exactly two members.

## Explicit lifecycle

Select two residents and choose **Join selected pair (paused)**. Joining preserves neural state and existing committed body poses, revokes individual visual ownership and optional language, and pauses both. It does not allocate a resident, admit additional capacity, reposition bodies, or begin stimulation. Two previously unattached members begin at the same declared zero pose; geometry overlap is visible and there is no separation objective.

**Start shared pair** explicitly rotates the epoch and begins the camera barrier. **Pause both**, **Save joint checkpoint**, and **Separate (both paused)** are scoped shared commands. Joint save stores real member checkpoints and poses atomically. Explicit joint restore requires both saved recipients already loaded, creates new runtime sessions and camera ownership, and remains paused. An individual Rest or Home separates the pair; an individual Pause pauses both.

The join/restore response returns one private controller token. The browser stores it only in tab-local ownership state, separate from public snapshots and history. Observers can read the same committed world but cannot acquire a token by polling. Independent visual Scene components are unmounted for shared members. A tab switch away from the rendered habitat, hidden document, graphics loss, renderer failure or lost network stops frame production; the existing 250 ms server watchdog pauses the entire pair. There is no catch-up integration.

## Retinal barrier

`SharedScene.jsx` owns two original procedural fly bodies, visible neutral flowers, two dedicated 90-degree controller cameras, and an independent orbit camera. Controller cameras point in the authoritative yaw direction. Body colors are original illustration choices, not specimen or sex labels.

Before a request, the renderer applies both poses from one committed snapshot. It renders both 8×4 RGB images synchronously, with no intermediate await, pose change or neural advance. During each raster only that camera's own body is hidden; the partner and visible world remain present. The observer camera never supplies input. The complete batch contains per-recipient ID, runtime session, world epoch/tick, neural time and bounded pixel bytes. No partner neural state, camera pose metadata, hidden target, invisible beacon, contact or scent enters the batch. The server cannot prove browser pixels came from a truthful raster; source inspection and browser verification remain necessary evidence.

Only one request is in flight. Responses must match the current private lease, shared ID/epoch, per-member identity/session and next tick. Newer control sequences and committed ticks cannot be replaced by older responses. Frame rejection stops production until an explicit epoch-changing start after recovery. The UI displays each recipient's accepted retinal raster.

## HTTP boundary

All mutation routes retain the app's same-origin/host checks and a 4096-byte JSON limit. Reads never advance, restore or load residents.

- `GET /api/shared/checkpoints`: `{checkpoints}`.
- `GET /api/shared/:sharedId`: `{shared, members}`. `shared.commandSequence` is the shared control counter; members are full public individual snapshots. Tokens are absent.
- `POST /api/shared/join`: `{protocolVersion:1,members:[envelope,envelope]}`. Each exact standard envelope carries `protocolVersion`, `individualId`, `sessionId`, and the next individual `sequence`. Both validate before any counter is consumed.
- `POST /api/shared/restore`: the same membership envelope plus `jointCheckpointId`. IDs must exactly match the durable joint record before sequence consumption. Both membership operations return `{shared,members,controllerToken}`.
- `POST /api/shared/:sharedId/control`: `{protocolVersion:1,sharedId,worldEpoch,sequence,action}`. Actions are `start`, `pause`, `save`, `separate`; save adds `checkpoint` to the public response.
- `POST /api/shared/:sharedId/frames`: the exact [complete retinal batch](shared-fixture-session.md#complete-retinal-batch), returning `{shared,members,traces}`.

Unknown/duplicate fields, stale sessions, partial membership, wrong leases, invalid epochs and oversized bodies fail explicitly. Frame validation and neural commit remain the synchronous registry barrier; HTTP does not introduce another neural authority.

## Optional-tool limits and validation

Joining invalidates optional language and stops home-only movement capture with an explicit partial-source reason. Shared creative capture and new home recordings are unavailable; existing home recordings are marked discontinuous before subsequent sampling. No shared movement is relabeled as a home-world action. Optional language arm/chat, contact/scent admission and automatic encounters are unavailable while joined. Saves do not generate notes, marks, messages or stimuli.

HTTP tests use actual resident fixture runtimes and verify preservation across join, distinct retinal effects through a complete barrier, invalid-batch immutability, joint save/restore, fresh paused sessions, exact restore recipients, replayed command rejection, token-free reads, size/query bounds, origin rejection and per-member language/capture invalidation. Build checks compile the browser components. These are synthetic integration checks; browser-rendered interaction, sustained two-body performance and broader full-dataset acceptance require separately recorded evidence.

## Browser validation, 2026-09-12

An isolated temporary store with an explicit capacity of two started both fixtures paused. The browser attached and ran one individual camera before pausing and joining the pair, preserving its existing neural progress and pose. Explicit shared start showed two recipient-specific 8×4 rasters carrying the same accepted batch tick. Pause stopped both at world tick 386; joint save retained that tick. After further explicit advancement, joint restore returned to tick 386 paused with fresh sessions and camera ownership.

A second observer tab reported no controller lease and disabled shared start; it sent no retinal batches. Navigating the owner away from the rendered habitat paused both through camera freshness enforcement. These checks used the synthetic circuit and original procedural bodies, without provider calls or optional encounters. They establish basic browser lifecycle behavior, not sustained full-dataset performance or biological partner perception.

Switching selection to the other member preserved the private lease and enabled shared start. Visual inspection also caught the inherited absolute canvas covering shared disclosures and retinal previews; the shared layout now keeps those controls, errors and rasters in normal document flow beneath a bounded canvas.
