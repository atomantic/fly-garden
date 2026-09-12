import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtlasConnectivity, loadAtlasConnectivity } from './atlas-connectivity.js';
const dataset='male-cns:v1.0',hash='a'.repeat(64);
function sample() {
  const graph={ids:[`${dataset}/1`,`${dataset}/2`,`${dataset}/3`,`${dataset}/4`],offsets:new Uint32Array([0,2,2,4,5]),targets:new Uint32Array([0,2,0,3,2]),contacts:new Uint32Array([1,3,5,7,11]),signs:new Int8Array([1,-1,0,-1])};
  const manifest={dataset,neuronCount:4,edgeCount:5,contactCount:27,sourceLockSha256:hash};
  const atlas={manifest:{dataset,graphManifestSha256:hash},manifestSha256:hash,nodes:graph.ids.map(id=>[id]),valid:new Uint8Array([1,1,1,0])};
  return {graph,manifest,manifestSha256:hash,atlas};
}
function create(s) {return createAtlasConnectivity(s,s.atlas);}
test('bounded deterministic sampling preserves contact/sign provenance and filters only drawing positions',()=>{
 const s=sample(),before=structuredClone(s),view=create(s),a=view.sample({density:1,maxEdges:5});
 assert.equal(a.retainedEdges,5);assert.equal(a.anatomicalContacts,27);assert.equal(a.sampling.displayedEdges,3);assert.equal(a.sampling.omittedMissingPositions,2);
 assert.deepEqual(a.edges.map(e=>e.edgeIndex),[0,1,2]);assert.equal(a.edges[2].engineeredSign,0);assert.equal(a.edges[2].anatomicalContacts,5);
 assert.deepEqual(view.sample({density:1,maxEdges:5}),a);assert.deepEqual(s,before);
 assert.deepEqual(view.sample({density:0}).edges,[]);assert.equal(view.sample({density:1,maxEdges:2}).sampling.capped,true);
});
test('adjacency pages include missing-position neighbors, count self once in rows and preserve both direction totals',async()=>{
 const view=create(sample()),a=await view.adjacency(`${dataset}/1`,{limit:1});
 assert.equal(a.totalIncoming,2);assert.equal(a.totalOutgoing,2);assert.equal(a.totalMatching,3);assert.equal(a.edges[0].direction,'self');assert.equal(a.nextOffset,1);
 const next=await view.adjacency(`${dataset}/1`,{offset:a.nextOffset,limit:2});assert.deepEqual(next.edges.map(e=>e.direction),['outgoing','incoming']);assert.equal(next.nextOffset,null);
 const missing=await view.adjacency(`${dataset}/4`);assert.equal(missing.selectedPositioned,false);assert.equal(missing.edges.length,2);assert.equal(missing.edges[0].positioned,false);
});
test('recipient/profile/hash mismatches and invalid bounds never invent connectivity',async()=>{
 const s=sample();s.atlas.nodes[0][0]='banc:v888/1';assert.throws(()=>create(s),/mismatch/);
 const mismatch=sample();mismatch.atlas.manifest.graphManifestSha256='b'.repeat(64);assert.throws(()=>create(mismatch),/mismatch/);
 const view=create(sample());for(const options of [{density:NaN},{density:2},{maxEdges:20001},{maxEdges:-1}])assert.throws(()=>view.sample(options),/Invalid/);
 await assert.rejects(view.adjacency('banc:v888/1'),/absent/);await assert.rejects(view.adjacency(`${dataset}/1`,{limit:1001}),/Invalid/);
 await assert.rejects(loadAtlasConnectivity('/nonexistent-atlas-data',dataset,s.atlas),/ENOENT/);
});
test('adjacency yields and cancellation frees its single-flight slot without partial success',async()=>{
 const view=create(sample()),controller=new AbortController(),first=view.adjacency(`${dataset}/1`,{signal:controller.signal});
 await assert.rejects(view.adjacency(`${dataset}/2`),/already in progress/);controller.abort();await assert.rejects(first,e=>e.name==='AbortError');
 assert.equal(view.status().scanning,false);assert.equal((await view.adjacency(`${dataset}/2`)).totalMatching,0);
});
