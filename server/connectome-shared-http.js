import { RuntimeError } from './runtime.js';

const fail = (message, statusCode = 409) => { throw new RuntimeError(message, statusCode); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function createConnectomeSharedHttp({ service, readBody, json, checkOrigin }) {
  if (!service || typeof service.view !== 'function' || typeof service.snapshot !== 'function') throw new Error('Invalid shared connectome HTTP service');
  return async function handle(request, response, url, base) {
    if (url.pathname !== '/api/connectomes/shared' && !url.pathname.startsWith('/api/connectomes/shared/')) return false;
    if (url.search) fail('Shared research endpoints do not accept query parameters.');
    const collection = url.pathname === '/api/connectomes/shared';
    const join = url.pathname === '/api/connectomes/shared/join';
    const match = /^\/api\/connectomes\/shared\/([0-9a-f-]+)(?:\/(control|barrier|member))?$/.exec(url.pathname);
    if (!collection && !join && !match) fail('Shared research API route not found.', 404);
    if (request.method === 'GET' && collection) { json(response, 200, service.view()); return true; }
    if (request.method === 'GET' && match && !match[2]) { json(response, 200, service.snapshot(match[1])); return true; }
    if (request.method !== 'POST') fail('Use POST for shared research mutations.', 405);
    checkOrigin(request, base);
    const body = await readBody(request, 64 * 1024);
    try {
      if (join) {
        if (!exact(body, ['protocolVersion', 'members'])) fail('Invalid shared research join envelope.');
        json(response, 200, await service.join(body));
      } else if (match?.[2] === 'control') {
        json(response, 200, await service.control(match[1], body));
      } else if (match?.[2] === 'barrier') {
        json(response, 200, await service.advance(match[1], body));
      } else if (match?.[2] === 'member') {
        json(response, 200, await service.member(match[1], body));
      } else fail('Shared research API route not found.', 404);
    } catch (error) {
      if (error instanceof RuntimeError) json(response, error.statusCode, { error: error.message });
      else json(response, 409, { error: 'Shared research operation failed; refresh the paused session before retrying.' });
    }
    return true;
  };
}
