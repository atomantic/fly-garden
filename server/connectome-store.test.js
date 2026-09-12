import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openConnectomeStore, restoreConnectomeBackup } from './connectome-store.js';
import { createSparseLif } from './sparse-lif.js';
const graph = dataset => ({ ids:[1,2,3].map(id=>`${dataset}/${id}`),offsets:new Uint32Array([0,1,2,3]),targets:new Uint32Array([1,2,0]),contacts:new Uint32Array([1200,1200,1200]),signs:new Int8Array([1,1,1]) });
const datasets=['male-cns:v1.0','banc:v888'];
const profiles=Object.fromEntries(datasets.map(dataset=>[dataset,{directory:`/trusted/${dataset}`,manifestSha256:'ab'.repeat(32),graphSha256:createSparseLif(graph(dataset),{dataset}).graphSha256,neuronCount:3,edgeCount:3}]));
function directory(t){const path=mkdtempSync(join(tmpdir(),'connectome-store-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
function open(t, options={}){const path=directory(t);const store=openConnectomeStore(path,{profiles,...options});t.after(()=>store.close());return{path,store};}
function kernel(identity){return createSparseLif(graph(identity.dataset),{individualId:identity.individualId,dataset:identity.dataset});}
function save(store,identity,checkpoint,operation='save',sourceCheckpointId=null){const current=store.identities().find(i=>i.individualId===identity.individualId);return store.persistCheckpoint({individualId:identity.individualId,dataset:identity.dataset,parentId:current.checkpointId,checkpoint,operation,sourceCheckpointId});}
test('explicit unloaded identities preserve exact profiles; lazy independent checkpoints survive reopen',t=>{
 const{path,store}=open(t);assert.deepEqual(store.identities(),[]);
 const a=store.create(datasets[0]),b=store.create(datasets[1]);assert.equal(a.status,'saved-unloaded');assert.notEqual(a.individualId,b.individualId);
 const ka=kernel(a);ka.seedProbe([0]);ka.step();const saved=save(store,a,ka.checkpoint());
 save(store,b,kernel(b).checkpoint());assert.equal(store.readCheckpoint(a.individualId,saved.checkpointId).tick,1);
 assert.equal('checkpoint' in store.identities()[0],false);assert.equal('directory' in JSON.parse(readFileSync(join(path,'catalog.json'))).individuals[0],false);
 assert.throws(()=>store.readCheckpoint(b.individualId,saved.checkpointId),/belong/);store.close();
 const reopened=openConnectomeStore(path,{profiles});t.after(()=>reopened.close());assert.equal(reopened.identities()[0].individualId,a.individualId);
 assert.equal(reopened.readCheckpoint(a.individualId,saved.checkpointId).graphSha256,profiles[a.dataset].graphSha256);
});
test('exclusive writer guard, unknown profile and nonempty directory never replace existing files',t=>{
 const{path,store}=open(t);assert.throws(()=>openConnectomeStore(path,{profiles}),/already open/);assert.throws(()=>store.create('unknown'));
 const other=directory(t);writeFileSync(join(other,'precious'),'keep');assert.throws(()=>openConnectomeStore(other,{profiles}),/nonempty/);assert.equal(readFileSync(join(other,'precious'),'utf8'),'keep');
});
test('failed create/save/restore head writes preserve catalog and recover with inert immutable orphans',t=>{
 let fail=false;const {path,store}=open(t,{writeCatalog:(path,bytes)=>{if(fail)throw new Error('disk full');writeFileSync(path,bytes);}});
 const a=store.create(datasets[0]),k=kernel(a),first=save(store,a,k.checkpoint());const original=k.checkpoint();
 let before=readFileSync(join(path,'catalog.json'),'utf8');fail=true;
 assert.throws(()=>store.create(datasets[1]),/disk full/);assert.equal(readFileSync(join(path,'catalog.json'),'utf8'),before);
 k.seedProbe([0]);k.step();assert.throws(()=>save(store,a,k.checkpoint()),/disk full/);
 assert.throws(()=>save(store,a,original,'restore',first.checkpointId),/disk full/);assert.equal(store.identities()[0].checkpointId,first.checkpointId);
 assert.equal(readFileSync(join(path,'catalog.json'),'utf8'),before);assert.equal(readdirSync(join(path,'checkpoints')).length,3);
 store.close();const reopened=openConnectomeStore(path,{profiles});t.after(()=>reopened.close());assert.equal(reopened.checkpoints(a.individualId).length,1);
 assert.equal(reopened.readCheckpoint(a.individualId,first.checkpointId).tick,0);
});
test('checkpoint state, model, graph and recipient validation precedes file creation',t=>{
 const{path,store}=open(t),a=store.create(datasets[0]),base=kernel(a).checkpoint();
 for(const mutate of [p=>p.individualId='other',p=>p.dataset=datasets[1],p=>p.model.dtMs=2,p=>p.graphSha256='00'.repeat(32),p=>p.potential[0]=Infinity,p=>p.refractory[0]=1,p=>p.totalSpikes=1,p=>p.extra=true]){const bad=structuredClone(base);mutate(bad);assert.throws(()=>save(store,a,bad));}
 assert.deepEqual(readdirSync(join(path,'checkpoints')),[]);assert.throws(()=>store.readCheckpoint(a.individualId,'../../catalog.json'),/Invalid/);
});
test('restore appends explicit lineage and immutable history; stale writer cannot change selected head',t=>{
 const{store}=open(t),a=store.create(datasets[0]),k=kernel(a),initial=k.checkpoint(),one=save(store,a,initial);k.seedProbe([0]);k.step();const two=save(store,a,k.checkpoint());
 const restored=save(store,a,initial,'restore',one.checkpointId);const history=store.checkpoints(a.individualId);assert.equal(history[2].parentId,two.checkpointId);assert.equal(history[2].restoredFrom,one.checkpointId);
 assert.equal(store.readCheckpoint(a.individualId,restored.checkpointId).tick,0);
 assert.throws(()=>store.persistCheckpoint({individualId:a.individualId,dataset:a.dataset,parentId:one.checkpointId,checkpoint:initial,operation:'save'}),/Stale/);
 assert.equal(store.identities()[0].checkpointId,restored.checkpointId);
});
test('corrupt payload, symlink and catalog checksum reject on reopen without alteration',t=>{
 const{path,store}=open(t),a=store.create(datasets[0]),saved=save(store,a,kernel(a).checkpoint());store.close();
 const file=join(path,'checkpoints',`${saved.checkpointId}.json`),original=readFileSync(file);writeFileSync(file,'{}');assert.throws(()=>openConnectomeStore(path,{profiles}),/corrupt/);writeFileSync(file,original);
 rmSync(file);symlinkSync(join(path,'catalog.json'),file);assert.throws(()=>openConnectomeStore(path,{profiles}));rmSync(file);writeFileSync(file,original);
 const catalog=JSON.parse(readFileSync(join(path,'catalog.json')));catalog.individuals[0].head=null;writeFileSync(join(path,'catalog.json'),JSON.stringify(catalog));assert.throws(()=>openConnectomeStore(path,{profiles}),/corrupt/);
});
test('backup includes all referenced history, restores only to a new directory and validates before creation',t=>{
 const{store}=open(t),a=store.create(datasets[0]),k=kernel(a);save(store,a,k.checkpoint());k.seedProbe([0]);k.step();save(store,a,k.checkpoint());
 const root=directory(t),backup=join(root,'backup'),target=join(root,'recovered');assert.equal(store.backup(backup).checkpointCount,2);
 assert.throws(()=>store.backup(backup),/exist/);restoreConnectomeBackup(backup,target,{profiles});const restored=openConnectomeStore(target,{profiles});t.after(()=>restored.close());assert.equal(restored.checkpoints(a.individualId).length,2);
 assert.throws(()=>restoreConnectomeBackup(backup,target,{profiles}),/exist/);
 const head=store.identities()[0].checkpointId;writeFileSync(join(backup,'checkpoints',`${head}.json`),'corrupt');assert.throws(()=>restoreConnectomeBackup(backup,join(root,'bad'),{profiles}));assert.equal(readdirSync(root).includes('bad'),false);
});

test('duplicate payload restores retain the exact chosen source, refusing absent or foreign source IDs',t=>{
 const{store}=open(t),a=store.create(datasets[0]),b=store.create(datasets[0]),payload=kernel(a).checkpoint();
 const one=save(store,a,payload),two=save(store,a,payload),foreign=save(store,b,kernel(b).checkpoint());
 assert.throws(()=>save(store,a,payload,'restore'),/identifier/);assert.throws(()=>save(store,a,payload,'restore',foreign.checkpointId),/belong/);
 const restored=save(store,a,payload,'restore',two.checkpointId);assert.equal(store.checkpoints(a.individualId).at(-1).restoredFrom,two.checkpointId);
 assert.notEqual(store.checkpoints(a.individualId).at(-1).restoredFrom,one.checkpointId);assert.equal(store.identities()[0].checkpointId,restored.checkpointId);
});

test('post-rename directory sync failure exposes actual selected head and faults activation/writes until reopen', t => {
 for (const operation of ['save','unload','restore']) {
  let fail=false; const {path,store}=open(t,{syncCatalogDirectory:()=>{if(fail)throw new Error('directory fsync failed');}});
  const a=store.create(datasets[0]),k=kernel(a),initial=k.checkpoint(),first=save(store,a,initial);
  k.seedProbe([0]);k.step();save(store,a,k.checkpoint());k.step();
  const target=operation==='restore'?initial:k.checkpoint(),prior=store.identities()[0].checkpointId;fail=true;
  let uncertain;assert.throws(()=>save(store,a,target,operation,operation==='restore'?first.checkpointId:null),error=>{uncertain=error;return error.code==='CONNECTOME_DURABILITY_UNCERTAIN';});
  const disk=JSON.parse(readFileSync(join(path,'catalog.json'))),head=disk.individuals[0].head;
  assert.notEqual(head,prior);assert.equal(uncertain.selectedCheckpointId,head);assert.equal(uncertain.individualId,a.individualId);
  assert.equal(store.identities()[0].checkpointId,head);
  assert.throws(()=>store.readCheckpoint(a.individualId,head),error=>error.code==='CONNECTOME_STORE_RECOVERY_REQUIRED');
  assert.throws(()=>store.create(datasets[1]),/close and reopen/);assert.throws(()=>save(store,a,target),/close and reopen/);
  assert.throws(()=>store.backup(join(directory(t),'blocked')),/close and reopen/);
  store.close();const reopened=openConnectomeStore(path,{profiles});t.after(()=>reopened.close());
  assert.deepEqual(reopened.readCheckpoint(a.individualId,head),target);
  if(operation==='restore')assert.equal(reopened.checkpoints(a.individualId).at(-1).restoredFrom,first.checkpointId);
 }
});
test('backup and restore reject source descendants and symlink aliases before creating anything',t=>{
 const{path,store}=open(t),a=store.create(datasets[0]),payload=kernel(a).checkpoint();save(store,a,payload);
 const outside=directory(t),alias=join(outside,'alias');symlinkSync(join(path,'checkpoints'),alias);
 for(const target of [path,join(path,'nested'),join(path,'checkpoints','nested'),join(alias,'nested')])assert.throws(()=>store.backup(target),/outside its source/);
 assert.equal(readdirSync(join(path,'checkpoints')).length,1);save(store,a,payload);
 const backup=join(outside,'backup');store.backup(backup);const backupAlias=join(outside,'backup-alias');symlinkSync(join(backup,'checkpoints'),backupAlias);
 for(const target of [backup,join(backup,'nested'),join(backup,'checkpoints','nested'),join(backupAlias,'nested')])assert.throws(()=>restoreConnectomeBackup(backup,target,{profiles}),/outside its source/);
 const recovered=join(outside,'recovered');restoreConnectomeBackup(backup,recovered,{profiles});const reopened=openConnectomeStore(recovered,{profiles});t.after(()=>reopened.close());
 assert.equal(reopened.checkpoints(a.individualId).length,2);assert.equal(readdirSync(join(backup,'checkpoints')).length,2);
});


test('rehashed catalog cannot attribute a restored payload to a different source on reopen or offline restore', t => {
 const {path,store}=open(t),a=store.create(datasets[0]),k=kernel(a),initial=k.checkpoint(),first=save(store,a,initial);
 k.seedProbe([0]);k.step();const different=save(store,a,k.checkpoint());
 save(store,a,initial,'restore',first.checkpointId);
 const root=directory(t),backup=join(root,'backup');store.backup(backup);store.close();
 const digest=catalog=>createHash('sha256').update(JSON.stringify({schemaVersion:catalog.schemaVersion,kind:catalog.kind,individuals:catalog.individuals})).digest('hex');
 for(const source of [path,backup]) {
  const file=join(source,'catalog.json'),catalog=JSON.parse(readFileSync(file));
  catalog.individuals[0].checkpoints.at(-1).restoredFrom=different.checkpointId;
  catalog.sha256=digest(catalog);writeFileSync(file,JSON.stringify(catalog));
 }
 const before=readFileSync(join(path,'catalog.json'));
 assert.throws(()=>openConnectomeStore(path,{profiles}),/corrupt/);
 assert.deepEqual(readFileSync(join(path,'catalog.json')),before);
 const target=join(root,'must-not-exist');
 assert.throws(()=>restoreConnectomeBackup(backup,target,{profiles}),/corrupt/);
 assert.equal(readdirSync(root).includes('must-not-exist'),false);
});
