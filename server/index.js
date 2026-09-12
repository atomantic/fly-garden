import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, RuntimeError } from './runtime.js';
import { openIdentityStore } from './identity-store.js';
import ecosystem from '../ecosystem.config.cjs';
import { createCapacityPolicy, openCapacityStore, measureFixtureFootprint } from './population-capacity.js';
import { createRecordingStore } from './recording-store.js';
import { createCreativeSessions } from './creative-session.js';
import { freemem } from 'node:os';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const isLoopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RuntimeError('Expected application/json.', 415);
  let body = '';
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new RuntimeError('Request body too large.', 413);
    body += chunk;
  }
  let parsed;
  try { parsed = JSON.parse(body); } catch { throw new RuntimeError('Invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RuntimeError('Expected a JSON object.');
  return parsed;
}

/** Polling observers share the selected resident runtimes. Wall-clock gaps never catch up simulation time. */
export function createServer({ runtime = createRuntime(), identities = null, distDir = fileURLToPath(new URL('../dist/', import.meta.url)), autoTick = true, capacity = createCapacityPolicy(), resourceUsage = () => ({ aggregateMemoryBytes: process.memoryUsage().rss, availableMemoryBytes: freemem() }), incrementalMemoryBytes = null, recordings = null, creativeSessions = createCreativeSessions(), onEnvironmentFrame = null, allowedOrigins = [], allowedHosts = [] } = {}) {
  const root = resolve(distDir);
  const pendingRecordings = new Set();
  const activeRecordings = new Map();
  let recordingFailure = null;
  let environmentCaptureFailure = null;
  const resources = () => {
    const all = identities?.list() ?? [];
    return { ...resourceUsage(), savedCount: all.length,
      residents: all.filter(value => value.resident).map(value => ({ ...value, status: identities.snapshot(value.individualId).status })) };
  };
  const population = () => ({ ...capacity.snapshot(resources()), incrementalMemoryBytes,
    admission: capacity.preflight({ ...resources(), incrementalMemoryBytes }) });
  const checkLoad = id => {
    if (identities.list().find(value => value.individualId === id)?.resident) return;
    const result = capacity.preflight({ ...resources(), incrementalMemoryBytes });
    if (!result.admitted) throw new RuntimeError(result.reason, 409);
  };
  function checkOrigin(request, base) {
    const origin = request.headers.origin;
    if (origin && origin !== base.origin && !allowedOrigins.includes(origin)) throw new RuntimeError('Origin is not allowed.', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new RuntimeError('Cross-site mutation refused.', 403);
  }
  const stateFor = id => identities ? identities.snapshot(id) : runtime.snapshot();
  const sequences = new Map();
  const sequenceFor = id => sequences.get(id ?? identities?.primaryId) ?? 0;
  const snapshot = id => {
    const state = stateFor(id);
    creativeSessions.synchronize(state);
    const creativeCapture = creativeSessions.status(state.individualId);
    return { ...state, commandSequence: sequenceFor(id), ...(creativeCapture ? { creativeCapture } : {}) };
  };
  function validateCommand(body, fields, id) {
    const expected = ['protocolVersion', 'individualId', 'sessionId', 'sequence', ...fields];
    if (Object.keys(body).length !== expected.length || expected.some(key => !Object.hasOwn(body, key))
      || body.protocolVersion !== 1 || body.individualId !== id || body.sessionId !== stateFor(id).sessionId
      || !Number.isSafeInteger(body.sequence) || body.sequence !== sequenceFor(id) + 1) {
      throw new RuntimeError('Stale or invalid command envelope; refresh state before retrying.', 409);
    }
    sequences.set(id, body.sequence);
  }
  const server = createHttpServer(async (request, response) => {
    try {
      const base = new URL(`http://${request.headers.host ?? 'localhost'}`);
      if (!isLoopback(base.hostname) && !allowedHosts.includes(base.hostname)) throw new RuntimeError('Host is not allowed.', 403);
      const url = new URL(request.url, base);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/health') {
          const state = snapshot();
          return json(response, 200, { service: 'online', mode: state.source,
            simulation: state.status, persistence: identities ? 'durable-fixture' : 'session-only',
            connectome: state.capabilities.connectome, eidoverse: state.capabilities.eidoverse,
            llm: state.capabilities.llm, population: identities ? population() : null,
            environmentCaptureFailure,
            recording: recordings ? { ...recordings.status(), failure: recordingFailure } : { available: false } });
        }
        if (identities && request.method === 'GET' && url.pathname === '/api/population') return json(response, 200, population());
        if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, snapshot());
        if (identities && request.method === 'GET' && url.pathname === '/api/individuals') {
          return json(response, 200, { protocolVersion: 1, individuals: identities.list() });
        }
        if (identities && url.pathname === '/api/population' && request.method === 'POST') {
          checkOrigin(request, base);
          const body = await readBody(request);
          try { capacity.configure(body); } catch (error) { throw new RuntimeError(error.message, 400); }
          return json(response, 200, population());
        }
        if (recordings && url.pathname === '/api/recordings' && request.method === 'GET') {
          return json(response, 200, { sessions: recordings.list(), storage: recordings.status(), failure: recordingFailure });
        }
        const recordingRoute = /^\/api\/recordings\/([0-9a-f-]+)(?:\/(export|replay|stop|delete))?$/.exec(url.pathname);
        if (recordings && recordingRoute) {
          const [, id, operation] = recordingRoute;
          try {
            if (request.method === 'GET' && [undefined, 'export', 'replay'].includes(operation)) {
              return json(response, 200, operation === 'replay' ? recordings.replay(id) : recordings.read(id));
            }
            if (request.method !== 'POST' || !['stop', 'delete'].includes(operation)) throw new RuntimeError('Method not allowed.', 405);
            checkOrigin(request, base);
            const body = await readBody(request);
            if (Object.keys(body).length) throw new RuntimeError('Expected an empty object.');
            await Promise.allSettled([...pendingRecordings]);
            activeRecordings.delete(id);
            const result = operation === 'stop' ? recordings.stop(id) : recordings.delete(id);
            return json(response, 200, result ?? { deleted: true });
          } catch (error) { throw error.statusCode ? error : new RuntimeError(error.message, 409); }
        }
        if (recordings && identities && url.pathname === '/api/recordings' && request.method === 'POST') {
          checkOrigin(request, base);
          const body = await readBody(request);
          validateCommand(body, [], body.individualId);
          const state = snapshot(body.individualId);
          if (!state.persistence.resident) throw new RuntimeError('Recording requires a loaded individual.', 409);
          if ([...activeRecordings.values()].some(value => value.individualId === state.individualId)) throw new RuntimeError('Individual already recording.', 409);
          const session = recordings.start({ individualId: state.individualId, worldId: 'home', sessionId: state.sessionId,
            modelVersion: state.model.id, datasetVersion: `${state.dataset.namespace}:${state.dataset.release}`,
            checkpointId: state.persistence.checkpointId, seed: null, participantIds: [state.individualId], sampleIntervalMs: 500 });
          activeRecordings.set(session.id, { individualId: state.individualId, sessionId: state.sessionId });
          return json(response, 200, session);
        }
        const artifactRoute = /^\/api\/individuals\/([0-9a-f-]+)\/artifacts(?:\/export\/(json|mid|svg|png))?$/.exec(url.pathname);
        if (identities && artifactRoute) {
          const [, id, format] = artifactRoute;
          creativeSessions.synchronize(stateFor(id));
          if (request.method === 'GET') {
            if (!format) return json(response, 200, creativeSessions.status(id));
            try {
              const result = creativeSessions.export(id, format);
              response.writeHead(200, { 'Content-Type': { json: 'application/json', mid: 'audio/midi', svg: 'image/svg+xml', png: 'image/png' }[format],
                'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Artifact-Partial': String(result.partial),
                'Content-Disposition': `attachment; filename="fly-garden-${id}${result.partial ? '-partial' : ''}.${format}"` });
              return response.end(result.bytes);
            } catch (error) { throw new RuntimeError(error.message, 409); }
          }
          if (request.method !== 'POST' || format) throw new RuntimeError('Method not allowed.', 405);
          checkOrigin(request, base);
          const body = await readBody(request);
          validateCommand(body, ['action'], id);
          try {
            if (body.action === 'start') creativeSessions.start(stateFor(id));
            else if (body.action === 'stop') creativeSessions.stop(id);
            else if (body.action === 'discard') creativeSessions.discard(id);
            else throw new Error('Unknown movement capture action.');
          } catch (error) { throw new RuntimeError(error.message, 409); }
          return json(response, 200, snapshot(id));
        }
        const environmentRoute = /^\/api\/individuals\/([0-9a-f-]+)\/environment(?:\/(frames))?$/.exec(url.pathname);
        if (identities && environmentRoute) {
          const [, id, operation] = environmentRoute;
          if (request.method === 'GET' && !operation) return json(response, 200, identities.environmentSnapshot(id));
          if (request.method !== 'POST') throw new RuntimeError('Use POST for this environment operation.', 405);
          checkOrigin(request, base);
          const body = await readBody(request);
          if (operation === 'frames') {
            const result = identities.environmentFrame(id, body);
            try { creativeSessions.capture(result.state); }
            catch { environmentCaptureFailure = 'Movement capture failed; accepted sensory state was preserved.'; }
            if (onEnvironmentFrame) {
              try {
                Promise.resolve(onEnvironmentFrame(structuredClone({ ...result.state, environmentTrace: result.trace })))
                  .catch(() => { environmentCaptureFailure = 'Creative capture failed; accepted sensory state was preserved.'; });
              } catch { environmentCaptureFailure = 'Creative capture failed; accepted sensory state was preserved.'; }
            }
            return json(response, 200, { ...result, state: snapshot(id) });
          }
          validateCommand(body, ['action'], id);
          return json(response, 200, { ...identities.environmentControl(id, body.action), commandSequence: sequenceFor(id) });
        }
        const individualRoute = /^\/api\/individuals\/([0-9a-f-]+)(?:\/(checkpoints|restore|replicas|control|encounters|load|unload))?$/.exec(url.pathname);
        if (identities && individualRoute && request.method === 'GET') {
          const [, id, operation] = individualRoute;
          if (!operation) return json(response, 200, snapshot(id));
          if (operation === 'checkpoints') return json(response, 200, { protocolVersion: 1, checkpoints: identities.checkpoints(id) });
          throw new RuntimeError('Use POST for this operation.', 405);
        }
        const createIndividual = identities && url.pathname === '/api/individuals';
        if (url.pathname === '/api/control' || url.pathname === '/api/encounters' || createIndividual || (identities && individualRoute)) {
          if (request.method !== 'POST') throw new RuntimeError('Use POST for this operation.', 405);
          const origin = request.headers.origin;
          // Same-origin browser UI or explicitly configured local Vite origin. CLI requests have no Origin.
          if (origin && origin !== base.origin && !allowedOrigins.includes(origin)) throw new RuntimeError('Origin is not allowed.', 403);
          if (request.headers['sec-fetch-site'] === 'cross-site') throw new RuntimeError('Cross-site mutation refused.', 403);
          const body = await readBody(request);
          if (identities) {
            const id = individualRoute ? individualRoute[1] : identities.primaryId;
            const operation = createIndividual ? 'create' : individualRoute ? individualRoute[2] : url.pathname.slice(5);
            const field = operation === 'control' ? 'action' : operation === 'encounters' ? 'compoundId'
              : ['restore', 'replicas'].includes(operation) ? 'checkpointId' : null;
            if (!['control', 'encounters', 'checkpoints', 'restore', 'replicas', 'load', 'unload', 'create'].includes(operation)) throw new RuntimeError('API route not found.', 404);
            if (field && typeof body[field] !== 'string') throw new RuntimeError(`Expected a string ${field}.`);
            validateCommand(body, field ? [field] : [], id);
            let state;
            if (operation === 'create') state = identities.createIndividual();
            else if (operation === 'control') state = identities.control(id, body.action);
            else if (operation === 'encounters') state = identities.encounter(id, body.compoundId);
            else if (operation === 'checkpoints') state = identities.save(id);
            else if (operation === 'restore') state = identities.restore(id, body.checkpointId);
            else if (operation === 'load') { checkLoad(id); state = identities.load(id); }
            else if (operation === 'unload') state = identities.unload(id);
            else state = identities.replica(id, body.checkpointId);
            return json(response, 200, { ...state, commandSequence: sequenceFor(state.individualId) });
          }
          const key = url.pathname === '/api/control' ? 'action' : 'compoundId';
          if (typeof body[key] !== 'string' || Object.keys(body).some(k => k !== key)) throw new RuntimeError(`Expected only a string ${key}.`);
          const state = key === 'action' ? runtime.control(body.action) : runtime.encounter(body.compoundId);
          return json(response, 200, { ...state, commandSequence: sequenceFor(state.individualId) });
        }
        throw new RuntimeError('API route not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new RuntimeError('Method not allowed.', 405);
      const pathname = decodeURIComponent(url.pathname);
      const candidate = resolve(root, `.${pathname}`);
      if (candidate !== root && !candidate.startsWith(root + sep)) throw new RuntimeError('Invalid path.', 400);
      let file = candidate;
      try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html'); }
      catch { file = extname(pathname) ? candidate : resolve(root, 'index.html'); }
      let content;
      try { content = await readFile(file); }
      catch { throw new RuntimeError('UI not built or file not found. Run npm run build.', 404); }
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!response.headersSent) json(response, error.statusCode ?? (error instanceof URIError ? 400 : 500), { error: error.statusCode ? error.message : 'Request failed.' });
    }
  });
  let timer;
  let sampleTick = 0;
  server.on('listening', () => { if (autoTick) timer = setInterval(() => {
    if (identities) {
      const budget = population();
      if (budget.pressure !== 'within-budget') {
        for (const resident of identities.list().filter(value => value.resident)) identities.control(resident.individualId, 'pause');
      } else identities.step();
    } else runtime.step();
    if (++sampleTick % 10 !== 0 || !recordings) return;
    // One bounded capture batch at a time; serialize writes fairly without awaiting the neural timer.
    if (pendingRecordings.size) {
      for (const id of activeRecordings.keys()) {
        try { recordings.dropSample(id); }
        catch { recordingFailure = 'Recording gap could not be saved.'; activeRecordings.delete(id); }
      }
      return;
    }
    const captures = [...activeRecordings].slice(0, 64).map(([id, source]) => ({ id, source, state: snapshot(source.individualId), wallTimeMs: Date.now() }));
    const batch = (async () => {
      for (const { id, source, state, wallTimeMs } of captures) {
        if (!activeRecordings.has(id)) continue;
        try {
          const result = await recordings.append(id, !state.persistence.resident || state.sessionId !== source.sessionId
            ? { sessionId: null }
            : { individualId: state.individualId, worldId: 'home', sessionId: state.sessionId,
              simulationTimeMs: state.simTimeMs, worldTimeMs: state.simTimeMs, wallTimeMs,
              sourceStartMs: Math.max(0, state.simTimeMs - 1000), sourceEndMs: state.simTimeMs,
              ratesHz: state.neural.neurons.map(value => value.rateHz) });
          if (result.session.status !== 'recording') activeRecordings.delete(id);
        } catch {
          recordingFailure = 'Recording failed; simulation state was preserved.';
          activeRecordings.delete(id);
        }
      }
    })();
    pendingRecordings.add(batch);
    batch.finally(() => pendingRecordings.delete(batch));
  }, 50); });
  server.on('close', () => { clearInterval(timer); identities?.close();
    Promise.allSettled([...pendingRecordings]).then(() => recordings?.close()); });
  return server;
}

