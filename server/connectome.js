import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { validateNeuronSampleIds } from './sparse-lif.js';

/** Explicitly load one local research worker. The returned promise also exposes
 * terminate()/terminated so admission can cancel a worker before its ready message. */
export function openConnectomeBackend(directory, { dataset = 'male-cns:v1.0', individualId = randomUUID(), checkpoint = null, onExit = () => {} } = {}) {
  if (typeof directory !== 'string' || !directory) throw new Error('A dataset directory is required');
  const worker = new Worker(new URL('./connectome-worker.js', import.meta.url), { workerData: { directory, dataset, individualId, checkpoint } });
  let sequence = 0, closed = false, sessionEpoch = null, finishExit;
  const terminated = new Promise(resolve => { finishExit = resolve; });
  const pending = new Map();
  const fail = () => {
    closed = true;
    for (const waiter of pending.values()) waiter.reject(new Error('Connectome worker stopped; reopen paused to recover'));
    pending.clear();
  };
  worker.on('error', fail);
  worker.once('exit', code => {
    fail(); finishExit(code);
    try { onExit(); } catch { /* An observer cannot prevent worker cleanup. */ }
  });
  worker.on('message', ({ id, value, error }) => {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (error) waiter.reject(new Error(error));
    else { if (value?.sessionEpoch) sessionEpoch = value.sessionEpoch; waiter.resolve(value); }
  });
  const close = async () => { closed = true; await worker.terminate(); await terminated; };
  const request = (action, value) => {
    if (closed) return Promise.reject(new Error('Connectome worker is closed'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, action, value, sessionEpoch }); }
      catch { pending.delete(id); reject(new Error('Backend request could not be serialized')); }
    });
  };
  const opening = new Promise((resolve, reject) => pending.set(0, { resolve, reject })).then(ready => ({ ready,
    snapshot: () => request('snapshot'), sample: neuronIds => {
      try { validateNeuronSampleIds(neuronIds, dataset); return request('sample', neuronIds); }
      catch (error) { return Promise.reject(error); }
    }, start: () => request('start'), pause: () => request('pause'),
    advance: steps => request('advance', steps), probe: indices => request('probe', indices), checkpoint: () => request('checkpoint'),
    restore: checkpoint => request('restore', checkpoint), prepareRestore: checkpoint => request('prepareRestore', checkpoint),
    commitRestore: token => request('commitRestore', token), close, terminated }));
  return Object.assign(opening, { terminate: close, terminated });
}
