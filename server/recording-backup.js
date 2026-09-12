import { DatabaseSync } from 'node:sqlite';
import { constants, openSync, closeSync, fstatSync, readFileSync, mkdirSync, writeFileSync, lstatSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateRecordingExport } from './recording-store.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export function readBackupBytes(path, max) {
  if(lstatSync(path).isSymbolicLink())throw new Error('Backup file must not be a symlink');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s=fstatSync(fd); if(!s.isFile() || s.size>max) throw new Error('Backup file bound exceeded'); return readFileSync(fd); }
  finally { closeSync(fd); }
}
export function validateBackupRecording(value) {
  if(!uuid(value?.session?.id) || value.session.nextSequence>10000 || value.session.maxChunkBytes>65536
    || value.session.maxBytes>32*1024*1024 || Buffer.byteLength(JSON.stringify(value))>32*1024*1024) throw new Error('Recording backup bound exceeded');
  value=validateRecordingExport(value);
  const latest=new Map();
  for(const record of value.records){if(record.simulationTimeMs<(latest.get(record.individualId)??0))throw new Error('Recording chronology regressed');latest.set(record.individualId,record.simulationTimeMs);}
  for(const [id,time] of latest){if(!Object.hasOwn(value.session.lastTimes,id)||value.session.lastTimes[id]<time||!value.gaps.length&&value.session.lastTimes[id]!==time)throw new Error('Recording last time does not match its history');}
  if(!value.gaps.length&&Object.keys(value.session.lastTimes).some(id=>!latest.has(id)))throw new Error('Recording last time has no source history');
  return value;
}
/** Caller holds the stopped installation writer lock; never opens the mutating recording service. */
export function readRecordingBackups(directory) {
  const file=join(directory,'recordings.sqlite');
  if(lstatSync(file).isSymbolicLink() || lstatSync(file).size>16*1024*1024) throw new Error('Invalid recording index');
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    if(db.prepare('PRAGMA user_version').get().user_version!==1) throw new Error('Unsupported recording index');
    const sessions=db.prepare('SELECT id,data FROM sessions ORDER BY rowid').all();
    if(sessions.length>100) throw new Error('Recording session bound exceeded');
    if(db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE session NOT IN (SELECT id FROM sessions)').get().n)throw new Error('Orphan recording index reference');
    let total=0;
    return sessions.map(row=>{
      const session=JSON.parse(row.data), records=[],gaps=[];
      if(row.id!==session.id || !uuid(session.id) || !Number.isSafeInteger(session.nextSequence) || session.nextSequence<0 || session.nextSequence>10000) throw new Error('Invalid recording sequence');
      const seen=new Set();
      for(const chunk of db.prepare('SELECT * FROM chunks WHERE session=? ORDER BY sequence').all(session.id)) {
        if(!Number.isSafeInteger(chunk.sequence) || chunk.sequence<0 || chunk.sequence>=session.nextSequence) throw new Error('Invalid recording chunk reference');
        const bytes=readBackupBytes(join(directory,`${session.id}-${chunk.sequence}.json`),65536);
        total+=bytes.length; if(total>32*1024*1024 || bytes.length!==chunk.bytes || hash(bytes)!==chunk.hash) throw new Error('Recording chunk corrupt or exceeds backup bound');
        records.push(JSON.parse(bytes)); seen.add(chunk.sequence);
      }
      for(let sequence=0;sequence<session.nextSequence;sequence++) if(!seen.has(sequence)) gaps.push({sequence,reason:'Missing or corrupt chunk'});
      const missingParticipants=session.participantIds.filter(id=>!records.some(r=>r.individualId===id));
      return validateBackupRecording({schemaVersion:1,kind:'fly-garden-recording',session,records,gaps,missingParticipants,
        complete:session.status==='complete'&&!gaps.length&&!missingParticipants.length&&!session.droppedSamples});
    });
  } finally { db.close(); }
}
/** Fresh restored recordings are observational history, never resumed capture. */
export function restoreRecordingBackups(values,directory) {
  values=values.map(validateBackupRecording);
  mkdirSync(directory,{mode:0o700});
  const db=new DatabaseSync(join(directory,'recordings.sqlite'));
  try {
    db.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE chunks(session TEXT NOT NULL,sequence INTEGER NOT NULL,bytes INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(session,sequence)); PRAGMA user_version=1; BEGIN');
    for(const value of values) {
      const session=structuredClone(value.session);
      if(session.status==='recording'){session.status='partial';session.failure='Capture was interrupted before offline backup';}
      db.prepare('INSERT INTO sessions(id,data) VALUES(?,?)').run(session.id,JSON.stringify(session));
      for(const record of value.records) {
        const bytes=Buffer.from(JSON.stringify(record));
        const fd=openSync(join(directory,`${session.id}-${record.sequence}.json`),'wx',0o600);
        try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
        db.prepare('INSERT INTO chunks(session,sequence,bytes,hash) VALUES(?,?,?,?)').run(session.id,record.sequence,bytes.length,hash(bytes));
      }
    }
    db.exec('COMMIT');
  } finally { db.close(); }
  const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
}
