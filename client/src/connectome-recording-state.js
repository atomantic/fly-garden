const uint=v=>Number.isSafeInteger(v)&&v>=0;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function readRecordedSession(s){
 if(!s||s.schemaVersion!==1||s.kind!=='connectome-sample-recording'||typeof s.id!=='string'||!['recording','partial','complete'].includes(s.status)
  ||!uint(s.startedAtMs)||s.startedAtMs>8640000000000000||!uint(s.nextSequence)||s.nextSequence>10000||!uint(s.droppedSamples)
  ||!['male-cns:v1.0','banc:v888'].includes(s.source?.dataset)||typeof s.source.individualId!=='string'||typeof s.source.sessionEpoch!=='string'
  ||!sha(s.source.graphSha256)||!sha(s.source.graphManifestSha256)||typeof s.source.model?.id!=='string'
  ||!s.selection||s.selection.mode!=='explicit-ids'||!Array.isArray(s.selection.neuronIds)||s.selection.neuronIds.length<1||s.selection.neuronIds.length>256
  ||s.selection.neuronIds.some(id=>typeof id!=='string'||id.length>128||!id.startsWith(`${s.source.dataset}/`))
  ||new Set(s.selection.neuronIds).size!==s.selection.neuronIds.length||s.selection.selectedCount!==s.selection.neuronIds.length||!uint(s.selection.retainedNeuronCount)||s.selection.retainedNeuronCount<s.selection.selectedCount)
  throw new Error('Recording metadata is incompatible.');
 return s;
}
/** The bounded recording list, validated once for every panel that reads it. */
export function readRecordedListing(value){
 if(!value||!Array.isArray(value.sessions)||value.sessions.length>100)throw new Error('Recording list is incompatible.');
 value.sessions.forEach(readRecordedSession);return value;
}
export function readRecordedReplay(value){
 const s=readRecordedSession(value?.session);
 if(value.schemaVersion!==1||value.kind!=='connectome-sample-recording-export'||value.mode!=='read-only'||value.canResume!==false
  ||typeof value.complete!=='boolean'||!Array.isArray(value.records)||value.records.length>10000||!Array.isArray(value.gaps)||value.gaps.length>10000)throw new Error('Replay must be inert bounded recording data.');
 let tick=-1,sequence=-1;
 for(const r of value.records){if(!uint(r.tick)||r.tick<tick||!uint(r.sequence)||r.sequence<=sequence||r.sequence>=s.nextSequence
  ||!uint(r.simTimeMs)||r.simTimeMs!==r.tick*s.source.model.dtMs||!uint(r.wallTimeMs)||!Array.isArray(r.samples)||r.samples.length!==s.selection.selectedCount
  ||r.timeWindow?.kind!=='instantaneous'||r.timeWindow.startTick!==r.tick||r.timeWindow.endTick!==r.tick||r.timeWindow.startSimTimeMs!==r.simTimeMs||r.timeWindow.endSimTimeMs!==r.simTimeMs)throw new Error('Recorded sample timing is invalid.');
  r.samples.forEach((n,i)=>{if(n.neuronId!==s.selection.neuronIds[i]||!Number.isFinite(n.potential)||![0,1].includes(n.firing)||!uint(n.refractoryStepsRemaining)||n.refractoryStepsRemaining>2)throw new Error('Recorded neuron values are invalid.');});tick=r.tick;sequence=r.sequence;}
 if(value.gaps.some(g=>!uint(g.sequence)||g.sequence>=s.nextSequence||g.reason!=='Missing or corrupt chunk')
  ||new Set([...value.records,...value.gaps].map(r=>r.sequence)).size!==s.nextSequence||value.records.length+value.gaps.length!==s.nextSequence
  ||value.complete!==(s.status==='complete'&&value.records.length>0&&!value.gaps.length&&!s.droppedSamples))throw new Error('Recorded gap metadata is invalid.');return value;
}
export const sameRecordingRequest=(request,current)=>request.key===current.key&&request.generation===current.generation;
