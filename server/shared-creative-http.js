/** Artifact operations have their own sequence and cannot command neural lifecycles. */
export function createSharedCreativeHttp({ identities, captures, readBody, json }) {
  const shared = id => { try { return identities?.sharedSnapshot(id) ?? null; } catch { return null; } };
  return async (request, response, url) => {
    if (url.pathname === '/api/shared/artifacts' && request.method === 'GET' && !url.search) {
      for (const item of captures.list()) captures.synchronize(item.sharedId, shared(item.sharedId));
      json(response, 200, { captures: captures.list() }); return true;
    }
    const match = /^\/api\/shared\/([0-9a-f-]+)\/artifacts(?:\/export\/(json|mid|svg|png))?$/.exec(url.pathname);
    if (!match) return false;
    try {
      if (url.search) throw Object.assign(new Error('Artifact endpoints accept no query parameters.'), { statusCode: 400 });
      const [, id, format] = match;
      captures.synchronize(id, shared(id));
      if (request.method === 'GET') {
        if (!format) { json(response, 200, captures.status(id)); return true; }
        const { bytes, partial } = captures.export(id, format);
        response.writeHead(200, { 'Content-Type': { json: 'application/json', mid: 'audio/midi', svg: 'image/svg+xml', png: 'image/png' }[format],
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Artifact-Partial': String(partial),
          'Content-Disposition': `attachment; filename="shared-movement-${id}.${format}"` });
        response.end(bytes); return true;
      }
      if (request.method !== 'POST' || format) throw Object.assign(new Error('Use GET for export or POST for capture actions.'), { statusCode: 405 });
      const body = await readBody(request);
      // The world may pause, separate or advance while a request body arrives.
      const current = shared(id);
      const states = body.action === 'start' && current ? current.participants.map(p => identities.snapshot(p.individualId)) : [];
      json(response, 200, captures.command(id, body, current, states));
    } catch (error) { json(response, error.statusCode ?? 500, { error: error.statusCode ? error.message : 'Shared artifact operation failed; previous captured actions are preserved.' }); }
    return true;
  };
}
