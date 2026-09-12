# Optional richer body feasibility

Assessment: September 12, 2026. Issue #15. **Local CPU contact physics and a disclosed preprogrammed walking controller are feasible in the tested configuration. A neural walking/olfaction adapter is not ready for the observatory.** Three offline neutral-posture probes, two bounded CPG gait runs and a matching constant-stance comparison completed with finite state and ground-contact readouts. None used a neural model, learned controller, reward, punishment, deprivation, pursuit, training, GPU, provider call or app simulation. Settling displacement is not walking.

## Pinned implementation and provenance

The evaluated package is **FlyGym 2.1.0**, official tag `v2.1.0`, commit `ca65a510c2afe6ac61c51df4f274c8d190c2f95f`. Its PyPI wheel SHA-256 is `3ba7292683c1be73897b7f5585612ff57fb9eec28381178efbc0e4368c0e46fd`. The wheel's license expression and included license are Apache-2.0, copyright NeuroMechFly v2 Authors. MuJoCo 3.9.0 and its bindings are Apache-2.0; its bundled third-party notices still apply. The original harness in this repository is MIT. See [FlyGym release metadata](https://pypi.org/project/flygym/2.1.0/), [pinned FlyGym license](https://github.com/NeLy-EPFL/flygym/blob/v2.1.0/LICENSE), and [MuJoCo license](https://github.com/google-deepmind/mujoco/blob/3.9.0/LICENSE).

The package requires Python `>=3.12,<3.15`; the probe used Python 3.13.15, FlyGym 2.1.0, MuJoCo 3.9.0, NumPy 2.5.3 and SciPy 1.18.1. All 47 installed distributions are pinned in [requirements-body.txt](../research/requirements-body.txt). Package licenses remain separate: NumPy declares BSD-3-Clause/0BSD/MIT/Zlib/CC0 components; SciPy and Numba include BSD notices; Matplotlib has its own license. `imageio-ffmpeg`'s wrapper declares BSD-2-Clause, but that does not describe every bundled FFmpeg component. No FFmpeg executable was invoked or redistributed. Review transitive notices before packaging a distributable body backend.

Only NeuroMechFly's **bundled simplified meshes** were used in the isolated research process. No fly assets were copied into the app or committed. The pinned constructor defaults to `SIMPLIFIED_MAX2000FACES`; selecting `FULLSIZE` would invoke separate lazy asset acquisition. The probe specifies the bundled choice and blocks socket connections. Its output hashes 57 packaged NeuroMechFly asset/configuration files; the canonical sorted manifest hash was `149f17838f4cada3a75a9178f7686e6a0a436ae00210b46d139b0e27e84476d5`. This choice simplifies body meshes, not a neural graph; no connectome was loaded. See the [pinned body constructor](https://github.com/NeLy-EPFL/flygym/blob/v2.1.0/flygym/compose/fly/neuromechfly.py).

