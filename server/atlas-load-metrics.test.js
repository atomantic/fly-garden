import test from 'node:test';import assert from 'node:assert/strict';
import {atlasLoadMetrics,matchingAtlasLoadMetrics} from '../client/src/atlas-load-metrics.js';
const input={profile:'male-cns-v1',startedAt:10,assetsReadyAt:25,finishedAt:30,declaredBytes:128,receivedBytes:128};
test('elapsed phases partition successful total; decoded counts preserve declared extent',()=>{
 const metrics=atlasLoadMetrics(input);assert.equal(metrics.elapsedMs,20);assert.equal(metrics.metadataAndAssetsMs,15);assert.equal(metrics.parseAndValidationMs,5);assert.equal(metrics.receivedAssetBytes,128);
 assert.equal(atlasLoadMetrics({...input,assetsReadyAt:10,finishedAt:10}).elapsedMs,0);
});
test('invalid clocks and incomplete or excessive assets cannot publish a success metric',()=>{
 for(const change of [{startedAt:NaN},{assetsReadyAt:9},{finishedAt:24},{receivedBytes:127},{declaredBytes:0,receivedBytes:0},{declaredBytes:2**30,receivedBytes:2**30},{profile:'fixture'}])assert.throws(()=>atlasLoadMetrics({...input,...change}));
});
test('profile changes and cleared/failed loads cannot display previous profile measurements',()=>{
 const loadMetrics=atlasLoadMetrics(input),data={profile:input.profile,loadMetrics};assert.equal(matchingAtlasLoadMetrics(data,input.profile),loadMetrics);
 assert.equal(matchingAtlasLoadMetrics(data,'banc-v888'),null);assert.equal(matchingAtlasLoadMetrics(null,input.profile),null);assert.equal(matchingAtlasLoadMetrics({profile:input.profile},input.profile),null);
 assert.equal(matchingAtlasLoadMetrics({...data,loadMetrics:{...loadMetrics,profile:'banc-v888'}},input.profile),null);
});
