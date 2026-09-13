import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildVisualMapping,createVisualEncoder,createSteeringReadout,VISUAL_SOURCES,visualDigest} from './visual-mapping.js';
const load=name=>JSON.parse(readFileSync(new URL(`../connectome/visual-mappings/${name}.json`,import.meta.url)));
const source=dataset=>({dataset,annotationSha256:VISUAL_SOURCES[dataset].annotationSha256,rows:[...['left','right'].flatMap((side,i)=>['L1','L2'].map((type,j)=>({neuronId:`${dataset}/${10+i*2+j}`,side,type,hex:dataset.startsWith('male')?[1+i,1+j]:null}))),...Object.entries(VISUAL_SOURCES[dataset].motor).map(([side,neuronId])=>({neuronId,side,type:'DNa02',hex:null}))]});
const frame=(id,value=0)=>({frameId:id,width:32,height:16,pixels:Array(512).fill(value)});
test('mapping is source-order independent and excludes both ambiguous hex ports and missing metadata',()=>{
 const s=source('male-cns:v1.0'),sha=VISUAL_SOURCES['male-cns:v1.0'].graphManifestSha256;assert.deepEqual(buildVisualMapping(s,sha),buildVisualMapping({...s,rows:[...s.rows].reverse()},sha));
 s.rows.push({...s.rows[0],neuronId:'male-cns:v1.0/20'});s.rows.push({...s.rows[0],neuronId:'male-cns:v1.0/21',hex:[4,4]});s.rows.push({...s.rows[0],neuronId:'male-cns:v1.0/22',hex:null});s.rows.push({...s.rows[0],neuronId:'male-cns:v1.0/23',side:null});
 const m=buildVisualMapping(s,sha);assert.equal(m.excluded.filter(x=>x.reason==='duplicate-type-side-hex').length,2);assert(!m.inputs.some(x=>['male-cns:v1.0/10','male-cns:v1.0/20'].includes(x.neuronId)));assert.equal(m.excluded.length,4);
 assert.throws(()=>buildVisualMapping({...s,annotationSha256:'b'.repeat(64)},sha));assert.throws(()=>buildVisualMapping({...s,rows:[...s.rows,s.rows[0]]},sha));
});
test('generated manifests match pinned provenance, expected exclusions, and exact motor pairs',()=>{
 for(const [name,dataset,lockname] of [['male-cns-v1','male-cns:v1.0','graph'],['banc-v888','banc:v888','banc-v888.graph']]){
  const m=load(name),lock=JSON.parse(readFileSync(new URL(`../connectome/${lockname}.lock.json`,import.meta.url)));assert.equal(m.graphManifestSha256,lock.manifestSha256);assert.equal(m.annotationSha256,VISUAL_SOURCES[dataset].annotationSha256);assert.deepEqual(m.motor,VISUAL_SOURCES[dataset].motor);assert.equal(m.executionValidated,false);assert.doesNotThrow(()=>createVisualEncoder(m));
  const {mappingSha256,...value}=m;assert.equal(mappingSha256,visualDigest(value));
  assert.equal(m.inputs.length,dataset.startsWith('male')?3532:3217);
  if(dataset.startsWith('male'))assert.equal(m.excluded.filter(x=>x.reason==='duplicate-type-side-hex').length,2);
 }
});
test('black/left/right frames are bounded, static/first frames zero, and decay expires without an autonomous timer',()=>{
 for(const name of ['male-cns-v1','banc-v888']){
  const m=load(name),encoder=createVisualEncoder(m);encoder.accept(frame(0));assert(encoder.tick().every(x=>x.deltaV===0));
  const left=frame(1);left.pixels=left.pixels.map((_,i)=>i%32<16?1:0);encoder.accept(left);let values=encoder.tick();assert(values.some(x=>x.deltaV>0));
  const lookup=new Map(m.inputs.map(p=>[p.neuronId,p]));const total={};for(const p of values){const port=lookup.get(p.neuronId),key=`${port.side}:${port.type}`;total[key]=(total[key]??0)+p.deltaV;if(port.side==='right'||port.type==='L2')assert.equal(p.deltaV,0);}
  assert(Object.values(total).every(v=>v<=0.020000000001));const initial=values.reduce((n,p)=>n+p.deltaV,0);assert(encoder.tick().reduce((n,p)=>n+p.deltaV,0)<initial);
  for(let i=0;i<20;i++)values=encoder.tick();assert(values.every(p=>p.deltaV===0));
  encoder.accept({...left,frameId:2});assert(encoder.tick().every(p=>p.deltaV===0));
  encoder.reset();encoder.accept(frame(0));const right=frame(1);right.pixels=right.pixels.map((_,i)=>i%32>=16?1:0);encoder.accept(right);assert(encoder.tick().filter(p=>lookup.get(p.neuronId).side==='left').every(p=>p.deltaV===0));
 }
});
test('invalid frames and hidden metadata cannot mutate the accepted-frame clock or pixels',()=>{
 const e=createVisualEncoder(load('banc-v888'));e.accept(frame(0));
 for(const value of [{...frame(1),targetPosition:[1,2]}, {...frame(1),observerCamera:{}},{...frame(1),pixels:[NaN]}, {...frame(1),width:64},{...frame(1),pixels:Array(512).fill(1.1)}])assert.throws(()=>e.accept(value));
 assert.doesNotThrow(()=>e.accept(frame(1,1)));assert.throws(()=>e.accept(frame(1)));e.reset();assert.doesNotThrow(()=>e.accept(frame(0)));
});
test('readout has no forward drive, clips yaw, expires old spikes and resets quiet',()=>{
 const r=createSteeringReadout();assert.equal(r.tick({left:0,right:0}).yawRadiansPerSecond,0);
 let value;for(let i=0;i<100;i++)value=r.tick({left:0,right:1});assert.equal(value.yawRadiansPerSecond,0.5);assert.equal(value.forwardSpeed,0);
 for(let i=0;i<100;i++)value=r.tick({left:0,right:0});assert.equal(value.yawRadiansPerSecond,0);
 assert.throws(()=>r.tick({left:0,right:2}));assert.throws(()=>r.tick({left:0,right:0,targetAngle:1}));r.reset();assert.equal(r.tick({left:0,right:0}).observedTicks,1);
});
test('fixed aggregate example is analytically nonspiking from rest for both real manifests',()=>{
 for(const name of ['male-cns-v1','banc-v888']){
  const m=load(name),groups=new Map();for(const p of m.inputs){const key=`${p.side}:${p.type}`;groups.set(key,(groups.get(key)??0)+1);}
  for(const count of groups.values()){
   assert(0.21/count<1);
   assert((m.config.totalDeltaVPerChannelPerTick/count)/(1-Math.exp(-1/20))<1);
  }
 }
});

test('rehashed graph substitution and contradictory exclusion records are rejected',()=>{
 const original=load('banc-v888');
 const rehash=value=>{const {mappingSha256,...body}=value;return {...body,mappingSha256:visualDigest(body)};};
 const id='banc:v888/999';
 for(const change of [
  {graphManifestSha256:'a'.repeat(64)},
  {excluded:[{neuronId:original.inputs[0].neuronId,reason:'missing-or-ambiguous-side'}]},
  {excluded:[{neuronId:original.motor.left,reason:'missing-or-ambiguous-side'}]},
  {excluded:[{neuronId:id,reason:'duplicate-type-side-hex'}]},
  {excluded:[{neuronId:id,reason:'unknown'}]},
  {excluded:[{neuronId:id,reason:'missing-or-ambiguous-side',extra:true}]},
  {excluded:[{neuronId:'male-cns:v1.0/999',reason:'missing-or-ambiguous-side'}]},
  {excluded:[{neuronId:id,reason:'missing-or-ambiguous-side'},{neuronId:id,reason:'missing-or-ambiguous-side'}]},
 ])assert.throws(()=>createVisualEncoder(rehash({...original,...change})));
});
