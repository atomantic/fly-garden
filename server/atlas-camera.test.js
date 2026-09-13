import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { moveAtlasCamera, shouldFitAtlas } from '../client/src/atlas-camera.js';
function setup() { const camera = new PerspectiveCamera(); camera.position.set(0,0,10); camera.lookAt(0,0,0); let updates=0;
 return { camera, controls:{target:new Vector3(),minDistance:1,maxDistance:20,update:()=>updates++}, updates:()=>updates }; }
test('keyboard pan shifts camera and target together in screen axes without orbiting or zooming',()=>{
 const s=setup();s.camera.position.set(10,0,0);s.camera.lookAt(0,0,0);const offset=s.camera.position.clone().sub(s.controls.target);
 moveAtlasCamera(s.camera,s.controls,'pan-right');assert(s.controls.target.distanceTo(new Vector3())>0);
 assert(s.camera.position.clone().sub(s.controls.target).distanceTo(offset)<1e-12);assert.equal(s.updates(),1);
 moveAtlasCamera(s.camera,s.controls,'pan-left');assert(s.controls.target.length()<1e-12);
});
test('discrete zoom respects distance bounds, rotation keeps target, unknown controls do nothing',()=>{
 const s=setup();for(let i=0;i<100;i++)moveAtlasCamera(s.camera,s.controls,'in');assert.equal(s.camera.position.distanceTo(s.controls.target),1);
 for(let i=0;i<100;i++)moveAtlasCamera(s.camera,s.controls,'out');assert.equal(s.camera.position.distanceTo(s.controls.target),20);
 moveAtlasCamera(s.camera,s.controls,'up');assert.equal(s.controls.target.length(),0);assert(Math.abs(s.camera.position.length()-20)<1e-12);
 const before=s.camera.position.clone(),n=s.updates();assert.equal(moveAtlasCamera(s.camera,s.controls,'invalid'),false);assert.deepEqual(s.camera.position,before);assert.equal(s.updates(),n);
});

test('checkbox filtering preserves camera while repeated explicit presets request fitting',()=>{
 assert.equal(shouldFitAtlas(false,0,0,2),true);
 assert.equal(shouldFitAtlas(true,0,0,1),false);
 assert.equal(shouldFitAtlas(true,0,1,1),true);
 assert.equal(shouldFitAtlas(true,1,2,1),true);
 assert.equal(shouldFitAtlas(true,1,2,0),false);
});

test('reselecting a cell or self-edge focuses inspector without clearing loaded or pending adjacency',async()=>{
 const {selectAtlasCell}=await import('../client/src/atlas-selection.js');let focused=0,changed=0;
 const callbacks={focusHeading:()=>focused++,changeSelection:()=>changed++};
 selectAtlasCell(3,3,true,callbacks);selectAtlasCell(3,3,true,callbacks);
 assert.equal(focused,2);assert.equal(changed,0);
 selectAtlasCell(3,4,true,callbacks);assert.equal(changed,1);assert.equal(focused,2);
 selectAtlasCell(3,3,false,callbacks);assert.equal(focused,2);assert.equal(changed,1);
});
