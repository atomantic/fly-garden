import test from 'node:test';import assert from 'node:assert/strict';
import { neuronSampleScope,matchingSampleResident,readNeuronSample,readNeuronSamples,confirmNeuronSample,currentNeuronSampleRequest } from '../client/src/connectome-sample-state.js';
const scope={individualId:'a',dataset:'banc:v888',neuronId:'banc:v888/9007199254740993',graphManifestSha256:'a'.repeat(64)};
const state={protocolVersion:1,source:'connectome',individualId:'a',dataset:scope.dataset,sessionEpoch:'epoch',commandSequence:2,resident:true,status:'paused',graphSha256:'b'.repeat(64),model:{id:'test',dtMs:1,refractorySteps:2},provenance:{manifestSha256:scope.graphManifestSha256},neural:{tick:5,simTimeMs:5,spikes:0,totalSpikes:0,traversedEdges:0,minimum:0,maximum:0}};
const sample={protocolVersion:1,kind:'connectome-neuron-sample',source:'connectome',individualId:'a',dataset:scope.dataset,sessionEpoch:'epoch',commandSequence:2,status:'paused',graphSha256:state.graphSha256,modelId:'test',provenance:state.provenance,tick:5,simTimeMs:5,timeWindow:{kind:'instantaneous',startTick:5,endTick:5,startSimTimeMs:5,endSimTimeMs:5},samples:[{neuronId:scope.neuronId,potential:-0.25,firing:0,refractoryStepsRemaining:0}]};
test('atlas inspector requires exact resident dataset and graph provenance and finite instantaneous values',()=>{
 assert.equal(matchingSampleResident(state,scope),state);assert.equal(readNeuronSample(sample,state,scope),sample);
 for(const change of [{resident:false},{source:'fixture'},{dataset:'male-cns:v1.0'},{provenance:{manifestSha256:'c'.repeat(64)}},{status:'unavailable'},{model:null}])assert.throws(()=>matchingSampleResident({...state,...change},scope));
 for(const change of [{individualId:'other'},{sessionEpoch:'restored'},{graphSha256:'c'.repeat(64)},{samples:[{...sample.samples[0],neuronId:'banc:v888/1'}]},{samples:[{...sample.samples[0],potential:NaN}]},{samples:[{...sample.samples[0],firing:2}]},{samples:[]},{timeWindow:{...sample.timeWindow,startTick:4}}])assert.throws(()=>readNeuronSample({...sample,...change},state,scope));
});
test('late replies after selection, individual, graph or session changes never attach to a new source',()=>{
 const request={key:neuronSampleScope(scope),generation:4};assert(currentNeuronSampleRequest(request,request));
 for(const change of [{individualId:'other'},{dataset:'male-cns:v1.0'},{neuronId:'banc:v888/1'},{graphManifestSha256:'c'.repeat(64)}])assert(!currentNeuronSampleRequest(request,{key:neuronSampleScope({...scope,...change}),generation:4}));
 assert(!currentNeuronSampleRequest(request,{...request,generation:5}));
 assert.equal(confirmNeuronSample(sample,state,scope),sample);
 for(const change of [{sessionEpoch:'restored'},{commandSequence:1},{neural:{...state.neural,tick:4}},{resident:false}])assert.throws(()=>confirmNeuronSample(sample,{...state,...change},scope));
});

test('a bounded multi-cell atlas sample requires the exact requested IDs in the requested order',()=>{
 const other='banc:v888/7',ids=[scope.neuronId,other];
 const many={...sample,samples:[sample.samples[0],{neuronId:other,potential:0.5,firing:1,refractoryStepsRemaining:1}]};
 assert.equal(readNeuronSamples(many,state,scope,ids),many);
 assert.throws(()=>readNeuronSamples(many,state,scope,[scope.neuronId]),/does not match this selection/);
 assert.throws(()=>readNeuronSamples(many,state,scope,[other,scope.neuronId]),/values are invalid/);
 assert.throws(()=>readNeuronSamples(sample,state,scope,ids),/does not match this selection/);
 assert.throws(()=>readNeuronSamples(many,state,scope,[]),/at least one exact ID/);
 assert.throws(()=>readNeuronSamples({...many,samples:[sample.samples[0],{neuronId:other,potential:0.5,firing:1,refractoryStepsRemaining:3}]},state,scope,ids),/values are invalid/);
 // The single-cell inspector remains exactly the one-ID case of the same validator.
 assert.equal(readNeuronSample(sample,state,scope),sample);
});
