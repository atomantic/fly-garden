import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class StimulusPolicyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const STIMULUS_SOURCES = Object.freeze(['ui', 'garden', 'learning', 'language', 'eidoverse']);
export const STIMULUS_LIMITS = Object.freeze({
  windowMs: 10000, maxDurationMs: 1000, maxDose: 40, recoveryMs: 1000, effectRecoveryMs: 3000,
});
// Continuous sensory current is distinct from optional appetitive exposure. It cannot reserve,
// erase or replenish that ledger; this shared boundary validates both input classes.
export const SENSORY_LIMITS = Object.freeze({ source: 'controller-retina', neuronCount: 32, maxCurrent: 0.02 });
export function validateRetinalCurrents(currents) {
  if (!Array.isArray(currents) || currents.length !== SENSORY_LIMITS.neuronCount
    || !Array.from({ length: currents.length }, (_, i) => Object.hasOwn(currents, i)
      && Number.isFinite(currents[i]) && currents[i] >= 0 && currents[i] <= SENSORY_LIMITS.maxCurrent).every(Boolean)) {
    throw new StimulusPolicyError('Retinal sensory current exceeds the declared per-neuron bounds.');
  }
  return [...currents];
}
const definitions = [
  { id: 'nectar', label: 'Nectar', description: 'Brief synthetic input; no biological reward claim.', durationMs: 300, intensity: 0.045, targets: ['fixture-0', 'fixture-1', 'fixture-2', 'fixture-3'] },
  { id: 'floral', label: 'Floral scent', description: 'Brief synthetic input; not a receptor or pheromone model.', durationMs: 500, intensity: 0.025, targets: ['fixture-16', 'fixture-17', 'fixture-18', 'fixture-19'] },
  { id: 'quiet', label: 'Quiet bloom', description: 'Cancels optional stimulation; engineered baseline support is unchanged.', durationMs: 0, intensity: 0, targets: [] },
];
export const STIMULUS_EFFECTS = Object.freeze(definitions.map(effect => Object.freeze({ ...effect, targets: Object.freeze(effect.targets) })));
const effectFor = id => STIMULUS_EFFECTS.find(effect => effect.id === id);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const envelopeKeys = ['version', 'source', 'individualId', 'sessionId', 'simTimeMs', 'effect', 'targets', 'intensity', 'durationMs'];
const validIdentity = id => typeof id === 'string' && id.length > 0 && id.length <= 128;

/** Portable reservations are validated independently of the session-local authenticated rewind hook. */
export function validateStimulusCheckpoint(saved, { individualId, timeMs } = {}) {
  const invalid = () => { throw new StimulusPolicyError('Invalid durable stimulus checkpoint.'); };
  if (!exactKeys(saved, ['version', 'individualId', 'timeMs', 'nextId', 'entries']) || saved.version !== 1
    || !validIdentity(saved.individualId) || (individualId !== undefined && saved.individualId !== individualId)
    || !integer(saved.timeMs) || saved.timeMs % 5 !== 0 || (timeMs !== undefined && saved.timeMs !== timeMs)
    || !Number.isSafeInteger(saved.nextId) || saved.nextId < 1
    || !Array.isArray(saved.entries) || saved.entries.length > 11) invalid();
  let durationMs = 0;
  let dose = 0;
  let lastId = 0;
  for (let i = 0; i < saved.entries.length; i++) {
    const entry = saved.entries[i];
    if (!exactKeys(entry, [...envelopeKeys, 'id', 'activeUntilMs'])) invalid();
    const effect = effectFor(entry.effect);
    if (entry.version !== 1 || !STIMULUS_SOURCES.includes(entry.source)
      || entry.individualId !== saved.individualId || !validIdentity(entry.sessionId)
      || !integer(entry.id) || entry.id <= lastId || entry.id >= saved.nextId
      || !integer(entry.simTimeMs) || entry.simTimeMs % 5 !== 0 || entry.simTimeMs > saved.timeMs
      || !effect || effect.id === 'quiet'
      || !Number.isFinite(entry.intensity) || entry.intensity <= 0 || entry.intensity > effect.intensity
      || !integer(entry.durationMs) || entry.durationMs === 0 || entry.durationMs % 5 !== 0 || entry.durationMs > effect.durationMs
      || !Array.isArray(entry.targets) || entry.targets.length !== effect.targets.length
      || effect.targets.some((target, index) => !Object.hasOwn(entry.targets, index) || entry.targets[index] !== target)
      || !integer(entry.simTimeMs + entry.durationMs)
      || entry.simTimeMs + entry.durationMs <= saved.timeMs - STIMULUS_LIMITS.windowMs
      || !integer(entry.activeUntilMs) || entry.activeUntilMs % 5 !== 0
      || entry.activeUntilMs < entry.simTimeMs || entry.activeUntilMs > entry.simTimeMs + entry.durationMs) invalid();
    for (let previous = 0; previous < i; previous++) {
      const earlier = saved.entries[previous];
      const recovery = earlier.effect === entry.effect ? STIMULUS_LIMITS.effectRecoveryMs : STIMULUS_LIMITS.recoveryMs;
      if (entry.simTimeMs - earlier.simTimeMs < recovery) invalid();
    }
    durationMs += entry.durationMs;
    dose += entry.intensity * entry.durationMs;
    lastId = entry.id;
  }
  if (durationMs > STIMULUS_LIMITS.maxDurationMs || dose > STIMULUS_LIMITS.maxDose) invalid();
  return structuredClone(saved);
}

