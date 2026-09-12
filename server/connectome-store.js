import { randomUUID, createHash } from 'node:crypto';
import { constants, mkdirSync, lstatSync, fstatSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connectomeProfile } from './connectome-profiles.js';
import { LIF_MODEL } from './sparse-lif.js';

const LIMITS = Object.freeze({ identities: 64, history: 64, catalogBytes: 2 * 1024 * 1024, checkpointBytes: 16 * 1024 * 1024, totalCheckpointBytes: 1024 * 1024 * 1024, files: 8192 });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const sha = value => createHash('sha256').update(value).digest('hex');
const shaValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw new Error('Connectome store corrupt or incompatible; existing files preserved'); };
const catalogDigest = catalog => sha(JSON.stringify({schemaVersion:catalog.schemaVersion,kind:catalog.kind,individuals:catalog.individuals}));
const same = (a, b) => exact(a, Object.keys(b)) && Object.entries(b).every(([key, value]) => a[key] === value);
function descriptor(dataset, input) {
  connectomeProfile(dataset);
  if (!input || typeof input.directory !== 'string' || !input.directory || !shaValid(input.graphSha256)
    || !shaValid(input.manifestSha256) || !integer(input.neuronCount) || input.neuronCount < 1 || input.neuronCount > 2000000 || !integer(input.edgeCount)) throw new Error('Verified local connectome profile descriptor required');
  return { dataset, graphSha256: input.graphSha256, manifestSha256: input.manifestSha256, neuronCount: input.neuronCount, edgeCount: input.edgeCount, modelId: connectomeProfile(dataset).modelId };
}
function validateCheckpoint(value, record) {
  const d = record.descriptor, model = { ...LIF_MODEL, id: d.modelId };
  if (!exact(value, ['schemaVersion','kind','individualId','dataset','graphSha256','model','tick','totalSpikes','traversedEdges','potential','firing','refractory'])
    || value.schemaVersion !== 1 || value.kind !== 'sparse-lif' || value.individualId !== record.individualId || value.dataset !== d.dataset
    || value.graphSha256 !== d.graphSha256 || !same(value.model, model) || ![value.tick,value.totalSpikes,value.traversedEdges].every(integer)
    || ![value.potential,value.firing,value.refractory].every(a => Array.isArray(a) && a.length === d.neuronCount)) invalid();
  let pending = 0;
  for (let i=0; i<d.neuronCount; i++) {
    const v=value.potential[i], f=value.firing[i], r=value.refractory[i];
    if (!Number.isFinite(v) || v >= model.threshold || ![0,1].includes(f) || !integer(r) || r > model.refractorySteps
      || r > 0 && v !== model.reset || (f === 1) !== (r === model.refractorySteps)
      || value.tick === 0 && (v !== model.reset || r !== 0 && r !== model.refractorySteps)) invalid();
    pending += f;
  }
  if (BigInt(value.totalSpikes) > BigInt(value.tick)*BigInt(d.neuronCount)
    || BigInt(value.traversedEdges) > BigInt(value.tick)*BigInt(d.edgeCount) || value.tick > 0 && pending > value.totalSpikes) invalid();
  return value;
}
function readBounded(path, max) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > max) invalid(); return readFileSync(fd); }
  finally { closeSync(fd); }
}
function writeExclusive(path, bytes) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function atomicCatalog(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeExclusive(temporary, bytes); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
function syncDirectory(path) {
  const fd=openSync(path,constants.O_RDONLY); try{fsyncSync(fd);}finally{closeSync(fd);}
}
function externalDestination(source, destination) {
  const root = realpathSync(source), target = resolve(destination), suffix = [];
  let ancestor = target, canonical;
  for (;;) {
    try { canonical = join(realpathSync(ancestor), ...suffix.reverse()); break; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(ancestor); if (parent === ancestor) throw error;
      suffix.push(basename(ancestor)); ancestor = parent;
    }
  }
  if (canonical === root || canonical.startsWith(`${root}${sep}`)) throw new Error('Connectome backup destination must be outside its source directory');
  return target;
}
function noSymlinkDirectory(path) {
  const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
}
function validateCatalog(catalog, profiles) {
  if (!exact(catalog, ['schemaVersion','kind','individuals','sha256']) || catalog.sha256 !== catalogDigest(catalog) || catalog.schemaVersion !== 1 || catalog.kind !== 'connectome-catalog'
    || !Array.isArray(catalog.individuals) || catalog.individuals.length > LIMITS.identities) invalid();
  const ids = new Set(), checkpointIds = new Set();
  for (const record of catalog.individuals) {
    if (!exact(record,['individualId','descriptor','createdAt','head','checkpoints']) || !uuid(record.individualId) || ids.has(record.individualId)
      || !integer(record.createdAt) || !Array.isArray(record.checkpoints) || record.checkpoints.length > LIMITS.history
      || !same(record.descriptor, descriptor(record.descriptor?.dataset, profiles[record.descriptor?.dataset]))) invalid();
    ids.add(record.individualId); const prior = new Map(); let previous = null;
    for (const item of record.checkpoints) {
      if (!exact(item,['checkpointId','parentId','restoredFrom','operation','createdAt','sha256','bytes','tick']) || !uuid(item.checkpointId) || checkpointIds.has(item.checkpointId)
        || item.parentId !== previous || (item.restoredFrom !== null && !prior.has(item.restoredFrom))
        || !['save','unload','restore'].includes(item.operation) || (item.operation === 'restore') !== (item.restoredFrom !== null)
        || !integer(item.createdAt) || !shaValid(item.sha256) || !integer(item.bytes) || item.bytes < 1 || item.bytes > LIMITS.checkpointBytes || !integer(item.tick)) invalid();
      if (item.restoredFrom !== null) {
        const source = prior.get(item.restoredFrom);
        if (item.sha256 !== source.sha256 || item.bytes !== source.bytes || item.tick !== source.tick) invalid();
      }
      prior.set(item.checkpointId, item); checkpointIds.add(item.checkpointId); previous=item.checkpointId;
    }
    if (record.head !== previous) invalid();
  }
  return catalog;
}
function verifyPayload(root, record, item) {
  const bytes = readBounded(join(root,'checkpoints',`${item.checkpointId}.json`), LIMITS.checkpointBytes);
  if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) invalid();
  const value = validateCheckpoint(JSON.parse(bytes.toString()), record); if (value.tick !== item.tick) invalid();
  return { bytes, value };
}

