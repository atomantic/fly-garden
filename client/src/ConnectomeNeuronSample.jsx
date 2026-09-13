import { useEffect, useRef, useState } from 'react';
import { neuronSampleScope, matchingSampleResident, readNeuronSample, confirmNeuronSample, currentNeuronSampleRequest } from './connectome-sample-state.js';
async function json(url,signal,body) {
  const response=await fetch(url,{signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const value=await response.json();
  if(!response.ok)throw new Error(typeof value.error==='string'?value.error:'Neuron sample unavailable. Refresh the selected connectome before retrying.');
  return value;
}
export default function ConnectomeNeuronSample({individualId,dataset,neuronId,graphManifestSha256}) {
  const scope={individualId,dataset,neuronId,graphManifestSha256},key=neuronSampleScope(scope);
  const live=useRef({key,generation:0}),active=useRef(null);
  live.current.key=key;
  const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    live.current.generation++;active.current?.abort();active.current=null;setResult(null);setError('');setBusy(false);
    return()=>{live.current.generation++;active.current?.abort();active.current=null;};
  },[key]);
  async function read() {
    if(active.current||!individualId||!neuronId)return;
    const generation=++live.current.generation,controller=new AbortController();active.current=controller;
    const current=()=>currentNeuronSampleRequest({key,generation},live.current);
    const timer=setTimeout(()=>controller.abort(),15000);setBusy(true);setError('');setResult(null);
    try {
      const base=`/api/connectomes/${encodeURIComponent(individualId)}`;
      const state=matchingSampleResident(await json(base,controller.signal),scope);
      if(!current())return;
      const sample=readNeuronSample(await json(`${base}/samples`,controller.signal,{protocolVersion:1,individualId,dataset,
        graphSha256:state.graphSha256,sessionEpoch:state.sessionEpoch,neuronIds:[neuronId]}),state,scope);
      if(!current())return;
      confirmNeuronSample(sample,await json(base,controller.signal),scope);
      if(current())setResult({key,sample});
    }catch(e){if(current())setError(controller.signal.aborted?'Sample request timed out. No values were substituted.':e.message);}
    finally{clearTimeout(timer);if(active.current===controller){active.current=null;if(current())setBusy(false);}}
  }
  const sample=result?.key===key?result.sample:null,entry=sample?.samples[0];
  return <section aria-label="Instantaneous modeled neuron sample">
    <h4>Instantaneous modeled state</h4>
    <p>Read one selected neuron's potential, firing flag and refractory countdown. This does not load, start, advance or stimulate a worker. Values are snapshots, not firing rates or anatomical measurements.</p>
    {!individualId&&<p>Select a full-connectome individual in Connectome lab first. No fixture values are substituted.</p>}
    <button disabled={!individualId||!neuronId||busy} onClick={read}>{busy?'Reading bounded sample…':'Read neuron sample once'}</button>
    {error&&<p role="alert">{error}</p>}
    {sample&&<><p role="status">Captured tick {sample.tick} · {sample.simTimeMs} ms · {sample.status} at read. No automatic refresh; later commands can make this snapshot out of date.</p>
      <dl><dt>Modeled potential (dimensionless)</dt><dd>{entry.potential}</dd><dt>Pending one-step firing flag</dt><dd>{entry.firing}</dd>
        <dt>Refractory steps remaining</dt><dd>{entry.refractoryStepsRemaining}</dd></dl>
      <details><summary>Sample source and zero-width time window</summary><p style={{overflowWrap:'anywhere'}}>Individual: {sample.individualId}<br/>Dataset: {sample.dataset}<br/>Neuron: {entry.neuronId}<br/>Worker epoch: {sample.sessionEpoch}<br/>Graph SHA-256: {sample.graphSha256}<br/>Model: {sample.modelId}<br/>Command sequence: {sample.commandSequence}<br/>Window: [{sample.timeWindow.startSimTimeMs}, {sample.timeWindow.endSimTimeMs}] ms (instantaneous)</p></details>
    </>}
  </section>;
}
