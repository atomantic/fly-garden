import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync, existsSync, mkdirSync } from 'node:fs';
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
test('a real schema-1 catalog reopens with independent checkpoint compatibility', t => {
  const path = directory(t), dataset = datasets[0], individualId = randomUUID(), checkpoint = kernel({ individualId, dataset }).checkpoint();
  const descriptor = { dataset, graphSha256: profiles[dataset].graphSha256, manifestSha256: profiles[dataset].manifestSha256, neuronCount: 3, edgeCount: 3, modelId: 'malecns-traced-lif-v1' };
  const bytes = Buffer.from(JSON.stringify(checkpoint)), item = { checkpointId: randomUUID(), parentId: null, restoredFrom: null, operation: 'save', createdAt: Date.now(), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, tick: checkpoint.tick };
  const individual = { individualId, descriptor, createdAt: Date.now(), head: item.checkpointId, checkpoints: [item] };
  const catalog = { schemaVersion: 1, kind: 'connectome-catalog', individuals: [individual] };
  catalog.sha256 = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, kind: 'connectome-catalog', individuals: catalog.individuals })).digest('hex');
  mkdirSync(join(path, 'checkpoints'), { mode: 0o700 }); writeFileSync(join(path, 'catalog.json'), JSON.stringify(catalog)); writeFileSync(join(path, 'checkpoints', `${item.checkpointId}.json`), bytes);
  const store = openConnectomeStore(path, { profiles }); t.after(() => store.close());
  assert.deepEqual(store.identities().map(value => value.individualId), [individualId]);
  assert.equal(store.checkpoints(individualId)[0].operation, 'save');
  assert.equal(store.readCheckpoint(individualId, item.checkpointId).tick, checkpoint.tick);
  store.close();
  const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(reopened.identities()[0].checkpointId, item.checkpointId);
});

test('catalog capacity refusal preserves the selected head and reopens with the documented default', t => {
  const { path, store } = open(t, { catalogCapacityBytes: 4096 }), a = store.create(datasets[0]), k = kernel(a);
  let refusal = null;
  for (let index = 0; index < 100; index++) {
    try { save(store, a, k.checkpoint()); } catch (error) { refusal = error; break; }
  }
  assert.match(refusal?.message ?? '', /catalog capacity/);
  const head = store.identities()[0].checkpointId, catalog = readFileSync(join(path, 'catalog.json'));
  assert.throws(() => save(store, a, k.checkpoint()), /catalog capacity/);
  assert.equal(store.identities()[0].checkpointId, head); assert.deepEqual(readFileSync(join(path, 'catalog.json')), catalog);
  store.close();
  const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(reopened.identities()[0].checkpointId, head);
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
test('checkpoint history capacity refusal preserves the selected head and reopens cleanly', t => {
  const { path, store } = open(t), a = store.create(datasets[0]), k = kernel(a);
  for (let index = 0; index < 64; index++) save(store, a, k.checkpoint());
  const head = store.identities()[0].checkpointId, before = readFileSync(join(path, 'catalog.json'));
  assert.throws(() => save(store, a, k.checkpoint()), /history capacity/);
  assert.equal(store.identities()[0].checkpointId, head); assert.deepEqual(readFileSync(join(path, 'catalog.json')), before);
  store.close(); const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(reopened.identities()[0].checkpointId, head); assert.equal(reopened.checkpoints(a.individualId).length, 64);
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
 const head=store.identities()[0].checkpointId;writeFileSync(join(backup,'checkpoints',`${head}.json`),'corrupt');assert.throws(()=>restoreConnectomeBackup(backup,join(root,'bad'),{profiles}));  assert.equal(readdirSync(root).includes('bad'),false);
});

test('joint checkpoint writes and restores every member head as one catalog transaction', t => {
  let fail = false;
  const { path, store } = open(t, { writeCatalog: (file, bytes) => { if (fail) throw new Error('disk full'); writeFileSync(file, bytes); } });
  const a = store.create(datasets[0]), b = store.create(datasets[1]);
  const ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  const members = () => store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' }));
  const first = store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: members() });
  assert.equal(first.payload.members.length, 2); assert.equal(store.jointCheckpoints().length, 1);
  const before = readFileSync(join(path, 'catalog.json')); fail = true;
  assert.throws(() => store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: members() }), /disk full/);
  assert.deepEqual(readFileSync(join(path, 'catalog.json')), before); assert.equal(store.jointCheckpoints().length, 1);
  fail = false;
  const prepared = store.prepareJointRestore(first.jointCheckpointId);
  const restored = store.commitJointRestore(prepared.token);
  assert.equal(restored.members.length, 2);
  assert.deepEqual(store.identities().map(identity => identity.checkpointId), restored.members.map(member => member.checkpointId));
  assert.equal(store.checkpoints(a.individualId).at(-1).operation, 'restore');
  assert.equal(store.checkpoints(b.individualId).at(-1).operation, 'restore');
  store.close(); const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(reopened.readJointCheckpoint(first.jointCheckpointId).payload.members.length, 2);
});

