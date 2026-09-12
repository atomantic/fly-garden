import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const finite = value => Number.isFinite(value) && value >= 0;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const fail = message => { throw new Error(message); };
export function validateRecordingExport(value) {
  const invalid = () => fail('Invalid or incompatible recording export');
  if (!keys(value, ['schemaVersion', 'kind', 'session', 'records', 'gaps', 'missingParticipants', 'complete'])
    || value.schemaVersion !== 1 || value.kind !== 'fly-garden-recording' || !Array.isArray(value.records)
    || !Array.isArray(value.gaps) || !Array.isArray(value.missingParticipants) || typeof value.complete !== 'boolean') invalid();
  const s = value.session;
  if (!keys(s, ['schemaVersion','id','status','startedAt','individualId','worldId','sessionId','modelVersion','datasetVersion','checkpointId','seed','participantIds','sampleIntervalMs','nextSequence','droppedSamples','failure','lastTimes','maxBytes','maxChunkBytes'])
    || s.schemaVersion !== 1 || ![s.id,s.individualId,s.worldId,s.sessionId,s.modelVersion,s.datasetVersion].every(label)
    || !['recording','partial','complete'].includes(s.status) || !Number.isFinite(Date.parse(s.startedAt))
    || !(s.checkpointId === null || label(s.checkpointId)) || !(s.seed === null || Number.isSafeInteger(s.seed))
    || !Array.isArray(s.participantIds) || !s.participantIds.length || s.participantIds.length > 64 || !s.participantIds.every(label)
    || !s.participantIds.includes(s.individualId) || ![s.sampleIntervalMs,s.maxBytes,s.maxChunkBytes].every(n => finite(n) && n > 0)
    || ![s.nextSequence,s.droppedSamples].every(n => Number.isSafeInteger(n) && n >= 0)
    || !(s.failure === null || (typeof s.failure === 'string' && s.failure.length <= 256))
    || !s.lastTimes || typeof s.lastTimes !== 'object' || Array.isArray(s.lastTimes)
    || !Object.entries(s.lastTimes).every(([id,time]) => s.participantIds.includes(id) && finite(time))) invalid();
  let previous = -1;
  for (const r of value.records) {
    if (!keys(r, ['schemaVersion','eventId','sequence','individualId','worldId','sessionId','simulationTimeMs','worldTimeMs','wallTimeMs','sourceStartMs','sourceEndMs','ratesHz'])
      || r.schemaVersion !== 1 || !Number.isSafeInteger(r.sequence) || r.sequence <= previous || r.sequence >= s.nextSequence
      || r.eventId !== `${s.id}:${r.sequence}` || !s.participantIds.includes(r.individualId) || r.worldId !== s.worldId || r.sessionId !== s.sessionId
      || ![r.simulationTimeMs,r.worldTimeMs,r.wallTimeMs,r.sourceStartMs,r.sourceEndMs].every(finite)
      || r.sourceStartMs > r.sourceEndMs || r.sourceEndMs > r.simulationTimeMs
      || !Array.isArray(r.ratesHz) || r.ratesHz.length > 4096 || !r.ratesHz.every(finite)) invalid();
    previous = r.sequence;
  }
  const missing = s.participantIds.filter(id => !value.records.some(r => r.individualId === id));
  const sequences = [...value.records, ...value.gaps].map(r => r.sequence);
  if (JSON.stringify(missing) !== JSON.stringify(value.missingParticipants) || new Set(sequences).size !== sequences.length || sequences.length !== s.nextSequence) invalid();
  if (!value.gaps.every(g => keys(g, ['sequence','reason']) && Number.isSafeInteger(g.sequence) && g.sequence >= 0 && g.sequence < s.nextSequence && g.reason === 'Missing or corrupt chunk')
    || !value.missingParticipants.every(id => s.participantIds.includes(id))
    || value.complete !== (s.status === 'complete' && !value.gaps.length && !value.missingParticipants.length && !s.droppedSamples)) invalid();
  return structuredClone(value);
}

