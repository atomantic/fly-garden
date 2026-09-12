import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaLanguageProvider } from './ollama-language-provider.js';
import { createLanguageGate, LANGUAGE_DISCLOSURE } from './language-gate.js';
const options = { enabled: true, model: 'local-test:1', verifiedLocalNonThinkingModel: true, verifiedByteTokenBound: true };
const payload = () => ({ individualId:'a', sessionId:'s',kind:'caretaker',message:'Explain observations.',
  evidence:{individualId:'a',sessionId:'s',namespace:'synthetic',modelId:'fixture',source:'live',startMs:0,endMs:10,meanRateHz:2,spikeCount:1,eventIds:[]},
  detector:null,disclosure:LANGUAGE_DISCLOSURE,maxTotalTokens:4096,maxOutputTokens:512 });
const result = () => ({model:'local-test:1',done:true,done_reason:'stop',response:'Uncertain interpretation.',prompt_eval_count:300,eval_count:10});
const response = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('disabled construction does not fetch and enabled construction requires local verified configuration', () => {
  let calls=0;
  assert.equal(createOllamaLanguageProvider({fetchImpl:()=>calls++}),null);
  for(const endpoint of ['https://127.0.0.1:11434','http://localhost:11434','http://remote.example','http://127.0.0.1/path','http://user:pass@127.0.0.1']) {
    assert.throws(()=>createOllamaLanguageProvider({...options,endpoint}));
  }
  assert.throws(()=>createOllamaLanguageProvider({...options,verifiedByteTokenBound:false}));
  assert.throws(()=>createOllamaLanguageProvider({...options,verifiedLocalNonThinkingModel:false}));
  assert.throws(()=>createOllamaLanguageProvider({...options,model:'model:cloud'}));
  createOllamaLanguageProvider({...options,fetchImpl:()=>calls++});
  assert.equal(calls,0);
});
test('local generation fixes endpoint/options, retains usage and fits zero-spend gate', async () => {
  let sent;
  const provider=createOllamaLanguageProvider({...options,fetchImpl:async(url,request)=>{sent={url,request};return response(result());}});
  assert.equal(provider.requestSpendMicros,0);
  const gate=createLanguageGate({providers:[provider],aggregateSpendMicros:0});
  gate.register('a','s');gate.arm('a',{providerId:'ollama-local',model:'local-test:1',maxCalls:1,maxTokens:4096,maxSpendMicros:0,cooldownMs:1000,detectorThresholdHz:1});
  const interpreted=await gate.request('a',{kind:'caretaker',requestId:'r',message:'Explain.',evidence:payload().evidence});
  assert.equal(interpreted.status,'complete');assert.equal(sent.url,'http://127.0.0.1:11434/api/generate');
  const body=JSON.parse(sent.request.body);
  assert.equal(body.raw,true);assert.equal(body.stream,false);assert.equal(body.think,false);assert.equal(body.keep_alive,0);
  assert.deepEqual(body.options,{num_predict:512,num_ctx:4096,draft_num_predict:0});
  assert.equal(sent.request.redirect,'error');assert.equal(Object.hasOwn(body,'tools'),false);
  assert.equal(gate.snapshot('a').reserved.spendMicros,0);
});
test('redirect, truncated, hidden thinking, malformed and oversized responses are rejected', async () => {
  for(const fetchImpl of [
    async()=>new Response('',{status:302,headers:{location:'https://remote.example'}}),
    async()=>response({...result(),done_reason:'length'}),async()=>response({...result(),thinking:'hidden'}),
    async()=>response({...result(),eval_count:513}),async()=>response({...result(),prompt_eval_count:5000}),
    async()=>response({...result(),tool_calls:[]}),async()=>response({...result(),response:'<think>text'}),
    async()=>new Response('{',{headers:{'content-type':'application/json'}}),
    async()=>new Response('x'.repeat(32769),{headers:{'content-type':'application/json'}}),
    async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'32769'}}),
  ]) {
    const provider=createOllamaLanguageProvider({...options,fetchImpl});
    await assert.rejects(provider.generate(payload()),/failed validation/);
  }
});
test('response byte cap cancels chunked transport and cancellation prevents dispatch', async () => {
  let canceled=false;
  const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(16384));},cancel(){canceled=true;}});
  const provider=createOllamaLanguageProvider({...options,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json'}})});
  await assert.rejects(provider.generate(payload()));assert.equal(canceled,true);
  let calls=0;
  const canceledProvider=createOllamaLanguageProvider({...options,fetchImpl:async()=>{calls++;return response(result());}});
  const controller=new AbortController();controller.abort();
  await assert.rejects(canceledProvider.generate(payload(),{signal:controller.signal}));assert.equal(calls,0);
});
test('transport abort cancels a stalled body and hostile payload cannot supply tools or credentials', async () => {
  let canceled=false,calls=0;
  const provider=createOllamaLanguageProvider({...options,fetchImpl:async()=>{
    calls++;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':'application/json'}});
  }});
  await assert.rejects(provider.generate({...payload(),secret:'private'}));assert.equal(calls,0);
  const controller=new AbortController();
  const pending=provider.generate(payload(),{signal:controller.signal});
  await Promise.resolve();controller.abort();
  await assert.rejects(pending,/canceled/);assert.equal(canceled,true);
});
