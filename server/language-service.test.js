import test from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageService } from './language-service.js';
const config={providerId:'test',model:'fake',maxCalls:2,maxTokens:10000,maxSpendMicros:0,cooldownMs:1000,detectorThresholdHz:1,detectorEnabled:false};
function fixture(generate) {
  const states=new Map(['a','b'].map(individualId=>[individualId,{individualId,sessionId:`${individualId}-session`,status:'paused',environment:'home',simTimeMs:0,
    persistence:{resident:true},dataset:{namespace:'synthetic'},model:{id:'fixture'},neural:{meanRateHz:2,spikes:1},events:[{id:1,timeMs:0}]}]));
  let time=0;const calls=[];
  const identities={list:()=>[...states.keys()].map(individualId=>({individualId})),snapshot:id=>structuredClone(states.get(id))};
  const service=createLanguageService({identities,now:()=>time,providers:[{providerId:'test',model:'fake',requestTokens:4096,requestSpendMicros:0,maxOutputTokens:512,
    generate:generate??(async p=>{calls.push(p);return {text:'Uncertain description.',totalTokens:100};})}]});
  return {service,states,calls,advance:()=>{time+=1000;for(const state of states.values()) state.simTimeMs+=100;}};
}
test('construction, reading, paused and disarmed ticks cause zero requests',async()=>{
  const {service,states,calls,advance}=fixture();service.snapshot('a');await service.tick();
  service.arm('a',{...config,detectorEnabled:true});advance();await service.tick();
  assert.equal(calls.length,0);
  states.get('a').status='running';service.disarm('a');await service.tick();assert.equal(calls.length,0);
});
test('chat derives exact live or retained historical evidence and rejects client-provided summaries',async()=>{
  const {service,states,calls,advance}=fixture();
  const window=service.snapshot('a').evidenceWindows[0].windowId;
  service.arm('a',config);
  await assert.rejects(service.chat('a',{requestId:'bad',message:'Explain',windowId:null,evidence:{meanRateHz:999}}));
  await assert.rejects(service.chat('b',{requestId:'bad',message:'Explain',windowId:window}));
  states.get('a').neural.meanRateHz=3;advance();
  const result=await service.chat('a',{requestId:'live',message:'Explain',windowId:null});
  assert.equal(result.evidence.meanRateHz,3);assert.equal(result.evidence.endMs,100);assert.equal(calls.length,1);
  advance();await service.chat('a',{requestId:'old',message:'Compare this earlier window',windowId:window});
  assert.equal(calls[1].evidence.source,'history');assert.equal(calls[1].evidence.meanRateHz,2);assert.equal(calls[1].evidence.endMs,0);
});
test('detector requires separate opt-in, running fresh evidence and cooldown; exhausted ticks do not spam logs',async()=>{
  const {service,states,calls,advance}=fixture();states.get('a').status='running';service.arm('a',config);advance();await service.tick();assert.equal(calls.length,0);
  service.arm('a',{...config,detectorEnabled:true});await service.tick();assert.equal(calls.length,1);
  for(let i=0;i<20;i++)await service.tick();assert.equal(calls.length,1);
  advance();await service.tick();assert.equal(calls.length,2);
  const count=service.snapshot('a').events.length;
  for(let i=0;i<20;i++){advance();await service.tick();}
  assert.equal(calls.length,2);assert.equal(service.snapshot('a').events.length,count);
});
test('pause/restore/home/unload invalidate pending outputs without selection redirect',async()=>{
  for(const change of [s=>{s.status='paused';},s=>{s.sessionId='new-session';},s=>{s.environment='elsewhere';},s=>{s.persistence.resident=false;s.status='saved-unloaded';}]) {
    let finish;
    const {service,states}=fixture(()=>new Promise(resolve=>{finish=resolve;}));
    states.get('a').status='running';service.arm('a',config);
    const pending=service.chat('a',{requestId:'pending',message:'Explain',windowId:null});await Promise.resolve();
    service.snapshot('b');change(states.get('a'));service.refresh('a');
    const result=await pending;assert.equal(result.status,'canceled');assert.equal(result.interpretation,undefined);
    finish({text:'Late text',totalTokens:10});await Promise.resolve();
    assert.equal(service.snapshot('a').armed,false);assert.equal(service.snapshot('b').reserved.calls,0);
  }
});
test('explicit unchanged home/pause lifecycle and final source check suppress stale delivery',async()=>{
  let finish;
  const {service,states}=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  service.arm('a',config);service.lifecycle('a');assert.equal(service.snapshot('a').armed,false);
  service.arm('a',config);
  const pending=service.chat('a',{requestId:'pending',message:'Explain',windowId:null});await Promise.resolve();
  states.get('a').sessionId='restored';finish({text:'Stale text',totalTokens:10});
  const result=await pending;assert.equal(result.status,'canceled');
  assert.equal(service.snapshot('a').events.some(e=>e.interpretation),false);
});
test('default service reports unavailable and cannot arm; historical storage is bounded',()=>{
  const {service,states,advance}=fixture();
  for(let i=0;i<100;i++){advance();service.snapshot('a');}
  assert.equal(service.snapshot('a').evidenceWindows.length,64);
  const unavailable=createLanguageService({identities:{list:()=>[],snapshot:()=>states.get('a')}});
  assert.equal(unavailable.snapshot('a').available,false);assert.throws(()=>unavailable.arm('a',config),/unavailable/);
});