const entryPath = process.env.pm_exec_path ?? process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? ecosystem.PORTS.api);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = process.env.HOST ?? '127.0.0.1';
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const dataDirectory = process.env.FLY_GARDEN_DATA_DIR ?? fileURLToPath(new URL('../data/identities/', import.meta.url));
  const identities = openIdentityStore(dataDirectory, { loadPrimary: false });
  const capacity = openCapacityStore(dataDirectory);
  const footprint = measureFixtureFootprint(() => createRuntime());
  const admission = capacity.preflight({ residents: [], incrementalMemoryBytes: footprint.incrementalMemoryBytes,
    aggregateMemoryBytes: process.memoryUsage().rss, availableMemoryBytes: freemem() });
  if (admission.admitted) identities.load(identities.primaryId);
  const recordings = createRecordingStore({ directory: resolve(dataDirectory, 'recordings') });
  const server = createServer({ identities, capacity, incrementalMemoryBytes: footprint.incrementalMemoryBytes, recordings, allowedHosts, allowedOrigins: (process.env.DEV_ORIGINS ?? `http://127.0.0.1:${ecosystem.PORTS.devUi},http://localhost:${ecosystem.PORTS.devUi}`).split(',').filter(Boolean) });
  server.listen(port, host, () => {
    console.log(`Fly Garden: http://${host}:${port} — synthetic fixture paused`);
    process.send?.('ready');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
