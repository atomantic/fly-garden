import { RuntimeError } from './runtime.js';
import { buildMixedWorldPresentation } from '../shared/mixed-world-presentation.js';

/**
 * `GET /api/mixed-world`: the render-only mixed shared-world presentation.
 *
 * Observation only. It reads committed public shared-session snapshots through two injected
 * read functions and never joins, starts, advances, loads, checkpoints, restores, pauses or
 * otherwise mutates a participant, and it consumes no command sequence. Every other method is
 * refused. A failing source read withholds the whole world with a fixed message, so error text
 * (which could name a local path) never reaches the observer and no participant silently drops.
 */
export function createMixedWorldHttp({ readFixtureSessions = null, readConnectomeView = null, json, now = Date.now }) {
  if (typeof json !== 'function' || (readFixtureSessions !== null && typeof readFixtureSessions !== 'function')
    || (readConnectomeView !== null && typeof readConnectomeView !== 'function')) throw new Error('Invalid mixed world HTTP configuration');
  const read = (reader, pick) => {
    if (!reader) return { available: false, sessions: [] };
    try { return pick(reader()); } catch { return { available: false, sessions: [], failed: true }; }
  };
  return function handle(request, response, url) {
    if (url.pathname !== '/api/mixed-world') return false;
    if (url.search) throw new RuntimeError('The mixed world presentation does not accept query parameters.', 400);
    if (request.method !== 'GET') throw new RuntimeError('The mixed world presentation is read-only.', 405);
    const fixture = read(readFixtureSessions, sessions => ({ available: true, sessions }));
    const connectome = read(readConnectomeView, view => ({ available: view?.available === true, sessions: view?.sessions }));
    json(response, 200, buildMixedWorldPresentation({ fixture, connectome, generatedAtMs: now() }));
    return true;
  };
}
