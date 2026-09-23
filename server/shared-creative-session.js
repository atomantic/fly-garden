import { validSharedCount } from '../shared/population-limits.js';
import { randomUUID } from 'node:crypto';
import { SHARED_ARRANGEMENT } from '../shared/shared-garden-arrangement.js';
import { SHARED_ACTION_TRACE, validateActionBatch, validateTraceProvenance, sameTraceProvenance } from '../shared/shared-action-trace.js';
import { exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG, CREATIVE_LIMITS, SHARED_SOURCE_KIND } from './creative-artifacts.js';

/** The engineered shared fixture controller that turns committed fixture poses into declared actions. */
export const FIXTURE_ACTION_ADAPTER = 'shared-fixture-retina-motor-v1';
const exporters = { json: exportCreativeJSON, mid: exportCreativeMIDI, svg: exportCreativeSVG, png: exportCreativePNG };
const point = pose => ({ x: (pose.x + 2) / 4, y: (pose.z + 2) / 4 });
const failure = message => Object.assign(new Error(message), { statusCode: 409 });
// PNG embeds the JSON source beside a bounded RGB raster; this headroom keeps every format exportable.
// MIDI and SVG stay below the JSON size: JSON already holds every event, and MIDI adds only bytes per note.
const JSON_BUDGET = CREATIVE_LIMITS.outputBytes - 256 * 1024;
const ACTIVE_REASON = 'Capture is active; this export is a partial snapshot.';
const REASONS = Object.freeze({
  pause: 'Shared world paused (including a stale controller or lost rendering context); capture ended at its last complete batch.',
  rest: 'A participant rested; capture ended at its last complete batch. Rest is valid and carries no penalty.',
  withdraw: 'A participant withdrew; capture ended at its last complete batch and no action was reassigned.',
  separate: 'Shared world separated or unavailable; capture ended at its last complete batch.',
  membership: 'Shared membership or session changed; no trajectory was joined across the discontinuity.',
  checkpoint: 'A shared checkpoint changed participant lineage; capture ended before the new lineage.',
  restore: 'A restore replaced participant sessions; capture ended before the restored trajectory.',
  'epoch-change': 'World epoch changed; no trajectory was joined across the discontinuity.',
  'invalid-batch': 'A shared action batch was missing, duplicated, stale or discontinuous; the last complete prefix is preserved.',
  'provenance-mismatch': 'A shared action did not match its recipient identity, session or provenance; it was attributed to no participant.',
  bound: 'Capture action or byte bound reached; the last complete prefix is preserved.',
});
const TRANSITION_CAUSES = Object.freeze({ pause: 'pause', start: 'epoch-change', save: 'checkpoint', separate: 'separate', rest: 'rest',
  resume: 'membership', withdraw: 'withdraw', join: 'membership', restore: 'restore' });
class Boundary extends Error { constructor(kind) { super(REASONS[kind]); this.kind = kind; } }

/** Declared provenance for one resident synthetic fixture. Throws for any other source. */
export function fixtureTraceProvenance(state) {
  if (state?.source !== 'fixture') throw failure('Only fixture participants have a movement-derived action source; research participants need a declared adapter.');
  try {
    const { namespace, release, modelId } = state.dataset ?? {};
    return validateTraceProvenance({ individualId: state.individualId, sessionId: state.sessionId, sourceType: 'fixture',
      derivation: SHARED_ACTION_TRACE.derivations.fixture, adapterVersion: FIXTURE_ACTION_ADAPTER, dataset: { namespace, release, modelId },
      modelVersion: state.model?.id, checkpointLineage: { checkpointId: state.persistence?.checkpointId ?? null, branchOf: state.persistence?.branchOf ?? null } });
  } catch { throw failure('Fixture participant provenance is unavailable.'); }
}

/** Fixture adapter: one committed shared fixture barrier becomes a version 1 action-trace batch.
 * Only identity, provenance, clocks and the committed position cross; motor and retinal values do not.
 * `provenanceFor(individualId)` declares dataset/model/checkpoint provenance; the trace supplies the session. */
export function fixtureActionBatch(shared, traces, provenanceFor) {
  return { traceVersion: SHARED_ACTION_TRACE.version, sharedId: shared.sharedId, worldEpoch: shared.worldEpoch, tick: shared.tick,
    worldTimeMs: shared.worldTimeMs, wallTimeMs: shared.lastReceivedAtMs, actions: traces.map(t => ({
      ...provenanceFor(t.individualId), individualId: t.individualId, sessionId: t.sessionId, sharedId: shared.sharedId,
      worldEpoch: t.environmentEpoch, tick: t.frameId + 1, actionKind: t.motor.forward === 0 ? 'rest' : 'move',
      sourceActionId: `${t.environmentEpoch}:${t.frameId}:${t.individualId}`, simTimeMs: t.outputSimTimeMs, position: point(t.pose),
    })) };
}

