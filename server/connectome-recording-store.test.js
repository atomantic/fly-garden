import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,existsSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { createSparseLif } from './sparse-lif.js';
import { createConnectomeRecordingStore } from './connectome-recording-store.js';
import { validateConnectomeRecording } from './connectome-recording-format.js';
import { readConnectomeRecordingBackups,restoreConnectomeRecordingBackups } from './connectome-recording-backup.js';
const dataset='male-cns:v1.0';
export function fixture(){
 const graph={ids:[`${dataset}/9007199254740993`,`${dataset}/2`],offsets:new Uint32Array([0,1,1]),targets:new Uint32Array([1]),contacts:new Uint32Array([250]),signs:new Int8Array([-1,1])};
 const kernel=createSparseLif(graph,{dataset,individualId:'recorded-fly'});kernel.seedProbe([0]);kernel.step();
 const sample=kernel.sample(graph.ids),source={individualId:kernel.individualId,dataset,graphSha256:kernel.graphSha256,graphManifestSha256:'a'.repeat(64),sessionEpoch:'epoch',model:kernel.model,checkpointId:null};
 const selection={mode:'explicit-ids',neuronIds:graph.ids,selectedCount:2,retainedNeuronCount:2};
 const record={wallTimeMs:1,tick:sample.tick,simTimeMs:sample.simTimeMs,commandSequence:0,status:'paused',checkpointId:null,timeWindow:sample.timeWindow,samples:sample.samples};return{source,selection,record};
}
function setup(t,options={}){const directory=mkdtempSync(join(tmpdir(),'connectome-recording-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return{directory,store:createConnectomeRecordingStore({directory,...options})};}
test('typed recordings preserve exact IDs, negative potential, instantaneous extent and inert replay',async t=>{
 const f=fixture(),{store,directory}=setup(t);writeFileSync(join(directory,'checkpoint.json'),'preserve');
 const s=store.start(f.source,f.selection);assert.equal(s.nextSequence,0);await store.append(s.id,f.record);await store.append(s.id,f.record);store.stop(s.id);
 const exported=validateConnectomeRecording(store.export(s.id));assert.equal(exported.complete,true);assert.equal(exported.records[0].samples[1].potential,-0.25);
 assert.equal(exported.records[1].tick,exported.records[0].tick);assert.equal(store.replay(s.id).canResume,false);
 assert.equal(exported.session.selection.neuronIds[0],`${dataset}/9007199254740993`);assert.equal(exported.records[0].timeWindow.startTick,exported.records[0].timeWindow.endTick);
 exported.records[0].samples[1].potential=5;assert.equal(store.read(s.id).records[0].samples[1].potential,-0.25);
 store.delete(s.id);assert(existsSync(join(directory,'checkpoint.json')));store.close();
});
test('strict recording schemas reject foreign IDs, unknown fields, invalid state and invalid completeness',async t=>{
 const f=fixture(),{store}=setup(t);assert.throws(()=>store.start({...f.source,credential:'secret'},f.selection));
 const s=store.start(f.source,f.selection);for(const record of [{...f.record,credential:'secret'},{...f.record,samples:[{...f.record.samples[0],neuronId:'banc:v888/1'},f.record.samples[1]]},{...f.record,samples:[f.record.samples[0],{...f.record.samples[1],potential:Infinity}]}])await assert.rejects(store.append(s.id,record));
 assert.equal(store.read(s.id).records.length,0);await store.append(s.id,f.record);store.stop(s.id);
 for(const mutate of [v=>v.session.source.model.threshold=2,v=>v.records[0].samples[0].firing=1,v=>v.session.droppedSamples=1,v=>v.complete=false,v=>v.session.selection.neuronIds[0]='banc:v888/1']){const v=store.export(s.id);mutate(v);assert.throws(()=>validateConnectomeRecording(v));}store.close();
});
test('restart marks interruption partial, owned orphan cleanup and corrupt chunks retain explicit gaps',async t=>{
 const f=fixture(),{store,directory}=setup(t);const s=store.start(f.source,f.selection);await store.append(s.id,f.record);await store.append(s.id,f.record);store.close();
 writeFileSync(join(directory,`${s.id}-99.json`),'orphan');writeFileSync(join(directory,'checkpoint.json'),'keep');writeFileSync(join(directory,`${s.id}-0.json`),'x'.repeat(70000));
 const reopened=createConnectomeRecordingStore({directory});assert.equal(reopened.read(s.id).session.status,'partial');assert.equal(reopened.read(s.id).gaps.length,1);assert.equal(reopened.read(s.id).records.length,1);assert(!existsSync(join(directory,`${s.id}-99.json`)));assert(existsSync(join(directory,'checkpoint.json')));reopened.close();
 assert.throws(()=>readConnectomeRecordingBackups(directory));
});
test('writer busy, disk failure, quota and zero-capture stop never claim complete',async t=>{
 const f=fixture();let release;const {store}=setup(t,{write:()=>new Promise((_,reject)=>{release=()=>reject(new Error('disk full'));})});const a=store.start(f.source,f.selection),b=store.start(f.source,f.selection);
 const pending=store.append(a.id,f.record);assert.equal((await store.append(b.id,f.record)).session.status,'partial');assert.throws(()=>store.stop(a.id),/progress/);release();await pending;assert.equal(store.read(a.id).gaps.length,1);assert.equal(store.read(a.id).complete,false);store.close();
 const quota=setup(t,{maxBytes:1}).store,s=quota.start(f.source,f.selection);assert.equal((await quota.append(s.id,f.record)).accepted,false);assert.equal(quota.read(s.id).session.status,'partial');quota.close();
 const empty=setup(t).store,e=empty.start(f.source,f.selection);assert.equal(empty.stop(e.id).status,'partial');empty.close();
});
test('separate typed offline backup preserves exact samples and refuses active writers',async t=>{
 const f=fixture(),{store,directory}=setup(t),s=store.start(f.source,f.selection);await store.append(s.id,f.record);assert.throws(()=>readConnectomeRecordingBackups(directory),/already open|lock/);store.close();
 const values=readConnectomeRecordingBackups(directory),target=join(directory,'restored');restoreConnectomeRecordingBackups(values,target);
 const restored=createConnectomeRecordingStore({directory:target});assert.equal(restored.replay(s.id).session.status,'partial');assert.deepEqual(restored.read(s.id).records,values[0].records);restored.close();
});

test('fixed-epoch exports reject regressing commands and contradictory same-tick samples before backup restore',async t=>{
 const f=fixture(),{store,directory}=setup(t),session=store.start(f.source,f.selection);
 await store.append(session.id,{...f.record,commandSequence:5});await store.append(session.id,{...f.record,commandSequence:6});store.stop(session.id);
 const valid=store.export(session.id);assert.doesNotThrow(()=>validateConnectomeRecording(valid));
 for(const change of [v=>v.records[1].commandSequence=4,v=>v.records[1].samples[1].potential=-0.5]){
  const value=structuredClone(valid);change(value);assert.throws(()=>validateConnectomeRecording(value));
  const target=join(directory,'invalid-restore');assert.throws(()=>restoreConnectomeRecordingBackups([value],target));assert.equal(existsSync(target),false);
 }store.close();
});
