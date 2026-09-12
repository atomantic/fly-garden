import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAtlasHttp } from './atlas-http.js';

async function fixture(t, load) {
  const handler = createAtlasHttp({ directory: '/known-atlas-root', load });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response, new URL(request.url, 'http://localhost').pathname)) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}

test('atlas routes are lazy, exact-profile, read-only and share one verified asset snapshot', async t => {
  const calls = [], bytes = Buffer.from('[[]]');
  const request = await fixture(t, async (directory, dataset) => {
    calls.push([directory, dataset]);
    return { manifest: { files: { 'nodes.json': { sha256: 'verified' } } }, manifestSha256: 'manifest', assets: { 'nodes.json': bytes } };
  });
  assert.equal(calls.length, 0);
  assert.equal((await request('/api/atlas/male-cns-v1', { method: 'POST' })).status, 405);
  assert.equal((await request('/api/atlas/male-cns-v1/../../secrets')).status, 404);
  assert.equal((await request('/api/atlas/male-cns-v1/manifest.json')).status, 404);
  assert.equal((await request('/api/atlas/unknown')).status, 404);
  assert.equal(calls.length, 0);
  const [a,b] = await Promise.all([request('/api/atlas/male-cns-v1'), request('/api/atlas/male-cns-v1/nodes.json')]);
  assert.equal((await a.json()).available, true);
  assert.equal(await b.text(), bytes.toString());
  assert.equal(b.headers.get('x-atlas-sha256'), 'verified');
  assert.deepEqual(calls, [['/known-atlas-root/male-cns-v1', 'male-cns:v1.0']]);
  await request('/api/atlas/banc-v888');
  assert.equal(calls[1][1], 'banc:v888');
});

test('missing or corrupt anatomical assets report unavailable without fallback; a later explicit read can recover', async t => {
  let available = false, calls = 0;
  const request = await fixture(t, async () => {
    calls++; if (!available) throw new Error('private path or source failure');
    return { manifest: {}, manifestSha256: 'restored', assets: {} };
  });
  const unavailable = await (await request('/api/atlas/male-cns-v1')).json();
  assert.equal(unavailable.available, false);
  assert.doesNotMatch(JSON.stringify(unavailable), /private path/);
  assert.equal((await request('/api/atlas/male-cns-v1/positions.f32')).status, 503);
  assert.equal(calls, 2);
  available = true;
  assert.equal((await (await request('/api/atlas/male-cns-v1')).json()).available, true);
});
