import { useEffect, useRef, useState } from 'react';
import { DATASETS, currentLabRequest, labCommand, mergeConnectomeState, readConnectomeState, readConnectomeHistory, readLabCommandReply } from './connectome-lab-state.js';
import './connectome-lab.css';

const LABELS = {'male-cns:v1.0':'MaleCNS v1.0','banc:v888':'BANC v888'};
const number = value => Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
const memory = value => Number.isFinite(value) ? `${(value / 1024 / 1024).toFixed(1)} MiB` : 'Unavailable';
async function json(path, options = {}) {
  const response = await fetch(path, options), value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Connectome request failed. Refresh before retrying.');
  return value;
}
function catalogValue(value) {
  if (!value || value.protocolVersion !== 1 || typeof value.catalogEpoch !== 'string' || !Number.isSafeInteger(value.commandSequence)
    || value.commandSequence < 0 || typeof value.available !== 'boolean' || !Array.isArray(value.profiles) || value.profiles.length > 2
    || value.profiles.some(profile => !DATASETS.includes(profile.dataset) || typeof profile.available !== 'boolean')
    || !Array.isArray(value.individuals) || value.individuals.length > 64) throw new Error('Connectome catalog is incompatible. No worker was loaded.');
  value.individuals.forEach(readConnectomeState); return value;
}


