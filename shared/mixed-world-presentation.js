import { SHARED_LIMITS, validSharedCount } from './population-limits.js';

/**
 * Render-only mixed shared-world presentation contract, version 1.
 *
 * It composes already committed, public shared-session snapshots from the synthetic fixture
 * registry and the full-connectome research barrier into one bounded, provenance-labeled list.
 * It owns no runtime, worker, command sequence, controller lease, timer or network authority.
 * Composition is display-only: the source sessions keep their own clocks and epochs, and nothing
 * here couples, synchronizes or exchanges sensory data between them.
 *
 * Fail-closed rules: the whole batch is withheld (never truncated or partially drawn) when the
 * membership count is outside 2–64, an individual appears twice, a session is duplicated, or any
 * identity, epoch, namespace, lifecycle or capability field is missing or inconsistent. Only
 * allowlisted fields are copied, so neural state, motor output, controller tokens, private paths,
 * hidden targets and free-form failure reasons cannot pass through.
 *
 * A full-connectome participant never has a body in version 1. Its `body` is always an explicit
 * `unavailable` marker, whatever the input carries; a later declared adapter must add a new body
 * kind under a new contract version instead of this shell inventing a pose or motor stream.
 */
export const MIXED_WORLD_KIND = 'fly-garden.mixed-world-presentation';
export const MIXED_WORLD_VERSION = 1;
export const FIXTURE_NAMESPACE = 'synthetic-fixture';
export const CONNECTOME_NAMESPACES = Object.freeze(['male-cns:v1.0', 'banc:v888']);
export const MIXED_WORLD_LIFECYCLES = Object.freeze(['paused', 'running', 'resting', 'fault', 'unavailable']);
export const MIXED_WORLD_COHORT_STATUSES = Object.freeze(['paused', 'running', 'resting']);
export const RESEARCH_BODY_UNAVAILABLE = 'No declared full-connectome body pose, sensory input or motor output. Research-only marker; nothing here is embodied.';
export const FIXTURE_POSE_UNAVAILABLE = 'Committed fixture pose missing or invalid; no body is drawn or animated in its place.';
export const MIXED_WORLD_DISCLOSURE = 'Render-only observation of independently committed shared sessions. Fixture bodies are original procedural illustrations at engineered fixture poses. Full-connectome participants are research-only markers without body, sensory or motor coupling. Sessions are shown together without cross-session synchronization, sensory exchange, learning or biological sex comparison. Position and display order do not identify anyone; use the stable individual ID.';

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const token = value => typeof value === 'string' && TOKEN.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const HEX64 = /^[a-f0-9]{64}$/;

class PresentationUnavailable extends Error {}
const refuse = reason => { throw new PresentationUnavailable(reason); };

/** Engineered fixture world bounds, identical to the fixture shared session's pose validator. */
export function validFixturePose(pose) {
  return exact(pose, ['x', 'z', 'yaw']) && [pose.x, pose.z, pose.yaw].every(Number.isFinite)
    && Math.abs(pose.x) <= 2 && Math.abs(pose.z) <= 2 && Math.abs(pose.yaw) <= Math.PI;
}

function withdrawals(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(item => item?.type === 'withdraw' && token(item.individualId) && count(item.tick))
    .slice(-SHARED_LIMITS.maxMembers).map(item => ({ individualId: item.individualId, tick: item.tick }));
}

function cohortFrom(session, source) {
  if (!plain(session) || !token(session.sharedId) || !token(session.worldEpoch) || !count(session.tick)
    || !MIXED_WORLD_COHORT_STATUSES.includes(session.status) || !Array.isArray(session.participants)) {
    refuse(`A ${source} shared session has missing or inconsistent membership, epoch or status.`);
  }
  if (!validSharedCount(session.participants.length)) refuse(`A ${source} shared session is outside the 2–64 member bound.`);
  const sessionVersion = source === 'fixture' ? session.version : session.protocolVersion;
  if (source === 'fixture' ? ![1, 2].includes(sessionVersion) : sessionVersion !== 1 || session.kind !== 'full-connectome-research-shared') {
    refuse(`A ${source} shared session reports an unsupported contract version.`);
  }
  const participants = session.participants.map(member => source === 'fixture'
    ? fixtureParticipant(member, session, sessionVersion) : connectomeParticipant(member, session));
  return { cohort: { cohortId: session.sharedId, source, sessionVersion, worldEpoch: session.worldEpoch, tick: session.tick,
    status: session.status, memberIds: participants.map(item => item.individualId), withdrawals: withdrawals(session.events) }, participants };
}

