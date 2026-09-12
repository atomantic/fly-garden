import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectomeRegistry } from './connectome-registry.js';
import { createConnectomeSession } from './connectome-worker.js';
import { createCapacityPolicy } from './population-capacity.js';
const graph = dataset => ({ ids: [1,2,3].map(id => `${dataset}/${id}`), offsets: new Uint32Array([0,1,2,3]), targets: new Uint32Array([1,2,0]), contacts: new Uint32Array([1200,1200,1200]), signs: new Int8Array([1,1,1]) });
const settings = { maxResidentFlies: 2, maxAggregateMemoryBytes: 10000, minFreeMemoryBytes: 100 };
const identities = [{ individualId: 'a', dataset: 'male-cns:v1.0', directory: '/trusted/a' }, { individualId: 'b', dataset: 'banc:v888', directory: '/trusted/b' }];
function setup(overrides = {}) {
  const writes = [], opened = [];
  const openBackend = async (_directory, options) => {
    const session = createConnectomeSession({ ...options, graph: graph(options.dataset) });
    let epoch = session.snapshot().sessionEpoch, closed = false;
    const dispatch = async (action, value) => { if (closed) throw new Error('closed'); const result = session.dispatch({ action, value, sessionEpoch: epoch }); if (result?.sessionEpoch) epoch = result.sessionEpoch; return result; };
    const backend = { ready: session.snapshot(), close: async () => { closed = true; }, ...Object.fromEntries(['snapshot','start','pause','advance','checkpoint','prepareRestore','commitRestore'].map(action => [action, value => dispatch(action,value)])) };
    opened.push(backend); return backend;
  };
  const capacity = createCapacityPolicy({ settings });
  const registry = createConnectomeRegistry({ identities, capacity, openBackend,
    getResources: async ({ dataset }) => ({ aggregateMemoryBytes: 100, availableMemoryBytes: 10000, measurement: { backend: 'connectome', dataset, incrementalMemoryBytes: 100, includesCheckpointSerialization: true } }),
    persistCheckpoint: async write => { writes.push(write); return { checkpointId: `save-${writes.length}` }; }, ...overrides });
  const envelope = (id, action, steps = null) => { const state = registry.snapshot(id); return { protocolVersion: 1, individualId: id, sessionEpoch: state.sessionEpoch, commandSequence: state.commandSequence, action, steps }; };
  return { registry, writes, opened, capacity, envelope, command: (id, action, steps = null, checkpoint) => registry.command(id, envelope(id, action, steps), checkpoint) };
}
test('construction/read-only access never opens workers; capacity counts paused and serializes concurrent loads', async t => {
  const f = setup(); t.after(() => f.registry.close());
  assert.equal(f.registry.list().length, 2); assert.equal(f.opened.length, 0);
  f.capacity.configure({ ...settings, maxResidentFlies: 1 });
  const results = await Promise.allSettled([f.registry.load('a'), f.registry.load('b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.opened.length, 1);
  assert.equal(f.registry.snapshot('a').neural.tick, 0);
  f.capacity.configure(settings); await f.registry.load('b');
  await f.command('a', 'start'); assert.equal(f.registry.snapshot('a').neural.tick, 0);
  await f.command('a', 'advance', 10); assert.equal(f.registry.snapshot('b').neural.tick, 0);
  assert.equal(f.registry.snapshot('a').dataset, 'male-cns:v1.0'); assert.equal(f.registry.snapshot('b').dataset, 'banc:v888');
});
test('unknown or wrong-profile measurement rejects before worker construction', async t => {
  const f = setup({ getResources: async () => ({ aggregateMemoryBytes: 0, availableMemoryBytes: 10000 }) }); t.after(() => f.registry.close());
  await assert.rejects(f.registry.load('a'), /unknown-footprint/); assert.equal(f.opened.length, 0);
});
test('save, queued unload and recovery preserve stable identity and paused state', async t => {
  const f = setup(); t.after(() => f.registry.close()); await f.registry.load('a');
  await f.command('a','start');
  const advance = f.envelope('a','advance',5), unload = { ...advance, action: 'unload', steps: null, commandSequence: advance.commandSequence + 1 };
  await Promise.all([f.registry.command('a',advance), f.registry.command('a',unload)]);
  assert.equal(f.registry.snapshot('a').resident,false); assert.equal(f.writes[0].checkpoint.tick,5);
  const loaded = await f.registry.load('a'); assert.equal(loaded.neural.tick,5); assert.equal(loaded.status,'paused');
  assert.notEqual(loaded.sessionEpoch,advance.sessionEpoch);
  await assert.rejects(f.registry.command('a',advance),/stale/);
});
test('writer failure retains current durable head and live neural state on save/unload/restore', async t => {
  let fail = false; const writes = [];
  const f = setup({ persistCheckpoint: async value => { if (fail) throw new Error('disk full'); writes.push(value); return { checkpointId: `saved-${writes.length}` }; } }); t.after(() => f.registry.close());
  await f.registry.load('a'); await f.command('a','save'); const original = writes[0].checkpoint;
  await f.command('a','start'); await f.command('a','advance',4);
  fail = true;
  for (const action of ['save','unload','restore']) {
    const before = f.registry.snapshot('a'); await assert.rejects(f.command('a',action,null, action === 'restore' ? original : undefined),/disk full/);
    const after = f.registry.snapshot('a'); assert.deepEqual(after.neural,before.neural); assert.equal(after.checkpointId,'saved-1'); assert.equal(after.resident,true); assert.equal(after.status,'paused');
  }
  fail = false; const oldEpoch = f.registry.snapshot('a').sessionEpoch;
  await f.command('a','restore',null,original); assert.equal(f.registry.snapshot('a').neural.tick,0); assert.notEqual(f.registry.snapshot('a').sessionEpoch,oldEpoch);
});
test('invalid cross-profile restore cannot write durable heads or mutate either individual', async t => {
  const f = setup(); t.after(() => f.registry.close()); await f.registry.load('a'); await f.registry.load('b');
  await f.command('b','save'); const target = f.writes[0].checkpoint, before = f.registry.snapshot('b');
  await assert.rejects(f.command('a','restore',null,target), /identity/);
  assert.equal(f.writes.length,1); assert.deepEqual(f.registry.snapshot('b'),before);
});
test('prepared restore tokens are invalidated by intervening worker mutation', () => {
  const session = createConnectomeSession({ individualId:'a', dataset:'male-cns:v1.0', graph:graph('male-cns:v1.0') });
  const epoch = session.snapshot().sessionEpoch;
  const send = (action,value) => session.dispatch({ action,value,sessionEpoch:epoch });
  const prepared = send('prepareRestore',send('checkpoint')); send('start');
  assert.throws(() => send('commitRestore',prepared.token),/Stale/); assert.equal(session.snapshot().neural.tick,0);
});
test('worker loss after durable restore commit evicts live state and recovers selected head paused', async t => {
  const f = setup(); t.after(() => f.registry.close()); await f.registry.load('a');
  await f.command('a','save'); const target = f.writes[0].checkpoint;
  await f.command('a','start'); await f.command('a','advance',5);
  f.opened[0].commitRestore = async () => { throw new Error('worker stopped'); };
  await assert.rejects(f.command('a','restore',null,target), /worker stopped/);
  assert.equal(f.registry.snapshot('a').resident,false); assert.equal(f.registry.snapshot('a').checkpointId,'save-2');
  const recovered = await f.registry.load('a'); assert.equal(recovered.status,'paused'); assert.equal(recovered.neural.tick,0);
});
test('a late worker load beyond its deadline is closed and never published', async t => {
  let resolve, closed = false;
  const f = setup({ operationTimeoutMs: 5, openBackend: () => new Promise(r => { resolve = r; }) }); t.after(() => f.registry.close());
  await assert.rejects(f.registry.load('a'),/deadline/);
  resolve({ close: async () => { closed = true; } }); await new Promise(r => setImmediate(r));
  assert.equal(closed,true); assert.equal(f.registry.snapshot('a').resident,false);
});

test('timed-out opening and slow shutdown retain admission until confirmed completion', async t => {
  let finishOpen, finishClose, openings=0;
  const f=setup({ operationTimeoutMs:5, openBackend:()=>{openings++;return new Promise(resolve=>{finishOpen=resolve;});} });
  f.capacity.configure({...settings,maxResidentFlies:1});t.after(()=>f.registry.close());
  await assert.rejects(f.registry.load('a'),/deadline/);
  assert.equal(f.registry.snapshot('a').resident,true);assert.equal(f.registry.snapshot('a').status,'stopping');
  await assert.rejects(f.registry.load('a'),/termination/);
  await assert.rejects(f.registry.load('b'),/capacity|resident/);assert.equal(openings,1);
  finishOpen({close:()=>new Promise(resolve=>{finishClose=resolve;})});await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.registry.load('b'),/capacity|resident/);assert.equal(openings,1);
  finishClose();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.registry.snapshot('a').resident,false);
});

test('slow resident shutdown retains capacity and old exit callbacks cannot evict replacements', async t => {
  let firstOptions, closeResolve, count=0;
  const f=setup({openBackend:async(_directory,options)=>{
    count++;if(count===1)firstOptions=options;
    const ready={available:true,status:'paused',individualId:options.individualId,dataset:options.dataset,sessionEpoch:`epoch-${count}`,neural:{tick:0}};
    return {ready,pause:async()=>ready,checkpoint:async()=>({individualId:options.individualId,dataset:options.dataset}),
      close:count===1?()=>new Promise(resolve=>{closeResolve=resolve;}):async()=>{options.onExit();}};
  }});t.after(()=>f.registry.close());f.capacity.configure({...settings,maxResidentFlies:1});
  await f.registry.load('a');const unload=f.command('a','unload');
  while(!closeResolve)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.registry.snapshot('a').resident,true);await assert.rejects(f.registry.load('b'),/capacity|resident/);
  closeResolve();await unload;await f.registry.load('a');const replacement=f.registry.snapshot('a');
  firstOptions.onExit();assert.deepEqual(f.registry.snapshot('a'),replacement);
});

