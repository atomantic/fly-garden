/** Separate pure v2 hypothesis. No graph loading, worker authority or neural execution. */
import { createVisualEncoder } from './visual-mapping.js';
export const ONSET_CONFIG=Object.freeze({version:2,deltaVPerFullContrast:1.25,maxPortsPerFrame:4000,maxDeltaVPerFrame:5000,maxNonzeroFrames:8,maxDeltaVPerEpisode:40000,maxTicks:200,frameIntervalTicks:20,pulseTicks:1});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=message=>{throw new Error(message);};
/** One object is one nonrefundable episode. A future controller owns creation authority. */
export function createOnsetEpisode(mapping){
  createVisualEncoder(mapping); // Apply v1's pinned source/graph/port validation, without input.
  const m=structuredClone(mapping);let armed=false,previous=null,pending=[],ticks=0,lastFrame=-1,lastFrameTick=-20,nonzeroFrames=0,totalDeltaV=0;
  const exhausted=()=>ticks>=200||nonzeroFrames>=8||totalDeltaV>=40000;
  function snapshot(){return{version:2,mappingSha256:m.mappingSha256,validationStatus:'pure-characterization-only-no-full-graph-validation',armed,ticks,nonzeroFrames,totalDeltaV,pendingPorts:pending.length,lastFrameId:lastFrame,exhausted:exhausted(),config:{...ONSET_CONFIG}};}
  function reset(){previous=null;pending=[];armed=false;return snapshot();}
  function arm(){if(exhausted())fail('Episode budget exhausted; arm cannot refund it');armed=true;return snapshot();}
  function accept(frame){
    if(!armed||ticks>=200||!exact(frame,['frameId','width','height','pixels'])||!Number.isSafeInteger(frame.frameId)||frame.frameId<=lastFrame||frame.width!==32||frame.height!==16||!Array.isArray(frame.pixels)||frame.pixels.length!==512||!frame.pixels.every(v=>Number.isFinite(v)&&v>=0&&v<=1))fail('Invalid or inactive onset frame');
    if(ticks-lastFrameTick<20||pending.length)fail('Onset frame cadence or pending impulse');
    const pixels=[...frame.pixels],difference=pixels.map((v,i)=>previous===null?0:v-previous[i]),means={left:0,right:0};
    for(let y=0;y<16;y++)for(let x=0;x<32;x++)means[x<16?'left':'right']+=difference[y*32+x]/256;
    const next=[];let sum=0;
    for(const port of m.inputs){let contrast=means[port.side];
      if(port.hex){const[q,r]=port.hex,u=(q-1+0.5*(r-1))/54,v=(r-1)/38;const x=Math.min(15,Math.floor(u*16))+(port.side==='right'?16:0),y=Math.min(15,Math.floor(v*16));contrast=difference[y*32+x];}
      const deltaV=Math.min(1.25,1.25*Math.max(0,port.type==='L1'?contrast:-contrast));
      if(deltaV>0){next.push({neuronId:port.neuronId,deltaV});sum+=deltaV;}
    }
    if(next.length>4000||sum>5000||next.length&&(nonzeroFrames>=8||totalDeltaV+sum>40000))fail('Onset episode/frame budget exceeded');
    // Reserve before returning. Dropping/resetting an admitted impulse never refunds it.
    previous=pixels;lastFrame=frame.frameId;lastFrameTick=ticks;pending=next;
    if(next.length){nonzeroFrames++;totalDeltaV+=sum;}
    return snapshot();
  }
  function tick(){
    if(!armed)return[];
    if(ticks>=200){armed=false;pending=[];return[];}
    const result=pending;pending=[];ticks++;
    if(ticks>=200)armed=false;
    return result;
  }
  return{snapshot,arm,accept,tick,reset,disarm:reset};
}
