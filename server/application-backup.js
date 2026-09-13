/** Offline, explicit, bounded backup of the app's saved state; never starts workers. */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, lstatSync, realpathSync, existsSync, writeFileSync, openSync, closeSync, fsyncSync, rmSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { acquireIdentityStoreLock } from './identity-store.js';
import { readIdentityBackup, validateIdentityBackup } from './identity-backup.js';
import { openConnectomeStore, validateConnectomeBackup, restoreConnectomeBackup } from './connectome-store.js';
import { portableConnectomeProfiles } from './portable-connectome-profiles.js';
import { readConnectomeRecordingBackups,validateConnectomeRecordingBackup,restoreConnectomeRecordingBackups,SAMPLE_EXPORT_MAX } from './connectome-recording-backup.js';
import { readBackupBytes, readRecordingBackups, validateBackupRecording, restoreRecordingBackups } from './recording-backup.js';
const hash = b=>createHash('sha256').update(b).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const allowed=name=>name==='fixture.json'||name==='connectomes/catalog.json'||/^connectomes\/checkpoints\/[a-f0-9-]{36}\.json$/.test(name)||/^(recordings|connectome-recordings)\/[a-f0-9-]{36}\.json$/.test(name);
const MAX_TOTAL=1140*1024*1024;
function present(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function directory(path){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('Backup directory must not be a symlink');}
function canonical(path){const rest=[];let ancestor=resolve(path);while(!existsSync(ancestor)){rest.unshift(basename(ancestor));ancestor=dirname(ancestor);}return join(realpathSync(ancestor),...rest);}
function independent(source,target){const a=canonical(source),b=canonical(target);if(a===b||a.startsWith(b+sep)||b.startsWith(a+sep))throw new Error('Backup source and destination overlap');}
function write(path,bytes){const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}}
function sync(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function list(root,prefix=''){
  const out=[];for(const name of readdirSync(join(root,prefix))){const rel=prefix?`${prefix}/${name}`:name,s=lstatSync(join(root,rel));if(s.isSymbolicLink())throw new Error('Symlink in backup');if(s.isDirectory()){if(!['connectomes','connectomes/checkpoints','recordings','connectome-recordings'].includes(rel))throw new Error('Unexpected backup directory');out.push(...list(root,rel));}else if(s.isFile())out.push(rel);else throw new Error('Non-file backup entry');if(out.length>4300)throw new Error('Backup file count bound exceeded');}return out.sort();
}
function fixture(source){
  readBackupBytes(join(source,'identities.json'),16*1024*1024);
  if(present(join(source,'capacity.json')))readBackupBytes(join(source,'capacity.json'),4096);
  return readIdentityBackup(source);
}
/** Source is FLY_GARDEN_DATA_DIR; recordings/ and connectomes/ are optional, explicitly preserved absences. */
export function backupApplication(source,destination,{profiles=portableConnectomeProfiles()}={}){
  source=resolve(source);destination=resolve(destination);directory(source);independent(source,destination);
  try{lstatSync(join(source,'.restore-in-progress'));throw new Error('Cannot back up an incomplete restore');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existsSync(destination))throw new Error('Backup destination already exists');
  readBackupBytes(join(source,'identities.json'),16*1024*1024); // missing source never initialized
  const release=acquireIdentityStoreLock(source);let store=null,created=false;
  try{
    const saved=fixture(source),c=join(source,'connectomes'),r=join(source,'recordings'),cr=join(source,'connectome-recordings');
    const hasConnectomes=present(c),hasRecordings=present(r),hasConnectomeRecordings=present(cr);
    if(hasConnectomes){directory(c);readBackupBytes(join(c,'catalog.json'),2*1024*1024);store=openConnectomeStore(c,{profiles});}
    let recordings=[];if(hasRecordings){directory(r);recordings=readRecordingBackups(r);}
    let connectomeRecordings=[];if(hasConnectomeRecordings){directory(cr);connectomeRecordings=readConnectomeRecordingBackups(cr);}
    mkdirSync(destination,{mode:0o700});created=true;
    write(join(destination,'fixture.json'),Buffer.from(JSON.stringify(saved)));
    if(store)store.backup(join(destination,'connectomes'));
    if(hasRecordings){mkdirSync(join(destination,'recordings'),{mode:0o700});for(const value of recordings)write(join(destination,'recordings',`${value.session.id}.json`),Buffer.from(JSON.stringify(value)));sync(join(destination,'recordings'));}
    if(hasConnectomeRecordings){mkdirSync(join(destination,'connectome-recordings'),{mode:0o700});for(const value of connectomeRecordings)write(join(destination,'connectome-recordings',`${value.session.id}.json`),Buffer.from(JSON.stringify(value)));sync(join(destination,'connectome-recordings'));}
    let total=0;const files=list(destination).map(path=>{if(!allowed(path))throw new Error('Unexpected backup file');const bytes=readBackupBytes(join(destination,path),path.startsWith('connectome-recordings/')?SAMPLE_EXPORT_MAX:32*1024*1024);total+=bytes.length;if(total>MAX_TOTAL)throw new Error('Backup total bound exceeded');return{path,bytes:bytes.length,sha256:hash(bytes)};});
    const data={schemaVersion:hasConnectomeRecordings?2:1,kind:'fly-garden-application-backup',createdAt:new Date().toISOString(),components:{fixture:true,connectomes:hasConnectomes,recordings:hasRecordings,...(hasConnectomeRecordings?{connectomeRecordings:true}:{})},files};
    write(join(destination,'manifest.json'),Buffer.from(JSON.stringify({...data,sha256:hash(JSON.stringify(data))})));validateApplicationBackup(destination,{profiles});sync(destination);sync(dirname(destination));
    return{status:'backed-up-offline',individualCount:saved.data.identities.individuals.length,connectomeCount:store?.identities().length??0,recordingCount:recordings.length,connectomeRecordingCount:connectomeRecordings.length};
  }catch(error){if(created)rmSync(destination,{recursive:true,force:true});throw error;}finally{store?.close();release();}
}
export function validateApplicationBackup(source,{profiles=portableConnectomeProfiles()}={}){
  source=resolve(source);directory(source);
  const m=JSON.parse(readBackupBytes(join(source,'manifest.json'),1024*1024));
  if(!exact(m,['schemaVersion','kind','createdAt','components','files','sha256'])||![1,2].includes(m.schemaVersion)||m.kind!=='fly-garden-application-backup'||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))
    ||!exact(m.components,m.schemaVersion===1?['fixture','connectomes','recordings']:['fixture','connectomes','recordings','connectomeRecordings'])||m.components.fixture!==true||!['connectomes','recordings',...(m.schemaVersion===2?['connectomeRecordings']:[])].every(k=>typeof m.components[k]==='boolean')||!Array.isArray(m.files)||m.files.length>4300)throw new Error('Incompatible application backup manifest');
  const{sha256,...data}=m;if(hash(JSON.stringify(data))!==sha256)throw new Error('Application backup manifest checksum mismatch');
  let total=0;const paths=new Set();
  for(const f of m.files){if(!exact(f,['path','bytes','sha256'])||typeof f.path!=='string'||!allowed(f.path)||paths.has(f.path)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>(f.path.startsWith('connectome-recordings/')?SAMPLE_EXPORT_MAX:32*1024*1024)||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw new Error('Invalid backup file reference');paths.add(f.path);total+=f.bytes;if(total>MAX_TOTAL)throw new Error('Backup total bound exceeded');}
  if(JSON.stringify(list(source))!==JSON.stringify([...paths,'manifest.json'].sort())||!paths.has('fixture.json')||paths.has('connectomes/catalog.json')!==m.components.connectomes)throw new Error('Missing or unexpected backup files');
  if(!m.components.connectomes&&[...paths].some(p=>p.startsWith('connectomes/'))||!m.components.recordings&&[...paths].some(p=>p.startsWith('recordings/')))throw new Error('Inconsistent backup components');
  if(!m.components.connectomeRecordings&&[...paths].some(p=>p.startsWith('connectome-recordings/')))throw new Error('Unexpected connectome recording component');
  for(const f of m.files){const bytes=readBackupBytes(join(source,f.path),f.bytes);if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw new Error('Backup asset checksum mismatch');}
  const saved=validateIdentityBackup(JSON.parse(readBackupBytes(join(source,'fixture.json'),17*1024*1024)));
  if(['connectomes','recordings'].some(k=>existsSync(join(source,k))!==m.components[k]))throw new Error('Backup component directory mismatch');
  if(m.components.recordings)directory(join(source,'recordings'));
  if(existsSync(join(source,'connectome-recordings'))!==!!m.components.connectomeRecordings)throw new Error('Connectome recording component directory mismatch');
  if(m.components.connectomes){const catalog=validateConnectomeBackup(join(source,'connectomes'),{profiles});const expected=catalog.individuals.flatMap(r=>r.checkpoints.map(c=>`connectomes/checkpoints/${c.checkpointId}.json`)).sort();if(JSON.stringify(expected)!==JSON.stringify([...paths].filter(p=>p.startsWith('connectomes/checkpoints/')).sort()))throw new Error('Unreferenced checkpoint in backup');}
  const recordings=[...paths].filter(p=>p.startsWith('recordings/')).map(p=>{const value=validateBackupRecording(JSON.parse(readBackupBytes(join(source,p),32*1024*1024)));if(p!==`recordings/${value.session.id}.json`)throw new Error('Recording identity filename mismatch');return value;});
  if(recordings.length>100||recordings.reduce((sum,r)=>sum+Buffer.byteLength(JSON.stringify(r)),0)>32*1024*1024)throw new Error('Recording aggregate bound exceeded');
  const connectomeRecordings=[...paths].filter(p=>p.startsWith('connectome-recordings/')).map(p=>{const value=validateConnectomeRecordingBackup(JSON.parse(readBackupBytes(join(source,p),SAMPLE_EXPORT_MAX)));if(p!==`connectome-recordings/${value.session.id}.json`)throw new Error('Sample recording filename mismatch');return value;});
  if(connectomeRecordings.length>100||connectomeRecordings.reduce((n,r)=>n+r.session.nextSequence,0)>10000||connectomeRecordings.reduce((n,r)=>n+r.records.reduce((s,v)=>s+Buffer.byteLength(JSON.stringify(v)),0),0)>32*1024*1024)throw new Error('Connectome recording aggregate bound exceeded');
  return{manifest:m,fixture:saved,recordings,connectomeRecordings};
}
/** Entire archive validates before reserving a new destination. No live in-place merge. */
export function restoreApplicationBackup(source,destination,{profiles=portableConnectomeProfiles(),syncDirectory=sync}={}){
  source=resolve(source);destination=resolve(destination);independent(source,destination);
  const value=validateApplicationBackup(source,{profiles});mkdirSync(destination,{mode:0o700});
  let sealed=false;
  try{
    write(join(destination,'.restore-in-progress'),Buffer.from('Offline restore incomplete\n'));syncDirectory(destination);syncDirectory(dirname(destination));
    if(value.manifest.components.connectomes)restoreConnectomeBackup(join(source,'connectomes'),join(destination,'connectomes'),{profiles});
    if(value.manifest.components.recordings)restoreRecordingBackups(value.recordings,join(destination,'recordings'));
    if(value.manifest.components.connectomeRecordings)restoreConnectomeRecordingBackups(value.connectomeRecordings,join(destination,'connectome-recordings'));
    if(value.fixture.data.capacity!==null)write(join(destination,'capacity.json'),Buffer.from(JSON.stringify(value.fixture.data.capacity)));
    // Fixture catalog is the last application component published, after all child stores.
    write(join(destination,'identities.json'),Buffer.from(JSON.stringify(value.fixture.data.identities)));
    write(join(destination,'RESTORE_COMPLETE.json'),Buffer.from(JSON.stringify({schemaVersion:1,archiveSha256:value.manifest.sha256,status:'restored-offline'})));
    syncDirectory(destination);syncDirectory(dirname(destination));
    sealed=true;
    unlinkSync(join(destination,'.restore-in-progress'));syncDirectory(destination);
  }catch(error){if(!sealed)rmSync(destination,{recursive:true,force:true});else throw Object.assign(new Error('Restore components completed but final marker durability is uncertain; preserved destination requires offline verification'),{code:'RESTORE_DURABILITY_UNCERTAIN',cause:error});throw error;}
  return{status:'restored-offline',individualCount:value.fixture.data.identities.individuals.length,recordingCount:value.recordings.length,connectomeRecordingCount:value.connectomeRecordings.length,simulationStarted:false};
}
