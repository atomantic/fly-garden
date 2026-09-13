import {useEffect,useRef,useState} from 'react';
import {observationScope,relatedObservations,eventObservations} from './observation-details.js';
export default function EventDetails({state}) {
 const scope=observationScope(state),current=useRef(scope);current.current=scope;
 const [detail,setDetail]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),active=useRef(null),generation=useRef(0);
 useEffect(()=>{generation.current++;active.current?.abort();setDetail(null);setError('');setBusy(false);return()=>{generation.current++;active.current?.abort();};},[scope]);
 async function inspect(event){
  active.current?.abort();const controller=new AbortController(),request=++generation.current;active.current=controller;
  const captured=structuredClone(state),key=observationScope(captured),valid=()=>current.current===key&&generation.current===request;
  setBusy(true);setError('');setDetail({key,value:relatedObservations(captured,event),missing:['Related retained sources have not yet responded.']});
  const timeout=setTimeout(()=>controller.abort(),10000);
  const read=async path=>{const response=await fetch(path,{signal:controller.signal});if(!response.ok)throw new Error('Source unavailable');return response.json();};
  try{
   const base=`/api/individuals/${encodeURIComponent(captured.individualId)}`;
   const artifactPath=captured.sharedSession?`/api/shared/${encodeURIComponent(captured.sharedSession.sharedId)}/artifacts/export/json`:`${base}/artifacts/export/json`;
   const replies=await Promise.allSettled([read(artifactPath),read(`${base}/language`)]);
   const confirmed=await read(base);
   if(!valid())return;if(observationScope(confirmed)!==key)throw new Error('Source session changed; historical links were not attached.');
   setDetail({key,value:relatedObservations(captured,event,replies[0].status==='fulfilled'?replies[0].value:null,replies[1].status==='fulfilled'?replies[1].value:null),missing:replies.flatMap((r,i)=>r.status==='rejected'?[`${i===0?'Artifact':'Language'} retained source unavailable.`]:[])});
  }catch(e){if(valid())setError(controller.signal.aborted?'Related source read timed out; no missing records were invented.':e.message);}
  finally{clearTimeout(timeout);if(valid())setBusy(false);}
 }
 const shown=detail?.key===scope?detail:null;
 return <section aria-label="Read-only event journal"><h3>Event journal</h3><p>Choose an event to inspect retained records at its exact simulation time. Temporal overlap is not a causal or mental-state claim. Reads cannot start a provider or simulation.</p>
  <div tabIndex={0} role="region" aria-label="Retained source events" style={{maxHeight:240,overflowY:'auto'}}>
  {eventObservations(state).map(e=><p key={e.id}><button aria-pressed={shown?.value.event.id===e.id} onClick={()=>inspect(e)}>{e.timeMs} ms · {e.type}: {e.message}</button></p>)}
  </div>
  {!state&&<p>Source unavailable.</p>}{busy&&<p role="status">Reading related retained records…</p>}{error&&<p role="alert">{error}</p>}
  {shown&&<div><h4>Captured event {shown.value.event.id}</h4><p style={{overflowWrap:'anywhere'}}>Individual/session: {shown.key} · source window [{shown.value.timeWindow.startMs}, {shown.value.timeWindow.endMs}] ms. This is a historical captured detail, not live activity.</p>
   <details><summary>Event and policy receipt details</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(shown.value.event,null,2)}</pre></details>
   {Object.entries({sensoryMotor:'Sensory / neural-step / motor trace',chemistry:'Encounter transitions',actions:'Movement source actions',artifacts:'Derived notes / marks',interpretations:'Language evidence windows'}).map(([key,label])=><details key={key}><summary>{label}</summary>{shown.value[key]&&(!Array.isArray(shown.value[key])||shown.value[key].length)?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(shown.value[key],null,2)}</pre>:<p>No matching retained record for this exact source/window; unavailable does not mean zero activity.</p>}</details>)}
   {shown.missing.map(text=><p key={text}>{text}</p>)}<p>No historical neuron sample is inferred from the current snapshot. Use an explicitly recorded neural replay for captured values.</p>
  </div>}
 </section>;
}