function commonParticipant(member, session, source) {
  if (!plain(member) || !token(member.individualId)) refuse(`A ${source} participant has no stable individual ID.`);
  const mode = member.mode ?? 'active';
  if (!['active', 'resting'].includes(mode)) refuse(`Participant ${member.individualId} reports an unknown quiet-state mode.`);
  if (!MIXED_WORLD_LIFECYCLES.includes(member.status)) refuse(`Participant ${member.individualId} reports an unknown lifecycle.`);
  return { individualId: member.individualId, source, cohortId: session.sharedId, worldEpoch: session.worldEpoch, lifecycle: member.status, mode };
}

function fixtureParticipant(member, session, version) {
  const base = commonParticipant(member, session, 'fixture');
  if (version === 1 && Object.hasOwn(member, 'mode')) refuse(`Version 1 fixture participant ${base.individualId} cannot carry a quiet-state mode.`);
  if (!token(member.sessionId)) refuse(`Fixture participant ${base.individualId} has no runtime session epoch.`);
  const dataset = member.dataset;
  if (!plain(dataset) || dataset.namespace !== FIXTURE_NAMESPACE || !token(dataset.modelId)) {
    refuse(`Fixture participant ${base.individualId} does not carry the synthetic fixture namespace.`);
  }
  const body = validFixturePose(member.pose)
    ? { kind: 'fixture-procedural', pose: { x: member.pose.x, z: member.pose.z, yaw: member.pose.yaw } }
    : { kind: 'unavailable', reason: FIXTURE_POSE_UNAVAILABLE };
  return { ...base, sessionEpoch: member.sessionId, namespace: FIXTURE_NAMESPACE, modelId: dataset.modelId, graphSha256: null,
    boundary: 'engineered-fixture', body };
}

function connectomeParticipant(member, session) {
  const base = commonParticipant(member, session, 'connectome');
  if (!token(member.sessionEpoch)) refuse(`Research participant ${base.individualId} has no worker session epoch.`);
  if (!CONNECTOME_NAMESPACES.includes(member.dataset)) refuse(`Research participant ${base.individualId} does not carry a pinned connectome namespace.`);
  const capabilities = member.capabilities;
  if (!plain(capabilities) || capabilities.sensoryMotor !== false || capabilities.embodiment !== false) {
    refuse(`Research participant ${base.individualId} declares or omits body/sensory/motor coupling; this render-only shell has no adapter authority.`);
  }
  const graphSha256 = member.graphSha256 ?? null, modelId = member.model?.id ?? null;
  if ((graphSha256 !== null && !HEX64.test(graphSha256)) || (modelId !== null && !token(modelId))) {
    refuse(`Research participant ${base.individualId} carries inconsistent graph or model provenance.`);
  }
  return { ...base, sessionEpoch: member.sessionEpoch, namespace: member.dataset, modelId, graphSha256,
    boundary: 'research-only', body: { kind: 'unavailable', reason: RESEARCH_BODY_UNAVAILABLE } };
}

function unavailable(generatedAtMs, sources, reason) {
  return { kind: MIXED_WORLD_KIND, version: MIXED_WORLD_VERSION, generatedAtMs, available: false, reason, sources,
    cohorts: [], participants: [], disclosure: MIXED_WORLD_DISCLOSURE };
}

/**
 * @param {object} input
 * @param {{available: boolean, sessions: object[]}} input.fixture committed fixture shared snapshots
 * @param {{available: boolean, sessions: object[]}} input.connectome full-connectome research view sessions
 * @param {number} input.generatedAtMs server receipt time, used only for observer staleness
 */
