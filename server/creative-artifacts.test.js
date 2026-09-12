import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { validateCreativeSource, deriveCreativeEvents, exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG } from './creative-artifacts.js';
const point = (x, y) => ({ x, y });
const move = (id, from, to, time, individualId = 'fly') => ({ id, individualId, sessionId: `${individualId}-session`, worldId: 'home', simulationTimeMs: time, worldTimeMs: time, wallTimeMs: 1000 + time, kind: 'move', from, to, controllerVersion: 'engineered-v1' });
const source = () => ({ schemaVersion: 1, kind: 'movement-derived-source', sessionId: 'recording-1', worldId: 'home', modelVersion: 'fixture-v1', checkpointId: null,
  participantIds: ['fly', 'partner'], arrangement: { id: 'arrangement-1', humanContributionId: 'human-layout-1', mappingVersion: 'flower-pollen-v1',
    flowers: [{ id: 'flower', x: 0.5, y: 0.5, radius: 0.1, midiNote: 60, velocity: 70, durationMs: 100 }], pollen: { enabled: true, color: '#ab3478', radius: 2 } },
  actions: [move('action-1', point(0, 0), point(0.5, 0.5), 100), move('action-2', point(0.5, 0.5), point(0.52, 0.5), 200)] });
test('notes require entry, marks require movement and every event retains provenance', () => {
  const result = deriveCreativeEvents(source());
  assert.equal(result.events.filter(e => e.kind === 'note').length, 1);
  assert.equal(result.events.filter(e => e.kind === 'mark').length, 2);
  for (const e of result.events) { assert.equal(e.individualId, 'fly'); assert.equal(e.humanContributionId, 'human-layout-1'); assert.equal(e.sessionId, 'fly-session'); assert.ok(result.source.actions.some(a => a.id === e.sourceActionId)); }
  assert.equal(result.events.some(e => e.individualId === 'partner'), false);
});
test('empty activity and rest are valid silent outcomes', () => {
  const s = source(); s.actions = []; assert.deepEqual(deriveCreativeEvents(s).events, []);
  s.actions = [{ ...move('rest', point(0.5, 0.5), point(0.5, 0.5), 100), kind: 'rest' }]; assert.deepEqual(deriveCreativeEvents(s).events, []);
});
test('exports replay identically without mutating source and include original procedural formats', () => {
  const s = source(), before = structuredClone(s), replay = JSON.parse(exportCreativeJSON(s)).source;
  for (const render of [exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG]) assert.deepEqual(render(s), render(replay));
  assert.deepEqual(s, before);
  assert.equal(exportCreativeMIDI(s).subarray(0, 4).toString(), 'MThd');
  assert.match(exportCreativeSVG(s).toString(), /data-action="action-1"/);
  const png = exportCreativePNG(s); assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8, compressed;
  while (offset < png.length) { const size = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8); if (type === 'IDAT') compressed = png.subarray(offset + 8, offset + 8 + size); offset += size + 12; }
  const pixels = inflateSync(compressed); assert.equal(pixels.length, 256 * 769); assert.ok(pixels.includes(0xab)); assert.ok(png.includes(Buffer.from('human-layout-1')));
});
test('independent individuals can contribute with distinct source sessions', () => {
  const s = source(); s.actions.splice(1, 0, move('partner-1', point(0, 0), point(0.5, 0.5), 100, 'partner'));
  const notes = deriveCreativeEvents(s).events.filter(e => e.kind === 'note'); assert.deepEqual(notes.map(e => e.individualId), ['fly', 'partner']); assert.equal(notes[1].sessionId, 'partner-session');
});
test('rejects unbounded, injected, discontinuous, stale and incompatible sources', () => {
  const changes = [s => { s.schemaVersion = 2; }, s => { s.actions[0].to.x = Infinity; }, s => { s.actions[1].from.x = 0; },
    s => { s.actions[1].simulationTimeMs = 100; }, s => { s.actions[1].sessionId = 'other'; }, s => { s.actions[0].credential = 'secret'; },
    s => { s.arrangement.pollen.color = 'url(evil)'; }, s => { s.arrangement.flowers[0].velocity = 127; }, s => { s.actions = Array(1025).fill(s.actions[0]); }];
  for (const change of changes) { const s = source(); change(s); assert.throws(() => validateCreativeSource(s), /Invalid/); }
});
test('dense valid source reports event cap instead of silently truncating', () => {
  const s = source(); s.arrangement.flowers = Array.from({ length: 32 }, (_, index) => ({ ...s.arrangement.flowers[0], id: `flower-${index}` }));
  s.actions = Array.from({ length: 1024 }, (_, index) => move(`action-${index}`, index % 2 ? point(0.5, 0.5) : point(0, 0), index % 2 ? point(0, 0) : point(0.5, 0.5), index + 1));
  assert.throws(() => deriveCreativeEvents(s), /event limit/);
});