test('joint restore preflights staged durability before exposing a transaction', t => {
  let fail = false;
  const { path, store } = open(t, { syncCatalogDirectory: () => { if (fail) throw new Error('directory fsync failed'); } });
  const a = store.create(datasets[0]), b = store.create(datasets[1]), ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  const joint = store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' })) });
  const before = store.identities().map(identity => identity.checkpointId);
  fail = true;
  assert.throws(() => store.prepareJointRestore(joint.jointCheckpointId), /directory fsync failed/);
  assert.deepEqual(store.identities().map(identity => identity.checkpointId), before);
  assert.deepEqual(store.jointCheckpoints().map(value => value.jointCheckpointId), [joint.jointCheckpointId]);
  fail = false; store.close();
  const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.deepEqual(reopened.identities().map(identity => identity.checkpointId), before);
});
test('malformed joint transaction metadata rejects schema-2 catalog reopen', t => {
  const { path, store } = open(t), a = store.create(datasets[0]), b = store.create(datasets[1]), ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' })) });
  store.close();
  const file = join(path, 'catalog.json'), catalog = JSON.parse(readFileSync(file));
  catalog.jointCheckpoints[0].payload.members[0].mode = 'sleeping';
  catalog.sha256 = createHash('sha256').update(JSON.stringify({ schemaVersion: 2, kind: 'connectome-catalog', individuals: catalog.individuals, jointCheckpoints: catalog.jointCheckpoints })).digest('hex');
  writeFileSync(file, JSON.stringify(catalog));
  assert.throws(() => openConnectomeStore(path, { profiles }), /corrupt|incompatible/);
  assert.deepEqual(readFileSync(file), Buffer.from(JSON.stringify(catalog)));
});

test('prepared joint restore tokens can be cancelled without retaining checkpoint payloads', t => {
   const { store } = open(t), a = store.create(datasets[0]), b = store.create(datasets[1]), ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  const members = store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' }));
  const joint = store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members });
  const prepared = store.prepareJointRestore(joint.jointCheckpointId);
  assert.equal(store.cancelJointRestore(prepared.token), true);
  assert.throws(() => store.commitJointRestore(prepared.token), /Unknown or stale/);
  assert.equal(store.cancelJointRestore(prepared.token), false);
});

test('projected file ceiling refuses before writes and staged restore cleanup does not accumulate', t => {
  let fail = false;
  const { path, store } = open(t, { syncCatalogDirectory: () => { if (fail) throw new Error('directory fsync failed'); } });
  const checkpointDirectory = join(path, 'checkpoints');
  const a = store.create(datasets[0]), b = store.create(datasets[1]), ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  const joint = store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' })) });
  const fill = count => { for (let index = 0; index < count; index++) writeFileSync(join(checkpointDirectory, `${randomUUID()}.json`), '{}'); };
  fill(8185); assert.equal(readdirSync(checkpointDirectory).length, 8189);
  const beforeCatalog = readFileSync(join(path, 'catalog.json'));
  for (let attempt = 0; attempt < 2; attempt++) {
    const prepared = store.prepareJointRestore(joint.jointCheckpointId);
    assert.equal(readdirSync(checkpointDirectory).length, 8191);
    assert.equal(store.cancelJointRestore(prepared.token), true);
    assert.equal(readdirSync(checkpointDirectory).length, 8189);
    assert.equal(existsSync(join(path, 'staging')), false);
  }
  fail = true;
  assert.throws(() => store.prepareJointRestore(joint.jointCheckpointId), /directory fsync failed/);
  assert.equal(readdirSync(checkpointDirectory).length, 8189);
  assert.equal(existsSync(join(path, 'staging')), false);
  fail = false;
  assert.deepEqual(readFileSync(join(path, 'catalog.json')), beforeCatalog);
  store.close();
  const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(readdirSync(checkpointDirectory).length, 8189);
  const created = reopened.create(datasets[1]); assert.equal(created.status, 'saved-unloaded');
  fill(2); assert.equal(readdirSync(checkpointDirectory).length, 8191);
  const beforeRefusal = readFileSync(join(path, 'catalog.json'));
  const nearMembers = reopened.identities().slice(0, 2).map(identity => ({ individualId: identity.individualId, dataset: identity.dataset, parentId: identity.checkpointId,
    checkpoint: reopened.readCheckpoint(identity.individualId, identity.checkpointId), mode: 'active' }));
  assert.throws(() => reopened.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members: nearMembers }), /file ceiling/);
  assert.equal(readdirSync(checkpointDirectory).length, 8191);
  assert.throws(() => reopened.prepareJointRestore(joint.jointCheckpointId), /file ceiling/);
  assert.equal(readdirSync(checkpointDirectory).length, 8191);
  assert.deepEqual(readFileSync(join(path, 'catalog.json')), beforeRefusal);
  reopened.close();
  const finalReopen = openConnectomeStore(path, { profiles }); t.after(() => finalReopen.close());
  assert.equal(readdirSync(checkpointDirectory).length, 8191);
  assert.equal(finalReopen.jointCheckpoints()[0].jointCheckpointId, joint.jointCheckpointId);
});

