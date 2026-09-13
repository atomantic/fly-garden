# Local operational readiness

The service, built UI, graph files, loaded workers and visitor bridge are separate states. `/api/health` is a local read: it never starts a worker, advances time, contacts a host or calls a provider.

- `service` reports the responding API. `ui.available` checks the built entry point; it does not prove the JavaScript runs or every asset exists. Browser verification remains separate.
- `runtime` identifies Node, platform and architecture. Paused memory evidence must match this runtime, the exact graph and model. A measurement from a different Node version cannot enable admission.
- Legacy top-level `mode`, `simulation` and `persistence` describe the selected fixture. They never describe a research worker. `connectome.profiles` reports verified data and matching memory evidence separately; neither implies residency.
- `connectome.individuals` reports each research ID, dataset, lifecycle, selected checkpoint, recovery requirement and current neural clock when resident. An unloaded clock is `null`, not zero. `running` and `runningCount` mean armed for explicit bounded Advance commands, not a background neural timer. Aggregate residency includes paused, loading and stopping reservations through the population policy.
- `eidoverse.configured` means a local fixture transport is enabled. `available` requires a locally recorded, unexpired acknowledged visit. It is not a fresh remote liveness probe. Per-individual phase and ownership expose returning/disconnected states; health cannot admit, renew or reconnect a visitor. Complete-connectome embodiment remains unavailable.
- Population settings are operator ceilings, not validated interactive capacity. Recording storage reports its own bounds and failures. Logs remain under the installation's PM2 retention policy; this app does not silently install a log-rotation service or delete logs.

## Reproducible checks

1. On a fresh checkout use Node 24 or newer, `npm ci`, `npm test`, `npm run build`, then `npm start`. Verify the UI loads and the initial fixture is paused. Without optional data, research profiles must be unavailable rather than synthetic substitutes. Follow [dataset preparation](DATASET_PREPARATION.md) explicitly for full graphs and atlas files.
2. Read the process manager's actual Node version, rather than assuming the interactive shell uses the same binary. Run the [paused measurement](CONNECTOME_MEMORY.md) with that binary and install the validated report at the documented local path. Configure admission separately. Loading is a separate explicit paused action.
3. Save or checkpoint/unload any residents whose progress matters before restarting the named `fly-garden` process. Compare IDs and selected checkpoint heads before and after. Opening a second browser must only observe existing identities; no missed wall time is replayed.
4. Exercise [unified offline backup](BACKUP_RECOVERY.md) with all writers stopped and fresh archive/restore destinations. Compare both catalogs and every referenced checkpoint byte. Open the restored root in an isolated server with explicit graph paths, checking all research identities remain unloaded and the selected heads match. Neither backup nor restore configures providers, visitor credentials or datasets.
5. Use the ordinary UI for a paused load and explicit bounded advance only when intended. An unloaded health clock cannot serve as checkpoint numerical evidence; check the selected history or explicitly reload paused. Unknown memory, incompatible graph and corrupt history must fail before activation.

## Observed evidence, September 12, 2026

The production UI/API deployment used merged PR #44 (`74ea68fe14a5fe09cdd0e18b394c3bd9b84df9d8`) on Node 26.0.0, macOS arm64. The existing fixture was explicitly saved before restarting only the named Fly Garden process. After restart its stable ID and selected checkpoint matched, it was saved-unloaded, and research resident/running counts were both zero. Browser verification showed the opening atlas with 165,122 retained MaleCNS cells, 140,024 positioned and 25,098 missing positions, followed by the complete-graph creation controls. No black screen or startup protocol error was observed.

Both complete pinned profiles validated locally: MaleCNS 165,122 neurons / 25,563,197 directed edges; BANC 155,858 / 13,366,670. Node 24 memory reports were correctly rejected under the Node 26 production process. Fresh explicit paused measurements under Node 26 produced:

| Dataset | Sampled process peak bytes | Admission estimate bytes | Paused load/checkpoint/restore wall ms |
| --- | ---: | ---: | ---: |
| MaleCNS v1.0 | 382,418,944 | 562,020,352 | 523.45 |
| BANC v888 | 303,464,448 | 443,981,824 | 346.11 |

These were separate zero-step measurements, with no probes or body controller. The admission estimate includes the documented engineering margin; it is not an allocation guarantee, renderer budget or active-edge performance result. The local installation uses a one-resident ceiling and 1 GiB aggregate budget; this is configuration, not proof of paired capacity.

An isolated UI test had previously created one complete MaleCNS and one complete BANC identity, each advanced explicitly through 100 zero-drive one-millisecond steps. MaleCNS was restored to its exact earlier tick-zero checkpoint; BANC was reloaded paused at tick 100. Both produced zero spikes in this silent baseline. Neither was a production individual or embodied fly.

After both test individuals were saved/unloaded and their isolated server stopped, PR #46's unified CLI archived and restored their complete histories plus the test fixture into fresh directories. Both catalogs and all six referenced checkpoint files were byte-identical. The restored installation was opened with the real graph descriptors under Node 26: two research IDs and their heads matched, both were saved-unloaded, the fixture was also unloaded, and no worker or provider started. Recording round-trip, joint fixture references, corrupt archives, interrupted-restore markers and writer exclusion are covered by the independent 53-test focused suite; this real-data archive contained no recordings, so it does not claim an actual full-neural recording replay.

This evidence establishes the stated local foundation and recovery behavior. It does not establish full-connectome vision/body coupling, retained learning, live Eidoverse deployment, paired interactive throughput, arbitrary-filesystem power-loss durability, or automatic backup scheduling.

## The seven admin values on one surface

FR-16 asks for model identity, actually loaded counts, numerical health, simulation speed, state age, checkpoint lineage and environment admission state, each from the selected runtime. Those seven were previously scattered across the Connectome lab's prose, with nothing asserting that one surface presented them together.

`client/src/runtime-admin-values.js` now returns exactly those seven, in display order, and the lab renders them as one definition list under **Runtime identity, health and admission**. Each value carries the source it came from — selected runtime, pinned local profile, host admission service, or this browser's last accepted receipt — and an unavailable value stays `Unavailable` rather than being filled in from a neighbouring source. The pinned profile may stand in for retained counts only when no worker is resident, and only by saying so in the value's own source line.

Two of the seven are deliberately not a measurement at this revision:

- **Simulation speed** is always unavailable. No timed batch measurement is supplied, and the browser's polling cadence is not simulated throughput. Deriving a displayed speed from actual advancement is FR-10's work, tracked in [#22](https://github.com/atomantic/fly-garden/issues/22).
- **State age** is receipt freshness — how long ago this browser accepted a snapshot — not the age of neural activity, and it says so. A disconnected read marks itself stale on that value.

**Numerical health is never a welfare score.** It reports a fault, or finite potential bounds, and nothing else. The disclosure — that it is never happiness, consciousness, welfare, wellbeing or a validated health score for an individual — is now attached to the value itself and asserted in `server/runtime-admin-values.test.js`, rather than living only in source prose.
