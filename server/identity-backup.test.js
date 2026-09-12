import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openIdentityStore } from './identity-store.js';
import { openCapacityStore } from './population-capacity.js';
import { backupIdentities, restoreIdentityBackup } from './identity-backup.js';
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'fly-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, source: join(root, 'source'), archive: join(root, 'backup.json'), destination: join(root, 'restored') };
}
test('backup retains every identity/history and capacity; restore is offline and boot is paused', t => {
  const { source, archive, destination } = setup(t);
  const store = openIdentityStore(source);
  const id = store.primaryId;
  store.control(id, 'start'); store.encounter(id, 'nectar'); store.step(); store.save();
  const first = store.snapshot();
  const second = store.replica(id, first.persistence.checkpointId);
  store.load(second.individualId); store.control(second.individualId, 'start'); store.step(); store.save(second.individualId);
  const policy = openCapacityStore(source);
  policy.configure({ ...policy.settings(), maxResidentFlies: 3 });
  store.close();
  const identities = JSON.parse(readFileSync(join(source, 'identities.json'), 'utf8'));
  assert.deepEqual(backupIdentities(source, archive), { individualCount: 2, checkpointCount: 5, capacityIncluded: true });
  const text = readFileSync(archive, 'utf8');
  assert.equal(text.includes(source), false);
  assert.equal(text.includes(first.sessionId), true); // Exposure provenance is data, not an active credential.
  assert.equal(restoreIdentityBackup(archive, destination).status, 'restored-offline');
  assert.deepEqual(readdirSync(destination).sort(), ['capacity.json', 'identities.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(destination, 'identities.json'), 'utf8')), identities);
  assert.equal(openCapacityStore(destination).settings().maxResidentFlies, 3);
  const restored = openIdentityStore(destination);
  t.after(() => restored.close());
  assert.equal(restored.primaryId, id);
  assert.equal(restored.snapshot().status, 'paused');
  assert.notEqual(restored.snapshot().sessionId, first.sessionId);
  assert.equal(restored.snapshot(second.individualId).status, 'saved-unloaded');
  assert.equal(restored.snapshot().chemistry.some(item => item.active), false);
  restored.step();
  assert.deepEqual(restored.snapshot().neural, first.neural);
  assert.equal(restored.list().length, 2);
});
test('active writer and missing source reject backup without creating an archive', t => {
  const { source, archive, root } = setup(t);
  const store = openIdentityStore(source);
  assert.throws(() => backupIdentities(source, archive), /open|lock/);
  assert.equal(existsSync(archive), false);
  store.close();
  assert.throws(() => backupIdentities(join(root, 'missing'), archive));
  assert.equal(existsSync(join(root, 'missing')), false);
});
test('corrupt archive, incompatible payload and invalid capacity fail before destination creation', t => {
  const { source, archive, destination } = setup(t);
  openIdentityStore(source).close();
  backupIdentities(source, archive);
  const original = JSON.parse(readFileSync(archive, 'utf8'));
  for (const mutate of [
    a => { a.sha256 = 'bad'; },
    a => { a.schemaVersion = 2; },
    a => { a.data.identities.schemaVersion = 2; },
    a => { a.data.capacity = { schemaVersion: 1, settings: { maxResidentFlies: -1 } }; },
  ]) {
    const invalid = structuredClone(original); mutate(invalid);
    if (invalid.sha256 !== 'bad') invalid.sha256 = createHash('sha256').update(JSON.stringify(invalid.data)).digest('hex');
    writeFileSync(archive, JSON.stringify(invalid));
    assert.throws(() => restoreIdentityBackup(archive, destination));
    assert.equal(existsSync(destination), false);
  }
});
test('existing archive and restore destinations are never overwritten', t => {
  const { source, archive, destination } = setup(t);
  openIdentityStore(source).close();
  backupIdentities(source, archive);
  const bytes = readFileSync(archive);
  assert.throws(() => backupIdentities(source, archive), { code: 'EEXIST' });
  assert.deepEqual(readFileSync(archive), bytes);
  mkdirSync(destination);
  writeFileSync(join(destination, 'marker'), 'preserve');
  assert.throws(() => restoreIdentityBackup(archive, destination), { code: 'EEXIST' });
  assert.deepEqual(readdirSync(destination), ['marker']);
});
