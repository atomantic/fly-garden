import test from 'node:test';import assert from 'node:assert/strict';
import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{once}from'node:events';
import{createServer}from'./index.js';import{openIdentityStore}from'./identity-store.js';import{openConnectomeStore}from'./connectome-store.js';
import{createConnectomeSession}from'./connectome-worker.js';import{createSparseLif}from'./sparse-lif.js';import{createCapacityPolicy}from'./population-capacity.js';
const datasets=['male-cns:v1.0','banc:v888'];
const graph=dataset=>({ids:[`${dataset}/1`],offsets:new Uint32Array([0,0]),targets:new Uint32Array(),contacts:new Uint32Array(),signs:new Int8Array([1])});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(t,{measurement=true,maxResidentFlies=3,openGate=null,closeGate=null,sampleGate=null}={}){
 const directory=mkdtempSync(join(tmpdir(),'research-http-')),identities=openIdentityStore(join(directory,'fixtures'));
 const descriptors=Object.fromEntries(datasets.map(dataset=>[dataset,{directory:join(directory,dataset),graphSha256:createSparseLif(graph(dataset),{dataset}).graphSha256,manifestSha256:'ab'.repeat(32),neuronCount:1,edgeCount:0}]));
 const catalog=openConnectomeStore(join(directory,'catalog'),{profiles:descriptors}),profiles=Object.fromEntries(datasets.map(dataset=>[dataset,{descriptor:descriptors[dataset],measurement:{available:measurement,backend:'connectome',dataset,includesCheckpointSerialization:true,incrementalMemoryBytes:measurement?1000:null,reason:measurement?null:'Evidence unavailable.'}}]));
 const capacity=createCapacityPolicy({settings:{maxResidentFlies,maxAggregateMemoryBytes:100000,minFreeMemoryBytes:100}});let opened=0,resource={aggregateMemoryBytes:100,availableMemoryBytes:100000};
 const backend=async(_directory,options)=>{opened++;if(openGate){openGate.entered.resolve();await openGate.promise;}
  const session=createConnectomeSession({...options,graph:graph(options.dataset),provenance:{manifestSha256:'ab'.repeat(32)}});let epoch=session.snapshot().sessionEpoch;
  return{ready:session.snapshot(),close:async()=>{if(closeGate){closeGate.entered.resolve();await closeGate.promise;}},...Object.fromEntries(['snapshot','start','pause','advance','checkpoint','prepareRestore','commitRestore','sample'].map(action=>[action,async value=>{if(action==='sample'&&sampleGate){sampleGate.entered.resolve();await sampleGate.promise;}const result=session.dispatch({action,value,sessionEpoch:epoch});if(result?.sessionEpoch)epoch=result.sessionEpoch;return result;}]))};};
 const server=createServer({identities,autoTick:false,capacity,incrementalMemoryBytes:100,resourceUsage:()=>resource,
  connectomeCatalog:catalog,connectomeProfiles:profiles,connectomeBackend:backend});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{openGate?.resolve();closeGate?.resolve();sampleGate?.resolve();server.close();await once(server,'close');await new Promise(r=>setImmediate(r));catalog.close();identities.close();rmSync(directory,{recursive:true,force:true});});
 const list=async()=> (await fetch(`${base}/api/connectomes`)).json(),state=async id=>(await fetch(`${base}/api/connectomes/${id}`)).json();
 const post=(path,body,headers={})=>fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const create=async dataset=>{const view=await list();const response=await post('/api/connectomes',{protocolVersion:1,catalogEpoch:view.catalogEpoch,commandSequence:view.commandSequence,dataset});assert.equal(response.status,200);return(await response.json()).state;};
 const command=async(id,action,steps=null,checkpointId=null,extra={})=>{const current=await state(id);return post(`/api/connectomes/${id}/commands`,{protocolVersion:1,individualId:id,sessionEpoch:current.sessionEpoch,commandSequence:current.commandSequence,action,steps,checkpointId,...extra});};
 return{directory,identities,catalog,capacity,base,post,list,state,create,command,opened:()=>opened,setResources:value=>{resource=value;}};
}
test('exact profiles create unloaded identities; explicit load/start/advance/save/restore preserve isolated paused state',async t=>{
 const s=await setup(t),view=await s.list();assert.equal(s.opened(),0);assert.equal(view.individuals.length,0);assert(!JSON.stringify(view).includes(s.directory));
 const a=await s.create(datasets[0]),b=await s.create(datasets[1]);assert.equal(a.status,'saved-unloaded');assert.equal(s.opened(),0);
 assert.equal((await s.command(a.individualId,'load')).status,200);assert.equal((await s.command(b.individualId,'load')).status,200);
 assert.equal((await s.state(a.individualId)).status,'paused');await s.command(a.individualId,'start');
 await new Promise(r=>setTimeout(r,20));assert.equal((await s.state(a.individualId)).neural.tick,0);
 await s.command(a.individualId,'advance',7);assert.equal((await s.state(a.individualId)).neural.tick,7);assert.equal((await s.state(b.individualId)).neural.tick,0);
 await s.command(a.individualId,'save');const first=(await s.state(a.individualId)).checkpointId;await s.command(a.individualId,'start');await s.command(a.individualId,'advance',3);
 const before=await s.state(a.individualId);await s.command(a.individualId,'restore',null,first);const restored=await s.state(a.individualId);
 assert.equal(restored.neural.tick,7);assert.equal(restored.status,'paused');assert.notEqual(restored.sessionEpoch,before.sessionEpoch);
 const history=await(await fetch(`${s.base}/api/connectomes/${a.individualId}/history`)).json();assert.equal(history.checkpoints.at(-1).restoredFrom,first);
 await s.command(a.individualId,'unload');assert.equal((await s.state(a.individualId)).resident,false);await s.command(a.individualId,'load');assert.equal((await s.state(a.individualId)).neural.tick,7);assert.equal((await s.state(a.individualId)).status,'paused');
});
test('same-origin exact envelopes reject paths, stale sessions, repeated creation and foreign checkpoints',async t=>{
 const s=await setup(t),initial=await s.list(),body={protocolVersion:1,catalogEpoch:initial.catalogEpoch,commandSequence:initial.commandSequence,dataset:datasets[0]};
 assert.equal((await s.post('/api/connectomes',body,{origin:'https://other.test'})).status,403);
 assert.equal((await s.post('/api/connectomes',{...body,directory:'/private/elsewhere'})).status,409);
 const accepted=await s.post('/api/connectomes',body);assert.equal(accepted.status,200);assert.equal((await s.post('/api/connectomes',body)).status,409);
 const a=(await accepted.json()).state,b=await s.create(datasets[1]);await s.command(a.individualId,'load');await s.command(b.individualId,'load');await s.command(b.individualId,'save');
 assert.equal((await s.command(a.individualId,'start',null,null,{sessionEpoch:'stale'})).status,409);
 assert.equal((await s.command(a.individualId,'advance',1001)).status,400);
 assert.equal((await s.command(a.individualId,'restore',null,(await s.state(b.individualId)).checkpointId)).status,409);
 assert.equal((await s.state(a.individualId)).neural.tick,0);assert.equal((await s.state(b.individualId)).status,'paused');
 assert.equal((await fetch(`${s.base}/api/connectomes/00000000-0000-4000-8000-000000000000`)).status,404);
});
test('unknown footprint refuses before worker construction and global pressure pauses explicit advance',async t=>{
 const unknown=await setup(t,{measurement:false}),a=await unknown.create(datasets[0]);assert.equal((await unknown.command(a.individualId,'load')).status,409);assert.equal(unknown.opened(),0);
 const s=await setup(t),b=await s.create(datasets[0]);await s.command(b.individualId,'load');await s.command(b.individualId,'start');
 s.setResources({aggregateMemoryBytes:200000,availableMemoryBytes:100000});assert.equal((await s.command(b.individualId,'advance',5)).status,409);
 assert.equal((await s.state(b.individualId)).status,'paused');assert.equal((await s.state(b.individualId)).neural.tick,0);assert.equal((await s.state(b.individualId)).resident,true);
});
test('loading and stopping research reservations share capacity with fixture admission without an await race',async t=>{
 const openGate={...deferred(),entered:deferred()},closeGate={...deferred(),entered:deferred()},s=await setup(t,{maxResidentFlies:2,openGate,closeGate});
 const a=await s.create(datasets[0]),loading=s.command(a.individualId,'load');await openGate.entered.promise;
 assert.equal((await s.list()).population.residentCount,2);assert.equal((await s.state(a.individualId)).status,'loading');
 const fixture=s.identities.create(),fixtureState=s.identities.snapshot(fixture.individualId);
 const fixtureLoad=s.post(`/api/individuals/${fixture.individualId}/load`,{protocolVersion:1,individualId:fixture.individualId,sessionId:fixtureState.sessionId,sequence:1});
 openGate.resolve();assert.equal((await loading).status,200);assert.equal((await fixtureLoad).status,409);assert.equal(s.identities.snapshot(fixture.individualId).persistence.resident,false);
 const unloading=s.command(a.individualId,'unload');await closeGate.entered.promise;assert.equal((await s.list()).population.residentCount,2);assert.equal((await s.state(a.individualId)).status,'stopping');
 const current=await(await fetch(`${s.base}/api/individuals/${fixture.individualId}`)).json();assert.equal((await s.post(`/api/individuals/${fixture.individualId}/load`,{protocolVersion:1,individualId:fixture.individualId,sessionId:current.sessionId,sequence:current.commandSequence+1})).status,409);
 closeGate.resolve();assert.equal((await unloading).status,200);assert.equal((await s.list()).population.residentCount,1);
});

