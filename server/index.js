import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, RuntimeError } from './runtime.js';
import { openIdentityStore } from './identity-store.js';
import ecosystem from '../ecosystem.config.cjs';

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

/** Polling observers share this one runtime. Wall-clock gaps never catch up simulation time. */
export function createServer({ runtime = createRuntime(), identities = null, distDir = fileURLToPath(new URL('../dist/', import.meta.url)), autoTick = true, allowedOrigins = [], allowedHosts = [] } = {}) {
  const root = resolve(distDir);
  const stateFor = id => identities ? identities.snapshot(id) : runtime.snapshot();
  const sequences = new Map();
  const sequenceFor = id => sequences.get(id ?? identities?.primaryId) ?? 0;
  const snapshot = id => ({ ...stateFor(id), commandSequence: sequenceFor(id) });
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
            llm: state.capabilities.llm });
        }
        if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, snapshot());
        if (identities && request.method === 'GET' && url.pathname === '/api/individuals') {
          return json(response, 200, { protocolVersion: 1, individuals: identities.list() });
        }
        const individualRoute = /^\/api\/individuals\/([0-9a-f-]+)(?:\/(checkpoints|restore|replicas))?$/.exec(url.pathname);
        if (identities && individualRoute && request.method === 'GET') {
          const [, id, operation] = individualRoute;
          if (!operation) return json(response, 200, snapshot(id));
          if (operation === 'checkpoints') return json(response, 200, { protocolVersion: 1, checkpoints: identities.checkpoints(id) });
          throw new RuntimeError('Use POST for this operation.', 405);
        }
        if (url.pathname === '/api/control' || url.pathname === '/api/encounters' || (identities && individualRoute)) {
          if (request.method !== 'POST') throw new RuntimeError('Use POST for this operation.', 405);
          const origin = request.headers.origin;
          // Same-origin browser UI or explicitly configured local Vite origin. CLI requests have no Origin.
          if (origin && origin !== base.origin && !allowedOrigins.includes(origin)) throw new RuntimeError('Origin is not allowed.', 403);
          if (request.headers['sec-fetch-site'] === 'cross-site') throw new RuntimeError('Cross-site mutation refused.', 403);
          const body = await readBody(request);
          if (identities) {
            const id = individualRoute ? individualRoute[1] : identities.primaryId;
            const operation = individualRoute ? individualRoute[2] : url.pathname.slice(5);
            const field = operation === 'control' ? 'action' : operation === 'encounters' ? 'compoundId'
              : ['restore', 'replicas'].includes(operation) ? 'checkpointId' : null;
            if (!['control', 'encounters', 'checkpoints', 'restore', 'replicas'].includes(operation)) throw new RuntimeError('API route not found.', 404);
            if (field && typeof body[field] !== 'string') throw new RuntimeError(`Expected a string ${field}.`);
            validateCommand(body, field ? [field] : [], id);
            let state;
            if (operation === 'control') state = identities.control(id, body.action);
            else if (operation === 'encounters') state = identities.encounter(id, body.compoundId);
            else if (operation === 'checkpoints') state = identities.save(id);
            else if (operation === 'restore') state = identities.restore(id, body.checkpointId);
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
  server.on('listening', () => { if (autoTick) timer = setInterval(() => identities ? identities.step() : runtime.step(), 50); });
  server.on('close', () => { clearInterval(timer); identities?.close(); });
  return server;
}

const entryPath = process.env.pm_exec_path ?? process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? ecosystem.PORTS.api);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const host = process.env.HOST ?? '127.0.0.1';
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const identities = openIdentityStore(process.env.FLY_GARDEN_DATA_DIR ?? fileURLToPath(new URL('../data/identities/', import.meta.url)));
  const server = createServer({ identities, allowedHosts, allowedOrigins: (process.env.DEV_ORIGINS ?? `http://127.0.0.1:${ecosystem.PORTS.devUi},http://localhost:${ecosystem.PORTS.devUi}`).split(',').filter(Boolean) });
  server.listen(port, host, () => {
    console.log(`Fly Garden: http://${host}:${port} — synthetic fixture paused`);
    process.send?.('ready');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
