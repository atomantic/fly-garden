/** Display-only helpers. No command, provider, worker or graph authority. */
export const observationScope = s => `${s?.individualId ?? ''}/${s?.sessionId ?? ''}`;
export function appendRateObservation(history, state) {
  const timeMs = state?.simTimeMs, rateHz = state?.neural?.meanRateHz;
  if (!Number.isSafeInteger(timeMs) || timeMs < 0 || !Number.isFinite(rateHz)) return history;
  const scope = observationScope(state), prior = history.at(-1);
  if (prior?.scope === scope && prior.timeMs >= timeMs) return history;
  return [...(prior?.scope === scope ? history.slice(-49) : []), { scope, timeMs, rateHz }];
}
export function ratePoints(history) {
  const start = history[0]?.timeMs ?? 0, span = (history.at(-1)?.timeMs ?? start) - start;
  return history.map(row => `${span ? (row.timeMs-start)*600/span : 0},${75-Math.min(100,Math.max(0,row.rateHz))*.7}`).join(' ');
}
export function eventObservations(state) {
  if (!state) return [];
  const rows = [...(state.events ?? [])];
  const trace = state.environmentAdapter?.lastTrace;
  if (observationScope(trace) === observationScope(state) && Number.isSafeInteger(trace?.outputSimTimeMs)) rows.push({id:`frame:${trace.environmentEpoch}:${trace.frameId}`,timeMs:trace.outputSimTimeMs,type:'accepted-frame',message:'Retained controller-camera neural-step and motor record',details:trace});
  const garden = state.encounterDynamics;
  if (observationScope(garden) === observationScope(state)) for (const [index,event] of (garden?.events ?? []).entries()) rows.push({id:`garden:${event.environmentEpoch}:${index}`,timeMs:event.simTimeMs,type:'encounter',message:event.kind,details:event});
  return rows.sort((a,b)=>b.timeMs-a.timeMs).slice(0,161);
}
export function relatedObservations(state, event, artifact, language) {
  const scope = observationScope(state), time = event.timeMs;
  if (!eventObservations(state).some(e => e.id === event.id && e.timeMs === time)) throw new Error('Event no longer belongs to this captured source');
  const same = value => value?.individualId === state.individualId && value?.sessionId === state.sessionId;
  const trace = state.environmentAdapter?.lastTrace;
  const sensoryMotor = same(trace) && trace.inputSimTimeMs <= time && trace.outputSimTimeMs >= time ? trace : null;
  const garden = state.encounterDynamics;
  const chemistry = same(garden) ? (garden.events ?? []).filter(e => e.simTimeMs === time) : [];
  const actions = (artifact?.source?.actions ?? []).filter(a => same(a) && a.simulationTimeMs === time);
  const actionIds = new Set(actions.map(a => a.sourceActionId ?? a.id));
  const artifacts = (artifact?.events ?? []).filter(e => same(e) && actionIds.has(e.sourceActionId));
  const interpretations = (language?.events ?? []).filter(e => same(e) && e.evidence?.startMs <= time && e.evidence?.endMs >= time);
  return { scope, event, timeWindow: {startMs:time,endMs:time}, sensoryMotor, chemistry, actions, artifacts, interpretations };
}
