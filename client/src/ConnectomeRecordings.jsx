import { useEffect,useRef,useState } from 'react';
import { matchingSampleResident,neuronSampleScope } from './connectome-sample-state.js';
import { readRecordedSession,readRecordedReplay,sameRecordingRequest } from './connectome-recording-state.js';
async function json(path,signal,body){const response=await fetch(path,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Recording operation failed.');return value;}
const mib=n=>Number.isFinite(n)?`${(n/1024**2).toFixed(1)} MiB`:'unavailable';
export default function ConnectomeRecordings({individualId=null,dataset=null,neuronId=null,graphManifestSha256=null}) {
 const scope={individualId,dataset,neuronId,graphManifestSha256},key=neuronSampleScope(scope);
 const live=useRef({key,generation:0,mounted:false}),active=useRef(null),listEpoch=useRef(0);live.current.key=key;
 const [listing,setListing]=useState(null),[error,setError]=useState(''),[listError,setListError]=useState(''),[busy,setBusy]=useState(false),[replay,setReplay]=useState(null),[index,setIndex]=useState(0);
 async function refresh(signal){const epoch=++listEpoch.current;try{const value=await json('/api/connectome-recordings',signal);if(!Array.isArray(value.sessions)||value.sessions.length>100)throw new Error('Recording list is incompatible.');value.sessions.forEach(readRecordedSession);if(live.current.mounted&&epoch===listEpoch.current){setListing(value);setListError('');}}catch(e){if(live.current.mounted&&epoch===listEpoch.current)setListError(e.message);}}
 useEffect(()=>{live.current.mounted=true;let timer,stopped=false;const controller=new AbortController();const poll=async()=>{await refresh(controller.signal);if(!stopped)timer=setTimeout(poll,2000);};poll();return()=>{stopped=true;live.current.mounted=false;live.current.generation++;listEpoch.current++;clearTimeout(timer);controller.abort();active.current?.abort();};},[]);
 useEffect(()=>{live.current.generation++;active.current?.abort();active.current=null;setBusy(false);setError('');},[key]);
 async function action(work){if(active.current)return;const request={key,generation:++live.current.generation},controller=new AbortController();active.current=controller;setBusy(true);setError('');const timer=setTimeout(()=>controller.abort(),20000);
  const current=()=>live.current.mounted&&sameRecordingRequest(request,live.current);
  try{await work(controller.signal,current);}catch(e){if(current())setError(controller.signal.aborted?'Request timed out; refresh recording status before retrying.':e.message);}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;if(current()){setBusy(false);await refresh();}}}
 }
 async function start(signal,current){const state=matchingSampleResident(await json(`/api/connectomes/${encodeURIComponent(individualId)}`,signal),scope);
  if(!current())return;await json('/api/connectome-recordings',signal,{protocolVersion:1,individualId,dataset,graphSha256:state.graphSha256,sessionEpoch:state.sessionEpoch,neuronIds:[neuronId]});}
 const activeSource=listing?.sessions.find(s=>s.source.individualId===individualId&&s.status==='recording'),record=replay?.records[index];
 return <section className="card" aria-label="Manual connectome recordings"><h3>Manual connectome recordings</h3>
  <p>Start fixes the exact neuron selection after a read-only graph check. Each Capture click stores one instantaneous sample; no timer, advance, stimulus or provider call. A restore, unload or lost worker ends that source recording.</p>
  <button disabled={busy||!!listError||!listing?.available||!individualId||!neuronId||!!activeSource} onClick={()=>action(start)}>Start recording selected neuron</button>
  {!neuronId&&<p>Select a cell in the anatomical atlas to start. Existing recordings below can replay without an atlas or worker.</p>}
  <button disabled={busy} onClick={()=>action(signal=>refresh(signal))}>Refresh recording status</button>
  {error&&<p role="alert">{error}</p>}{listError&&<p role="alert">Recording status is stale: {listError}</p>}{listing?.failure&&<p role="alert">{listing.failure}</p>}
  {listing&&!listing.available&&<p>Connectome recording storage is unavailable.</p>}
  {listing?.storage&&<p>Separate connectome chunks: {mib(listing.storage.usedBytes)} / {mib(listing.storage.maxBytes)}. Combined configured fixture + connectome chunk budgets: {mib(listing.combinedChunkBudgetBytes)}. SQLite metadata is additional bounded storage.</p>}
  {listing?.sessions.map(s=><details key={s.id} open={s.status==='recording'}><summary>{s.status} · {s.source.dataset} · {s.selection.selectedCount} selected neurons · {s.nextSequence} observation slots</summary>
   <p style={{overflowWrap:'anywhere'}}>Recording {s.id}<br/>Individual {s.source.individualId}<br/>Source epoch {s.source.sessionEpoch}<br/>Graph {s.source.graphSha256}</p>
   <p>{s.selection.selectedCount} of {s.selection.retainedNeuronCount} retained neurons; manual instantaneous observations, not a complete event stream. {s.droppedSamples} dropped captures. {s.failure}</p>
   {s.status==='recording'&&<><button disabled={busy||!!listError} onClick={()=>action(signal=>json(`/api/connectome-recordings/${s.id}/capture`,signal,{}))}>Capture fixed selection once</button><button disabled={busy} onClick={()=>action(signal=>json(`/api/connectome-recordings/${s.id}/stop`,signal,{}))}>Stop recording</button></>}
   <button disabled={busy} onClick={()=>action(async(signal,current)=>{const value=readRecordedReplay(await json(`/api/connectome-recordings/${s.id}/replay`,signal));if(value.session.id!==s.id)throw new Error('Replay belongs to another recording.');if(current()){setReplay(value);setIndex(0);}})}>Open read-only replay</button>
   <button disabled={busy} onClick={()=>action(async(signal,current)=>{const value=readRecordedReplay(await json(`/api/connectome-recordings/${s.id}/replay`,signal));if(value.session.id!==s.id)throw new Error('Export belongs to another recording.');if(!current())return;const {mode,canResume,...exported}=value;const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`connectome-recording-${s.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>Download JSON</button>
   <button disabled={busy||s.status==='recording'} onClick={()=>action(async(signal,current)=>{await json(`/api/connectome-recordings/${s.id}/delete`,signal,{});if(current()&&replay?.session.id===s.id)setReplay(null);})}>Delete recording only</button>
  </details>)}
  {replay&&<section aria-label="Inert connectome recording replay"><h4>Read-only replay · {replay.complete?'complete sampled recording':'partial / still recording'}</h4>
   <p>Historical individual {replay.session.source.individualId} · {replay.session.source.dataset}. This view has no restore, worker, stimulus or provider capability.</p>
   <p>{replay.records.length} intact samples · {replay.gaps.length} missing/corrupt chunks · {replay.session.droppedSamples} dropped captures. Reading this recording does not select its source as a live individual.</p>
   {record?<><label>Observation {index+1} of {replay.records.length}<input type="range" min="0" max={replay.records.length-1} value={index} onChange={e=>setIndex(Number(e.target.value))}/></label>
    <p>Tick {record.tick} · simulation {record.simTimeMs} ms · source window [{record.timeWindow.startSimTimeMs}, {record.timeWindow.endSimTimeMs}] ms · wall {record.wallTimeMs} ms since Unix epoch. Instantaneous values, not rates.</p>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>Exact neuron ID</th><th>Potential</th><th>Firing flag</th><th>Refractory steps</th></tr></thead><tbody>{record.samples.map(n=><tr key={n.neuronId}><td>{n.neuronId}</td><td>{n.potential}</td><td>{n.firing}</td><td>{n.refractoryStepsRemaining}</td></tr>)}</tbody></table></div></>:<p>No intact observations.</p>}
   {replay.gaps.length>0&&<details><summary>Gap sequence numbers</summary><p>{replay.gaps.map(g=>g.sequence).join(', ')}</p></details>}
   <button onClick={()=>setReplay(null)}>Close replay</button>
  </section>}
 </section>;
}
