/** Explicit finite trial orchestration. Importing performs no simulation. */
import { createHash } from 'node:crypto';
import { createSteeringReadout } from './visual-mapping.js';
export const CAUSAL_CONDITIONS=Object.freeze(['unchanged-black','changed-left-half-onset','encoder-disconnected','motor-disconnected']);
export const causalHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function causalFrame(frameId,changed){return{frameId,width:32,height:16,pixels:Array.from({length:512},(_,i)=>changed&&i%32<16?1:0)};}
/** Caller owns graph/provenance validation. Tests use an explicitly tiny synthetic graph. */
export async function runCausalTrial({kernel,episode,mapping,condition}){
  if(!CAUSAL_CONDITIONS.includes(condition))throw new Error('Unsupported causal condition');
  const initial=kernel.checkpoint();if(initial.tick!==0||initial.totalSpikes!==0||initial.firing.some(Boolean)||initial.potential.some(v=>v!==0))throw new Error('Trial requires exact zero initial state');
  const index=new Map();const graphIds=kernel.inspectIds; // supplied by the private trial worker, never exposed to clients
  if(!Array.isArray(graphIds))throw new Error('Trial ID resolver missing');
  graphIds.forEach((id,i)=>index.set(id,i));
  const portIds=mapping.inputs.map(p=>p.neuronId);for(const id of [...portIds,...Object.values(mapping.motor)])if(!index.has(id))throw new Error('Mapping contains absent graph ID');
  const motorIds=[mapping.motor.left,mapping.motor.right],trace=[],frames=[];let executedSteps=0,status='paused',readout=createSteeringReadout();
  const flagsHistory=[];
  function inputSample(){let firing=0,min=Infinity,max=-Infinity;for(let i=0;i<portIds.length;i+=256){const samples=kernel.sample(portIds.slice(i,i+256)).samples;for(const s of samples){firing+=s.firing;min=Math.min(min,s.potential);max=Math.max(max,s.potential);}}return{sampledPortCount:portIds.length,firing,potentialMinimum:min,potentialMaximum:max};}
  const initialPortSample=inputSample();
  function explicitStart(){if(status!=='paused')throw new Error('Explicit trial start requires paused state');status='running';}
  async function step(inputs,branch){
    if(status!=='running'||executedSteps>=200)throw new Error('Trial execution budget exceeded');
    kernel.step(inputs);executedSteps++;
    const global=kernel.summary(),sample=kernel.sample(motorIds),flags={left:sample.samples[0].firing,right:sample.samples[1].firing};
    const raw=readout.tick(flags),motor=condition==='motor-disconnected'?{...raw,yawRadiansPerSecond:0}:raw;
    if(!Object.values(global).every(Number.isFinite)||motor.forwardSpeed!==0||!Number.isFinite(motor.yawRadiansPerSecond))throw new Error('Invalid trial numerical output');
    const row={branch,executedStep:executedSteps,...global,deliveredPorts:inputs.length,deliveredDeltaV:inputs.reduce((sum,input)=>sum+input.deltaV,0),dna02:flags,motor};
    if(global.tick===21||global.tick===160)row.inputPorts=inputSample();
    trace.push(row);flagsHistory.push(flags);
    if(executedSteps%20===0)await new Promise(resolve=>setImmediate(resolve));
    return row;
  }
  episode.arm();explicitStart();
  for(let tick=0;tick<160;tick++){
    if(tick%20===0){const frame=causalFrame(tick/20,tick>=20&&condition!=='unchanged-black');const admission=episode.accept(frame);frames.push({tick,frameId:frame.frameId,sha256:causalHash(frame),nonzeroFrames:admission.nonzeroFrames,totalDeltaV:admission.totalDeltaV});}
    const proposed=episode.tick(),inputs=condition==='encoder-disconnected'?[]:proposed.map(p=>({index:index.get(p.neuronId),deltaV:p.deltaV}));
    await step(inputs,'prefix');
  }
  status='paused';episode.disarm();const saved=kernel.checkpoint(),checkpointSha256=causalHash(saved),history=flagsHistory.slice(-100);
  explicitStart();const native=[];for(let i=0;i<20;i++)native.push(await step([],'native-continuation'));status='paused';const nativeFinalSha256=causalHash(kernel.checkpoint());
  kernel.restore(saved);status='paused';
  const restored=kernel.checkpoint();if(causalHash(restored)!==checkpointSha256||JSON.stringify(restored.model)!==JSON.stringify(initial.model))throw new Error('Checkpoint restoration mismatch');
  const restoredPaused=true;readout=createSteeringReadout();for(const flags of history)readout.tick(flags);
  explicitStart();const continuation=[];for(let i=0;i<20;i++)continuation.push(await step([],'restored-continuation'));status='paused';
  const normalized=rows=>rows.map(({branch,executedStep,...row})=>row);
  if(JSON.stringify(normalized(native))!==JSON.stringify(normalized(continuation))||causalHash(kernel.checkpoint())!==nativeFinalSha256)throw new Error('Restored continuation differs');
  if(executedSteps!==200||kernel.summary().tick!==180)throw new Error('Incorrect executed/unique clock accounting');
  return{condition,status:'completed-bounded-trial',model:initial.model,modelSha256:causalHash(initial.model),initialCheckpointSha256:causalHash(initial),checkpointSha256,nativeFinalSha256,restoredPaused,
    executedSteps,finalClockTicks:180,sharedPrefixTicks:160,continuationTicksPerBranch:20,episode:episode.snapshot(),frames,initialPortSample,trace,
    downstreamResponseObserved:trace.some(r=>r.dna02.left||r.dna02.right),yawObserved:trace.some(r=>r.motor.yawRadiansPerSecond!==0),
    interpretation:'Synthetic raster intervention and engineered input/readout only; no rendered body, natural control, learning or subjective inference.'};
}
