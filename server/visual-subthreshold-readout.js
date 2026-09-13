/**
 * External readout for `visual-subthreshold-readout-v1`
 * (research/visual-subthreshold-readout-protocol.json). Fits a single scale
 * from two real campaign feature values, entirely separate from any neural
 * plasticity module (no shared state with benign-plasticity.js or
 * external-readout-learner.js) and never claims spiking causal control or
 * biological vision.
 */
const fail = message => { throw new Error(message); };
const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);

export const SUBTHRESHOLD_READOUT_RULE = Object.freeze({
  id: 'visual-subthreshold-readout-v1',
  status: 'engineered-trained-readout',
  fitConditions: Object.freeze(['changed-left-half-onset', 'changed-right-half-onset']),
  heldOutConditions: Object.freeze(['unchanged-black', 'changed-whole-field-onset']),
  maxYawRadiansPerSecond: 0.25,
  separationFloor: 1e-6,
  wholeFieldBand: 0.01,
  neuralWeights: 'frozen',
});

/**
 * @param {Record<string, number>} featureByCondition - one real subthreshold feature per READOUT_CONDITIONS entry
 * @returns fit scale, per-condition yaw, and the protocol's predeclared pass/fail verdict — never adjusted after computing
 */
export function fitSubthresholdReadout(featureByCondition) {
  const required = ['unchanged-black', 'changed-left-half-onset', 'changed-right-half-onset', 'changed-whole-field-onset'];
  if (!featureByCondition || !required.every(c => Number.isFinite(featureByCondition[c]))) fail('Fit requires a finite feature value for every predeclared condition');
  const left = featureByCondition['changed-left-half-onset'], right = featureByCondition['changed-right-half-onset'];
  const magnitude = Math.max(Math.abs(left), Math.abs(right));
  const scale = magnitude > 0 ? clamp(SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond / magnitude, 0, 1e6) : 0;
  const yaw = condition => clamp(scale * featureByCondition[condition], -SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond, SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond);
  const yawByCondition = Object.fromEntries(required.map(c => [c, yaw(c)]));
  const separation = Math.abs(left - right);
  const verdict = {
    separates: separation >= SUBTHRESHOLD_READOUT_RULE.separationFloor && !(left === 0 && right === 0),
    blackExactlyZero: featureByCondition['unchanged-black'] === 0,
    wholeFieldWithinBand: Math.abs(yawByCondition['changed-whole-field-onset']) <= SUBTHRESHOLD_READOUT_RULE.wholeFieldBand,
  };
  const passed = verdict.separates && verdict.blackExactlyZero && verdict.wholeFieldWithinBand;
  return {
    rule: SUBTHRESHOLD_READOUT_RULE.id, scale, separation, featureByCondition, yawByCondition, verdict, passed,
    disclosure: 'Engineered, trained external readout over real subthreshold connectome voltage. Frozen neural weights throughout. Never a claim of spiking causal control, vision, perception, or biological control.',
  };
}

/** Bounded runtime output shape matching createSteeringReadout()'s contract, for a readout that PASSED fitting. */
export function createFrozenSubthresholdReadout(fit) {
  if (!fit || fit.passed !== true) fail('Cannot construct a runtime readout from a failed or missing fit');
  const scale = fit.scale;
  return {
    tick(feature) {
      if (!Number.isFinite(feature)) fail('Subthreshold readout tick requires a finite feature value');
      return { yawRadiansPerSecond: clamp(scale * feature, -SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond, SUBTHRESHOLD_READOUT_RULE.maxYawRadiansPerSecond), forwardSpeed: 0 };
    },
    disclosure: fit.disclosure,
  };
}
