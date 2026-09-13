import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { measureOperatingEnvelope } from './operating-envelope.js';
const entries=[{dataset:'male-cns:v1.0',directory:'/tiny/male'},{dataset:'banc:v888',directory:'/tiny/banc'}];
function factory({stall=null,wrongStep=false,events=[]}={}){
 let closed=0,opened=0;
 return{get closed(){return closed;},get opened(){return opened;},openBackend(_dir,{dataset,individualId,checkpoint}){
  opened++;let tick=checkpoint?.tick??0,status='paused';const epoch=`epoch-${opened}`;
  const snapshot=()=>({available:true,individualId,dataset,status,sessionEpoch:epoch,graphSha256:dataset,provenance:{dataset,neuronCount:2,edgeCount:1},model:{dtMs:1},neural:{tick,simTimeMs:tick,totalSpikes:0,traversedEdges:0}});
  const backend={ready:snapshot(),start:async()=>{status='running';return snapshot();},pause:async()=>{status='paused';return snapshot();},
    async advance(count){events.push(`${dataset}:begin:${tick}`);if(stall&&dataset==='banc:v888')await stall();tick+=count+(wrongStep?1:0);events.push(`${dataset}:end:${tick}`);return snapshot();},checkpoint:async()=>({tick}),close:async()=>{closed++;},probe:()=>{throw new Error('Probe must never be called');}};
  return Object.assign(Promise.resolve(backend),{terminate:backend.close});
 }};
}
test('pair barrier accounts exact steps, checkpoints each individual, restarts paused and never probes',async()=>{
 const events=[];let release;const gate=new Promise(r=>{release=r;});let held=true;
 const f=factory({events,stall:()=>held?gate:Promise.resolve()});
 const pending=measureOperatingEnvelope(entries,{steps:4,batchSteps:2},{...f,rss:()=>1000});
 while(!events.includes('banc:v888:begin:0'))await new Promise(r=>setImmediate(r));
 assert.equal(events.includes('male-cns:v1.0:begin:2'),false);held=false;release();const result=await pending;
 assert.equal(result.residentCount,2);assert.equal(result.probesApplied,0);assert.equal(result.batches.length,2);assert.equal(f.opened,4);assert.equal(f.closed,4);
 assert.notEqual(result.residents[0].individualId,result.residents[1].individualId);assert.ok(result.residents.every(r=>r.statusAfterRestart==='paused'&&r.neuralAfterRestart.tick===4));
});
test('a skipped or extra step rejects success and closes all residents',async()=>{
 const f=factory({wrongStep:true});await assert.rejects(measureOperatingEnvelope(entries,{steps:2,batchSteps:1},{...f,rss:()=>1000}),/clock/);assert.equal(f.closed,2);
});
test('memory refusal happens before opening and cannot silently raise the bound',async()=>{
 const f=factory();await assert.rejects(measureOperatingEnvelope(entries,{steps:2,batchSteps:1},{...f,rss:()=>3*1024**3}),/limit|deadline/);assert.equal(f.opened,0);
 await assert.rejects(measureOperatingEnvelope(entries,{maxMemoryMiB:2049},{...f}),/Bounds/);assert.equal(f.opened,0);
});
test('a worker stalled before readiness is terminated at the configured deadline',async()=>{
 let terminated=false;const opening=Object.assign(new Promise(()=>{}),{terminate:async()=>{terminated=true;}});
 await assert.rejects(measureOperatingEnvelope(entries.slice(0,1),{steps:1,batchSteps:1,timeoutSeconds:1},{openBackend:()=>opening,rss:()=>1000}),/deadline/);assert.equal(terminated,true);
});
test('CLI is default-off, caps run limits and refuses missing graph without fixture fallback',()=>{
 const script=new URL('../scripts/measure-operating-envelope.js',import.meta.url).pathname;
 const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000});
 for(const args of [[],['--measure','--dataset','male-cns:v1.0','--data','/missing','--max-memory-mib','2049'],['--measure','--dataset','male-cns:v1.0','--data','/missing']]){
  const result=run(args);assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/Explicit --measure|Bounds|unavailable/);
 }
});
