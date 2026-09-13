/**
 * External two-channel readout learner for `benign-landmark-association-v1`.
 *
 * This is the protocol's `externalReadoutCandidate`: a deliberately competing
 * engineering explanation for any behavioral change. It trains a multiplicative
 * gain on the fixed left/right motor readout while every neural weight stays
 * frozen.
 *
 * It lives in its own module, imports nothing from `benign-plasticity.js`, and
 * shares no state with it, so "the external readout learned" and "the neural
 * model learned" can never be reported as the same result by accident. Success
 * here is never evidence of localized neural plasticity.
 */
import { createHash } from 'node:crypto';

export const EXTERNAL_READOUT_RULE = Object.freeze({
  id: 'benign-landmark-association-v1/external-two-channel-gain',
  status: 'engineered-competing-explanation',
  channels: Object.freeze(['left', 'right']),
  initialGain: 1,
  gainRange: Object.freeze([0.8, 1.2]),
  etaPerSecond: 0.01,
  rule: 'gain += 0.01 * gate * clamp(abs(baseChannel), 0, 1) * dtSeconds, then clip to [0.8, 1.2]',
  neuralWeights: 'frozen',
});

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const fail = message => { throw new Error(message); };

export function createExternalReadoutLearner({ readoutSha256, dtMs = 1 } = {}) {
  if (typeof readoutSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(readoutSha256)) fail('External readout training requires the exact fixed base readout digest');
  if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 1000) fail('Invalid external readout time step');
  const dtSeconds = dtMs / 1000;
  const [low, high] = EXTERNAL_READOUT_RULE.gainRange;
  const gain = { left: EXTERNAL_READOUT_RULE.initialGain, right: EXTERNAL_READOUT_RULE.initialGain };
  let updates = 0;
  let gatedUpdates = 0;

  /** One 1 ms tick against the fixed base readout's two channel values. */
  function tick({ base, gate = 0, learningEnabled = true } = {}) {
    if (!base || typeof base !== 'object' || Array.isArray(base) || Object.keys(base).length !== 2
      || !EXTERNAL_READOUT_RULE.channels.every(channel => Number.isFinite(base[channel]))) fail('External readout tick requires exactly the two fixed base channels');
    if (!Number.isFinite(gate) || gate < 0 || gate > 1) fail('External readout gate must be a nonnegative scalar in [0, 1]');
    if (typeof learningEnabled !== 'boolean') fail('Invalid external readout phase flag');
    if (learningEnabled && gate > 0) {
      for (const channel of EXTERNAL_READOUT_RULE.channels) {
        gain[channel] = clamp(gain[channel] + EXTERNAL_READOUT_RULE.etaPerSecond * gate * clamp(Math.abs(base[channel]), 0, 1) * dtSeconds, low, high);
      }
      gatedUpdates++;
    }
    updates++;
    return { left: base.left * gain.left, right: base.right * gain.right, gain: { ...gain }, updates, gatedUpdates };
  }

  const state = () => ({ rule: EXTERNAL_READOUT_RULE.id, readoutSha256, updates, gatedUpdates, gain: { ...gain } });

  function restore(saved) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || Object.keys(saved).length !== 5
      || saved.rule !== EXTERNAL_READOUT_RULE.id || saved.readoutSha256 !== readoutSha256
      || !Number.isSafeInteger(saved.updates) || saved.updates < 0
      || !Number.isSafeInteger(saved.gatedUpdates) || saved.gatedUpdates < 0 || saved.gatedUpdates > saved.updates
      || !saved.gain || typeof saved.gain !== 'object' || Object.keys(saved.gain).length !== 2
      || !EXTERNAL_READOUT_RULE.channels.every(channel => Number.isFinite(saved.gain[channel])
        && saved.gain[channel] >= low && saved.gain[channel] <= high)) fail('Invalid external readout checkpoint state; no partial restore performed');
    gain.left = saved.gain.left;
    gain.right = saved.gain.right;
    updates = saved.updates;
    gatedUpdates = saved.gatedUpdates;
  }

  return {
    tick,
    state,
    restore,
    stateSha256: () => digest(state()),
    gains: () => ({ ...gain }),
    disclosure: 'Engineered external readout training with frozen neural weights. Reported separately; it can never establish localized neural learning.',
  };
}
