import { validSharedCount } from '../shared/population-limits.js';
import { randomUUID } from 'node:crypto';
import { SHARED_ARRANGEMENT } from '../shared/shared-garden-arrangement.js';
import { deriveCreativeEvents, exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG, CREATIVE_LIMITS } from './creative-artifacts.js';
const exporters = { json: exportCreativeJSON, mid: exportCreativeMIDI, svg: exportCreativeSVG, png: exportCreativePNG };
const point = pose => ({ x: (pose.x + 2) / 4, y: (pose.z + 2) / 4 });
const failure = message => Object.assign(new Error(message), { statusCode: 409 });
/** Explicit bounded capture of complete already-committed batches. No neural authority. */
export function createSharedCreativeSessions() {
  const records = new Map();
  const stopPartial = (r, reason) => { if (r?.active) { r.active = false; r.failure = reason; } };
  function status(id) {
    const r = records.get(id);
    return { protocolVersion: 1, sharedId: id, captureSequence: r?.sequence ?? 0, worldEpoch: r?.epoch ?? null,
      captureId: r?.source?.sessionId ?? null, active: r?.active ?? false, partial: !!r?.failure, reason: r?.failure ?? null,
      actionCount: r?.source?.actions.length ?? 0, participantIds: [...(r?.source?.participantIds ?? [])],
      disclosure: 'Accepted shared fixture movement only. Export JSON to retain this session-local source. No learning claim or reward feedback.' };
  }
  function synchronize(id, shared) {
    const r = records.get(id);
    if (r?.active && (!shared || shared.sharedId !== id || shared.worldEpoch !== r.epoch || shared.status !== 'running'
      || shared.participants.length !== r.source.participantIds.length
      || shared.participants.some(p => r.sessions.get(p.individualId) !== p.sessionId))) {
      stopPartial(r, 'Shared source paused, separated or changed; no trajectory joined across the discontinuity.');
    }
    return status(id);
  }
  function command(id, body, shared, states = []) {
    synchronize(id, shared);
    const r = records.get(id), keys = ['protocolVersion', 'sharedId', 'worldEpoch', 'captureSequence', 'action'];
    if (!body || Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k)) || body.protocolVersion !== 1
      || body.sharedId !== id || body.captureSequence !== (r?.sequence ?? 0) || !Number.isSafeInteger(body.captureSequence + 1)
      || !['start', 'stop', 'discard'].includes(body.action)
      || body.worldEpoch !== (body.action === 'start' ? shared?.worldEpoch : r?.epoch)) throw failure('Stale or invalid shared capture command.');
    if (body.action === 'start') {
      if (r?.source) throw failure('Export and explicitly discard the previous capture first.');
      if (!shared || shared.status !== 'running' || !validSharedCount(shared.participants.length) || states.length !== shared.participants.length
        || states.some(s => s.source !== 'fixture' || !shared.participants.some(p => p.individualId === s.individualId && p.sessionId === s.sessionId))
        || new Set(states.map(s => s.individualId)).size !== shared.participants.length) throw failure('Start capture only for an already running shared fixture population.');
      if (!r && records.size >= 64) throw failure('Session capture identity limit reached. Existing artifacts are preserved.');
      const source = { schemaVersion: 1, kind: 'movement-derived-source', sessionId: randomUUID(), worldId: id,
        modelVersion: 'shared-synthetic-lif-v1', checkpointId: null, participantIds: shared.participants.map(p => p.individualId),
        participantProvenance: shared.participants.map(p => { const s = states.find(s => s.individualId === p.individualId); return {
          individualId: p.individualId, sessionId: p.sessionId, dataset: s.dataset, modelVersion: s.model.id, checkpointId: s.persistence.checkpointId,
        }; }), arrangement: structuredClone(SHARED_ARRANGEMENT), actions: [] };
      const validated = deriveCreativeEvents(source).source;
      records.set(id, { sequence: body.captureSequence + 1, source: validated, epoch: shared.worldEpoch, active: true, failure: null,
        tick: shared.tick, sessions: new Map(shared.participants.map(p => [p.individualId, p.sessionId])),
        poses: new Map(shared.participants.map(p => [p.individualId, point(p.pose)])) });
    } else {
      if (!r?.source) throw failure('No shared movement capture exists.');
      if (body.action === 'discard' && r.active) throw failure('Stop capture before discarding.');
      r.sequence++;
      r.active = false;
      if (body.action === 'discard') { r.source = null; r.failure = null; }
    }
    return status(id);
  }
  function capture(shared, traces) {
    const r = records.get(shared.sharedId); synchronize(shared.sharedId, shared); if (!r?.active) return;
    try {
      if (shared.tick !== r.tick + 1 || !Array.isArray(traces) || traces.length !== r.source.participantIds.length
        || new Set(traces.map(t => t.individualId)).size !== traces.length) throw failure('Incomplete shared action batch.');
      const actions = shared.participants.map(p => {
        const t = traces.find(t => t.individualId === p.individualId);
        if (!t || t.sessionId !== p.sessionId || t.environmentEpoch !== r.epoch || t.frameId !== r.tick
          || t.outputSimTimeMs !== p.simTimeMs || t.pose.x !== p.pose.x || t.pose.z !== p.pose.z) throw failure('Shared action provenance mismatch.');
        const from = r.poses.get(p.individualId), to = point(p.pose);
        return { id: `${r.epoch}:${r.tick}:${p.individualId}`, individualId: p.individualId, sessionId: p.sessionId, worldId: shared.sharedId,
          simulationTimeMs: p.simTimeMs, worldTimeMs: shared.worldTimeMs, wallTimeMs: shared.lastReceivedAtMs,
          kind: from.x === to.x && from.y === to.y ? 'rest' : 'move', from, to, controllerVersion: 'shared-fixture-retina-motor-v1' };
      });
      if (r.source.actions.length + actions.length > CREATIVE_LIMITS.actions) throw failure('Capture bound reached.');
      const next = { ...r.source, actions: [...r.source.actions, ...actions] }; deriveCreativeEvents(next);
      r.source = next; r.tick = shared.tick; r.poses = new Map(actions.map(a => [a.individualId, a.to]));
    } catch { stopPartial(r, 'A shared action batch was omitted or invalid; the last complete captured prefix is preserved.'); }
  }
  return { status, synchronize, command, capture,
    list: () => [...records].filter(([, r]) => r.source).map(([id]) => status(id)),
    invalidateMembers(ids) { for (const r of records.values()) if (r.active && r.source.participantIds.some(id => ids.includes(id))) stopPartial(r, 'Shared lifecycle changed; capture ended at its last complete batch.'); },
    export(id, format) {
      const r = records.get(id); if (!r?.source || !exporters[format]) throw failure('Shared artifact or export format unavailable.');
      const partial = r.active || !!r.failure, reason = r.failure ?? (r.active ? 'Capture is active; this export is a partial snapshot.' : null);
      return { bytes: exporters[format]({ ...r.source, capture: { complete: !partial, reason } }), partial };
    },
  };
}
