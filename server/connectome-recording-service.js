import { RuntimeError } from './runtime.js';
import { exact,validateSampleRecord } from './connectome-recording-format.js';
const failed=(message,status=409)=>{throw new RuntimeError(message,status);};
/** Captures only on an explicit operation. Replay methods receive no neural capability. */
export function createConnectomeRecordingService({store=null,connectomes,fixtureStorage=()=>null}={}) {
 const pending=new Map(),starting=new Set();let failure=null;
 const required=()=>{if(!store)failed('Connectome recording storage is unavailable.');return store;};
 const get=id=>{const s=required().list().find(s=>s.id===id);if(!s)failed('Connectome recording not found.',404);return s;};
 function current(source){const state=connectomes.snapshot(source.individualId);if(!state.resident||!['paused','running','resting'].includes(state.status)
  ||state.dataset!==source.dataset||state.sessionEpoch!==source.sessionEpoch||state.graphSha256!==source.graphSha256)failed('The recorded worker session is no longer resident.');return state;}
 function sourceChanged(id){if(!store)return;let sessions;try{sessions=store.list();}catch{failure='Could not read source-boundary recording status';return;}for(const s of sessions.filter(s=>s.status==='recording'&&s.source.individualId===id)){
  try{current(s.source);}catch{try{store.partial(s.id,'Source session ended; recording did not follow it');}catch{failure='Could not persist source-boundary recording status';}}
 }}
 const scope=s=>({protocolVersion:1,individualId:s.source.individualId,dataset:s.source.dataset,graphSha256:s.source.graphSha256,sessionEpoch:s.source.sessionEpoch,neuronIds:s.selection.neuronIds});
 async function boundary(operation){try{return await operation();}catch(e){if(e instanceof RuntimeError)throw e;failed('Connectome recording operation failed. Read its status before retrying.');}}
 return {
  sourceChanged,
  view(){return{available:!!store,sessions:store?.list()??[],storage:store?.status()??null,combinedChunkBudgetBytes:(store?.status().maxBytes??0)+(fixtureStorage()?.maxBytes??0),failure};},
  start(body){return boundary(async()=>{
   required();if(!exact(body,['protocolVersion','individualId','dataset','graphSha256','sessionEpoch','neuronIds']))failed('Invalid recording source envelope.',400);
   if(starting.has(body.individualId)||store.list().some(s=>s.status==='recording'&&s.source.individualId===body.individualId))failed('This individual already has a recording or pending start.');
   starting.add(body.individualId);
   try{
    // Resolves every requested ID against the authoritative graph, but appends nothing.
    const sample=await connectomes.sample(body.individualId,body),state=current(body);
    if(state.commandSequence!==sample.commandSequence||state.provenance?.manifestSha256!==sample.provenance?.manifestSha256)failed('Worker controls changed while validating recording start.');
    const source={individualId:state.individualId,dataset:state.dataset,graphSha256:state.graphSha256,graphManifestSha256:state.provenance.manifestSha256,sessionEpoch:state.sessionEpoch,model:state.model,checkpointId:state.checkpointId};
    const selection={mode:'explicit-ids',neuronIds:[...body.neuronIds],selectedCount:body.neuronIds.length,retainedNeuronCount:state.provenance.neuronCount};
    return store.start(source,selection);
   }finally{starting.delete(body.individualId);}
  });},
  capture(id){return boundary(async()=>{
   const session=get(id);if(session.status!=='recording')failed('Recording is no longer active.');if(pending.has(id))failed('A capture is already in progress.');
   const work=(async()=>{try{
    current(session.source);const sample=await connectomes.sample(session.source.individualId,scope(session));const state=current(session.source);
    if(sample.individualId!==session.source.individualId||sample.dataset!==session.source.dataset||sample.graphSha256!==session.source.graphSha256
     ||sample.sessionEpoch!==session.source.sessionEpoch||sample.modelId!==session.source.model.id||sample.provenance?.manifestSha256!==session.source.graphManifestSha256
     ||state.commandSequence!==sample.commandSequence)failed('Source changed during capture; no observation was appended.');
    const record={wallTimeMs:Date.now(),tick:sample.tick,simTimeMs:sample.simTimeMs,commandSequence:sample.commandSequence,status:sample.status,checkpointId:state.checkpointId,
     timeWindow:sample.timeWindow,samples:sample.samples};
    validateSampleRecord({...record,schemaVersion:1,sequence:session.nextSequence,eventId:`${id}:${session.nextSequence}`},{...session,nextSequence:session.nextSequence+1});
    return await store.append(id,record);
   }catch(e){try{store.partial(id,'Capture failed or source changed; observation was dropped',true);}catch{failure='Could not persist dropped-capture status';}throw e;}})();
   pending.set(id,work);try{return await work;}finally{pending.delete(id);}
  });},
  async stop(id){get(id);await pending.get(id)?.catch(()=>{});return store.stop(id);},
  async delete(id){get(id);await pending.get(id)?.catch(()=>{});store.delete(id);return{deleted:true};},
  read:id=>required().read(id),replay:id=>required().replay(id),
  async close(){await Promise.allSettled([...pending.values()]);for(const s of store?.list()??[])if(s.status==='recording')store.partial(s.id,'Service stopped; manual capture was not resumed');store?.close();},
 };
}