test('actual worker exit revokes cached public state without another command', async t => {
  const {Worker}=await import('node:worker_threads');
  const {once}=await import('node:events');let worker;
  const f=setup({openBackend:async(_directory,options)=>{
    worker=new Worker("const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>process.exit(0));parentPort.postMessage('ready');",{eval:true,execArgv:[]});
    worker.once('exit',options.onExit);await once(worker,'message');
    const state={available:true,status:'paused',individualId:options.individualId,dataset:options.dataset,sessionEpoch:'actual-worker-epoch',neural:{tick:0}};
    return {ready:state,close:()=>worker.terminate(),start:async()=>({...state,status:'running'})};
  }});t.after(()=>f.registry.close());
  await f.registry.load('a');await f.command('a','start');const before=f.registry.snapshot('a');assert.equal(before.status,'running');
  const exited=once(worker,'exit');worker.postMessage('exit');await exited;
  const after=f.registry.snapshot('a');assert.equal(after.resident,false);assert.equal(after.status,'unavailable');assert.equal(after.neural,null);assert.notEqual(after.sessionEpoch,before.sessionEpoch);
  assert.equal(f.registry.list()[0].status,'unavailable');
  await assert.rejects(f.registry.command('a',{protocolVersion:1,individualId:'a',sessionEpoch:before.sessionEpoch,commandSequence:before.commandSequence,action:'start',steps:null}),/stale/);
});
test('trusted registration stays unloaded and lazy heads read only after admission, then reload exact durable state', async t => {
  const saved = new Map(), reads = [], writes = [];
  const f = setup({ identities: [], loadCheckpoint: async request => { reads.push(request); return saved.get(request.checkpointId); },
    persistCheckpoint: async request => { writes.push(request); const checkpointId=`head-${writes.length}`; saved.set(checkpointId,structuredClone(request.checkpoint)); return {checkpointId}; } });
  t.after(()=>f.registry.close());
  const registered=f.registry.register(identities[0]);assert.equal(registered.status,'saved-unloaded');assert.equal(f.opened.length,0);assert.equal(reads.length,0);
  assert.throws(()=>f.registry.register({...identities[0],dataset:'banc:v888'}),/duplicate/);
  await f.registry.load('a');assert.equal(reads.length,0);await f.command('a','start');await f.command('a','advance',3);await f.command('a','save');await f.command('a','unload');
  await f.registry.load('a');assert.equal(reads.length,1);assert.equal(reads[0].checkpointId,'head-2');assert.equal(f.registry.snapshot('a').neural.tick,3);
  const target=saved.get('head-1');await assert.rejects(f.command('a','restore',null,target),/Invalid/);
  await f.registry.command('a',f.envelope('a','restore'),target,'head-1');assert.equal(writes.at(-1).sourceCheckpointId,'head-1');
  await f.registry.close();assert.throws(()=>f.registry.register(identities[1]),/closed/);
});
test('lazy saved-head corruption rejects before worker creation without silently initializing a fresh kernel', async t => {
  let reads=0;const f=setup({identities:[{...identities[0],checkpointId:'saved-head'}],loadCheckpoint:async()=>{reads++;return null;}});t.after(()=>f.registry.close());
  assert.equal(reads,0);await assert.rejects(f.registry.load('a'),/missing/);assert.equal(f.opened.length,0);assert.equal(reads,1);
});

