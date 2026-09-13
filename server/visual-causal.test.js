import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {createSparseLif} from './sparse-lif.js';import {buildVisualMapping,VISUAL_SOURCES} from './visual-mapping.js';import {createOnsetEpisode} from './visual-onset.js';import {runCausalTrial,CAUSAL_CONDITIONS} from './visual-causal-trial.js';import {runCausalCampaign} from './visual-causal-campaign.js';
function setup(){const dataset='male-cns:v1.0',source=VISUAL_SOURCES[dataset];const rows=['left','right'].flatMap((side,i)=>['L1','L2'].map((type,j)=>({neuronId:`${dataset}/${i*2+j+1}`,type,side,hex:[1,1]})));rows.push(...Object.entries(source.motor).map(([side,neuronId])=>({neuronId,type:'DNa02',side,hex:null})));const mapping=buildVisualMapping({dataset,annotationSha256:source.annotationSha256,rows},source.graphManifestSha256);const ids=rows.map(r=>r.neuronId),graph={ids,offsets:new Uint32Array([0,1,1,1,1,1,1]),targets:new Uint32Array([4]),contacts:new Uint32Array([1000]),signs:new Int8Array([1,1,1,1,1,1])},kernel=createSparseLif(graph,{dataset,individualId:'temporary-test'});kernel.inspectIds=ids;return{mapping,kernel,episode:createOnsetEpisode(mapping)};}
test('four fixed tiny-graph conditions establish trace and disconnection semantics within200 executed steps',async()=>{
 const results=[];for(const condition of CAUSAL_CONDITIONS)results.push(await runCausalTrial({...setup(),condition}));
 for(const r of results){assert.equal(r.executedSteps,200);assert.equal(r.finalClockTicks,180);assert.equal(r.restoredPaused,true);assert.equal(r.trace.length,200);assert(r.trace.every(t=>t.motor.forwardSpeed===0));}
 const[black,changed,encoderOff,motorOff]=results;assert.equal(black.downstreamResponseObserved,false);assert.equal(changed.downstreamResponseObserved,true);assert.equal(changed.yawObserved,true);assert.equal(encoderOff.downstreamResponseObserved,false);assert.equal(motorOff.downstreamResponseObserved,true);assert.equal(motorOff.yawObserved,false);
 assert.equal(changed.trace.filter(t=>t.deliveredPorts>0).length,1);assert.equal(changed.trace.find(t=>t.deliveredPorts>0).tick,21);assert.equal(encoderOff.trace.some(t=>t.deliveredPorts>0),false);assert(changed.trace.find(t=>t.tick===21).inputPorts.firing>0);
});
test('campaign owns one worker at a time, performs8runs and does not retry failure',async()=>{
 let active=0,maximum=0,opens=0,closes=0;const spawn=({dataset,condition})=>{opens++;active++;maximum=Math.max(maximum,active);return{promise:Promise.resolve({dataset,condition,executedSteps:200,finalClockTicks:180,restoredPaused:true}),terminate:async()=>{closes++;active--;}};};
 const dirs={'male-cns:v1.0':'/private/a','banc:v888':'/private/b'};const result=await runCausalCampaign(dirs,{spawn,rss:()=>100});assert.equal(result.runCount,8);assert.equal(result.executedSteps,1600);assert.equal(maximum,1);assert.equal(opens,closes);assert(!JSON.stringify(result).includes('/private'));
 let failures=0;const failed=await runCausalCampaign(dirs,{spawn:()=>{failures++;return{promise:Promise.reject(new Error('/private/failure')),terminate:async()=>{}};},rss:()=>100});assert.equal(failed.status,'incomplete');assert.equal(failures,1);assert(!JSON.stringify(failed).includes('/private'));
});
test('resource refusal is before worker creation and CLI requires explicit run without graph access',async()=>{
 let opened=false;const r=await runCausalCampaign({'male-cns:v1.0':'a','banc:v888':'b'},{spawn:()=>{opened=true;},rss:()=>3*1024**3});assert.equal(r.status,'incomplete');assert.equal(opened,false);
 const result=spawnSync(process.execPath,[new URL('../scripts/run-visual-causal-validation.js',import.meta.url).pathname],{encoding:'utf8',timeout:5000});assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.match(result.stderr,/Explicit --run/);
});
test('tiny numerical failure prevents trial success without continuing the clock',async()=>{
 const value=setup(),step=value.kernel.step;let calls=0;value.kernel.step=inputs=>{if(++calls===22)throw new Error('test numerical fault');step(inputs);};await assert.rejects(runCausalTrial({...value,condition:'changed-left-half-onset'}));assert.equal(calls,22);assert.equal(value.kernel.summary().tick,21);
});
test('stalled active worker is terminated at fixed campaign deadline',async()=>{
 let reads=0,terminated=false;
 const result=await runCausalCampaign({'male-cns:v1.0':'a','banc:v888':'b'},{spawn:()=>({promise:new Promise(()=>{}),terminate:async()=>{terminated=true;}}),rss:()=>100,now:()=>++reads<=2?0:120001});
 assert.equal(result.status,'incomplete');assert.equal(terminated,true);assert.equal(result.completedRuns,0);
});
test('cleanup crossing the deadline cannot produce completed campaign status',async()=>{
 let clock=0;
 const result=await runCausalCampaign({'male-cns:v1.0':'a','banc:v888':'b'},{now:()=>clock,rss:()=>100,spawn:({dataset,condition})=>({promise:Promise.resolve({dataset,condition,executedSteps:200,finalClockTicks:180,restoredPaused:true}),terminate:async()=>{clock=120001;}})});
 assert.equal(result.status,'incomplete');assert.equal(result.completedRuns,0);
});
test('published fixed-campaign evidence preserves exact accounting, controls and negative readout result',async()=>{
 const {readFileSync}=await import('node:fs');const {causalFrame,causalHash}=await import('./visual-causal-trial.js');
 const result=JSON.parse(readFileSync(new URL('../connectome/visual-causal-result.json',import.meta.url)));
 assert.equal(result.status,'completed-fixed-campaign');assert.equal(result.executedSteps,1600);assert.equal(result.results.length,8);assert.equal(result.retries,0);assert(result.sampledPeakRssBytes<=2*1024**3);assert(result.totalWallMs<120000);
 const pairs=new Set();for(const r of result.results){pairs.add(`${r.dataset}:${r.condition}`);assert.equal(r.trace.length,200);assert.equal(r.executedSteps,200);assert.equal(r.finalClockTicks,180);assert.equal(r.restoredPaused,true);assert.equal(r.downstreamResponseObserved,false);assert.equal(r.yawObserved,false);assert.equal(r.modelSha256,causalHash(r.model));
  for(const f of r.frames)assert.equal(f.sha256,causalHash(causalFrame(f.frameId,f.tick>=20&&r.condition!=='unchanged-black')));
  const native=r.trace.filter(t=>t.branch==='native-continuation'),restored=r.trace.filter(t=>t.branch==='restored-continuation'),normalize=rows=>rows.map(({branch,executedStep,...value})=>value);assert.deepEqual(normalize(native),normalize(restored));
  assert(r.trace.every(t=>t.motor.forwardSpeed===0&&t.motor.yawRadiansPerSecond===0));
  const driven=['changed-left-half-onset','motor-disconnected'].includes(r.condition),onset=r.trace.find(t=>t.tick===21);
  assert.equal(onset.inputPorts.firing,driven?(r.dataset==='male-cns:v1.0'?875:716):0);assert.equal(r.trace.at(-1).totalSpikes,onset.inputPorts.firing);
 }
 assert.equal(pairs.size,8);
});