/** Full-profile research control; mounting/polling never creates, loads or advances a worker. */
export default function ConnectomeLab({ selectedIndividualId, onSelectIndividual = () => {}, onSelection = () => {} }) {
  const [catalog, setCatalog] = useState(null), [dataset, setDataset] = useState(DATASETS[0]), [selected, setSelected] = useState(selectedIndividualId ?? '');
  const [state, setState] = useState(null), [history, setHistory] = useState([]), [checkpoint, setCheckpoint] = useState('');
  const [steps, setSteps] = useState('100'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [readError, setReadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const live = useRef({generation:0,individualId:selectedIndividualId ?? '',state:null,busy:false,mounted:true});
  const actionRequest = useRef(null), selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  const context = () => ({generation:live.current.generation,individualId:live.current.individualId,sessionEpoch:live.current.state?.sessionEpoch ?? null});
  const accepts = request => live.current.mounted && currentLabRequest(request,{...context()});
  function publish(next) {
    next=readConnectomeState(next); const merged=mergeConnectomeState(live.current.state,next);
    live.current.state=merged; setState(merged);
  }
  function select(id, notify = true) {
    id = id ?? '';
    const identity = id ? catalog?.individuals.find(item => item.individualId === id) : null;
    if (notify && id && !identity) { setError('Selected identity is absent from the validated catalog. Refresh before selecting.'); return; }
    live.current.generation++;live.current.individualId=id;live.current.state=null;
    actionRequest.current?.abort();live.current.busy=false;setBusy(false);
    setSelected(id);setState(null);setHistory([]);setCheckpoint('');setError('');setReadError('');
    if (notify) onSelectIndividual(id, identity?.dataset);
  }
  useEffect(()=>{if(selectedIndividualId !== undefined && (selectedIndividualId ?? '') !== live.current.individualId)select(selectedIndividualId,false);},[selectedIndividualId]);
  useEffect(()=>{selectionCallback.current(state);},[state]);
  useEffect(()=>{live.current.mounted=true;return()=>{live.current.mounted=false;live.current.generation++;actionRequest.current?.abort();};},[]);
  useEffect(()=>{
    let stopped=false,timer,controller;
    async function poll() {
      if(live.current.busy){timer=setTimeout(poll,1000);return;}
      const request=context();controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
      try {
        const list=catalogValue(await json('/api/connectomes',{signal:controller.signal}));
        let next=null,entries=[];
        if(request.individualId) {
          next=readConnectomeState(await json(`/api/connectomes/${encodeURIComponent(request.individualId)}`,{signal:controller.signal}));
          if(next.individualId!==request.individualId)throw new Error('Connectome response belongs to another individual.');
          entries=readConnectomeHistory(await json(`/api/connectomes/${encodeURIComponent(request.individualId)}/history`,{signal:controller.signal}),request.individualId);
        }
        if(!stopped && accepts(request)) {
          setCatalog(list);if(next)publish(next);setHistory(entries);setCheckpoint(old=>entries.some(item=>item.checkpointId===old)?old:'');setReadError('');
        }
      }catch(e){if(!stopped && accepts(request))setReadError(e.message);}
      finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(poll,1500);}
    }
    void poll();return()=>{stopped=true;clearTimeout(timer);controller?.abort();};
  },[selected,refresh]);
  async function act(action) {
    if(live.current.busy)return;
    live.current.generation++;const request=context(),controller=new AbortController();actionRequest.current=controller;
    live.current.busy=true;setBusy(true);setError('');
    const timeout=setTimeout(()=>controller.abort(),45000);
    try {
      let result;
      if(action==='create') {
        // Refresh catalog generation at this explicit action; no automatic admission or load.
        const current=catalogValue(await json('/api/connectomes',{signal:controller.signal}));
        if(!accepts(request))return;
        result=await json('/api/connectomes',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({protocolVersion:1,catalogEpoch:current.catalogEpoch,commandSequence:current.commandSequence,dataset})});
      } else {
        const current=readConnectomeState(await json(`/api/connectomes/${encodeURIComponent(request.individualId)}`,{signal:controller.signal}));
        if(!accepts(request))return;
        if(current.individualId!==request.individualId || current.sessionEpoch!==request.sessionEpoch)throw new Error('The selected individual changed worker sessions. Refresh before retrying.');
        result=await json(`/api/connectomes/${encodeURIComponent(request.individualId)}/commands`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify(labCommand(current,action,Number(steps),checkpoint))});
      }
      if(!accepts(request))return;
      const next=readConnectomeState(result.state);
      if(action==='create') {
        if(next.dataset!==dataset || next.resident)throw new Error('Created identity did not match the unloaded profile request.');
        live.current.generation++;live.current.individualId=next.individualId;live.current.state=null;setSelected(next.individualId);onSelectIndividual(next.individualId,next.dataset);setHistory([]);setCheckpoint('');
      } else readLabCommandReply(live.current.state,next,action);
      publish(next);if(result.population)setCatalog(old=>old?{...old,population:result.population}:old);
    }catch(e){if(accepts(request))setError(controller.signal.aborted?'Response timed out or was interrupted. The server may have completed the command; refresh its current state before retrying.':e.message);}
    finally {
      clearTimeout(timeout);
      if(actionRequest.current===controller){actionRequest.current=null;live.current.busy=false;if(live.current.mounted){setBusy(false);setRefresh(value=>value+1);}}
    }
  }
  const profile=catalog?.profiles.find(item=>item.dataset===(state?.dataset??dataset));
  const chosenProfile=catalog?.profiles.find(item=>item.dataset===dataset);
  const blocked=busy || Boolean(readError), resident=Boolean(state?.resident), transitioning=['loading','stopping'].includes(state?.status);
  const canCommand=Boolean(state)&&!blocked&&!transitioning;
  return <section className="connectome-lab card content-panel" aria-label="Full connectome research lab">
    <span className="eyebrow">COMPLETE PINNED GRAPHS / EXPLICIT RESEARCH STEPS</span>
    <h2>Full connectome lab</h2>
    <p>Choose an independent MaleCNS or BANC individual. The sparse LIF model retains the complete imported graph. Anatomy comes from the pinned source reconstructions. Neuron dynamics are engineered, and presynaptic signs use a simplifying mapping from source transmitter annotations. This lab has no body mapping, sensory input, learning, chemistry or language feedback.</p>
    <p>Loading starts paused. Start only enables the Advance button; it does not start a timer. Every advance is an explicitly requested, bounded batch. Silence and inactivity are valid results.</p>
    {readError && <p role="alert">{readError} Existing values are stale; commands are disabled.</p>}
    {error && <p role="alert">{error}</p>}
    {!catalog && !readError && <p role="status">Reading local connectome availability…</p>}
    <button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>Refresh metadata</button>
    {catalog && <>
      {!catalog.available && <p role="status">{catalog.reason || 'The durable connectome service is unavailable. No fixture is substituted.'}</p>}
      <div className="lab-grid">
        <fieldset disabled={blocked || !catalog.available}><legend>Create an independent identity</legend>
          <label>Exact dataset<select value={dataset} onChange={event=>setDataset(event.target.value)}>{DATASETS.map(id=><option key={id} value={id}>{LABELS[id]}</option>)}</select></label>
          <p>{chosenProfile?.available ? `${number(chosenProfile.neuronCount)} retained neurons · ${number(chosenProfile.edgeCount)} directed edges` : chosenProfile?.reason || 'Pinned profile unavailable.'}</p>
          <button disabled={!chosenProfile?.available} onClick={()=>act('create')}>Create saved, unloaded individual</button>
          <p>Creation saves identity metadata only. Load is a separate action and requires measured memory headroom.</p>
        </fieldset>
        <fieldset><legend>Inspect an existing individual</legend><label>Individual<select value={selected} onChange={event=>select(event.target.value)}>
          <option value="">Select an individual</option>{catalog.individuals.map(item=><option key={item.individualId} value={item.individualId}>{LABELS[item.dataset]} · {item.individualId} · {item.status}</option>)}</select></label>
          <p>Selection reads summaries and history. It never loads or starts a worker.</p>
        </fieldset>
      </div>
      {catalog.population && <section aria-label="Connectome resource admission"><h3>Resource admission</h3>
        <dl className="lab-metrics"><div><dt>Resident / configured ceiling</dt><dd>{number(catalog.population.residentCount)} / {number(catalog.population.settings?.maxResidentFlies)}</dd></div>
          <div><dt>Aggregate memory</dt><dd>{memory(catalog.population.aggregateMemoryBytes)}</dd></div><div><dt>Available host memory</dt><dd>{memory(catalog.population.availableMemoryBytes)}</dd></div>
          <div><dt>Pressure</dt><dd>{catalog.population.pressure || 'Unavailable'}</dd></div></dl>
        <p>Paused, loading and stopping workers retain admission capacity. This view does not change capacity settings.</p></section>}
      {state && <section aria-label="Selected connectome controls"><h3>{LABELS[state.dataset]} individual</h3><p className="lab-id">{state.individualId}</p>
        <p role="status"><strong>{state.status}</strong> · {state.resident?'Resident or reserved':'Unloaded'}{busy?' · request pending':''}</p>
        {state.reason && <p>{state.reason}</p>}{state.recoveryRequired && <p role="alert">Storage recovery is required before activation. Preserve the selected durable head; no automatic retry or initialization occurs.</p>}
        <p>{profile?.measurement?.available ? `Measured incremental allocation including checkpoint staging: ${memory(profile.measurement.incrementalMemoryBytes)}.` : profile?.measurement?.reason || 'A verified memory measurement is unavailable; loading remains disabled.'}</p>
        {profile?.measurement?.disclosure && <p>{profile.measurement.disclosure}</p>}
        <div className="lab-actions"><button disabled={!canCommand || resident || !profile?.measurement?.available} onClick={()=>act('load')}>Load complete graph (paused)</button>
          <button disabled={!canCommand || !resident || !['paused','resting'].includes(state.status)} onClick={()=>act('start')}>Start (no automatic steps)</button>
          <button disabled={!canCommand || !resident || state.status==='fault'} onClick={()=>act('pause')}>Pause</button>
          <button disabled={!canCommand || !resident || state.status==='fault'} onClick={()=>act('rest')}>Rest</button>
          <button disabled={!canCommand || !resident || state.status==='fault'} onClick={()=>act('home')}>Home (pause locally)</button>
          <button disabled={!canCommand || !resident} onClick={()=>act('save')}>Save checkpoint (pause)</button>
          <button disabled={!canCommand || !resident} onClick={()=>act('unload')}>Save and unload</button></div>
        <div className="lab-advance"><label>One-millisecond steps<input type="number" min="1" max="1000" step="1" inputMode="numeric" value={steps} onChange={event=>setSteps(event.target.value)} /></label>
          <button disabled={!canCommand || state.status!=='running' || !Number.isInteger(Number(steps)) || Number(steps)<1 || Number(steps)>1000} onClick={()=>act('advance')}>Advance {Number(steps)>=1&&Number(steps)<=1000?number(Number(steps)):'…'} ms once</button></div>
        <p>Each click advances at most 1000 ms. There are no probes, repeated runs, skipped steps or background neural execution.</p>
        {state.neural && <dl className="lab-metrics"><div><dt>Simulation time</dt><dd>{number(state.neural.simTimeMs)} ms</dd></div><div><dt>Tick</dt><dd>{number(state.neural.tick)}</dd></div>
          <div><dt>Current / cumulative spikes</dt><dd>{number(state.neural.spikes)} / {number(state.neural.totalSpikes)}</dd></div><div><dt>Traversed edges</dt><dd>{number(state.neural.traversedEdges)}</dd></div>
          <div><dt>Potential range</dt><dd>{number(state.neural.minimum)} → {number(state.neural.maximum)}</dd></div></dl>}
        <h4>Checkpoint history</h4><p>Restoring selects the exact saved source under a new worker epoch and stays paused. Load this individual before restoring.</p>
        <label>Saved source<select value={checkpoint} onChange={event=>setCheckpoint(event.target.value)} disabled={busy}><option value="">Select checkpoint</option>
          {history.map(item=><option key={item.checkpointId} value={item.checkpointId}>{new Date(item.createdAt).toISOString()} · tick {item.tick} · {item.operation} · {item.checkpointId}</option>)}</select></label>
        <button disabled={!canCommand || !resident || !checkpoint} onClick={()=>act('restore')}>Restore selected checkpoint (paused)</button>
        <details><summary>Exact profile and checkpoint provenance</summary><dl className="lab-provenance">
          <dt>Retained neuron / edge counts</dt><dd>{number(state.provenance?.neuronCount??profile?.neuronCount)} / {number(state.provenance?.edgeCount??profile?.edgeCount)}</dd>
          <dt>Anatomical contacts</dt><dd>{number(state.provenance?.contactCount)}</dd><dt>Model</dt><dd>{state.model?.id??profile?.modelId??'Unavailable'}</dd>
          <dt>Graph SHA-256</dt><dd>{state.graphSha256??profile?.graphSha256??'Unavailable'}</dd><dt>Manifest SHA-256</dt><dd>{state.provenance?.manifestSha256??profile?.manifestSha256??'Unavailable'}</dd>
          <dt>Worker epoch</dt><dd>{state.sessionEpoch}</dd><dt>Current durable head</dt><dd>{state.checkpointId??'No checkpoint saved'}</dd></dl>
          <div className="lab-history"><table><thead><tr><th>Checkpoint</th><th>Parent</th><th>Restored from</th><th>SHA-256</th><th>Bytes</th></tr></thead><tbody>{history.map(item=><tr key={item.checkpointId}>
            <td>{item.checkpointId}</td><td>{item.parentId??'Initial'}</td><td>{item.restoredFrom??'—'}</td><td>{item.sha256}</td><td>{number(item.bytes)}</td></tr>)}</tbody></table></div></details>
      </section>}
    </>}
  </section>;
}
