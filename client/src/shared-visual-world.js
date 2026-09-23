import { validSharedCount, SHARED_LIMITS } from '../../shared/population-limits.js';
import * as THREE from 'three';
import { topDownRetinalRGB } from './retinal-frame.js';
import { SHARED_FLOWERS } from '../../shared/shared-garden-arrangement.js';
import { mixedMembershipKey, readMixedWorldPresentation } from '../../shared/mixed-world-presentation.js';

const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
const add = (geometry, mat, parent, position, scale = [1,1,1]) => { const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(...position); mesh.scale.set(...scale); parent.add(mesh); return mesh; };
const sphere = (mat, parent, position, scale) => add(new THREE.SphereGeometry(1, 16, 10), mat, parent, position, scale);
const addLights = parent => {
  parent.add(new THREE.HemisphereLight(0xeaffdc, 0x214d48, 3));
  const light = new THREE.DirectionalLight(0xffe7af, 3); light.position.set(3, 7, 4); parent.add(light);
};
/** Original neutral garden plot and landmarks, identical for observer and controller rendering. */
function addSharedGardenPlot(parent, [cx, cz] = [0, 0], radius = 4) {
  add(new THREE.CylinderGeometry(radius,radius,0.15,48), material(0x526249), parent, [cx,-0.1,cz]);
  for (const { x, z } of SHARED_FLOWERS) {
    add(new THREE.CylinderGeometry(0.025,0.035,0.6,6),material(0x567143),parent,[cx+x,0.3,cz+z]);
    for (let p = 0; p < 5; p++) sphere(material(0xf4d78f),parent,[cx+x+Math.sin(p*Math.PI*2/5)*0.15,0.62,cz+z+Math.cos(p*Math.PI*2/5)*0.15],[0.13,0.055,0.1]);
  }
}
/** One original procedural fly body. Colors are illustration choices, not specimen or sex labels. */
export function addProceduralFlyBody(parent, index = 0) {
  const body = new THREE.Group(); parent.add(body);
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
}

/** Shared production geometry and retinal raster; no neural state or network access. */
export function createSharedVisualWorld(renderer, scene, memberCount = 2) {
    if (!validSharedCount(memberCount)) throw new Error('Expected 2–64 shared bodies');
    addLights(scene);
    addSharedGardenPlot(scene);
    const bodies = Array.from({ length: memberCount }, (_, index) => addProceduralFlyBody(scene, index));
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
  // bodies/cameras are the exact production objects. Exposing them lets headless evidence
  // measure the real camera transform without re-deriving the placement formula above.
  return { applyPoses, readRetina, bodies, cameras, readBatch: () => readCompleteRetinalBatch(memberCount, readRetina), dispose: () => target.dispose() };
}

/** Never return a partial sensory batch, even when a synchronous camera exceeds its budget. */
export function readCompleteRetinalBatch(count, read, now = () => performance.now()) {
  if (!validSharedCount(count)) throw new Error('Invalid shared raster count');
  const start = now(), rasters = [];
  const fresh = () => { const elapsed = now() - start; if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > SHARED_LIMITS.rasterBudgetMs) throw new Error('Complete shared raster budget exceeded; no partial batch submitted'); };
  for (let i=0;i<count;i++) { fresh(); rasters.push(read(i)); fresh(); }
  return rasters;
}

// Spacing keeps even eight rows of slot markers (a full 64-member session) clear of the neighbouring plot.
const MIXED_PLOT_RADIUS = 3, MIXED_COHORT_SPACING = 14, MIXED_SLOT_SPACING = 0.9, MIXED_SLOT_COLUMNS = 8;
const RESEARCH_COLOR = 0x9cc3ff, UNAVAILABLE_COLOR = 0xd6b975, HIGHLIGHT_COLOR = 0xfff3c4;
const slotOffset = (index, total) => {
  const columns = Math.min(MIXED_SLOT_COLUMNS, total), row = Math.floor(index / columns);
  return [(index % columns - (columns - 1) / 2) * MIXED_SLOT_SPACING, row * MIXED_SLOT_SPACING];
};
function addHighlight(holder, y) {
  const ring = add(new THREE.TorusGeometry(0.5, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: HIGHLIGHT_COLOR }), holder, [0, y, 0]);
  ring.rotation.x = Math.PI / 2; ring.visible = false; ring.userData.highlight = true;
}
/** A deliberately non-fly marker: an explicit absence of body, pose, sensory input and motor output. */
function addMarker(parent, position, research) {
  const color = research ? RESEARCH_COLOR : UNAVAILABLE_COLOR;
  const holder = new THREE.Group(); holder.position.set(...position); parent.add(holder);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), material(0x3d5044), holder, [0, 0.25, 0]);
  // Shape as well as colour distinguishes a research marker (octahedron) from a missing fixture pose (open ring).
  add(research ? new THREE.OctahedronGeometry(0.2) : new THREE.TorusGeometry(0.17, 0.035, 8, 24), new THREE.MeshBasicMaterial({ color, wireframe: research }), holder, [0, 0.62, 0]);
  const ring = add(new THREE.RingGeometry(0.26, 0.32, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), holder, [0, 0.01, 0]);
  ring.rotation.x = -Math.PI / 2;
  addHighlight(holder, 0.03);
  return holder;
}