export function buildMixedWorldPresentation({ fixture, connectome, generatedAtMs }) {
  const sources = {
    fixture: { available: fixture?.available === true, cohortCount: 0 },
    connectome: { available: connectome?.available === true, cohortCount: 0 },
  };
  if (!count(generatedAtMs)) return unavailable(0, sources, 'Presentation clock unavailable.');
  try {
    const cohorts = [], participants = [];
    for (const [source, input] of [['fixture', fixture], ['connectome', connectome]]) {
      // A failed read or an unavailable service that still reports sessions would otherwise drop
      // those participants from an apparently complete world; withhold everything instead.
      if (input?.failed === true) refuse(`The ${source} shared state could not be read; nothing is drawn.`);
      if (!sources[source].available) {
        if (Array.isArray(input?.sessions) && input.sessions.length) refuse(`The ${source} service is unavailable while it still reports shared sessions; nothing is drawn.`);
        continue;
      }
      if (!Array.isArray(input.sessions) || input.sessions.length > SHARED_LIMITS.maxMembers) refuse(`The ${source} session list is unavailable or unbounded.`);
      // Sorted by stable session ID, so layout never depends on registry iteration or completion order.
      const built = input.sessions.map(session => cohortFrom(session, source)).sort((a, b) => a.cohort.cohortId.localeCompare(b.cohort.cohortId));
      for (const item of built) { cohorts.push(item.cohort); participants.push(...item.participants); }
      sources[source].cohortCount = built.length;
    }
    if (!participants.length) return unavailable(generatedAtMs, sources, 'No admitted shared participants to present. Join fixture or research participants through their own explicit controls.');
    const value = { kind: MIXED_WORLD_KIND, version: MIXED_WORLD_VERSION, generatedAtMs, available: true, reason: null, sources,
      cohorts, participants, disclosure: MIXED_WORLD_DISCLOSURE };
    return readMixedWorldPresentation(value);
  } catch (error) {
    if (error instanceof PresentationUnavailable) return unavailable(generatedAtMs, sources, error.message);
    return unavailable(generatedAtMs, sources, 'Shared presentation state is inconsistent; nothing is drawn.');
  }
}

const PARTICIPANT_KEYS = ['individualId', 'source', 'cohortId', 'worldEpoch', 'lifecycle', 'mode', 'sessionEpoch', 'namespace', 'modelId', 'graphSha256', 'boundary', 'body'];
const COHORT_KEYS = ['cohortId', 'source', 'sessionVersion', 'worldEpoch', 'tick', 'status', 'memberIds', 'withdrawals'];
const TOP_KEYS = ['kind', 'version', 'generatedAtMs', 'available', 'reason', 'sources', 'cohorts', 'participants', 'disclosure'];

function readBody(participant) {
  const body = participant.body;
  if (participant.source === 'connectome') {
    if (!exact(body, ['kind', 'reason']) || body.kind !== 'unavailable' || body.reason !== RESEARCH_BODY_UNAVAILABLE) refuse('A research participant carries a body.');
    return;
  }
  if (exact(body, ['kind', 'reason']) && body.kind === 'unavailable' && body.reason === FIXTURE_POSE_UNAVAILABLE) return;
  if (!exact(body, ['kind', 'pose']) || body.kind !== 'fixture-procedural' || !validFixturePose(body.pose)) refuse('A fixture body is malformed.');
}

/**
 * Strict reader for the browser (and the builder's own self-check). Returns the value unchanged
 * when every field matches version 1; throws otherwise so the caller withholds the whole batch.
 */
