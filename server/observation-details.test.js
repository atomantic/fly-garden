import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appendRateObservation,ratePoints,relatedObservations} from '../client/src/observation-details.js';
const state={individualId:'a',sessionId:'session',simTimeMs:5,neural:{meanRateHz:12},events:[{id:1,timeMs:5,type:'policy',message:'Receipt'}]};
test('rate history uses exact simulation timestamps, skips pause repeats and stale values, resets on source change',()=>{
 const first=appendRateObservation([],state);assert.equal(appendRateObservation(first,state),first);
 assert.equal(appendRateObservation(first,{...state,simTimeMs:0}),first);
 const rows=appendRateObservation(first,{...state,simTimeMs:105});assert.equal(rows.length,2);assert.match(ratePoints(rows),/^0,.* 600,/);
 assert.equal(appendRateObservation(rows,{...state,sessionId:'new'}).length,1);
 assert.equal(appendRateObservation(rows,{...state,individualId:'b'}).length,1);
 assert.equal(appendRateObservation(rows,{...state,simTimeMs:110,neural:{meanRateHz:NaN}}),rows);
 let bounded=[];for(let i=0;i<60;i++)bounded=appendRateObservation(bounded,{...state,simTimeMs:i});assert.equal(bounded.length,50);
});
test('event links require exact recipient/session/time and declared action reference; absent is explicit null/empty',()=>{
 const source={...state,environmentAdapter:{lastTrace:{individualId:'a',sessionId:'session',inputSimTimeMs:0,outputSimTimeMs:5}},encounterDynamics:{individualId:'a',sessionId:'session',events:[{simTimeMs:5},{simTimeMs:6}]}};
 const action={id:'move',individualId:'a',sessionId:'session',simulationTimeMs:5};
 const artifact={source:{actions:[action,{...action,id:'wrong',individualId:'b'}]},events:[{sourceActionId:'move',individualId:'a',sessionId:'session'},{sourceActionId:'wrong',individualId:'a',sessionId:'session'}]};
 const evidence={individualId:'a',sessionId:'session',evidence:{startMs:0,endMs:5}};
 const result=relatedObservations(source,state.events[0],artifact,{events:[evidence,{...evidence,sessionId:'old'}]});
 assert.equal(result.actions.length,1);assert.equal(result.artifacts.length,1);assert.equal(result.interpretations.length,1);assert.equal(result.chemistry.length,1);assert.ok(result.sensoryMotor);
 const missing=relatedObservations(state,state.events[0]);assert.equal(missing.sensoryMotor,null);assert.deepEqual(missing.actions,[]);
 assert.throws(()=>relatedObservations(state,{id:2,timeMs:5}));
});
test('event detail is GET-only and guards asynchronous replies against source and generation changes',()=>{
 const source=readFileSync(new URL('../client/src/EventDetails.jsx',import.meta.url),'utf8');
 assert.match(source,/fetch\(path,\{signal:controller.signal\}\)/);assert.doesNotMatch(source,/method:|\/chat|\/control|\/stimulat/);
 assert.match(source,/current.current===key&&generation.current===request/);assert.match(source,/observationScope\(confirmed\)!==key/);
});
