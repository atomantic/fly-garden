import test from 'node:test';import assert from 'node:assert/strict';
import { ATLAS_ACTIVITY_MODES,MAX_ATLAS_ACTIVITY_CELLS,atlasActivityScope,overlayForScope,atlasActivitySelection,
 liveAtlasActivity,replayAtlasActivity,staleAtlasActivity,drawableAtlasActivity,atlasActivityByIndex,atlasActivityCellText,atlasActivityMode } from '../client/src/atlas-activity.js';
import { MAX_NEURON_SAMPLE } from './sparse-lif.js';

const DATASET='male-cns:v1.0',MANIFEST='a'.repeat(64),GRAPH='b'.repeat(64);
const id=n=>`${DATASET}/${n}`;
// Six retained cells: four positioned across two display groups, two without a valid position.
const nodes=[1,2,3,4,5,6].map(n=>[id(n),String(n),'','','','soma']);
const valid=Uint8Array.from([1,1,1,1,0,0]),groups=Uint8Array.from([0,0,2,2,0,2]);
const data={nodes,valid,groups};
const scope=atlasActivityScope({profile:'male-cns-v1',dataset:DATASET,graphManifestSha256:MANIFEST});
const entry=(n,firing=0)=>({neuronId:id(n),potential:-0.25,firing,refractoryStepsRemaining:0});
const sampleFor=neuronIds=>({individualId:'ind',dataset:DATASET,graphSha256:GRAPH,sessionEpoch:'epoch',modelId:'m',
 commandSequence:2,status:'paused',tick:5,simTimeMs:5,timeWindow:{kind:'instantaneous',startTick:5,endTick:5,startSimTimeMs:5,endSimTimeMs:5},
 samples:neuronIds.map((value,at)=>entry(value.slice(DATASET.length+1),at===0?1:0))});
const session={id:'rec',status:'complete',droppedSamples:0,nextSequence:1,
 source:{dataset:DATASET,individualId:'past',sessionEpoch:'old',graphSha256:GRAPH,graphManifestSha256:MANIFEST,model:{id:'m',dtMs:1}},
 selection:{mode:'explicit-ids',neuronIds:[id(1),id(3)],selectedCount:2,retainedNeuronCount:6}};
const replay={session,complete:true,gaps:[],records:[{tick:7,sequence:0,simTimeMs:7,wallTimeMs:1000,
 timeWindow:{kind:'instantaneous',startTick:7,endTick:7,startSimTimeMs:7,endSimTimeMs:7},samples:[entry(1,1),entry(3)]}]};

test('the atlas overlay cap never exceeds what the kernel will actually sample',()=>{
 assert.equal(MAX_ATLAS_ACTIVITY_CELLS,MAX_NEURON_SAMPLE);
});

test('sampling covers exactly the drawn cells, strides deterministically and always includes the selection',()=>{
 const all=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null});
 assert.deepEqual(all.indices,[0,1,2,3]);assert.deepEqual(all.neuronIds,[id(1),id(2),id(3),id(4)]);
 assert.equal(all.drawnCells,4);assert.equal(all.requestedCells,4);assert.equal(all.stride,1);
 // Hidden groups and cells without a valid position are never sampled.
 assert.deepEqual(atlasActivitySelection({...data,visibleGroups:[2],selectedIndex:null}).indices,[2,3]);
 const strided=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null,max:2});
 assert.deepEqual(strided.indices,[0,2]);assert.equal(strided.stride,2);assert.equal(strided.drawnCells,4);
 // A fractional step fills the whole budget rather than halving coverage just past the cap.
 const odd=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null,max:3});
 assert.equal(odd.requestedCells,3);assert.equal(new Set(odd.indices).size,3);
 assert.deepEqual([...odd.indices].sort((a,b)=>a-b),odd.indices);
 // A drawn selection displaces the last strided pick rather than growing past the cap.
 const selected=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:3,max:2});
 assert.deepEqual(selected.indices,[0,3]);assert.equal(selected.requestedCells,2);
 // A hidden or unpositioned selection is not smuggled into the request.
 assert.deepEqual(atlasActivitySelection({...data,visibleGroups:[0],selectedIndex:4,max:2}).indices,[0,1]);
 assert.throws(()=>atlasActivitySelection({...data,visibleGroups:[],selectedIndex:null}),/nothing to sample/);
 assert.throws(()=>atlasActivitySelection({...data,visibleGroups:[0],max:MAX_ATLAS_ACTIVITY_CELLS+1}));
});

