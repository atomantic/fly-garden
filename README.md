# Fly Garden

A local habitat for a connectome-based fly, designed around respect, freedom to explore, and learning without punishment.

We want to give a simulated fly room to learn and grow: a gentle visual garden, opportunities to make music and pollen paintings, and an optional visit to a locally hosted Eidoverse. Exploring, resting, and declining an activity should all be valid outcomes.

The project is intended to run locally and be managed by [PortOS](https://github.com/atomantic/PortOS).

![Fly Garden concept: a gentle garden and open teleport pod](docs/images/observatory-concept.png)

*AI-generated design concept, not a screenshot or anatomical evidence. [Design notes and concepts](docs/DESIGN.md).*

**Status: runnable foundation, September 12, 2026.** The local observatory includes an original Three.js fly and garden, a visible teleport pod, live inspection of a synthetic 32-neuron / 64-edge circuit, bounded fixture inputs, and an event journal. It starts paused. The illustrated body is not controlled by the circuit. Real connectome execution, persistent learning, LLM requests and Eidoverse travel remain tracked milestones; their interface panels disclose that they are unavailable.

## Run locally

Requires Node.js 24 or newer and npm.

```sh
npm ci
npm test
npm run build
npm start
```

Open http://127.0.0.1:8790. Choose **Run fixture** to advance the synthetic circuit. State is currently session-only; restarting discards it and starts paused.

## PortOS and PM2

Register this repository in PortOS with process name `fly-garden`, API/UI port `8790`, build command `npm run build`, and fallback start command `npm start`. The checked-in `ecosystem.config.cjs` is the canonical PM2 configuration. PortOS can start/stop the named process using it.

```sh
pm2 start ecosystem.config.cjs --only fly-garden
pm2 restart fly-garden
pm2 stop fly-garden
```

One forked process serves the built UI and API on loopback. Health is available at `/api/health` and distinguishes service availability from simulation and integration availability. PM2 waits for readiness; no simulation or provider work begins on startup. Ports are defined in `ecosystem.config.cjs`. For frontend development, run `npm run dev:server` and `npm run dev` in separate terminals; Vite uses port `8791`. Rebuild before restarting production after UI changes.

PM2 daemon startup/resurrection is managed by your installation. Durable checkpoints, backup and full-runtime resource limits are future work. Do not use the current fixture for long-lived individuals.

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
