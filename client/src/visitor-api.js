import { readRuntimeSnapshot } from './runtime-state.js';
/** One JSON read/POST for the scoped panels: the server's own reason, or the caller's fallback, on refusal. */
export async function jsonRequest(url, options = {}, fallback = 'Request refused') {
  const response = await fetch(url, options), value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || fallback);
  return value;
}
export const visitorJson = (url, options) => jsonRequest(url, options, 'Visitor request refused');
export async function postVisitorCommand(runtime, operation, payload = {}, signal) {
  const id = runtime.individualId, sessionId = runtime.sessionId;
  const current = readRuntimeSnapshot(await visitorJson(`/api/individuals/${encodeURIComponent(id)}`, { signal }));
  if (current.individualId !== id || current.sessionId !== sessionId) throw new Error('This individual changed sessions. Refresh before issuing a visitor command.');
  return visitorJson(`/api/individuals/${encodeURIComponent(id)}/visitor`, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1,
      individualId: id, sessionId, sequence: current.commandSequence + 1, operation, payload }) });
}