FlyGym 2.x is a redesigned composition/simulation API, incompatible with the older Gymnasium-style API. Older examples belong to the separately maintained `flygym-gymnasium` package. Do not combine their imports or checkpoint assumptions. Official [migration notes](https://neuromechfly.org/migration/) explain this boundary; [installation guidance](https://neuromechfly.org/installation/) supports isolated environments and optional GPU dependencies. No GPU extras were installed here.

## Measured CPU/contact envelope

Machine class: Apple M5 Max, arm64 macOS kernel 25.6.0, 128 GiB physical memory. This is a measurement on one machine, with other local work potentially running, not a minimum-hardware claim. No rendering or vision sampling was included.

The three neutral-posture runs used 0.1 ms fixed physics steps, the `ALL_BIOLOGICAL` joint preset, `ROLL_PITCH_YAW` axes, 42 leg position actuators, constant neutral targets and gain 50. Default bounded actuator forces and contact parameters came from the pinned package. The compiled model had 133 position coordinates, 132 velocity coordinates, 70 bodies and 69 meshes. No controller sought forward motion.

| Run | Simulated time | Load wall time | Stepping wall / CPU | Simulated-to-stepping-wall ratio | Process peak RSS | Samples with leg contact |
|---|---:|---:|---:|---:|---:|---:|
| First invocation | 0.100 s | 18.940 s | 0.0674 / 0.0667 s | 1.485 | 312.89 MiB | 886 / 1000 |
| Repeated invocation | 0.100 s | 0.536 s | 0.0710 / 0.0702 s | 1.409 | 292.17 MiB | 886 / 1000 |
| Longer smoke | 1.000 s | 0.509 s | 0.7817 / 0.7676 s | 1.279 | 294.56 MiB | 9886 / 10000 |

The first invocation included first-use import/font-cache work; its total process wall time was 19.020 s and CPU time 2.146 s. Longer-smoke total wall/CPU time was 1.295/1.444 s. CPU timing can exceed wall timing during threaded initialization. These throughput values include per-step finite-state/contact/resource checks, and exclude neural computation, rendering, JSON transport, checkpointing and paired individuals.

All runs reported zero MuJoCo warnings; up to six legs registered contact. The two 1000-step runs produced the identical qpos byte hash `6f3372c85d9fc69b26cbb82f7cf5a35d6ff1be5124f44ea7520ccc9922ab16ff`. This is exact replay evidence for these runs only, not cross-platform determinism. At 1 s the thorax was approximately `(0.5844, 0.00174, 1.1108)` mm after beginning at `(0.496, 0, 2)` mm. The constructor's spawn offset is not itself the thorax's global coordinate. The movement records initialization settling, not learned locomotion.

## Adapter mapping and unresolved integration gates

| Existing Fly Garden contract | Candidate FlyGym 2.1.0 interface | Required boundary |
|---|---|---|
| Versioned single 8×4 RGB controller raster | `add_vision()`, `get_raw_vision()` for two eyes; optional `get_ommatidia_readouts()` | New explicit binocular/raster transform, units and orientation. Rendering was not benchmarked; no automatic substitution. |
| Bounded forward/yaw fixture readout | `set_actuator_inputs()` in declared joint order | A separately labeled low-level walking controller is needed. Forward/yaw cannot be passed directly as joint angles or torques. |
| Declared geometry contact proxies | `get_ground_contact_info()` and body-segment contact forces | Contact channels need bounds, calibration and source labels. Forces must not be treated as pain, welfare or reward. |
| Optional scent catalog through shared policy | No olfactory API found in inspected 2.1.0 Python/configuration sources | Leave unavailable or implement a separately documented environmental field adapter; do not invent receptor mappings. |
| 5 ms fixture interval and stale-input pause | `Simulation.step()` at 0.1 ms | Exactly 50 physics substeps per 5 ms barrier; no catch-up or dropped steps. Aggregate neural/body cost remains unmeasured. |

These interfaces were read in the [pinned simulation source](https://github.com/NeLy-EPFL/flygym/blob/v2.1.0/flygym/simulation.py); the absence of an olfactory API is a source-inspection finding for this version, not a claim that all FlyGym versions lack olfaction. The official [composition tutorial](https://neuromechfly.org/tutorials/1a_basic_model_composition/) describes explicit actuator/joint ordering and body/world construction. The follow-up below calls the separately disclosed [official CPG controller](https://neuromechfly.org/tutorials/4a_cpg_controller/) through its installed APIs; its implementation was not copied into this repository.

Body selection must require an explicit paused transition and validate a separate body model ID/version, mesh/configuration hashes, skeleton/axis order, actuator order, units, solver/timestep and controller parameters. Physics qpos/qvel/control/activation state and controller phase must accompany neural identity/RNG/learning lineage. Existing fixture checkpoints explicitly have unsupported embodiment and cannot be interpreted as FlyGym checkpoints. Numeric neuron IDs must remain dataset-namespaced; no anatomical neural-to-joint mapping was established. Until these gates are implemented, keep the original procedural Three.js body selectable and the richer body unavailable in the live app.

## Bounded engineered walking evaluation

The follow-up calls the pinned package's `make_locomotion_fly`, `PreprogrammedSteps`, `make_tripod_cpg_network`, `CPGController.step` and `apply_locomotion_action` APIs. These implement an engineered six-oscillator tripod gait mapped onto preprogrammed leg trajectories. They are not a neural connectome, a learned policy or evidence of retained learning. Source provenance is [the v2.1.0 controller package](https://github.com/NeLy-EPFL/flygym/tree/v2.1.0/flygym_demo/complex_terrain), under the FlyGym Apache-2.0 license. No controller code or trajectory assets are redistributed here.

The installed preprogrammed trajectory asset comes from the package's v1 walking recordings and applies its documented v2 anatomical sign conversion. Its SHA-256 is `1e5b28bb6b3f50ac95a04773ea37af28d05e26d03bd90fdba57fa1b3eacfaf8c`. Upstream reads this bundled file with pickle; the harness rejects any other byte hash before invoking that API. Static pickle opcode inspection found only NumPy scalar/dtype/array reconstruction globals. It accepts no external trajectory path. Each report also hashes `common.py`, `cpg_controller.py` and `preprogrammed.py` to identify the exact executed implementation.

Both gait runs and the matching stance comparison used the same legs-only body, yaw/pitch/roll axes, 42 position actuators plus six adhesion actuators, position gain 45, force range ±65 in model units, adhesion gain 40, and fixed 0.1 ms steps. Compiled dimensions were 73 qpos/72 qvel, 69 bodies and 69 meshes. Seed 0, 12 Hz oscillators, amplitude 1, coupling 10 and convergence 20 were fixed. Each invocation contained 500 constant-stance settling steps followed by 9500 gait steps (or 9500 further constant-stance steps for the comparison). There was no optimization, task reward or aversive input. The package's default simplified bundled mesh was verified; no rendering or downloads occurred.

| Evaluation | Stepping wall / CPU | Peak RSS | Post-settling thorax displacement x/y | Minimum sampled height / body-up z |
|---|---:|---:|---:|---:|
| CPG first run | 1.8008 / 1.7494 s | 327.41 MiB | 12.5237 / 3.0130 mm | 0.7697 mm / 0.98881 |
| CPG repeated | 1.6549 / 1.6325 s | 304.78 MiB | 12.5237 / 3.0130 mm | 0.7697 mm / 0.98881 |
| Matching constant stance | 0.7500 / 0.7429 s | 302.94 MiB | 0.000397 / 0.00000047 mm | 1.15825 mm / 0.99985 |

Each completed exactly 10000 physics steps, nominally 1 second, with finite qpos/qvel/contact values and zero MuJoCo warnings. Repeated gait qpos hashes matched exactly: `2078f082038f94383e2ac71ba6bb01b62605148919d94a922a04479272e8e477`. The repeated gait load took 0.5847 s; total wall/CPU was 2.2433/2.4139 s. Its simulated-to-stepping-wall ratio was 0.6043, below real time on this machine with Python diagnostics. This is a material cost increase over static stance and excludes vision, neural work and transport.

All runs had contact in 9880 of 10000 samples, including settling. At the saved 10 ms sampling interval, individual leg contact re-entry counts were `[11, 10, 4, 11, 11, 7]` during gait and zero during held stance. Raw 0.1 ms contact transitions were much more numerous (hundreds per leg), reflecting contact chatter; they must not be labeled biological footsteps. The sampled body-up value stayed above 0.9888 (about 8.6 degrees from upright), while repeated contacts and displacement clearly differed from passive stance. Together these support **a short engineered contact-supported walking demonstration**, not mere settling. They do not establish biological gait fidelity, slip-free locomotion, a robust long-duration controller, precise straight-line tracking (there was lateral drift), terrain generalization or neural embodiment. Height/orientation summaries are sampled, not a proof of stability between samples. Contact readouts alone do not establish welfare or subjective experience.

## Reproduce without starting the app

From the repository root, using an installed Python 3.13 and `uv`:

```sh
uv venv --python 3.13 .venv-body
uv pip install --python .venv-body/bin/python --only-binary :all: -r research/requirements-body.txt
.venv-body/bin/python research/body_smoke.py --run --steps 1000 --output artifacts/body-feasibility/neutral-1000.json
.venv-body/bin/python research/body_smoke.py --run --steps 10000 --output artifacts/body-feasibility/neutral-10000.json
.venv-body/bin/python research/body_smoke.py --run --controller cpg --steps 10000 --output artifacts/body-feasibility/cpg-10000.json
.venv-body/bin/python research/body_smoke.py --run --controller cpg-stance --steps 10000 --output artifacts/body-feasibility/cpg-stance-10000.json
```

[body_smoke.py](../research/body_smoke.py) refuses to run without `--run`, rejects global environments and unreviewed FlyGym/MuJoCo versions, bounds step count, checks finite state and samples a 1.5 GiB process-memory ceiling. It stops further steps after 60 wall seconds; this sampled guard is not an OS-enforced allocation cap during model construction. It writes metrics, exact dependency versions and asset hashes to ignored local artifacts. It never attaches to an app identity or changes its checkpoint. Binary-wheel availability on another platform may differ; do not infer universal infeasibility from one installation failure.

## Flight remains separate research

These contact results establish no aerodynamic flight. A model containing wings or a flight pose does not supply validated lift/drag, wingbeat control, aerodynamic force coupling or a compatible neural readout. Those require their own licensed model, numerical validation, local performance measurements and explicit welfare-preserving test protocol. No flight controller, enforced flight task or extra asset acquisition was attempted.
