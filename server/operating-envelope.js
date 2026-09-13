/** Explicit research orchestration only: no timers advance neural state. */
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { openConnectomeBackend } from './connectome.js';
import { connectomeProfile } from './connectome-profiles.js';
export function validateEnvelopeOptions(entries,{steps=1000,batchSteps=100,maxMemoryMiB=2048,timeoutSeconds=120}={}) {
  if(!Array.isArray(entries)||entries.length<1||entries.length>2||new Set(entries.map(e=>e.dataset)).size!==entries.length)throw new Error('Provide one or two distinct dataset/path pairs');
  for(const entry of entries){connectomeProfile(entry.dataset);if(typeof entry.directory!=='string'||!entry.directory)throw new Error('Explicit graph directory required');}
  if(!Number.isSafeInteger(steps)||steps<1||steps>10000||!Number.isSafeInteger(batchSteps)||batchSteps<1||batchSteps>1000||batchSteps>steps)throw new Error('Steps must be 1–10000 and batch size 1–1000 within steps');
  if(!Number.isSafeInteger(maxMemoryMiB)||maxMemoryMiB<256||maxMemoryMiB>2048||!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>120)throw new Error('Bounds must be 256–2048 MiB and 1–120 seconds');
  return{steps,batchSteps,maxMemoryMiB,timeoutSeconds};
}
export async function measureOperatingEnvelope(entries,options={},dependencies={}) {
  const config=validateEnvelopeOptions(entries,options),open=dependencies.openBackend??openConnectomeBackend,
    rss=dependencies.rss??(()=>process.memoryUsage().rss),now=dependencies.now??(()=>performance.now());
  const start=now(),baselineRssBytes=rss(),cpuStart=process.cpuUsage(),handles=new Set(),residents=[],individualIds=entries.map(()=>randomUUID());
  let peak=baselineRssBytes,rejectLimit,limitError=null;
  const limit=new Promise((_,reject)=>{rejectLimit=reject;});limit.catch(()=>{});
  function check(){peak=Math.max(peak,rss());if(!Number.isFinite(peak)||peak>config.maxMemoryMiB*1024**2||now()-start>=config.timeoutSeconds*1000){if(!limitError){limitError=new Error('Operating envelope memory or wall deadline exceeded');rejectLimit(limitError);dependencies.onLimit?.(limitError);}throw limitError;}}
  const sampler=setInterval(()=>{try{check();}catch{}},10);
  const wait=async promise=>{check();const value=await Promise.race([promise,limit]);check();return value;};
  async function load(index,checkpoint=null){check();const opening=open(entries[index].directory,{dataset:entries[index].dataset,individualId:individualIds[index],checkpoint});handles.add(opening);const backend=await wait(opening);handles.delete(opening);handles.add(backend);if(!backend.ready.available||backend.ready.status!=='paused')throw new Error('Pinned graph unavailable or startup not paused');return backend;}
  function verify(state,index,tick,status){if(state.individualId!==individualIds[index]||state.status!==status||state.neural.tick!==tick||state.neural.simTimeMs!==tick*state.model.dtMs||state.neural.totalSpikes!==0||state.neural.traversedEdges!==0)throw new Error('Zero-drive clock, identity or pause contract violated');}
  try{
    check();for(let i=0;i<entries.length;i++){const backend=await load(i);verify(backend.ready,i,0,'paused');residents.push(backend);}
    const loadWallMs=now()-start,loadedRssBytes=rss();
    await wait(Promise.all(residents.map((b,i)=>b.start().then(s=>verify(s,i,0,'running')))));
    const steppingStart=now(),batches=[];
    for(let tick=0;tick<config.steps;){const count=Math.min(config.batchSteps,config.steps-tick),begin=now();const states=await wait(Promise.all(residents.map(b=>b.advance(count))));tick+=count;states.forEach((s,i)=>verify(s,i,tick,'running'));batches.push({completedStepsPerResident:tick,wallMs:now()-begin});}
    const steppingWallMs=now()-steppingStart;
    const paused=await wait(Promise.all(residents.map(b=>b.pause())));paused.forEach((s,i)=>verify(s,i,config.steps,'paused'));
    // Serialize the selected temporary state, destroy workers, and reopen from those exact checkpoints.
    const checkpoints=[];for(const backend of residents)checkpoints.push(JSON.stringify(await wait(backend.checkpoint())));
    const checkpointJsonBytes=checkpoints.map(text=>Buffer.byteLength(text));check();
    await wait(Promise.all(residents.map(b=>b.close())));for(const b of residents)handles.delete(b);
    const restartStart=now(),restarted=[];
    for(let i=0;i<entries.length;i++){const b=await load(i,JSON.parse(checkpoints[i]));verify(b.ready,i,config.steps,'paused');if(b.ready.sessionEpoch===paused[i].sessionEpoch||b.ready.graphSha256!==paused[i].graphSha256)throw new Error('Restart did not preserve graph and rotate command epoch');restarted.push(b.ready);}
    const restartWallMs=now()-restartStart;check();const cpu=process.cpuUsage(cpuStart);
    return{schemaVersion:1,status:'measured-zero-drive',residentCount:entries.length,config,baselineRssBytes,loadedRssBytes,sampledPeakRssBytes:peak,
      measuredIncrementBytes:Math.max(0,peak-baselineRssBytes),loadWallMs,steppingWallMs,restartWallMs,totalWallMs:now()-start,
      simulatedMsPerResident:config.steps*paused[0].model.dtMs,simulatedToWallRatioPerResident:config.steps*paused[0].model.dtMs/steppingWallMs,
      cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,checkpointJsonBytes,batches,
      residents:restarted.map(s=>({individualId:s.individualId,graphSha256:s.graphSha256,provenance:s.provenance,model:s.model,statusAfterRestart:s.status,neuralAfterRestart:s.neural})),
      probesApplied:0,drive:'zero',configuredCapacityChanged:false,
      limitations:'Zero-drive isolated research workers only: no sensory inputs, probes, rewards, renderer, active-edge stress, behavior or learning. Pair batches wait for both workers; ratio uses time per individual, not summed clocks. Sampled process-wide RSS is not summed across threads and can miss transient peaks. These measurements do not grant capacity or establish real-time interactive performance.'};
  }finally{clearInterval(sampler);await Promise.allSettled([...handles].map(h=>h.terminate?h.terminate():h.close()));}
}
