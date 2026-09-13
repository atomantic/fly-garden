import { validSharedCount, SHARED_LIMITS } from '../../shared/population-limits.js';
import * as THREE from 'three';
import { topDownRetinalRGB } from './retinal-frame.js';
import { SHARED_FLOWERS } from '../../shared/shared-garden-arrangement.js';

/** Shared production geometry and retinal raster; no neural state or network access. */
export function createSharedVisualWorld(renderer, scene, memberCount = 2) {
    if (!validSharedCount(memberCount)) throw new Error('Expected 2–64 shared bodies');
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
    const bodies = Array.from({ length: memberCount }, (_, index) => {
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
    const applyPoses = state => {
      if (!state || state.participants?.length !== memberCount) return false;
      if (state.participants.some(p => !p?.pose || ![p.pose.x,p.pose.z,p.pose.yaw].every(Number.isFinite))) return false;
      for (let i=0;i<memberCount;i++) {
        const pose=state.participants[i].pose;
        bodies[i].position.set(pose.x,0.33,pose.z); bodies[i].rotation.y=pose.yaw+Math.PI;
        cameras[i].position.set(pose.x+Math.sin(pose.yaw)*0.42,0.43,pose.z+Math.cos(pose.yaw)*0.42);
        cameras[i].lookAt(pose.x+Math.sin(pose.yaw)*2,0.43,pose.z+Math.cos(pose.yaw)*2);
      }
      return true;
    };
  const readRetina = i => {
    if (!Number.isInteger(i) || i < 0 || i >= bodies.length) throw new Error('Invalid retinal recipient');
    let rgb;
    bodies[i].visible=false;
    try { renderer.setRenderTarget(target); renderer.render(scene,cameras[i]); renderer.readRenderTargetPixels(target,0,0,8,4,rgba); rgb=topDownRetinalRGB(rgba); }
    finally { bodies[i].visible=true; renderer.setRenderTarget(null); }
    return rgb;
  };
  return { applyPoses, readRetina, readBatch: () => readCompleteRetinalBatch(memberCount, readRetina), dispose: () => target.dispose() };
}

/** Never return a partial sensory batch, even when a synchronous camera exceeds its budget. */
export function readCompleteRetinalBatch(count, read, now = () => performance.now()) {
  if (!validSharedCount(count)) throw new Error('Invalid shared raster count');
  const start = now(), rasters = [];
  const fresh = () => { const elapsed = now() - start; if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > SHARED_LIMITS.rasterBudgetMs) throw new Error('Complete shared raster budget exceeded; no partial batch submitted'); };
  for (let i=0;i<count;i++) { fresh(); rasters.push(read(i)); fresh(); }
  return rasters;
}
