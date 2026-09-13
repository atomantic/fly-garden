/** Pure engineering foundation: no kernel, runtime, filesystem, timers or network. */
import { createHash } from 'node:crypto';
export const VISUAL_CONFIG = Object.freeze({width:32,height:16,totalDeltaVPerChannelPerTick:0.02,frameTicks:20,rateWindowTicks:100,maxYawRadiansPerSecond:0.5,rateScaleHz:100,forwardSpeed:0});
export const VISUAL_SOURCES = Object.freeze({
  'male-cns:v1.0':Object.freeze({graphManifestSha256:'12759115c299175db5afa38b4a94a9a702f19a4e453c2bebb7dfaa85e5a3b915',annotationSha256:'2177e246113e4cfbf1e7772ec37c6da1955ff22e8063d0b1f833101f99a9a3b2',graphSha256:'fa50e6e9add2a426f950cddc02b29b1c3dc267b98e1da33bf79cc1e5e1b3ce6a',motor:{left:'male-cns:v1.0/523769',right:'male-cns:v1.0/10360'}}),
  'banc:v888':Object.freeze({graphManifestSha256:'6d24b3d65b879c1d456fc48e2ac84e81ecae61fdf17749de0c58b3b9c1b5ac99',annotationSha256:'819bbcff476e52702d6f8d8604ce1f12d1d7b11942281df2f49df2a73a6f15a5',graphSha256:'b8e648ec2585061b91fb07ad22b33d41939e0b2c8b56e7f7dbf7d6f172025e99',motor:{left:'banc:v888/720575941510475536',right:'banc:v888/720575941456897005'}}),
});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw new Error('Invalid visual mapping or input');};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const visualDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const order=(a,b)=>a.neuronId<b.neuronId?-1:a.neuronId>b.neuronId?1:0;
/** Input rows come exclusively from the hash-verified metadata extractor. */
export function buildVisualMapping(source,graphManifestSha256) {
  if(!exact(source,['dataset','annotationSha256','rows'])||!Object.hasOwn(VISUAL_SOURCES,source.dataset)||source.annotationSha256!==VISUAL_SOURCES[source.dataset].annotationSha256||!Array.isArray(source.rows)||source.rows.length>10000||graphManifestSha256!==VISUAL_SOURCES[source.dataset].graphManifestSha256)fail();
  const male=source.dataset==='male-cns:v1.0',seen=new Set(),excluded=[],candidates=[],motor={};
  for(const row of source.rows){
    if(!exact(row,['neuronId','type','side','hex'])||typeof row.neuronId!=='string'||!row.neuronId.startsWith(source.dataset+'/')||!/^[1-9]\d*$/.test(row.neuronId.slice(source.dataset.length+1))||seen.has(row.neuronId)||!['L1','L2','DNa02'].includes(row.type))fail();
    seen.add(row.neuronId);
    if(!['left','right'].includes(row.side)){excluded.push({neuronId:row.neuronId,reason:'missing-or-ambiguous-side'});continue;}
    if(row.type==='DNa02'){
      if(row.hex!==null||motor[row.side]||row.neuronId!==VISUAL_SOURCES[source.dataset].motor[row.side])fail();motor[row.side]=row.neuronId;continue;
    }
    if(male&&(!Array.isArray(row.hex)||row.hex.length!==2||!row.hex.every(Number.isSafeInteger)||row.hex[0]<1||row.hex[0]>36||row.hex[1]<1||row.hex[1]>39)){excluded.push({neuronId:row.neuronId,reason:'missing-or-invalid-hex'});continue;}
    if(!male&&row.hex!==null)fail();
    candidates.push(structuredClone(row));
  }
  if(Object.keys(motor).length!==2)fail();
  const counts=new Map();for(const r of candidates){const key=JSON.stringify([r.type,r.side,r.hex]);counts.set(key,(counts.get(key)??0)+1);}
  const inputs=candidates.filter(r=>{if(male&&counts.get(JSON.stringify([r.type,r.side,r.hex]))>1){excluded.push({neuronId:r.neuronId,reason:'duplicate-type-side-hex'});return false;}return true;}).sort(order);
  for(const side of ['left','right'])for(const type of ['L1','L2'])if(!inputs.some(r=>r.side===side&&r.type===type))fail();
  const value={schemaVersion:1,kind:'engineered-connectome-visual-mapping',dataset:source.dataset,annotationSha256:source.annotationSha256,graphManifestSha256,graphSha256:VISUAL_SOURCES[source.dataset].graphSha256,
    sensoryMode:male?'synthetic-hex-lamina':'coarse-side-lamina',config:{...VISUAL_CONFIG},motor,inputs,excluded:excluded.sort(order),executionValidated:false};
  return{...value,mappingSha256:visualDigest(value)};
}
function validateMapping(value){
  if(!exact(value,['schemaVersion','kind','dataset','annotationSha256','graphManifestSha256','graphSha256','sensoryMode','config','motor','inputs','excluded','executionValidated','mappingSha256']))fail();
  const {mappingSha256,...body}=value;if(mappingSha256!==visualDigest(body)||value.schemaVersion!==1||value.kind!=='engineered-connectome-visual-mapping'||value.executionValidated!==false||!Object.hasOwn(VISUAL_SOURCES,value.dataset)||value.graphSha256!==VISUAL_SOURCES[value.dataset].graphSha256||visualDigest(value.config)!==visualDigest(VISUAL_CONFIG)||!Array.isArray(value.inputs)||!Array.isArray(value.excluded))fail();
  const excludedIds=new Set(),admitted=new Set([...value.inputs.map(p=>p.neuronId),...Object.values(value.motor)]);
  if(value.excluded.length>10000)fail();
  for(const excluded of value.excluded){
    if(!exact(excluded,['neuronId','reason'])||typeof excluded.neuronId!=='string'||!excluded.neuronId.startsWith(value.dataset+'/')||!/^[1-9]\d*$/.test(excluded.neuronId.slice(value.dataset.length+1))||excludedIds.has(excluded.neuronId)||admitted.has(excluded.neuronId)||!['missing-or-ambiguous-side','missing-or-invalid-hex','duplicate-type-side-hex'].includes(excluded.reason)||value.dataset==='banc:v888'&&excluded.reason!=='missing-or-ambiguous-side')fail();
    excludedIds.add(excluded.neuronId);
  }
  // Rebuild all admitted ports to verify side, type, ID, coordinate and motor rules.
  const rows=[...value.inputs,...Object.entries(value.motor).map(([side,neuronId])=>({neuronId,type:'DNa02',side,hex:null}))];
  const rebuilt=buildVisualMapping({dataset:value.dataset,annotationSha256:value.annotationSha256,rows},value.graphManifestSha256);
  if(rebuilt.excluded.length||visualDigest(rebuilt.inputs)!==visualDigest(value.inputs)||rebuilt.sensoryMode!==value.sensoryMode)fail();
  return structuredClone(value);
}
/** Pure caller-driven state. reset() is required at every owner/session discontinuity. */
export function createVisualEncoder(mapping){
  const m=validateMapping(mapping),groups=new Map();let previous=null,pulse=null,remaining=0,lastFrame=-1;
  for(const input of m.inputs){const key=`${input.side}:${input.type}`;groups.set(key,(groups.get(key)??0)+1);}
  function accept(frame){
    if(!exact(frame,['frameId','width','height','pixels'])||!Number.isSafeInteger(frame.frameId)||frame.frameId<=lastFrame||frame.width!==32||frame.height!==16||!Array.isArray(frame.pixels)||frame.pixels.length!==512||!frame.pixels.every(v=>Number.isFinite(v)&&v>=0&&v<=1))fail();
    const pixels=[...frame.pixels];const difference=pixels.map((v,i)=>previous===null?0:v-previous[i]);
    const means={left:0,right:0};for(let y=0;y<16;y++)for(let x=0;x<32;x++)means[x<16?'left':'right']+=difference[y*32+x]/256;
    pulse=m.inputs.map(input=>{
      let contrast=means[input.side];
      if(input.hex){
        // Synthetic affine hex projection. Orientation is chosen, not biological calibration.
        const [q,r]=input.hex,u=(q-1+0.5*(r-1))/(35+19),v=(r-1)/38;
        const x=Math.min(15,Math.floor(u*16))+(input.side==='right'?16:0),y=Math.min(15,Math.floor(v*16));contrast=difference[y*32+x];
      }
      const strength=Math.max(0,input.type==='L1'?contrast:-contrast);
      return{neuronId:input.neuronId,deltaV:0.02*strength/groups.get(`${input.side}:${input.type}`)};
    });previous=pixels;lastFrame=frame.frameId;remaining=20;
    return{frameId:lastFrame,mappingSha256:m.mappingSha256,nonzeroPorts:pulse.filter(p=>p.deltaV!==0).length};
  }
  function tick(){const factor=remaining/20;const result=pulse?pulse.map(p=>({...p,deltaV:p.deltaV*factor})):[];remaining=Math.max(0,remaining-1);return result;}
  function reset(){previous=null;pulse=null;remaining=0;lastFrame=-1;}
  return{accept,tick,reset};
}
/** One explicit call per 1ms simulated tick. No forward drive or autonomous clock. */
export function createSteeringReadout(){
  let history=[];
  return{reset(){history=[];},tick(value){
    if(!exact(value,['left','right'])||![0,1].includes(value.left)||![0,1].includes(value.right))fail();
    history.push({...value});if(history.length>100)history.shift();
    const left=history.reduce((n,s)=>n+s.left,0)*10,right=history.reduce((n,s)=>n+s.right,0)*10;
    return{leftRateHz:left,rightRateHz:right,yawRadiansPerSecond:0.5*(Math.min(1,right/100)-Math.min(1,left/100)),forwardSpeed:0,windowTicks:100,observedTicks:history.length};
  }};
}
