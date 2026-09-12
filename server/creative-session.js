import { randomUUID } from 'node:crypto';
import { CREATIVE_LIMITS, deriveCreativeEvents, exportCreativeJSON, exportCreativeMIDI, exportCreativeSVG, exportCreativePNG } from './creative-artifacts.js';

// Original garden layout authored in Scene.jsx, normalized from [-4,4] garden units.
export const DEFAULT_ARRANGEMENT = Object.freeze({ id: 'original-garden-v1', humanContributionId: 'project-garden-arrangement-v1',
  mappingVersion: 'flower-pollen-v1', flowers: Array.from({ length: 13 }, (_, i) => {
    const angle = i * 2.4, radius = 2.4 + (i % 3) * 0.5;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    return { id: `flower-${i}`, x: (x + 4) / 8, y: (z + 4) / 8, radius: 0.07,
      midiNote: [60, 62, 64, 67, 69][i % 5], velocity: 64, durationMs: 250 };
  }).filter(f => !((f.x * 8 - 4) > 1 && (f.y * 8 - 4) < -0.6)),
  pollen: { enabled: true, color: '#b79b56', radius: 2 } });
const exporters = { json: exportCreativeJSON, mid: exportCreativeMIDI, svg: exportCreativeSVG, png: exportCreativePNG };
const point = pose => ({ x: (pose.x + 4) / 8, y: (pose.z + 4) / 8 });

/** Bounded, explicit action capture. Exported JSON is the durable replay source. */
export function createCreativeSessions() {
  const sessions = new Map();
  function status(id) {
    const s = sessions.get(id);
    return s ? { recordingId: s.source.sessionId, individualId: id, active: s.active, partial: !!s.failure,
      reason: s.failure, actionCount: s.source.actions.length, eventCount: deriveCreativeEvents(s.source).events.length,
      mapping: s.source.arrangement, disclosure: 'Movement-derived from accepted fixture motor actions. Export JSON to retain the replay source; capture is bounded and session-local.' } : null;
  }
  function start(state) {
    if (state.status !== 'running') throw new Error('Run the attached visual fixture before starting movement capture.');
    if (!state.environmentAdapter?.attached) throw new Error('Attach the engineered visual loop before capturing movement.');
    if (sessions.get(state.individualId)?.active) throw new Error('Movement capture is already active.');
    // Never replace an existing artifact implicitly; caller must explicitly discard it.
    if (sessions.has(state.individualId)) throw new Error('Export and discard the previous capture before starting another.');
    const s = { active: true, failure: null, epoch: state.environmentAdapter.environmentEpoch,
      runtimeSession: state.sessionId, lastPose: structuredClone(state.environmentAdapter.pose),
      source: { schemaVersion: 1, kind: 'movement-derived-source', sessionId: randomUUID(), worldId: 'home',
        modelVersion: state.model.id, checkpointId: state.persistence.checkpointId, participantIds: [state.individualId],
        arrangement: structuredClone(DEFAULT_ARRANGEMENT), actions: [] } };
    sessions.set(state.individualId, s);
    return status(state.individualId);
  }
  function capture(state) {
    const s = sessions.get(state.individualId);
    if (!s?.active) return;
    const environment = state.environmentAdapter;
    if (state.sessionId !== s.runtimeSession || !environment?.attached || environment.environmentEpoch !== s.epoch) {
      s.active = false; s.failure = 'Source session or environment changed; trajectory was not joined across the discontinuity.'; return;
    }
    const trace = environment.lastTrace;
    if (!trace) return;
    if (s.source.actions.length >= CREATIVE_LIMITS.actions || trace.outputSimTimeMs > CREATIVE_LIMITS.durationMs) {
      s.active = false; s.failure = 'Capture limit reached; export the partial trajectory. Simulation is unaffected.'; return;
    }
    const from = point(s.lastPose), to = point(environment.pose);
    const action = { id: `${environment.environmentEpoch}:${trace.frameId}`, individualId: state.individualId,
      sessionId: state.sessionId, worldId: 'home', simulationTimeMs: trace.outputSimTimeMs, worldTimeMs: trace.outputSimTimeMs,
      wallTimeMs: environment.lastReceivedAtMs, kind: from.x === to.x && from.y === to.y ? 'rest' : 'move', from, to,
      controllerVersion: 'fixture-retina-motor-v1' };
    if (s.source.actions.at(-1)?.id === action.id) return;
    try {
      if (trace.individualId !== state.individualId || trace.sessionId !== state.sessionId
        || trace.environmentEpoch !== environment.environmentEpoch) throw new Error('Source attribution mismatch.');
      deriveCreativeEvents({ ...s.source, actions: [...s.source.actions, action] });
    } catch {
      s.active = false; s.failure = 'Invalid movement source; last valid captured trajectory preserved.'; return;
    }
    s.source.actions.push(action);
    s.lastPose = structuredClone(environment.pose);
  }
  return { start, status, capture,
    synchronize(state) {
      const s = sessions.get(state.individualId);
      if (s?.active && (state.sessionId !== s.runtimeSession || !state.environmentAdapter?.attached
        || state.environmentAdapter.environmentEpoch !== s.epoch)) {
        s.active = false; s.failure = 'Source session or environment changed; trajectory was not joined across the discontinuity.';
      }
    },
    stop(id) { const s = sessions.get(id); if (!s) throw new Error('Movement capture not found.'); s.active = false; return status(id); },
    discard(id) { const s = sessions.get(id); if (s?.active) throw new Error('Stop movement capture before discarding.'); sessions.delete(id); },
    export(id, format) {
      const s = sessions.get(id); if (!s || !exporters[format]) throw new Error('Unknown movement capture or format.');
      const partial = s.active || !!s.failure;
      const reason = s.failure ?? (s.active ? 'Capture is still active; exported trajectory is a partial snapshot.' : null);
      return { bytes: exporters[format]({ ...s.source, capture: { complete: !partial, reason } }), partial, reason };
    },
  };
}
