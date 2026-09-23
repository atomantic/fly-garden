const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const poseValid = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isFinite(value.x) && Number.isFinite(value.z) && Number.isFinite(value.yaw)
  && Math.abs(value.x) <= 2 && Math.abs(value.z) <= 2 && Math.abs(value.yaw) <= Math.PI;
const motorValid = value => value && typeof value === 'object' && !Array.isArray(value)
  && Number.isFinite(value.forward) && Number.isFinite(value.yaw)
  && value.forward >= 0 && value.forward <= 0.12 && Math.abs(value.yaw) <= 0.8;
const unavailable = reason => Object.freeze({ available: false, renderOnly: true, reason });

export const VISITOR_SENSORY_SOURCE = 'engineered-gentle-patch-spatial-proxy-v1';
export const VISITOR_PREVIEW_DISCLOSURE = 'Render-only local projection of the last host-confirmed visitor frame. The marker is not a camera feed, biological vision, host-rendered avatar, learned behavior or subjective state, and its pose is never used for control.';

export function deriveVisitorPreview(visitor) {
  if (!visitor || visitor.phase !== 'visiting' || visitor.owned !== true || typeof visitor.running !== 'boolean'
    || !validId(visitor.individualId) || !validId(visitor.individualSessionId) || !validId(visitor.visitEpoch)) {
    return unavailable('No acknowledged visitor frame is available.');
  }
  const trace = visitor.lastTrace;
  if (!trace || trace.individualId !== visitor.individualId || trace.individualSessionId !== visitor.individualSessionId
    || trace.visitEpoch !== visitor.visitEpoch || !integer(trace.frameId) || !integer(trace.inputSimTimeMs)
    || !integer(trace.outputSimTimeMs) || trace.outputSimTimeMs <= trace.inputSimTimeMs
    || trace.sensorySource !== VISITOR_SENSORY_SOURCE || !['move', 'interact'].includes(trace.action)
    || !motorValid(trace.motor) || !poseValid(trace.pose)) {
    return unavailable('The last visitor frame is not current for this visit.');
  }
  let interaction = null;
  if (trace.action === 'interact') {
    const value = visitor.lastInteraction;
    if (!validId(trace.objectId) || !value || value.individualId !== visitor.individualId
      || value.visitEpoch !== visitor.visitEpoch || value.frameId !== trace.frameId || !integer(value.sequence)
      || value.objectId !== trace.objectId || value.effect !== 'settle' || !poseValid(value.pose)
      || value.pose.x !== trace.pose.x || value.pose.z !== trace.pose.z || value.pose.yaw !== trace.pose.yaw) {
      return unavailable('The last interaction is not current for this visit.');
    }
    interaction = { objectId: value.objectId, effect: value.effect, frameId: value.frameId, sequence: value.sequence };
  }
  return Object.freeze({
    available: true,
    renderOnly: true,
    running: visitor.running,
    individualId: visitor.individualId,
    visitEpoch: visitor.visitEpoch,
    frameId: trace.frameId,
    action: trace.action,
    objectId: interaction?.objectId ?? null,
    sensorySource: trace.sensorySource,
    inputSimTimeMs: trace.inputSimTimeMs,
    outputSimTimeMs: trace.outputSimTimeMs,
    pose: Object.freeze({ x: trace.pose.x, z: trace.pose.z, yaw: trace.pose.yaw }),
    motor: Object.freeze({ forward: trace.motor.forward, yaw: trace.motor.yaw }),
    interaction: interaction ? Object.freeze(interaction) : null,
  });
}

export function projectVisitorPose(pose) {
  if (!poseValid(pose)) return null;
  return Object.freeze({ x: 320 + pose.x * 120, y: 180 + pose.z * 72 });
}
