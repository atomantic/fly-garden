import { readRuntimeSnapshot } from './runtime-state.js';
export async function visitorJson(url, options = {}) {
  const response = await fetch(url, options), value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message || 'Visitor request refused');
  return value;
}
export async function postVisitorCommand(runtime, operation, payload = {}, signal) {
  const id = runtime.individualId, sessionId = runtime.sessionId;
  const current = readRuntimeSnapshot(await visitorJson(`/api/individuals/${encodeURIComponent(id)}`, { signal }));
  if (current.individualId !== id || current.sessionId !== sessionId) throw new Error('This individual changed sessions. Refresh before issuing a visitor command.');
  return visitorJson(`/api/individuals/${encodeURIComponent(id)}/visitor`, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1,
      individualId: id, sessionId, sequence: current.commandSequence + 1, operation, payload }) });
}
