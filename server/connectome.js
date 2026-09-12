import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';

/** Explicitly load one local research worker. Importing this module does no work. */
export async function openConnectomeBackend(directory, { dataset = 'male-cns:v1.0', individualId = randomUUID(), checkpoint = null } = {}) {
  if (typeof directory !== 'string' || !directory) throw new Error('A dataset directory is required');
  const worker = new Worker(new URL('./connectome-worker.js', import.meta.url), { workerData: { directory, dataset, individualId, checkpoint } });
  let sequence = 0, closed = false, sessionEpoch = null;
  const pending = new Map();
  const fail = () => {
    closed = true;
    for (const waiter of pending.values()) waiter.reject(new Error('Connectome worker stopped; reopen paused to recover'));
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', fail);
  worker.on('message', ({ id, value, error }) => {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (error) waiter.reject(new Error(error));
    else { if (value?.sessionEpoch) sessionEpoch = value.sessionEpoch; waiter.resolve(value); }
  });
  const ready = await new Promise((resolve, reject) => pending.set(0, { resolve, reject }));
  const request = (action, value) => {
    if (closed) return Promise.reject(new Error('Connectome worker is closed'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, action, value, sessionEpoch });
      } catch {
        pending.delete(id);
        reject(new Error('Backend request could not be serialized'));
      }
    });
  };
  return { ready, snapshot: () => request('snapshot'), start: () => request('start'),
    pause: () => request('pause'), advance: steps => request('advance', steps),
    probe: indices => request('probe', indices), checkpoint: () => request('checkpoint'),
    restore: checkpoint => request('restore', checkpoint), close: () => worker.terminate() };
}