export function createRecordingStore({ directory, maxBytes = 32 * 1024 * 1024, maxSessions = 100, maxRecords = 10000, maxChunkBytes = 64 * 1024,
  writeChunk = writeFile } = {}) {
  if (![maxBytes, maxSessions, maxRecords, maxChunkBytes].every(n => Number.isSafeInteger(n) && n > 0)) fail('Invalid recording limits');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'recordings.sqlite'));
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version !== 0 && version !== 1) { db.close(); fail('Incompatible recording index version'); }
  db.exec(`PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chunks(session TEXT NOT NULL, sequence INTEGER NOT NULL, bytes INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(session,sequence)); PRAGMA user_version=1;`);
  // Only generated UUID chunk names belong to this store. Remove interrupted unindexed writes.
  for (const name of readdirSync(directory)) {
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)\.json$/.exec(name);
    if (match && !db.prepare('SELECT 1 FROM chunks WHERE session=? AND sequence=?').get(match[1], Number(match[2]))) unlinkSync(join(directory, name));
  }
  const busy = new Set();
  const get = id => { const row = db.prepare('SELECT data FROM sessions WHERE id=?').get(id); if (!row) fail('Recording not found'); return JSON.parse(row.data); };
  const save = s => db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(s), s.id);
  const list = () => db.prepare('SELECT data FROM sessions ORDER BY rowid DESC').all().map(row => JSON.parse(row.data));
  for (const s of list()) if (s.status === 'recording') { s.status = 'partial'; s.failure = 'Service interrupted recording'; save(s); }
  const path = (id, sequence) => join(directory, `${id}-${sequence}.json`);
  const used = () => db.prepare('SELECT COALESCE(SUM(bytes),0) AS total FROM chunks').get().total;
  function start(p) {
    if (list().length >= maxSessions) fail('Recording session limit reached; delete a recording explicitly');
    if (!p || !label(p.individualId) || !label(p.worldId) || !label(p.sessionId) || !label(p.modelVersion) || !label(p.datasetVersion)
      || !(p.checkpointId === null || label(p.checkpointId)) || !(p.seed === null || Number.isSafeInteger(p.seed))
      || !Array.isArray(p.participantIds) || p.participantIds.length < 1 || p.participantIds.length > 64
      || !p.participantIds.every(label) || !p.participantIds.includes(p.individualId)
      || !finite(p.sampleIntervalMs) || p.sampleIntervalMs === 0) fail('Invalid recording provenance');
    const s = { schemaVersion: 1, id: randomUUID(), status: 'recording', startedAt: new Date().toISOString(),
      individualId: p.individualId, worldId: p.worldId, sessionId: p.sessionId, modelVersion: p.modelVersion, datasetVersion: p.datasetVersion,
      checkpointId: p.checkpointId, seed: p.seed, participantIds: [...new Set(p.participantIds)], sampleIntervalMs: p.sampleIntervalMs,
      nextSequence: 0, droppedSamples: 0, failure: null, lastTimes: {}, maxBytes, maxChunkBytes };
    db.prepare('INSERT INTO sessions VALUES (?,?)').run(s.id, JSON.stringify(s)); return s;
  }
  async function append(id, input) {
    let s = get(id);
    if (s.status !== 'recording') return { accepted: false, session: s };
    if (busy.size) { s.droppedSamples++; s.failure = 'Writer busy: sampled observation dropped'; save(s); return { accepted: false, session: s }; }
    if (input?.sessionId !== s.sessionId) { s.status = 'partial'; s.failure = 'Source session changed'; s.droppedSamples++; save(s); return { accepted: false, session: s }; }
    if (!input || !s.participantIds.includes(input.individualId) || input.worldId !== s.worldId
      || ![input.simulationTimeMs, input.worldTimeMs, input.wallTimeMs, input.sourceStartMs, input.sourceEndMs].every(finite)
      || input.sourceStartMs > input.sourceEndMs || input.sourceEndMs > input.simulationTimeMs
      || input.simulationTimeMs < (s.lastTimes[input.individualId] ?? 0)
      || !Array.isArray(input.ratesHz) || input.ratesHz.length > 4096 || !input.ratesHz.every(finite)) {
      s.droppedSamples++; s.failure = 'Invalid or out-of-order observation'; save(s); return { accepted: false, session: s };
    }
    const sequence = s.nextSequence++;
    const record = { schemaVersion: 1, eventId: `${id}:${sequence}`, sequence, individualId: input.individualId,
      worldId: input.worldId, sessionId: input.sessionId, simulationTimeMs: input.simulationTimeMs, worldTimeMs: input.worldTimeMs,
      wallTimeMs: input.wallTimeMs, sourceStartMs: input.sourceStartMs, sourceEndMs: input.sourceEndMs, ratesHz: [...input.ratesHz] };
    const bytes = Buffer.from(JSON.stringify(record));
    if (db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n >= maxRecords || bytes.length > maxChunkBytes || used() + bytes.length > maxBytes) {
      s.droppedSamples++; s.status = 'partial'; s.failure = 'Recording disk/chunk quota reached'; save(s); return { accepted: false, session: s };
    }
    save(s); busy.add(id);
    try {
      await writeChunk(path(id, sequence), bytes, { flag: 'wx', mode: 0o600 });
      db.prepare('INSERT INTO chunks VALUES (?,?,?,?)').run(id, sequence, bytes.length, hash(bytes));
      s = get(id); Object.defineProperty(s.lastTimes, input.individualId, { value: input.simulationTimeMs, enumerable: true, configurable: true, writable: true }); save(s);
      return { accepted: true, session: s };
    } catch (error) {
      await unlink(path(id, sequence)).catch(() => {});
      s = get(id); s.droppedSamples++; s.status = 'partial'; s.failure = `Chunk write failed: ${error.code ?? 'storage error'}`; save(s);
      return { accepted: false, session: s };
    } finally { busy.delete(id); }
  }
  function read(id) {
    const session = get(id), records = [], gaps = [];
    for (const row of db.prepare('SELECT * FROM chunks WHERE session=? ORDER BY sequence').all(id)) {
      try {
        if (statSync(path(id, row.sequence)).size > maxChunkBytes) fail('Oversized chunk');
        const bytes = readFileSync(path(id, row.sequence));
        if (bytes.length !== row.bytes || hash(bytes) !== row.hash) fail('Corrupt chunk');
        records.push(JSON.parse(bytes));
      } catch { gaps.push({ sequence: row.sequence, reason: 'Missing or corrupt chunk' }); }
    }
    const seen = new Set([...records, ...gaps].map(r => r.sequence));
    for (let sequence = 0; sequence < session.nextSequence; sequence++) if (!seen.has(sequence)) gaps.push({ sequence, reason: 'Missing or corrupt chunk' });
    const missingParticipants = session.participantIds.filter(id => !records.some(r => r.individualId === id));
    return { schemaVersion: 1, kind: 'fly-garden-recording', session, records, gaps, missingParticipants,
      complete: session.status === 'complete' && gaps.length === 0 && missingParticipants.length === 0 && session.droppedSamples === 0 };
  }
  return { start, append, list, read, export: read,
    dropSample(id) {
      const s = get(id);
      if (s.status !== 'recording') return;
      s.droppedSamples++; s.failure = 'Prior capture batch pending: sampled observation dropped'; save(s);
    },
    replay: id => ({ ...read(id), mode: 'read-only', canResume: false }),
    stop(id) { if (busy.has(id)) fail('Recording write in progress'); const s = get(id); if (s.status === 'recording') s.status = s.droppedSamples ? 'partial' : 'complete'; save(s); return s; },
    delete(id) { if (busy.has(id)) fail('Recording write in progress'); get(id); for (const row of db.prepare('SELECT sequence FROM chunks WHERE session=?').all(id)) { try { unlinkSync(path(id, row.sequence)); } catch (e) { if (e.code !== 'ENOENT') throw e; } } db.prepare('DELETE FROM chunks WHERE session=?').run(id); db.prepare('DELETE FROM sessions WHERE id=?').run(id); },
    status: () => ({ usedBytes: used(), maxBytes, maxChunkBytes, maxSessions, maxRecords, writing: busy.size > 0 }),
    close() { if (busy.size) fail('Recording write in progress'); db.close(); }
  };
}