test('a live overlay carries worker provenance and separate counts, and refuses a mismatched reply',()=>{
 const selection=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null});
 const overlay=liveAtlasActivity({scope,sample:sampleFor(selection.neuronIds),selection,valid});
 assert.equal(overlay.mode,'live');assert.equal(overlay.tick,5);
 assert.deepEqual(overlay.counts,{sampled:4,matched:4,unmatched:0,positioned:4,firing:1});
 assert.equal(overlay.source.kind,'worker');assert.equal(overlay.source.sessionEpoch,'epoch');
 assert.equal(overlay.source.drawnCells,4);assert.equal(overlay.source.stride,1);
 assert.throws(()=>liveAtlasActivity({scope:null,sample:sampleFor(selection.neuronIds),selection,valid}));
 for(const sample of [{...sampleFor(selection.neuronIds),samples:[entry(1)]},
  {...sampleFor(selection.neuronIds),samples:[entry(1),entry(2),entry(3),entry(9)]},
  {...sampleFor(selection.neuronIds),samples:[entry(1),entry(2),entry(3),{...entry(4),potential:NaN}]},
  {...sampleFor(selection.neuronIds),samples:[entry(1),entry(2),entry(3),{...entry(4),firing:2}]}])
  assert.throws(()=>liveAtlasActivity({scope,sample,selection,valid}));
});

test('a replay overlay resolves recorded IDs against this atlas and refuses a foreign graph',()=>{
 const overlay=replayAtlasActivity({scope,replay,recordIndex:0,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST});
 assert.equal(overlay.mode,'replay');assert.equal(overlay.tick,7);
 assert.deepEqual(overlay.cells.map(cell=>cell.index),[0,2]);
 assert.deepEqual(overlay.counts,{sampled:2,matched:2,unmatched:0,positioned:2,firing:1});
 assert.equal(overlay.source.observation,1);assert.equal(overlay.source.observations,1);assert.equal(overlay.source.recordingId,'rec');
 for(const change of [{source:{...session.source,dataset:'banc:v888'}},{source:{...session.source,graphManifestSha256:'c'.repeat(64)}}])
  assert.throws(()=>replayAtlasActivity({scope,replay:{...replay,session:{...session,...change}},recordIndex:0,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST}),/different dataset|another/);
 assert.throws(()=>replayAtlasActivity({scope,replay,recordIndex:1,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST}),/missing or corrupt/);
 assert.throws(()=>replayAtlasActivity({scope:null,replay,recordIndex:0,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST}));
});

test('a recorded cell this atlas does not carry, or carries without a position, is reported and never marked',()=>{
 const foreign={...replay,session:{...session,selection:{...session.selection,neuronIds:[id(99),id(5)],selectedCount:2}},
  records:[{...replay.records[0],samples:[entry(99,1),entry(5,1)]}]};
 const overlay=replayAtlasActivity({scope,replay:foreign,recordIndex:0,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST});
 assert.deepEqual(overlay.cells.map(cell=>cell.index),[null,4]);
 assert.deepEqual(overlay.counts,{sampled:2,matched:1,unmatched:1,positioned:0,firing:2});
 assert.deepEqual(drawableAtlasActivity(overlay),[]);
 assert.deepEqual([...atlasActivityByIndex(overlay).keys()],[4]);
});

