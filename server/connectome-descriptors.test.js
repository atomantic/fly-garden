import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync,symlinkSync} from 'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
import{verifyConnectomeDescriptor,readConnectomeMemoryEvidence,prepareConnectomeCatalog}from'./connectome-descriptors.js';import{createSparseLif,LIF_MODEL}from'./sparse-lif.js';
const digest=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){const path=mkdtempSync(join(tmpdir(),'descriptor-')),dataset='male-cns:v1.0';t.after(()=>rmSync(path,{recursive:true,force:true}));
 const graph={ids:['1','2'],offsets:new Uint32Array([0,1,2]),targets:new Uint32Array([1,0]),contacts:new Uint32Array([1,1]),signs:new Int8Array([1,1])};
 const files={'ids.json':Buffer.from(JSON.stringify(graph.ids)),...Object.fromEntries([['offsets.u32',graph.offsets],['targets.u32',graph.targets],['contacts.u32',graph.contacts],['signs.i8',graph.signs]].map(([name,array])=>[name,Buffer.from(array.buffer)]))};
 const manifest={schemaVersion:1,dataset,neuronCount:2,edgeCount:2,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{bytes:bytes.length,sha256:digest(bytes)}]))};
 for(const[name,bytes]of Object.entries(files))writeFileSync(join(path,name),bytes);const bytes=Buffer.from(JSON.stringify(manifest));writeFileSync(join(path,'manifest.json'),bytes);
 return{path,dataset,graph,readLock:async()=>({manifestSha256:digest(bytes)})};}
test('descriptor verifies pinned files and matches kernel graph identity without constructing a worker',async t=>{
 const f=fixture(t),descriptor=await verifyConnectomeDescriptor(f.path,f.dataset,{readLock:f.readLock});
 const kernel=createSparseLif({...f.graph,ids:f.graph.ids.map(id=>`${f.dataset}/${id}`)},{dataset:f.dataset});assert.equal(descriptor.graphSha256,kernel.graphSha256);assert.equal(descriptor.neuronCount,2);
 writeFileSync(join(f.path,'contacts.u32'),Buffer.alloc(8));await assert.rejects(verifyConnectomeDescriptor(f.path,f.dataset,{readLock:f.readLock}),/hash mismatch/);
});
test('wrong manifest, graph symlinks and foreign memory evidence are unavailable',async t=>{
 const f=fixture(t),descriptor=await verifyConnectomeDescriptor(f.path,f.dataset,{readLock:f.readLock});
 const report={schemaVersion:1,status:'measured-paused',dataset:f.dataset,runtime:process.version,platform:process.platform,architecture:process.arch,
  graphSha256:descriptor.graphSha256,provenance:{dataset:f.dataset,manifestSha256:descriptor.manifestSha256,neuronCount:2,edgeCount:2},
  model:{...LIF_MODEL,id:'malecns-traced-lif-v1'},baselineRssBytes:100,sampledPeakRssBytes:200,measuredIncrementBytes:100,
  suggestedAdmissionBytes:64*1024**2+150,checkpointJsonBytes:100,statusAfter:'paused',includesCheckpointSerialization:true};
 const evidence=join(f.path,'evidence.json');writeFileSync(evidence,JSON.stringify(report));assert.equal((await readConnectomeMemoryEvidence(evidence,f.dataset,descriptor)).available,true);
 for(const mutation of [{dataset:'banc:v888'},{runtime:'different'},{graphSha256:'00'.repeat(32)},{includesCheckpointSerialization:false},{suggestedAdmissionBytes:1}]){
  writeFileSync(evidence,JSON.stringify({...report,...mutation}));assert.equal((await readConnectomeMemoryEvidence(evidence,f.dataset,descriptor)).available,false);}
 assert.equal((await readConnectomeMemoryEvidence(null,f.dataset,descriptor)).available,false);
 rmSync(join(f.path,'signs.i8'));symlinkSync(join(f.path,'ids.json'),join(f.path,'signs.i8'));await assert.rejects(verifyConnectomeDescriptor(f.path,f.dataset,{readLock:f.readLock}));
 await assert.rejects(verifyConnectomeDescriptor(f.path,f.dataset,{readLock:async()=>({manifestSha256:'00'.repeat(32)})}),/manifest mismatch/);
});
test('configuration never initializes a catalog without a verified profile and never exposes failed paths',async t=>{
 const f=fixture(t);const empty=await prepareConnectomeCatalog({stateDirectory:join(f.path,'state'),configuration:{}});assert.equal(empty.store,null);
 const invalid=await prepareConnectomeCatalog({stateDirectory:join(f.path,'state'),configuration:{[f.dataset]:{directory:'/private/missing'}}});assert.equal(invalid.store,null);assert(!JSON.stringify(invalid).includes('/private/missing'));
 const configured=await prepareConnectomeCatalog({stateDirectory:join(f.path,'state'),configuration:{[f.dataset]:{directory:f.path}},verifyDescriptor:(directory,dataset)=>verifyConnectomeDescriptor(directory,dataset,{readLock:f.readLock})});
 t.after(()=>configured.store.close());assert.deepEqual(configured.store.identities(),[]);assert.equal(configured.profiles[f.dataset].measurement.available,false);
});
