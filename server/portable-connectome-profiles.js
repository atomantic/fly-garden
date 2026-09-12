/** Offline checkpoint validation only; never a capacity estimate or worker admission. */
import { readFileSync } from 'node:fs';
import { CONNECTOME_PROFILES } from './connectome-profiles.js';
const GRAPH_HASHES = Object.freeze({
  'male-cns:v1.0': 'fa50e6e9add2a426f950cddc02b29b1c3dc267b98e1da33bf79cc1e5e1b3ce6a',
  'banc:v888': 'b8e648ec2585061b91fb07ad22b33d41939e0b2c8b56e7f7dbf7d6f172025e99',
});
// Canonical graph hashes were verified on the complete pinned arrays by the paused
// measurements documented in CONNECTOME_MEMORY.md. No private path/evidence is copied.
export function portableConnectomeProfiles() {
  return Object.fromEntries(Object.entries(CONNECTOME_PROFILES).map(([dataset, profile]) => {
    const lock = JSON.parse(readFileSync(new URL(`../connectome/${profile.graphLock}`, import.meta.url)));
    return [dataset, { directory: '.', manifestSha256: lock.manifestSha256, graphSha256: GRAPH_HASHES[dataset],
      neuronCount: lock.manifest.neuronCount, edgeCount: lock.manifest.edgeCount }];
  }));
}
