import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { CONNECTOME_PROFILES, connectomeProfile, neuronIdentity } from './connectome-profiles.js';
import { LIF_MODEL } from './sparse-lif.js';
import { openConnectomeStore } from './connectome-store.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const FILES = ['ids.json','offsets.u32','targets.u32','contacts.u32','signs.i8'];
async function boundedFile(path, max) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await file.stat(); if (!stat.isFile() || stat.size > max) throw new Error('Local metadata file exceeds its bound'); return await file.readFile(); }
  finally { await file.close(); }
}
/** Verify pinned files with 64 KiB streaming buffers. No graph arrays, worker or kernel is instantiated. */
export async function verifyConnectomeDescriptor(directory, dataset, { readLock = async profile => JSON.parse(await readFile(new URL(`../connectome/${profile.graphLock}`, import.meta.url),'utf8')) } = {}) {
  const profile = connectomeProfile(dataset), expected = await readLock(profile), root = resolve(directory);
  const bytes = await boundedFile(join(root,'manifest.json'),65536);
  if (!sha(expected.manifestSha256) || hash(bytes) !== expected.manifestSha256) throw new Error('Pinned dataset manifest mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.schemaVersion !== 1 || manifest.dataset !== dataset || !safe(manifest.neuronCount) || manifest.neuronCount < 1
    || manifest.neuronCount > 2000000 || !safe(manifest.edgeCount)) throw new Error('Pinned dataset descriptor invalid');
  for (const name of FILES) {
    const item = manifest.files?.[name];
    if (!item || !safe(item.bytes) || item.bytes > 2 ** 31 || !sha(item.sha256)) throw new Error('Pinned file descriptor invalid');
  }
  const idsBytes = await boundedFile(join(root,'ids.json'),32*1024*1024);
  if (idsBytes.length !== manifest.files['ids.json'].bytes || hash(idsBytes) !== manifest.files['ids.json'].sha256) throw new Error('Pinned neuron identifiers mismatch');
  const ids = JSON.parse(idsBytes); if (!Array.isArray(ids) || ids.length !== manifest.neuronCount || new Set(ids).size !== ids.length) throw new Error('Pinned neuron identifiers invalid');
  const graphHash = createHash('sha256').update(JSON.stringify(ids.map(id => neuronIdentity(dataset,id))));
  for (const name of FILES.slice(1)) {
    const item = manifest.files[name], expectedLength = name === 'offsets.u32' ? (manifest.neuronCount+1)*4
      : name === 'signs.i8' ? manifest.neuronCount : manifest.edgeCount*4;
    if (item.bytes !== expectedLength) throw new Error('Pinned sparse dimensions mismatch');
    if (name !== 'signs.i8') { const prefix = Buffer.alloc(4); prefix.writeUInt32LE(item.bytes/4); graphHash.update(prefix); }
    const file = await open(join(root,name),constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); if (!stat.isFile() || stat.size !== item.bytes) throw new Error('Pinned graph file size mismatch');
      const fileHash = createHash('sha256'); let total=0;
      for await (const chunk of file.createReadStream({autoClose:false,highWaterMark:65536})) { total+=chunk.length; if(total>item.bytes)throw new Error('Pinned graph file changed'); fileHash.update(chunk);graphHash.update(chunk); }
      if(total!==item.bytes || fileHash.digest('hex')!==item.sha256)throw new Error('Pinned graph file hash mismatch');
    } finally { await file.close(); }
  }
  return {directory:root,graphSha256:graphHash.digest('hex'),manifestSha256:expected.manifestSha256,
    neuronCount:manifest.neuronCount,edgeCount:manifest.edgeCount};
}
const unavailableMeasurement = () => ({available:false,incrementalMemoryBytes:null,reason:'Configure verified paused memory evidence from this local runtime before loading.',
  disclosure:'No universal full-graph capacity is inferred from repository benchmarks.'});
