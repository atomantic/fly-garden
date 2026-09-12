import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openIdentityStore } from './identity-store.js';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'visitor-authority-')), store = openIdentityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); }); return store;
}
test('private external authority preserves the runtime but excludes all ordinary mutation and step paths', t => {
  const store = fixture(t), id = store.primaryId, initial = store.snapshot(id), checkpoint = initial.persistence.checkpointId;
  store.environmentControl(id, 'attach'); store.control(id, 'start'); store.encounterDynamicsControl(id, true);
  const owner = 'private-owner-value', handle = store.claimExternal(id, owner), claimed = store.snapshot(id);
  assert.equal(claimed.sessionId, initial.sessionId); assert.equal(claimed.status, 'paused');
  assert.equal(claimed.environmentAdapter.attached, false); assert.equal(claimed.encounterDynamics.enabled, false);
  assert.deepEqual(claimed.externalOwner, { kind: 'managed-visitor' }); assert(!JSON.stringify(claimed).includes(owner));
  for (const operation of [() => store.control(id, 'start'), () => store.control(id, 'home'), () => store.encounter(id, 'quiet'),
    () => store.environmentControl(id, 'attach'), () => store.environmentFrame(id, {}), () => store.encounterDynamicsControl(id, true),
    () => store.save(id), () => store.restore(id, checkpoint), () => store.replica(id, checkpoint), () => store.load(id),
    () => store.unload(id), () => store.claimExternal(id, 'other')]) assert.throws(operation, /managed visitor owns/);
  handle.control('start'); store.step(); store.step(id); assert.equal(store.snapshot(id).tick, 0);
  const candidate = handle.prepareStep({ retinalCurrents: Array(32).fill(0.01) }); handle.previewStep(candidate); handle.commitStep(candidate);
  assert.equal(store.snapshot(id).tick, 1); assert.equal(store.snapshot(id).sessionId, initial.sessionId);
  handle.control('rest'); handle.release(); assert.equal(store.snapshot(id).status, 'resting'); assert.equal(store.snapshot(id).externalOwner, null);
  assert.throws(() => handle.control('start'), /revoked/); assert.throws(() => handle.commitStep(candidate), /revoked/);
  const next = store.claimExternal(id, owner); handle.release(); assert.equal(next.isCurrent(), true); next.release();
});
test('visitor join rejects shared membership and joint restore rejects externally owned members', t => {
  const store = fixture(t), a = store.primaryId, b = store.create().individualId; store.load(b);
  const shared = store.sharedJoin([a, b]), saved = store.sharedSave(shared.sharedId);
  assert.throws(() => store.claimExternal(a, 'owner'), /explicitly separate/);
  assert.equal(store.snapshot(b).sharedSession.sharedId, shared.sharedId);
  store.sharedLeave(shared.sharedId); const handle = store.claimExternal(a, 'owner');
  assert.throws(() => store.sharedJoin([a, b]), /managed visitor owns/);
  assert.throws(() => store.sharedRestore(saved.jointCheckpointId), /managed visitor owns/);
  assert.equal(store.snapshot(b).sharedSession, null); handle.release();
});
