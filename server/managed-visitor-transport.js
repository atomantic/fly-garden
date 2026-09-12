import { RuntimeError } from './runtime.js';

const BASES = new Set(['http://127.0.0.1:5553', 'http://127.0.0.1:5555', 'http://[::1]:5553', 'http://[::1]:5555']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export const visitorFailure = (code, message, statusCode = 409) => Object.assign(new RuntimeError(message, statusCode), { code });
/** Environment credentials stay inside this closure; callers receive only allowlisted configuration metadata. */
export function createManagedVisitorTransport({ baseUrl = process.env.FLY_GARDEN_PORTOS_URL,
  credential = process.env.FLY_GARDEN_VISITOR_CREDENTIAL, appId = process.env.FLY_GARDEN_MANAGED_APP_ID,
  fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const enabled = BASES.has(baseUrl) && typeof credential === 'string' && /^mv1_[a-f0-9]{64}$/.test(credential) && id(appId);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw visitorFailure('configuration', 'Invalid visitor request deadline.');
  async function request(path, body) {
    if (!enabled) throw visitorFailure('disabled', 'Local managed visitor bridge is not configured.');
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}/api/managed-visitors/v1${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, redirect: 'error' });
      if (!response.ok) throw visitorFailure(response.status === 401 || response.status === 403 ? 'unauthorized' : 'unavailable',
        response.status === 401 || response.status === 403 ? 'Managed visitor credential or scope was refused.' : 'Managed visitor broker refused the operation.');
      const reader = response.body?.getReader(); if (!reader) throw visitorFailure('invalid-response', 'Visitor response is unavailable.');
      const chunks = []; let size = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 16384) { await reader.cancel(); throw visitorFailure('invalid-response', 'Visitor response exceeds its bound.'); }
        chunks.push(Buffer.from(part.value));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw visitorFailure(signal.aborted ? 'timed-out' : 'disconnected', signal.aborted ? 'Visitor request timed out.' : 'Visitor connection or response unavailable.');
    }
  }
  const session = value => { if (!id(value)) throw visitorFailure('invalid-request', 'Invalid visitor session.'); return encodeURIComponent(value); };
  return { enabled, appId: enabled ? appId : null,
    capabilities: () => request('/capabilities'), admit: body => request('/admissions', body),
    observe: (id, body) => request(`/sessions/${session(id)}/observations`, body),
    action: (id, body) => request(`/sessions/${session(id)}/actions`, body),
    leave: (id, body) => request(`/sessions/${session(id)}/leave`, body),
    cancel: body => request('/admissions/cancel', body) };
}
