/** Read-only anatomical point data. Loading this module never starts a neural worker. */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { endianness } from 'node:os';
import { join } from 'node:path';

export const ATLAS_FILES = Object.freeze(['positions.f32', 'valid.u8', 'groups.u8', 'nodes.json']);
export const ATLAS_GROUPS = Object.freeze(['visual-system', 'central-brain', 'ventral-nerve-cord', 'interregional', 'unknown']);
const COLUMNS = ['id', 'rawId', 'type', 'superclass', 'region', 'positionStatus'];
const PROFILES = { 'male-cns:v1.0': { kind: 'soma', field: 'somaLocation', scale: 0.008 }, 'banc:v888': { kind: 'root-representative', field: 'root_position_nm', scale: 0.001 } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const validHash = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 250000;
const fail = message => { throw new Error(message); };
const vector = v => Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x) && x >= 0 && x <= 8000000);

export function validateAtlasMetadata(m, dataset = m?.dataset) {
  const p = Object.hasOwn(PROFILES, dataset ?? '') && PROFILES[dataset];
  if (!p || !exact(m, ['schemaVersion','kind','dataset','pointKind','source','graphManifestSha256','coordinates','nodeColumns','groups','counts','bounds','missingEncoding','disclosure','files'])
    || m.schemaVersion !== 1 || m.kind !== 'anatomical-point-atlas' || m.dataset !== dataset || m.pointKind !== p.kind
    || !validHash(m.graphManifestSha256) || JSON.stringify(m.nodeColumns) !== JSON.stringify(COLUMNS)
    || JSON.stringify(m.groups) !== JSON.stringify(ATLAS_GROUPS)) fail('Invalid or incompatible atlas metadata');
  if (!exact(m.source, ['url','bytes','sha256','sourceLockSha256','license','licenseUrl','attribution','selection'])
    || !validHash(m.source.sha256) || !validHash(m.source.sourceLockSha256) || !Number.isSafeInteger(m.source.bytes) || m.source.bytes < 1 || m.source.bytes > 100 * 1024 * 1024
    || m.source.license !== 'CC-BY-4.0' || !['url','licenseUrl'].every(k => typeof m.source[k] === 'string' && m.source[k].startsWith('https://'))
    || !['attribution','selection'].every(k => typeof m.source[k] === 'string' && m.source[k].length > 0 && m.source[k].length < 2048)) fail('Invalid atlas source provenance');
  const c = m.coordinates;
  if (!exact(c, ['field','sourceUnits','units','scale','translation','axisOrder','frame','orientation','evidence'])
    || c.field !== p.field || c.units !== 'micrometers' || c.frame !== `${dataset}:native-EM`
    || c.sourceUnits !== (dataset === 'male-cns:v1.0' ? '8nm voxels' : 'nm')
    || JSON.stringify(c.scale) !== JSON.stringify([p.scale,p.scale,p.scale]) || JSON.stringify(c.translation) !== '[0,0,0]'
    || JSON.stringify(c.axisOrder) !== '["x","y","z"]' || typeof c.orientation !== 'string' || c.orientation.length > 2048
    || !Array.isArray(c.evidence) || !c.evidence.length || c.evidence.length > 8 || !c.evidence.every(url => typeof url === 'string' && url.startsWith('https://') && url.length < 2048)) fail('Invalid atlas coordinate frame');
  const n = m.counts;
  if (!exact(n, ['sourceRows','retained','positioned','missing','groups','missingReasons']) || ![n.sourceRows,n.retained,n.positioned,n.missing].every(count)
    || n.retained < 1 || n.retained > n.sourceRows || n.positioned + n.missing !== n.retained
    || !exact(n.groups, ATLAS_GROUPS) || !Object.values(n.groups).every(count) || Object.values(n.groups).reduce((a,b) => a+b, 0) !== n.retained
    || !n.missingReasons || Array.isArray(n.missingReasons) || typeof n.missingReasons !== 'object'
    || !Object.entries(n.missingReasons).every(([key, value]) => ['missing','invalid-coordinate'].includes(key) && count(value))
    || Object.values(n.missingReasons).reduce((a,b) => a+b, 0) !== n.missing) fail('Invalid atlas coverage counts');
  if (!exact(m.bounds, ['whole','brain','cord',...ATLAS_GROUPS]) || !Object.values(m.bounds).every(box => box === null || (exact(box, ['min','max']) && vector(box.min) && vector(box.max) && box.min.every((x,i) => x <= box.max[i])))
    || (n.positioned === 0) !== (m.bounds.whole === null)) fail('Invalid atlas bounds');
  if (!exact(m.files, ATLAS_FILES) || !ATLAS_FILES.every(name => exact(m.files[name], ['bytes','sha256']) && Number.isSafeInteger(m.files[name].bytes)
    && m.files[name].bytes > 0 && m.files[name].bytes <= 64 * 1024 * 1024 && validHash(m.files[name].sha256))
    || m.files['positions.f32'].bytes !== n.retained * 12 || m.files['valid.u8'].bytes !== n.retained || m.files['groups.u8'].bytes !== n.retained
    || !['missingEncoding','disclosure'].every(k => typeof m[k] === 'string' && m[k].length > 0 && m[k].length < 2048)) fail('Invalid atlas buffers/disclosure');
  return m;
}

