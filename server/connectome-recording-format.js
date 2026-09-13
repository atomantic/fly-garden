import { LIF_MODEL, validateNeuronSampleIds } from './sparse-lif.js';
import { connectomeProfile } from './connectome-profiles.js';
export const RECORDING_LIMITS=Object.freeze({maxBytes:32*1024*1024,maxSessions:100,maxRecords:10000,maxChunkBytes:65536});
export const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const label=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const fail=()=>{throw new Error('Invalid connectome recording data');};
export function validateRecordingSource(source,selection) {
 if(!exact(source,['individualId','dataset','graphSha256','graphManifestSha256','sessionEpoch','model','checkpointId'])
  ||!label(source.individualId)||!label(source.sessionEpoch)||!sha(source.graphSha256)||!sha(source.graphManifestSha256)
  ||!(source.checkpointId===null||uuid(source.checkpointId)))fail();
 const model={...LIF_MODEL,id:connectomeProfile(source.dataset).modelId};
 if(!exact(source.model,Object.keys(model))||Object.entries(model).some(([key,value])=>source.model[key]!==value))fail();
 if(!exact(selection,['mode','neuronIds','selectedCount','retainedNeuronCount'])||selection.mode!=='explicit-ids'
  ||!uint(selection.retainedNeuronCount)||selection.retainedNeuronCount<1||selection.retainedNeuronCount>2000000
  ||selection.selectedCount!==selection.neuronIds?.length||selection.selectedCount>selection.retainedNeuronCount)fail();
 validateNeuronSampleIds(selection.neuronIds,source.dataset);
}
export function validateSampleSession(s) {
 if(!exact(s,['schemaVersion','kind','id','status','startedAtMs','source','selection','nextSequence','droppedSamples','failure','lastTick','maxBytes','maxChunkBytes'])
  ||s.schemaVersion!==1||s.kind!=='connectome-sample-recording'||!uuid(s.id)||!['recording','partial','complete'].includes(s.status)
  ||!uint(s.startedAtMs)||s.startedAtMs>8640000000000000||!uint(s.nextSequence)||s.nextSequence>RECORDING_LIMITS.maxRecords
  ||!uint(s.droppedSamples)||!(s.failure===null||typeof s.failure==='string'&&s.failure.length<=256)
  ||!(s.lastTick===null||uint(s.lastTick))||!uint(s.maxBytes)||s.maxBytes<1||s.maxBytes>RECORDING_LIMITS.maxBytes
  ||!uint(s.maxChunkBytes)||s.maxChunkBytes<1||s.maxChunkBytes>RECORDING_LIMITS.maxChunkBytes)fail();
 validateRecordingSource(s.source,s.selection);return s;
}
export function validateSampleRecord(r,s) {
 if(!exact(r,['schemaVersion','sequence','eventId','wallTimeMs','tick','simTimeMs','commandSequence','status','checkpointId','timeWindow','samples'])
  ||r.schemaVersion!==1||!uint(r.sequence)||r.sequence>=s.nextSequence||r.eventId!==`${s.id}:${r.sequence}`
  ||!uint(r.wallTimeMs)||r.wallTimeMs>8640000000000000||!uint(r.tick)||!uint(r.simTimeMs)||r.simTimeMs!==r.tick*s.source.model.dtMs
  ||!uint(r.commandSequence)||!['paused','running','resting'].includes(r.status)||!(r.checkpointId===null||uuid(r.checkpointId))
  ||!exact(r.timeWindow,['kind','startTick','endTick','startSimTimeMs','endSimTimeMs'])||r.timeWindow.kind!=='instantaneous'
  ||r.timeWindow.startTick!==r.tick||r.timeWindow.endTick!==r.tick||r.timeWindow.startSimTimeMs!==r.simTimeMs||r.timeWindow.endSimTimeMs!==r.simTimeMs
  ||!Array.isArray(r.samples)||r.samples.length!==s.selection.selectedCount)fail();
 for(let i=0;i<r.samples.length;i++){const value=r.samples[i];if(!exact(value,['neuronId','potential','firing','refractoryStepsRemaining'])
  ||value.neuronId!==s.selection.neuronIds[i]||!Number.isFinite(value.potential)||value.potential>=s.source.model.threshold||![0,1].includes(value.firing)
  ||!uint(value.refractoryStepsRemaining)||value.refractoryStepsRemaining>s.source.model.refractorySteps
  ||value.refractoryStepsRemaining>0&&value.potential!==s.source.model.reset
  ||(value.firing===1)!==(value.refractoryStepsRemaining===s.source.model.refractorySteps))fail();}
 return r;
}
export function validateConnectomeRecording(value) {
 if(!exact(value,['schemaVersion','kind','session','records','gaps','complete'])||value.schemaVersion!==1||value.kind!=='connectome-sample-recording-export'
  ||!Array.isArray(value.records)||value.records.length>RECORDING_LIMITS.maxRecords||!Array.isArray(value.gaps)||value.gaps.length>RECORDING_LIMITS.maxRecords||typeof value.complete!=='boolean')fail();
 const s=validateSampleSession(value.session),seen=new Set();let tick=-1,sequence=-1,previous=null;
 for(const r of value.records){validateSampleRecord(r,s);if(r.tick<tick||r.sequence<=sequence||previous&&r.commandSequence<previous.commandSequence
  ||previous&&r.tick===previous.tick&&r.samples.some((sample,i)=>['potential','firing','refractoryStepsRemaining'].some(key=>sample[key]!==previous.samples[i][key])))fail();
  tick=r.tick;sequence=r.sequence;previous=r;seen.add(r.sequence);}
 for(const gap of value.gaps){if(!exact(gap,['sequence','reason'])||!uint(gap.sequence)||gap.sequence>=s.nextSequence||seen.has(gap.sequence)||gap.reason!=='Missing or corrupt chunk')fail();seen.add(gap.sequence);}
 if(seen.size!==s.nextSequence||tick>=0&&(s.lastTick===null||s.lastTick<tick)||!value.gaps.length&&s.lastTick!==(tick===-1?null:tick)
  ||value.complete!==(s.status==='complete'&&value.records.length>0&&!value.gaps.length&&!s.droppedSamples))fail();
 return structuredClone(value);
}
