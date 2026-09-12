#!/usr/bin/env node
import { backupIdentities, restoreIdentityBackup } from '../server/identity-backup.js';
const [action, source, destination, ...extra] = process.argv.slice(2);
if (!['backup', 'restore'].includes(action) || !source || !destination || extra.length) {
  console.error('Usage: node scripts/identity-backup.js backup <stopped-store-directory> <new-archive-file>\n       node scripts/identity-backup.js restore <archive-file> <new-store-directory>');
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(action === 'backup' ? backupIdentities(source, destination) : restoreIdentityBackup(source, destination))); }
  catch (error) { console.error(`Identity ${action} failed (${error.code ?? 'validation-or-storage-error'}). No existing destination was overwritten. Check inputs and stop the app before backup.`); process.exitCode = 1; }
}
