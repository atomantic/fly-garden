import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from './runtime.js';
import { readFixtureMotor } from './environment-adapter.js';
const runtime = () => createRuntime({ individualId:'a',sessionId:'session-a' });

test('preparation and detached previews do not mutate active state; commit preserves exposure exactly', () => {
  const staged=runtime(),direct=runtime();
  for(const r of [staged,direct]) {r.control('start');r.encounter('nectar');}
  for(let i=0;i<100;i++) {
    const before=staged.snapshot(),policy=staged.checkpointStimulusPolicy();
    const input={retinalCurrents:Array(32).fill(i%2?0.01:0)};
    const token=staged.prepareStep(input);
    assert.equal(JSON.stringify(token),'{}');assert.equal(Object.isFrozen(token),true);
    const preview=staged.previewStep(token);
    assert.equal(preview.kind,'ready');assert.equal(preview.simTimeMs,before.simTimeMs+5);
    assert.deepEqual(staged.snapshot(),before);
    assert.deepEqual(staged.checkpointStimulusPolicy(),policy);
    const expected=structuredClone(preview.neural);
    preview.neural.neurons[0].potential=999;input.retinalCurrents.fill(0.03);
    direct.step({retinalCurrents:Array(32).fill(i%2?0.01:0)});
    assert.equal(staged.commitStep(token),true);
    assert.deepEqual(staged.snapshot().neural,expected);
    assert.deepEqual(staged.snapshot(),direct.snapshot());
    if(i<59) assert.equal(staged.snapshot().chemistry.find(e=>e.id==='nectar').active,true);
  }
});

test('every mutable lifecycle or policy path invalidates a prepared token without partial commit', () => {
  const changes=[r=>r.control('pause'),r=>r.control('start'),r=>r.control('rest'),r=>r.control('home'),
    r=>r.encounter('quiet'),r=>r.cancelStimulus('ui',1),r=>r.pauseFault('Explicit fault'),
    r=>r.restoreStimulusPolicy(r.checkpointStimulusPolicy()),r=>assert.throws(()=>r.encounter('unknown')),
    r=>assert.throws(()=>r.encounter('nectar')),r=>r.step()];
  for(const mutate of changes) {
    const r=runtime();r.control('start');r.encounter('nectar');
    const token=r.prepareStep();mutate(r);const after=r.snapshot();
    assert.throws(()=>r.previewStep(token),/stale/);assert.throws(()=>r.commitStep(token),/stale/);
    assert.deepEqual(r.snapshot(),after);
  }
});

test('tokens reject foreign, forged, serialized and reused state; sibling candidates stale on commit', () => {
  const a=runtime(),b=runtime();a.control('start');b.control('start');
  const first=a.prepareStep(),second=a.prepareStep(),before=b.snapshot();
  for(const forged of [first,{},JSON.parse(JSON.stringify(first)),undefined,null]) assert.throws(()=>b.commitStep(forged),/foreign/);
  assert.deepEqual(b.snapshot(),before);
  a.commitStep(first);assert.throws(()=>a.commitStep(first),/consumed/);assert.throws(()=>a.commitStep(second),/stale/);
  assert.equal(a.snapshot().tick,1);
});

test('numerical fault is previewed without mutation and pauses only on explicit commit', () => {
  const saved=runtime().checkpoint();saved.dynamics.tick=Math.floor(Number.MAX_SAFE_INTEGER/5);saved.stimulusPolicy.timeMs=saved.dynamics.tick*5;
  const r=createRuntime({individualId:'a',sessionId:'session-a',checkpoint:saved});r.control('start');
  const before=r.snapshot(),token=r.prepareStep(),preview=r.previewStep(token);
  assert.equal(preview.kind,'fault');assert.match(preview.faultReason,/clock/);
  assert.deepEqual(readFixtureMotor(preview),{forward:0,yaw:0});
  assert.deepEqual(r.snapshot(),before);
  assert.equal(r.commitStep(token),false);assert.equal(r.snapshot().status,'fault');
  assert.deepEqual(r.snapshot().neural,before.neural);assert.equal(r.snapshot().simTimeMs,before.simTimeMs);
});

test('inactive candidates do not advance and stale inactive candidates cannot skip explicit run', () => {
  const r=runtime(),before=r.snapshot(),token=r.prepareStep();
  assert.equal(r.previewStep(token).kind,'inactive');assert.equal(r.commitStep(token),false);
  assert.deepEqual(r.snapshot(),before);
  const paused=r.prepareStep();r.control('start');assert.throws(()=>r.commitStep(paused),/stale/);
  assert.throws(()=>r.prepareStep({retinalCurrents:[NaN]}));assert.equal(r.snapshot().tick,0);
});

test('two prepared residents can validate motor previews and commit synchronously with no crossed state', () => {
  const a=createRuntime({individualId:'a',sessionId:'a'}),b=createRuntime({individualId:'b',sessionId:'b'});
  a.control('start');b.control('start');
  const ta=a.prepareStep({retinalCurrents:Array(32).fill(0)}),tb=b.prepareStep({retinalCurrents:Array(32).fill(0.02)});
  for(const [r,t] of [[a,ta],[b,tb]]) {assert.equal(r.previewStep(t).kind,'ready');assert.doesNotThrow(()=>readFixtureMotor(r.previewStep(t)));}
  assert.equal(a.commitStep(ta),true);assert.equal(b.commitStep(tb),true);
  assert.equal(a.snapshot().tick,1);assert.equal(b.snapshot().tick,1);
  assert.notDeepEqual(a.snapshot().neural,b.snapshot().neural);
});
