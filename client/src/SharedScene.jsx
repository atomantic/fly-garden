import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createSharedVisualWorld } from './shared-visual-world.js';

const keyFor = shared => shared && `${shared.sharedId}/${shared.worldEpoch}`;
/** Original procedural bodies. Only explicit private tab authority may submit pixels.
 * No participant neural state, target coordinates or observer-camera data enters a frame. */
export default function SharedScene({ shared, controllerToken = null, onFrame = () => {} }) {
  const host = useRef(null), live = useRef({ shared, controllerToken, onFrame, observedAt: performance.now() });
  const [error, setError] = useState(''), [retinas, setRetinas] = useState([]);
  useEffect(() => { live.current = { shared, controllerToken, onFrame, observedAt: performance.now() }; }, [shared, controllerToken, onFrame]);
  useEffect(() => {
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError('Shared WebGL renderer unavailable. All members remain paused without controller frames.'); return; }
    const container = host.current, scene = new THREE.Scene();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x112423); renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const observerCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 40); observerCamera.position.set(6, 5, 7);
    const controls = new OrbitControls(observerCamera, renderer.domElement); controls.target.set(0, 0.5, 0); controls.update(); controls.enableDamping = false;
    const visual = createSharedVisualWorld(renderer, scene, shared?.participants?.length ?? 2), applyPoses = visual.applyPoses;
    let stopped=false, lost=false, inFlight=false, requestController=null, frameId, boundKey=null, boundToken=null, accepted=null, faulted=false;
    async function capture(state, key, token) {
      if (stopped || lost || inFlight || document.hidden || faulted || !token || state?.status !== 'running') return;
      if (performance.now()-live.current.observedAt>1000) { faulted=true; setError('Shared public state is stale; camera batches stopped. Refresh and explicitly start again.'); return; }
      inFlight=true; const controller=new AbortController(); requestController=controller; const timeout=setTimeout(()=>controller.abort(),1000);
      try {
        if (!applyPoses(state)) throw new Error('Committed population poses unavailable');
        const capturedAtMs=Date.now(), rasters=visual.readBatch();
        // No await or pose update within this complete raster barrier. The partner remains visible.
        // A version 2 resting member keeps its slot with an explicit null raster: it receives no
        // retinal input and advances no neural time while the others continue.
        const sharedVersion=state.version===2?2:1;
        const frames=state.participants.map((participant,i)=> {
          const resting=sharedVersion===2 && participant.mode==='resting';
          return { version:sharedVersion, individualId:participant.individualId,sessionId:participant.sessionId,environmentEpoch:state.worldEpoch,
            frameId:state.tick,simTimeMs:participant.simTimeMs,capturedAtMs,camera:'controller',width:8,height:4,
            rgb:resting?null:rasters[i],...(sharedVersion===2?{mode:participant.mode}:{}) };
        });
        const response=await fetch(`/api/shared/${state.sharedId}/frames`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({controllerToken:token,worldEpoch:state.worldEpoch,worldTick:state.tick,frames})});
        const value=await response.json(); if(!response.ok) throw new Error(typeof value.error==='string'?value.error:'Shared retinal batch rejected');
        const current=live.current;
        if(stopped || current.controllerToken!==token || keyFor(current.shared)!==key || keyFor(value.shared)!==key) return;
        if(value.shared.commandSequence<current.shared.commandSequence || value.shared.tick<current.shared.tick) return;
        if(value.shared.tick!==state.tick+1 || value.shared.participants?.length!==state.participants.length
          || value.shared.participants.some((p,i)=>p.individualId!==state.participants[i].individualId || p.sessionId!==state.participants[i].sessionId)) throw new Error('Shared response recipient or clock mismatch');
        accepted=value.shared; setRetinas(frames.map((frame,i)=>({individualId:frame.individualId,rgb:frame.rgb,mode:frame.mode??'active',trace:value.traces?.[i]}))); current.onFrame(value);
      } catch(e) { if(!stopped && live.current.controllerToken===token && keyFor(live.current.shared)===key) { faulted=true; setError(`Shared cameras stopped: ${e.message}. Explicitly pause and start after recovery.`); } }
      finally {clearTimeout(timeout);inFlight=false;}
    }
    const resize=()=> {const {width,height}=container.getBoundingClientRect();if(width&&height){renderer.setSize(width,height);observerCamera.aspect=width/height;observerCamera.updateProjectionMatrix();}};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const contextLost=event=>{event.preventDefault();lost=true;requestController?.abort();setError('Graphics context lost. Shared frames stopped; watchdog pauses all members.');};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    const render=()=> {
      if(stopped)return;frameId=requestAnimationFrame(render);
      const {shared:current,controllerToken:token}=live.current,key=keyFor(current);
      if(key!==boundKey || token!==boundToken){requestController?.abort();boundKey=key;boundToken=token;accepted=null;faulted=false;setError('');setRetinas([]);}
      const state=accepted && keyFor(accepted)===key && accepted.commandSequence===current?.commandSequence && accepted.tick>current.tick?accepted:current;
      if(!lost && !document.hidden){applyPoses(state);renderer.render(scene,observerCamera);void capture(state,key,token);}
    };render();
    return ()=>{stopped=true;requestController?.abort();cancelAnimationFrame(frameId);observer.disconnect();controls.dispose();visual.dispose();
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);scene.traverse(object=>{object.geometry?.dispose();if(object.material)for(const mat of Array.isArray(object.material)?object.material:[object.material])mat.dispose();});renderer.dispose();renderer.domElement.remove();};
  }, [shared?.sharedId]);
  return <section className="shared-renderer" aria-label="Shared original fixture population renderer">
    <div className="scene" ref={host} role="img" aria-label="Original procedural fly bodies at committed shared poses; observer camera does not supply sensory input" />
    <p>Engineered shared visual fixture. Own body hidden only during its own retinal raster; the other body remains visible. No partner neural telemetry, hidden target, automatic contact/scent, or creative capture enters this shared loop. Coincident starting poses are preserved, not forcibly separated.</p>
    {!controllerToken && <p>Observer only: this tab sends no shared retinal batches.</p>}
    {error && <p role="alert">{error}</p>}
    {retinas.map(retina=><div key={retina.individualId}><p style={{overflowWrap:'anywhere'}}>Retinal recipient: {retina.individualId} · accepted batch input tick {retina.trace?.frameId}{retina.mode==='resting'?' · resting: no retinal input and no neural time':''}</p>
      {retina.rgb && <div role="img" aria-label={`Accepted 8 by 4 RGB retina for ${retina.individualId}`} style={{display:'grid',gridTemplateColumns:'repeat(8, 14px)',width:112}}>
        {Array.from({length:32},(_,i)=><span key={i} style={{height:14,background:`rgb(${retina.rgb.slice(i*3,i*3+3).join(',')})`}} />)}</div>}</div>)}
  </section>;
}
