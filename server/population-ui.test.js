import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {readPopulation,populationRequestCurrent} from '../client/src/population-state.js';import {capacitySnapshot} from './population-capacity.js';
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
test('historical UI evidence matches published workload reports without temporary identities or full traces',()=>{
 const summary=json('../client/src/population-evidence.json'),zero=json('../connectome/operating-envelope-result.json'),active=json('../connectome/visual-causal-result.json');
 assert.equal(summary.measuredDate,zero.measuredDate);
 for(const [key,value] of Object.entries(summary.zeroDrive.environment))assert.equal(value,zero.runs[0][key]);
 for(const run of summary.zeroDrive.runs){const source=zero.runs.find(r=>r.scenario===run.scenario);for(const [key,value] of Object.entries(run))assert.deepEqual(value,key==='models'?[...new Set(source.residents.map(r=>r.model.id))]:source[key]);assert(source.residents.every(r=>r.neuralAfterRestart.totalSpikes===0&&r.neuralAfterRestart.traversedEdges===0));}
 for(const [key,value] of Object.entries(summary.activeEdge)){if(key!=='runs')assert.equal(value,active[key]);}
 for(const run of summary.activeEdge.runs){const source=active.results.find(r=>r.dataset===run.dataset&&r.condition===run.condition);for(const [key,value] of Object.entries(run))assert.equal(value,key==='model'?source.model.id:['totalSpikes','traversedEdges'].includes(key)?source.trace.at(-1)[key]:source[key]);}
 assert(summary.activeEdge.runs.every(r=>!r.downstreamResponseObserved&&!r.yawObserved));assert(!JSON.stringify(summary).includes('individualId'));assert(!JSON.stringify(summary).includes('"trace":'));assert(readFileSync(new URL('../client/src/population-evidence.json',import.meta.url)).length<10000);
 const changed=summary.activeEdge.runs.filter(r=>r.condition==='changed-left-half-onset');assert.deepEqual(changed.map(r=>[r.totalSpikes,r.traversedEdges]),[[875,13333],[716,11614]]);
});
test('current capacity schema preserves unknown resources and refuses invented status',()=>{
 const value=capacitySnapshot({residents:[],savedCount:2});assert.equal(readPopulation(value).aggregateMemoryBytes,null);
 for(const invalid of [{...value,residentCount:-1},{...value,pressure:'measured-safe'},{...value,aggregateMemoryBytes:Infinity},{...value,settings:{...value.settings,maxResidentFlies:0}}])assert.throws(()=>readPopulation(invalid));
});
test('polls before a save and replies after unmount cannot replace current settings',()=>{
 const live={generation:0,stopped:false};assert(populationRequestCurrent(0,live));live.generation++;assert(!populationRequestCurrent(0,live));assert(populationRequestCurrent(1,live));live.stopped=true;assert(!populationRequestCurrent(1,live));
});