/** Explicit bounded capture of complete already-committed action batches. No neural authority:
 * nothing here starts, advances, rewards, pauses or otherwise controls a participant.
 * `arrangement` is the human-authored layout; it defaults to the rendered shared garden. */
export function createSharedCreativeSessions({ arrangement = SHARED_ARRANGEMENT } = {}) {
  const records = new Map();
  const captureFor = r => ({ complete: !r.active && r.boundary?.cause === 'stop', reason: r.active ? ACTIVE_REASON : r.failure, boundary: r.boundary });
  function end(r, cause) {
    if (!r?.active) return;
    r.active = false; r.boundary = { cause, worldEpoch: r.epoch, tick: r.tick }; r.failure = cause === 'stop' ? null : REASONS[cause];
  }
  function status(id) {
    const r = records.get(id), source = r?.source;
    return { protocolVersion: 1, traceVersion: SHARED_ACTION_TRACE.version, sharedId: id, captureSequence: r?.sequence ?? 0,
      worldEpoch: r?.epoch ?? null, captureId: source?.sessionId ?? null, active: r?.active ?? false, partial: !!r?.failure,
      reason: r?.failure ?? null, boundary: structuredClone(r?.boundary ?? null), actionCount: source?.actions.length ?? 0,
      participantIds: source ? source.participants.map(p => p.individualId) : [],
      participants: source ? source.participants.map(p => ({ individualId: p.individualId, sourceType: p.sourceType, derivation: p.derivation,
        dataset: { ...p.dataset }, modelVersion: p.modelVersion, checkpointId: p.checkpointLineage.checkpointId })) : [],
      humanContributionId: source?.arrangement.humanContributionId ?? null,
      disclosure: 'Accepted shared actions only: movement-derived fixture actions or declared adapter-derived research actions, with a separately attributed human arrangement. Export JSON to retain this session-local source. No learning, intention or creativity claim and no reward feedback.' };
  }
  function synchronize(id, shared) {
    const r = records.get(id);
    if (!r?.active) return status(id);
    let cause = null;
    if (!shared || shared.sharedId !== id) cause = 'separate';
    else if (shared.status === 'resting' || shared.participants.some(p => p.mode === 'resting')) cause = 'rest';
    else if (shared.status !== 'running') cause = 'pause';
    else if (shared.worldEpoch !== r.epoch) cause = 'epoch-change';
    else if (shared.participants.length !== r.source.participants.length
      || shared.participants.some(p => r.sessions.get(p.individualId) !== p.sessionId)) cause = 'membership';
    if (cause) end(r, cause);
    return status(id);
  }
  /** `provenance` lists each current participant's declared action-trace provenance. */
  function command(id, body, shared, provenance = []) {
    synchronize(id, shared);
    const r = records.get(id), keys = ['protocolVersion', 'sharedId', 'worldEpoch', 'captureSequence', 'action'];
    if (!body || Object.keys(body).length !== keys.length || keys.some(k => !Object.hasOwn(body, k)) || body.protocolVersion !== 1
      || body.sharedId !== id || body.captureSequence !== (r?.sequence ?? 0) || !Number.isSafeInteger(body.captureSequence + 1)
      || !['start', 'stop', 'discard'].includes(body.action)
      || body.worldEpoch !== (body.action === 'start' ? shared?.worldEpoch : r?.epoch)) throw failure('Stale or invalid shared capture command.');
    if (body.action === 'start') {
      if (r?.source) throw failure('Export and explicitly discard the previous capture first.');
      if (!shared || shared.status !== 'running' || !validSharedCount(shared.participants.length) || !Array.isArray(provenance)
        || provenance.length !== shared.participants.length) throw failure('Start capture only for an already running shared population.');
      if (shared.participants.some(p => p.mode === 'resting')) throw failure('A participant is resting; capture starts only while every member is active. Rest remains valid.');
      const declared = new Map();
      for (const item of provenance) {
        let value;
        try { value = validateTraceProvenance(item); } catch { throw failure('Every participant needs complete declared action provenance.'); }
        if (declared.has(value.individualId) || [...declared.values()].some(p => p.sessionId === value.sessionId)) throw failure('Duplicate participant provenance.');
        declared.set(value.individualId, value);
      }
      const participants = shared.participants.map(p => {
        const value = declared.get(p.individualId);
        if (!value || value.sessionId !== p.sessionId) throw failure('Participant provenance does not match the running shared session.');
        if (!p.pose || !Number.isFinite(p.pose.x) || !Number.isFinite(p.pose.z)) throw failure('A participant has no declared position; no pose is invented.');
        return { ...value, startPosition: point(p.pose) };
      });
      if (!r && records.size >= 64) throw failure('Session capture identity limit reached. Existing artifacts are preserved.');
      const next = { sequence: body.captureSequence + 1, epoch: shared.worldEpoch, tick: shared.tick, active: true, failure: null, boundary: null,
        sessions: new Map(participants.map(p => [p.individualId, p.sessionId])), positions: new Map(participants.map(p => [p.individualId, p.startPosition])),
        source: { schemaVersion: 2, kind: SHARED_SOURCE_KIND, traceVersion: SHARED_ACTION_TRACE.version, sessionId: randomUUID(), worldId: id,
          worldEpoch: shared.worldEpoch, startTick: shared.tick, participants, arrangement: structuredClone(arrangement), actions: [] } };
      try { exportCreativeJSON({ ...next.source, capture: captureFor(next) }); } catch { throw failure('Shared capture source is invalid; nothing was started.'); }
      records.set(id, next);
    } else {
      if (!r?.source) throw failure('No shared action capture exists.');
      if (body.action === 'discard' && r.active) throw failure('Stop capture before discarding.');
      r.sequence++;
      end(r, 'stop');
      if (body.action === 'discard') { r.source = null; r.failure = null; r.boundary = null; }
    }
    return status(id);
  }
  /** Append one complete batch. `supply(declared)` builds the trace lazily, only while capture is active;
   * `declared` maps each individual to the provenance recorded at start (without its start position).
   * Any missing, stale, duplicated, cross-recipient or discontinuous action ends capture at the
   * last complete prefix; no action is ever attributed to another participant. */
  function capture(shared, supply) {
    const id = shared?.sharedId, r = records.get(id);
    if (!r?.active) return;
    synchronize(id, shared); if (!r.active) return;
    try {
      let batch;
      const declared = new Map(r.source.participants.map(({ startPosition, ...p }) => [p.individualId, structuredClone(p)]));
      try { batch = validateActionBatch(supply(declared)); } catch { throw new Boundary('invalid-batch'); }
      if (batch.sharedId !== id || batch.worldEpoch !== r.epoch || batch.tick !== r.tick + 1 || batch.tick !== shared.tick
        || batch.worldTimeMs !== shared.worldTimeMs || batch.wallTimeMs !== shared.lastReceivedAtMs || batch.actions.length !== r.source.participants.length) throw new Boundary('invalid-batch');
      const byId = new Map(batch.actions.map(a => [a.individualId, a]));
      // Delivery order is irrelevant: each action is matched by identity and provenance, then stored in membership order.
      const actions = r.source.participants.map(p => {
        const a = byId.get(p.individualId), live = shared.participants.find(item => item.individualId === p.individualId);
        if (!a) throw new Boundary('invalid-batch');
        if (!sameTraceProvenance(a, p) || !live?.pose || a.simTimeMs !== live.simTimeMs) throw new Boundary('provenance-mismatch');
        const to = point(live.pose);
        if (a.position.x !== to.x || a.position.y !== to.y) throw new Boundary('provenance-mismatch');
        return { sourceActionId: a.sourceActionId, individualId: a.individualId, sessionId: a.sessionId, worldId: id, worldEpoch: a.worldEpoch,
          tick: a.tick, sourceType: a.sourceType, derivation: a.derivation, adapterVersion: a.adapterVersion, dataset: a.dataset,
          modelVersion: a.modelVersion, checkpointLineage: a.checkpointLineage, simulationTimeMs: a.simTimeMs, worldTimeMs: batch.worldTimeMs,
          wallTimeMs: batch.wallTimeMs, kind: a.actionKind, from: r.positions.get(p.individualId), to };
      });
      if (r.source.actions.length + actions.length > CREATIVE_LIMITS.actions) throw new Boundary('bound');
      const source = { ...r.source, actions: [...r.source.actions, ...actions] };
      let bytes;
      try { bytes = exportCreativeJSON({ ...source, capture: captureFor(r) }).length; } catch { throw new Boundary('invalid-batch'); }
      if (bytes > JSON_BUDGET) throw new Boundary('bound');
      r.source = source; r.tick = batch.tick; r.positions = new Map(actions.map(a => [a.individualId, a.to]));
    } catch (error) { end(r, error instanceof Boundary ? error.kind : 'invalid-batch'); }
  }
  return { status, synchronize, command, capture,
    list: () => [...records].filter(([, r]) => r.source).map(([id]) => status(id)),
    /** A lifecycle transition (`action`) touching any member ends capture at a recorded boundary. */
    invalidateMembers(ids, action) {
      for (const r of records.values()) if (r.active && r.source.participants.some(p => ids.includes(p.individualId))) end(r, TRANSITION_CAUSES[action] ?? 'membership');
    },
    export(id, format) {
      const r = records.get(id); if (!r?.source || !exporters[format]) throw failure('Shared artifact or export format unavailable.');
      const capture = captureFor(r);
      return { bytes: exporters[format]({ ...r.source, capture }), partial: !capture.complete };
    },
  };
}