export async function readConnectomeMemoryEvidence(path,dataset,descriptor) {
  if(!path)return unavailableMeasurement();
  try {
    const value=JSON.parse(await boundedFile(path,65536)), expectedModel={...LIF_MODEL,id:connectomeProfile(dataset).modelId};
    if(value.schemaVersion!==1 || value.status!=='measured-paused' || value.dataset!==dataset || value.runtime!==process.version
      || value.platform!==process.platform || value.architecture!==process.arch || value.statusAfter!=='paused' || value.includesCheckpointSerialization!==true
      || value.graphSha256!==descriptor.graphSha256 || value.provenance?.manifestSha256!==descriptor.manifestSha256
      || value.provenance?.dataset!==dataset || value.provenance?.neuronCount!==descriptor.neuronCount || value.provenance?.edgeCount!==descriptor.edgeCount
      || !value.model || Object.keys(value.model).length!==Object.keys(expectedModel).length || Object.entries(expectedModel).some(([key,item])=>value.model[key]!==item)
      || ![value.baselineRssBytes,value.sampledPeakRssBytes,value.measuredIncrementBytes,value.suggestedAdmissionBytes,value.checkpointJsonBytes].every(safe)
      || value.measuredIncrementBytes!==Math.max(0,value.sampledPeakRssBytes-value.baselineRssBytes) || value.measuredIncrementBytes===0
      || value.suggestedAdmissionBytes<Math.ceil(value.measuredIncrementBytes*1.5+64*1024**2)) throw new Error('Memory evidence mismatch');
    return {available:true,backend:'connectome',dataset,includesCheckpointSerialization:true,incrementalMemoryBytes:value.suggestedAdmissionBytes,
      reason:'Explicit local paused load/checkpoint/restore evidence matches this graph, model and runtime.',
      disclosure:'Measured RSS plus an engineering margin; not a hard peak guarantee, pair benchmark, renderer budget or evidence for another machine.'};
  }catch{return unavailableMeasurement();}
}
export async function prepareConnectomeCatalog({stateDirectory,configuration={
  'male-cns:v1.0':{directory:process.env.FLY_GARDEN_MALE_CONNECTOME_DIR??fileURLToPath(new URL('../data/malecns-v1/graph/',import.meta.url)),memoryEvidence:process.env.FLY_GARDEN_MALE_MEMORY_EVIDENCE??fileURLToPath(new URL('../data/malecns-v1/paused-memory.json',import.meta.url))},
  'banc:v888':{directory:process.env.FLY_GARDEN_BANC_CONNECTOME_DIR??fileURLToPath(new URL('../data/banc-v888/graph/',import.meta.url)),memoryEvidence:process.env.FLY_GARDEN_BANC_MEMORY_EVIDENCE??fileURLToPath(new URL('../data/banc-v888/paused-memory.json',import.meta.url))},
},verifyDescriptor=verifyConnectomeDescriptor}={}) {
  const profiles={},descriptors={};
  for(const dataset of Object.keys(CONNECTOME_PROFILES)) {
    const config=configuration[dataset];
    if(!config?.directory){profiles[dataset]={descriptor:null,measurement:unavailableMeasurement(),reason:'Configure the verified local pinned graph directory.'};continue;}
    try {const descriptor=await verifyDescriptor(config.directory,dataset);descriptors[dataset]=descriptor;
      profiles[dataset]={descriptor,measurement:await readConnectomeMemoryEvidence(config.memoryEvidence,dataset,descriptor),reason:null};}
    catch {profiles[dataset]={descriptor:null,measurement:unavailableMeasurement(),reason:'Pinned local graph files are unavailable or failed verification; no substitute loaded.'};}
  }
  if(!Object.keys(descriptors).length)return{store:null,profiles,reason:'No verified local connectome profile is configured.'};
  try{return{store:openConnectomeStore(stateDirectory,{profiles:descriptors}),profiles,reason:null};}
  catch{return{store:null,profiles,reason:'Saved connectome catalog unavailable; verify configured profiles and stored checkpoint integrity before recovery.'};}
}
