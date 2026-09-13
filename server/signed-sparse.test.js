import {readFileSync} from 'node:fs';import test from 'node:test';import assert from 'node:assert/strict';import {performance} from 'node:perf_hooks';import {createSignedSparse} from './signed-sparse.js';
const began=performance.now();let cases=0;
const graph={ids:['tiny:a','tiny:b','tiny:c','tiny:d','tiny:e'],edges:[[0,1,2],[0,2,8],[1,2,4],[2,2,3],[3,2,5]],signs:[-1,1,-1,0,1],mapping:[{node:0,pixels:[0]}],outputs:[1,2]};
const frame=v=>Array(512).fill(v),near=(a,b)=>assert.ok(Math.abs(a-b)<=1e-12,`${a} != ${b}`);
function make(g=graph){assert.ok(++cases<=16);assert.ok(performance.now()-began<5000);return createSignedSparse(g);}
function step(k,pixels){let s=k.snapshot();if(!s.remaining)k.acceptFrame(s.frameId+1,pixels);const out=k.step();assert.ok(performance.now()-began<5000);return out;}
test('independent target-row dense oracle preserves direction, unknown denominator and simultaneous delay',()=>{
 const k=make();assert.deepEqual(k.operator().denominator,[1,2,20,1,1]);k.start();let expected=Array(5).fill(0),adapt=0;
 const matrix=[[0,0,0,0,0],[-1,0,0,0,0],[-.4,.2,-.15,0,0],[0,0,0,0,0],[0,0,0,0,0]];
 for(let t=0;t<40;t++){expected=matrix.map((row,j)=>.875*expected[j]+.125*Math.tanh(.75*row.reduce((a,w,i)=>a+w*expected[i],0)+(j===0?-.25*(.5-adapt):0)));adapt=.9375*adapt+.0625*.5;const s=step(k,frame(.75));s.x.forEach((v,i)=>near(v,expected[i]));if(t===0){assert.equal(s.x[1],0);assert.ok(s.x[0]<0);}if(t===1)assert.ok(s.x[1]>0);assert.equal(s.x[4],0);}
});
test('gray quiet, fixed-operator odd symmetry and constant-image contraction bound',()=>{
 const quiet=make(),on=make(),off=make();for(const k of[quiet,on,off])k.start();let previous=1;
 for(let t=0;t<120;t++){const a=step(on,frame(.75)),b=step(off,frame(.25));assert.ok(step(quiet,frame(.5)).x.every(v=>v===0));a.x.forEach((v,i)=>near(v,-b.x[i]));near(a.z,-b.z);const norm=Math.max(...a.x.map(Math.abs),2*Math.abs(a.b[0]-.5));assert.ok(norm<=previous*63/64+1e-12);previous=norm;}
});
test('mid-frame checkpoint continuation is exact; invalid restore/frame rejects atomically; lifetime budget survives restore',()=>{
 const k=make();k.start();for(let i=0;i<224;i++)step(k,frame(.75));const saved=k.checkpoint();assert.equal(saved.remaining,16);for(let i=0;i<32;i++)step(k,frame(.75));const result=k.checkpoint();k.restore(saved);assert.equal(k.snapshot().running,false);assert.throws(()=>k.step());k.start();for(let i=0;i<32;i++)step(k,frame(.75));assert.deepEqual(k.checkpoint(),result);assert.equal(k.snapshot().actualUpdates,288);assert.equal(k.snapshot().running,false);assert.equal(k.snapshot().yawProxy,0);assert.throws(()=>k.start());assert.throws(()=>k.step());
 for(const patch of[{x:[NaN,...saved.x.slice(1)]},{operatorHash:'wrong'},{remaining:21},{schema:'sparse-lif'},{frame:frame(1)}]){const before=k.snapshot();assert.throws(()=>k.restore({...saved,...patch}));assert.deepEqual(k.snapshot(),before);}
 const before=k.snapshot();assert.throws(()=>k.acceptFrame(999,frame(1)));assert.deepEqual(k.snapshot(),before);
});
test('coarse BANC half projection cannot distinguish the two reserved within-half bars',()=>{
 const g={...graph,mapping:[{node:0,pixels:Array.from({length:256},(_,i)=>Math.floor(i/16)*32+i%16)}]};const a=make(g),b=make(g);a.start();b.start();const bar=start=>frame(.5).map((v,i)=>i%32>=start&&i%32<start+4?.625:v);
 for(let i=0;i<20;i++)assert.deepEqual(step(a,bar(8)).x,step(b,bar(12)).x);
});
test('unsafe graphs reject before state exists and caller mutation cannot alter operator',()=>{
 for(const patch of[{ids:Array(17).fill('tiny:a')},{edges:[[0,1,Number.MAX_SAFE_INTEGER],[0,1,1]]},{mapping:[{node:0,pixels:[0,0]}]}])assert.throws(()=>createSignedSparse({...graph,...patch}));const original=structuredClone(graph),k=make(original);original.edges[0][2]=999;assert.equal(k.operator().graph.edges[0][2],2);
});

