import { join } from 'node:path';
import { loadAtlas, ATLAS_FILES } from './atlas-data.js';

const PROFILES = Object.freeze({ 'male-cns-v1': 'male-cns:v1.0', 'banc-v888': 'banc:v888' });
const sendJson = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
/** Lazy, read-only anatomical assets. A profile is verified once and serves those exact bytes.
 * Unavailable/corrupt sources are never replaced with a fixture or downloaded automatically.
 */
export function createAtlasHttp({ directory, load = loadAtlas }) {
  const cache = new Map();
  return async (request, response, pathname) => {
    if (!pathname.startsWith('/api/atlas/')) return false;
    if (/^\/api\/atlas\/[a-z0-9-]+\/(connectivity|adjacency)$/.test(pathname)) return false;
    const match = /^\/api\/atlas\/([a-z0-9-]+)(?:\/([^/]+))?$/.exec(pathname);
    if (!match || !Object.hasOwn(PROFILES, match[1]) || (match[2] && !ATLAS_FILES.includes(match[2]))) {
      sendJson(response, 404, { error: 'Atlas route not found.' }); return true;
    }
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'Anatomical assets are read-only.' }); return true; }
    const [, slug, file] = match;
    if (!cache.has(slug)) cache.set(slug, load(join(directory, slug), PROFILES[slug]).then(({ manifest, manifestSha256, assets }) => ({ manifest, manifestSha256, assets })).catch(() => null));
    const atlas = await cache.get(slug);
    if (!atlas) {
      // Permit a later explicit read to see locally generated/repaired files, never retry in a loop.
      cache.delete(slug);
      sendJson(response, file ? 503 : 200, { available: false, dataset: PROFILES[slug], reason: 'Exact pinned anatomical files are missing, incompatible or unreadable. No synthetic anatomy substituted.' });
      return true;
    }
    if (!file) sendJson(response, 200, { available: true, manifest: atlas.manifest, manifestSha256: atlas.manifestSha256 });
    else {
      response.writeHead(200, { 'Content-Type': file === 'nodes.json' ? 'application/json' : 'application/octet-stream',
        'Content-Length': atlas.assets[file].length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'X-Atlas-Sha256': atlas.manifest.files[file].sha256 });
      response.end(atlas.assets[file]);
    }
    return true;
  };
}
