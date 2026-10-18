import { sessionKey } from './runtime-state.js';

/** Browser-side attribution of caretaker language requests across selection changes.
 *
 * The server keys every language request by its envelope individual and session and has no
 * active-selection input (docs/LANGUAGE_SERVICE.md). This ledger is the browser's half of that
 * contract: a request begun for one fly stays with that fly while the caretaker looks at another,
 * its reply is readable only under that fly's own key, and the newly selected fly's panel never
 * receives it. Pure functions over an immutable ledger, so the rule is testable without React.
 */
export const emptyLanguageLedger = Object.freeze({ entries: Object.freeze({}) });

const text = value => typeof value === 'string' && value.length > 0;
const valid = request => Boolean(request) && text(request.individualId) && text(request.sessionId)
  && text(request.requestId) && request.key === sessionKey(request.individualId, request.sessionId);

/** Record a request for exactly one individual and session. A later request for the same key supersedes it. */
export function beginLanguageRequest(ledger, request, startedAt = Date.now()) {
  if (!valid(request)) return ledger;
  const entry = { key: request.key, individualId: request.individualId, sessionId: request.sessionId,
    requestId: request.requestId, startedAt, settledAt: null, outcome: null };
  return { entries: { ...ledger.entries, [request.key]: entry } };
}

/** A settle applies only to the exact request it answers; a superseded request's late result is dropped. */
export function settleLanguageRequest(ledger, request, outcome, settledAt = Date.now()) {
  const entry = valid(request) ? ledger.entries[request.key] : null;
  if (!entry || entry.requestId !== request.requestId || entry.settledAt !== null) return ledger;
  const safe = outcome?.ok ? { ok: true, result: outcome.result ?? null }
    : { ok: false, error: text(outcome?.error) ? outcome.error : 'Language reply unavailable.' };
  return { entries: { ...ledger.entries, [request.key]: { ...entry, settledAt, outcome: safe } } };
}

/** The request still in flight for exactly this individual and session, or null. */
export function pendingLanguageRequest(ledger, key) {
  const entry = ledger.entries[key];
  return entry && entry.settledAt === null ? entry : null;
}

/** The settled reply for exactly this individual and session; never another fly's. */
export function settledLanguageReply(ledger, key) {
  const entry = ledger.entries[key];
  return entry && entry.settledAt !== null ? entry : null;
}

/** The roster word for one individual's most recent request across its sessions, or null. */
export function languageRosterStatus(ledger, individualId) {
  const entry = Object.values(ledger.entries).filter(item => item.individualId === individualId)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  return !entry ? null : entry.settledAt === null ? 'pending' : entry.outcome.ok ? 'received' : 'failed';
}
