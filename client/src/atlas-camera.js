import { Spherical, Vector3 } from 'three';

/** Display camera only: no runtime, network, timers or neural state. */
export function moveAtlasCamera(camera, controls, action) {
  const offset = camera.position.clone().sub(controls.target);
  if (action.startsWith('pan-')) {
    const directions = { 'pan-left': [-1, 0, 0], 'pan-right': [1, 0, 0], 'pan-up': [0, 1, 0], 'pan-down': [0, -1, 0] };
    if (!directions[action]) return false;
    const shift = new Vector3(...directions[action]).applyQuaternion(camera.quaternion).multiplyScalar(offset.length() * 0.1);
    camera.position.add(shift); controls.target.add(shift);
  } else if (action === 'in' || action === 'out') {
    const distance = offset.length(), next = Math.max(controls.minDistance, Math.min(controls.maxDistance, distance * (action === 'in' ? 0.8 : 1.25)));
    if (distance > 0) camera.position.copy(controls.target).add(offset.multiplyScalar(next / distance));
  } else if (['left', 'right', 'up', 'down'].includes(action)) {
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += action === 'left' ? -0.25 : action === 'right' ? 0.25 : 0;
    spherical.phi += action === 'up' ? -0.2 : action === 'down' ? 0.2 : 0;
    spherical.makeSafe(); camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  } else return false;
  controls.update(); return true;
}

/** Checkbox filters preserve the view; only a new explicit preset requests another fit. */
export function shouldFitAtlas(fitted, previousRevision, fitRevision, count) {
  return count > 0 && (!fitted || previousRevision !== fitRevision);
}
