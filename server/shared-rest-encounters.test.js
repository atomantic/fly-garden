import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openIdentityStore, validateIdentityDocument } from './identity-store.js';
import { createFixtureSharedSession } from './fixture-shared-session.js';
import { createRuntime } from './runtime.js';

// A deliberately tiny declared test flower just ahead of the shared origin pose: every member
// starts outside it, so only an actual neurally driven crossing can offer a bounded pulse.
const nearFlower = [{ id: 'test-contact', x: 0, z: 0.0001, radius: 0.00005, effectId: 'floral' }];

function directory(t) { const path = mkdtempSync(join(tmpdir(), 'fly-shared-rest-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function setup(t, { count = 2, ...options } = {}) {
  const path = directory(t), store = openIdentityStore(path, options); t.after(() => store.close());
  const ids = [store.primaryId];
  for (let i = 1; i < count; i++) { const id = store.create().individualId; store.load(id); ids.push(id); }
  return { store, ids, path };
}
function batch(state, token, rgbFor = () => Array(96).fill(255)) {
  const frames = state.participants.map((participant, index) => ({
    version: state.version, individualId: participant.individualId, sessionId: participant.sessionId,
    environmentEpoch: state.worldEpoch, frameId: state.tick, simTimeMs: participant.simTimeMs,
    capturedAtMs: Date.now(), camera: 'controller', width: 8, height: 4,
    rgb: participant.mode === 'resting' ? null : rgbFor(participant, index),
    ...(state.version === 2 ? { mode: participant.mode } : {}) }));
  return { controllerToken: token, worldEpoch: state.worldEpoch, worldTick: state.tick, frames };
}
function run(store, sharedId, token, count, rgbFor) {
  for (let i = 0; i < count; i++) store.sharedFrame(sharedId, batch(store.sharedSnapshot(sharedId), token, rgbFor));
  return store.sharedSnapshot(sharedId);
}

test('a resting member freezes only its own neural clock and pose while the shared barrier continues', t => {
  const { store, ids } = setup(t, { count: 3 });
  const joined = store.sharedJoin(ids, 2), token = joined.controllerToken;
  assert.equal(joined.version, 2);
  assert.deepEqual(joined.participants.map(member => member.mode), ['active', 'active', 'active']);
  store.sharedControl(joined.sharedId, 'start');
  run(store, joined.sharedId, token, 40);
  // An individual Rest no longer separates the population: the others keep running.
  store.control(ids[0], 'rest');
  const resting = store.sharedSnapshot(joined.sharedId);
  assert.equal(resting.status, 'running');
  assert.equal(resting.participants[0].mode, 'resting');
  assert.equal(store.snapshot(ids[0]).status, 'resting');
  assert.equal(store.snapshot(ids[0]).sharedSession.sharedId, joined.sharedId);
  assert.deepEqual(ids.slice(1).map(id => store.snapshot(id).status), ['running', 'running']);
  const frozen = store.snapshot(ids[0]), pose = resting.participants[0].pose;
  const others = ids.slice(1).map(id => store.snapshot(id).simTimeMs);
  const after = run(store, joined.sharedId, token, 60);
  // The resting member occupies its frame slot but advances no neural time and does not move.
  assert.equal(store.snapshot(ids[0]).simTimeMs, frozen.simTimeMs);
  assert.deepEqual(store.snapshot(ids[0]).neural, frozen.neural);
  assert.deepEqual(after.participants[0].pose, pose);
  assert.deepEqual(after.participants[0].motor, { forward: 0, yaw: 0 });
  assert.equal(after.tick, resting.tick + 60);
  for (const [index, id] of ids.slice(1).entries()) assert.equal(store.snapshot(id).simTimeMs, others[index] + 300);
  assert.equal(after.events.some(event => event.type === 'rest' && event.individualId === ids[0]), true);
  // Resume restores this member alone; the world clock never rewound.
  store.sharedMemberControl(joined.sharedId, ids[0], 'resume');
  assert.equal(store.snapshot(ids[0]).status, 'running');
  const resumed = run(store, joined.sharedId, token, 10);
  assert.equal(store.snapshot(ids[0]).simTimeMs, frozen.simTimeMs + 50);
  assert.equal(resumed.participants[0].mode, 'active');
});

test('an all-resting population freezes the world instead of silently running it', t => {
  const { store, ids } = setup(t);
  const joined = store.sharedJoin(ids, 2), token = joined.controllerToken;
  const running = store.sharedControl(joined.sharedId, 'start');
  const stale = batch(running, token);
  for (const id of ids) store.control(id, 'rest');
  const state = store.sharedSnapshot(joined.sharedId);
  assert.equal(state.status, 'resting');
  assert.equal(state.lastReceivedAtMs, null);
  assert.deepEqual(ids.map(id => store.snapshot(id).status), ['resting', 'resting']);
  // Neither a stale nor a freshly shaped batch can advance a fully resting world.
  assert.throws(() => store.sharedFrame(joined.sharedId, stale), /epoch, clock or membership/);
  assert.throws(() => store.sharedFrame(joined.sharedId, batch(state, token)), /epoch, clock or membership/);
  assert.throws(() => store.sharedControl(joined.sharedId, 'start'), /Every member is resting/);
  assert.equal(store.sharedSnapshot(joined.sharedId).tick, state.tick);
  // Rest carries no penalty: one explicit resume returns the population to a paused world.
  store.sharedMemberControl(joined.sharedId, ids[1], 'resume');
  assert.equal(store.sharedSnapshot(joined.sharedId).status, 'paused');
  store.sharedControl(joined.sharedId, 'start');
  assert.equal(run(store, joined.sharedId, token, 3).tick, state.tick + 3);
});

test('version 1 sessions keep the original separate-on-rest contract and refuse version 2 frames', t => {
  const { store, ids } = setup(t);
  const joined = store.sharedJoin(ids);
  assert.equal(joined.version, 1);
  assert.equal(Object.hasOwn(joined.participants[0], 'mode'), false);
  assert.throws(() => store.sharedMemberControl(joined.sharedId, ids[0], 'rest'), /version 2/);
  const running = store.sharedControl(joined.sharedId, 'start');
  const v2 = batch({ ...running, version: 2, participants: running.participants.map(p => ({ ...p, mode: 'active' })) }, joined.controllerToken);
  assert.throws(() => store.sharedFrame(joined.sharedId, v2), /Invalid, duplicate or stale/);
  store.control(ids[0], 'rest');
  assert.equal(store.snapshot(ids[0]).sharedSession, null);
  assert.equal(store.snapshot(ids[1]).sharedSession, null);
  assert.throws(() => store.sharedJoin(ids, 3), /Unsupported shared session version/);
});

test('partial withdrawal rebuilds membership at the committed boundary without re-joining the survivors', t => {
  const { store, ids } = setup(t, { count: 3 });
  const joined = store.sharedJoin(ids, 2), token = joined.controllerToken;
  store.sharedControl(joined.sharedId, 'start');
  run(store, joined.sharedId, token, 20);
  const before = store.sharedSnapshot(joined.sharedId), survivors = ids.slice(0, 2);
  const clocks = survivors.map(id => store.snapshot(id).simTimeMs);
  const state = store.sharedMemberControl(joined.sharedId, ids[2], 'withdraw');
  // Same session, same ID, same world clock, same member sessions; only membership changed.
  assert.equal(state.sharedId, joined.sharedId);
  assert.equal(state.worldEpoch, before.worldEpoch);
  assert.equal(state.tick, before.tick);
  assert.deepEqual(state.participants.map(member => member.individualId), survivors);
  assert.deepEqual(state.participants.map(member => member.sessionId), before.participants.slice(0, 2).map(member => member.sessionId));
  assert.equal(state.events.some(event => event.type === 'withdraw' && event.individualId === ids[2] && event.tick === before.tick), true);
  // The withdrawn body is quiet, independent, and keeps its committed pose and neural state.
  assert.equal(store.snapshot(ids[2]).sharedSession, null);
  assert.equal(store.snapshot(ids[2]).status, 'paused');
  assert.deepEqual(store.snapshot(ids[2]).environmentAdapter.pose, before.participants[2].pose);
  assert.equal(store.snapshot(ids[2]).simTimeMs, before.participants[2].simTimeMs);
  // A stale three-member batch is refused; the two-member barrier continues on the same lease.
  assert.throws(() => store.sharedFrame(joined.sharedId, batch(before, token)), /epoch, clock or membership/);
  const after = run(store, joined.sharedId, token, 15);
  assert.equal(after.tick, before.tick + 15);
  for (const [index, id] of survivors.entries()) assert.equal(store.snapshot(id).simTimeMs, clocks[index] + 75);
  assert.equal(store.snapshot(ids[2]).simTimeMs, before.participants[2].simTimeMs);
  // Two members is the floor: withdrawal is refused and the whole session must be separated.
  assert.throws(() => store.sharedMemberControl(joined.sharedId, survivors[0], 'withdraw'), /below two members/);
  assert.equal(store.sharedSnapshot(joined.sharedId).participants.length, 2);
  assert.throws(() => store.sharedMemberControl(joined.sharedId, ids[2], 'withdraw'), /not a member/);
  assert.throws(() => store.sharedMemberControl(joined.sharedId, survivors[0], 'evict'), /Unknown shared member action/);
  const separated = store.sharedLeave(joined.sharedId);
  assert.equal(separated.status, 'separated');
  assert.deepEqual(survivors.map(id => store.snapshot(id).sharedSession), [null, null]);
});

test('a joint checkpoint records per-member modes under schema 4 and restores them paused', t => {
  const { store, ids, path } = setup(t, { count: 3 });
  const joined = store.sharedJoin(ids, 2), token = joined.controllerToken;
  store.sharedControl(joined.sharedId, 'start');
  run(store, joined.sharedId, token, 25);
  store.sharedMemberControl(joined.sharedId, ids[1], 'rest');
  run(store, joined.sharedId, token, 25);
  const checkpoint = store.sharedSave(joined.sharedId);
  assert.equal(checkpoint.payload.version, 2);
  assert.deepEqual(checkpoint.payload.members.map(member => member.mode), ['active', 'resting', 'active']);
  const document = JSON.parse(readFileSync(join(path, 'identities.json'), 'utf8'));
  assert.equal(document.schemaVersion, 4);
  validateIdentityDocument(document);
  const restored = store.sharedRestore(checkpoint.jointCheckpointId);
  assert.equal(restored.version, 2);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.tick, checkpoint.payload.tick);
  assert.deepEqual(restored.participants.map(member => member.mode), ['active', 'resting', 'active']);
  assert.equal(store.snapshot(ids[1]).status, 'resting');
  // The restored resting member still advances no neural time under the resumed barrier.
  const frozen = store.snapshot(ids[1]).simTimeMs;
  store.sharedControl(restored.sharedId, 'start');
  run(store, restored.sharedId, restored.controllerToken, 10);
  assert.equal(store.snapshot(ids[1]).simTimeMs, frozen);
  assert.equal(store.snapshot(ids[0]).simTimeMs > frozen, true);
});

test('the validator refuses malformed, mislabelled or downgraded joint mode records', t => {
  const { store, ids, path } = setup(t);
  const joined = store.sharedJoin(ids, 2);
  store.sharedSave(joined.sharedId);
  const original = JSON.parse(readFileSync(join(path, 'identities.json'), 'utf8'));
  assert.equal(original.schemaVersion, 4);
  for (const mutate of [
    document => { document.jointCheckpoints[0].payload.members[0].mode = 'asleep'; },
    document => { delete document.jointCheckpoints[0].payload.members[0].mode; },
    document => { document.jointCheckpoints[0].payload.version = 1; },
    document => { document.schemaVersion = 3; },
  ]) {
    const candidate = structuredClone(original); mutate(candidate);
    const joint = candidate.jointCheckpoints[0];
    joint.sha256 = createHash('sha256').update(JSON.stringify(joint.payload)).digest('hex');
    assert.throws(() => validateIdentityDocument(candidate));
  }
  // Older schemas stay loadable: a schema 3 document with an unversioned joint payload validates.
  const legacy = structuredClone(original);
  legacy.schemaVersion = 3;
  delete legacy.jointCheckpoints[0].payload.version;
  for (const member of legacy.jointCheckpoints[0].payload.members) delete member.mode;
  legacy.jointCheckpoints[0].sha256 = createHash('sha256').update(JSON.stringify(legacy.jointCheckpoints[0].payload)).digest('hex');
  validateIdentityDocument(legacy);
});

test('a session cannot be constructed with every member already resting', () => {
  const runtimes = ['a', 'b'].map(individualId => createRuntime({ individualId }));
  const members = runtimes.map(runtime => ({ runtime, pose: { x: 0, z: 0, yaw: 0 }, mode: 'resting' }));
  assert.throws(() => createFixtureSharedSession(members, { version: 2 }), /every member resting/);
  assert.throws(() => createFixtureSharedSession(members, { version: 1 }), /distinct fixtures/);
  const mixed = createFixtureSharedSession([{ ...members[0] }, { runtime: runtimes[1], pose: { x: 0, z: 0, yaw: 0 } }], { version: 2 });
  assert.throws(() => mixed.memberControl('a', 'rest'), /already in the requested mode/);
  assert.throws(() => mixed.memberControl('missing', 'rest'), /not a member/);
});

test('each shared member owns its own encounter adapter, contact state and dose', t => {
  const { store, ids } = setup(t, { count: 3, encounterFlowers: nearFlower });
  const joined = store.sharedJoin(ids, 2), token = joined.controllerToken;
  store.sharedControl(joined.sharedId, 'start');
  // Encounters are per recipient: the third member never enables and never contacts.
  for (const id of ids.slice(0, 2)) store.encounterDynamicsControl(id, true);
  assert.deepEqual(ids.map(id => store.snapshot(id).encounterDynamics.enabled), [true, true, false]);
  for (let i = 0; i < 800 && !ids.slice(0, 2).every(id => store.snapshot(id).stimulusPolicy.entries.length); i++) {
    store.sharedFrame(joined.sharedId, batch(store.sharedSnapshot(joined.sharedId), token));
  }
  const dosed = ids.map(id => store.snapshot(id));
  // Same flower, independent contact: each member holds exactly its own single garden receipt.
  for (const state of dosed.slice(0, 2)) {
    assert.equal(state.stimulusPolicy.entries.length, 1);
    assert.equal(state.stimulusPolicy.entries[0].source, 'garden');
    assert.equal(state.encounterDynamics.individualId, state.individualId);
    assert.equal(state.encounterDynamics.active.flowerId, 'test-contact');
    assert.equal(state.stimulusPolicy.reservedDose > 0, true);
  }
  assert.notEqual(dosed[0].stimulusPolicy.entries[0].id === dosed[1].stimulusPolicy.entries[0].id && dosed[0].sessionId === dosed[1].sessionId, true);
  // A partner's dose never reaches the uninvolved member's aggregate budget.
  assert.equal(dosed[2].stimulusPolicy.reservedDose, 0);
  assert.equal(dosed[2].stimulusPolicy.entries.length, 0);
  assert.equal(dosed[2].encounterDynamics.active, null);
  const reserved = dosed.map(state => state.stimulusPolicy.reservedDose);
  // Habituation is per recipient: sustained dwell in the same flower never redoses either member.
  run(store, joined.sharedId, token, 120);
  assert.deepEqual(ids.map(id => store.snapshot(id).stimulusPolicy.reservedDose), reserved);
  assert.deepEqual(ids.slice(0, 2).map(id => store.snapshot(id).stimulusPolicy.entries.length), [1, 1]);
  // Resting one member cancels only its own delivery and refunds nothing.
  store.control(ids[0], 'rest');
  const rested = store.snapshot(ids[0]);
  assert.equal(rested.encounterDynamics.enabled, false);
  assert.equal(rested.stimulusPolicy.effects.find(effect => effect.id === 'floral').active, false);
  assert.equal(rested.stimulusPolicy.reservedDose, reserved[0]);
  assert.equal(store.snapshot(ids[1]).encounterDynamics.enabled, true);
  assert.equal(store.snapshot(ids[1]).stimulusPolicy.reservedDose, reserved[1]);
  assert.equal(store.sharedSnapshot(joined.sharedId).status, 'running');
  // The resting member's own recovery clock is frozen; the active member's keeps recovering.
  const recovery = ids.slice(0, 2).map(id => store.snapshot(id).stimulusPolicy.effects.find(effect => effect.id === 'floral').cooldownRemainingMs);
  run(store, joined.sharedId, token, 40);
  const later = ids.slice(0, 2).map(id => store.snapshot(id).stimulusPolicy.effects.find(effect => effect.id === 'floral').cooldownRemainingMs);
  assert.equal(later[0], recovery[0]);
  assert.equal(later[1] < recovery[1], true);
  // Withdrawal cancels only the withdrawn member's delivery; the remaining pair is untouched.
  const partner = store.snapshot(ids[1]).encounterDynamics;
  assert.equal(partner.enabled, true);
  store.sharedMemberControl(joined.sharedId, ids[2], 'withdraw');
  assert.equal(store.snapshot(ids[2]).encounterDynamics.enabled, false);
  assert.equal(store.snapshot(ids[2]).stimulusPolicy.reservedDose, 0);
  const kept = store.snapshot(ids[1]).encounterDynamics;
  assert.equal(kept.enabled, true);
  assert.deepEqual(kept.active, partner.active);
  assert.deepEqual(kept.contactIds, partner.contactIds);
  assert.equal(store.snapshot(ids[1]).stimulusPolicy.reservedDose, reserved[1]);
});

test('shared encounter enablement requires this member to be running and is scoped to its own session', t => {
  const { store, ids } = setup(t, { count: 2, encounterFlowers: nearFlower });
  const joined = store.sharedJoin(ids, 2);
  // A paused shared world cannot arm optional input for anyone.
  assert.throws(() => store.encounterDynamicsControl(ids[0], true), /start the shared world/);
  store.sharedControl(joined.sharedId, 'start');
  store.encounterDynamicsControl(ids[0], true);
  assert.equal(store.snapshot(ids[0]).encounterDynamics.environmentEpoch, store.sharedSnapshot(joined.sharedId).worldEpoch);
  store.sharedMemberControl(joined.sharedId, ids[0], 'rest');
  assert.equal(store.snapshot(ids[0]).encounterDynamics.enabled, false);
  assert.throws(() => store.encounterDynamicsControl(ids[0], true), /resume this member/);
  store.sharedMemberControl(joined.sharedId, ids[0], 'resume');
  store.encounterDynamicsControl(ids[0], true);
  // Pausing the coupled world revokes optional input for every member; start never rearms it.
  store.sharedControl(joined.sharedId, 'pause');
  assert.deepEqual(ids.map(id => store.snapshot(id).encounterDynamics.enabled), [false, false]);
  store.sharedControl(joined.sharedId, 'start');
  assert.equal(store.snapshot(ids[0]).encounterDynamics.enabled, false);
  store.encounterDynamicsControl(ids[0], true);
  // Separating discards the shared-scoped adapter rather than carrying it into independent life.
  store.sharedLeave(joined.sharedId);
  assert.equal(store.snapshot(ids[0]).encounterDynamics.enabled, false);
  assert.throws(() => store.encounterDynamicsControl(ids[0], true), /attach and run/);
});
