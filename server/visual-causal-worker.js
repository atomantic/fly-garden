import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {loadConnectome} from './connectome-data.js';
import {createSparseLif} from './sparse-lif.js';
import {createOnsetEpisode,ONSET_CONFIG} from './visual-onset.js';
import {runCausalTrial,causalHash} from './visual-causal-trial.js';
if(parentPort){
 try{
  const {dataset,directory,condition}=workerData,name=dataset==='male-cns:v1.0'?'male-cns-v1':dataset==='banc:v888'?'banc-v888':null;
  if(!name)throw new Error('Unsupported dataset');
  const mapping=JSON.parse(readFileSync(new URL(`../connectome/visual-mappings/${name}.json`,import.meta.url)));
  const {graph,manifest,manifestSha256}=await loadConnectome(directory,dataset);
  const kernel=createSparseLif(graph,{dataset,individualId:randomUUID()});kernel.inspectIds=graph.ids;
  if(mapping.graphManifestSha256!==manifestSha256||mapping.graphSha256!==kernel.graphSha256)throw new Error('Mapping graph mismatch');
  const result=await runCausalTrial({kernel,episode:createOnsetEpisode(mapping),mapping,condition});
  parentPort.postMessage({ok:true,result:{...result,dataset,graphSha256:kernel.graphSha256,graphManifestSha256:manifestSha256,annotationSha256:mapping.annotationSha256,mappingSha256:mapping.mappingSha256,config:ONSET_CONFIG,configSha256:causalHash(ONSET_CONFIG),neuronCount:manifest.neuronCount,edgeCount:manifest.edgeCount}});
 }catch{parentPort.postMessage({ok:false,reason:'Graph, mapping, numerical or continuation validation failed; run incomplete.'});}
}