test('queued old fixture load does not undo a newer unload',async t=>{
 const gate={...deferred(),entered:deferred()},s=await setup(t,{maxResidentFlies:3,openGate:gate});
 const a=await s.create(datasets[0]),loading=s.command(a.individualId,'load');await gate.entered.promise;
 const id=s.identities.primaryId;
 const current=async()=> (await fetch(`${s.base}/api/individuals/${id}`)).json();
 const body=st=>({protocolVersion:1,individualId:id,sessionId:st.sessionId,sequence:st.commandSequence+1});
 const oldLoad=s.post(`/api/individuals/${id}/load`,body(await current()));
 while((await current()).commandSequence===0)await new Promise(r=>setTimeout(r,5));
 const newerUnload=await s.post(`/api/individuals/${id}/unload`,body(await current()));
 assert.equal(newerUnload.status,200);
 gate.resolve();await loading;
 const response=await oldLoad;
 assert.equal(response.status,409,'queued old load should reject after newer accepted unload');
 assert.equal((await current()).persistence.resident,false);
});

test('health reports research availability separately from the fixture and distinguishes residency from execution',async t=>{
 const s=await setup(t),health=async()=>(await(await fetch(`${s.base}/api/health`)).json()).connectome;
 const initial=await health(); assert.equal(initial.available,true);assert.equal(initial.residentCount,0);assert.equal(initial.runningCount,0);assert.equal(initial.embodiment,false);
 assert.deepEqual(initial.profiles.map(p=>p.dataset),datasets);assert(initial.profiles.every(p=>p.measuredMemoryAvailable));
 const a=await s.create(datasets[0]);await s.command(a.individualId,'load');assert.equal((await health()).residentCount,1);assert.equal((await health()).runningCount,0);
 await s.command(a.individualId,'start');assert.equal((await health()).runningCount,1);assert.equal((await s.state(a.individualId)).neural.tick,0);
 const unknown=await setup(t,{measurement:false});assert((await(await fetch(`${unknown.base}/api/health`)).json()).connectome.profiles.every(p=>!p.measuredMemoryAvailable));
});

