import { createHash } from 'node:crypto';
import { readFileSync, statSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireIdentityStoreLock, validateIdentityDocument } from './identity-store.js';
import { validateCapacitySettings } from './population-capacity.js';

const MAX_BYTES = 17 * 1024 * 1024;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function readBounded(path, limit = MAX_BYTES) {
  if (statSync(path).size > limit) throw new Error('Backup input exceeds its storage bound.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function validateCapacity(document) {
  if (document === null) return;
  if (!exact(document, ['schemaVersion', 'settings']) || document.schemaVersion !== 1) throw new Error('Invalid backup capacity schema.');
  validateCapacitySettings(document.settings);
}
export function validateIdentityBackup(archive) {
  if (!exact(archive, ['schemaVersion', 'kind', 'createdAt', 'data', 'sha256'])
    || archive.schemaVersion !== 1 || archive.kind !== 'fly-garden-identity-backup'
    || typeof archive.createdAt !== 'string' || !Number.isFinite(Date.parse(archive.createdAt))
    || !exact(archive.data, ['identities', 'capacity']) || archive.sha256 !== digest(archive.data)) {
    throw new Error('Backup is corrupt or incompatible.');
  }
  if (Buffer.byteLength(JSON.stringify(archive.data.identities)) > 16 * 1024 * 1024) throw new Error('Identity storage bound exceeded.');
  validateIdentityDocument(archive.data.identities);
  validateCapacity(archive.data.capacity);
  return structuredClone(archive);
}
function writeExclusive(path, text) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); }
  catch (error) { try { unlinkSync(path); } catch {} throw error; }
  finally { closeSync(fd); }
}
/** Caller must hold the fixture writer lock for a coherent multi-store capture. */
export function readIdentityBackup(directory) {
  const identities = readBounded(join(directory, 'identities.json'), 16 * 1024 * 1024);
  let capacity = null;
  try { capacity = readBounded(join(directory, 'capacity.json'), 4096); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const data = { identities, capacity };
  return validateIdentityBackup({ schemaVersion: 1, kind: 'fly-garden-identity-backup',
    createdAt: new Date().toISOString(), data, sha256: digest(data) });
}

/** Run while the app is stopped. The service's own writer lock excludes concurrent saves. */
export function backupIdentities(directory, archivePath) {
  directory = resolve(directory);
  // Never initialize a missing source store as a side effect of backup.
  statSync(join(directory, 'identities.json'));
  const release = acquireIdentityStoreLock(directory);
  try {
    const archive = readIdentityBackup(directory);
    const { identities, capacity } = archive.data;
    writeExclusive(archivePath, JSON.stringify(archive));
    return { individualCount: identities.individuals.length,
      checkpointCount: identities.individuals.reduce((sum, item) => sum + item.checkpoints.length, 0),
      capacityIncluded: capacity !== null };
  } finally { release(); }
}
/** Validation precedes directory creation. Existing destinations, including empty ones, are refused. */
export function restoreIdentityBackup(archivePath, destination) {
  const archive = validateIdentityBackup(readBounded(archivePath));
  destination = resolve(destination);
  mkdirSync(destination, { mode: 0o700 });
  const written = [];
  try {
    for (const [name, document] of [['identities.json', archive.data.identities], ['capacity.json', archive.data.capacity]]) {
      if (document === null) continue;
      const path = join(destination, name);
      writeExclusive(path, JSON.stringify(document));
      written.push(path);
    }
  } catch (error) {
    for (const path of written) { try { unlinkSync(path); } catch {} }
    try { rmdirSync(destination); } catch {}
    throw error;
  }
  return { individualCount: archive.data.identities.individuals.length, status: 'restored-offline',
    disclosure: 'No runtime started. Select the new store explicitly; startup restores the primary paused.' };
}
