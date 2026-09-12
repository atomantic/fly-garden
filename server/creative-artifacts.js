/** Original procedural movement-derived artifacts. No learning or stimulation capability. */
import { deflateSync } from 'node:zlib';

export const CREATIVE_LIMITS = Object.freeze({ actions: 1024, flowers: 32, participants: 16, durationMs: 3600000, outputBytes: 2 * 1024 * 1024, canvas: 256 });
const invalid = () => { throw new Error('Invalid or incompatible movement-artifact source'); };
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const text = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min, max) => Number.isInteger(v) && number(v, min, max);
const color = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const exact = (v, names) => { if (!keys(v, names)) invalid(); };

export function validateCreativeSource(input) {
  exact(input, ['schemaVersion', 'kind', 'sessionId', 'worldId', 'modelVersion', 'checkpointId', 'participantIds', 'arrangement', 'actions', ...(Object.hasOwn(input ?? {}, 'capture') ? ['capture'] : [])]);
  if (input.capture !== undefined) {
    exact(input.capture, ['complete', 'reason']);
    if (typeof input.capture.complete !== 'boolean' || !(input.capture.reason === null || (typeof input.capture.reason === 'string' && input.capture.reason.length <= 256))
      || (input.capture.complete && input.capture.reason !== null)) invalid();
  }
  if (input.schemaVersion !== 1 || input.kind !== 'movement-derived-source' || ![input.sessionId, input.worldId, input.modelVersion].every(text)
    || !(input.checkpointId === null || text(input.checkpointId)) || !Array.isArray(input.participantIds)
    || input.participantIds.length < 1 || input.participantIds.length > CREATIVE_LIMITS.participants || !input.participantIds.every(text)
    || new Set(input.participantIds).size !== input.participantIds.length) invalid();
  const arrangement = input.arrangement;
  exact(arrangement, ['id', 'humanContributionId', 'mappingVersion', 'flowers', 'pollen']);
  if (![arrangement.id, arrangement.humanContributionId].every(text) || arrangement.mappingVersion !== 'flower-pollen-v1'
    || !Array.isArray(arrangement.flowers) || arrangement.flowers.length > CREATIVE_LIMITS.flowers) invalid();
  const ids = new Set();
  for (const f of arrangement.flowers) {
    exact(f, ['id', 'x', 'y', 'radius', 'midiNote', 'velocity', 'durationMs']);
    if (!text(f.id) || ids.has(f.id) || ![f.x, f.y].every(v => number(v, 0, 1)) || !number(f.radius, 0.01, 0.25)
      || !integer(f.midiNote, 0, 127) || !integer(f.velocity, 1, 100) || !integer(f.durationMs, 20, 2000)) invalid();
    ids.add(f.id);
  }
  exact(arrangement.pollen, ['enabled', 'color', 'radius']);
  if (typeof arrangement.pollen.enabled !== 'boolean' || !color(arrangement.pollen.color) || !integer(arrangement.pollen.radius, 1, 8)) invalid();
  if (!Array.isArray(input.actions) || input.actions.length > CREATIVE_LIMITS.actions) invalid();
  const actionIds = new Set(), previous = new Map();
  let worldTime = -1;
  for (const a of input.actions) {
    exact(a, ['id', 'individualId', 'sessionId', 'worldId', 'simulationTimeMs', 'worldTimeMs', 'wallTimeMs', 'kind', 'from', 'to', 'controllerVersion']);
    if (![a.id, a.controllerVersion].every(text) || actionIds.has(a.id) || !input.participantIds.includes(a.individualId)
      || !text(a.sessionId) || a.worldId !== input.worldId || !['move', 'rest'].includes(a.kind)
      || ![a.simulationTimeMs, a.worldTimeMs].every(v => integer(v, 0, CREATIVE_LIMITS.durationMs))
      || !Number.isSafeInteger(a.wallTimeMs) || a.wallTimeMs < 0 || a.worldTimeMs < worldTime) invalid();
    for (const point of [a.from, a.to]) { exact(point, ['x', 'y']); if (![point.x, point.y].every(v => number(v, 0, 1))) invalid(); }
    const last = previous.get(a.individualId);
    if (last && (a.sessionId !== last.sessionId || a.simulationTimeMs <= last.simulationTimeMs || a.from.x !== last.to.x || a.from.y !== last.to.y)) invalid();
    if (a.kind === 'rest' && (a.from.x !== a.to.x || a.from.y !== a.to.y)) invalid();
    actionIds.add(a.id); worldTime = a.worldTimeMs; previous.set(a.individualId, a);
  }
  return structuredClone(input);
}

