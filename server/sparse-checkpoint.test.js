import test from 'node:test';
import assert from 'node:assert/strict';
import { createSparseLif } from './sparse-lif.js';
import { createConnectomeSession } from './connectome-worker.js';
const graph = dataset => ({ ids: [1, 2, 3].map(id => `${dataset}/${id}`), offsets: new Uint32Array([0, 1, 2, 3]), targets: new Uint32Array([1, 2, 0]), contacts: new Uint32Array([1200, 1200, 1200]), signs: new Int8Array([1, 1, 1]) });
for (const dataset of ['male-cns:v1.0', 'banc:v888']) {
  test(`${dataset} checkpoint retains pending spikes and exact subsequent trajectory`, () => {
    const first = createSparseLif(graph(dataset), { individualId: 'resident-a', dataset });
    first.seedProbe([0]); first.step();
    const saved = JSON.parse(JSON.stringify(first.checkpoint()));
    const restored = createSparseLif(graph(dataset), { individualId: 'resident-a', dataset, checkpoint: saved });
    for (let i = 0; i < 30; i++) { first.step(); restored.step(); assert.deepEqual(restored.checkpoint(), first.checkpoint()); }
    saved.potential[0] = -99;
    assert.notEqual(restored.inspect().potential[0], -99);
  });
}
test('invalid graph/model/namespace/identity/state restores leave all state intact', () => {
  const dataset = 'banc:v888';
  const kernel = createSparseLif(graph(dataset), { individualId: 'resident-a', dataset });
  kernel.seedProbe([0]); kernel.step();
  const before = kernel.checkpoint();
  for (const mutate of [s => s.individualId = 'other', s => s.dataset = 'male-cns:v1.0', s => s.graphSha256 = '0'.repeat(64), s => s.model.dtMs = 2, s => s.tick = -1, s => s.potential[1] = Infinity, s => s.firing[1] = 2, s => s.refractory[1] = 0, s => s.extra = true]) {
    const invalid = structuredClone(before); mutate(invalid);
    assert.throws(() => kernel.restore(invalid)); assert.deepEqual(kernel.checkpoint(), before);
  }
  const changed = graph(dataset); changed.contacts[0]++;
  assert.throws(() => createSparseLif(changed, { individualId: 'resident-a', dataset, checkpoint: before }));
  assert.throws(() => createSparseLif(graph(dataset), { dataset: 'male-cns:v1.0' }));
});
test('worker restore pauses and rotates epoch; old queued commands cannot advance', () => {
  const session = createConnectomeSession({ graph: graph('banc:v888'), dataset: 'banc:v888', individualId: 'one' });
  const epoch = session.snapshot().sessionEpoch;
  const send = (action, value, sessionEpoch = epoch) => session.dispatch({ action, value, sessionEpoch });
  assert.equal(session.snapshot().status, 'paused');
  assert.throws(() => send('advance', 1), /start/);
  send('probe', [0]); const saved = send('checkpoint'); send('start'); send('advance', 3);
  const restored = send('restore', saved);
  assert.equal(restored.status, 'paused'); assert.notEqual(restored.sessionEpoch, epoch); assert.equal(restored.neural.tick, 0);
  assert.throws(() => send('start'), /epoch/);
  assert.throws(() => send('advance', 1, restored.sessionEpoch), /start/);
  assert.throws(() => send('restore', { ...saved, individualId: 'wrong' }, restored.sessionEpoch));
  assert.equal(session.snapshot().sessionEpoch, restored.sessionEpoch);
});

test('all natural initial, probe, refractory and silence boundaries remain restorable', () => {
  const dataset='banc:v888', first=createSparseLif(graph(dataset),{dataset,individualId:'boundaries'});
  const roundtrip=()=>{
    const checkpoint=JSON.parse(JSON.stringify(first.checkpoint()));
    const copy=createSparseLif(graph(dataset),{dataset,individualId:'boundaries',checkpoint});
    assert.deepEqual(copy.checkpoint(),first.checkpoint());
  };
  roundtrip(); first.seedProbe([0]); roundtrip();
  assert.equal(first.checkpoint().totalSpikes,0); assert.equal(first.checkpoint().firing[0],1);
  for(let i=0;i<12;i++){first.step();roundtrip();}
  const silent=createSparseLif(graph(dataset),{dataset,individualId:'silent'});
  for(let i=0;i<5;i++){silent.step();silent.restore(JSON.parse(JSON.stringify(silent.checkpoint())));}
  assert.equal(silent.checkpoint().totalSpikes,0);
});

test('impossible refractory and history restores reject atomically, including initial probe exceptions', () => {
  const dataset='banc:v888', kernel=createSparseLif(graph(dataset),{dataset,individualId:'atomic'});
  const initial=kernel.checkpoint();
  const reject=(source,mutate)=>{const invalid=structuredClone(source),before=kernel.checkpoint();mutate(invalid);
    assert.throws(()=>kernel.restore(invalid));assert.deepEqual(kernel.checkpoint(),before);};
  for(const mutate of [s=>s.refractory[0]=2,s=>s.refractory[0]=1,s=>s.potential[0]=-0.1,s=>s.totalSpikes=1,s=>s.traversedEdges=1])reject(initial,mutate);
  kernel.seedProbe([0]);const probe=kernel.checkpoint();
  reject(probe,s=>s.firing[0]=0);
  kernel.step();const stepped=kernel.checkpoint();
  for(const mutate of [s=>s.refractory[2]=2,s=>s.totalSpikes=0,s=>s.totalSpikes=4,s=>s.traversedEdges=4])reject(stepped,mutate);
  // Counter products may exceed Number precision; safe counters remain valid without
  // overflowing validation arithmetic. The next clock overflow still commits nothing.
  const nearLimit=structuredClone(initial);nearLimit.tick=Number.MAX_SAFE_INTEGER;
  kernel.restore(nearLimit);const beforeStep=kernel.checkpoint();
  assert.throws(()=>kernel.step(),/limit/);assert.deepEqual(kernel.checkpoint(),beforeStep);
});

test('zero-edge graphs cannot restore fabricated traversals, and rejected worker restore preserves running epoch', () => {
  const dataset='banc:v888', empty={ids:[`${dataset}/1`],offsets:new Uint32Array([0,0]),targets:new Uint32Array(),contacts:new Uint32Array(),signs:new Int8Array([1])};
  const kernel=createSparseLif(empty,{dataset,individualId:'empty'});kernel.step();
  const prior=kernel.checkpoint();assert.throws(()=>kernel.restore({...prior,traversedEdges:1}));assert.deepEqual(kernel.checkpoint(),prior);
  const session=createConnectomeSession({graph:graph(dataset),dataset,individualId:'worker-atomic'}), epoch=session.snapshot().sessionEpoch;
  session.dispatch({action:'probe',value:[0],sessionEpoch:epoch});session.dispatch({action:'start',sessionEpoch:epoch});
  const before=session.dispatch({action:'checkpoint',sessionEpoch:epoch}), invalid=structuredClone(before);invalid.firing[0]=0;
  assert.throws(()=>session.dispatch({action:'restore',value:invalid,sessionEpoch:epoch}));
  assert.equal(session.snapshot().status,'running');assert.equal(session.snapshot().sessionEpoch,epoch);
  assert.deepEqual(session.dispatch({action:'checkpoint',sessionEpoch:epoch}),before);
});