export function readMixedWorldPresentation(value) {
  if (!exact(value, TOP_KEYS) || value.kind !== MIXED_WORLD_KIND || value.version !== MIXED_WORLD_VERSION
    || !count(value.generatedAtMs) || typeof value.available !== 'boolean' || value.disclosure !== MIXED_WORLD_DISCLOSURE
    || !exact(value.sources, ['fixture', 'connectome']) || !Array.isArray(value.cohorts) || !Array.isArray(value.participants)) {
    throw new Error('Mixed world presentation is incompatible; nothing is drawn.');
  }
  for (const source of ['fixture', 'connectome']) {
    const item = value.sources[source];
    if (!exact(item, ['available', 'cohortCount']) || typeof item.available !== 'boolean' || !count(item.cohortCount)) throw new Error('Mixed world source summary is incompatible.');
  }
  if (!value.available) {
    if (typeof value.reason !== 'string' || !value.reason || value.cohorts.length || value.participants.length) throw new Error('An unavailable mixed world must withhold every participant.');
    return value;
  }
  if (value.reason !== null || !validSharedCount(value.participants.length)) refuse('Mixed membership is outside the 2–64 bound.');
  const ids = new Set(), cohorts = new Map();
  for (const cohort of value.cohorts) {
    if (!exact(cohort, COHORT_KEYS) || !token(cohort.cohortId) || !['fixture', 'connectome'].includes(cohort.source) || cohorts.has(cohort.cohortId)
      || !token(cohort.worldEpoch) || !count(cohort.tick) || !MIXED_WORLD_COHORT_STATUSES.includes(cohort.status)
      || !Array.isArray(cohort.memberIds) || !validSharedCount(cohort.memberIds.length) || !Array.isArray(cohort.withdrawals)
      || cohort.withdrawals.length > SHARED_LIMITS.maxMembers || cohort.withdrawals.some(item => !exact(item, ['individualId', 'tick']) || !token(item.individualId) || !count(item.tick))
      || (cohort.source === 'fixture' ? ![1, 2].includes(cohort.sessionVersion) : cohort.sessionVersion !== 1)) refuse('A presented session is malformed or duplicated.');
    cohorts.set(cohort.cohortId, { cohort, seen: [] });
  }
  for (const participant of value.participants) {
    if (!exact(participant, PARTICIPANT_KEYS) || !token(participant.individualId) || ids.has(participant.individualId)) refuse('A participant is malformed or appears twice.');
    ids.add(participant.individualId);
    const owner = cohorts.get(participant.cohortId);
    if (!owner || owner.cohort.source !== participant.source || owner.cohort.worldEpoch !== participant.worldEpoch) refuse(`Participant ${participant.individualId} does not match its session epoch.`);
    owner.seen.push(participant.individualId);
    const research = participant.source === 'connectome';
    if (!token(participant.sessionEpoch) || !MIXED_WORLD_LIFECYCLES.includes(participant.lifecycle) || !['active', 'resting'].includes(participant.mode)
      || participant.boundary !== (research ? 'research-only' : 'engineered-fixture')
      || (research ? !CONNECTOME_NAMESPACES.includes(participant.namespace) : participant.namespace !== FIXTURE_NAMESPACE)
      || (research ? participant.modelId !== null && !token(participant.modelId) : !token(participant.modelId))
      || (research ? participant.graphSha256 !== null && !HEX64.test(participant.graphSha256) : participant.graphSha256 !== null)) {
      refuse(`Participant ${participant.individualId} has inconsistent provenance.`);
    }
    readBody(participant);
  }
  for (const { cohort, seen } of cohorts.values()) {
    if (seen.length !== cohort.memberIds.length || seen.some((id, index) => id !== cohort.memberIds[index])) refuse('Presented membership does not match its session.');
  }
  if (value.sources.fixture.cohortCount + value.sources.connectome.cohortCount !== cohorts.size
    || [...cohorts.values()].filter(item => item.cohort.source === 'fixture').length !== value.sources.fixture.cohortCount) refuse('Presented session summary is inconsistent.');
  return value;
}

/** Ordered identity of what is drawn. A change rebuilds the whole scene instead of patching it. */
export function mixedMembershipKey(presentation) {
  if (!presentation?.available) return null;
  return JSON.stringify(presentation.participants.map(item => [item.cohortId, item.individualId, item.sessionEpoch, item.body.kind]));
}
