import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ATLAS_GROUPS, validateAtlasMetadata, validateAtlasBuffers, loadAtlas } from './atlas-data.js';
const h = 'a'.repeat(64);
function sample() {
  const bounds = Object.fromEntries(['whole','brain','cord',...ATLAS_GROUPS].map(key => [key, ['whole','brain','central-brain'].includes(key) ? { min:[1,2,3],max:[1,2,3] } : null]));
  const manifest = { schemaVersion:1,kind:'anatomical-point-atlas',dataset:'male-cns:v1.0',pointKind:'soma',
    source:{url:'https://example.test/annotations',bytes:100,sha256:h,sourceLockSha256:h,license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',attribution:'Test',selection:'Traced'},graphManifestSha256:h,
    coordinates:{field:'somaLocation',sourceUnits:'8nm voxels',units:'micrometers',scale:[.008,.008,.008],translation:[0,0,0],axisOrder:['x','y','z'],frame:'male-cns:v1.0:native-EM',orientation:'Native axes',evidence:['https://example.test']},
    nodeColumns:['id','rawId','type','superclass','region','positionStatus'],groups:[...ATLAS_GROUPS],
    counts:{sourceRows:2,retained:2,positioned:1,missing:1,groups:Object.fromEntries(ATLAS_GROUPS.map(key => [key,key==='central-brain'?2:0])),missingReasons:{missing:1}},bounds,
    missingEncoding:'zero masked',disclosure:'Anatomy only',files:{'positions.f32':{bytes:24,sha256:h},'valid.u8':{bytes:2,sha256:h},'groups.u8':{bytes:2,sha256:h},'nodes.json':{bytes:200,sha256:h}} };
  return {manifest,buffers:{positions:new Float32Array([1,2,3,0,0,0]),valid:new Uint8Array([1,0]),groups:new Uint8Array([1,1]),nodes:[['male-cns:v1.0/1','1','cell','cb_intrinsic','','soma'],['male-cns:v1.0/9007199254740993','9007199254740993','','cb_intrinsic','','missing']]}};
}
test('atlas validates coverage, missing masks and exact IDs beyond Number precision', () => {
  const {manifest,buffers}=sample();assert.equal(validateAtlasBuffers(manifest,buffers).nodes[1][1],'9007199254740993');
});
test('metadata rejects incompatible units, namespace, count and unbounded file schema', () => {
  for(const change of [m=>m.schemaVersion=2,m=>m.coordinates.scale[0]=1,m=>m.coordinates.frame='banc:v888:native-EM',m=>m.counts.missing=0,m=>m.files['nodes.json'].bytes=100e6,m=>m.files['evil.json']={bytes:1,sha256:h}]) {
    const {manifest}=sample();change(manifest);assert.throws(()=>validateAtlasMetadata(manifest),/Invalid|incompatible/);
  }
});
test('corrupt positions, cross-specimen and duplicate IDs, false masks and bounds are rejected', () => {
  for(const change of [b=>b.positions[0]=NaN,b=>b.positions[3]=1,b=>b.valid[1]=1,b=>b.groups[0]=8,b=>b.nodes[1][0]='banc:v888/9007199254740993',b=>b.nodes[1]=b.nodes[0],b=>b.positions[0]=2]) {
    const {manifest,buffers}=sample();change(buffers);assert.throws(()=>validateAtlasBuffers(manifest,buffers),/Invalid|Atlas/);
  }
});
test('loader rejects unpinned metadata before attempting any asset read', async t => {
  const directory=await mkdtemp(join(tmpdir(),'atlas-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(sample().manifest));
  await assert.rejects(loadAtlas(directory,'male-cns:v1.0'),/hash mismatch/);
  await assert.rejects(loadAtlas(directory,'../other'),/Unsupported/);
});
test('canceled atlas load cannot return a partially validated profile', async t => {
  const directory=await mkdtemp(join(tmpdir(),'atlas-abort-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'manifest.json'),JSON.stringify(sample().manifest));
  const controller=new AbortController();controller.abort();
  await assert.rejects(loadAtlas(directory,'male-cns:v1.0',{signal:controller.signal}), error => error.name==='AbortError');
});
