import test from 'node:test';import assert from 'node:assert/strict';
import { readRecordedReplay,sameRecordingRequest } from '../client/src/connectome-recording-state.js';
const source={individualId:'a',dataset:'banc:v888',sessionEpoch:'old',graphSha256:'a'.repeat(64),graphManifestSha256:'b'.repeat(64),model:{id:'test',dtMs:1}},selection={mode:'explicit-ids',neuronIds:['banc:v888/9007199254740993'],selectedCount:1,retainedNeuronCount:10};
const replay={schemaVersion:1,kind:'connectome-sample-recording-export',mode:'read-only',canResume:false,session:{schemaVersion:1,kind:'connectome-sample-recording',id:'saved',status:'complete',startedAtMs:1,source,selection,nextSequence:1,droppedSamples:0},records:[{sequence:0,tick:1,simTimeMs:1,wallTimeMs:1,timeWindow:{kind:'instantaneous',startTick:1,endTick:1,startSimTimeMs:1,endSimTimeMs:1},samples:[{neuronId:selection.neuronIds[0],potential:-0.5,firing:0,refractoryStepsRemaining:0}]}],gaps:[],complete:true};
test('inert UI replay preserves exact selection and refuses invented values, rates and completion',()=>{
 assert.equal(readRecordedReplay(replay),replay);
 for(const change of [v=>v.canResume=true,v=>v.records[0].samples[0].potential=NaN,v=>v.records[0].samples[0].neuronId='banc:v888/1',v=>v.gaps=[{sequence:0,reason:'Missing or corrupt chunk'}],v=>v.session.droppedSamples=1,v=>v.records[0].timeWindow.endTick=2]){const value=structuredClone(replay);change(value);assert.throws(()=>readRecordedReplay(value));}
});
test('old recording effects cannot attach to a new source or later request',()=>{
 const request={key:'selected-source-a',generation:2};assert(sameRecordingRequest(request,request));assert(!sameRecordingRequest(request,{...request,generation:3}));assert(!sameRecordingRequest(request,{...request,key:'selected-source-b'}));
});
