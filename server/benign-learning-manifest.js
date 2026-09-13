/**
 * Immutable mapping manifest for `benign-landmark-association-v1`.
 *
 * The protocol requires ONE manifest binding the engineered scene, contact
 * geometry, motion and luminance bounds, fixed readout coefficients, held-out
 * variant lists AND the validated compartment-matched KC->MBON edge set. Only a
 * manifest with every section resolved may have its digest promoted into
 * `protocol.json`; a manifest with any unresolved section is `incomplete` and
 * keeps the corresponding gates closed.
 *
 * Every constant here is a preregistered engineering choice, frozen before any
 * result was observed. None of it is a biological measurement. Nothing in the
 * scene is aversive: there is no penalty region, no deprivation, no pursuit and
 * no inactivity cost. Remaining still for a whole trial is a scored outcome
 * ("no contact"), not a failure state.
 */
import { createHash } from 'node:crypto';

const canonical = value => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value);
export const manifestDigest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Frozen engineered world. Units are simulation units, not calibrated millimetres. */
export const SCENE = Object.freeze({
  arenaShape: 'circle',
  arenaRadius: 12,
  wallBehavior: 'soft-boundary-no-contact-event',
  baselineSupport: 'constant, never conditional on performance',
  quietArea: Object.freeze({ centre: Object.freeze([0, 0]), radius: 2.5, role: 'always-available rest region, no cue, no gate' }),
  landmarks: Object.freeze([
    Object.freeze({ category: 'ring', outerRadius: 1.2, innerRadius: 0.6, height: 2, luminance: 0.82 }),
    Object.freeze({ category: 'bar', width: 0.5, depth: 0.5, height: 2, luminance: 0.82 }),
  ]),
  landmarkPlacementRadius: 8,
  contactRadius: 1,
  contactRule: 'first body-centre entry within contactRadius of a landmark centre during a trial',
  motionBounds: Object.freeze({ maxForwardSpeed: 2, maxYawRadiansPerSecond: 0.5, maxAccelerationPerSecond: 4 }),
  luminanceBounds: Object.freeze({ minimum: 0, maximum: 1, backgroundLuminance: 0.12 }),
  layoutChangesOnlyAt: 'declared trial boundaries; never resets neural state or teleports the body',
});

/** Fixed left/right motor readout. No coefficient is trained by the neural condition. */
export const FIXED_READOUT = Object.freeze({
  source: 'bilateral DNa02 100-tick binary firing window',
  rateWindowTicks: 100,
  rateScaleHz: 100,
  yawCoefficient: 0.5,
  yawConvention: 'right minus left, radians per second',
  forwardSpeed: 0,
});

/** Preregistered layout/render variant lists. Held-out variants were never used to choose a parameter. */
export const VARIANTS = Object.freeze({
  training: Object.freeze(['layout-a', 'layout-b', 'layout-c', 'layout-d']),
  heldOut: Object.freeze(['layout-h1', 'layout-h2', 'layout-h3', 'layout-h4']),
  retention: Object.freeze(['layout-r1', 'layout-r2']),
  renderVariants: Object.freeze(['plain', 'textured']),
  targetCounterbalance: 'seed parity: even seed index targets ring, odd targets bar',
});

export const MANIFEST_SECTIONS = Object.freeze(['scene', 'fixedReadout', 'variants', 'sensoryMapping', 'causalMotorReadout', 'compartmentMatchedEdges']);

/**
 * Build the manifest from the independently derived gate evidence. Unresolved
 * sections are recorded as null with an explicit reason; they are never filled
 * with a convenient default.
 */
export function buildMappingManifest(gateEvidence) {
  if (!gateEvidence || typeof gateEvidence !== 'object' || gateEvidence.kind !== 'benign-learning-gate-evidence'
    || !gateEvidence.gates) throw new Error('Mapping manifest requires the derived gate evidence record');
  const causal = gateEvidence.gates['fixed-causal-motor-readout'];
  const compartment = gateEvidence.gates['compartment-specific-plasticity-validation'];
  if (!causal || !compartment) throw new Error('Gate evidence is missing a required gate');

  const causalResolved = causal.status === 'open';
  const compartmentResolved = compartment.status === 'open';
  const unresolved = [];
  if (!causalResolved) unresolved.push('causalMotorReadout');
  if (!compartmentResolved) unresolved.push('compartmentMatchedEdges');

  const body = {
    schemaVersion: 1,
    kind: 'benign-learning-mapping-manifest',
    protocolId: 'benign-landmark-association-v1',
    scene: SCENE,
    fixedReadout: FIXED_READOUT,
    variants: VARIANTS,
    sensoryMapping: gateEvidence.gates['fixed-causal-motor-readout'].profiles.map(profile => ({
      dataset: profile.dataset,
      graphManifestSha256: profile.graphManifestSha256,
      visualMappingSha256: profile.mappingSha256,
      admittedOnsetPortCount: profile.onsetPortCount,
    })),
    causalMotorReadout: causalResolved ? { validated: true } : null,
    compartmentMatchedEdges: compartmentResolved ? { validated: true } : null,
    unresolvedSections: unresolved,
    unresolvedReasons: {
      causalMotorReadout: causalResolved ? null : causal.basis,
      compartmentMatchedEdges: compartmentResolved ? null : compartment.profiles.map(p => p.reason)[0],
    },
    complete: unresolved.length === 0,
    disclosure: 'Preregistered engineering configuration over measured anatomy. Not a biological calibration, a learning claim or a validated body loop.',
  };
  return { manifest: { ...body, manifestSha256: manifestDigest(body) }, complete: body.complete, unresolvedSections: unresolved };
}

/** Only a complete manifest may be promoted into protocol.json. */
export function promotableManifestSha256(built) {
  if (!built || typeof built !== 'object' || !built.manifest) throw new Error('Invalid built manifest');
  return built.complete ? built.manifest.manifestSha256 : null;
}
