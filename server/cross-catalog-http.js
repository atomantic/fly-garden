import { RuntimeError } from './runtime.js';

const SAFE_CODES = new Set([
  'CROSS_CATALOG_REFUSED',
  'CROSS_CATALOG_UNAVAILABLE',
  'CROSS_CATALOG_BUSY',
  'CROSS_CATALOG_RECOVERY_REQUIRED',
  'CROSS_CATALOG_CAPACITY',
  'CROSS_CATALOG_STALE',
  'CROSS_CATALOG_DISAGREEMENT',
  'CROSS_CATALOG_ROLLED_BACK',
  'CROSS_CATALOG_RUNTIME_EVICTED',
  'CROSS_CATALOG_NOT_FOUND',
  'CROSS_CATALOG_JOURNAL_CORRUPT',
  'CROSS_CATALOG_JOURNAL_UNCERTAIN',
  'CROSS_CATALOG_OPERATION_FAILED',
]);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\\/\0]/.test(value) ? value : null;
const nullable = (value, project) => value === null ? null : project(value);
const safeHeads = value => {
  if (!Array.isArray(value)) return null;
  const heads = value.slice(0, 64).filter(object).map(head => ({
    individualId: text(head.individualId, 64),
    catalogType: text(head.catalogType, 32),
    catalogId: text(head.catalogId, 64),
    priorHead: nullable(head.priorHead, item => text(item, 64)),
    plannedHead: nullable(head.plannedHead, item => text(item, 64)),
    selectedHead: nullable(head.selectedHead, item => text(item, 64)),
  })).filter(head => head.individualId && head.catalogType && head.catalogId);
  return heads;
};
const safeRecovery = value => {
  if (!object(value)) return null;
  const affectedHeads = safeHeads(value.affectedHeads);
  if (!affectedHeads) return null;
  return {
    transactionId: text(value.transactionId, 64),
    operation: ['save', 'restore'].includes(value.operation) ? value.operation : null,
    state: text(value.state, 32),
    reason: nullable(value.reason, item => text(item, 512)),
    catalogs: Array.isArray(value.catalogs) ? value.catalogs.slice(0, 8).filter(object).map(catalog => ({
      catalogType: text(catalog.catalogType, 32),
      catalogId: text(catalog.catalogId, 64),
      catalogEpoch: text(catalog.catalogEpoch, 128),
      state: text(catalog.state, 32),
    })) : [],
    affectedHeads,
    journalReopenRequired: value.journalReopenRequired === true,
  };
};
const safeFailure = error => {
  const known = typeof error?.code === 'string' && SAFE_CODES.has(error.code);
  const message = known && error instanceof RuntimeError && typeof error.message === 'string'
    && error.message.length <= 512 && !/[\\/\0]/.test(error.message)
    ? error.message : 'Cross-catalog operation failed; existing state was preserved.';
  const recovery = safeRecovery(error?.recovery);
  const affectedHeads = safeHeads(error?.affectedHeads);
  return {
    error: message,
    code: known ? error.code : 'CROSS_CATALOG_OPERATION_FAILED',
    ...(recovery ? { recovery } : {}),
    ...(affectedHeads ? { affectedHeads } : {}),
  };
};
const statusFor = error => error instanceof RuntimeError && Number.isInteger(error.statusCode)
  && error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : 409;

export function createCrossCatalogHttp({ service, readBody, json, checkOrigin }) {
  if (!service || ['view', 'checkpoints', 'save', 'restore', 'recover'].some(method => typeof service[method] !== 'function')
    || typeof readBody !== 'function' || typeof json !== 'function' || typeof checkOrigin !== 'function') {
    throw new Error('Invalid cross-catalog HTTP configuration');
  }
  return async function handle(request, response, url, base) {
    if (url.pathname !== '/api/cross-catalog' && !url.pathname.startsWith('/api/cross-catalog/')) return false;
    if (url.search) throw new RuntimeError('Cross-catalog endpoints do not accept query parameters.');
    const route = url.pathname === '/api/cross-catalog' ? 'status'
      : url.pathname === '/api/cross-catalog/checkpoints' ? 'checkpoints'
        : url.pathname === '/api/cross-catalog/restore' ? 'restore'
          : url.pathname === '/api/cross-catalog/recover' ? 'recover' : null;
    if (!route) throw new RuntimeError('Cross-catalog API route not found.', 404);
    if (request.method === 'GET' && route === 'status') {
      try { json(response, 200, service.view()); }
      catch (error) { json(response, statusFor(error), safeFailure(error)); }
      return true;
    }
    if (request.method === 'GET' && route === 'checkpoints') {
      try { json(response, 200, { checkpoints: await service.checkpoints() }); }
      catch (error) { json(response, statusFor(error), safeFailure(error)); }
      return true;
    }
    if (request.method !== 'POST' || route === 'checkpoints') throw new RuntimeError('Method not allowed.', 405);
    checkOrigin(request, base);
    const body = await readBody(request, 64 * 1024);
    const method = route === 'status' ? 'save' : route;
    try { json(response, 200, await service[method](body)); }
    catch (error) { json(response, statusFor(error), safeFailure(error)); }
    return true;
  };
}
