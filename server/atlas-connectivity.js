/** Read-only connectivity views over a fully verified graph. No neural state or stepping capability. */
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { loadConnectome } from './connectome-data.js';
import { connectomeProfile } from './connectome-profiles.js';
import { validateGraph, LIF_MODEL } from './sparse-lif.js';

export const ATLAS_CONNECTIVITY_LIMITS = Object.freeze({ sampledEdges: 20000, adjacencyPage: 1000, scanBatchEdges: 65536 });
const fail = message => { throw new Error(message); };
const digest = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
function aborted(signal) { if (signal?.aborted) throw signal.reason ?? new DOMException('Atlas query canceled', 'AbortError'); }

/** The data source is validated once, never cropped or changed to satisfy display limits. */
export function createAtlasConnectivity({ graph, manifest, manifestSha256 }, atlas) {
  validateGraph(graph);
  const dataset = manifest?.dataset, profile = connectomeProfile(dataset);
  if (!digest(manifestSha256) || !digest(manifest.sourceLockSha256) || !digest(atlas?.manifestSha256) || !atlas?.manifest || atlas.manifest.dataset !== dataset || atlas.manifest.graphManifestSha256 !== manifestSha256
    || manifest.neuronCount !== graph.ids.length || manifest.edgeCount !== graph.targets.length
    || !Number.isSafeInteger(manifest.contactCount) || manifest.contactCount < 0
    || atlas.nodes.length !== graph.ids.length || atlas.valid.length !== graph.ids.length
    || graph.ids.some((id,i) => id !== atlas.nodes[i][0] || ![0,1].includes(atlas.valid[i]))) fail('Atlas and connectivity provenance/identity mismatch');
  const totalContacts = graph.contacts.reduce((sum,n) => sum+n, 0);
  if (totalContacts !== manifest.contactCount) fail('Connectivity anatomical contact total mismatch');
  // Retain the small validity mask, not the atlas metadata rows, positions or asset buffers.
  const positionedMask = Uint8Array.from(atlas.valid);
  const { ids, offsets, targets, contacts, signs } = graph;
  const lookup = new Map(ids.map((id,index) => [id,index]));
  let scanning = false;
  const provenance = { dataset, graphManifestSha256: manifestSha256, atlasManifestSha256: atlas.manifestSha256,
    modelId: profile.modelId, mode: 'anatomy-only',
    retainedNeurons: ids.length, retainedEdges: targets.length, anatomicalContacts: totalContacts,
    sourceLockSha256: manifest.sourceLockSha256,
    disclosure: 'Directed anatomical contact counts with an engineered transmitter sign and contact gain. Straight lines are not reconstructed neurites. Display sampling does not crop or alter the simulation graph.',
    signLegend: { '-1': 'engineered inhibitory', '0': 'unmapped/silent in this model', '1': 'engineered excitatory' },
    engineeredContactGain: LIF_MODEL.contactGain };
  function edgeSource(edgeIndex) {
    let low = 0, high = ids.length;
    while (low < high) { const mid = Math.floor((low+high)/2); if (offsets[mid+1] <= edgeIndex) low = mid+1; else high = mid; }
    return low;
  }
  function row(edgeIndex, source = edgeSource(edgeIndex)) {
    const target = targets[edgeIndex];
    return { edgeIndex, sourceIndex: source, targetIndex: target, sourceId: ids[source], targetId: ids[target],
      anatomicalContacts: contacts[edgeIndex], engineeredSign: signs[source], engineeredWeight: contacts[edgeIndex] * signs[source] * LIF_MODEL.contactGain,
      positioned: positionedMask[source] === 1 && positionedMask[target] === 1 };
  }
  return {
    status: () => ({ ...provenance, limits: { ...ATLAS_CONNECTIVITY_LIMITS }, scanning }),
    sample({ density = 0.001, maxEdges = ATLAS_CONNECTIVITY_LIMITS.sampledEdges } = {}) {
      if (!Number.isFinite(density) || density < 0 || density > 1 || !integer(maxEdges, 0, ATLAS_CONNECTIVITY_LIMITS.sampledEdges)) fail('Invalid atlas edge density/limit');
      const requestedEdges = Math.floor(targets.length*density), consideredEdges = Math.min(requestedEdges,maxEdges), edges = [];
      let omittedMissingPositions = 0;
      for (let index = 0; index < consideredEdges; index++) {
        const edge = row(Math.floor(index*targets.length/consideredEdges));
        if (edge.positioned) edges.push(edge); else omittedMissingPositions++;
      }
      return { ...provenance, sampling: { strategy: 'evenly-spaced-csr-v1', density, maxEdges, requestedEdges, consideredEdges,
        displayedEdges: edges.length, omittedMissingPositions, capped: requestedEdges > maxEdges }, edges };
    },
    async adjacency(id, { direction = 'both', offset = 0, limit = 100, signal } = {}) {
      if (!lookup.has(id)) fail('Neuron is absent from this exact atlas profile');
      if (!['both','incoming','outgoing'].includes(direction) || !integer(offset,0,targets.length) || !integer(limit,1,ATLAS_CONNECTIVITY_LIMITS.adjacencyPage)) fail('Invalid atlas adjacency page');
      aborted(signal);
      if (scanning) fail('Atlas adjacency scan already in progress; cancel it before requesting another');
      scanning = true;
      try {
        const selected = lookup.get(id), edges = [];
        let source = 0, totalIncoming = 0, totalOutgoing = 0, incomingContacts = 0, outgoingContacts = 0, totalMatching = 0;
        for (let edgeIndex = 0; edgeIndex < targets.length; edgeIndex++) {
          if (edgeIndex % ATLAS_CONNECTIVITY_LIMITS.scanBatchEdges === 0) { aborted(signal); await yieldToLoop(); aborted(signal); }
          while (offsets[source+1] <= edgeIndex) source++;
          const incoming = targets[edgeIndex] === selected, outgoing = source === selected;
          if (incoming) { totalIncoming++; incomingContacts += contacts[edgeIndex]; }
          if (outgoing) { totalOutgoing++; outgoingContacts += contacts[edgeIndex]; }
          if ((direction === 'both' && (incoming || outgoing)) || (direction === 'incoming' && incoming) || (direction === 'outgoing' && outgoing)) {
            if (totalMatching >= offset && edges.length < limit) edges.push({ ...row(edgeIndex,source), direction: incoming && outgoing ? 'self' : incoming ? 'incoming' : 'outgoing' });
            totalMatching++;
          }
        }
        aborted(signal);
        return { ...provenance, selectedId: id, selectedIndex: selected, selectedPositioned: positionedMask[selected] === 1,
          totalIncoming, totalOutgoing, incomingContacts, outgoingContacts, direction, offset, limit, totalMatching,
          returnedEdges: edges.length, nextOffset: offset+edges.length < totalMatching ? offset+edges.length : null,
          omittedPageEdges: Math.max(0,totalMatching-edges.length), sampling: null, edges };
      } finally { scanning = false; }
    },
  };
}

/** Absent/corrupt files reject explicitly. The caller may expose unavailable; no sample is invented. */
export async function loadAtlasConnectivity(directory, dataset, atlas) {
  const loaded = await loadConnectome(directory,dataset);
  return createAtlasConnectivity(loaded,atlas);
}
