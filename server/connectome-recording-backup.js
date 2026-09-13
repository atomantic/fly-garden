import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,openSync,writeFileSync,closeSync,fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireIdentityStoreLock } from './identity-store.js';
import { createConnectomeRecordingStore } from './connectome-recording-store.js';
import { validateConnectomeRecording,RECORDING_LIMITS } from './connectome-recording-format.js';
export const SAMPLE_EXPORT_MAX=34*1024*1024;
export function validateConnectomeRecordingBackup(value){
 value=validateConnectomeRecording(value);if(Buffer.byteLength(JSON.stringify(value))>SAMPLE_EXPORT_MAX)throw new Error('Sample recording export bound exceeded');return value;
}
export function readConnectomeRecordingBackups(directory){
 const release=acquireIdentityStoreLock(directory);let store;
 try{store=createConnectomeRecordingStore({directory,readOnly:true});return store.list().map(s=>validateConnectomeRecordingBackup(store.read(s.id,{strictChunks:true})));}
 finally{store?.close();release();}
}
export function restoreConnectomeRecordingBackups(values,directory){
 values=values.map(validateConnectomeRecordingBackup);
 if(values.length>RECORDING_LIMITS.maxSessions||values.reduce((sum,v)=>sum+v.session.nextSequence,0)>RECORDING_LIMITS.maxRecords
  ||values.reduce((sum,v)=>sum+v.records.reduce((n,r)=>n+Buffer.byteLength(JSON.stringify(r)),0),0)>RECORDING_LIMITS.maxBytes)throw new Error('Sample recording aggregate bound exceeded');
 mkdirSync(directory,{mode:0o700});const db=new DatabaseSync(join(directory,'samples.sqlite'));
 try{
  db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE chunks(session TEXT NOT NULL,sequence INTEGER NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(session,sequence)); PRAGMA user_version=2; BEGIN');
  for(const value of values){const session=structuredClone(value.session);if(session.status==='recording'){session.status='partial';session.failure='Manual capture interrupted before offline backup';}
   db.prepare('INSERT INTO sessions VALUES(?,?)').run(session.id,JSON.stringify(session));
   for(const record of value.records){const bytes=Buffer.from(JSON.stringify(record)),fd=openSync(join(directory,`${session.id}-${record.sequence}.json`),'wx',0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}db.prepare('INSERT INTO chunks VALUES(?,?,?,?)').run(session.id,record.sequence,bytes.length,createHash('sha256').update(bytes).digest('hex'));}
  }db.exec('COMMIT');
 }finally{db.close();}
 const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
