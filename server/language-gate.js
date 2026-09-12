import { randomUUID, createHash } from 'node:crypto';

export const LANGUAGE_DISCLOSURE = 'Generated telemetry interpretation with uncertainty; not the fly speaking, thought decoding, consent or demonstrated language understanding. No simulation feedback or tools are enabled.';
export const LANGUAGE_DETECTOR = 'mean-rate-threshold-v1';
const exact = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 128;
const uint = v => Number.isSafeInteger(v) && v >= 0;
const positive = v => uint(v) && v > 0;
const providerKey = (providerId, model) => JSON.stringify([providerId, model]);
export class LanguageGateError extends Error {
  constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}
const fail = message => { throw new LanguageGateError(message); };
export function validateLanguageEvidence(value, individualId) {
  if (!exact(value, ['individualId', 'sessionId', 'namespace', 'modelId', 'source', 'startMs', 'endMs', 'meanRateHz', 'spikeCount', 'eventIds'])
    || value.individualId !== individualId || ![value.individualId,value.sessionId,value.namespace,value.modelId].every(id)
    || !['live','history'].includes(value.source) || ![value.startMs,value.endMs,value.spikeCount].every(uint)
    || value.startMs > value.endMs || value.endMs - value.startMs > 60000
    || !Number.isFinite(value.meanRateHz) || value.meanRateHz < 0 || value.meanRateHz > 10000
    || !Array.isArray(value.eventIds) || value.eventIds.length > 32 || !value.eventIds.every(id)) fail('Invalid language evidence window.');
  return structuredClone(value);
}

/** Provider implementations are trusted, explicitly configured adapters, never arbitrary URLs or tools.
 * requestTokens/requestSpendMicros are enforced upper-bound reservations including prompt + response.
 */
