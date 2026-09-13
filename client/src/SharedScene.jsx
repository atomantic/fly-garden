import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { topDownRetinalRGB } from './retinal-frame.js';
import { SHARED_FLOWERS } from '../../shared/shared-garden-arrangement.js';

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
    catch { setError('Shared WebGL renderer unavailable. Both members remain paused without controller frames.'); return; }
    const container = host.current, scene = new THREE.Scene();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x112423); renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const observerCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 40); observerCamera.position.set(6, 5, 7);
    const controls = new OrbitControls(observerCamera, renderer.domElement); controls.target.set(0, 0.5, 0); controls.update(); controls.enableDamping = false;
    scene.add(new THREE.HemisphereLight(0xeaffdc, 0x214d48, 3));
    const light = new THREE.DirectionalLight(0xffe7af, 3); light.position.set(3, 7, 4); scene.add(light);
    const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
    const add = (geometry, mat, parent, position, scale = [1,1,1]) => { const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh; };
    const sphere = (mat, parent, position, scale) => add(new THREE.SphereGeometry(1, 16, 10), mat, parent, position, scale);
    add(new THREE.CylinderGeometry(4,4,0.15,48), material(0x526249), scene, [0,-0.1,0]);
    // Visible original neutral landmarks, identical for observer and controller rendering.
    for (const { x, z } of SHARED_FLOWERS) {
      add(new THREE.CylinderGeometry(0.025,0.035,0.6,6),material(0x567143),scene,[x,0.3,z]);
      for (let p = 0; p < 5; p++) sphere(material(0xf4d78f),scene,[x+Math.sin(p*Math.PI*2/5)*0.15,0.62,z+Math.cos(p*Math.PI*2/5)*0.15],[0.13,0.055,0.1]);
    }
    const bodies = [0,1].map(index => {
      const body = new THREE.Group(); scene.add(body);
      const chitin = material(index ? 0x627754 : 0x8b8057), dark = material(0x29382b), eye = material(0xb75538);
      sphere(chitin,body,[0,0,0.32],[0.22,0.18,0.4]); sphere(dark,body,[0,0.06,0],[0.22,0.22,0.27]); sphere(chitin,body,[0,0.08,-0.3],[0.19,0.16,0.15]);
      for (const side of [-1,1]) {
        sphere(eye,body,[side*0.14,0.12,-0.34],[0.1,0.13,0.09]);
        const wing = sphere(material(0xd7edda,{transparent:true,opacity:0.6}),body,[side*0.3,0.24,0.3],[0.18,0.015,0.46]); wing.rotation.y=side*0.3;
        for (let leg=0;leg<3;leg++) {
          const a=new THREE.Vector3(side*0.14,0,-0.15+leg*0.2), b=new THREE.Vector3(side*0.48,-0.3,-0.25+leg*0.2);
          const mesh=add(new THREE.CylinderGeometry(0.012,0.012,a.distanceTo(b),6),dark,body,a.clone().add(b).multiplyScalar(0.5).toArray());
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.sub(a).normalize());
        }
      }
      return body;
    });
    const cameras = bodies.map(() => new THREE.PerspectiveCamera(90,2,0.03,20));
    const target = new THREE.WebGLRenderTarget(8,4,{ minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter }); target.texture.colorSpace=THREE.SRGBColorSpace;
    const rgba = new Uint8Array(128);
    let stopped=false, lost=false, inFlight=false, requestController=null, frameId, boundKey=null, boundToken=null, accepted=null, faulted=false;
    const applyPoses = state => {
      if (!state || state.participants?.length !== 2) return false;
      for (let i=0;i<2;i++) {
        const pose=state.participants[i].pose;
        if (!pose || ![pose.x,pose.z,pose.yaw].every(Number.isFinite)) return false;
        bodies[i].position.set(pose.x,0.33,pose.z); bodies[i].rotation.y=pose.yaw+Math.PI;
        cameras[i].position.set(pose.x+Math.sin(pose.yaw)*0.42,0.43,pose.z+Math.cos(pose.yaw)*0.42);
        cameras[i].lookAt(pose.x+Math.sin(pose.yaw)*2,0.43,pose.z+Math.cos(pose.yaw)*2);
      }
      return true;
    };
    async function capture(state, key, token) {
      if (stopped || lost || inFlight || document.hidden || faulted || !token || state?.status !== 'running') return;
      if (performance.now()-live.current.observedAt>1000) { faulted=true; setError('Shared public state is stale; camera batches stopped. Refresh and explicitly start again.'); return; }
      inFlight=true; const controller=new AbortController(); requestController=controller; const timeout=setTimeout(()=>controller.abort(),1000);
      try {
        if (!applyPoses(state)) throw new Error('Committed two-body poses unavailable');
        const capturedAtMs=Date.now();
        // No await or pose update within this complete raster barrier. The partner remains visible.
        const frames=state.participants.map((participant,i)=> {
          let rgb;
          bodies[i].visible=false;
          try { renderer.setRenderTarget(target); renderer.render(scene,cameras[i]); renderer.readRenderTargetPixels(target,0,0,8,4,rgba); rgb=topDownRetinalRGB(rgba); }
          finally { bodies[i].visible=true; renderer.setRenderTarget(null); }
          return { version:1, individualId:participant.individualId,sessionId:participant.sessionId,environmentEpoch:state.worldEpoch,
            frameId:state.tick,simTimeMs:participant.simTimeMs,capturedAtMs,camera:'controller',width:8,height:4,rgb };
        });
        const response=await fetch(`/api/shared/${state.sharedId}/frames`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({controllerToken:token,worldEpoch:state.worldEpoch,worldTick:state.tick,frames})});
        const value=await response.json(); if(!response.ok) throw new Error(typeof value.error==='string'?value.error:'Shared retinal batch rejected');
        const current=live.current;
        if(stopped || current.controllerToken!==token || keyFor(current.shared)!==key || keyFor(value.shared)!==key) return;
        if(value.shared.commandSequence<current.shared.commandSequence || value.shared.tick<current.shared.tick) return;
        if(value.shared.tick!==state.tick+1 || value.shared.participants?.length!==2
          || value.shared.participants.some((p,i)=>p.individualId!==state.participants[i].individualId || p.sessionId!==state.participants[i].sessionId)) throw new Error('Shared response recipient or clock mismatch');
        accepted=value.shared; setRetinas(frames.map((frame,i)=>({individualId:frame.individualId,rgb:frame.rgb,trace:value.traces?.[i]}))); current.onFrame(value);
      } catch(e) { if(!stopped && live.current.controllerToken===token && keyFor(live.current.shared)===key) { faulted=true; setError(`Shared cameras stopped: ${e.message}. Explicitly pause and start after recovery.`); } }
      finally {clearTimeout(timeout);inFlight=false;}
    }
    const resize=()=> {const {width,height}=container.getBoundingClientRect();if(width&&height){renderer.setSize(width,height);observerCamera.aspect=width/height;observerCamera.updateProjectionMatrix();}};
    const observer=new ResizeObserver(resize);observer.observe(container);resize();
    const contextLost=event=>{event.preventDefault();lost=true;requestController?.abort();setError('Graphics context lost. Shared frames stopped; watchdog pauses both members.');};
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    const render=()=> {
      if(stopped)return;frameId=requestAnimationFrame(render);
      const {shared:current,controllerToken:token}=live.current,key=keyFor(current);
      if(key!==boundKey || token!==boundToken){requestController?.abort();boundKey=key;boundToken=token;accepted=null;faulted=false;setError('');setRetinas([]);}
      const state=accepted && keyFor(accepted)===key && accepted.commandSequence===current?.commandSequence && accepted.tick>current.tick?accepted:current;
      if(!lost && !document.hidden){applyPoses(state);renderer.render(scene,observerCamera);void capture(state,key,token);}
    };render();
    return ()=>{stopped=true;requestController?.abort();cancelAnimationFrame(frameId);observer.disconnect();controls.dispose();target.dispose();
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);scene.traverse(object=>{object.geometry?.dispose();if(object.material)for(const mat of Array.isArray(object.material)?object.material:[object.material])mat.dispose();});renderer.dispose();renderer.domElement.remove();};
  }, []);
  return <section className="shared-renderer" aria-label="Shared original two-body fixture renderer">
    <div className="scene" ref={host} role="img" aria-label="Two original procedural fly bodies at committed shared poses; observer camera does not supply sensory input" />
    <p>Engineered two-body visual fixture. Own body hidden only during its own retinal raster; the other body remains visible. No partner neural telemetry, hidden target, automatic contact/scent, or creative capture enters this shared loop. Coincident starting poses are preserved, not forcibly separated.</p>
    {!controllerToken && <p>Observer only: this tab sends no shared retinal batches.</p>}
    {error && <p role="alert">{error}</p>}
    {retinas.map(retina=><div key={retina.individualId}><p style={{overflowWrap:'anywhere'}}>Retinal recipient: {retina.individualId} · accepted batch input tick {retina.trace?.frameId}</p>
      <div role="img" aria-label={`Accepted 8 by 4 RGB retina for ${retina.individualId}`} style={{display:'grid',gridTemplateColumns:'repeat(8, 14px)',width:112}}>
        {Array.from({length:32},(_,i)=><span key={i} style={{height:14,background:`rgb(${retina.rgb.slice(i*3,i*3+3).join(',')})`}} />)}</div></div>)}
  </section>;
}
