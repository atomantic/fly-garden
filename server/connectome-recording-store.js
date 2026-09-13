import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readdirSync,lstatSync,unlinkSync,existsSync } from 'node:fs';
import { open,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { acquireIdentityStoreLock } from './identity-store.js';
import { readBackupBytes } from './recording-backup.js';
import { RECORDING_LIMITS,validateSampleSession,validateRecordingSource,validateSampleRecord,validateConnectomeRecording,uuid } from './connectome-recording-format.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
const filename=(id,sequence)=>`${id}-${sequence}.json`;
async function writeChunk(path,bytes){const file=await open(path,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
/** Separate typed observational store. No runtime, worker, provider or control dependency is accepted. */
export function createConnectomeRecordingStore({directory,readOnly=false,write=writeChunk,...limits}={}) {
 const bound={...RECORDING_LIMITS,...limits};
 if(Object.keys(limits).some(key=>!Object.hasOwn(RECORDING_LIMITS,key))||Object.entries(bound).some(([key,n])=>!Number.isSafeInteger(n)||n<1||n>RECORDING_LIMITS[key]))throw new Error('Invalid sample recording limits');
 if(!readOnly)mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink())throw new Error('Sample recording directory cannot be a symlink');
 const file=join(directory,'samples.sqlite'),existed=existsSync(file);
 if(existsSync(file)&&(lstatSync(file).isSymbolicLink()||lstatSync(file).size>16*1024*1024))throw new Error('Invalid sample recording index');
 const release=readOnly?()=>{}:acquireIdentityStoreLock(directory);let db;
 try{
  db=new DatabaseSync(file,{readOnly});const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version!==2&&(readOnly||version!==0||existed))throw new Error('Unsupported sample recording index');
  if(!readOnly)db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS chunks(session TEXT NOT NULL,sequence INTEGER NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(session,sequence)); PRAGMA user_version=2;');
 }catch(e){db?.close();release();throw e;}
 const pending=new Set();let closed=false;
 const checkWrite=()=>{if(readOnly||closed)throw new Error('Sample recording store is read-only or closed');};
 const get=id=>{if(!uuid(id))throw new Error('Invalid recording ID');const row=db.prepare('SELECT data FROM sessions WHERE id=?').get(id);if(!row)throw new Error('Sample recording not found');return validateSampleSession(JSON.parse(row.data));};
 const save=s=>db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(validateSampleSession(s)),s.id);
 const list=()=>db.prepare('SELECT data FROM sessions ORDER BY rowid DESC').all().map(row=>structuredClone(validateSampleSession(JSON.parse(row.data))));
 const used=()=>db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM chunks').get().n;
 const attempted=()=>list().reduce((sum,s)=>sum+s.nextSequence,0);
 try {
  if(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n>bound.maxSessions||db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n>bound.maxRecords||attempted()>bound.maxRecords||used()>bound.maxBytes)throw new Error('Sample recording index exceeds configured bounds');
  if(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE session NOT IN (SELECT id FROM sessions)').get().n)throw new Error('Invalid orphan sample index reference');
  if(!readOnly){
   for(const name of readdirSync(directory)){const match=/^([a-f0-9-]{36})-(\d+)\.json$/.exec(name);if(match&&uuid(match[1])&&!db.prepare('SELECT 1 FROM chunks WHERE session=? AND sequence=?').get(match[1],Number(match[2])))unlinkSync(join(directory,name));}
   for(const s of list())if(s.status==='recording'){s.status='partial';s.failure='Recording interrupted; manual capture was not resumed';save(s);}
  }
 }catch(e){db.close();release();throw e;}
 function partial(id,reason,drop=false){checkWrite();const s=get(id);if(s.status==='recording'){s.status='partial';s.failure=reason;if(drop)s.droppedSamples++;save(s);}return s;}
 function read(id,{strictChunks=false}={}){
  const session=get(id),records=[],gaps=[],seen=new Set();
  for(const row of db.prepare('SELECT * FROM chunks WHERE session=? ORDER BY sequence').all(id)){
   if(!Number.isSafeInteger(row.sequence)||row.sequence<0||row.sequence>=session.nextSequence)throw new Error('Invalid sample chunk reference');
   seen.add(row.sequence);
   try{const bytes=readBackupBytes(join(directory,filename(id,row.sequence)),bound.maxChunkBytes);if(bytes.length!==row.bytes||hash(bytes)!==row.hash)throw new Error('Invalid sample chunk');const record=JSON.parse(bytes);validateSampleRecord(record,session);records.push(record);}
   catch(e){if(strictChunks)throw e;gaps.push({sequence:row.sequence,reason:'Missing or corrupt chunk'});}
  }
  for(let sequence=0;sequence<session.nextSequence;sequence++)if(!seen.has(sequence))gaps.push({sequence,reason:'Missing or corrupt chunk'});
  return validateConnectomeRecording({schemaVersion:1,kind:'connectome-sample-recording-export',session,records,gaps,
   complete:session.status==='complete'&&records.length>0&&!gaps.length&&!session.droppedSamples});
 }
 return {
  list,read,export:read,replay:id=>({...read(id),mode:'read-only',canResume:false}),partial,
  start(source,selection){checkWrite();validateRecordingSource(source,selection);if(list().length>=bound.maxSessions)throw new Error('Sample recording session quota reached');
   const s={schemaVersion:1,kind:'connectome-sample-recording',id:randomUUID(),status:'recording',startedAtMs:Date.now(),source:structuredClone(source),selection:structuredClone(selection),nextSequence:0,droppedSamples:0,failure:null,lastTick:null,maxBytes:bound.maxBytes,maxChunkBytes:bound.maxChunkBytes};
   validateSampleSession(s);db.prepare('INSERT INTO sessions VALUES(?,?)').run(s.id,JSON.stringify(s));return s;},
  async append(id,input){checkWrite();let s=get(id);if(s.status!=='recording')return{accepted:false,session:s};
   if(pending.size)return{accepted:false,session:partial(id,'Writer busy; capture dropped',true)};
   const sequence=s.nextSequence,record={...structuredClone(input),schemaVersion:1,sequence,eventId:`${id}:${sequence}`};
   validateSampleRecord(record,{...s,nextSequence:sequence+1});
   if(s.lastTick!==null&&record.tick<s.lastTick)return{accepted:false,session:partial(id,'Source clock regressed; capture dropped',true)};
   const bytes=Buffer.from(JSON.stringify(record));
   if(attempted()>=bound.maxRecords||bytes.length>bound.maxChunkBytes||used()+bytes.length>bound.maxBytes)return{accepted:false,session:partial(id,'Sample recording quota reached; capture dropped',true)};
   s.nextSequence++;save(s);pending.add(id);
   try{await write(join(directory,filename(id,sequence)),bytes);db.exec('BEGIN');try{s=get(id);s.lastTick=record.tick;db.prepare('INSERT INTO chunks VALUES(?,?,?,?)').run(id,sequence,bytes.length,hash(bytes));save(s);db.exec('COMMIT');}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}return{accepted:true,session:s};}
   catch{if(!db.prepare('SELECT 1 FROM chunks WHERE session=? AND sequence=?').get(id,sequence))await unlink(join(directory,filename(id,sequence))).catch(()=>{});s=get(id);s.status='partial';s.droppedSamples++;s.failure='Sample write failed; neural state was preserved';save(s);return{accepted:false,session:s};}
   finally{pending.delete(id);}
  },
  stop(id){checkWrite();if(pending.has(id))throw new Error('Sample write in progress');const s=get(id);if(s.status==='recording'){s.status=s.droppedSamples||s.nextSequence===0?'partial':'complete';if(s.nextSequence===0)s.failure='No samples were captured';save(s);}return s;},
  delete(id){checkWrite();if(pending.has(id))throw new Error('Sample write in progress');get(id);for(const row of db.prepare('SELECT sequence FROM chunks WHERE session=?').all(id)){try{unlinkSync(join(directory,filename(id,row.sequence)));}catch(e){if(e.code!=='ENOENT')throw e;}}db.prepare('DELETE FROM chunks WHERE session=?').run(id);db.prepare('DELETE FROM sessions WHERE id=?').run(id);},
  status:()=>({...bound,usedBytes:used(),writing:pending.size>0}),
  close(){if(pending.size)throw new Error('Sample writes are pending');if(!closed){closed=true;db.close();release();}},
 };
}
