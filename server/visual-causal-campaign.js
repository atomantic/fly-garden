import {Worker} from 'node:worker_threads';
import {CAUSAL_CONDITIONS} from './visual-causal-trial.js';
const DATASETS=['male-cns:v1.0','banc:v888'];
function worker(entry){const worker=new Worker(new URL('./visual-causal-worker.js',import.meta.url),{workerData:entry});const promise=new Promise((resolve,reject)=>{worker.once('message',value=>value.ok?resolve(value.result):reject(new Error(value.reason)));worker.once('error',()=>reject(new Error('Trial worker failed')));worker.once('exit',()=>reject(new Error('Trial worker exited before result')));});return{promise,terminate:()=>worker.terminate()};}
/** One worker at a time; fixed complete campaign ceiling, no retries or adjustable gains. */
export async function runCausalCampaign(directories,{spawn=worker,rss=()=>process.memoryUsage().rss,now=()=>performance.now()}={}){
 if(!directories||Object.keys(directories).length!==2||!DATASETS.every(d=>typeof directories[d]==='string'&&directories[d]))throw new Error('Two explicit dataset directories required');
 const start=now(),results=[];let active=null,peak=0,rejectLimit;
 const limit=new Promise((_,reject)=>{rejectLimit=reject;});limit.catch(()=>{});
 function check(){peak=Math.max(peak,rss());if(!Number.isFinite(peak)||peak>2*1024**3||now()-start>=120000)throw new Error('Fixed campaign memory/deadline exceeded');}
 const monitor=setInterval(()=>{try{check();}catch(e){rejectLimit(e);}},10);
 try{
  for(const dataset of DATASETS)for(const condition of CAUSAL_CONDITIONS){
   check();active=spawn({dataset,directory:directories[dataset],condition});
   const result=await Promise.race([active.promise,limit]);check();
   if(result.executedSteps!==200||result.finalClockTicks!==180||result.condition!==condition||result.dataset!==dataset||result.restoredPaused!==true)throw new Error('Trial report mismatch');
   await active.terminate();check();active=null;results.push(result);
  }
  return{schemaVersion:1,status:'completed-fixed-campaign',executedSteps:1600,runCount:8,results,sampledPeakRssBytes:peak,totalWallMs:now()-start,maxMemoryBytes:2*1024**3,maxWallMs:120000,retries:0};
 }catch{return{schemaVersion:1,status:'incomplete',completedRuns:results.length,results,sampledPeakRssBytes:peak,reason:'Fixed campaign validation or resource bound failed; no retry performed.'};}
 finally{clearInterval(monitor);if(active)await active.terminate();}
}
