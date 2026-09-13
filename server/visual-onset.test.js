import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createOnsetEpisode} from './visual-onset.js';import {createSparseLif,LIF_MODEL} from './sparse-lif.js';
const mapping=JSON.parse(readFileSync(new URL('../connectome/visual-mappings/banc-v888.json',import.meta.url)));
const frame=(frameId,value)=>({frameId,width:32,height:16,pixels:Array(512).fill(value)});
const advance=(e,n)=>{let out=[];for(let i=0;i<n;i++)out.push(e.tick());return out;};
const graph=()=>({ids:['male-cns:v1.0/1','male-cns:v1.0/2'],offsets:new Uint32Array([0,1,1]),targets:new Uint32Array([1]),contacts:new Uint32Array([1000]),signs:new Int8Array([1,1])});
test('episode requires arm and provides only one threshold-referenced impulse per20ticks',()=>{
 const e=createOnsetEpisode(mapping);assert.throws(()=>e.accept(frame(0,0)));e.arm();e.accept(frame(0,0));assert.deepEqual(e.tick(),[]);assert.throws(()=>e.accept(frame(1,1)));advance(e,19);
 const receipt=e.accept(frame(1,1));assert.equal(receipt.nonzeroFrames,1);const ports=e.tick();assert(ports.length>0&&ports.length<=4000);assert(ports.every(p=>p.deltaV===1.25));assert.deepEqual(e.tick(),[]);advance(e,18);e.accept(frame(2,1));assert.deepEqual(e.tick(),[]);
});
test('reset, disarm and rearm never refund admitted input, clock or frame identity',()=>{
 const e=createOnsetEpisode(mapping);e.arm();e.accept(frame(0,0));advance(e,20);e.accept(frame(1,1));const reserved=e.snapshot();e.reset();assert.equal(e.snapshot().totalDeltaV,reserved.totalDeltaV);assert.equal(e.snapshot().nonzeroFrames,1);assert.deepEqual(e.tick(),[]);e.arm();assert.throws(()=>e.accept(frame(1,0)));assert.throws(()=>e.accept(frame(2,0)));advance(e,20);e.accept(frame(2,0));assert.deepEqual(e.tick(),[]);assert.equal(e.snapshot().nonzeroFrames,1);
});
test('eight onsets and200ticks cannot be extended or queued; invalid request leaves receipt unchanged',()=>{
 const e=createOnsetEpisode(mapping);e.arm();e.accept(frame(0,0));advance(e,20);
 for(let i=1;i<=8;i++){e.accept(frame(i,i%2));advance(e,20);}
 assert.equal(e.snapshot().nonzeroFrames,8);const before=e.snapshot();assert.throws(()=>e.accept(frame(9,1)));assert.deepEqual(e.snapshot(),before);e.reset();assert.throws(()=>e.arm());
 const quiet=createOnsetEpisode(mapping);quiet.arm();advance(quiet,200);assert.equal(quiet.snapshot().armed,false);quiet.reset();assert.throws(()=>quiet.arm());assert.equal(quiet.snapshot().ticks,200);
});
test('tiny kernel applies deltaV after leak/synapses before threshold, with delayed propagation and refractory suppression',()=>{
 const k=createSparseLif(graph());k.step([{index:0,deltaV:1.25}]);assert.deepEqual([...k.inspect().firing],[1,0]);assert.equal(k.summary().traversedEdges,0);
 k.step([{index:0,deltaV:1.25}]);assert.deepEqual([...k.inspect().firing],[0,1]);assert.equal(k.inspect().potential[0],0);k.step([{index:0,deltaV:1.25}]);assert.equal(k.inspect().firing[0],0);
 k.step([{index:0,deltaV:1}]);assert.equal(k.inspect().firing[0],1);
 const sub=createSparseLif(graph());sub.step([{index:0,deltaV:.5}]);sub.step([{index:0,deltaV:.5}]);assert.equal(sub.inspect().firing[0],0);assert.equal(sub.inspect().potential[0],.5*Math.exp(-1/LIF_MODEL.tauMs)+.5);
});
test('invalid sparse input is all-or-none and no-input behavior/checkpoint compatibility stays exact',()=>{
 const k=createSparseLif(graph()),original=k.checkpoint(),token=k.prepareRestore(original);
 for(const input of [[{index:0,deltaV:1},{index:1,deltaV:NaN}],[{index:0,deltaV:1},{index:0,deltaV:1}],[{index:2,deltaV:1}],[{index:0,deltaV:-1}],[{index:0,deltaV:1.26}],[{index:0,deltaV:1,hidden:true}],null]){assert.throws(()=>k.step(input));assert.deepEqual(k.checkpoint(),original);}
 assert.doesNotThrow(()=>k.commitRestore(token));const a=createSparseLif(graph(),{individualId:'same'}),b=createSparseLif(graph(),{individualId:'same'});for(let i=0;i<5;i++){a.step();b.step([]);}assert.deepEqual(a.checkpoint(),b.checkpoint());
 a.step([{index:0,deltaV:1.25}]);const saved=a.checkpoint(),c=createSparseLif(graph(),{individualId:'same',checkpoint:saved});a.step();c.step();assert.deepEqual(a.checkpoint(),c.checkpoint());
});
