import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createSharedHttp } from './shared-http.js';
import { SHARED_LIMITS, validSharedCount } from '../shared/population-limits.js';
import { createSharedCreativeSessions } from './shared-creative-session.js';

// HTTP contract doubles: no runtime, admission, neural advancement or renderer.
test('maximum population envelopes are bounded and reject 65 members before consuming counters', async () => {
 const members = Array.from({length:64},()=>({protocolVersion:1,individualId:randomUUID(),sessionId:randomUUID(),sequence:1}));
 const states = new Map(members.map(m=>[m.individualId,{...m,source:'fixture',persistence:{resident:true}}]));
 let consumed=0;
 const sharedId=randomUUID(),worldEpoch=randomUUID();
 const handler=createSharedHttp({identities:{sharedJoin:()=>({sharedId,worldEpoch,participants:members}),sharedSnapshot:()=>({sharedId,worldEpoch,participants:members}),sharedFrame:()=>({traces:[]})},snapshot:id=>states.get(id),consumeSequences:()=>consumed++});
 const request=async(path,body)=>{const bytes=Buffer.from(JSON.stringify(body)); const req=Readable.from([bytes]);req.method='POST';req.headers={'content-type':'application/json'};let status;await handler(req,{writeHead:s=>status=s,end:()=>{}},new URL(`http://localhost/api/shared/${path}`));return status;};
 assert.equal(await request('join',{protocolVersion:1,members}),200); assert.equal(consumed,1);
 assert.equal(await request('join',{protocolVersion:1,members:[...members,{...members[0],individualId:randomUUID()}]}),400); assert.equal(consumed,1);
 const frames=members.map(m=>({version:1,individualId:m.individualId,sessionId:m.sessionId,environmentEpoch:worldEpoch,frameId:Number.MAX_SAFE_INTEGER,simTimeMs:Number.MAX_SAFE_INTEGER,capturedAtMs:Number.MAX_SAFE_INTEGER,camera:'controller',width:8,height:4,rgb:Array(96).fill(255)}));
 const envelope={controllerToken:'f'.repeat(64),worldEpoch,worldTick:Number.MAX_SAFE_INTEGER,frames};
 assert.ok(Buffer.byteLength(JSON.stringify(envelope))<SHARED_LIMITS.requestBytes);
 assert.equal(await request(`${sharedId}/frames`,envelope),200);
 assert.equal(await request('join',{padding:'x'.repeat(SHARED_LIMITS.requestBytes)}),413);
 assert.equal(validSharedCount(65),false); assert.equal(validSharedCount(1),false);
});


test('render budget refuses incomplete population and preserves pair/order compatibility', async () => {
 const { readCompleteRetinalBatch } = await import('../client/src/shared-visual-world.js');
 assert.deepEqual(readCompleteRetinalBatch(3,i=>[i],()=>0),[[0],[1],[2]]);
 let time=0, count=0;
 assert.throws(()=>readCompleteRetinalBatch(64,i=>{count++;time+=100;return [i];},()=>time),/budget/);
 assert.equal(count,2);
 assert.throws(()=>readCompleteRetinalBatch(65,()=>[]),/count/);
});

test('64-recipient capture stops at last complete 1024-action prefix without dropping attribution', () => {
 const service=createSharedCreativeSessions();
 const participants=Array.from({length:64},(_,i)=>({individualId:`fly-${i}`,sessionId:`session-${i}`,simTimeMs:0,pose:{x:0,z:0,yaw:0}}));
 const shared={sharedId:'world',worldEpoch:'epoch',status:'running',tick:0,worldTimeMs:0,lastReceivedAtMs:1000,participants};
 const states=participants.map(p=>({...p,source:'fixture',dataset:{namespace:'fixture',release:'v1',modelId:'synthetic'},model:{id:'fixture-v1'},persistence:{checkpointId:null}}));
 service.command('world',{protocolVersion:1,sharedId:'world',worldEpoch:'epoch',captureSequence:0,action:'start'},shared,states);
 for(let tick=1;tick<=17;tick++) {
  shared.tick=tick;shared.worldTimeMs=tick*5;shared.lastReceivedAtMs++;
  for(const p of participants)p.simTimeMs=tick*5;
  service.capture(shared,participants.toReversed().map(p=>({...p,environmentEpoch:'epoch',frameId:tick-1,outputSimTimeMs:p.simTimeMs})));
 }
 const status=service.status('world');assert.equal(status.active,false);assert.equal(status.actionCount,1024);
 const source=JSON.parse(service.export('world','json').bytes).source;
 for(const p of participants)assert.equal(source.actions.filter(a=>a.individualId===p.individualId).length,16);
 assert.equal(source.capture.complete,false);
});

test('three procedural bodies retain indexed poses and reject incomplete pose updates atomically', async () => {
 const THREE=await import('three'),{createSharedVisualWorld}=await import('../client/src/shared-visual-world.js');
 const scene=new THREE.Scene(), visual=createSharedVisualWorld({},scene,3);
 try {
  const groups=scene.children.filter(o=>o.isGroup);assert.equal(groups.length,3);
  const state={participants:[0,1,2].map(x=>({pose:{x,z:0,yaw:0}}))};
  assert.equal(visual.applyPoses(state),true);assert.deepEqual(groups.map(g=>g.position.x),[0,1,2]);
  state.participants[0].pose.x=0.5;state.participants[2].pose.x=NaN;
  assert.equal(visual.applyPoses(state),false);assert.deepEqual(groups.map(g=>g.position.x),[0,1,2]);
 } finally {visual.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});}
});

test('joint restore requires the entire exact saved membership before counters or restore mutate', async () => {
 const ids=Array.from({length:4},()=>randomUUID()), checkpointId=randomUUID();
 const members=ids.map(individualId=>({protocolVersion:1,individualId,sessionId:randomUUID(),sequence:1}));
 const states=new Map(members.map(m=>[m.individualId,{...m,source:'fixture',persistence:{resident:true}}]));
 let consumed=0,restored=0;
 const handler=createSharedHttp({identities:{sharedCheckpoints:()=>[{jointCheckpointId:checkpointId,payload:{members:ids.slice(0,3).map(individualId=>({individualId}))}}],
 sharedRestore:()=>{restored++;return{sharedId:randomUUID(),participants:members.slice(0,3)};}},snapshot:id=>states.get(id),consumeSequences:()=>consumed++});
 const request=async supplied=>{const req=Readable.from([Buffer.from(JSON.stringify({protocolVersion:1,jointCheckpointId:checkpointId,members:supplied}))]);req.method='POST';req.headers={'content-type':'application/json'};let status;await handler(req,{writeHead:s=>status=s,end:()=>{}},new URL('http://localhost/api/shared/restore'));return status;};
 for(const supplied of [members.slice(0,2),members,[members[0],members[1],members[3]],[members[0],members[1],members[1]]]) {
  assert.notEqual(await request(supplied),200);assert.equal(consumed,0);assert.equal(restored,0);
 }
 assert.equal(await request(members.slice(0,3).toReversed()),200);assert.equal(consumed,1);assert.equal(restored,1);
});
