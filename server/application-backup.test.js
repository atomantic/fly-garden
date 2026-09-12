import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openIdentityStore } from './identity-store.js';
import { openCapacityStore } from './population-capacity.js';
import { openConnectomeStore } from './connectome-store.js';
import { createSparseLif } from './sparse-lif.js';
import { createRecordingStore } from './recording-store.js';
import { backupApplication, restoreApplicationBackup, validateApplicationBackup } from './application-backup.js';
import { validateBackupRecording } from './recording-backup.js';
import { portableConnectomeProfiles } from './portable-connectome-profiles.js';
const graph=dataset=>({ids:[1,2].map(id=>`${dataset}/${id}`),offsets:new Uint32Array([0,1,2]),targets:new Uint32Array([1,0]),contacts:new Uint32Array([5,5]),signs:new Int8Array([1,1])});
const profiles=Object.fromEntries(['male-cns:v1.0','banc:v888'].map(dataset=>[dataset,{directory:'/private/not-backed-up',manifestSha256:'a'.repeat(64),graphSha256:createSparseLif(graph(dataset),{dataset}).graphSha256,neuronCount:2,edgeCount:2}]));
function setup(t){const root=mkdtempSync(join(tmpdir(),'application-backup-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return{source:join(root,'source'),archive:join(root,'archive'),destination:join(root,'restored'),root};}
async function populate(source){
 const fixture=openIdentityStore(source),id=fixture.primaryId,sessionId=fixture.snapshot().sessionId;fixture.control(id,'start');fixture.step();fixture.save();fixture.close();
 openCapacityStore(source).configure({...openCapacityStore(source).settings(),maxResidentFlies:2});
 const c=openConnectomeStore(join(source,'connectomes'),{profiles}),saved=[];
 for(const dataset of Object.keys(profiles)){const identity=c.create(dataset),kernel=createSparseLif(graph(dataset),{dataset,individualId:identity.individualId});const a=c.persistCheckpoint({individualId:identity.individualId,dataset,parentId:null,checkpoint:kernel.checkpoint(),operation:'save'});c.persistCheckpoint({individualId:identity.individualId,dataset,parentId:a.checkpointId,checkpoint:kernel.checkpoint(),operation:'restore',sourceCheckpointId:a.checkpointId});saved.push(identity.individualId);}
 c.close();
 const r=createRecordingStore({directory:join(source,'recordings')}),recording=r.start({individualId:id,worldId:'home',sessionId,modelVersion:'fixture',datasetVersion:'synthetic',checkpointId:null,seed:null,participantIds:[id],sampleIntervalMs:100});
 await r.append(recording.id,{individualId:id,worldId:'home',sessionId,simulationTimeMs:100,worldTimeMs:100,wallTimeMs:1,sourceStartMs:0,sourceEndMs:100,ratesHz:[1]});r.close();
 writeFileSync(join(source,'.env'),'PRIVATE_SECRET');
 return{id,sessionId,saved,recordingId:recording.id};
}
function rehashArchive(root){const p=join(root,'manifest.json'),m=JSON.parse(readFileSync(p));for(const f of m.files){const b=readFileSync(join(root,f.path));f.bytes=b.length;f.sha256=createHash('sha256').update(b).digest('hex');}delete m.sha256;m.sha256=createHash('sha256').update(JSON.stringify(m)).digest('hex');writeFileSync(p,JSON.stringify(m));}
test('paired fixture/connectomes and recordings restore exact identities and lineage offline',async t=>{
 const{source,archive,destination}=setup(t),ids=await populate(source);
 assert.equal(backupApplication(source,archive,{profiles}).connectomeCount,2);
 const m=validateApplicationBackup(archive,{profiles});assert.equal(m.recordings.length,1);assert.equal(JSON.stringify(m).includes('PRIVATE_SECRET'),false);assert.equal(JSON.stringify(m).includes('/private/not-backed-up'),false);
 assert.equal(restoreApplicationBackup(archive,destination,{profiles}).simulationStarted,false);
 const f=openIdentityStore(destination);t.after(()=>f.close());assert.equal(f.primaryId,ids.id);assert.equal(f.snapshot().status,'paused');assert.notEqual(f.snapshot().sessionId,ids.sessionId);assert.equal(openCapacityStore(destination).settings().maxResidentFlies,2);
 const c=openConnectomeStore(join(destination,'connectomes'),{profiles});t.after(()=>c.close());assert.deepEqual(c.identities().map(i=>i.individualId),ids.saved);for(const i of c.identities()){const history=c.checkpoints(i.individualId);assert.equal(history[1].restoredFrom,history[0].checkpointId);assert.equal(c.readCheckpoint(i.individualId,i.checkpointId).tick,0);}
 const r=createRecordingStore({directory:join(destination,'recordings')});t.after(()=>r.close());const replay=r.replay(ids.recordingId);assert.equal(replay.canResume,false);assert.equal(replay.session.status,'partial');assert.equal(replay.records.length,1);
});
test('corrupt or missing checkpoint fails before fresh restore creation',async t=>{
 const{source,archive,destination}=setup(t);await populate(source);backupApplication(source,archive,{profiles});
 const file=readdirSync(join(archive,'connectomes/checkpoints'))[0];writeFileSync(join(archive,'connectomes/checkpoints',file),'{}');rehashArchive(archive);
 assert.throws(()=>restoreApplicationBackup(archive,destination,{profiles}),/corrupt|incompatible/);assert.equal(existsSync(destination),false);
 rmSync(join(archive,'connectomes/checkpoints',file));assert.throws(()=>restoreApplicationBackup(archive,destination,{profiles}),/Missing/);assert.equal(existsSync(destination),false);
});
test('active writers, corrupt recording chunks and partial stores cannot produce successful archives',async t=>{
 const{source,archive}=setup(t),ids=await populate(source);let f=openIdentityStore(source);assert.throws(()=>backupApplication(source,archive,{profiles}),/writer|open|lock/i);f.close();assert.equal(existsSync(archive),false);
 writeFileSync(join(source,'recordings',`${ids.recordingId}-0.json`),'{}');assert.throws(()=>backupApplication(source,archive,{profiles}),/corrupt/);assert.equal(existsSync(archive),false);
 rmSync(join(source,'recordings'),{recursive:true});rmSync(join(source,'connectomes/catalog.json'));assert.throws(()=>backupApplication(source,archive,{profiles}));assert.equal(existsSync(archive),false);assert.equal(existsSync(join(source,'connectomes/catalog.json')),false);
});
test('existing destinations, directory overlap, symlink aliases and manifest traversal are refused',async t=>{
 const{source,archive,destination,root}=setup(t);await populate(source);assert.throws(()=>backupApplication(source,join(source,'nested'),{profiles}),/overlap/);
 const alias=join(root,'alias');symlinkSync(source,alias);assert.throws(()=>backupApplication(source,join(alias,'nested'),{profiles}),/overlap/);backupApplication(source,archive,{profiles});
 mkdirSync(destination);writeFileSync(join(destination,'sentinel'),'keep');assert.throws(()=>restoreApplicationBackup(archive,destination,{profiles}));assert.equal(readFileSync(join(destination,'sentinel'),'utf8'),'keep');
 const p=join(archive,'manifest.json'),m=JSON.parse(readFileSync(p));m.files[0].path='../escape';delete m.sha256;m.sha256=createHash('sha256').update(JSON.stringify(m)).digest('hex');writeFileSync(p,JSON.stringify(m));assert.throws(()=>validateApplicationBackup(archive,{profiles}),/reference/);
});
test('fixture-only installations preserve absent optional stores, and missing archive manifest is not recoverable',t=>{
 const{source,archive,destination}=setup(t);openIdentityStore(source).close();backupApplication(source,archive,{profiles});restoreApplicationBackup(archive,destination,{profiles});assert.equal(existsSync(join(destination,'connectomes')),false);assert.equal(existsSync(join(destination,'recordings')),false);rmSync(join(archive,'manifest.json'));assert.throws(()=>validateApplicationBackup(archive,{profiles}));
});
test('portable descriptors are pinned and carry no host evidence or graph arrays',()=>{const p=portableConnectomeProfiles();assert.equal(p['male-cns:v1.0'].neuronCount,165122);assert.equal(p['banc:v888'].neuronCount,155858);assert.deepEqual(Object.keys(p['male-cns:v1.0']).sort(),['directory','edgeCount','graphSha256','manifestSha256','neuronCount']);});

test('symlinked archive assets cannot substitute a valid external checkpoint',async t=>{
 const{source,archive,destination,root}=setup(t);await populate(source);backupApplication(source,archive,{profiles});
 const file=readdirSync(join(archive,'connectomes/checkpoints'))[0],asset=join(archive,'connectomes/checkpoints',file),external=join(root,'external.json');writeFileSync(external,readFileSync(asset));rmSync(asset);symlinkSync(external,asset);
 assert.throws(()=>restoreApplicationBackup(archive,destination,{profiles}),/Symlink/);assert.equal(existsSync(destination),false);
});

test('interrupted restore marker blocks startup and backup before any replacement or writer creation',t=>{
 const{source,archive,root}=setup(t);mkdirSync(source);writeFileSync(join(source,'.restore-in-progress'),'incomplete');mkdirSync(join(source,'connectomes'));
 assert.throws(()=>openIdentityStore(source),/incomplete/);assert.equal(existsSync(join(source,'identities.json')),false);assert.deepEqual(readdirSync(source).sort(),['.restore-in-progress','connectomes']);
 const valid=join(root,'valid');openIdentityStore(valid).close();writeFileSync(join(valid,'.restore-in-progress'),'incomplete');const before=readFileSync(join(valid,'identities.json'));
 assert.throws(()=>openIdentityStore(valid),/incomplete/);assert.throws(()=>backupApplication(valid,archive,{profiles}),/incomplete/);assert.deepEqual(readFileSync(join(valid,'identities.json')),before);
 rmSync(join(valid,'.restore-in-progress'));symlinkSync(join(root,'missing-marker-target'),join(valid,'.restore-in-progress'));assert.throws(()=>openIdentityStore(valid),/incomplete/);
});
test('final marker durability failure preserves the fully written destination for offline verification',t=>{
 const{source,archive,destination}=setup(t);openIdentityStore(source).close();backupApplication(source,archive,{profiles});let syncs=0;
 assert.throws(()=>restoreApplicationBackup(archive,destination,{profiles,syncDirectory(){if(++syncs===5)throw new Error('fsync failed');}}),{code:'RESTORE_DURABILITY_UNCERTAIN'});
 assert.equal(existsSync(join(destination,'identities.json')),true);assert.equal(existsSync(join(destination,'RESTORE_COMPLETE.json')),true);
});
test('recording restore rejects rehashed temporal regression and inconsistent lastTimes',async t=>{
 const{source,archive}=setup(t);await populate(source);backupApplication(source,archive,{profiles});const value=validateApplicationBackup(archive,{profiles}).recordings[0],id=value.session.individualId;
 const second=structuredClone(value.records[0]);second.sequence=1;second.eventId=`${value.session.id}:1`;second.simulationTimeMs=50;second.sourceStartMs=0;second.sourceEndMs=50;value.records.push(second);value.session.nextSequence=2;
 assert.throws(()=>validateBackupRecording(value),/chronology/);second.simulationTimeMs=200;second.sourceEndMs=200;assert.throws(()=>validateBackupRecording(value),/last time/);
});

test('dangling optional-store symlinks are errors, never silently archived as absent',t=>{
 const{source,archive,root}=setup(t);openIdentityStore(source).close();
 for(const name of ['capacity.json','recordings','connectomes']){symlinkSync(join(root,'missing'),join(source,name));assert.throws(()=>backupApplication(source,archive,{profiles}));assert.equal(existsSync(archive),false);rmSync(join(source,name));}
});
