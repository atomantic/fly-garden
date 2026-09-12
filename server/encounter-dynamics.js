import { STIMULUS_EFFECTS, STIMULUS_LIMITS } from './stimulus-policy.js';

const clone = value => structuredClone(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const time = value => Number.isSafeInteger(value) && value >= 0 && value % 5 === 0;
export const ENCOUNTER_CATALOG = Object.freeze(STIMULUS_EFFECTS.filter(e => e.id !== 'quiet').map(effect => Object.freeze({
  version: 1, id: effect.id, category: effect.id === 'floral' ? 'engineered-scent-proxy' : 'fictional-modulation-input',
  label: effect.id === 'floral' ? 'Floral contact proxy' : 'Fictional nectar input',
  source: 'garden', namespace: 'synthetic-fixture', targets: Object.freeze([...effect.targets]),
  intensity: effect.intensity, durationMs: effect.durationMs,
  units: 'Synthetic additive current per mapped neuron; duration and recovery in simulation milliseconds.',
  dynamics: 'Immediate bounded onset; one pulse per entry; zero delivery on withdrawal or expiry; no automatic redosing.',
  evidence: 'Original engineered fixture mapping. No biological receptor, pharmacology or pheromone evidence.',
  uncertainty: 'Changes in fixture activity do not establish pleasure, consent, learning or drug response.',
  persistentPlasticity: 'Unavailable; fixture weights do not change.',
})));

/** Exact existing Scene.jsx procedural flower centers; contact radius is an explicit proxy.
 * Positions are world geometry used only by this contact detector, never hidden retinal targets.
 */
export const GARDEN_ENCOUNTER_FLOWERS = Object.freeze(Array.from({ length: 13 }, (_, i) => {
  const angle = i * 2.4, radius = 2.4 + (i % 3) * 0.5;
  return { id: `garden-flower-${i}`, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
    radius: 0.35, effectId: i % 2 === 0 ? 'floral' : 'nectar' };
}).filter(flower => !(flower.x > 1 && flower.z < -0.6)).map(Object.freeze));

/** Pure per-recipient contact state machine. Trusted synchronous callbacks own durable policy
 * admission and receipt-scoped cancellation. This module cannot write currents or refund budgets.
 */
export function createEncounterDynamics({ individualId, sessionId, admit, cancel, policySnapshot,
  flowers = GARDEN_ENCOUNTER_FLOWERS }) {
  if (![individualId, sessionId].every(id) || ![admit, cancel, policySnapshot].every(v => typeof v === 'function')
    || !Array.isArray(flowers) || flowers.length > 32) throw new Error('Invalid encounter adapter configuration.');
  const seen = new Set();
  const geometry = flowers.map(f => {
    if (!f || !id(f.id) || seen.has(f.id) || ![f.x, f.z].every(v => Number.isFinite(v) && Math.abs(v) <= 5)
      || !Number.isFinite(f.radius) || f.radius <= 0 || f.radius > 0.5 || !ENCOUNTER_CATALOG.some(c => c.id === f.effectId)) throw new Error('Unsupported encounter geometry or compound.');
    seen.add(f.id); return clone(f);
  }).sort((a, b) => a.id.localeCompare(b.id));
  let enabled = false, environmentEpoch = null, initialized = false, contacts = new Set(), active = null;
  let lastFrameId = -1, simTimeMs = 0, phase = 'disabled';
  const events = [];
  function log(kind, details = {}) {
    events.push({ individualId, sessionId, environmentEpoch, simTimeMs, kind, ...details });
    if (events.length > 80) events.shift();
  }
  function stop(reason) {
    if (active) {
      const result = cancel({ individualId, sessionId, source: 'garden', entryId: active.id, reason });
      if (result?.then) throw new Error('Encounter cancellation must be synchronous.');
      log('washout', { entryId: active.id, reason, retainedLearning: 'Unavailable; no plasticity implemented.' });
      active = null;
    }
  }
  function setEnabled(value, epoch) {
    if (typeof value !== 'boolean' || (value && !id(epoch))) throw new Error('Encounter enablement requires an explicit environment epoch.');
    stop('Encounter enablement changed.');
    enabled = value; environmentEpoch = value ? epoch : null; initialized = false; contacts = new Set(); lastFrameId = -1;
    phase = value ? 'armed-awaiting-observation' : 'disabled';
    log(value ? 'enabled' : 'disabled');
    return snapshot();
  }
  function update(frame) {
    if (!frame || frame.individualId !== individualId || frame.sessionId !== sessionId) throw new Error('Encounter recipient/session mismatch.');
    if (!enabled) return snapshot();
    if (frame.environmentEpoch !== environmentEpoch) { setEnabled(false); log('epoch-revoked'); return snapshot(); }
    if (!Number.isSafeInteger(frame.frameId) || frame.frameId <= lastFrameId || !time(frame.simTimeMs)
      || frame.simTimeMs < simTimeMs || !frame.pose || ![frame.pose.x, frame.pose.z].every(Number.isFinite)
      || !['running', 'paused', 'resting', 'fault'].includes(frame.status)) throw new Error('Stale or invalid encounter observation.');
    const policy = policySnapshot();
    if (policy.individualId !== individualId || policy.sessionId !== sessionId || policy.simTimeMs !== frame.simTimeMs) throw new Error('Encounter policy clock/recipient mismatch.');
    simTimeMs = frame.simTimeMs; lastFrameId = frame.frameId;
    if (active) {
      const receipt = policy.entries?.find(entry => entry.id === active.id);
      if (!receipt || receipt.activeUntilMs <= simTimeMs) { active = null; log('pulse-expired-or-canceled'); }
    }
    if (frame.status !== 'running') {
      stop('Recipient paused, resting or faulted.'); contacts = new Set(); initialized = false; phase = 'resting'; return snapshot();
    }
    const inside = new Set(geometry.filter(f => Math.hypot(frame.pose.x - f.x, frame.pose.z - f.z) <= f.radius).map(f => f.id));
    if (active && !inside.has(active.flowerId)) stop('Recipient left contact radius.');
    if (active && simTimeMs >= active.activeUntilMs) { active = null; log('pulse-expired'); }
    const entries = initialized ? geometry.filter(f => inside.has(f.id) && !contacts.has(f.id)) : [];
    contacts = inside; initialized = true;
    // Deterministic overlap arbitration: one offer per boundary. Shared policy remains the cap.
    if (!active && entries.length) {
      const flower = entries[0];
      try {
        const receipt = admit({ individualId, sessionId, source: 'garden', effectId: flower.effectId, flowerId: flower.id, simTimeMs });
        if (!receipt || receipt.then || !Number.isSafeInteger(receipt.id) || receipt.id < 1
          || receipt.individualId !== individualId || receipt.sessionId !== sessionId || receipt.source !== 'garden'
          || receipt.effect !== flower.effectId || receipt.simTimeMs !== simTimeMs
          || !time(receipt.activeUntilMs) || receipt.activeUntilMs <= simTimeMs) throw new Error('Invalid trusted policy admission receipt.');
        active = { id: receipt.id, flowerId: flower.id, effectId: flower.effectId, activeUntilMs: receipt.activeUntilMs };
        log('admitted', { flowerId: flower.id, entryId: receipt.id, effectId: flower.effectId });
      } catch (error) {
        log('rejected', { flowerId: flower.id, reason: error.message });
      }
    }
    phase = !enabled ? 'disabled' : active ? 'bounded-pulse' : inside.size ? 'habituated-contact' : 'outside';
    return snapshot();
  }
  function snapshot() {
    const policy = policySnapshot();
    return clone({ version: 1, individualId, sessionId, enabled, environmentEpoch, simTimeMs, phase,
      contactIds: [...contacts], active, geometry, catalog: ENCOUNTER_CATALOG, events,
      recoveryRemainingMs: Math.max(0, ...(policy.effects ?? []).map(e => e.cooldownRemainingMs ?? 0)),
      aggregate: { reservedDose: policy.reservedDose, reservedDurationMs: policy.reservedDurationMs, limits: STIMULUS_LIMITS },
      disclosure: 'Optional geometry-based contact proxies; not vision, receptor dynamics, consent or validated pharmacology. Recovery and spent reservations belong to the shared policy. Transient washout does not claim reversal of learning.' });
  }
  return { setEnabled, update, snapshot, withdraw: () => setEnabled(false) };
}
