import test from 'node:test';
import assert from 'node:assert/strict';
import { createSparseLif, MAX_NEURON_SAMPLE } from './sparse-lif.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createConnectomeRegistry } from './connectome-registry.js';
import { openConnectomeBackend } from './connectome.js';
const dataset = 'male-cns:v1.0', individualId = 'sample-individual';
const neuron = raw => `${dataset}/${raw}`;
function graph(n = 4) {
  return { ids: Array.from({length:n}, (_, i) => neuron(String(9007199254740993n + BigInt(i)))),
    offsets: Uint32Array.from(Array.from({length:n+1}, (_, i) => Math.min(i, 2))),
    targets: new Uint32Array([2,3]), contacts: new Uint32Array([500,1200]), signs: Int8Array.from(Array(n).fill(1)) };
}
test('exact ordered samples match nonzero electrical state without copying or changing authoritative arrays', () => {
  const source = graph(), kernel = createSparseLif(source, {dataset,individualId});
  const ids = [source.ids[3],source.ids[0],source.ids[2]];
  // Nonzero numerical fixture setup is explicit test work, never part of sampling.
  kernel.seedProbe([0,1]);kernel.step();
  const before = kernel.checkpoint(), sample = kernel.sample(ids);
  assert.deepEqual(sample.samples, [
    {neuronId:ids[0],potential:0,firing:1,refractoryStepsRemaining:2},
    {neuronId:ids[1],potential:0,firing:0,refractoryStepsRemaining:1},
    {neuronId:ids[2],potential:0.5,firing:0,refractoryStepsRemaining:0},
  ]);
  assert.equal(sample.graphSha256,kernel.graphSha256);assert.equal(sample.individualId,individualId);assert.equal(sample.dataset,dataset);
  assert.equal(sample.tick,1);assert.equal(sample.simTimeMs,1);
  assert.deepEqual(sample.timeWindow,{kind:'instantaneous',startTick:1,endTick:1,startSimTimeMs:1,endSimTimeMs:1});
  assert.match(sample.disclosure,/Not firing rates/);assert.equal(sample.samples.length,ids.length);
  sample.samples[0].potential=99;sample.samples.push({});
  assert.deepEqual(kernel.checkpoint(),before);
  const prepared=kernel.prepareRestore(before);kernel.sample(ids);kernel.commitRestore(prepared);
  assert.deepEqual(kernel.checkpoint(),before,'a read does not invalidate a prepared restore');
});
test('duplicate, unknown, foreign, sparse and oversized selections reject atomically; 256 exact IDs allowed', () => {
  const source=graph(257),kernel=createSparseLif(source,{dataset,individualId}),before=kernel.checkpoint();
  for (const ids of [[],[source.ids[0],source.ids[0]],[source.ids[0],neuron('999')],['banc:v888/1'],[9007199254740993],Array(1),source.ids]) {
    assert.throws(()=>kernel.sample(ids));assert.deepEqual(kernel.checkpoint(),before);
  }
  const selected=source.ids.slice(0,MAX_NEURON_SAMPLE);
  assert.equal(kernel.sample(selected).samples.length,256);assert.deepEqual(kernel.checkpoint(),before);
});
test('session samples retain prepared restore, reject stale epochs and never start or advance', () => {
  const source=graph(),session=createConnectomeSession({graph:source,dataset,individualId,provenance:{manifestSha256:'a'.repeat(64)}});
  let epoch=session.snapshot().sessionEpoch;
  const send=(action,value)=>session.dispatch({action,value,sessionEpoch:epoch});
  const before=send('checkpoint'), prepared=send('prepareRestore',before);
  for(let i=0;i<3;i++) {
    const result=send('sample',[source.ids[0]]);assert.equal(result.status,'paused');assert.equal(result.tick,0);
    assert.equal(result.sessionEpoch,epoch);assert.equal(result.provenance.manifestSha256,'a'.repeat(64));
    assert.deepEqual(result.samples,[{neuronId:source.ids[0],potential:0,firing:0,refractoryStepsRemaining:0}]);
  }
  send('commitRestore',prepared.token);
  assert.throws(()=>send('sample',[source.ids[0]]),/Stale/);
  epoch=session.snapshot().sessionEpoch;assert.deepEqual(send('checkpoint'),before);
  send('start');const running=send('sample',[source.ids[0]]);assert.equal(running.status,'running');assert.equal(running.tick,0);
});
function setup({sampleHook} = {}) {
  let session;
  const registry=createConnectomeRegistry({identities:[{individualId,dataset,directory:'/trusted'}],
    getResources:async()=>({aggregateMemoryBytes:0,availableMemoryBytes:1e10,measurement:{backend:'connectome',dataset,incrementalMemoryBytes:100,includesCheckpointSerialization:true}}),
    persistCheckpoint:async()=>({checkpointId:'saved'}),
    openBackend:async(_dir,options)=>{
      session=createConnectomeSession({...options,graph:graph()});let epoch=session.snapshot().sessionEpoch;
      return {ready:session.snapshot(),close:async()=>{},...Object.fromEntries(['snapshot','start','pause','advance','checkpoint','prepareRestore','commitRestore','sample'].map(action=>[action,async value=>{
        const result=session.dispatch({action,value,sessionEpoch:epoch});if(result?.sessionEpoch)epoch=result.sessionEpoch;
        return action==='sample' && sampleHook ? sampleHook(result,options) : result;
      }]))};
    }});
  const envelope=(action,steps=null)=>{const state=registry.snapshot(individualId);return {protocolVersion:1,individualId,sessionEpoch:state.sessionEpoch,commandSequence:state.commandSequence,action,steps};};
  const request=()=>{const state=registry.snapshot(individualId);return {protocolVersion:1,individualId,dataset,graphSha256:state.graphSha256,sessionEpoch:state.sessionEpoch,neuronIds:[graph().ids[0]]};};
  return {registry,envelope,request,checkpoint:()=>session.dispatch({action:'checkpoint',sessionEpoch:session.snapshot().sessionEpoch})};
}
test('registry serializes reads with advances and restores, keeps command sequence and Rest intact', async t => {
  const f=setup();t.after(()=>f.registry.close());await f.registry.load(individualId);
  const saved=f.checkpoint();await f.registry.command(individualId,f.envelope('start'));
  const advance=f.registry.command(individualId,f.envelope('advance',7));
  const requested=f.request(), read=f.registry.sample(individualId,requested);
  requested.neuronIds[0]=neuron('999'); // Caller mutation cannot rewrite queued selection.
  await advance;const sampled=await read;assert.equal(sampled.tick,7);
  assert.equal(sampled.commandSequence,f.registry.snapshot(individualId).commandSequence);
  const oldRequest=f.request(),restore=f.registry.command(individualId,f.envelope('restore'),saved);
  const staleRead=f.registry.sample(individualId,oldRequest);await restore;await assert.rejects(staleRead,/Stale/);
  await f.registry.command(individualId,f.envelope('rest'));
  const before=f.registry.snapshot(individualId);
  assert.equal((await f.registry.sample(individualId,f.request())).status,'resting');
  await assert.rejects(f.registry.sample(individualId,{...f.request(),neuronIds:[neuron('999')]}),/Unknown/);
  assert.deepEqual(f.registry.snapshot(individualId),before);
  assert.throws(()=>f.registry.sample(individualId,{...f.request(),dataset:'banc:v888'}),/Invalid/);
  await assert.rejects(f.registry.sample(individualId,{...f.request(),graphSha256:'b'.repeat(64)}),/Stale/);
  await f.registry.command(individualId,f.envelope('unload'));
  await assert.rejects(f.registry.sample(individualId,oldRequest),/unavailable/);
});
test('real unavailable worker samples reject rather than fabricating zero activity', async () => {
  const backend=await openConnectomeBackend('/nonexistent/connectome-sample',{dataset,individualId});
  try {
    await assert.rejects(backend.sample([neuron('1')]),/unavailable/);
    await assert.rejects(backend.sample(Array(257).fill(neuron('1'))),/1–256/);
    assert.equal((await backend.snapshot()).status,'unavailable');
  } finally {await backend.close();}
});

test('registry refuses a late sample from an exited worker without publishing old source data', async t => {
  let finish, entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const f=setup({sampleHook:(result,options)=>new Promise(resolve=>{finish=()=>{options.onExit();resolve(result);};entered();})});
  t.after(()=>f.registry.close());await f.registry.load(individualId);
  const old=f.request(),read=f.registry.sample(individualId,old);await waiting;finish();
  await assert.rejects(read,/session ended/);
  const current=f.registry.snapshot(individualId);assert.equal(current.status,'unavailable');assert.equal(current.neural,null);
  assert.notEqual(current.sessionEpoch,old.sessionEpoch);assert.equal(current.commandSequence,0);
});