/**
 * Render-only mixed presentation scene. Builds exactly one object per presented participant from a
 * validated version 1 presentation: original procedural fixture bodies at committed engineered poses,
 * explicit research markers for full-connectome participants, and explicit unavailable markers where a
 * fixture pose is missing. It never animates, interpolates or invents a pose, and it has no renderer,
 * network, command, neural or adapter authority. Each session is drawn on its own separated plot, so
 * participants from independent sessions are never shown sharing space they do not share.
 */
export function createMixedVisualWorld(scene, presentation) {
  if (!scene?.isScene) throw new Error('Expected a Three.js scene');
  readMixedWorldPresentation(presentation);
  if (!presentation.available) throw new Error('Mixed presentation unavailable; nothing is drawn.');
  const key = mixedMembershipKey(presentation), root = new THREE.Group(), objects = new Map();
  scene.add(root); addLights(root);
  const columns = Math.ceil(Math.sqrt(presentation.cohorts.length));
  presentation.cohorts.forEach((cohort, cohortIndex) => {
    const origin = [(cohortIndex % columns) * MIXED_COHORT_SPACING, Math.floor(cohortIndex / columns) * MIXED_COHORT_SPACING];
    const members = presentation.participants.filter(item => item.cohortId === cohort.cohortId);
    if (cohort.source === 'fixture') addSharedGardenPlot(root, origin, MIXED_PLOT_RADIUS);
    else {
      const rows = Math.ceil(members.length / MIXED_SLOT_COLUMNS), depth = rows * MIXED_SLOT_SPACING + 1.2;
      const pad = add(new THREE.BoxGeometry(Math.min(MIXED_SLOT_COLUMNS, members.length) * MIXED_SLOT_SPACING + 1.2, 0.1, depth), material(0x2b3d52), root, [origin[0], -0.1, origin[1] + depth / 2 - 0.6]);
      pad.add(new THREE.LineSegments(new THREE.EdgesGeometry(pad.geometry), new THREE.LineBasicMaterial({ color: RESEARCH_COLOR })));
    }
    const unplaced = members.filter(item => item.body.kind === 'unavailable');
    members.forEach((participant, index) => {
      let holder;
      if (participant.body.kind === 'fixture-procedural') {
        holder = new THREE.Group(); root.add(holder);
        addProceduralFlyBody(holder, index);
        addHighlight(holder, -0.3);
      } else {
        const [dx, dz] = slotOffset(unplaced.indexOf(participant), unplaced.length);
        // Research markers sit on the research pad; unavailable fixture markers sit outside the garden plot edge.
        holder = addMarker(root, [origin[0] + dx, 0, origin[1] + dz + (cohort.source === 'fixture' ? MIXED_PLOT_RADIUS + 0.8 : 0)], participant.source === 'connectome');
      }
      holder.userData = { individualId: participant.individualId, source: participant.source, kind: participant.source === 'connectome'
        ? 'research-marker' : participant.body.kind === 'unavailable' ? 'unavailable-marker' : 'fixture-body', origin };
      objects.set(participant.individualId, holder);
    });
  });
  const apply = next => {
    readMixedWorldPresentation(next);
    if (mixedMembershipKey(next) !== key) return false;
    for (const participant of next.participants) {
      if (participant.body.kind !== 'fixture-procedural') continue;
      const holder = objects.get(participant.individualId), [cx, cz] = holder.userData.origin, { x, z, yaw } = participant.body.pose;
      holder.position.set(cx + x, 0.33, cz + z); holder.rotation.y = yaw + Math.PI;
    }
    return true;
  };
  apply(presentation);
  const highlight = id => {
    let found = false;
    for (const [individualId, holder] of objects) {
      const on = individualId === id; found ||= on;
      holder.traverse(object => { if (object.userData.highlight) object.visible = on; });
    }
    return found;
  };
  const dispose = () => {
    scene.remove(root);
    root.traverse(object => { object.geometry?.dispose(); if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) mat.dispose(); });
  };
  const extent = [Math.min(columns, presentation.cohorts.length), Math.ceil(presentation.cohorts.length / columns)];
  return { root, objects, key, apply, highlight, dispose,
    center: [(extent[0] - 1) * MIXED_COHORT_SPACING / 2, (extent[1] - 1) * MIXED_COHORT_SPACING / 2], span: Math.max(...extent) * MIXED_COHORT_SPACING };
}