test('invalid source telemetry cancels pending work and cannot leak a completed stale reply',async()=>{
  let finish;
  const {service,states}=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  service.arm('a',config);
  const pending=service.chat('a',{requestId:'bad-source',message:'Explain',windowId:null});await Promise.resolve();
  states.get('a').neural.meanRateHz=NaN;
  finish({text:'Must not appear',totalTokens:10});
  const result=await pending;assert.equal(result.status,'canceled');assert.equal(result.interpretation,undefined);
  states.get('a').neural.meanRateHz=2;
  assert.equal(service.snapshot('a').armed,false);
  assert.equal(service.snapshot('a').events.some(e=>e.interpretation),false);
});

test('delayed cleanup cancels only its original pending request, preserving newer arming and work', async () => {
  const finish = [];
  const { service, advance } = fixture(() => new Promise(resolve => finish.push(resolve)));
  service.arm('a', config);
  const original = service.chat('a', { requestId: 'original-tab-chat', message: 'First question', windowId: null });
  await Promise.resolve(); finish[0]({ text: 'First response', totalTokens: 10 });
  assert.equal((await original).status, 'complete');
  advance(); service.arm('a', { ...config, detectorEnabled: true });
  let current = service.cancel('a', { requestId: 'original-tab-chat' });
  assert.equal(current.armed, true); assert.equal(current.detectorEnabled, true);
  const newer = service.chat('a', { requestId: 'new-tab-chat', message: 'New question', windowId: null });
  await Promise.resolve();
  const before = service.snapshot('a');
  current = service.cancel('a', { requestId: 'original-tab-chat' });
  assert.equal(current.pending, true); assert.equal(current.armed, true); assert.equal(current.detectorEnabled, true);
  assert.deepEqual(current.events, before.events); assert.deepEqual(current.reserved, before.reserved);
  assert.throws(() => service.cancel('a', { requestId: '' }), /valid requestId/);
  assert.throws(() => service.cancel('a', { requestId: 'new-tab-chat', extra: true }), /valid requestId/);
  current = service.cancel('a', { requestId: 'new-tab-chat' });
  assert.equal(current.armed, false); assert.equal(current.detectorEnabled, false);
  assert.equal((await newer).status, 'canceled');
  assert.deepEqual(service.snapshot('a').reserved, before.reserved);
  finish[1]({ text: 'Late response', totalTokens: 10 }); await Promise.resolve();
  assert.equal(service.snapshot('a').events.some(e => e.interpretation === 'Late response'), false);
});