test('positive and mixed cycles obey one-step contraction from separated initial states',()=>{
 for(const signs of[[1,1],[-1,1]]){const g={ids:['tiny:a','tiny:b'],edges:[[0,1,1],[1,0,1]],signs,mapping:[],outputs:[0,1]},a=make(g),b=make(g);for(const[k,v]of[[a,.75],[b,-.75]]){k.acceptFrame(1,frame(.5));k.restore({...k.checkpoint(),x:[v,v]});k.start();}let previous=1.5;for(let i=0;i<40;i++){const x=step(a,frame(.5)).x,y=step(b,frame(.5)).x;const delta=Math.max(...x.map((v,j)=>Math.abs(v-y[j])));assert.ok(delta<=previous*31/32+1e-12);assert.ok(x.every(v=>Math.abs(v)<=1));previous=delta;}}
});
test('uniform target contact scaling preserves effective dynamics while one-edge perturbation changes it',()=>{
 const scaled=structuredClone(graph);for(const e of scaled.edges)if(e[1]===2)e[2]*=2;
 const changed=structuredClone(graph);changed.edges[1][2]*=2;
 const a=make(),b=make(scaled),c=make(changed);for(const k of[a,b,c])k.start();for(let t=0;t<3;t++){const x=step(a,frame(.75)).x,y=step(b,frame(.75)).x;step(c,frame(.75));x.forEach((v,i)=>near(v,y[i]));}assert.notEqual(a.snapshot().x[2],c.snapshot().x[2]);
});

test('future protocol remains disabled and includes restore work in declared accounting',()=>{const p=JSON.parse(readFileSync(new URL('../research/signed-sparse-future-protocol.json',import.meta.url)));assert.equal(p.executionAllowed,false);assert.equal(p.maxActualUpdates,p.profiles.length*p.cases.length*p.actualUpdatesPerCase);assert.equal(p.actualUpdatesPerCase,256+p.continuationTicks);assert.equal(p.retries,0);assert.equal(p.gainAdaptation,false);});

test('dense inputs, failure pause and restored terminal clock preserve neural state',()=>{
 const k=make();k.start();for(let t=0;t<20;t++)step(k,frame(.75));const cp=k.checkpoint();assert.notEqual(k.snapshot().yawProxy,0);assert.throws(()=>k.step());assert.deepEqual(k.checkpoint(),cp);assert.equal(k.snapshot().yawProxy,0);
 k.start();assert.throws(()=>k.acceptFrame(2,new Array(512)));assert.deepEqual(k.checkpoint(),cp);assert.equal(k.snapshot().running,false);
 for(const key of['x','b']){const bad={...cp,[key]:new Array(cp[key].length)};assert.throws(()=>k.restore(bad));assert.deepEqual(k.checkpoint(),cp);}
 for(const patch of[{signs:new Array(5)},{outputs:new Array(2)},{edges:[new Array(3)]},{mapping:[{node:0,pixels:new Array(1)}]},{ids:new Array(5)}])assert.throws(()=>createSignedSparse({...graph,...patch}));
 k.restore({...cp,tick:288,remaining:12,acceptedFrames:15,frameId:15});const terminal=k.checkpoint();assert.throws(()=>k.start());assert.throws(()=>k.step());assert.deepEqual(k.checkpoint(),terminal);k.restore(terminal);assert.deepEqual(k.checkpoint(),terminal);
});
