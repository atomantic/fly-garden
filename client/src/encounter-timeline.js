const MAX_VISIBLE_EVENTS = 12;

const EVENT_MESSAGES = Object.freeze({
  enabled: 'Encounter control enabled; no exposure was applied.',
  disabled: 'Encounter control disabled.',
  admitted: 'A bounded synthetic pulse was admitted.',
  rejected: 'The shared stimulus policy rejected the pulse.',
  washout: 'The pulse stopped before expiry; its reservation was not refunded.',
  'pulse-expired-or-canceled': 'The pulse ended or was canceled by the shared policy.',
  'pulse-expired': 'The bounded pulse expired.',
  'epoch-revoked': 'Encounter control was revoked with its environment epoch.',
});

const validTime = value => Number.isSafeInteger(value) && value >= 0;
const validNumber = value => Number.isFinite(value) && value >= 0;
const sameSource = (value, state) => value?.individualId === state?.individualId
  && value?.sessionId === state?.sessionId;

/** Display-only summary of one fixture individual's current encounter ledger. */
export function encounterTimelineModel(state) {
  if (!state) return null;
  const source = state?.encounterDynamics;
  if (!source || source.version !== 1 || !sameSource(source, state)
    || !validTime(source.simTimeMs) || !Array.isArray(source.events)) {
    return { available: false, reason: 'Encounter history is unavailable for the selected individual/session.' };
  }

  const catalog = new Map((Array.isArray(source.catalog) ? source.catalog : [])
    .filter(effect => typeof effect?.id === 'string' && typeof effect.label === 'string'
      && Number.isFinite(effect.intensity) && effect.intensity > 0
      && validTime(effect.durationMs) && effect.durationMs > 0)
    .map(effect => [effect.id, effect]));
  const effectsByEntry = new Map();
  for (const event of source.events) {
    if (!sameSource(event, state)) continue;
    const effect = catalog.get(event?.effectId);
    if (event?.kind === 'admitted' && validTime(event.simTimeMs)
      && Number.isSafeInteger(event.entryId) && event.entryId > 0 && effect) {
      effectsByEntry.set(event.entryId, effect);
    }
  }

  const validEvents = source.events.map((event, index) => {
    if (!sameSource(event, state) || !validTime(event.simTimeMs) || !Object.hasOwn(EVENT_MESSAGES, event.kind)) return null;
    const effect = catalog.get(event.effectId) ?? effectsByEntry.get(event.entryId);
    return {
      key: `${event.environmentEpoch ?? 'none'}:${event.simTimeMs}:${event.kind}:${event.entryId ?? index}`,
      simTimeMs: event.simTimeMs,
      message: EVENT_MESSAGES[event.kind],
      effect: effect ? { label: effect.label, intensity: effect.intensity, durationMs: effect.durationMs } : null,
      admitted: event.kind === 'admitted',
    };
  }).filter(Boolean);
  const omittedOlderEvents = Math.max(0, validEvents.length - MAX_VISIBLE_EVENTS);
  const unavailableEventCount = source.events.length - validEvents.length;
  const events = validEvents.slice(-MAX_VISIBLE_EVENTS);

  const active = source.active;
  const activeEffect = catalog.get(active?.effectId);
  const activePulse = activeEffect && Number.isSafeInteger(active.activeUntilMs)
    && active.activeUntilMs > source.simTimeMs
    ? { label: activeEffect.label, intensity: activeEffect.intensity,
      activeUntilMs: active.activeUntilMs } : null;
  const limits = source.aggregate?.limits;
  const budget = source.aggregate && validNumber(source.aggregate.reservedDose)
    && validTime(source.aggregate.reservedDurationMs) && validNumber(limits?.maxDose)
    && validTime(limits?.maxDurationMs) && validTime(limits?.windowMs)
    ? { reservedDose: source.aggregate.reservedDose, maxDose: limits.maxDose,
      reservedDurationMs: source.aggregate.reservedDurationMs, maxDurationMs: limits.maxDurationMs,
      windowMs: limits.windowMs }
    : null;

  return {
    available: true,
    simTimeMs: source.simTimeMs,
    activePulse,
    activeUnavailable: active !== null && active !== undefined && !activePulse,
    recoveryRemainingMs: validTime(source.recoveryRemainingMs) ? source.recoveryRemainingMs : null,
    budget,
    events,
    omittedOlderEvents,
    unavailableEventCount,
    persistentLearning: 'Unavailable; fixture weights do not change.',
  };
}
