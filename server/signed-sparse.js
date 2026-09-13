import {createHash,randomUUID} from 'node:crypto';
export const SIGNED_MODEL=Object.freeze({id:'tiny-signed-contract-v1',alpha:1/8,rho:3/4,inputScale:1/4,beta:1/16,dtMs:1,frameTicks:20,tolerance:1e-12,maxNodes:16,maxEdges:32,maxUpdates:288});
export const SIGNED_DISCLOSURE='Engineered dimensionless signed deviation; not voltage, spikes, firing rate, biological fit, learning or validated body control.';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join()===keys.slice().sort().join();
const dense=v=>Array.isArray(v)&&Array.from({length:v.length},(_,i)=>Object.hasOwn(v,i)).every(Boolean);
const denseTree=v=>!Array.isArray(v)||(dense(v)&&v.every(denseTree));
const uint=x=>Number.isSafeInteger(x)&&x>=0;
const vector=(v,n,b)=>dense(v)&&v.length===n&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=b);
function requireValue(ok){if(!ok)throw new Error('Invalid bounded signed candidate data');}
/** Tiny synthetic graphs only. No filesystem, graph loader, timer or application authority. */
export function createSignedSparse(input){
 requireValue(exact(input,['ids','edges','signs','mapping','outputs'])&&Object.values(input).every(denseTree)&&input.mapping.every(m=>denseTree(m.pixels)));
 const g=structuredClone(input),n=g.ids?.length;
 requireValue(n>1&&n<=16&&g.ids.every(x=>typeof x==='string'&&/^tiny:[a-z0-9-]{1,48}$/.test(x))&&new Set(g.ids).size===n);
 requireValue(Array.isArray(g.edges)&&g.edges.length<=32&&Array.isArray(g.signs)&&g.signs.length===n&&g.signs.every(x=>[-1,0,1].includes(x)));
 requireValue(Array.isArray(g.mapping)&&g.mapping.length<=n&&Array.isArray(g.outputs)&&g.outputs.length===2&&g.outputs.every(x=>uint(x)&&x<n)&&g.outputs[0]!==g.outputs[1]);
 const sums=Array(n).fill(0);let prior=-1;
 for(const e of g.edges){requireValue(Array.isArray(e)&&e.length===3&&e.every(uint)&&e[0]<n&&e[1]<n&&e[2]>0&&e[0]>=prior);prior=e[0];sums[e[1]]+=e[2];requireValue(Number.isSafeInteger(sums[e[1]]));}
 const denominator=sums.map(x=>Math.max(1,x)),rows=Array(n).fill(0);
 for(const [i,j,w]of g.edges)rows[j]+=Math.abs(g.signs[i])*w/denominator[j];
 requireValue(rows.every(x=>x<=1+SIGNED_MODEL.tolerance));
 const mapped=new Set();for(const m of g.mapping){requireValue(exact(m,['node','pixels'])&&uint(m.node)&&m.node<n&&!mapped.has(m.node)&&Array.isArray(m.pixels)&&m.pixels.length>0&&m.pixels.length<=512&&m.pixels.every(x=>uint(x)&&x<512)&&new Set(m.pixels).size===m.pixels.length);mapped.add(m.node);}
 const operatorHash=hash({g,denominator,model:SIGNED_MODEL,normalization:'incoming-contact-v1'});
 let x=Array(n).fill(0),b=Array(512).fill(0),z=0,tick=0,frame=null,remaining=0,frameId=0,acceptedFrames=0,sessionId=randomUUID(),running=false,actualUpdates=0;
 const checkpoint=()=>structuredClone({schema:'tiny-signed-checkpoint-v1',operatorHash,model:SIGNED_MODEL,ids:g.ids,tick,x,b,z,frame,frameHash:frame===null?null:hash(frame),remaining,frameId,acceptedFrames});
 const snapshot=()=>({...checkpoint(),sessionId,running,actualUpdates,yawProxy:running ? .25*z : 0,forwardSpeed:0,disclosure:SIGNED_DISCLOSURE});
 return {
  snapshot,checkpoint,operator:()=>structuredClone({operatorHash,denominator,graph:g}),
  start(){requireValue(actualUpdates<288&&tick<288);running=true;return snapshot();},pause(){running=false;return snapshot();},
  acceptFrame(id,pixels){try{requireValue(uint(id)&&id>frameId&&remaining===0&&dense(pixels)&&pixels.length===512&&pixels.every(v=>Number.isFinite(v)&&v>=.25&&v<=.75));frame=pixels.slice();frameId=id;acceptedFrames++;remaining=20;return snapshot();}catch(error){running=false;throw error;}},
  step(){try{requireValue(running&&remaining>0&&actualUpdates<288&&tick<288);const c=frame.map(v=>(v-.5)/.5),p=Array(n).fill(0),u=Array(n).fill(0);
   for(const[i,j,w]of g.edges)p[j]+=g.signs[i]*w/denominator[j]*x[i];
   for(const m of g.mapping)u[m.node]=-.25*m.pixels.reduce((sum,k)=>sum+c[k]-b[k],0)/m.pixels.length;
   const next=x.map((v,i)=>.875*v+.125*Math.tanh(.75*p[i]+u[i]));
   const nextB=b.map((v,i)=>.9375*v+.0625*c[i]),nextZ=.875*z+.125*(next[g.outputs[1]]-next[g.outputs[0]])/2;requireValue(vector(next,n,1)&&vector(nextB,512,.5)&&Number.isFinite(nextZ)&&Math.abs(nextZ)<=1);x=next;b=nextB;z=nextZ;tick++;actualUpdates++;remaining--;if(actualUpdates===288||tick===288)running=false;return snapshot();}catch(error){running=false;throw error;}
  },
  restore(value){const v=structuredClone(value);requireValue(exact(v,['schema','operatorHash','model','ids','tick','x','b','z','frame','frameHash','remaining','frameId','acceptedFrames'])&&v.schema==='tiny-signed-checkpoint-v1'&&v.operatorHash===operatorHash&&hash(v.model)===hash(SIGNED_MODEL)&&hash(v.ids)===hash(g.ids)&&uint(v.tick)&&v.tick<=288&&vector(v.x,n,1)&&vector(v.b,512,.5)&&Number.isFinite(v.z)&&Math.abs(v.z)<=1&&uint(v.frameId)&&uint(v.remaining)&&v.remaining<=20&&uint(v.acceptedFrames)&&v.acceptedFrames<=15&&v.frameId>=v.acceptedFrames&&(v.frameId===0)===(v.acceptedFrames===0)&&v.tick+v.remaining===20*v.acceptedFrames&&v.frameHash===(v.frame===null?null:hash(v.frame)));
   requireValue(v.frameId===0?(v.tick===0&&v.frame===null&&v.remaining===0&&v.x.every(q=>q===0)&&v.b.every(q=>q===0)&&v.z===0):(dense(v.frame)&&v.frame.length===512&&v.frame.every(q=>Number.isFinite(q)&&q>=.25&&q<=.75)&&(v.tick+v.remaining)%20===0));
   ({x,b,z,tick,frame,remaining,frameId,acceptedFrames}=v);running=false;sessionId=randomUUID();return snapshot();
  }
 };
}
