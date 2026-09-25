import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { RuntimeError } from './runtime.js';
import { createCrossCatalogHttp } from './cross-catalog-http.js';

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const refusal = message => Object.assign(new RuntimeError(message, 409), { code: 'CROSS_CATALOG_REFUSED' });
const json = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
const readBody = async (request, maxBytes) => {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new RuntimeError('Expected application/json.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new RuntimeError('Request body too large.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required');
    return value;
  } catch {
    throw new RuntimeError('Invalid JSON.', 400);
  }
};
const checkOrigin = (request, base) => {
  if (request.headers.origin && request.headers.origin !== base.origin) throw new RuntimeError('Origin is not allowed.', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new RuntimeError('Cross-site mutation refused.', 403);
};

async function setup(t, { unavailable = false } = {}) {
  const received = [];
  const member = { individualId: randomUUID(), catalogId: 'fixture' };
  const recovery = {
    transactionId: randomUUID(),
    operation: 'restore',
    state: 'recovery-required',
    reason: 'Explicit operator recovery is required.',
    catalogs: [{ catalogType: 'full-connectome', catalogId: 'connectome:male', catalogEpoch: randomUUID(), state: 'uncertain' }],
    affectedHeads: [{ individualId: member.individualId, catalogType: 'fixture-identity', catalogId: 'fixture', priorHead: null, plannedHead: randomUUID(), selectedHead: randomUUID() }],
    journalReopenRequired: false,
  };
  const failure = message => {
    const error = refusal(message);
    error.cause = new Error('/private/cause');
    error.path = '/private/catalog';
    error.payload = { secret: 'PRIVATE_PAYLOAD' };
    return error;
  };
  const unavailableFailure = () => Object.assign(new RuntimeError('Cross-catalog checkpoint service is unavailable; existing state was preserved.', 409), {
    code: 'CROSS_CATALOG_UNAVAILABLE',
  });
  const service = {
    view: () => ({
      protocolVersion: 1,
      kind: 'cross-catalog-checkpoint-status',
      available: !unavailable,
      busy: false,
      recovery: null,
      catalogs: [
        { catalogId: 'fixture', catalogType: 'fixture-identity' },
        { catalogId: 'connectome:male', catalogType: 'full-connectome' },
        { catalogId: 'connectome:banc', catalogType: 'full-connectome' },
      ],
    }),
    checkpoints: () => [],
    async save(body) {
      received.push(['save', body]);
      if (unavailable) throw unavailableFailure();
      if (!exact(body, ['protocolVersion', 'intervalMs', 'tick', 'members'])) throw failure('Invalid cross-catalog save envelope.');
      return { operation: 'save', envelope: body };
    },
    async restore(body) {
      received.push(['restore', body]);
      if (unavailable) throw unavailableFailure();
      if (!exact(body, ['protocolVersion', 'jointCheckpointId', 'members'])) throw failure('Invalid cross-catalog restore envelope.');
      return { operation: 'restore', envelope: body };
    },
    async recover(body) {
      received.push(['recover', body]);
      if (unavailable) throw unavailableFailure();
      if (!exact(body, ['protocolVersion', 'transactionId', 'action']) || !['rollback', 'complete'].includes(body.action)) {
        const error = failure('Invalid cross-catalog recovery envelope.');
        error.code = 'CROSS_CATALOG_RECOVERY_REQUIRED';
        error.recovery = { ...recovery, path: '/private/recovery' };
        error.affectedHeads = recovery.affectedHeads.map(head => ({ ...head, payload: { secret: 'PRIVATE_PAYLOAD' } }));
        throw error;
      }
      return { operation: 'recover', envelope: body };
    },
  };
  let maxBodyBytes = null;
  const handler = createCrossCatalogHttp({
    service,
    readBody: async (request, maxBytes) => { maxBodyBytes = maxBytes; return readBody(request, maxBytes); },
    json,
    checkOrigin,
  });
  const server = createServer(async (request, response) => {
    const base = new URL(`http://${request.headers.host}`);
    try {
      if (await handler(request, response, new URL(request.url, base), base)) return;
      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (!response.headersSent) json(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : 'Request failed.' });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined && !raw ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { base, handler, member, received, request, maxBodyBytes: () => maxBodyBytes };
}

test('HTTP owns only cross-catalog routes, forwards exact envelopes and enforces origin, method, query, media and size boundaries', async t => {
  const h = await setup(t);
  assert.equal(await h.handler({}, {}, new URL('http://localhost/api/connectomes'), new URL('http://localhost')), false);
  assert.deepEqual((await h.request('/api/cross-catalog')).body, {
    protocolVersion: 1,
    kind: 'cross-catalog-checkpoint-status',
    available: true,
    busy: false,
    recovery: null,
    catalogs: [
      { catalogId: 'fixture', catalogType: 'fixture-identity' },
      { catalogId: 'connectome:male', catalogType: 'full-connectome' },
      { catalogId: 'connectome:banc', catalogType: 'full-connectome' },
    ],
  });
  assert.deepEqual((await h.request('/api/cross-catalog/checkpoints')).body, { checkpoints: [] });
  assert.equal((await h.request('/api/cross-catalog?unexpected=1')).status, 400);
  assert.equal((await h.request('/api/cross-catalog/unknown')).status, 404);
  assert.equal((await h.request('/api/cross-catalog/restore')).status, 405);
  assert.equal((await h.request('/api/cross-catalog/checkpoints', { method: 'POST', body: {} })).status, 405);
  assert.equal((await h.request('/api/cross-catalog', { method: 'PUT', body: {} })).status, 405);

  const save = { protocolVersion: 1, intervalMs: 5, tick: 0, members: [h.member] };
  const restore = { protocolVersion: 1, jointCheckpointId: randomUUID(), members: [h.member] };
  const recover = { protocolVersion: 1, transactionId: randomUUID(), action: 'rollback' };
  const saved = await h.request('/api/cross-catalog', { method: 'POST', body: save, headers: { Origin: h.base } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { operation: 'save', envelope: save });
  assert.deepEqual(h.received[0], ['save', save]);
  assert.equal((await h.request('/api/cross-catalog', { method: 'POST', body: restore, headers: { Origin: 'https://outside.test' } })).status, 403);
  assert.equal((await h.request('/api/cross-catalog/restore', { method: 'POST', body: restore })).status, 200);
  assert.deepEqual(h.received.at(-1), ['restore', restore]);
  assert.equal((await h.request('/api/cross-catalog/recover', { method: 'POST', body: recover })).status, 200);
  assert.deepEqual(h.received.at(-1), ['recover', recover]);
  assert.equal(h.maxBodyBytes(), 64 * 1024);

  const calls = h.received.length;
  assert.equal((await h.request('/api/cross-catalog', { method: 'POST', raw: true, body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await h.request('/api/cross-catalog', { method: 'POST', body: { padding: 'x'.repeat(64 * 1024) } })).status, 413);
  assert.equal(h.received.length, calls);

  const secret = '/private/catalog';
  const unknown = { protocolVersion: 1, intervalMs: 5, tick: 0, members: [h.member], directory: secret };
  const refused = await h.request('/api/cross-catalog', { method: 'POST', body: unknown });
  assert.equal(refused.status, 409);
  assert.deepEqual(Object.keys(refused.body).sort(), ['code', 'error']);
  assert.equal(refused.body.code, 'CROSS_CATALOG_REFUSED');
  assert.equal(JSON.stringify(refused.body).includes(secret), false);
  assert.deepEqual(h.received.at(-1), ['save', unknown]);
});

test('HTTP exposes only safe recovery fields and keeps an unavailable service explicit', async t => {
  const h = await setup(t);
  const response = await h.request('/api/cross-catalog/recover', {
    method: 'POST',
    body: { protocolVersion: 1, transactionId: randomUUID(), action: 'unexpected' },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(Object.keys(response.body).sort(), ['affectedHeads', 'code', 'error', 'recovery']);
  assert.equal(response.body.code, 'CROSS_CATALOG_RECOVERY_REQUIRED');
  assert.equal(JSON.stringify(response.body).includes('/private'), false);
  assert.equal(JSON.stringify(response.body).includes('PRIVATE_PAYLOAD'), false);
  assert.equal(Object.hasOwn(response.body.recovery, 'path'), false);
  assert.equal(Object.hasOwn(response.body.affectedHeads[0], 'payload'), false);

  const unavailable = await setup(t, { unavailable: true });
  const status = await unavailable.request('/api/cross-catalog');
  assert.equal(status.status, 200);
  assert.equal(status.body.available, false);
  assert.deepEqual((await unavailable.request('/api/cross-catalog/checkpoints')).body, { checkpoints: [] });
  const mutation = await unavailable.request('/api/cross-catalog', { method: 'POST', body: { protocolVersion: 1, intervalMs: 5, tick: 0, members: [] } });
  assert.equal(mutation.status, 409);
  assert.deepEqual(Object.keys(mutation.body).sort(), ['code', 'error']);
  assert.equal(mutation.body.code, 'CROSS_CATALOG_UNAVAILABLE');
});