test('uncertain committed save/restore selects the reported head, evicts old arrays, and waits for recovered storage', async t => {
 for (const operation of ['save','unload','restore']) {
  const saved=new Map();let fail=false,recovered=true,count=0;
  const f=setup({loadCheckpoint:async request=>{if(!recovered)throw new Error('Storage recovery required');return saved.get(request.checkpointId);},
   persistCheckpoint:async request=>{const checkpointId=`selected-${++count}`;saved.set(checkpointId,structuredClone(request.checkpoint));
    if(fail){recovered=false;throw Object.assign(new Error('Directory durability uncertain; selected head changed'),{code:'CONNECTOME_DURABILITY_UNCERTAIN',individualId:request.individualId,selectedCheckpointId:checkpointId});}
    return{checkpointId};}});t.after(()=>f.registry.close());
  await f.registry.load('a');await f.command('a','save');const initial=saved.get('selected-1');await f.command('a','start');await f.command('a','advance',4);fail=true;
  await assert.rejects(f.registry.command('a',f.envelope('a',operation),operation==='restore'?initial:undefined,operation==='restore'?'selected-1':null),error=>error.code==='CONNECTOME_DURABILITY_UNCERTAIN');
  const failed=f.registry.snapshot('a');assert.equal(failed.checkpointId,'selected-2');assert.equal(failed.resident,false);assert.equal(failed.neural,null);assert.equal(failed.recoveryRequired,true);
  await assert.rejects(f.registry.load('a'),/Storage recovery/);assert.equal(f.opened.length,1);
  recovered=true;const loaded=await f.registry.load('a');assert.equal(loaded.neural.tick,operation==='restore'?0:4);assert.equal(loaded.status,'paused');assert.equal(loaded.recoveryRequired,false);
 }
});
test('uncertain writer cannot recover via stale cached arrays or a foreign reported head',async t=>{
 for(const foreign of [false,true]) {
  const f=setup({persistCheckpoint:async request=>{throw Object.assign(new Error('uncertain'),{code:'CONNECTOME_DURABILITY_UNCERTAIN',individualId:foreign?'b':request.individualId,selectedCheckpointId:'new-head'});}});t.after(()=>f.registry.close());
  await f.registry.load('a');await assert.rejects(f.command('a','save'),/uncertain/);assert.equal(f.registry.snapshot('a').resident,false);
  assert.equal(f.registry.snapshot('a').checkpointId,foreign?null:'new-head');await assert.rejects(f.registry.load('a'),/reconstruction/);
 }
});