test('a superseded source withdraws every canvas mark and keeps its values only as labelled text',()=>{
 const selection=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null});
 const overlay=liveAtlasActivity({scope,sample:sampleFor(selection.neuronIds),selection,valid});
 assert.equal(drawableAtlasActivity(overlay).length,4);
 const stale=staleAtlasActivity(overlay,'The worker session changed while reading.');
 assert.equal(stale.mode,'stale');assert.equal(stale.supersededMode,'live');
 assert.deepEqual(stale.counts,overlay.counts);assert.equal(stale.cells.length,4);
 assert.equal(drawableAtlasActivity(stale),null);
 // The table keeps the values but labels them superseded rather than current.
 const cell=atlasActivityByIndex(stale).get(0);
 assert.equal(atlasActivityCellText(stale,cell),'Superseded: potential -0.25, firing flag 1');
 assert.equal(atlasActivityCellText(overlay,cell),'Sampled: potential -0.25, firing flag 1');
 assert.equal(atlasActivityCellText(overlay,undefined),'Not sampled');
 assert.equal(atlasActivityCellText(null,undefined),'Not sampled');
 assert.equal(atlasActivityMode(stale),ATLAS_ACTIVITY_MODES.stale);
 // A repeated staleness report keeps naming the original mode, not 'stale'.
 assert.equal(staleAtlasActivity(stale,'again').supersededMode,'live');
 assert.equal(staleAtlasActivity(null,'none'),null);
});

test('an overlay never survives a change of profile, dataset or graph manifest',()=>{
 const selection=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null});
 const overlay=liveAtlasActivity({scope,sample:sampleFor(selection.neuronIds),selection,valid});
 assert.equal(overlayForScope(overlay,scope,'ind'),overlay);
 for(const change of [{profile:'banc-v888'},{dataset:'banc:v888'},{graphManifestSha256:'c'.repeat(64)}]) {
  const other=atlasActivityScope({profile:'male-cns-v1',dataset:DATASET,graphManifestSha256:MANIFEST,...change});
  assert.notEqual(other,scope);
  assert.equal(overlayForScope(overlay,other,'ind'),null);
 }
 // Anatomy that has not been validated has no scope, so no overlay can be displayed against it.
 for(const change of [{graphManifestSha256:'not-a-hash'},{profile:''},{dataset:''}])
  assert.equal(atlasActivityScope({profile:'male-cns-v1',dataset:DATASET,graphManifestSha256:MANIFEST,...change}),null);
 assert.equal(overlayForScope(overlay,null,'ind'),null);
});

test('a worker overlay belongs to one individual, while a recording stays reachable with none',()=>{
 const selection=atlasActivitySelection({...data,visibleGroups:[0,2],selectedIndex:null});
 const overlay=liveAtlasActivity({scope,sample:sampleFor(selection.neuronIds),selection,valid});
 // Selecting another individual, or none, drops worker-sourced values outright.
 for(const other of ['other',null,undefined]) assert.equal(overlayForScope(overlay,scope,other),null);
 assert.equal(overlayForScope(staleAtlasActivity(overlay,'gone'),scope,'other'),null);
 // A recording names its own historical individual and is not tied to the current selection,
 // so replay stays usable while no neural backend is running at all.
 const recorded=replayAtlasActivity({scope,replay,recordIndex:0,nodes,valid,dataset:DATASET,graphManifestSha256:MANIFEST});
 assert.equal(recorded.source.individualId,'past');
 for(const other of ['ind','other',null]) assert.equal(overlayForScope(recorded,scope,other),recorded);
});

test('modes stay distinct and anatomy-only is the default claim',()=>{
 assert.equal(atlasActivityMode(null),ATLAS_ACTIVITY_MODES.anatomy);
 assert.equal(atlasActivityMode({mode:'unknown-mode'}),ATLAS_ACTIVITY_MODES.anatomy);
 const modes=Object.values(ATLAS_ACTIVITY_MODES);
 assert.equal(new Set(modes.map(mode=>mode.eyebrow)).size,modes.length);
 assert.equal(new Set(modes.map(mode=>mode.label)).size,modes.length);
 assert.equal(new Set(modes.map(mode=>mode.claim)).size,modes.length);
 // The synthetic fixture is a named refusal, never a drawable source.
 assert.equal(drawableAtlasActivity({mode:'fixture',scope,cells:[{index:0,firing:1,positioned:true}]},scope),null);
 assert.match(ATLAS_ACTIVITY_MODES.fixture.claim,/never/);
});
