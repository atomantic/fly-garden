# Local fixture backup and recovery

These commands preserve the supported synthetic fixture store. Schema-v2 stores also preserve shared fixture checkpoint references and committed poses. These backups do not include real connectome workers, learned state or external embodiments. No backup command runs simulation, calls a provider or starts PM2.

## Back up a stopped installation

1. Explicitly save each resident whose current progress should be retained, using a joint save for shared members. Saving through the observatory or scoped checkpoint API is required; stopping does not automatically save unsaved progress.
2. Stop the app: `pm2 stop fly-garden`. Stop any development server using the same store, too. Keep other standalone tools that write capacity settings stopped.
3. Run the command with your chosen store and a new archive filename:

   ```sh
   node scripts/identity-backup.js backup ./data/identities ./fly-garden-backup.json
   ```

4. Keep the archive private and copy it to your chosen local backup medium. Start the app normally when ready. Startup remains paused; explicitly resume only when intended.

The helper acquires the same exclusive SQLite writer lock as the service, validates the whole saved registry and optional `capacity.json`, and writes a new private archive. It refuses an active writer and an existing archive filename. Missing stores are not initialized. A SHA-256 checksum detects accidental changes; it is not authentication against a local file writer.

All individual IDs, primary selection, checkpoint DAGs, replica provenance, selected heads, fixture dynamics and retained exposure reservations are included. Persisted capacity settings are included when present; legacy stores without this file keep that absence. Dataset/model parameters remain in each checkpoint. The archive contains no source-directory field, writer lock, environment file, network configuration or provider credentials. Historic exposure session IDs remain provenance only; they never become the restored command session.

Recordings are a separate bounded observation export, not executable checkpoints, and are not included. Joint fixture records and their referenced individual checkpoints are included in the validated identity store; private camera leases are never saved. Protect archives as private modeled history rather than publishing them with issues.

## Restore into a new directory

Keep the running installation stopped while selecting its replacement. Restore always validates before creating a destination and refuses every existing destination, even an empty directory:

```sh
node scripts/identity-backup.js restore ./fly-garden-backup.json ./data/restored-identities
```

The command writes only `identities.json` and, if archived, `capacity.json`. It does not copy SQLite locks, start a process, switch configuration or advance time. Select the restored directory explicitly in your ignored local configuration using `FLY_GARDEN_DATA_DIR`, then start the app. Verify the expected IDs, heads, history counts and capacity before explicitly resuming. The primary loads paused with a fresh command session; other identities remain saved-unloaded. Active optional input is canceled while exposure reservations remain. Downtime is never replayed.

Keep the original store and archive until verification succeeds. A corrupt or incompatible archive fails before destination creation; an existing destination is never overwritten. Unknown versions have no automatic migration. Normal write errors attempt to remove only files created by this restore. If the process or machine dies during restore, treat any partial new directory as unverified and retry into another new directory. This is a local recovery aid, not a tested hardware/power-loss durability guarantee.

## Verification

`node --test server/identity-backup.test.js server/identity-store.test.js` uses temporary fixture stores to check two-identity/history/configuration round trips, paused fresh-session startup, no duplicate individuals, preserved reservations, writer exclusion, missing-source refusal, corruption rejection and no-overwrite behavior. These tests do not touch the operator's installed state or establish full-connectome readiness.
