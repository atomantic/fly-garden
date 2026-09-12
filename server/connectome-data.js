import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { endianness } from 'node:os';
import { join } from 'node:path';
import { validateGraph } from './sparse-lif.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Fixed filenames and pinned derived hashes: disk data cannot choose executable code or paths. */
export async function loadConnectome(directory) {
  const expected = JSON.parse(await readFile(new URL('../connectome/graph.lock.json', import.meta.url), 'utf8'));
  if ((await stat(join(directory, 'manifest.json'))).size > 65536) throw new Error('Oversized dataset manifest');
  const manifestBytes = await readFile(join(directory, 'manifest.json'));
  if (sha256(manifestBytes) !== expected.manifestSha256 || endianness() !== 'LE') {
    throw new Error('Incompatible dataset manifest or byte order');
  }
  const manifest = JSON.parse(manifestBytes);
  const files = {};
  for (const name of ['ids.json', 'offsets.u32', 'targets.u32', 'contacts.u32', 'signs.i8']) {
    if ((await stat(join(directory, name))).size !== manifest.files[name].bytes) throw new Error('Dataset array size mismatch');
    const bytes = await readFile(join(directory, name));
    if (bytes.length !== manifest.files[name].bytes || sha256(bytes) !== manifest.files[name].sha256) {
      throw new Error('Dataset array hash/size mismatch');
    }
    files[name] = bytes;
  }
  const view = (name, Type) => {
    const bytes = files[name];
    if (bytes.byteOffset % Type.BYTES_PER_ELEMENT || bytes.length % Type.BYTES_PER_ELEMENT) {
      throw new Error('Invalid array alignment');
    }
    return new Type(bytes.buffer, bytes.byteOffset, bytes.length / Type.BYTES_PER_ELEMENT);
  };
  const graph = { ids: JSON.parse(files['ids.json'].toString('utf8')),
    offsets: view('offsets.u32', Uint32Array), targets: view('targets.u32', Uint32Array),
    contacts: view('contacts.u32', Uint32Array), signs: view('signs.i8', Int8Array) };
  validateGraph(graph);
  if (graph.ids.length !== manifest.neuronCount || graph.targets.length !== manifest.edgeCount) {
    throw new Error('Dataset count mismatch');
  }
  return { graph, manifest, manifestSha256: expected.manifestSha256 };
}