export function validateAtlasBuffers(manifest, { positions, valid, groups, nodes }) {
  validateAtlasMetadata(manifest);
  const n = manifest.counts.retained;
  if (!(positions instanceof Float32Array) || !(valid instanceof Uint8Array) || !(groups instanceof Uint8Array)
    || positions.length !== n * 3 || valid.length !== n || groups.length !== n || !Array.isArray(nodes) || nodes.length !== n) fail('Atlas array length/type mismatch');
  const groupCounts = Array(5).fill(0), missingCounts = {}, minimum = [Infinity,Infinity,Infinity], maximum = [-Infinity,-Infinity,-Infinity];
  let positioned = 0, previous = 0n;
  for (let i = 0; i < n; i++) {
    const row = nodes[i], point = positions.subarray(i * 3, i * 3 + 3);
    if (!Array.isArray(row) || row.length !== 6 || !row.every(value => typeof value === 'string' && value.length <= 1024)
      || !/^[1-9]\d{0,18}$/.test(row[1]) || BigInt(row[1]) >= 2n ** 63n || BigInt(row[1]) <= previous
      || row[0] !== `${manifest.dataset}/${row[1]}` || ![manifest.pointKind,'missing','invalid-coordinate'].includes(row[5])) fail('Invalid atlas neuron identity/metadata');
    previous = BigInt(row[1]);
    if (groups[i] >= ATLAS_GROUPS.length || valid[i] > 1 || !point.every(x => Number.isFinite(x) && x >= 0 && x <= 8000000)
      || (valid[i] === 1) !== (row[5] === manifest.pointKind) || (!valid[i] && point.some(x => x !== 0))) fail('Invalid atlas position or missing mask');
    groupCounts[groups[i]]++;
    if (valid[i]) {
      positioned++;
      for (let axis = 0; axis < 3; axis++) { minimum[axis] = Math.min(minimum[axis],point[axis]); maximum[axis] = Math.max(maximum[axis],point[axis]); }
    } else missingCounts[row[5]] = (missingCounts[row[5]] ?? 0) + 1;
  }
  if (positioned !== manifest.counts.positioned || groupCounts.some((value,i) => value !== manifest.counts.groups[ATLAS_GROUPS[i]])
    || ['missing','invalid-coordinate'].some(key => (missingCounts[key] ?? 0) !== (manifest.counts.missingReasons[key] ?? 0))
    || (positioned && (minimum.some((value,i) => value !== manifest.bounds.whole.min[i]) || maximum.some((value,i) => value !== manifest.bounds.whole.max[i])))) fail('Atlas coverage/bounds do not match buffers');
  return { manifest, positions, valid, groups, nodes };
}

/** Exact known profile and hashes only; paths are selected by the application, not a manifest. */
export async function loadAtlas(directory, dataset, { signal } = {}) {
  if (!Object.hasOwn(PROFILES, dataset ?? '') || endianness() !== 'LE') fail('Unsupported atlas profile/byte order');
  const lock = JSON.parse(await readFile(new URL('../connectome/atlas.lock.json', import.meta.url), 'utf8'));
  if (lock.schemaVersion !== 1 || !validHash(lock.profiles?.[dataset]?.manifestSha256)) fail('Missing compatible atlas lock');
  if ((await stat(join(directory, 'manifest.json'))).size > 65536) fail('Oversized atlas manifest');
  const manifestBytes = await readFile(join(directory, 'manifest.json'), { signal });
  const manifestSha256 = hash(manifestBytes);
  if (manifestSha256 !== lock.profiles[dataset].manifestSha256) fail('Atlas manifest hash mismatch');
  const manifest = validateAtlasMetadata(JSON.parse(manifestBytes), dataset), files = {};
  for (const name of ATLAS_FILES) {
    if ((await stat(join(directory, name))).size !== manifest.files[name].bytes) fail('Atlas buffer size mismatch');
    const bytes = await readFile(join(directory, name), { signal });
    if (bytes.length !== manifest.files[name].bytes || hash(bytes) !== manifest.files[name].sha256) fail('Atlas buffer hash mismatch');
    files[name] = bytes;
  }
  const positionBytes = files['positions.f32'];
  const positions = positionBytes.byteOffset % 4 === 0 ? new Float32Array(positionBytes.buffer, positionBytes.byteOffset, positionBytes.length / 4)
    : new Float32Array(Uint8Array.from(positionBytes).buffer);
  return { ...validateAtlasBuffers(manifest, { positions, valid: files['valid.u8'], groups: files['groups.u8'], nodes: JSON.parse(files['nodes.json']) }), manifestSha256, assets: files };
}