export function deriveCreativeEvents(input) {
  const source = validateCreativeSource(input), events = [];
  const { arrangement } = source;
  const add = event => { if (events.length >= 8192) throw new Error('Artifact event limit exceeded'); events.push(event); };
  for (const action of source.actions) {
    if (action.kind !== 'move' || (action.from.x === action.to.x && action.from.y === action.to.y)) continue;
    const base = { sourceActionId: action.id, individualId: action.individualId, sessionId: action.sessionId,
      worldId: action.worldId, simulationTimeMs: action.simulationTimeMs, worldTimeMs: action.worldTimeMs,
      wallTimeMs: action.wallTimeMs, controllerVersion: action.controllerVersion, arrangementId: arrangement.id,
      humanContributionId: arrangement.humanContributionId, mappingVersion: arrangement.mappingVersion };
    // A note occurs only on an outside-to-inside endpoint transition, never on residence or rest.
    for (const flower of arrangement.flowers) {
      const inside = p => Math.hypot(p.x - flower.x, p.y - flower.y) <= flower.radius;
      if (!inside(action.from) && inside(action.to)) add({ ...base, id: `${action.id}:note:${flower.id}`, kind: 'note', flowerId: flower.id,
        midiNote: flower.midiNote, velocity: flower.velocity, durationMs: flower.durationMs });
    }
    if (arrangement.pollen.enabled) add({ ...base, id: `${action.id}:mark`, kind: 'mark', from: action.from, to: action.to,
      color: arrangement.pollen.color, radius: arrangement.pollen.radius });
  }
  return { schemaVersion: 1, kind: 'movement-derived-artifact', claim: 'Movement-derived; no learned-choice or biological creativity claim.', source, events };
}
const bounded = bytes => { if (bytes.length > CREATIVE_LIMITS.outputBytes) throw new Error('Artifact output byte limit exceeded'); return bytes; };
const pixel = n => Math.round(n * (CREATIVE_LIMITS.canvas - 1));
export function exportCreativeJSON(input) { return bounded(Buffer.from(JSON.stringify(deriveCreativeEvents(input)))); }
export function exportCreativeSVG(input) {
  const artifact = deriveCreativeEvents(input);
  const metadata = JSON.stringify({ ...artifact, events: undefined, source: { ...artifact.source, actions: undefined } })
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const paths = artifact.events.filter(e => e.kind === 'mark').map(e => `<path data-action="${e.sourceActionId}" data-individual="${e.individualId}" d="M${pixel(e.from.x)} ${pixel(e.from.y)} L${pixel(e.to.x)} ${pixel(e.to.y)}" stroke="${e.color}" stroke-width="${e.radius * 2}" stroke-linecap="round"/>`).join('');
  return bounded(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><metadata>${metadata}</metadata><rect width="256" height="256" fill="#f8f6ee"/><g fill="none">${paths}</g></svg>`));
}
function vlq(n) { const result = [n & 127]; while ((n = Math.floor(n / 128))) result.unshift((n & 127) | 128); return Buffer.from(result); }
function midiChunk(type, data) { const size = Buffer.alloc(4); size.writeUInt32BE(data.length); return Buffer.concat([Buffer.from(type), size, data]); }
export function exportCreativeMIDI(input) {
  const artifact = deriveCreativeEvents(input);
  const metadata = Buffer.from(JSON.stringify({ kind: artifact.kind, sessionId: artifact.source.sessionId, worldId: artifact.source.worldId,
    modelVersion: artifact.source.modelVersion, checkpointId: artifact.source.checkpointId, arrangement: artifact.source.arrangement, capture: artifact.source.capture ?? null }));
  const timeline = [];
  for (const e of artifact.events.filter(e => e.kind === 'note')) {
    const attribution = Buffer.from(JSON.stringify(e));
    timeline.push({ time: e.worldTimeMs, order: 1, bytes: Buffer.concat([Buffer.from([0xff, 0x01]), vlq(attribution.length), attribution]) });
    timeline.push({ time: e.worldTimeMs, order: 2, bytes: Buffer.from([0x90, e.midiNote, e.velocity]) });
    timeline.push({ time: e.worldTimeMs + e.durationMs, order: 0, bytes: Buffer.from([0x80, e.midiNote, 0]) });
  }
  timeline.sort((a, b) => a.time - b.time || a.order - b.order);
  // 500 ticks/quarter with 500000 microseconds/quarter gives one tick per millisecond.
  const parts = [Buffer.from([0, 0xff, 0x51, 3, 7, 0xa1, 0x20]), Buffer.from([0, 0xff, 1]), vlq(metadata.length), metadata];
  let previous = 0;
  for (const e of timeline) { parts.push(vlq(e.time - previous), e.bytes); previous = e.time; }
  parts.push(Buffer.from([0, 0xff, 0x2f, 0]));
  return bounded(Buffer.concat([midiChunk('MThd', Buffer.from([0, 0, 0, 1, 1, 0xf4])), midiChunk('MTrk', Buffer.concat(parts))]));
}
function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function pngChunk(type, data) { const tag = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, crc]); }
export function exportCreativePNG(input) {
  const artifact = deriveCreativeEvents(input), size = CREATIVE_LIMITS.canvas;
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < pixels.length; i += 3) { pixels[i] = 248; pixels[i + 1] = 246; pixels[i + 2] = 238; }
  for (const mark of artifact.events.filter(e => e.kind === 'mark')) {
    const x0 = pixel(mark.from.x), y0 = pixel(mark.from.y), x1 = pixel(mark.to.x), y1 = pixel(mark.to.y);
    const rgb = [1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16));
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(x0 + (x1 - x0) * step / steps), y = Math.round(y0 + (y1 - y0) * step / steps);
      for (let dy = -mark.radius; dy <= mark.radius; dy++) for (let dx = -mark.radius; dx <= mark.radius; dx++) {
        const px = x + dx, py = y + dy;
        if (dx * dx + dy * dy <= mark.radius * mark.radius && px >= 0 && px < size && py >= 0 && py < size) {
          const index = (py * size + px) * 3; pixels[index] = rgb[0]; pixels[index + 1] = rgb[1]; pixels[index + 2] = rgb[2];
        }
      }
    }
  }
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const metadata = Buffer.from(`FlyGarden\0${exportCreativeJSON(input).toString('utf8')}`, 'utf8');
  return bounded(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('tEXt', metadata), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]));
}