/**
 * Version 1 fixture envelope. Targets are exact server-owned mappings, not arbitrary neuron writes.
 * @typedef {Object} StimulusEnvelope
 * @property {1} version
 * @property {'ui'|'garden'|'learning'|'language'|'eidoverse'} source
 * @property {string} individualId
 * @property {string} sessionId
 * @property {number} simTimeMs
 * @property {'nectar'|'floral'|'quiet'} effect
 * @property {string[]} targets
 * @property {number} intensity Nonnegative synthetic current per mapped target.
 * @property {number} durationMs Simulation milliseconds, on the 5 ms fixture grid.
 */
export function createStimulusPolicy({ individualId, sessionId, durableCheckpoint }) {
  if (![individualId, sessionId].every(validIdentity)) {
    throw new StimulusPolicyError('Invalid policy identity.');
  }
  const restored = durableCheckpoint === undefined ? null : validateStimulusCheckpoint(durableCheckpoint, { individualId });
  // Internal, session-local checkpoint authentication. Never returned through HTTP or snapshots.
  const key = randomBytes(32);
  let timeMs = restored?.timeMs ?? 0;
  let nextId = restored?.nextId ?? 1;
  // Recovery starts paused: preserve reservations and their original source session, but never restart exposure.
  let entries = restored?.entries.map(entry => ({ ...entry, activeUntilMs: Math.min(entry.activeUntilMs, timeMs) })) ?? [];
  const sign = payload => createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
  const retained = entry => entry.simTimeMs + entry.durationMs > timeMs - STIMULUS_LIMITS.windowMs;
  const remaining = entry => Math.max(0, entry.activeUntilMs - timeMs);

  function advance(nowMs) {
    if (!integer(nowMs) || nowMs % 5 !== 0 || nowMs < timeMs) throw new StimulusPolicyError('Policy time cannot rewind or leave the simulation grid.');
    timeMs = nowMs;
    entries = entries.filter(retained);
  }

  function envelope(source, effectId) {
    const effect = effectFor(effectId);
    if (!effect) throw new StimulusPolicyError('Unknown virtual compound.');
    return { version: 1, source, individualId, sessionId, simTimeMs: timeMs,
      effect: effect.id, targets: [...effect.targets], intensity: effect.intensity, durationMs: effect.durationMs };
  }

  function validate(request, source) {
    if (!exactKeys(request, envelopeKeys) || request.version !== 1) throw new StimulusPolicyError('Invalid stimulus envelope version or fields.');
    if (!STIMULUS_SOURCES.includes(source) || request.source !== source) throw new StimulusPolicyError('Unknown or mismatched stimulus source.');
    if (request.individualId !== individualId || request.sessionId !== sessionId) throw new StimulusPolicyError('Stimulus identity or session mismatch.');
    if (!integer(request.simTimeMs) || request.simTimeMs !== timeMs) throw new StimulusPolicyError('Stale or future stimulus timestamp.');
    const effect = effectFor(request.effect);
    if (!effect || !Array.isArray(request.targets) || request.targets.length !== effect.targets.length
      || effect.targets.some((target, i) => !Object.hasOwn(request.targets, i) || request.targets[i] !== target)) throw new StimulusPolicyError('Unknown effect or unsupported target mapping.');
    if (!Number.isFinite(request.intensity) || request.intensity < 0 || request.intensity > effect.intensity
      || !integer(request.durationMs) || request.durationMs > effect.durationMs || request.durationMs % 5 !== 0
      || (effect.id !== 'quiet' && (request.intensity === 0 || request.durationMs === 0))) {
      throw new StimulusPolicyError('Stimulus intensity or duration exceeds the supported bounds.');
    }
    return effect;
  }

  function usage() {
    return entries.reduce((total, entry) => ({
      durationMs: total.durationMs + entry.durationMs,
      dose: total.dose + entry.intensity * entry.durationMs,
    }), { durationMs: 0, dose: 0 });
  }

  function cancelOptional() {
    for (const entry of entries) entry.activeUntilMs = Math.min(entry.activeUntilMs, timeMs);
  }

  function cancelEntry(source, entryId) {
    if (!STIMULUS_SOURCES.includes(source) || !Number.isSafeInteger(entryId) || entryId < 1) {
      throw new StimulusPolicyError('Invalid scoped stimulus cancellation.');
    }
    const entry = entries.find(value => value.id === entryId);
    if (!entry) return false; // An expired/pruned receipt already has no delivery.
    if (entry.source !== source) throw new StimulusPolicyError('Stimulus cancellation source mismatch.');
    const wasActive = entry.activeUntilMs > timeMs;
    entry.activeUntilMs = Math.min(entry.activeUntilMs, timeMs);
    return wasActive;
  }

  function admit(source, request) {
    const effect = validate(request, source);
    if (nextId >= Number.MAX_SAFE_INTEGER || !integer(timeMs + request.durationMs)) {
      throw new StimulusPolicyError('Stimulus clock or sequence limit reached.', 409);
    }
    // Quiet is cancellation, so spent budgets and recovery never prevent it.
    if (effect.id === 'quiet') {
      cancelOptional();
      return { ...structuredClone(request), id: nextId++, activeUntilMs: timeMs };
    }
    if (entries.some(entry => timeMs < entry.simTimeMs + STIMULUS_LIMITS.recoveryMs
      || (entry.effect === effect.id && timeMs < entry.simTimeMs + STIMULUS_LIMITS.effectRecoveryMs))) {
      throw new StimulusPolicyError('Stimulus recovery is still active in simulation time.', 409);
    }
    const used = usage();
    if (used.durationMs + request.durationMs > STIMULUS_LIMITS.maxDurationMs
      || used.dose + request.intensity * request.durationMs > STIMULUS_LIMITS.maxDose) {
      throw new StimulusPolicyError('Aggregate stimulus duration or dose budget is exhausted.', 409);
    }
    const entry = { ...structuredClone(request), id: nextId++, activeUntilMs: timeMs + request.durationMs };
    entries.push(entry);
    return structuredClone(entry);
  }

  function snapshot() {
    const used = usage();
    return { version: 1, individualId, sessionId, simTimeMs: timeMs, limits: STIMULUS_LIMITS,
      reservedDurationMs: used.durationMs, reservedDose: used.dose,
      reservedDutyCycle: used.durationMs / STIMULUS_LIMITS.windowMs,
      entries: structuredClone(entries),
      effects: STIMULUS_EFFECTS.map(effect => ({ ...effect, targets: [...effect.targets],
        active: entries.some(entry => entry.effect === effect.id && remaining(entry) > 0),
        remainingMs: Math.max(0, ...entries.filter(entry => entry.effect === effect.id).map(remaining)),
        cooldownRemainingMs: effect.id === 'quiet' ? 0 : Math.max(0, ...entries.map(entry => entry.simTimeMs
          + (entry.effect === effect.id ? STIMULUS_LIMITS.effectRecoveryMs : STIMULUS_LIMITS.recoveryMs) - timeMs)),
      })),
      disclosure: 'Engineering limits on optional synthetic inputs; not consent or a welfare score. No chemical dynamics or biological reward model.',
    };
  }

  function currents() {
    const result = new Map();
    for (const entry of entries) {
      if (remaining(entry) === 0) continue;
      for (const target of entry.targets) result.set(target, (result.get(target) ?? 0) + entry.intensity);
    }
    return result;
  }

  function checkpoint() {
    const payload = { version: 1, individualId, sessionId, timeMs, nextId, entries: structuredClone(entries) };
    return { payload, signature: sign(payload) };
  }

  function durableCheckpointSnapshot() {
    return { version: 1, individualId, timeMs, nextId, entries: structuredClone(entries) };
  }

  function restore(saved) {
    if (!exactKeys(saved, ['payload', 'signature']) || typeof saved.signature !== 'string' || !/^[a-f0-9]{64}$/.test(saved.signature)
      || !exactKeys(saved.payload, ['version', 'individualId', 'sessionId', 'timeMs', 'nextId', 'entries'])) {
      throw new StimulusPolicyError('Invalid policy checkpoint.');
    }
    const { payload, signature } = saved;
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(payload), 'hex'))
      || payload.individualId !== individualId || payload.sessionId !== sessionId || payload.timeMs > timeMs) {
      throw new StimulusPolicyError('Policy checkpoint integrity, identity or time mismatch.');
    }
    // A restore is conservative: union reservations, never rewind the clock or reactivate canceled input.
    const merged = new Map(payload.entries.filter(retained).map(entry => [entry.id, { ...structuredClone(entry), activeUntilMs: timeMs }]));
    for (const entry of entries) merged.set(entry.id, entry);
    entries = [...merged.values()].sort((a, b) => a.id - b.id);
    nextId = Math.max(nextId, payload.nextId);
    cancelOptional();
  }

  return { advance, envelope, admit, cancelOptional, cancelEntry, snapshot, currents, checkpoint, restore,
    durableCheckpoint: durableCheckpointSnapshot };
}
