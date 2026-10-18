import { jsonRequest } from './visitor-api.js';

const languageJson = (url, options) => jsonRequest(url, options, 'Language request refused');
export const readLanguage = (individualId, signal) => languageJson(`/api/individuals/${individualId}/language`, { signal });
export const postLanguage = (runtime, operation, payload) => languageJson(`/api/individuals/${runtime.individualId}/language`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ protocolVersion: 1, individualId: runtime.individualId, sessionId: runtime.sessionId,
    sequence: runtime.commandSequence + 1, operation, payload }),
});
/** Cancellation uses fresh command ordering for its original recipient, never a newly selected fly. */
export async function cancelLanguageRecipient(individualId, sessionId) {
  const runtime = await languageJson(`/api/individuals/${individualId}`);
  if (runtime.sessionId !== sessionId) return null;
  return postLanguage(runtime, 'cancel', {});
}
