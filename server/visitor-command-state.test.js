import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeToolbarVisitorReply } from '../client/src/visitor-command-state.js';
const before={individualId:'a',sessionId:'old',tick:10,commandSequence:1,status:'running'};
const reply={...before,commandSequence:2,status:'paused'};
const request={generation:3,individualId:'a',sessionId:'old'};
test('current toolbar visitor reply applies, while stale generation/recipient/session never replaces newer state',()=>{
  assert.equal(mergeToolbarVisitorReply(before,reply,request,{generation:3,selectedId:'a'}),reply);
  for(const current of [{generation:4,selectedId:'a'},{generation:3,selectedId:'b'}])assert.equal(mergeToolbarVisitorReply(before,reply,request,current),before);
  const restored={...before,sessionId:'restored',tick:2,commandSequence:3};
  assert.equal(mergeToolbarVisitorReply(restored,reply,request,{generation:3,selectedId:'a'}),restored);
  assert.equal(mergeToolbarVisitorReply(before,{...reply,sessionId:'wrong'},request,{generation:3,selectedId:'a'}),before);
  const newer={...before,commandSequence:4};
  assert.equal(mergeToolbarVisitorReply(newer,reply,request,{generation:3,selectedId:'a'}),newer);
});
