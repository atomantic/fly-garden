import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openIdentityStore, validateIdentityDocument } from './identity-store.js';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function setup(t) { const path = mkdtempSync(join(tmpdir(), 'fixture-pose-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function move(store, id) {
 const lease = store.environmentControl(id, 'attach'); store.control(id, 'start');
 const frame = { controllerToken: lease.controllerToken, version: 1, individualId: id, sessionId: lease.sessionId,
  environmentEpoch: store.environmentSnapshot(id).environmentEpoch, frameId: 0, simTimeMs: lease.simTimeMs,
  capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4, rgb: Array(96).fill(255) };
 // Actual tiny fixture stepping only; no complete graph is loaded.
 for(let i=0;i<200;i++){ frame.frameId=i;frame.simTimeMs=store.snapshot(id).simTimeMs;frame.capturedAtMs=Date.now();store.environmentFrame(id,frame); }
 return { frame, pose: store.environmentSnapshot(id).pose };
}
test('pose and exact neural checkpoint survive restore, unload and reboot without sensory authority', t => {
 const path=setup(t); let store=openIdentityStore(path);t.after(()=>store.close()); const id=store.primaryId;
 const legacy=store.snapshot().persistence.checkpointId;
 const {frame,pose}=move(store,id); assert.notDeepEqual(pose,{x:0,z:0,yaw:0});
 const saved=store.save(id), tick=saved.tick;store.control(id,'home');
 const restored=store.restore(id,saved.persistence.checkpointId);
 assert.equal(restored.status,'paused');assert.equal(restored.tick,tick);assert.equal(restored.environmentAdapter.attached,false);
 assert.deepEqual(restored.environmentAdapter.pose,pose);assert.throws(()=>store.environmentFrame(id,frame));
 const fresh=store.environmentControl(id,'attach');assert.notEqual(fresh.controllerToken,frame.controllerToken);assert.deepEqual(fresh.environmentAdapter.pose,pose);
 assert.equal(fresh.status,'paused');assert.equal(fresh.environmentAdapter.lastTrace,null);
 assert.throws(()=>store.environmentFrame(id,{...frame,sessionId:fresh.sessionId,environmentEpoch:fresh.environmentAdapter.environmentEpoch}));
 store.unload(id);assert.deepEqual(store.load(id).environmentAdapter.pose,pose);store.close();store=openIdentityStore(path);
 assert.equal(store.snapshot(id).status,'paused');assert.deepEqual(store.environmentSnapshot(id).pose,pose);
 assert.equal(readFileSync(join(path,'identities.json'),'utf8').includes(frame.controllerToken),false);
 store.restore(id,legacy);assert.equal(store.environmentSnapshot(id).pose,null);
 assert.deepEqual(store.environmentControl(id,'attach').environmentAdapter.pose,{x:0,z:0,yaw:0});
});
test('corrupt or rehashed invalid pose rejects before activation and backup document validation',t=>{
 const path=setup(t),store=openIdentityStore(path);const id=store.primaryId;move(store,id);store.save(id);store.close();
 const original=JSON.parse(readFileSync(join(path,'identities.json')));
 for(const pose of [{x:3,z:0,yaw:0},{x:0,z:0,yaw:0,controllerToken:'secret'},{x:0,z:0,yaw:null}]){
  const bad=structuredClone(original), cp=bad.individuals[0].checkpoints.at(-1);cp.embodiment.pose=pose;cp.sha256=hash({payload:cp.payload,embodiment:cp.embodiment});
  assert.throws(()=>validateIdentityDocument(bad));writeFileSync(join(path,'identities.json'),JSON.stringify(bad));assert.throws(()=>openIdentityStore(path));
 }
 writeFileSync(join(path,'identities.json'),JSON.stringify(original));const recovered=openIdentityStore(path);assert.equal(recovered.snapshot().status,'paused');recovered.close();
});
test('failed pose checkpoint write preserves the prior head, current pose and another individual',t=>{
 const path=setup(t);let fail=false;const store=openIdentityStore(path,{write:(path,text)=>{if(fail)throw new Error('injected writer failure');writeFileSync(path,text);}});t.after(()=>store.close());
 const id=store.primaryId,other=store.create().individualId;store.load(other);const otherBefore=store.snapshot(other);
 const old=store.snapshot(id).persistence.checkpointId;const {pose}=move(store,id);fail=true;
 assert.throws(()=>store.save(id),/injected/);assert.equal(store.snapshot(id).status,'fault');
 assert.equal(store.snapshot(id).persistence.checkpointId,old);assert.deepEqual(store.environmentSnapshot(id).pose,pose);
 assert.deepEqual(store.snapshot(other),otherBefore);assert.equal(JSON.parse(readFileSync(join(path,'identities.json'))).individuals[0].head,old);
});
