import { RuntimeError } from './runtime.js';

const BASES = new Set(['http://127.0.0.1:5553', 'http://127.0.0.1:5555', 'http://[::1]:5553', 'http://[::1]:5555']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
export const visitorFailure = (code, message, statusCode = 409) => Object.assign(new RuntimeError(message, statusCode), { code });
const present = value => typeof value === 'string' && value.length > 0;

/** Ordered settings checks. Each yields a distinct disabled code and explanation so an owner can
 * tell an unset host from an unapproved one, and either from a missing app grant or credential.
 * Reasons quote setting NAMES only: no configured value, and never the credential itself, is echoed. */
const SETTINGS = [
  { name: 'FLY_GARDEN_PORTOS_URL', read: config => config.baseUrl, valid: value => BASES.has(value),
    unset: ['host-unset', 'No local PortOS address is configured, so no managed visitor host is claimed. Set FLY_GARDEN_PORTOS_URL to an approved local PortOS loopback address.'],
    invalid: ['host-unsupported', `The configured PortOS address is not one of the ${BASES.size} approved local loopback addresses. Remote and non-loopback managed visitor hosts are refused, and no request was attempted.`] },
  { name: 'FLY_GARDEN_MANAGED_APP_ID', read: config => config.appId, valid: id,
    unset: ['app-unset', 'No managed app ID is configured. The owner approves a managed app in PortOS; set FLY_GARDEN_MANAGED_APP_ID to that app before any admission is possible.'],
    invalid: ['app-invalid', 'The configured managed app ID is not a valid managed app identifier, so no scoped admission can name this app.'] },
  { name: 'FLY_GARDEN_VISITOR_CREDENTIAL', read: config => config.credential, valid: value => /^mv1_[a-f0-9]{64}$/.test(value),
    // NFR-5: PortOS's own instance password is optional, and an instance running without one issues
    // no mv1_ app credential. The bridge then stays off with its own explanation rather than
    // attempting an unauthenticated visit, because admission always needs its own scoped grant.
    unset: ['credential-unset', 'No managed visitor credential is provisioned. PortOS issues this scoped mv1_ app credential separately, and an instance with its optional password unset issues none; the local bridge stays off instead of attempting an unauthenticated visit.'],
    invalid: ['credential-invalid', 'The configured managed visitor credential is not a well-formed mv1_ app credential. Re-provision the app credential in PortOS.'] },
];

// Frozen: a caller reading why the bridge is off must not be able to rewrite that answer.
const READY = Object.freeze({ enabled: true, code: 'ready', unresolved: Object.freeze([]),
  reason: 'Explicit visitor admission required.' });
/** No settings to inspect: no identity store, or a transport that publishes no diagnostic. */
const UNDIAGNOSED = Object.freeze({ enabled: false, code: 'disabled', unresolved: Object.freeze([]),
  reason: 'Local managed visitor bridge is disabled; no host connection is claimed.' });

/** Distinguishes why the bridge is off (FR-30, NFR-5) without disclosing any configured value.
 * `unresolved` names every setting still to fix, so one reason never hides the others. */
function describeVisitorConfiguration(config) {
  const failures = SETTINGS.flatMap(setting => {
    const value = setting.read(config);
    if (!present(value)) return [{ setting, kind: 'unset' }];
    return setting.valid(value) ? [] : [{ setting, kind: 'invalid' }];
  });
  if (!failures.length) return READY;
  const [code, reason] = failures[0].setting[failures[0].kind];
  return Object.freeze({ enabled: false, code, reason, unresolved: Object.freeze(failures.map(failure => failure.setting.name)) });
}

/** One wording per state, whether the transport publishes a diagnostic, is a test double, or is absent. */
export const visitorConfigurationOf = transport => transport?.configuration
  ?? (transport?.enabled === true ? READY : UNDIAGNOSED);

/** Environment credentials stay inside this closure; callers receive only allowlisted configuration metadata. */
export function createManagedVisitorTransport({ baseUrl = process.env.FLY_GARDEN_PORTOS_URL,
  credential = process.env.FLY_GARDEN_VISITOR_CREDENTIAL, appId = process.env.FLY_GARDEN_MANAGED_APP_ID,
  fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const configuration = describeVisitorConfiguration({ baseUrl, credential, appId }), enabled = configuration.enabled;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw visitorFailure('configuration', 'Invalid visitor request deadline.');
  async function request(path, body) {
    if (!enabled) throw visitorFailure('disabled', configuration.reason);
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
  return { enabled, configuration, appId: enabled ? appId : null,
    capabilities: () => request('/capabilities'), admit: body => request('/admissions', body),
    observe: (id, body) => request(`/sessions/${session(id)}/observations`, body),
    action: (id, body) => request(`/sessions/${session(id)}/actions`, body),
    leave: (id, body) => request(`/sessions/${session(id)}/leave`, body),
    cancel: body => request('/admissions/cancel', body) };
}
