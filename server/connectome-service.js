import { CapacityAdmissionError } from './population-capacity.js';
import { randomUUID } from 'node:crypto';
import { RuntimeError } from './runtime.js';
import { CONNECTOME_PROFILES } from './connectome-profiles.js';
import { openConnectomeBackend } from './connectome.js';
import { createConnectomeRegistry } from './connectome-registry.js';
import { createConnectomeSharedSession } from './connectome-shared-session.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=(message,status=409)=>{throw new RuntimeError(message,status);};
const plainState=state=>({...state,reason:state.reason?(state.recoveryRequired?'Storage durability is uncertain; recover the catalog before explicit paused reload.':'Research operation unavailable or paused; refresh state and verify local configuration.'):null});
/** Trusted application adapter. Browser callers can select IDs/profiles, never directories or neural payloads. */
export function createConnectomeService({store=null,profiles={},reason=null,capacity,getResources,openBackend,onLifecycle=()=>{}}={}) {
  const catalogEpoch=randomUUID();let catalogSequence=0,admissions=Promise.resolve(),pressureWork=null,storageFault=false;
  const pending=new Set(), pendingSamples=new Set();
  const registry=store?createConnectomeRegistry({identities:store.identities(),capacity,getResources:async({dataset})=>({...getResources(),measurement:profiles[dataset]?.measurement}),
    loadCheckpoint:({individualId,checkpointId})=>store.readCheckpoint(individualId,checkpointId),
    persistCheckpoint:request=>store.persistCheckpoint(request),
    persistJointCheckpoint:request=>store.persistJointCheckpoint(request),
    readJointCheckpoint:id=>store.readJointCheckpoint(id),
    prepareJointRestore:id=>store.prepareJointRestore(id),
    commitJointRestore:token=>store.commitJointRestore(token),
    openBackend:(directory,options)=>(openBackend??openConnectomeBackend)(directory,{...options,onExit:()=>{options.onExit();onLifecycle(options.individualId);}})}):null;
  const shared=createConnectomeSharedSession({available:()=>!!registry&&!storageFault,
    snapshot:id=>registry.snapshot(id),invalidate:ids=>registry.invalidateCommands(ids),
    control:async(id,action)=>{try{return await registry.sharedControl(id,action);}finally{onLifecycle(id);}},
    barrier:async(ids,steps,expected)=>{try{return await registry.barrier(ids,steps,expected);}finally{ids.forEach(id=>onLifecycle(id));}},
    checkpoint:request=>registry.sharedCheckpoint(request.ids,request),
    readJointCheckpoint:id=>store.readJointCheckpoint(id),listJoints:()=>store.jointCheckpoints(),
    prepareRestore:id=>registry.prepareSharedRestore(id),commitRestore:prepared=>registry.commitSharedRestore(prepared)});
  const required=()=>{if(!registry)fail(reason??'No verified local research catalog is available.');return registry;};
  function withAdmission(operation){const result=admissions.then(operation);admissions=result.catch(()=>{});return result;}
  const population=()=>capacity.snapshot(getResources());
  const list=()=>registry?registry.list().map(plainState):[];
  function profileViews(){return Object.entries(CONNECTOME_PROFILES).map(([dataset,config])=>{
    const profile=profiles[dataset],d=profile?.descriptor;
    return{dataset,available:!!d&&!!store&&!storageFault,reason:profile?.reason??(storageFault?'Catalog recovery required.':reason),
      neuronCount:d?.neuronCount??null,edgeCount:d?.edgeCount??null,graphSha256:d?.graphSha256??null,manifestSha256:d?.manifestSha256??null,modelId:config.modelId,
      measurement:profile?.measurement??{available:false,incrementalMemoryBytes:null,reason:'Local memory evidence unavailable.',disclosure:'No universal capacity estimate.'}};});}
  function view(){return{protocolVersion:1,catalogEpoch,commandSequence:catalogSequence,available:!!registry&&!storageFault,
    reason:storageFault?'Catalog recovery is required before new loads or mutations.':reason,profiles:profileViews(),individuals:list(),population:population()};}
  function record(id){const current=required();if(!current.list().some(value=>value.individualId===id))fail('Research individual not found.',404);return current.snapshot(id);}
  const snapshot=id=>plainState(record(id));
  function checkHealthy(){if(storageFault)fail('Catalog recovery is required before new loads or mutations.');}
  async function boundary(operation){try{return await operation();}catch(error){
    if(error.code==='CONNECTOME_DURABILITY_UNCERTAIN'||error.code==='CONNECTOME_STORE_RECOVERY_REQUIRED')storageFault=true;
    if(error instanceof RuntimeError || error instanceof CapacityAdmissionError)throw error;
    fail(storageFault?'Catalog selection durability is uncertain; recover storage before explicit paused reload.':'Research operation failed. Refresh current state before retrying.');
  }}
  async function create(body){
    required();checkHealthy();
    if(!exact(body,['protocolVersion','catalogEpoch','commandSequence','dataset'])||body.protocolVersion!==1||body.catalogEpoch!==catalogEpoch
      ||body.commandSequence!==catalogSequence||!Number.isSafeInteger(catalogSequence+1))fail('Invalid or stale catalog command.');
    if(!Object.hasOwn(CONNECTOME_PROFILES,body.dataset)||!profiles[body.dataset]?.descriptor)fail('Requested pinned profile is unavailable.',400);
    catalogSequence++;
    return boundary(async()=>{const identity=store.create(body.dataset),state=registry.register(identity);return{state:plainState(state),catalogEpoch,commandSequence:catalogSequence,population:population()};});
  }
  async function command(id,body){
    required();
    if(!exact(body,['protocolVersion','individualId','sessionEpoch','commandSequence','action','steps','checkpointId'])||body.protocolVersion!==1
      ||body.individualId!==id||!['load','start','advance','pause','rest','home','save','unload','restore'].includes(body.action)
      ||(body.action==='advance'?!Number.isInteger(body.steps)||body.steps<1||body.steps>1000:body.steps!==null)
      ||(body.action==='restore'?typeof body.checkpointId!=='string':body.checkpointId!==null))fail('Invalid research command envelope.',400);
    if(!['pause','rest','home'].includes(body.action))checkHealthy();
    const state=record(id);
    if(shared.owns(id))fail('Individual belongs to a shared research session; use the explicit shared controls.');
    if(body.sessionEpoch!==state.sessionEpoch||body.commandSequence!==state.commandSequence)fail('Stale research session or command sequence.');
    if(pending.has(id))fail('Research operation already in progress for this individual.');
    pending.add(id);
    try{return await boundary(async()=>{
      let result;
      if(body.action==='load'){
        if(state.resident)fail('Individual is already resident.');
        result=await withAdmission(()=>registry.load(id));
      }else{
        if(['start','advance'].includes(body.action)&&population().pressure!=='within-budget') {
          await registry.command(id,{protocolVersion:1,individualId:id,sessionEpoch:body.sessionEpoch,commandSequence:body.commandSequence,action:'pause',steps:null});
          fail('Resource pressure paused this individual and prevents advancement; unload explicitly if needed.');
        }
        const checkpoint=body.action==='restore'?store.readCheckpoint(id,body.checkpointId):undefined;
        const {checkpointId,...envelope}=body;
        result=await registry.command(id,envelope,checkpoint,body.action==='restore'?checkpointId:null);
      }
      return{state:plainState(result),population:population()};
    });}finally{pending.delete(id);onLifecycle(id);}
  }
  async function sample(id,body) {
    const current=required();record(id);
    if(pendingSamples.has(id))fail('A neuron sample is already in progress for this individual.');
    pendingSamples.add(id);
    try {return await boundary(()=>current.sample(id,body));}
    finally {pendingSamples.delete(id);}
  }
  function history(id){record(id);return{individualId:id,checkpoints:store.checkpoints(id)};}
  function enforcePressure(){
    if(!registry||population().pressure==='within-budget')return Promise.resolve();
    if(pressureWork)return pressureWork;
    const sharedWork=shared.pauseForPressure();
    const direct=registry.list().filter(state=>state.status==='running'&&!shared.owns(state.individualId)).map(state=>registry.command(state.individualId,{
      protocolVersion:1,individualId:state.individualId,sessionEpoch:state.sessionEpoch,commandSequence:state.commandSequence,action:'pause',steps:null,
    }));
    pressureWork=Promise.allSettled([sharedWork,...direct]).finally(()=>{pressureWork=null;});return pressureWork;
  }
  return{view,snapshot,create,command,sample,history,list,withAdmission,enforcePressure,shared,
    reservations:()=>registry?registry.list().filter(state=>state.resident).map(state=>({individualId:state.individualId,status:state.status})):[],
    close:async()=>{await shared.close();if(registry)await registry.close();store?.close();}};
}