export function createLanguageGate({ providers = [], aggregateSpendMicros = 100000,
  now = () => performance.now(), timeoutMs = 15000 } = {}) {
  if (!uint(aggregateSpendMicros) || !positive(timeoutMs) || timeoutMs > 60000 || !Array.isArray(providers) || providers.length > 16) fail('Invalid language gate limits.');
  const adapters = new Map();
  for (const p of providers) {
    if (!exact(p, ['providerId','model','requestTokens','requestSpendMicros','maxOutputTokens','generate'])
      || ![p.providerId,p.model].every(id) || adapters.has(providerKey(p.providerId,p.model))
      || ![p.requestTokens,p.maxOutputTokens].every(positive) || !uint(p.requestSpendMicros)
      || p.maxOutputTokens >= p.requestTokens || typeof p.generate !== 'function') fail('Invalid language provider adapter.');
    adapters.set(providerKey(p.providerId,p.model), { ...p });
  }
  const individuals = new Map();
  let aggregateReserved = 0;
  function get(individualId) { const s = individuals.get(individualId); if (!s) fail('Language identity is not registered.'); return s; }
  function log(s, event) { s.events.push({ eventId: randomUUID(), ...event }); if (s.events.length > 100) s.events.shift(); }
  function invalidate(individualId, reason = 'Lifecycle changed; language disarmed.') {
    const s = get(individualId); s.armed = false; s.epoch++;
    s.pending?.cancel();
    log(s, { status: 'canceled', reason });
  }
  function register(individualId, sessionId) {
    if (![individualId,sessionId].every(id)) fail('Invalid language identity.');
    if (individuals.has(individualId)) {
      const s = get(individualId);
      if (s.sessionId !== sessionId) { invalidate(individualId); s.sessionId = sessionId; }
      return snapshot(individualId);
    }
    if (individuals.size >= 64) fail('Language identity limit reached.');
    individuals.set(individualId, { individualId, sessionId, armed: false, epoch: 0, pending: null, inFlight: false,
      config: null, calls: 0, tokens: 0, spendMicros: 0, lastCall: null, seen: new Set(), events: [] });
    return snapshot(individualId);
  }
  function snapshot(individualId) {
    const s = get(individualId);
    return structuredClone({ individualId, sessionId: s.sessionId, available: adapters.size > 0,
      reason: adapters.size ? null : 'No language provider configured; no generated speech available.',
      providers: [...adapters.values()].map(({ generate, ...p }) => p), armed: s.armed, config: s.config,
      pending: Boolean(s.pending || s.inFlight), transportPending: s.inFlight, reserved: { calls: s.calls, tokens: s.tokens, spendMicros: s.spendMicros },
      aggregateReservedSpendMicros: aggregateReserved, aggregateSpendMicros, events: s.events,
      disclosure: LANGUAGE_DISCLOSURE });
  }
  function arm(individualId, config) {
    const s = get(individualId);
    if (!exact(config, ['providerId','model','maxCalls','maxTokens','maxSpendMicros','cooldownMs','detectorThresholdHz'])
      || !adapters.has(providerKey(config.providerId,config.model)) || ![config.maxCalls,config.maxTokens,config.cooldownMs].every(positive) || !uint(config.maxSpendMicros)
      || config.maxCalls > 1000 || config.cooldownMs < 1000 || !Number.isFinite(config.detectorThresholdHz)
      || config.detectorThresholdHz < 0 || config.detectorThresholdHz > 10000) fail('Invalid arming settings or unavailable provider.');
    if (s.pending || s.inFlight) fail('Cancel pending interpretation before reconfiguring.');
    s.config = structuredClone(config); s.armed = true;
    log(s, { status: 'armed' }); return snapshot(individualId);
  }
  async function request(individualId, request) {
    const s = get(individualId);
    const reject = message => { log(s, { status: 'rejected', reason: message }); fail(message); };
    if (!exact(request, ['kind','requestId','message','evidence']) || !['caretaker','detector'].includes(request.kind)
      || !id(request.requestId) || typeof request.message !== 'string' || request.message.length > 1000
      || (request.kind === 'caretaker' ? !request.message.trim() : request.message !== '')) reject('Invalid language request.');
    const evidence = validateLanguageEvidence(request.evidence, individualId);
    if (!s.armed) reject('Language is disarmed.');
    if (s.pending || s.inFlight) reject('Language request already pending.');
    if (request.kind === 'detector' && (evidence.source !== 'live' || evidence.sessionId !== s.sessionId
      || evidence.meanRateHz < s.config.detectorThresholdHz)) reject('Detector condition is not satisfied for this live session.');
    if (evidence.source === 'live' && evidence.sessionId !== s.sessionId) reject('Stale live evidence session.');
    const detector = request.kind === 'detector' ? { version: LANGUAGE_DETECTOR, thresholdHz: s.config.detectorThresholdHz } : null;
    const key = request.kind === 'detector'
      ? createHash('sha256').update(JSON.stringify([evidence.sessionId,evidence.startMs,evidence.endMs,LANGUAGE_DETECTOR])).digest('hex') : request.requestId;
    if (s.seen.has(key)) reject('Duplicate language request.');
    const adapter = adapters.get(providerKey(s.config.providerId,s.config.model)), time = now();
    if (!Number.isFinite(time) || (s.lastCall !== null && time - s.lastCall < s.config.cooldownMs)) reject('Language cooldown is active.');
    if (s.calls >= s.config.maxCalls || adapter.requestTokens > s.config.maxTokens - s.tokens
      || adapter.requestSpendMicros > s.config.maxSpendMicros - s.spendMicros
      || adapter.requestSpendMicros > aggregateSpendMicros - aggregateReserved) reject('Language budget exhausted.');
    const payload = { individualId, sessionId: s.sessionId, kind: request.kind, message: request.message,
      evidence, detector, disclosure: LANGUAGE_DISCLOSURE, maxTotalTokens: adapter.requestTokens, maxOutputTokens: adapter.maxOutputTokens };
    // One byte per prompt token is conservative; reserve output separately before any provider work.
    if (Buffer.byteLength(JSON.stringify(payload)) + adapter.maxOutputTokens > adapter.requestTokens) reject('Evidence exceeds the provider token reservation.');
    s.seen.add(key); s.calls++; s.tokens += adapter.requestTokens; s.spendMicros += adapter.requestSpendMicros;
    aggregateReserved += adapter.requestSpendMicros; s.lastCall = time;
    const epoch = s.epoch, controller = new AbortController();
    let cancel;
    const canceled = new Promise(resolve => { cancel = () => { controller.abort(); resolve({ failure: 'canceled' }); }; });
    s.pending = { cancel, requestId: request.requestId };
    const provenance = { requestId: request.requestId, individualId, sessionId: s.sessionId,
      providerId: adapter.providerId, model: adapter.model, evidence, detector, disclosure: LANGUAGE_DISCLOSURE };
    log(s, { status: 'pending', ...provenance });
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ failure: 'timeout' }); }, timeoutMs); });
    try {
      const result = await Promise.race([canceled, timeout, Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error('Canceled before dispatch'); s.inFlight = true; return adapter.generate(structuredClone(payload), { signal: controller.signal }); })
        .then(response => ({ response }), () => ({ failure: 'provider-failed' })).finally(() => { s.inFlight = false; })]);
      if (s.epoch !== epoch || !s.armed || result.failure) {
        const output = { status: result.failure ?? 'canceled', ...provenance };
        log(s, output); return structuredClone(output);
      }
      const r = result.response;
      if (!exact(r, ['text','totalTokens']) || typeof r.text !== 'string' || !r.text.trim()
        || r.text.length > 8192 || !positive(r.totalTokens) || r.totalTokens > adapter.requestTokens) {
        const output = { status: 'invalid-response', ...provenance }; log(s, output); return structuredClone(output);
      }
      const output = { status: 'complete', interpretation: r.text, uncertainty: 'Generated interpretation may be incorrect; evidence does not establish mental state.', ...provenance };
      log(s, output); return structuredClone(output);
    } finally { clearTimeout(timer); s.pending = null; }
  }
  function cancelRequest(individualId, requestId) {
    if (!id(requestId)) fail('Invalid scoped cancellation request ID.');
    const s = get(individualId);
    if (s.pending?.requestId !== requestId) return false;
    invalidate(individualId, 'Original pending request explicitly canceled.');
    return true;
  }
  return { register, snapshot, arm, request, invalidate, cancelRequest,
    disarm: individualId => { invalidate(individualId, 'Explicitly disarmed.'); return snapshot(individualId); },
    cancel: individualId => { invalidate(individualId, 'Explicitly canceled.'); return snapshot(individualId); } };
}
