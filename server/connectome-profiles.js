/** Dataset selection is a fixed allowlist, never a filename supplied by data. */
export const CONNECTOME_PROFILES = Object.freeze({
  'male-cns:v1.0': Object.freeze({ graphLock: 'graph.lock.json', modelId: 'malecns-traced-lif-v1' }),
  'banc:v888': Object.freeze({ graphLock: 'banc-v888.graph.lock.json', modelId: 'banc-proofread-lif-v1' }),
});

export function connectomeProfile(dataset) {
  if (typeof dataset !== 'string' || !Object.hasOwn(CONNECTOME_PROFILES, dataset)) throw new Error('Unsupported connectome dataset');
  return CONNECTOME_PROFILES[dataset];
}

export function neuronIdentity(dataset, rawId) {
  connectomeProfile(dataset);
  if (typeof rawId !== 'string' || !/^[1-9]\d*$/.test(rawId)) throw new Error('Invalid exact neuron ID');
  return `${dataset}/${rawId}`;
}
