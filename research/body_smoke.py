#!/usr/bin/env python3
"""Opt-in, offline, isolated FlyGym 2.1.0 stance/gait contact feasibility probe.
Original Fly Garden harness. No neural runtime, training, reward, rendering or network.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Explicitly run the short local physics probe')
    parser.add_argument('--steps', type=int, default=1000, help='100–10000 fixed 0.1 ms steps')
    parser.add_argument('--controller', choices=['neutral', 'cpg', 'cpg-stance'], default='neutral',
                        help='Explicit engineered gait or matching constant-stance control; no neural control')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.run:
        parser.error('No physics started. Pass --run to explicitly invoke this probe.')
    if not 100 <= args.steps <= 10000:
        parser.error('steps must be between 100 and 10000')
    if args.controller != 'neutral' and args.steps <= 500:
        parser.error('Gait evaluation requires more than 500 steps, including 500 fixed warmup steps.')
    if sys.prefix == sys.base_prefix:
        parser.error('Use an isolated virtual environment; no global installation is supported.')
    if importlib.metadata.version('flygym') != '2.1.0' or importlib.metadata.version('mujoco') != '3.9.0':
        parser.error('This harness requires reviewed flygym==2.1.0 and mujoco==3.9.0')
    # Prevent implicit first-use downloads even if upstream defaults ever drift.
    def no_network(event, _args):
        if event in {'socket.connect', 'socket.getaddrinfo'}:
            raise RuntimeError('Offline body probe refuses network access.')
    sys.addaudithook(no_network)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    os.environ['MPLCONFIGDIR'] = str(args.output.parent / 'matplotlib-cache')
    started = time.perf_counter()
    cpu_started = time.process_time()
    report = {'schemaVersion': 1, 'mode': args.controller + '-contact-smoke',
              'claim': 'Engineered constant neutral posture, not walking, neural control, learning or biological validation.',
              'platform': platform.system(), 'platformRelease': platform.release(), 'architecture': platform.machine(),
              'python': platform.python_version(), 'stepSeconds': 0.0001, 'requestedSteps': args.steps,
              'rendering': False, 'network': 'blocked', 'seed': None,
              'packages': {dist.metadata['Name']: dist.version for dist in importlib.metadata.distributions()}}
    completed = 0
    try:
        import numpy as np
        import mujoco
        from flygym import Simulation
        from flygym.anatomy import AxisOrder, JointPreset, Skeleton, ActuatedDOFPreset, ContactBodiesPreset
        from flygym.compose import NeuroMechFly, FlatGroundWorld, KinematicPosePreset, MeshType
        from flygym.utils.math import Rotation3D
        from flygym import assets_dir
        fly = NeuroMechFly(name='probe', mesh_type=MeshType.SIMPLIFIED_MAX2000FACES)
        skeleton = Skeleton(joint_preset=JointPreset.ALL_BIOLOGICAL, axis_order=AxisOrder.ROLL_PITCH_YAW)
        neutral = KinematicPosePreset.NEUTRAL
        fly.add_joints(skeleton, neutral_pose=neutral)
        actuated = skeleton.get_actuated_dofs_from_preset(ActuatedDOFPreset.LEGS_ACTIVE_ONLY)
        fly.add_actuators(actuated, actuator_type='position', neutral_input=neutral, kp=50)
        controller = None
        warmup_steps = 500 if args.controller != 'neutral' else 0
        if args.controller != 'neutral':
            from flygym_demo.complex_terrain import (make_locomotion_fly, PreprogrammedSteps,
                make_tripod_cpg_network, CPGController, LocomotionAction, apply_locomotion_action)
            import flygym_demo.complex_terrain as gait_package
            gait_root = Path(gait_package.__file__).parent
            trajectory = gait_root / 'assets/single_steps_untethered.pkl'
            # Only the reviewed bundled asset is accepted, never a caller-provided pickle.
            trajectory_hash = hashlib.sha256(trajectory.read_bytes()).hexdigest()
            if trajectory_hash != '1e5b28bb6b3f50ac95a04773ea37af28d05e26d03bd90fdba57fa1b3eacfaf8c':
                raise RuntimeError('Bundled gait asset differs from reviewed FlyGym 2.1.0 wheel.')
            fly = make_locomotion_fly(name='probe', add_adhesion=True, colorize=False)
            preprogrammed = PreprogrammedSteps()
            dof_order = fly.get_actuated_jointdofs_order('position')
            network = make_tripod_cpg_network(timestep=report['stepSeconds'], seed=0,
                intrinsic_frequency=12.0, intrinsic_amplitude=1.0, coupling_strength=10.0, convergence_coef=20.0)
            controller = CPGController(network, preprogrammed, dof_order)
            stance_action = LocomotionAction(preprogrammed.default_pose_by_dof_order(dof_order), np.ones(6, dtype=bool))
            report['claim'] = 'Engineered preprogrammed gait/stance evaluation; not neural control, learning or biological validation.'
            report['seed'] = 0
            report['controller'] = {'implementation': 'flygym_demo.complex_terrain.CPGController',
                'frequencyHz': 12, 'amplitude': 1, 'coupling': 10, 'convergence': 20,
                'trajectorySha256': trajectory_hash, 'warmupSteps': warmup_steps,
                'sourceSha256': {name: hashlib.sha256((gait_root / name).read_bytes()).hexdigest()
                    for name in ['common.py', 'cpg_controller.py', 'preprogrammed.py']},
                'adhesionGain': 40, 'actuatorForceRange': [-65, 65]}
        world = FlatGroundWorld(half_size=10)
        world.add_fly(fly, [0, 0, 0.7], Rotation3D(format='quat', values=[1, 0, 0, 0]),
                      bodysegs_with_ground_contact=ContactBodiesPreset.LEGS_THORAX_ABDOMEN_HEAD)
        simulation = Simulation(world, timestep=report['stepSeconds'])
        report['loadWallSeconds'] = time.perf_counter() - started
        report['model'] = {'nq': simulation.mj_model.nq, 'nv': simulation.mj_model.nv,
                           'actuators': simulation.mj_model.nu, 'bodies': simulation.mj_model.nbody,
                           'meshes': simulation.mj_model.nmesh, 'axisOrder': 'ROLL_PITCH_YAW',
                           'jointPreset': 'ALL_BIOLOGICAL', 'actuatedPreset': 'LEGS_ACTIVE_ONLY',
                           'positionGain': 50, 'pose': 'NEUTRAL', 'meshPreset': 'SIMPLIFIED_MAX2000FACES'}
        if controller is not None:
            report['model'].update(axisOrder='YAW_PITCH_ROLL', jointPreset='LEGS_ONLY', positionGain=45, pose='PreprogrammedSteps default pose')
            apply_locomotion_action(simulation, 'probe', stance_action)
        mujoco.mj_forward(simulation.mj_model, simulation.mj_data)
        thorax_index = next(i for i, segment in enumerate(fly.get_bodysegs_order()) if segment.name == 'c_thorax')
        report['initialThoraxPositionMm'] = simulation.get_body_positions('probe')[thorax_index].tolist()
        initial = simulation.mj_data.qpos.copy()
        physics_started = time.perf_counter()
        physics_cpu = time.process_time()
        contact_samples, maximum_contacts = 0, 0
        contact_entries = np.zeros(6, dtype=int)
        previous_contacts = np.zeros(6, dtype=bool)
        samples = []
        for step_index in range(args.steps):
            if time.perf_counter() - started > 60:
                raise RuntimeError('60-second local wall-time bound exceeded.')
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            rss_bytes = rss if platform.system() == 'Darwin' else rss * 1024
            if rss_bytes > 1536 * 1024 * 1024:
                raise RuntimeError('1.5 GiB process-memory bound exceeded.')
            if controller is not None and step_index >= warmup_steps and args.controller == 'cpg':
                apply_locomotion_action(simulation, 'probe', controller.step())
            simulation.step()
            completed += 1
            if not np.isfinite(simulation.mj_data.qpos).all() or not np.isfinite(simulation.mj_data.qvel).all():
                raise RuntimeError('Nonfinite physics state; probe stopped.')
            contacts = simulation.get_ground_contact_info('probe')[0]
            if not np.isfinite(contacts).all():
                raise RuntimeError('Nonfinite contact readout; probe stopped.')
            if step_index >= warmup_steps:
                touching = contacts > 0
                contact_entries += touching & ~previous_contacts
                previous_contacts = touching
                if step_index % 100 == 0 or step_index == args.steps - 1:
                    rotation = simulation.get_body_rotations('probe')[thorax_index]
                    samples.append({'step': completed, 'thoraxMm': simulation.get_body_positions('probe')[thorax_index].tolist(),
                        'bodyUpZ': float(1 - 2 * (rotation[1] ** 2 + rotation[2] ** 2)), 'legsTouching': touching.tolist()})
            contact_samples += int(np.any(contacts > 0))
            maximum_contacts = max(maximum_contacts, int(np.count_nonzero(contacts > 0)))
        physics_wall = time.perf_counter() - physics_started
        report.update(status='completed', physicsWallSeconds=physics_wall,
                      physicsCpuSeconds=time.process_time() - physics_cpu,
                      simulatedSeconds=float(simulation.mj_data.time),
                      simulatedToWallRatio=(completed * report['stepSeconds']) / physics_wall,
                      contactSamples=contact_samples, maxLegsWithContact=maximum_contacts,
                      rootDisplacementMm=(simulation.mj_data.qpos[:3] - initial[:3]).tolist(),
                      finalThoraxPositionMm=simulation.get_body_positions('probe')[thorax_index].tolist(),
                      modelStateSha256=hashlib.sha256(simulation.mj_data.qpos.tobytes()).hexdigest(),
                      contactEntriesPerLeg=contact_entries.tolist(), gaitSamples=samples,
                      warningCounts=simulation.mj_data.warning.number.tolist())
        files = sorted((assets_dir / 'model/neuromechfly').rglob('*'))
        report['assetSha256'] = {str(path.relative_to(assets_dir)): hashlib.sha256(path.read_bytes()).hexdigest()
                                 for path in files if path.is_file()}
    except Exception as error:
        report.update(status='failed', errorType=type(error).__name__, reason=str(error))
    report.update(completedSteps=completed, totalWallSeconds=time.perf_counter() - started,
                  totalCpuSeconds=time.process_time() - cpu_started)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report['peakRssBytes'] = rss if platform.system() == 'Darwin' else rss * 1024
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in {'assetSha256', 'packages', 'gaitSamples'}}, indent=2))
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
