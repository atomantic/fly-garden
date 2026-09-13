/** Original human-authored layout; shared by rendering and post-action artifact mapping. */
export const SHARED_FLOWERS = Object.freeze(Array.from({ length: 8 }, (_, i) => Object.freeze({
  id: `shared-flower-${i}`, x: Math.sin(i * Math.PI / 4) * 1.4, z: Math.cos(i * Math.PI / 4) * 1.4,
  midiNote: [60, 62, 64, 67, 69][i % 5],
})));
export const SHARED_ARRANGEMENT = Object.freeze({ id: 'shared-garden-v1', humanContributionId: 'project-shared-garden-arrangement-v1',
  mappingVersion: 'flower-pollen-v1', flowers: SHARED_FLOWERS.map(f => ({ id: f.id, x: (f.x + 2) / 4, y: (f.z + 2) / 4,
    radius: 0.08, midiNote: f.midiNote, velocity: 64, durationMs: 250 })),
  pollen: { enabled: true, color: '#b79b56', radius: 2 },
});
