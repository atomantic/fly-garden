import { podRosterEntry } from './visitor-phase.js';
import { languageRosterStatus } from './language-reply-ledger.js';

/** Pure roster assembly: the individual list, the health pod roster and the language ledger become
 * one row per individual. A row carries the runtime session the list reported for it, so its own
 * controls bind to what the caretaker saw; it never inherits another row's session or the selected
 * fly's state. */
export function buildFlyRoster({ individuals = [], visitorRoster = [], selectedId = '', ledger = null } = {}) {
  const pods = new Map(visitorRoster.filter(entry => entry?.individualId).map(entry => [entry.individualId, entry]));
  return individuals.filter(item => typeof item?.individualId === 'string' && item.individualId).map(item => ({
    individualId: item.individualId,
    sessionId: typeof item.sessionId === 'string' && item.sessionId ? item.sessionId : null,
    resident: Boolean(item.resident),
    selected: item.individualId === selectedId,
    pod: pods.get(item.individualId) ?? podRosterEntry({ individualId: item.individualId }),
    language: ledger ? languageRosterStatus(ledger, item.individualId) : null,
  }));
}

/** A visitor reply refreshes that fly's roster entry in place; the next health read stays authoritative. */
export function mergeRosterReply(visitorRoster, state) {
  if (typeof state?.individualId !== 'string' || !state.individualId || !state.visitor || typeof state.visitor !== 'object') return visitorRoster;
  const entry = podRosterEntry({ ...state.visitor, individualId: state.individualId });
  return visitorRoster.some(item => item.individualId === state.individualId)
    ? visitorRoster.map(item => item.individualId === state.individualId ? entry : item) : [...visitorRoster, entry];
}

/** Roving selection: the row an arrow, Home or End key lands on, or null for any other key. */
export function rosterKeyTarget(key, index, length) {
  if (!Number.isInteger(length) || length < 1) return null;
  const current = Number.isInteger(index) && index >= 0 && index < length ? index : 0;
  switch (key) {
    case 'ArrowDown': case 'ArrowRight': return (current + 1) % length;
    case 'ArrowUp': case 'ArrowLeft': return (current - 1 + length) % length;
    case 'Home': return 0;
    case 'End': return length - 1;
    default: return null;
  }
}

/** The envelope a row's own controls use. Never the selected fly's; null when the row cannot be commanded. */
export function rowCommandTarget(row) {
  return row?.resident && typeof row.sessionId === 'string' && row.sessionId
    ? { individualId: row.individualId, sessionId: row.sessionId } : null;
}

/** Which per-fly actions a row offers. Return is available whenever the bridge owns the fly;
 * a visit can be requested only from home, for a resident with a known session, on a configured bridge. */
export function rowVisitorActions(row, { bridgeConfigured = false } = {}) {
  const target = rowCommandTarget(row);
  return { target, canReturn: Boolean(target) && Boolean(row.pod?.owned),
    canVisit: Boolean(target) && !row.pod?.owned && row.pod?.phase === 'home' && bridgeConfigured };
}
