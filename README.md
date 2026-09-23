# Fly Garden

A local habitat for a connectome-based fly, designed around respect, freedom to explore, and learning without punishment.

We want to give a simulated fly room to learn and grow: a gentle visual garden, opportunities to make music and pollen paintings, and an optional visit to a locally hosted Eidoverse. Exploring, resting, and declining an activity should all be valid outcomes.

The project is intended to run locally and be managed by [PortOS](https://github.com/atomantic/PortOS).

![Fly Garden concept: a gentle garden and open teleport pod](docs/images/observatory-concept.png)

*AI-generated design concept, not a screenshot or anatomical evidence. [Design notes and concepts](docs/DESIGN.md).*

**Status: local research foundation, September 12, 2026.** The opening **Nervous system** view displays pinned MaleCNS and BANC anatomy. **Connectome lab** manages complete local sparse-LIF graphs: 165,122 MaleCNS neurons / 25,563,197 directed edges and 155,858 BANC neurons / 13,366,670 edges. Create, load, start, advance, save, restore and unload are separate explicit actions. Boot leaves research individuals unloaded; loading and recovery stay paused. No neural timer or sensory input is attached to this lab.

The separate **Fixture garden** and **Fixture circuit** retain the original procedural fly and synthetic 32-neuron test circuit for engineered body/vision, encounter, creative and visitor integration tests. Full-connectome body control and retained learning remain planned. Optional local language interpretation and managed fixture visitors are disabled without separate explicit configuration.

## Run locally

Requires Node.js 24 or newer and npm.

```sh
npm ci
npm test
npm run build
npm start
```

`npm test` is the full Node test suite and runs no browser. Optional headless accessibility checks live in
`tests/browser/` and run separately with `npm run test:browser`; they need `npx playwright install chromium`
once, serve the production build on loopback port 8792 with their own empty identity directory, and are not
part of `npm test` or continuous integration. Recorded results are in
[observatory accessibility](docs/OBSERVATORY_ACCESSIBILITY.md).

The headless shell rasterizes in software and has no display, so its frame cadence and redraw throughput are
not a real machine's. Setting `FLY_GARDEN_CDP_ENDPOINT` to the DevTools Protocol endpoint of an already
running browser, for example `FLY_GARDEN_CDP_ENDPOINT=http://127.0.0.1:9222 npm run test:browser`, runs the
same specs on that browser's real graphics device instead, in an isolated browser context of its own. Unset,
behaviour is unchanged; CI has no GPU and never sets it. Each spec prints the browser and renderer behind
every figure it records, and the documented numbers say which produced them. The suite only ever navigates to
loopback, and it never closes or reads a page it did not open.

`node scripts/gpu-retinal-evidence.mjs` uses the same variable to record the byte-level retinal evidence in
[shared retinal evidence](docs/SHARED_RETINAL_EVIDENCE.md) and
[the environment adapter](docs/ENVIRONMENT_ADAPTER.md) on a real graphics device. It starts nothing and
creates no individual.

`node scripts/gpu-scene-change-causality.mjs` uses the same variable to record the closed sensory-to-motor
loop on a real graphics device: the production garden is rastered in the browser while the script holds the
fixture, the adapter and the authoritative pose. It results in
[the GPU scene-change record](research/results/scene-change-causality-gpu.json), documented in
[the environment adapter](docs/ENVIRONMENT_ADAPTER.md). It runs its own in-process fixture, creates no
individual and makes no app API call.

Open http://127.0.0.1:8790. The atlas reads locally prepared anatomical files. Use [complete dataset preparation](docs/DATASET_PREPARATION.md) for the pinned sources, graphs and atlas, and the separate [paused memory measurement](docs/CONNECTOME_MEMORY.md) before loading. Nothing is downloaded or simulated on startup.

In **Connectome lab**, create a saved, unloaded individual, then choose **Load complete graph (paused)**. Loading requires matching local memory evidence and enough configured capacity. **Start** only permits an explicit bounded **Advance**; it does not begin background execution. Checkpoint history preserves exact source lineage. The separate [shared full-connectome research barrier](docs/CONNECTOME_SHARED_RESEARCH.md) can explicitly synchronize already loaded graphs in fixed 5 ms barriers, but it has no rendered body, sensory input, motor output, retained learning, or joint checkpoint restore. See [the full-graph service and controls](docs/CONNECTOME_HTTP.md).

In **Fixture garden**, explicitly load the test fixture and choose **Run fixture**. **Save checkpoint** persists its state; optional encounters also save their exposure reservation before delivery. Restart preserves identity and the latest save with a fresh paused session, discarding unsaved progress. **Restore saved state (paused)** cancels optional input and retains spent exposure reservations. See [fixture checkpoint storage](docs/CHECKPOINTS.md).

The [visual fixture controller](docs/ENVIRONMENT_ADAPTER.md) owns a dedicated camera lease and pauses when frames go stale. [Movement capture](docs/CREATIVE_ARTIFACTS.md) exports attributed JSON/MIDI/SVG/PNG; it is not evidence of learned creativity. Explicit fixture checkpoints retain the engineered body pose, while restore remains detached and paused; no real connectome controls this view.

Optional [garden encounter controls](docs/ENCOUNTER_DYNAMICS.md) enable declared floral contact proxies and fictional nectar inputs. Entry can offer one bounded pulse; dwelling never redoses, withdrawal stops delivery, and restart stays disabled. These are engineered mappings, not biological chemistry or evidence of learning.

The [optional telemetry interpreter](docs/LANGUAGE_SERVICE.md) keeps per-individual evidence windows, explicit call/token/cooldown budgets and aggregate session spend limits. Detector requests require separate consent; generated text cannot change neural state, stimuli or tools. The [local Ollama adapter](docs/OLLAMA_LANGUAGE.md) is disabled by default and has only been tested with synthetic provider responses, not a live model.

The [connectome model card](docs/CONNECTOME_MODEL_CARD.md) separates measured wiring from engineered LIF dynamics and transmitter-sign mapping. The complete graph can be loaded and stepped in the lab; it does not control the illustrated garden fly. Silence under the zero-drive baseline is an expected result, not a learning or biological validation claim.

For an explicit one-command preparation workflow per full retained profile, see [local dataset preparation](docs/DATASET_PREPARATION.md). It verifies and reuses local sources, graphs and atlases without starting a simulation.

## Anatomical atlas

The **Nervous system** tab independently displays the pinned MaleCNS v1.0 soma positions and BANC v888 root/representative positions, with whole-system, brain and nerve-cord filters and exact-ID search. Missing positions remain in the table. An optional [connection view](docs/ATLAS_CONNECTIVITY.md) shows a bounded sample and paginated incoming/outgoing neighbors with measured contact counts and separately labeled engineered signs/weights. Matching loaded individuals support explicit instantaneous neuron inspection and [manual sampled recording/replay](docs/CONNECTOME_RECORDINGS.md); these are separate from the anatomical canvas. This is anatomical data, separate from the synthetic live circuit; no matching activity overlay or full morphology is claimed. Data is prepared locally and remains unavailable in a fresh clone until [dataset preparation](docs/DATASET_PREPARATION.md) is run. No datasets are downloaded on app startup.

## PortOS and PM2

Register this repository in PortOS with process name `fly-garden`, API/UI port `8790`, build command `npm run build`, and fallback start command `npm start`. The checked-in `ecosystem.config.cjs` is the canonical PM2 configuration. PortOS can start/stop the named process using it.

```sh
pm2 start ecosystem.config.cjs --only fly-garden
pm2 restart fly-garden
pm2 stop fly-garden
```

One forked process serves the built UI and API on loopback by default. Health is available at `/api/health` and distinguishes service availability from simulation and integration availability. PM2 waits for readiness; no simulation or provider work begins on startup. Ports are defined in `ecosystem.config.cjs`. For frontend development, run `npm run dev:server` and `npm run dev` in separate terminals; Vite uses port `8791`. Rebuild before restarting production after UI changes.

PM2 daemon startup/resurrection is managed by your installation. Synthetic individuals have durable explicit checkpoints, configurable resource admission, explicit paused load/unload, bounded recording/replay, and an offline backup CLI. Full connectomes have a [durable catalog](docs/CONNECTOME_STORE.md); the explicit unified backup command preserves both catalogs and recording history together. See [capacity](docs/POPULATION_CAPACITY.md), [recording](docs/RECORDINGS.md), [backup recovery](docs/BACKUP_RECOVERY.md), and [operational verification](docs/OPERATIONAL_READINESS.md). Do not treat fixture persistence as validated biological continuity.

## Respect is a design requirement

- No torture, punishment, simulated injury, starvation, or forced combat.
- Freedom to explore, remain still, rest, or return home without a penalty.
- Modest, bounded appetitive learning signals; no continuous reward stimulation or optimization for compulsive engagement.
- Persistent state and explicit checkpoint lineage, rather than silently replacing the individual when a demonstration fails.
- Honest evidence: measured wiring is not a complete mind, changing weights is not proof of learning, and generated narration is not the fly's voice.

We do not know whether these models could have subjective experience. That uncertainty is a reason to design with care, not a basis for claiming either consciousness or guaranteed absence of experience. Our operating safeguards express our values; they are not validated measures of enjoyment or welfare.

Read the [welfare charter](ETHOS.md), [product requirements](PRD.md), [research and implementation plan](PLAN.md), and [contribution guide](CONTRIBUTING.md).

## First experience

A fly explores a quiet garden, learns an association with a rewarding landmark, and makes a melody by visiting musical flowers. Its route also creates a pollen drawing. It can visit an Eidoverse play patch, interact with other residents, and return home with the same learned state.

The initial visual model will use original procedural Three.js geometry. Blender can refine an exportable fly asset later. Animation and engineered body control will be labeled separately from neural simulation; a moving mesh is not evidence of biological movement or learning.

## Open source

Original project code and documentation are available under the [MIT License](LICENSE). Connectome datasets, dependencies, and externally sourced assets retain their own terms and require separate attribution. The welfare charter guides this project's development and acceptance of contributions; it does not add restrictions to the MIT license.

## Tailscale DNS access

For access through the machine’s private Tailscale DNS name, copy `.env.example` to `.env`, set `HOST=0.0.0.0` and `ALLOWED_HOSTS` to your exact machine hostname (without scheme, port or trailing dot), then run `pm2 startOrRestart ecosystem.config.cjs --only fly-garden`. Open `http://your-machine.your-tailnet.ts.net:8790/` from your tailnet. This bind listens on all IPv4 interfaces; use it on the intended private network, without public port forwarding.

Both npm and PM2 load the ignored local `.env` file. Loopback remains allowed, other Host names are rejected, and browser mutations require the same origin or an explicitly configured development origin. Host validation is not authentication; Tailscale network access controls remain the access boundary. No wildcard `.ts.net` permission is needed.

## Planned shared habitats

The roadmap includes separate male (MaleCNS v1.0) and female (BANC v888) connectome profiles, each preserving its own identity and neural state. Population capacity will be configurable for available hardware: one by default, two as the first shared-habitat validation, and larger populations only within measured budgets. Flies may interact through supported environmental senses, make music or pollen art, rest independently, and visit Eidoverse under separate grants. The app now supports independently loaded synthetic fixtures with a default resident ceiling of one, plus an explicit [two-fixture shared garden](docs/SHARED_BROWSER.md) when capacity admits both. Joining and joint restore stay paused; separate controller cameras supply a complete atomic batch. Biological shared-habitat capabilities remain planned. Lightweight fixture tests do not validate full-dataset populations. See PRD FR-36–40 and the issue tracker.