test('reopen removes only transaction-owned unreferenced staged files', t => {
  const { path, store } = open(t), token = randomUUID(), owned = randomUUID(), unrelated = randomUUID();
  const checkpointDirectory = join(path, 'checkpoints'), staging = join(path, 'staging');
  const bytes = Buffer.from('{}'), digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(join(checkpointDirectory, `${owned}.json`), bytes); writeFileSync(join(checkpointDirectory, `${unrelated}.json`), bytes);
  mkdirSync(staging); writeFileSync(join(staging, `${token}.json`), JSON.stringify({ schemaVersion: 1, kind: 'connectome-staged-restore', token, files: [{ checkpointId: owned, sha256: digest, bytes: bytes.length }] }));
  const before = readFileSync(join(path, 'catalog.json')); store.close();
  const reopened = openConnectomeStore(path, { profiles }); t.after(() => reopened.close());
  assert.equal(existsSync(join(checkpointDirectory, `${owned}.json`)), false);
  assert.equal(existsSync(join(checkpointDirectory, `${unrelated}.json`)), true);
  assert.equal(existsSync(staging), false); assert.deepEqual(readFileSync(join(path, 'catalog.json')), before);
});

test('joint post-rename directory sync failure exposes the selected transaction and blocks activation', t => {
  let fail = false;
  const { path, store } = open(t, { syncCatalogDirectory: () => { if (fail) throw new Error('directory fsync failed'); } });
  const a = store.create(datasets[0]), b = store.create(datasets[1]), ka = kernel(a), kb = kernel(b);
  save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint()); fail = true;
  const members = store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' }));
  let uncertain;
  assert.throws(() => store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members }), error => { uncertain = error; return error.code === 'CONNECTOME_DURABILITY_UNCERTAIN'; });
  const catalog = JSON.parse(readFileSync(join(path, 'catalog.json')));
  assert.equal(catalog.jointCheckpoints.length, 1); assert.equal(catalog.individuals.every(record => record.head === catalog.jointCheckpoints[0].payload.members.find(member => member.individualId === record.individualId).checkpointId), true);
  assert.equal(uncertain.selectedCheckpointId, catalog.jointCheckpoints[0].payload.members[0].checkpointId);
  assert.deepEqual(uncertain.selectedHeads, Object.fromEntries(catalog.jointCheckpoints[0].payload.members.map(member => [member.individualId, member.checkpointId])));
  assert.throws(() => store.readCheckpoint(a.individualId, uncertain.selectedCheckpointId), error => error.code === 'CONNECTOME_STORE_RECOVERY_REQUIRED');
});

test('joint checkpoint validation rejects stale, foreign and malformed members before file creation', t => {
  const { path, store } = open(t), a = store.create(datasets[0]), b = store.create(datasets[1]);
  const ka = kernel(a), kb = kernel(b); save(store, a, ka.checkpoint()); save(store, b, kb.checkpoint());
  const base = store.identities().map(identity => ({ individualId: identity.individualId, dataset: identity.dataset,
    parentId: identity.checkpointId, checkpoint: identity.individualId === a.individualId ? ka.checkpoint() : kb.checkpoint(), mode: 'active' }));
  for (const mutate of [members => { members[0].parentId = randomUUID(); }, members => { members[0].dataset = datasets[1]; },
    members => { members[0].mode = 'sleeping'; }, members => { members.push(structuredClone(members[0])); }]) {
    const members = structuredClone(base); mutate(members); assert.throws(() => store.persistJointCheckpoint({ jointCheckpointId: randomUUID(), intervalMs: 5, tick: 0, members }));
  }
  assert.deepEqual(store.jointCheckpoints(), []);
  assert.equal(readdirSync(join(path, 'checkpoints')).length, 2);
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
