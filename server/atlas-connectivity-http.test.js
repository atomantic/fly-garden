import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAtlasConnectivityHttp } from './atlas-connectivity-http.js';
import { createAtlasHttp } from './atlas-http.js';

async function fixture(t, options={}) {
  const handler=createAtlasConnectivityHttp({atlasDirectory:'/atlas',graphDirectory:'/graphs',loadAtlasData:async()=>({}),...options});
  const points=createAtlasHttp({directory:'/atlas',load:async()=>{throw new Error('Unexpected point load');}});
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://localhost');
    if(await points(request,response,url.pathname)) return;
    if(!await handler(request,response,url)){response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  return (path,options)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,options);
}
const service=()=>({status:()=>({scanning:false}),sample:query=>({kind:'sample',query,retainedEdges:100,anatomicalContacts:250}),adjacency:async(id,query)=>({kind:'adjacency',selectedId:id,direction:query.direction,offset:query.offset,limit:query.limit})});

test('routes are lazy, strict, read-only and are not swallowed by the point handler',async t=>{
 const loads=[],atlasLoads=[];
 const request=await fixture(t,{loadAtlasData:async(...args)=>{atlasLoads.push(args);return {};},loadConnectivity:async(...args)=>{loads.push(args);return service();}});
 for(const path of ['/api/atlas/male-cns-v1/connectivity?limit=20001','/api/atlas/male-cns-v1/connectivity?limit=1&limit=2','/api/atlas/male-cns-v1/connectivity?density=1','/api/atlas/male-cns-v1/connectivity?limit=1e3','/api/atlas/male-cns-v1/adjacency?neuron=banc:v888/1','/api/atlas/male-cns-v1/adjacency?neuron=male-cns:v1.0/1&offset=-1','/api/atlas/male-cns-v1/adjacency?neuron=male-cns:v1.0/1&direction=sideways']) assert.equal((await request(path)).status,400,path);
 assert.equal((await request('/api/atlas/male-cns-v1/connectivity',{method:'POST'})).status,405);
 assert.equal((await request('/api/atlas/unknown/connectivity')).status,404);assert.equal(loads.length,0);
 const result=await(await request('/api/atlas/male-cns-v1/connectivity?limit=0')).json();assert.equal(result.available,true);assert.deepEqual(result.query,{density:1,maxEdges:0});
 const adjacency=await(await request('/api/atlas/male-cns-v1/adjacency?neuron=male-cns%3Av1.0%2F9007199254740993&offset=2&limit=3&direction=incoming')).json();
 assert.equal(adjacency.selectedId,'male-cns:v1.0/9007199254740993');assert.equal(adjacency.offset,2);assert.equal(adjacency.limit,3);
 assert.equal(loads.length,1);assert.deepEqual(loads[0].slice(0,2),['/graphs/malecns-v1/graph','male-cns:v1.0']);assert.deepEqual(atlasLoads[0],['/atlas/male-cns-v1','male-cns:v1.0']);
});
test('only one profile graph is cached and different-profile loads cannot overlap',async t=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve),calls=[];
 const request=await fixture(t,{loadConnectivity:async(directory,dataset)=>{calls.push(dataset);if(calls.length===1){entered();await new Promise(resolve=>release=resolve);}return service();}});
 const first=request('/api/atlas/male-cns-v1/connectivity');await started;
 assert.equal((await request('/api/atlas/banc-v888/connectivity')).status,409);assert.equal(calls.length,1);
 release();assert.equal((await first).status,200);
 assert.equal((await request('/api/atlas/banc-v888/connectivity')).status,200);
 assert.equal((await request('/api/atlas/male-cns-v1/connectivity')).status,200);
 assert.deepEqual(calls,['male-cns:v1.0','banc:v888','male-cns:v1.0']);
});
test('missing/corrupt sources stay explicit and generic, with recovery only on another explicit request',async t=>{
 let attempts=0;
 const request=await fixture(t,{loadConnectivity:async()=>{attempts++;if(attempts===1)throw new Error('/private/directory secret');return service();}});
 const response=await request('/api/atlas/male-cns-v1/connectivity');assert.equal(response.status,503);const body=await response.json();assert.equal(body.available,false);assert.doesNotMatch(JSON.stringify(body),/private|secret/);
 assert.equal((await request('/api/atlas/male-cns-v1/connectivity')).status,200);assert.equal(attempts,2);
});
test('client disconnect aborts adjacency and does not switch profiles during its scan',async t=>{
 let entered,aborted;const started=new Promise(resolve=>entered=resolve),canceled=new Promise(resolve=>aborted=resolve);let scanning=false;
 const request=await fixture(t,{loadConnectivity:async()=>({...service(),status:()=>({scanning}),adjacency:async(id,{signal})=>{
   scanning=true;entered();try{await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true}));}finally{scanning=false;}
 }})});
 const controller=new AbortController(),first=request('/api/atlas/male-cns-v1/adjacency?neuron=male-cns:v1.0/1',{signal:controller.signal});
 await started;assert.equal((await request('/api/atlas/banc-v888/connectivity')).status,409);controller.abort();await assert.rejects(first,e=>e.name==='AbortError');
 await Promise.race([canceled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Server did not cancel scan')),1000))]);
});
