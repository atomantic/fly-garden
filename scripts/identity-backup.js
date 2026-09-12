#!/usr/bin/env node
import { backupIdentities, restoreIdentityBackup } from '../server/identity-backup.js';
import { backupApplication, restoreApplicationBackup } from '../server/application-backup.js';
const [action, source, destination, ...extra] = process.argv.slice(2);
if (!['backup', 'restore', 'backup-all', 'restore-all'].includes(action) || !source || !destination || extra.length) {
  console.error('Usage: node scripts/identity-backup.js backup <stopped-store-directory> <new-archive-file>\n       node scripts/identity-backup.js restore <archive-file> <new-store-directory>\n       node scripts/identity-backup.js backup-all <stopped-data-directory> <new-archive-directory>\n       node scripts/identity-backup.js restore-all <archive-directory> <new-data-directory>');
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(({ backup: backupIdentities, restore: restoreIdentityBackup, 'backup-all': backupApplication, 'restore-all': restoreApplicationBackup })[action](source, destination))); }
  catch (error) { console.error(`Identity ${action} failed (${error.code ?? 'validation-or-storage-error'}). No existing destination was overwritten. Check inputs and stop the app before backup.`); process.exitCode = 1; }
}
