/** One read/POST JSON helper for the observatory panels. It adds no retry, cache, polling or
 * fallback value: a failed response raises the server's own reason, or the caller's, and no
 * panel substitutes a placeholder for data it did not receive. */
export function apiJson(fallback) {
  return async function json(path, signal, body) {
    const response = await fetch(path, { signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.reason === 'string' ? value.reason : typeof value.error === 'string' ? value.error : fallback);
    return value;
  };
}