/** Immutable checkpoint files + one atomic metadata/head catalog. Never starts a worker. */
export function openConnectomeStore(directory, { profiles = {}, writeCatalog = atomicCatalog, syncCatalogDirectory = syncDirectory } = {}) {
  profiles = structuredClone(profiles);
  for (const [dataset, input] of Object.entries(profiles)) descriptor(dataset,input);
  directory = resolve(directory); mkdirSync(directory, { recursive:true, mode:0o700 }); noSymlinkDirectory(directory);
  const path = join(directory,'catalog.json'), checkpointDirectory = join(directory,'checkpoints');
  const files = readdirSync(directory);
  if (!files.includes('catalog.json') && files.length !== 0) throw new Error('Refusing to initialize a nonempty connectome store directory');
  const lockPath = join(directory,'writer.sqlite');
  try { if (lstatSync(lockPath).isSymbolicLink()) invalid(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = new DatabaseSync(lockPath);
  try { lock.exec('CREATE TABLE IF NOT EXISTS writer (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE'); }
  catch { lock.close(); throw new Error('Connectome store is already open or writer lock unavailable'); }
  let catalog, closed=false, durabilityUncertain=false;
  const ensureOpen = () => { if (closed) throw new Error('Connectome store closed'); };
  function ensureDurable() {
    ensureOpen();
    if (durabilityUncertain) throw Object.assign(new Error('Connectome store durability is uncertain; close and reopen successfully before activation or further writes'), { code: 'CONNECTOME_STORE_RECOVERY_REQUIRED' });
  }
  function storageBytes() {
    const names = readdirSync(checkpointDirectory); if (names.length > LIMITS.files) invalid();
    let bytes=0;
    for (const name of names) { if (!/^[0-9a-f-]{36}\.json$/.test(name)) invalid(); const stat=lstatSync(join(checkpointDirectory,name)); if (!stat.isFile() || stat.isSymbolicLink()) invalid(); bytes+=stat.size; }
    if (bytes > LIMITS.totalCheckpointBytes) throw new Error('Connectome checkpoint storage ceiling exceeded; no files deleted'); return bytes;
  }
  function persist(next, selection = null) {
    ensureDurable();
    next.sha256 = catalogDigest(next);
    validateCatalog(next,profiles); const bytes=Buffer.from(JSON.stringify(next)); if (bytes.length > LIMITS.catalogBytes) throw new Error('Connectome catalog capacity reached');
    writeCatalog(path,bytes); catalog=next;
    // Selection already changed. Never report the old head as current if durability confirmation fails.
    try { syncCatalogDirectory(directory); }
    catch {
      durabilityUncertain = true;
      throw Object.assign(new Error('Connectome catalog selection changed but directory durability is uncertain; close and reopen the store before paused recovery'), {
        code: 'CONNECTOME_DURABILITY_UNCERTAIN', selectedCheckpointId: selection?.checkpointId ?? null,
        individualId: selection?.individualId ?? null,
      });
    }
  }
  try {
    if (files.includes('catalog.json')) {
      noSymlinkDirectory(checkpointDirectory);
      catalog=validateCatalog(JSON.parse(readBounded(path,LIMITS.catalogBytes).toString()),profiles); storageBytes();
      // Stream one file at a time: no historical neural arrays retained in the catalog.
      for (const record of catalog.individuals) for (const item of record.checkpoints) verifyPayload(directory,record,item);
      syncCatalogDirectory(directory);
    } else {
      mkdirSync(checkpointDirectory,{mode:0o700}); persist({schemaVersion:1,kind:'connectome-catalog',individuals:[]});
    }
  } catch(error) { lock.close(); throw error; }
  function recordFor(id) { ensureOpen(); const record=catalog.individuals.find(r=>r.individualId===id); if (!record) throw new Error('Connectome identity not found'); return record; }
  function itemFor(record,id) { if (!uuid(id)) throw new Error('Invalid checkpoint identifier'); const item=record.checkpoints.find(c=>c.checkpointId===id); if (!item) throw new Error('Checkpoint does not belong to this individual'); return item; }
  const identities = () => { ensureOpen(); return catalog.individuals.map(r=>({individualId:r.individualId,dataset:r.descriptor.dataset,directory:resolve(profiles[r.descriptor.dataset].directory),checkpointId:r.head})); };
  return {
    identities,
    create(dataset) {
      ensureDurable(); const d=descriptor(dataset,profiles[dataset]); if(catalog.individuals.length>=LIMITS.identities) throw new Error('Connectome identity capacity reached');
      const record={individualId:randomUUID(),descriptor:d,createdAt:Date.now(),head:null,checkpoints:[]};
      const next=structuredClone(catalog); next.individuals.push(record); persist(next);
      return {...identities().find(r=>r.individualId===record.individualId),status:'saved-unloaded'};
    },
    checkpoints(id) { return structuredClone(recordFor(id).checkpoints); },
    readCheckpoint(id,checkpointId) { ensureDurable(); const record=recordFor(id); return verifyPayload(directory,record,itemFor(record,checkpointId)).value; },
    persistCheckpoint({individualId,dataset,parentId,checkpoint,operation,sourceCheckpointId=null}) {
      ensureDurable();
      const record=recordFor(individualId);
      if(dataset!==record.descriptor.dataset || parentId!==record.head || !['save','unload','restore'].includes(operation)) throw new Error('Stale or incompatible checkpoint transaction');
      validateCheckpoint(checkpoint,record);
      if(record.checkpoints.length>=LIMITS.history) throw new Error('Connectome checkpoint history capacity reached');
      const bytes=Buffer.from(JSON.stringify(checkpoint));
      if(bytes.length>LIMITS.checkpointBytes || storageBytes()+bytes.length>LIMITS.totalCheckpointBytes) throw new Error('Connectome checkpoint byte ceiling exceeded');
      const digest=sha(bytes), source=operation==='restore' ? itemFor(record,sourceCheckpointId) : null;
      if (source ? source.sha256!==digest || !verifyPayload(directory,record,source).bytes.equals(bytes) : sourceCheckpointId!==null) throw new Error('Restore source must exactly match the requested saved checkpoint');
      const item={checkpointId:randomUUID(),parentId:record.head,restoredFrom:source?.checkpointId??null,operation,createdAt:Date.now(),sha256:digest,bytes:bytes.length,tick:checkpoint.tick};
      const next=structuredClone(catalog), target=next.individuals.find(r=>r.individualId===individualId);
      target.checkpoints.push(item); target.head=item.checkpointId;
      // File fsync precedes catalog selection; an interrupted head commit leaves only an inert orphan.
      writeExclusive(join(checkpointDirectory,`${item.checkpointId}.json`),bytes);
      syncDirectory(checkpointDirectory);
      persist(next, { individualId, checkpointId: item.checkpointId }); return {checkpointId:item.checkpointId};
    },
    backup(destination) {
      ensureDurable(); const target=externalDestination(directory,destination); mkdirSync(target,{mode:0o700});
      try {
        mkdirSync(join(target,'checkpoints'),{mode:0o700});
        for(const record of catalog.individuals) for(const item of record.checkpoints) writeExclusive(join(target,'checkpoints',`${item.checkpointId}.json`),verifyPayload(directory,record,item).bytes);
        // Catalog last: a partial backup never presents a valid selected head.
        syncDirectory(join(target,'checkpoints'));
        writeExclusive(join(target,'catalog.json'),Buffer.from(JSON.stringify(catalog)));
        syncDirectory(target); syncDirectory(dirname(target));
      } catch(error) { throw new Error(`Connectome backup incomplete; source preserved: ${error.message}`); }
      return {status:'offline-copy',individualCount:catalog.individuals.length,checkpointCount:catalog.individuals.reduce((sum,r)=>sum+r.checkpoints.length,0)};
    },
    close() { if(!closed){closed=true;lock.close();} },
  };
}

/** Stream-validate an offline copy without initializing files or opening a writer. */
export function validateConnectomeBackup(source,{profiles={}}={}) {
  const root=resolve(source); noSymlinkDirectory(root); noSymlinkDirectory(join(root,'checkpoints'));
  const catalog=validateCatalog(JSON.parse(readBounded(join(root,'catalog.json'),LIMITS.catalogBytes).toString()),profiles);
  let total=0; for(const record of catalog.individuals) for(const item of record.checkpoints){total+=item.bytes;if(total>LIMITS.totalCheckpointBytes)invalid();verifyPayload(root,record,item);}
  return catalog;
}

/** Validate completely before creating a fresh destination; never merge into an existing store. */
export function restoreConnectomeBackup(source,destination,{profiles={}}={}) {
  const root=resolve(source), catalog=validateConnectomeBackup(root,{profiles});
  const target=externalDestination(root,destination); mkdirSync(target,{mode:0o700});
  try {
    mkdirSync(join(target,'checkpoints'),{mode:0o700});
    for(const record of catalog.individuals) for(const item of record.checkpoints) writeExclusive(join(target,'checkpoints',`${item.checkpointId}.json`),verifyPayload(root,record,item).bytes);
    syncDirectory(join(target,'checkpoints'));
    writeExclusive(join(target,'catalog.json'),Buffer.from(JSON.stringify(catalog)));
    syncDirectory(target); syncDirectory(dirname(target));
  } catch(error) { throw new Error(`Connectome restore incomplete; backup preserved: ${error.message}`); }
  return {status:'restored-offline',individualCount:catalog.individuals.length};
}
