import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { openIdentityStore, validateIdentityDocument } from './identity-store.js';
import { backupIdentities, restoreIdentityBackup } from './identity-backup.js';
import { createFixtureSharedSession } from './fixture-shared-session.js';
import { createRuntime } from './runtime.js';

function directory(t) { const path = mkdtempSync(join(tmpdir(), 'fly-shared-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function setup(t, options) {
  const path = directory(t), store = openIdentityStore(path, options); t.after(() => store.close());
  const ids = [store.primaryId, store.create().individualId]; store.load(ids[1]);
  return { store, ids, path };
}
function batch(state, token, reverse = false) {
  const frames = state.participants.map((p, i) => ({ version: 1, individualId: p.individualId, sessionId: p.sessionId,
    environmentEpoch: state.worldEpoch, frameId: state.tick, simTimeMs: p.simTimeMs, capturedAtMs: Date.now(), camera: 'controller',
    width: 8, height: 4, rgb: Array(96).fill(i ? 255 : 0) }));
  return { controllerToken: token, worldEpoch: state.worldEpoch, worldTick: state.tick, frames: reverse ? frames.reverse() : frames };
}

test('explicit joint ownership revokes visual leases, prevents timer/individual advancement and preserves separate neural identity', t => {
  const { store, ids } = setup(t);
  const visual = store.environmentControl(ids[0], 'attach');
  store.control(ids[0], 'start'); store.step(ids[1]);
  const joined = store.sharedJoin(ids), token = joined.controllerToken;
  assert.equal(joined.status, 'paused');
  assert.equal(store.snapshot(ids[0]).environmentAdapter.attached, false);
  assert.equal(JSON.stringify(store.snapshot(ids[0])).includes(token), false);
  for (const id of ids) {
    assert.throws(() => store.control(id, 'start'), /shared session/);
    assert.throws(() => store.save(id), /shared session/);
    assert.throws(() => store.restore(id, store.snapshot(id).persistence.checkpointId), /shared session/);
    assert.throws(() => store.unload(id), /shared session/);
    assert.throws(() => store.environmentControl(id, 'attach'), /shared session/);
    assert.throws(() => store.environmentFrame(id, { controllerToken: visual.controllerToken }), /shared session/);
    assert.throws(() => store.encounter(id, 'nectar'), /shared session/);
  }
  const running = store.sharedControl(joined.sharedId, 'start');
  store.step(); assert.deepEqual(ids.map(id => store.snapshot(id).tick), [0, 0]);
  const input = batch(running, token, true), trace = store.sharedFrame(joined.sharedId, input);
  assert.equal(trace.worldTick, 1);
  assert.deepEqual(ids.map(id => store.snapshot(id).tick), [1, 1]);
  assert.notDeepEqual(store.snapshot(ids[0]).neural, store.snapshot(ids[1]).neural);
  assert.deepEqual(trace.traces.map(trace => trace.individualId), ids);
  assert.equal(trace.traces[0].retinalCurrents.every(value => value === 0), true);
  assert.equal(trace.traces[1].retinalCurrents.every(value => value > 0), true);
  assert.throws(() => store.sharedFrame(joined.sharedId, input), /clock/);
  store.control(ids[0], 'pause');
  assert.deepEqual(ids.map(id => store.snapshot(id).status), ['paused', 'paused']);
  assert.equal(store.sharedSnapshot(joined.sharedId).tick, 1);
  store.control(ids[0], 'rest');
  assert.equal(store.snapshot(ids[0]).status, 'resting');
  assert.equal(store.snapshot(ids[1]).status, 'paused');
  assert.equal(store.snapshot(ids[1]).sharedSession, null);
  assert.throws(() => store.sharedFrame(joined.sharedId, input), /not found/);
});

test('incomplete, cross-wired, duplicate, stale and invalid retinal batches leave every member and world unchanged', t => {
  const { store, ids } = setup(t), joined = store.sharedJoin(ids);
  const running = store.sharedControl(joined.sharedId, 'start');
  const before = JSON.stringify(ids.map(id => store.snapshot(id)));
  const bad = [
    b => b.frames.pop(), b => { b.frames[1] = structuredClone(b.frames[0]); },
    b => { b.frames[1].sessionId = b.frames[0].sessionId; }, b => { b.frames[1].rgb[20] = NaN; },
    b => { b.frames[1].capturedAtMs -= 1000; }, b => { b.frames[1].simTimeMs += 5; },
    b => { b.worldEpoch = 'stale'; }, b => { b.frames[1].frameId++; }, b => { b.controllerToken = '0'.repeat(64); },
  ];
  for (const mutate of bad) {
    const input = batch(running, joined.controllerToken); mutate(input);
    assert.throws(() => store.sharedFrame(joined.sharedId, input));
    assert.equal(JSON.stringify(ids.map(id => store.snapshot(id))), before);
  }
});

test('joint checkpoint transaction retains real per-ID references, poses and paused explicit restore across boot and backup', t => {
  const { store, ids, path } = setup(t), joined = store.sharedJoin(ids);
  let state = store.sharedControl(joined.sharedId, 'start');
  for (let i = 0; i < 200; i++) { store.sharedFrame(joined.sharedId, batch(state, joined.controllerToken)); state = store.sharedSnapshot(joined.sharedId); }
  const before = ids.map(id => store.snapshot(id)), checkpoint = store.sharedSave(joined.sharedId);
  assert.equal(checkpoint.payload.tick, 200);
  for (const member of checkpoint.payload.members) assert.equal(member.checkpointId, store.snapshot(member.individualId).persistence.checkpointId);
  assert.equal(checkpoint.payload.members[1].pose.z > 0, true);
  const document = JSON.parse(readFileSync(join(path, 'identities.json')));
  assert.equal(document.schemaVersion, 3); validateIdentityDocument(document);
  assert.equal(JSON.stringify(document).includes(joined.controllerToken), false);
  store.sharedFrame(joined.sharedId, batch(state, joined.controllerToken));
  const restored = store.sharedRestore(checkpoint.jointCheckpointId);
  assert.equal(restored.status, 'paused'); assert.equal(restored.tick, 200);
  assert.notEqual(restored.sharedId, joined.sharedId); assert.notEqual(restored.controllerToken, joined.controllerToken);
  for (let i = 0; i < 2; i++) {
    assert.notEqual(restored.participants[i].sessionId, before[i].sessionId);
    assert.deepEqual(store.snapshot(ids[i]).neural, before[i].neural);
    assert.deepEqual(restored.participants[i].pose, checkpoint.payload.members[i].pose);
  }
  store.close();
  const archive = join(directory(t), 'backup.json'); backupIdentities(path, archive);
  const destination = join(directory(t), 'restored'); restoreIdentityBackup(archive, destination);
  const reopened = openIdentityStore(destination, { residentIds: [ids[1]] }); t.after(() => reopened.close());
  assert.deepEqual(ids.map(id => reopened.snapshot(id).status), ['paused', 'paused']);
  assert.deepEqual(ids.map(id => reopened.snapshot(id).sharedSession), [null, null]);
  assert.equal(reopened.sharedRestore(checkpoint.jointCheckpointId).tick, 200);
});

test('joint restore cannot refund either recipient policy or replace an overlapping owner', t => {
  const { store, ids } = setup(t), joined = store.sharedJoin(ids), checkpoint = store.sharedSave(joined.sharedId);
  store.sharedLeave(joined.sharedId);
  store.control(ids[1], 'start'); store.encounter(ids[1], 'nectar');
  const before = ids.map(id => store.snapshot(id));
  assert.throws(() => store.sharedRestore(checkpoint.jointCheckpointId), /policy|reservation|exposure|spent/i);
  assert.deepEqual(ids.map(id => store.snapshot(id)), before);
  const third = store.create().individualId; store.load(third);
  const other = store.sharedJoin([ids[0], third]);
  assert.throws(() => store.sharedRestore(checkpoint.jointCheckpointId), /overlapping/);
  assert.equal(store.sharedSnapshot(other.sharedId).status, 'paused');
});

test('failed atomic joint save never changes either durable head or creates dangling joint references', t => {
  let fail = false;
  const { store, ids, path } = setup(t, { write: (path, text) => { if (fail) throw new Error('disk full'); writeFileSync(path, text); } });
  const joined = store.sharedJoin(ids), before = readFileSync(join(path, 'identities.json'), 'utf8');
  fail = true; assert.throws(() => store.sharedSave(joined.sharedId), /disk full/);
  assert.equal(readFileSync(join(path, 'identities.json'), 'utf8'), before);
  assert.equal(store.sharedCheckpoints().length, 0);
  assert.equal(store.sharedSnapshot(joined.sharedId).status, 'paused');
});

test('validator rejects cross-individual and malformed joint references even with recalculated digest', t => {
  const { store, ids, path } = setup(t), joined = store.sharedJoin(ids); store.sharedSave(joined.sharedId);
  const original = JSON.parse(readFileSync(join(path, 'identities.json')));
  for (const mutate of [p => { p.members[0].checkpointId = p.members[1].checkpointId; }, p => { p.members[0].pose.x = 3; },
    p => { p.members[0].simTimeMs = 5; }, p => { p.members[1] = structuredClone(p.members[0]); }]) {
    const document = structuredClone(original), joint = document.jointCheckpoints[0]; mutate(joint.payload);
    joint.sha256 = createHash('sha256').update(JSON.stringify(joint.payload)).digest('hex');
    assert.throws(() => validateIdentityDocument(document));
  }
});

test('shared watchdog pauses every member and frame order has equivalent results without privileged neural exchange', () => {
  let time = Date.now();
  const make = () => [createRuntime({ individualId: randomUUID() }), createRuntime({ individualId: randomUUID() })];
  const a = make(), b = make();
  const session = runtimes => createFixtureSharedSession(runtimes.map(runtime => ({ runtime, pose: { x: 0, z: 0, yaw: 0 } })), { now: () => time });
  const first = session(a), second = session(b); first.start(); second.start();
  const inputA = batch(first.snapshot(), 'unused'), inputB = batch(second.snapshot(), 'unused', true);
  delete inputA.controllerToken; delete inputB.controllerToken;
  for (const input of [inputA, inputB]) for (const frame of input.frames) frame.capturedAtMs = time;
  first.accept(inputA); second.accept(inputB);
  assert.deepEqual(a.map(r => r.snapshot().neural), b.map(r => r.snapshot().neural));
  assert.deepEqual(first.snapshot().participants.map(p => p.pose), second.snapshot().participants.map(p => p.pose));
  time += 251; assert.equal(first.checkFreshness(), false);
  assert.deepEqual(a.map(r => r.snapshot().status), ['paused', 'paused']);
  assert.deepEqual(a.map(r => r.snapshot().tick), [1, 1]);
});

test('same-session shared steps retain active input and spent reservations; restore cancels input without refund', t => {
  const { store, ids } = setup(t);
  store.control(ids[0], 'start'); store.encounter(ids[0], 'nectar');
  const policy = store.snapshot(ids[0]).stimulusPolicy;
  const joined = store.sharedJoin(ids), state = store.sharedControl(joined.sharedId, 'start');
  store.sharedFrame(joined.sharedId, batch(state, joined.controllerToken));
  const after = store.snapshot(ids[0]);
  assert.equal(after.chemistry.some(effect => effect.active), true);
  assert.equal(after.stimulusPolicy.reservedDose, policy.reservedDose);
  assert.equal(store.snapshot(ids[1]).stimulusPolicy.reservedDose, 0);
  const joint = store.sharedSave(joined.sharedId); store.sharedRestore(joint.jointCheckpointId);
  assert.equal(store.snapshot(ids[0]).chemistry.some(effect => effect.active), false);
  assert.equal(store.snapshot(ids[0]).stimulusPolicy.reservedDose, policy.reservedDose);
});

test('failed joint restore write preserves running ownership, neural states, poses and durable heads', t => {
  let fail = false;
  const { store, ids, path } = setup(t, { write: (path, text) => { if (fail) throw new Error('disk full'); writeFileSync(path, text); } });
  const joined = store.sharedJoin(ids), joint = store.sharedSave(joined.sharedId);
  const running = store.sharedControl(joined.sharedId, 'start'); store.sharedFrame(joined.sharedId, batch(running, joined.controllerToken));
  const states = ids.map(id => store.snapshot(id)), document = readFileSync(join(path, 'identities.json'), 'utf8');
  fail = true; assert.throws(() => store.sharedRestore(joint.jointCheckpointId), /disk full/);
  assert.deepEqual(ids.map(id => store.snapshot(id)), states);
  assert.equal(readFileSync(join(path, 'identities.json'), 'utf8'), document);
});

test('a numerical failure preview prevents every neural and pose commit and pauses the coupled session', () => {
  const first = createRuntime({ individualId: 'first' }), actual = createRuntime({ individualId: 'second' });
  const second = { ...actual, previewStep: token => ({ ...actual.previewStep(token), kind: 'fault', status: 'fault' }) };
  const session = createFixtureSharedSession([first, second].map(runtime => ({ runtime, pose: { x: 0.25, z: -0.5, yaw: 0.2 } })));
  session.start(); const before = [first, actual].map(r => r.snapshot().neural), state = session.snapshot();
  const input = batch(state, 'unused'); delete input.controllerToken;
  assert.throws(() => session.accept(input), /numerical/);
  assert.deepEqual([first, actual].map(r => r.snapshot().neural), before);
  assert.deepEqual(session.snapshot().participants.map(p => p.pose), state.participants.map(p => p.pose));
  assert.equal(session.snapshot().tick, 0); assert.equal(session.snapshot().status, 'paused');
  assert.deepEqual([first, actual].map(r => r.snapshot().status), ['paused', 'paused']);
});

test('joint checkpoint capacity refuses the entire batch without pruning or orphaning a member history', t => {
  const { store, ids, path } = setup(t);
  for (let i = 0; i < 63; i++) store.save(ids[1]);
  const joined = store.sharedJoin(ids), before = readFileSync(join(path, 'identities.json'), 'utf8');
  const running = store.sharedControl(joined.sharedId, 'start');
  const dynamics = ids.map(id => store.snapshot(id).neural);
  assert.throws(() => store.sharedSave(joined.sharedId), /history limit/);
  assert.equal(store.sharedSnapshot(joined.sharedId).status, 'paused');
  assert.notEqual(store.sharedSnapshot(joined.sharedId).worldEpoch, running.worldEpoch);
  assert.deepEqual(ids.map(id => store.snapshot(id).status), ['paused', 'paused']);
  assert.deepEqual(ids.map(id => store.snapshot(id).neural), dynamics);
  assert.equal(readFileSync(join(path, 'identities.json'), 'utf8'), before);
  assert.equal(store.checkpoints(ids[0]).length, 1);
  assert.equal(store.checkpoints(ids[1]).length, 64);
  assert.equal(store.sharedCheckpoints().length, 0);
});

test('direct frame timeout and backward clock pause and rotate the epoch before the timer watchdog runs', () => {
  for (const elapsed of [251, -1]) {
    let time = 1000;
    const runtimes = [createRuntime({ individualId: 'first' }), createRuntime({ individualId: 'second' })];
    const session = createFixtureSharedSession(runtimes.map(runtime => ({ runtime, pose: { x: 0, z: 0, yaw: 0 } })), { now: () => time });
    session.start(); const before = session.snapshot(), input = batch(before, 'unused'); delete input.controllerToken;
    time += elapsed; input.frames.forEach(frame => { frame.capturedAtMs = time; });
    assert.throws(() => session.accept(input), /deadline/);
    assert.equal(session.snapshot().status, 'paused'); assert.notEqual(session.snapshot().worldEpoch, before.worldEpoch);
    assert.deepEqual(runtimes.map(runtime => runtime.snapshot().tick), [0, 0]);
    assert.deepEqual(session.snapshot().participants.map(p => p.pose), before.participants.map(p => p.pose));
    time = 1000; assert.throws(() => session.accept(input), /epoch/);
    session.start(); const fresh = batch(session.snapshot(), 'unused'); delete fresh.controllerToken;
    fresh.frames.forEach(frame => { frame.capturedAtMs = time; });
    session.accept(fresh); assert.equal(session.snapshot().tick, 1);
  }
});
