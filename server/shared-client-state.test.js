import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSharedBundle, currentSharedRequest, selectedSharedMember } from '../client/src/shared-state.js';
const bundle = (id, epoch, sequence, tick, status='running') => ({ shared:{sharedId:id,worldEpoch:epoch,commandSequence:sequence,tick,worldTimeMs:tick*5,status,
  participants:[{individualId:'a',sessionId:'s',simTimeMs:tick*5,pose:{x:tick/100,z:0,yaw:0},status}]},
  members:[{individualId:'a',sessionId:'s',commandSequence:1,tick,simTimeMs:tick*5,status,neural:{tick},sharedSession:{sharedId:id}}] });
test('delayed saves and lower sequences cannot rewind committed shared state',()=>{
  const current=bundle('group','epoch',2,20);
  assert.equal(mergeSharedBundle(current,bundle('group','epoch',2,19),'mutation'),current);
  assert.equal(mergeSharedBundle(current,bundle('group','epoch',1,21),'mutation'),current);
  const pause=mergeSharedBundle(current,bundle('group','quiet',3,19,'paused'),'mutation');
  assert.equal(pause.shared.tick,20);assert.equal(pause.shared.status,'paused');assert.equal(pause.shared.worldEpoch,'quiet');
  assert.equal(pause.members[0].tick,20);assert.equal(pause.members[0].status,'paused');assert.deepEqual(pause.shared.participants[0].pose,current.shared.participants[0].pose);
});
test('old frames cannot replace restored groups or epochs and request context scopes mutations',()=>{
  const current=bundle('restored','new',0,2,'paused');
  assert.equal(mergeSharedBundle(current,bundle('old','old',99,200),'frame'),current);
  assert.equal(mergeSharedBundle(current,bundle('restored','stale',0,3),'frame'),current);
  const context={generation:4,selectedId:'a',sharedId:'old'};
  assert.equal(currentSharedRequest(context,{generation:5,selectedId:'a',sharedId:'restored'}),false);
  assert.equal(currentSharedRequest(context,{generation:4,selectedId:'b',sharedId:'old'}),false);
  assert.equal(currentSharedRequest(context,{generation:4,selectedId:'a',sharedId:'old'}),true);
  assert.equal(Object.hasOwn(mergeSharedBundle(null,{...current,controllerToken:'private'},'mutation'),'controllerToken'),false);
});

test('same-group identity selection retains exact member state while stale sessions cannot inherit ownership', () => {
  const current=bundle('pair','epoch',2,20);
  current.shared.participants.push({...current.shared.participants[0],individualId:'b',sessionId:'session-b'});
  current.members.push({...current.members[0],individualId:'b',sessionId:'session-b'});
  const selected=selectedSharedMember(current,'b');
  assert.equal(selected,current.members[1]);assert.equal(selected.sharedSession.sharedId,current.shared.sharedId);
  assert.equal(selectedSharedMember(current,'a'),current.members[0]);
  assert.equal(selectedSharedMember(current,'unrelated'),null);
  assert.equal(selectedSharedMember({...current,shared:{...current.shared,status:'separated'}},'b'),null);
  const stale=structuredClone(current);stale.members[1].sessionId='old-session';
  assert.equal(selectedSharedMember(stale,'b'),null);
  // A command response begun for the formerly selected recipient is still rejected.
  assert.equal(currentSharedRequest({generation:4,selectedId:'a',sharedId:'pair'},
    {generation:5,selectedId:'b',sharedId:'pair'}),false);
  // A current camera response remains scoped to the group, not inspector selection.
  const advanced=structuredClone(current);advanced.shared.tick=21;
  assert.deepEqual(mergeSharedBundle(current,advanced,'frame'),advanced);
});