test('explicit neuron HTTP read is scoped, bounded and does not load or consume mutation sequence',async t=>{
 const s=await setup(t),a=await s.create(datasets[0]);
 const body=state=>({protocolVersion:1,individualId:state.individualId,dataset:state.dataset,sessionEpoch:state.sessionEpoch,graphSha256:state.graphSha256,neuronIds:[`${state.dataset}/1`]});
 const endpoint=`/api/connectomes/${a.individualId}/samples`;
 assert.equal((await s.post(endpoint,body(a))).status,409);assert.equal(s.opened(),0);
 await s.command(a.individualId,'load');const before=await s.state(a.individualId),request=body(before);
 assert.equal((await fetch(`${s.base}${endpoint}`)).status,405);
 assert.equal((await s.post(endpoint,request,{origin:'https://foreign.test'})).status,403);
 const response=await s.post(endpoint,request);assert.equal(response.status,200);const sampled=await response.json();
 assert.equal(sampled.tick,0);assert.equal(sampled.sessionEpoch,before.sessionEpoch);assert.equal(sampled.commandSequence,before.commandSequence);
 assert.deepEqual(sampled.samples,[{neuronId:`${datasets[0]}/1`,potential:0,firing:0,refractoryStepsRemaining:0}]);
 assert(!JSON.stringify(sampled).includes(s.directory));assert.deepEqual(await s.state(a.individualId),before);
 for(const change of [{dataset:datasets[1]},{sessionEpoch:'old'},{graphSha256:'00'.repeat(32)},{neuronIds:[`${datasets[0]}/999`]},{neuronIds:Array(257).fill(`${datasets[0]}/1`)},{neuronIds:[`${datasets[0]}/1`,`${datasets[0]}/1`]}])assert.equal((await s.post(endpoint,{...request,...change})).status,409);
 assert.equal((await s.post(endpoint,{...request,neuronIds:['a'.repeat(37*1024)]})).status,413);
 assert.deepEqual(await s.state(a.individualId),before);
 await s.command(a.individualId,'save');const saved=(await s.state(a.individualId)).checkpointId;
 await s.command(a.individualId,'restore',null,saved);assert.equal((await s.post(endpoint,request)).status,409);
});
test('HTTP allows only one outstanding sample per individual',async t=>{
 const sampleGate={...deferred(),entered:deferred()},s=await setup(t,{sampleGate}),a=await s.create(datasets[0]);await s.command(a.individualId,'load');
 const state=await s.state(a.individualId),body={protocolVersion:1,individualId:state.individualId,dataset:state.dataset,sessionEpoch:state.sessionEpoch,graphSha256:state.graphSha256,neuronIds:[`${state.dataset}/1`]};
 const path=`/api/connectomes/${a.individualId}/samples`,first=s.post(path,body);await sampleGate.entered.promise;
 assert.equal((await s.post(path,body)).status,409);sampleGate.resolve();assert.equal((await first).status,200);
 assert.equal((await s.state(a.individualId)).neural.tick,0);
});
