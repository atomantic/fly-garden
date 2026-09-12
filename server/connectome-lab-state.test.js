import test from 'node:test';
import assert from 'node:assert/strict';
import {currentLabRequest,labCommand,mergeConnectomeState,readConnectomeState,readConnectomeHistory,readLabCommandReply,selectConnectomePair,mergeConnectomeSelection} from '../client/src/connectome-lab-state.js';
const state={protocolVersion:1,source:'connectome',dataset:'banc:v888',individualId:'a',sessionEpoch:'epoch',commandSequence:2,resident:true,status:'paused',neural:{tick:20,simTimeMs:20,spikes:0,totalSpikes:0,traversedEdges:0,minimum:0,maximum:0}};
test('lab response guards reject changed identity, worker session and request generation',()=>{
 const context={generation:4,individualId:'a',sessionEpoch:'epoch'};
 assert.equal(currentLabRequest(context,context),true);
 for(const current of [{...context,generation:5},{...context,individualId:'b'},{...context,sessionEpoch:'restored'}])assert.equal(currentLabRequest(context,current),false);
 assert.equal(currentLabRequest({...context,sessionEpoch:null},context),true);
 assert.equal(mergeConnectomeState(state,{...state,commandSequence:1}),state);
 assert.equal(mergeConnectomeState(state,{...state,neural:{...state.neural,tick:19}}),state);
 const restored={...state,sessionEpoch:'restored',neural:{...state.neural,tick:0}};
 assert.equal(mergeConnectomeState(state,restored),restored);
});
test('lab validates summary metadata and creates exact bounded current-sequence commands',()=>{
 assert.equal(readConnectomeState(state),state);
 for(const change of [{source:'fixture'},{dataset:'wrong'},{sessionEpoch:null},{commandSequence:-1},{neural:{...state.neural,minimum:NaN}}])assert.throws(()=>readConnectomeState({...state,...change}));
 assert.deepEqual(labCommand(state,'restore',100,'saved-id'),{protocolVersion:1,individualId:'a',sessionEpoch:'epoch',commandSequence:2,action:'restore',steps:null,checkpointId:'saved-id'});
 assert.equal(labCommand(state,'advance',1000,null).steps,1000);
 for(const count of [0,1001,1.5,NaN,Infinity])assert.throws(()=>labCommand(state,'advance',count,null));
 assert.equal(labCommand(state,'start',100,'ignored').steps,null);
});

test('history validation rejects cross-individual sources and unrenderable dates',()=>{
 const entry={checkpointId:'saved',parentId:null,restoredFrom:null,operation:'save',tick:1,createdAt:Date.now(),bytes:100,sha256:'a'.repeat(64)};
 const history={individualId:'a',checkpoints:[entry]};
 assert.equal(readConnectomeHistory(history,'a'),history.checkpoints);
 assert.throws(()=>readConnectomeHistory(history,'b'));
 for(const change of [{createdAt:8640000000000001},{sha256:'bad'},{tick:-1}])assert.throws(()=>readConnectomeHistory({...history,checkpoints:[{...entry,...change}]},'a'));
 assert.throws(()=>readConnectomeHistory({...history,checkpoints:Array(65).fill(entry)},'a'));
});

test('mutation replies preserve recipient dataset and action-scoped worker epoch',()=>{
 assert.equal(readLabCommandReply(state,state,'save'),state);
 assert.throws(()=>readLabCommandReply(state,{...state,individualId:'other'},'save'));
 assert.throws(()=>readLabCommandReply(state,{...state,dataset:'male-cns:v1.0'},'restore'));
 const rotated={...state,sessionEpoch:'new'};
 for(const action of ['save','start','advance','pause','rest','home'])assert.throws(()=>readLabCommandReply(state,rotated,action));
 for(const action of ['load','restore','unload'])assert.equal(readLabCommandReply(state,rotated,action),rotated);
});

test('atomic ID/dataset selection survives immediate atlas navigation and delayed metadata',()=>{
 const initial={individualId:'male',dataset:'male-cns:v1.0'};
 const selected=selectConnectomePair(initial,'female','banc:v888');
 assert.deepEqual(selected,{individualId:'female',dataset:'banc:v888'},'dataset is available before any selected GET completes');
 assert.equal(mergeConnectomeSelection(selected,{...state,individualId:'male',dataset:'male-cns:v1.0'}),selected,'old metadata cannot replace a new selection');
 assert.equal(mergeConnectomeSelection(selected,{...state,individualId:'female',dataset:'male-cns:v1.0'}),selected,'foreign dataset cannot attach to a selected ID');
 assert.deepEqual(mergeConnectomeSelection(selected,{...state,individualId:'female'}),selected);
 const cleared=selectConnectomePair(selected,'','male-cns:v1.0');
 assert.deepEqual(cleared,{individualId:'',dataset:'male-cns:v1.0'});
 assert.equal(mergeConnectomeSelection(cleared,{...state,individualId:'female'}),cleared,'a late effect cannot restore selection after an atlas profile switch');
 assert.deepEqual(selectConnectomePair(selected,''),{individualId:'',dataset:'banc:v888'});
 assert.throws(()=>selectConnectomePair(selected,'foreign','unrecognized'));
});
