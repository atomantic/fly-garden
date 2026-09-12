import { randomUUID } from 'node:crypto';
import { createLanguageGate, LanguageGateError, validateLanguageEvidence } from './language-gate.js';
const exact = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v,k));
const fail = message => { throw new LanguageGateError(message); };
const ARM_KEYS = ['providerId','model','maxCalls','maxTokens','maxSpendMicros','cooldownMs','detectorThresholdHz','detectorEnabled'];

/** Policy integration only. Caller supplies local snapshots; the wrapper has no runtime mutation authority. */
export function createLanguageService({ identities, providers = [], gate, aggregateSpendMicros = 100000,
  now = () => performance.now(), timeoutMs = 15000 } = {}) {
  if (!identities || typeof identities.snapshot !== 'function' || typeof identities.list !== 'function') fail('Language service requires an identity source.');
  gate ??= createLanguageGate({ providers, aggregateSpendMicros, now, timeoutMs });
  const tracked = new Map();
  function evidenceFor(state) {
    return validateLanguageEvidence({ individualId: state.individualId, sessionId: state.sessionId,
      namespace: state.dataset.namespace, modelId: state.model.id, source: 'live',
      startMs: Math.max(0, state.simTimeMs - 1000), endMs: state.simTimeMs,
      meanRateHz: state.neural.meanRateHz, spikeCount: state.neural.spikes,
      eventIds: (state.events ?? []).filter(e => e.timeMs >= Math.max(0,state.simTimeMs - 1000) && e.timeMs <= state.simTimeMs)
        .slice(0,16).map(e => String(e.id)) }, state.individualId);
  }
  function unavailable(id) {
    const prior = tracked.get(id);
    if (prior) {
      const view = gate.snapshot(id);
      if (view.armed || view.pending) gate.invalidate(id);
      prior.detectorEnabled = false;
      prior.failure = 'Language source unavailable.';
    }
    fail('Language source unavailable.');
  }
  function refresh(id) {
    let state, evidence;
    try {
      state = identities.snapshot(id);
      if (!state || state.individualId !== id) throw new Error('Source mismatch');
      evidence = evidenceFor(state);
    } catch { return unavailable(id); }
    const previous = tracked.get(id);
    gate.register(id, state.sessionId);
    const current = { sessionId:state.sessionId,status:state.status,environment:state.environment,resident:state.persistence?.resident !== false };
    if (!previous) tracked.set(id,{...current,detectorEnabled:false,nextAttempt:0,lastWindow:null,history:new Map(),hidden:new Set(),failure:null});
    else {
      if (previous.sessionId !== current.sessionId || previous.environment !== current.environment
        || previous.resident !== current.resident || (previous.status !== current.status && current.status !== 'running')) {
        if (previous.sessionId === current.sessionId) gate.invalidate(id);
        previous.detectorEnabled=false;
      }
      Object.assign(previous,current);
    }
    const t=tracked.get(id);
    if (current.resident) {
      const key=`${state.sessionId}:${state.simTimeMs}`;
      if (!t.history.has(key)) {
        t.history.set(key,evidence);
        if (t.history.size>64) t.history.delete(t.history.keys().next().value);
      }
    }
    return {state,t};
  }
  function snapshot(id) {
    const {t}=refresh(id), state=gate.snapshot(id);
    return {...state,detectorEnabled:t.detectorEnabled,failure:t.failure,
      evidenceWindows:[...t.history].map(([windowId,e])=>({windowId,sessionId:e.sessionId,startMs:e.startMs,endMs:e.endMs})),
      events:state.events.map(event=>t.hidden.has(event.requestId) && event.interpretation
        ? {...event,status:'canceled',interpretation:undefined,reason:'Source lifecycle changed before delivery.'}:event),
      evidenceDisclosure:'Mean rate is a trailing one-second fixture statistic; spike count is instantaneous. Historical windows are bounded server-captured observations.'};
  }
  function lifecycle(id) {
    const {t}=refresh(id); gate.invalidate(id); t.detectorEnabled=false;
    return snapshot(id);
  }
  function arm(id,body) {
    const {state,t}=refresh(id);
    if (!exact(body,ARM_KEYS) || typeof body.detectorEnabled !== 'boolean') fail('Invalid language arming body.');
    if (!t.resident || ['fault','saved-unloaded'].includes(state.status)) fail('Load a valid individual before arming language.');
    const {detectorEnabled,...config}=body;
    gate.arm(id,config);t.detectorEnabled=detectorEnabled;t.failure=null;
    return snapshot(id);
  }
  async function submit(id,request) {
    const {t}=refresh(id), sessionId=t.sessionId;
    t.nextAttempt=now()+gate.snapshot(id).config.cooldownMs;
    const result=await gate.request(id,request);
    let after;
    try { after=refresh(id); }
    catch {
      t.hidden.add(request.requestId);
      const {interpretation,...rest}=result;
      return {...rest,status:'canceled',reason:'Language source unavailable before delivery.'};
    }
    if (after.t.sessionId !== sessionId || !gate.snapshot(id).armed) {
      t.hidden.add(request.requestId);
      const {interpretation,...rest}=result;
      return {...rest,status:'canceled',reason:'Source lifecycle changed before delivery.'};
    }
    return result;
  }
  async function chat(id,body) {
    const {state,t}=refresh(id);
    if (!exact(body,['requestId','message','windowId']) || !(body.windowId===null || typeof body.windowId==='string')) fail('Invalid caretaker chat body.');
    if (!t.resident || state.status==='fault') fail('Caretaker chat requires a loaded valid individual.');
    if (!gate.snapshot(id).armed) fail('Language is disarmed.');
    let evidence;
    if (body.windowId===null) evidence=evidenceFor(state);
    else {
      const saved=t.history.get(body.windowId);
      if (!saved) fail('Historical evidence window is unavailable.');
      evidence={...structuredClone(saved),source:'history'};
    }
    return submit(id,{kind:'caretaker',requestId:body.requestId,message:body.message,evidence});
  }
  async function tick() {
    const pending=[];
    for (const {individualId:id} of identities.list().slice(0,64)) {
      try {
        const {state,t}=refresh(id), view=gate.snapshot(id), time=now();
        if (!t.resident || state.status!=='running' || !view.armed || !t.detectorEnabled || view.pending
          || !Number.isFinite(time) || time<t.nextAttempt || state.simTimeMs<=0) continue;
        const provider=view.providers.find(p=>p.providerId===view.config.providerId && p.model===view.config.model);
        if (!provider || view.reserved.calls>=view.config.maxCalls || provider.requestTokens>view.config.maxTokens-view.reserved.tokens
          || provider.requestSpendMicros>view.config.maxSpendMicros-view.reserved.spendMicros
          || provider.requestSpendMicros>view.aggregateSpendMicros-view.aggregateReservedSpendMicros) continue;
        const evidence=evidenceFor(state), key=`${evidence.sessionId}:${evidence.endMs}`;
        if (key===t.lastWindow || evidence.meanRateHz<view.config.detectorThresholdHz) continue;
        t.lastWindow=key;
        const work=submit(id,{kind:'detector',requestId:randomUUID(),message:'',evidence})
          .catch(()=>{t.failure='Detector request rejected; no simulation state changed.';});
        pending.push(work);
      } catch { const t=tracked.get(id); if (t) t.failure='Language source unavailable.'; }
    }
    return Promise.allSettled(pending);
  }
  return {snapshot,refresh:id=>{refresh(id);return snapshot(id);},arm,chat,tick,lifecycle,
    disarm(id,body={}) { if (!exact(body,[])) fail('Expected an empty disarm body.');refresh(id);gate.disarm(id);tracked.get(id).detectorEnabled=false;return snapshot(id); },
    cancel(id,body={}) {
      const scoped = exact(body,['requestId']);
      if (!exact(body,[]) && (!scoped || typeof body.requestId !== 'string' || body.requestId.length < 1 || body.requestId.length > 128)) fail('Expected an empty cancellation body or one valid requestId.');
      refresh(id);
      if (!scoped) { gate.cancel(id); tracked.get(id).detectorEnabled=false; }
      else if (gate.cancelRequest(id,body.requestId)) tracked.get(id).detectorEnabled=false;
      return snapshot(id);
    },
    close() {for (const id of tracked.keys()) gate.invalidate(id);} };
}
