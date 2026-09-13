import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { once } from 'node:events';
import { createServer } from './index.js';import { createConnectomeSession } from './connectome-worker.js';import { createSparseLif } from './sparse-lif.js';
import { openConnectomeStore } from './connectome-store.js';import { createConnectomeRecordingStore } from './connectome-recording-store.js';import { createCapacityPolicy } from './population-capacity.js';
const dataset='banc:v888',graph={ids:[`${dataset}/9007199254740993`],offsets:new Uint32Array([0,0]),targets:new Uint32Array(),contacts:new Uint32Array(),signs:new Int8Array([1])};
async function setup(t,{gate=null}={}){
 const dir=mkdtempSync(join(tmpdir(),'recording-http-')),descriptor={directory:'/trusted',graphSha256:createSparseLif(graph,{dataset}).graphSha256,manifestSha256:'a'.repeat(64),neuronCount:1,edgeCount:0};
 const catalog=openConnectomeStore(join(dir,'catalog'),{profiles:{[dataset]:descriptor}}),identity=catalog.create(dataset),recordings=createConnectomeRecordingStore({directory:join(dir,'recordings')});let session,opens=0,exit;
 const server=createServer({autoTick:false,connectomeCatalog:catalog,connectomeRecordings:recordings,capacity:createCapacityPolicy(),resourceUsage:()=>({aggregateMemoryBytes:0,availableMemoryBytes:1e10}),
  connectomeProfiles:{[dataset]:{descriptor,measurement:{available:true,backend:'connectome',dataset,incrementalMemoryBytes:100,includesCheckpointSerialization:true}}},
  connectomeBackend:async(_dir,options)=>{opens++;exit=options.onExit;session=createConnectomeSession({...options,graph,provenance:{manifestSha256:descriptor.manifestSha256,neuronCount:1,edgeCount:0}});let epoch=session.snapshot().sessionEpoch;
   return{ready:session.snapshot(),close:async()=>{},...Object.fromEntries(['snapshot','start','pause','advance','checkpoint','prepareRestore','commitRestore','sample'].map(action=>[action,async value=>{
    if(action==='sample'&&gate?.enabled){gate.entered();await gate.promise;}const result=session.dispatch({action,value,sessionEpoch:epoch});if(result?.sessionEpoch)epoch=result.sessionEpoch;return result;}]))};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{gate?.release();server.close();await once(server,'close');await new Promise(r=>setTimeout(r,10));rmSync(dir,{recursive:true,force:true});});
 const get=async path=>(await fetch(base+path)).json(),post=async(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const state=()=>get(`/api/connectomes/${identity.individualId}`);
 const command=async(action,steps=null,checkpointId=null)=>{const s=await state();return post(`/api/connectomes/${identity.individualId}/commands`,{protocolVersion:1,individualId:s.individualId,sessionEpoch:s.sessionEpoch,commandSequence:s.commandSequence,action,steps,checkpointId});};
 const source=async()=>{const s=await state();return{protocolVersion:1,individualId:s.individualId,dataset,graphSha256:s.graphSha256,sessionEpoch:s.sessionEpoch,neuronIds:graph.ids};};
 return{get,post,state,command,source,opens:()=>opens,exit:()=>exit()};
}
test('manual capture validates IDs without append, records exact source and replays without changing clocks',async t=>{
 const f=await setup(t);assert.equal((await f.post('/api/connectome-recordings',await f.source())).status,409);assert.equal(f.opens(),0);
 await f.command('load');const before=await f.state(),body=await f.source();
 assert.equal((await f.post('/api/connectome-recordings',{...body,neuronIds:[`${dataset}/999`]})).status,409);assert.equal((await f.get('/api/connectome-recordings')).sessions.length,0);
 assert.equal((await f.post('/api/connectome-recordings',body,{Origin:'https://foreign.test'})).status,403);
 const started=await f.post('/api/connectome-recordings',body);assert.equal(started.status,200);const recording=await started.json(),path=`/api/connectome-recordings/${recording.id}`;
 assert.equal(recording.nextSequence,0);assert.deepEqual(await f.state(),before);
 assert.equal((await f.post(path+'/capture',{})).status,200);assert.deepEqual(await f.state(),before);
 const readonly=await f.post(`/api/connectomes/${body.individualId}/samples`,body);assert.equal(readonly.status,200);assert.equal((await f.get(path)).records.length,1,'ordinary sample endpoint never appends');
 await f.post(path+'/stop',{});const replay=await f.get(path+'/replay');assert.equal(replay.complete,true);assert.equal(replay.canResume,false);assert.equal(replay.records[0].samples[0].neuronId,graph.ids[0]);
 assert.equal(replay.session.selection.selectedCount,1);assert.deepEqual(await f.state(),before);assert(!JSON.stringify(replay).includes('ratesHz'));assert(!JSON.stringify(replay).includes('worldTime'));
});
test('rest keeps manual capture available, restore and spontaneous exit end the original source',async t=>{
 const f=await setup(t);await f.command('load');const a=await(await f.post('/api/connectome-recordings',await f.source())).json(),path=`/api/connectome-recordings/${a.id}`;
 await f.command('rest');assert.equal((await f.post(path+'/capture',{})).status,200);assert.equal((await f.get(path)).records[0].status,'resting');
 await f.command('save');const saved=(await f.state()).checkpointId;await f.command('restore',null,saved);
 assert.equal((await f.get(path)).session.status,'partial');assert.equal((await f.post(path+'/capture',{})).status,409);
 const b=await(await f.post('/api/connectome-recordings',await f.source())).json();f.exit();assert.equal((await f.get(`/api/connectome-recordings/${b.id}`)).session.status,'partial');
});
test('capture concurrent with restore cannot append the new epoch and concurrent capture is refused',async t=>{
 let release,entered;const gate={enabled:false,promise:new Promise(r=>{release=r;}),release:()=>release(),entered:()=>entered()};const f=await setup(t,{gate});await f.command('load');await f.command('save');const saved=(await f.state()).checkpointId;
 const a=await(await f.post('/api/connectome-recordings',await f.source())).json(),path=`/api/connectome-recordings/${a.id}`;gate.enabled=true;const waiting=new Promise(r=>{entered=r;});
 const capture=f.post(path+'/capture',{});await waiting;assert.equal((await f.post(path+'/capture',{})).status,409);const restore=f.command('restore',null,saved);release();await capture;await restore;
 const value=await f.get(path);assert.equal(value.session.status,'partial');assert.equal(value.session.source.sessionEpoch,a.source.sessionEpoch);assert(value.records.length<=1);assert.equal((await f.state()).neural.tick,0);
});
