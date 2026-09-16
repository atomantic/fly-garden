import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeLatency,summarizeHeap} from '../client/src/atlas-performance-evidence.js';
test('latency samples reduce to min, median and max, with an even-count median averaged',()=>{
 assert.deepEqual(summarizeLatency([4,1,3,2]),{count:4,minMs:1,medianMs:2.5,maxMs:4});
 assert.deepEqual(summarizeLatency([5,1,3]),{count:3,minMs:1,medianMs:3,maxMs:5});
 assert.deepEqual(summarizeLatency([0]),{count:1,minMs:0,medianMs:0,maxMs:0});
});
test('a missing, negative or non-numeric timing can never become a published figure',()=>{
 for(const samples of [[],[NaN],[-1],[Infinity],['2'],[null],2,null,new Array(10001).fill(1)])assert.throws(()=>summarizeLatency(samples));
});
test('the peak heap figure is the highest reading actually returned',()=>{
 const result=summarizeHeap([{label:'before load',usedBytes:10},{label:'atlas loaded',usedBytes:90},{label:'connections',usedBytes:40}]);
 assert.equal(result.available,true);assert.deepEqual(result.peak,{label:'atlas loaded',usedBytes:90});assert.deepEqual(result.unmeasured,[]);
});
test('a heap reading the browser refused is reported unmeasured, never as zero bytes',()=>{
 const partial=summarizeHeap([{label:'before load',usedBytes:null},{label:'atlas loaded',usedBytes:90}]);
 assert.equal(partial.available,true);assert.deepEqual(partial.peak,{label:'atlas loaded',usedBytes:90});assert.deepEqual(partial.unmeasured,['before load']);
 const none=summarizeHeap([{label:'before load',usedBytes:null},{label:'atlas loaded',usedBytes:null}]);
 assert.equal(none.available,false);assert.equal(none.peak,null);assert.match(none.reason,/unmeasured, not zero/);
 assert.deepEqual(none.unmeasured,['before load','atlas loaded']);
});
test('a zero-byte, fractional or unlabelled heap reading is rejected rather than published',()=>{
 for(const readings of [[],[{label:'x',usedBytes:0}],[{label:'x',usedBytes:1.5}],[{label:'',usedBytes:1}],[{usedBytes:1}],[null],{},null])assert.throws(()=>summarizeHeap(readings));
});
