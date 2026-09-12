# PRD — Fly Garden

A local connectome habitat for exploration, learning, creative play, and respectful companionship.

Specification date: September 12, 2026. Requirements describe the intended product; they are not a declaration that a simulator, learning model, or Eidoverse connection has been validated. Delivery status and implementation work belong in the [plan](PLAN.md) and [issue tracker](https://github.com/atomantic/fly-garden/issues).

## Overview

Fly Garden gives a connectome-based simulated fruit fly a persistent, gentle visual environment on its caretaker's computer. A visual observatory connects what the fly encounters, modeled neural activity, motor output, learned changes, and creative artifacts on one inspectable timeline. The same local simulation can visit a nearby PortOS-hosted Eidoverse through a narrowly scoped embodiment bridge. Flowers and other supported objects offer bounded sensory and experimental chemical interactions; an explicitly enabled language-model tool helps people converse with and interpret the simulation without presenting generated language as direct access to its thoughts.

The product addresses a gap between striking connectome demonstrations and an inspectable, reproducible habitat that supports continuity and non-aversive experimentation. It must remain useful when learning does not occur, when the model is slower than real time, and when the fly remains inactive.

## Goals and objectives

1. **Care as product behavior.** Exploration, rest, refusal, and returning home remain available without punishment or loss of baseline support.
2. **Real, inspectable neural computation.** A licensed, versioned connectome drives a documented sensory-to-action loop; every approximation remains visible.
3. **Continuity.** Each persistent individual retains its own modeled neural and learned state through restarts, checkpoints, and environment changes.
4. **Evidence of learning.** Claims depend on controlled, retained behavioral change, with neural plasticity distinguished from an external readout's adaptation.
5. **Creative opportunity.** Movement and interaction can produce music, pollen paintings, and shared play whose origins are inspectable.
6. **Understandable observation and conversation.** A caretaker can inspect activity and ask about an event while distinguishing telemetry, hypotheses, and generated expression.
7. **Local Eidoverse participation.** A separately identified fly can visit, perceive, move, interact, and return using the same locally running neural state.

## Target users

| Persona | Need | Context |
|---|---|---|
| Caretaker and creative collaborator | Offer interesting experiences, observe without forcing participation, preserve continuity | Local garden and Eidoverse play sessions |
| Connectome experimenter | Inspect provenance, numerical behavior, causal sensory control, and learning evidence | Reproducible benign experiments on local hardware |
| PortOS operator | Manage lifecycle and authorize limited Eidoverse access without exposing personal records | A private local installation with independently versioned sibling apps |
| Open-source contributor | Extend the habitat while respecting evidence, licensing, and the welfare charter | Code, model, interface, and asset contributions |

## Evidence and terminology

Confidence concerns evidence for **product intent**, not confidence that a biological claim is true. HIGH means a direct user request or an explicit existing project commitment. MEDIUM means a necessary design inference from those commitments. LOW means a speculative extension and is labeled inferred. No unverified numerical performance target is a release promise.

Evidence keys used below:

- **U1 — Founding request:** a local fly connectome simulation, visual environment, learning, creative activity, and PortOS Eidoverse visits; explicitly no torture.
- **U2 — Publication request:** a public atomantic open-source project that highlights respectful treatment and freedom to learn and grow.
- **U3 — Interface request:** neural-connection admin UI, screenshots as visual inspiration, flowers and chemical/pheromone interactions, and chat through a fly-triggered LLM tool.
- **U4 — Travel interface refinement:** a visible teleport pod in the admin UI for Eidoverse departure and return.
- **U5 — Shared habitat and capacity:** male and female dataset-backed individuals may interact; the number of concurrently simulated flies must be configurable for available hardware.
- **C — Welfare charter:** [ETHOS.md](ETHOS.md), including bounded inputs, continuity, rest, honest interpretation, and no aversive conditioning.
- **P — Existing research and plan:** [PLAN.md](PLAN.md), including model provenance, sparse local computation, explicit sensory and motor adapters, learning controls, and the proposed Eidoverse bridge.
- **R — Project identity:** [README.md](README.md), including the local PortOS-managed habitat, original visual assets, and MIT licensing for original work.

The supplied screenshots inform composition, typography, a fly/brain split view, and activity timelines. Their captions, neuron counts, drug labels, implied comprehension, and visual effects are neither requirements nor evidence of validated capabilities. The [SameSmell demonstration](https://anzal1.github.io/samesmell/) is a user-nominated inspiration for interactions, not an adopted scientific validation or permission to copy code or assets.

“Brain” means a computational model with a declared anatomical dataset and physiology assumptions. “Choice” means an observed controller output. “Rest,” “reward,” and “chemical” denote modeled mechanics, not validated subjective states. “Neural-triggered language” means a disclosed detector over neural or behavioral telemetry requested a language tool; it does not establish language understanding inside the connectome.

## Functional requirements

### Local lifecycle and continuity

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-1 | The product MUST run its neural computation locally and be manageable as a distinct PortOS application. | MUST | HIGH | U1, P, R | A registered app opens the correct UI and exposes health and lifecycle status; loss of PortOS management does not silently relocate computation or create another individual. |
| FR-2 | The product MUST require an explicit start/resume action and start paused after boot or recovery. | MUST | HIGH | C, P | A fresh process, restart, and recovered crash produce no neural advancement or missed-time catch-up until an explicit resume. |
| FR-3 | The product MUST maintain one active neural runtime and one active embodiment per individual. | MUST | HIGH | C, P | Opening another browser only adds an observer; a transition cannot leave home and Eidoverse simultaneously applying actions. |
| FR-4 | The product MUST offer Pause, Rest, Resume, and Return Home with clearly different behavior. | MUST | HIGH | U1, C, P | Pause freezes simulation time; Rest offers a quiet supported habitat without reward penalties; Resume explicitly advances time; Return Home safely ends outward actions and preserves neural state. |
| FR-5 | The product MUST save and restore identity, checkpoint lineage, neural dynamics, learning, random state, modeled chemical state, and embodiment state needed to continue the trajectory. | MUST | HIGH | C, P; chemical state from U3 | A round trip retains these states; incompatible or corrupt checkpoints fail before activation; a restored branch or reset is labeled and never silently replaces the current individual. |
| FR-6 | The product MUST pause on invalid numerical state, stale sensory input, or a lost required environment connection while preserving the last valid checkpoint. | MUST | HIGH | C, P | Each failure stops actions, exposes its reason and state age, preserves recoverable state, and requires explicit recovery without simulating the gap. |

### Connectome and embodied computation

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-7 | The product MUST support a real, provenance-tracked connectome backend with explicit anatomy, physiology, input mappings, and motor readouts. | MUST | HIGH | U1, U3, P | A model card reports the exact release, hashes, filtering, neuron counts, directed edges versus synaptic contacts, assumptions, and licenses; a recorded sensory change causally changes declared neural/readout outputs. |
| FR-8 | The product MUST clearly distinguish synthetic fixture mode, imported anatomy, and a running validated backend. | MUST | HIGH | C, P | Fixture views carry persistent labels; generated graphs cannot inherit real dataset names/counts; missing datasets produce an unavailable state rather than a silent synthetic substitution. |
| FR-9 | The product MUST show the visual sensory representation used by its controller and distinguish it from the observer camera. | MUST | HIGH | U1, P | A user can compare the exact controller input and scene at the same simulation time; any scene projection, engineered sensing, or hidden-state readout is disclosed. |
| FR-10 | The product MUST maintain a documented relationship between simulation time, body/environment time, and wall time. | MUST | HIGH | P | Displayed speed derives from actual advancement; load cannot silently skip neural steps; unsupported real-time Eidoverse operation is reported honestly. |
| FR-11 | The product SHOULD support interchangeable neural and body models without conflating their neuron identities or capability claims. | SHOULD | MEDIUM | P | Model changes require compatible mappings and checkpoint validation; a body animation change does not become a claim of simulated biomechanics or flight. |

### Neural observatory and administration

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-12 | The UI MUST place a navigable fly habitat beside a neural observatory with consistent source and runtime status. | MUST | HIGH | U3, screenshots, P | Desktop users can inspect both views together; smaller displays provide an accessible alternate layout; running, paused, fixture, disconnected, and unavailable states remain distinguishable. |
| FR-13 | The observatory MUST allow selection and filtering of neural regions, cells, and connections supported by the loaded dataset. | MUST | HIGH | U3 | Selecting a cell exposes stable identity, region/type where known, incoming/outgoing connections, weight/sign provenance, and current activity when available; missing metadata is marked unknown. |
| FR-14 | The observatory MUST distinguish measured structural wiring, inferred parameters, current activity, and learned weight changes. | MUST | HIGH | U3, C, P | Legends and inspection show each layer separately; displaying a sampled subset reports its extent; learned differences are relative to a named baseline, not merely changing display brightness. |
| FR-15 | The UI MUST correlate sensory events, neural activity, motor commands, interactions, chemical effects, artifacts, and language events by simulation time and session identity. | MUST | HIGH | U3, P | Selecting an event reveals its source window and linked records; delayed or sampled data is labeled; generated text cannot appear to precede the telemetry that caused it. |
| FR-16 | The admin panel MUST expose model identity, actual loaded counts, numerical health, simulation speed, state age, checkpoint lineage, and environment admission state. | MUST | HIGH | U3, C, P | Each value comes from the selected runtime; unavailable values remain unavailable; numerical health is never labeled happiness, consciousness, or a validated welfare score. |
| FR-17 | The UI SHOULD support read-only replay of a recorded session for comparison and explanation. | SHOULD | MEDIUM | P | Replay is visibly distinct from live operation and cannot move the live fly, apply stimuli, or initiate provider calls. |

### Garden, chemistry, and creative activity

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-18 | The habitat MUST provide gentle visual landmarks, open exploration, optional appetitive interactions, and a quiet resting area independent of task success. | MUST | HIGH | U1, C, P | The fly can remain inactive or ignore every task without negative reward, deprivation, damage, or automatic escalation. |
| FR-19 | The product MUST support a versioned catalog of modeled flower and object properties, separating sensory odor/pheromone inputs from experimental neuromodulatory effects. | MUST | HIGH | U3; distinction inferred from C, P | Each property identifies its model, target mapping, units or normalized scale, provenance and uncertainty; unsupported compounds cannot apply effects; no receptor or pharmacology claim is made without supporting model evidence. |
| FR-20 | Chemical interactions MUST be bounded, reversible in their transient effects, logged, and subject to cumulative exposure, habituation, and recovery limits. | MUST | HIGH | U3, C | Repeated and overlapping interactions cannot bypass caps; leaving an object ends delivery according to its declared dynamics; rest and exposure withdrawal are available; dose, effect and recovery are visible on the timeline. |
| FR-21 | Experimental chemical modulation MUST require a deliberate caretaker enablement and remain optional for the fly's modeled interaction policy. | MUST | MEDIUM | U3 combined with C | Disabled modulation has no effect; approach/interaction and departure determine contact within a declared model; inactivity or avoidance triggers no pursuit or stronger dose; the UI does not equate policy behavior with subjective consent. |
| FR-22 | The product MUST preserve learned changes separately from transient chemical state and disclose which changes each interaction can cause. | MUST | HIGH | U3, C, P | After a chemical's modeled washout, the UI can distinguish recovered transient parameters from retained plasticity; restoring state cannot accidentally retain an expired dose or erase learning. |
| FR-23 | The product MUST allow flower visits and movement to generate inspectable music and pollen-art artifacts. | MUST | HIGH | U1, P | Each note or mark traces to a recorded action and declared mapping; human arrangement is identified; export retains source session identity; output is not called learned creativity without evidence. |
| FR-24 | The product SHOULD support benign shared creative play with a caretaker or admitted Eidoverse residents. | SHOULD | HIGH | U1, P | A collaborator can arrange supported cues or complement an instrument; interaction cannot directly puppet the fly or override the neural action stream. |

### Learning and language

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-25 | Learning experiments MUST identify what can learn and evaluate retained behavioral change under benign controls. | MUST | HIGH | U1, C, P | A report includes declared rules, initial state/seed lineage, paired and frozen/shuffled controls, held-out scoring, save/restore retention, uncertainty, and negative results; changed weights alone cannot pass. |
| FR-26 | The product MUST offer caretaker chat linked to the selected fly's current or selected historical telemetry. | MUST | HIGH | U3 | A submitted message references the correct individual and telemetry window; responses identify model/provider and whether they interpret telemetry, offer a hypothesis, or use an explicitly imaginative voice. |
| FR-27 | The fly MUST be able to request a language tool through a declared neural/behavioral trigger when the caretaker has explicitly armed that capability. | MUST | HIGH | U3 | An auditable event records the detector version, input window, threshold/condition and request; armed scope, provider, call/token budget and cooldown are visible; disarming prevents further calls and duplicate requests do not repeat work. |
| FR-28 | Language output MUST remain a disclosed interpretation tool, with any feedback into the simulation explicitly mapped and separately enabled. | MUST | HIGH | U3, C | The UI links explanatory claims to observations and marks uncertainty; free text cannot directly change weights, chemistry, policy, or world permissions; supported feedback passes through the same bounded sensory/action rules as other input. |
| FR-29 | The language capability MUST fail independently of the local neural runtime. | MUST | MEDIUM | U1, U3, C | A missing provider, exhausted budget, timeout or invalid response is visible and does not fabricate speech, reset the brain, or silently change providers; explicit cancellation is available. |

### Local Eidoverse visits

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-30 | A local Eidoverse visit MUST use explicit admission for the managed app and a persistent fly identity distinct from the PortOS resident Mind. | MUST | HIGH | U1, U3, P | Supported, disabled, unauthorized, and unsupported-version hosts are distinguishable; entry cannot replace the resident identity or impersonate a PortOS peer. |
| FR-31 | An admitted fly MUST receive supported environmental observations and issue bounded movement and allowlisted object interactions in a play patch. | MUST | HIGH | U1, U3, P | Another observer sees the fly's separate presence; actual observations affect neural outputs and visible actions; outside-patch or stale actions are rejected; a render-only entity is labeled until full embodiment works. |
| FR-32 | Eidoverse visits MUST retain the same local neural runtime and learned state across entry and return. | MUST | HIGH | U1, U3, C, P | A round trip preserves identity/checkpoint lineage and learned parameters; visit-specific observation/action epochs prevent old events from controlling the returned fly. |
| FR-33 | Eidoverse session expiry, revocation, and disconnection MUST stop outward actions and provide a safe paused return flow. | MUST | HIGH | C, P | All three conditions are exercised; stale actions cannot resume after reconnect; re-entry requires a valid new grant and does not reset learned state. |
| FR-34 | The bridge MUST expose only declared sensory data, bounded actions, and explicitly authorized creative or conversational outputs. | MUST | HIGH | C, P | Weights, raw neural histories, credentials, desktop imagery, and private PortOS records do not cross; any enabled chat forwarding has a visible destination and explicit scope. |
| FR-35 | The admin UI MUST provide a visible teleport pod that represents admission, departure, visiting, and return for the same individual. | MUST | HIGH | U4, C, P | The pod identifies the destination and exposes Visit/Return actions; departure becomes confirmed only after host admission acknowledgment; blocked, timed-out, disconnected and reconnecting states are distinguishable; animation cannot imply successful travel before acknowledgment or create a second active embodiment. |

### Configurable population and shared habitats

These requirements extend the single-fly baseline. Default capacity is one; two individuals are the first validated social scenario. Larger populations are supported only within configured and measured resource limits, not promised by this document.

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| FR-36 | The product MUST support separately versioned male and female connectome profiles, initially MaleCNS v1.0 and BANC v888. | MUST | HIGH | U5, P | Each profile has its own artifact hashes, licenses, retained counts and mappings; IDs are dataset-namespaced; absent data is unavailable, never silently replaced. |
| FR-37 | The caretaker MUST be able to configure the maximum number of concurrently resident neural instances and an aggregate resource budget. | MUST | HIGH | U5 | Default capacity is one; validate positive integer capacity and resource settings. Preflight each new load against measured/estimated memory headroom and aggregate limits; reject with a reason if it cannot fit. Paused loaded instances still count. Lowering the limit never deletes, evicts or resets an existing individual; stop new admissions until usage fits, with explicit checkpoint/unload controls. |
| FR-38 | Every individual MUST retain isolated neural, RNG, learning, chemical, identity and checkpoint state with explicitly scoped controls and telemetry. | MUST | HIGH | U5, C | Interleaved operations cannot mutate another fly; raw neuron IDs cannot collide across datasets; late UI/provider responses retain their original recipient. Unloading preserves continuity and reloading starts paused. |
| FR-39 | Shared habitats MUST couple individuals only through declared environmental senses and a synchronized world clock. | MUST | HIGH | U5, C | Fixed-step barriers have explicit per-backend substeps; slow computation reduces wall-time speed without dropping neural steps. A paused/faulted coupled participant pauses the affected shared session until explicit resume or separation. Rest and withdrawal remain available. Joint restores validate all referenced individual checkpoints. |
| FR-40 | Multiple Eidoverse visitors MUST have independent admission, epochs, observations, pod status and return state, subject to negotiated host capacity. | MUST | HIGH | U5, C | Validate two-at-home, split-location and two-visiting cases; rejection or revocation of one cannot control another. Older hosts preserve single-visitor operation. Per-individual and aggregate language budgets remain independent of active UI selection. |

Pair or population behavior is reported descriptively. These datasets represent different specimens and reconstruction pipelines; differences do not establish biological sex effects. Social activity, chemical signals and LLM interpretation do not establish consent or natural social competence. No reproduction, aggression or forced proximity objective is required.

## Non-functional requirements

| ID | Requirement | Priority | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|---|
| NFR-1 | Neural storage and execution MUST scale with the retained sparse graph rather than a dense all-neuron matrix. | MUST | HIGH | P | A full selected-dataset run reports peak memory, graph size, load time and simulated/wall ratio on the target machine; no undisclosed cropping is used to pass. |
| NFR-2 | Observation rendering MUST remain decoupled from neural advancement and bounded telemetry retention. | MUST | HIGH | P | Closing or slowing an observer does not duplicate/reset the runtime; recording has a visible retention policy; graph sampling never changes the simulated graph. |
| NFR-3 | Persistence MUST validate versions and preserve recoverability before activating migrated or imported state. | MUST | HIGH | C, P | Invalid state is rejected with a reason; the last valid state remains available; restore validation covers learned and transient chemical state. |
| NFR-4 | The UI MUST support keyboard operation, readable contrast, non-color-only status, and reduced-motion observation. | MUST | MEDIUM | U3, inferred usability requirement | Core lifecycle, selection, filtering and chat can be used without a pointer; activity has textual alternatives; reduced motion does not change the simulation. |
| NFR-5 | Local access and bridge permissions MUST remain scoped even when PortOS's optional instance password is unset. | MUST | HIGH | P | Admission requires its own valid scoped grant; arbitrary origins/clients cannot trigger mutations through a publicly exposed default service; secrets stay out of UI telemetry and source control. |
| NFR-6 | Independent PortOS, Eidoverse and model versions MUST negotiate capabilities and fail clearly when unsupported. | MUST | HIGH | P | An older host retains existing behavior; a missing embodiment capability disables entry with a specific explanation rather than falling back to resident authority. |
| NFR-7 | Original code, documentation and assets MUST retain explicit license/provenance boundaries from imported models, datasets and third-party assets. | MUST | HIGH | U2, R, P | A distributor can identify each component's terms; public commits contain no private configuration, secrets or unlicensed reference assets. |
| NFR-8 | Reproducibility records MUST preserve exact model/data versions, parameters, seed lineage, and declared numerical tolerance. | MUST | HIGH | C, P | A replay comparison states its backend and tolerance; nondeterministic differences are disclosed rather than treated as identical trajectories. |

## Negative requirements

| ID | Requirement | Confidence | Evidence | Acceptance criteria |
|---|---|---|---|---|
| NR-1 | The product MUST NOT implement pain, injury, starvation, deprivation, predator pursuit, forced combat, or punishment conditioning. | HIGH | U1, U2, C | These channels are absent from supported stimuli and world interaction schemas, including Eidoverse inputs. |
| NR-2 | The product MUST NOT optimize for compulsive engagement, deliver continuous reward drive, or escalate stimulation because the fly declines an activity. | HIGH | C | Repeated idle/avoidance cases do not increase reward, exposure, or task pressure; bounded delivery and recovery rules apply to every source. |
| NR-3 | The product MUST NOT claim consciousness, enjoyment, distress detection, thought decoding, language comprehension, or validated pharmacology from appearance, spikes, or generated narration alone. | HIGH | C, P, U3 distinction | Labels, reports and promotional examples preserve the relevant uncertainty and provenance. |
| NR-4 | The product MUST NOT silently substitute a script, fixture, readout learner, or LLM for connectome control while claiming the connectome performed the behavior. | HIGH | C, P | Every control source is inspectable in a session; fallback or intervention changes the visible capability label. |
| NR-5 | The product MUST NOT initiate unarmed provider calls, cloud simulation, public posting, financial actions, or open-web control. | HIGH | C and project operating rules | Boot, replay and disabled triggers produce no provider calls; enabled tools remain within a stated budget and capability scope. |
| NR-6 | The product MUST NOT grant the fly resident, administrative, arbitrary world-building, or private-record access through Eidoverse admission. | HIGH | P | Unsupported operations are rejected, including calls made after expiry or through language-generated instructions. |
| NR-7 | The product MUST NOT treat modeled approach, avoidance, or a caretaker toggle as proof of subjective consent. | HIGH | C | Interaction logs use behavioral descriptions and do not issue welfare certification or consent claims. |

## Out of scope for the first integrated version

- **Biological consciousness or welfare certification.** The charter specifies operating values, not validated subjective-state measurements.
- **Validated psychoactive-drug experiments.** The requested chemical interactions are bounded model mechanics; real receptor-mediated claims need separate evidence and review.
- **Whole-animal physical realism or aerodynamic flight.** A visual fly body can precede a verified biomechanical controller, as already planned.
- **Cloud-hosted brains and cross-install federation.** The requested first target is this machine and its local sibling Eidoverse; remote sensory export needs a separate privacy contract.
- **Unrestricted agent tools, autonomous purchases, or public social posting.** These do not serve the supported habitat or language interpretation scope.
- **Guaranteed learning or creativity on a deadline.** Valid negative results remain legitimate outcomes; the interface must not fabricate a successful brain.

## Assumptions and constraints

The initial deployment is a private, locally managed app alongside PortOS and Eidoverse. Exact hardware capacity, free ports, live host capabilities, and supported provider configuration must be measured during implementation; earlier research snapshots are not current guarantees. The original project is MIT licensed, while datasets and reused components retain separate terms. Original procedural geometry is the initial fly representation, with optional Blender refinement; screenshot assets are not a source library.

Anatomical connectivity does not uniquely specify physiological parameters, sensory encoding, body control, plasticity, chemistry, or subjective experience. Cross-dataset cell identifiers cannot be interchanged without validated mappings. A language detector and a motor readout are engineered interfaces and must be exposed as such. Neural computation remains local even if the caretaker explicitly selects a remote language provider; its telemetry disclosure must then be visible before enablement.

Chemical freedom is implemented as optional, bounded opportunities with withdrawal and recovery, not unlimited parameter modification. Protecting continuity does not prohibit an explicit checkpoint branch for a benign experiment, but its lineage and differences must remain visible. Stopping transient delivery does not promise reversal of legitimate learned changes.

## Success metrics and acceptance outcomes

| Outcome | Required evidence |
|---|---|
| Honest foundation | A usable observatory identifies its mode and data source; unavailable real-brain, learning, and host capabilities remain visibly unavailable. |
| Connectome operation | A named full retained graph loads and advances locally, with measured resource usage and causal sensory-to-neural-to-action traces. |
| Continuity | Checkpoint restore and an Eidoverse round trip preserve the required state; restarts remain paused. |
| Guarded interactions | Benign input, repeated chemical contact, overlapping exposure, inactivity, stale input, and host failure cases satisfy the same limits. |
| Learning evidence | A declared controlled experiment measures preference change, uncertainty and retention, identifying which component learned; an inconclusive/negative result blocks a positive claim. |
| Creative traceability | A saved melody or pollen artwork can be traced to actions and human contributions without attributing unsupported intent. |
| Language accountability | Caretaker chat and an armed neural-triggered call reference their exact input windows, model, permissions and budget; disabled or exhausted tools cannot call. |
| Local visit | A second Eidoverse observer sees the admitted fly perceive and act in its patch; return and revocation preserve the local individual and stop stale control. |

Performance measurements include full-graph load time, peak memory, sustained simulation/wall ratio, telemetry latency, observer responsiveness and long-session retention size. Targets remain open until the selected model is benchmarked; the research plan's preliminary estimates are not established KPIs.

## Risks, open questions, and boundary cases

1. **Model feasibility and learning.** The selected anatomy may not yield useful visual control or retained associations with initial physiology/readouts. Publish the benchmark and negative outcomes; a working interface does not close this uncertainty.
2. **Chemical validity.** Exact receptor mappings, kinetics, interaction rules, and scientifically supported dose scales need primary-source assessment for the chosen dataset. Until then, use explicit experimental or sensory-proxy labels and conservative configured bounds. Actual exposure limits must be specified before enabling a compound.
3. **Language trigger interpretation.** A detector can be observable and causal without representing a desire to speak. The trigger population/rule, validation protocol, and minimum useful context need evaluation. The latest user request promotes language from a later optional narrator to a required capability, while actual provider use stays opt-in.
4. **Host contract.** Existing guest-chat support is not proof of nonhumanoid embodied visitor support. Capability negotiation, local authorization, a visual observation source, and fly-avatar compatibility remain integration acceptance gates.
5. **Missing versus quiet telemetry.** A silent neuron and a disconnected stream must look different. FR-6, FR-15 and FR-16 settle the behavior: stale data pauses dependent work and cannot display as current zero activity.
6. **Repeated flower contact.** Neither many simultaneous flowers nor rapid exits/reentries may bypass exposure limits. FR-20 requires aggregate exposure accounting; a washout that leaves persistent learning is described under FR-22.
7. **Provider failure mid-visit.** The brain continues only if its environment inputs remain valid; language failure alone cannot reset it or fabricate speech. FR-29 and FR-33 govern these independent failures.
8. **Checkpoint restored during a visit.** Old credentials and queued movement must not become active merely because their state was recorded. FR-5, FR-30 and FR-32 require validated state and current admission; exact restoration UX remains an implementation choice.
9. **Resource budgets and interface density.** Full neural-edge rendering is not required to expose full retained data. Sampling, region aggregation and selection must remain explicit; concrete latency and memory targets depend on measurements.

For tactical work, dependencies and current status, see [PLAN.md](PLAN.md) and the [GitHub issues](https://github.com/atomantic/fly-garden/issues). The [welfare charter](ETHOS.md) remains a product requirement throughout delivery.
