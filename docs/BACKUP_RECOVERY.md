# Local backup and recovery


## Unified installation backup

Use the explicit `backup-all` command to preserve the entire supported saved installation under `FLY_GARDEN_DATA_DIR`: fixture identities and joint checkpoints, capacity settings, `connectomes/catalog.json` and its referenced immutable checkpoint history, and both `recordings/` fixture observations and `connectome-recordings/` typed manual samples. Missing optional stores retain their absence. Bulk graph/atlas arrays, memory measurements, environment files, broker/provider credentials, camera leases, external visitor grants and private machine paths are excluded. Source datasets retain their separate licenses; checkpoints retain exact dataset/model/graph identity.

First explicitly save or checkpoint/unload the residents whose current progress matters, then stop **all** app/development writers using this directory. Stop standalone capacity writers too. Unsaved progress is not implicitly checkpointed. The command holds the fixture and, if present, connectome writer locks across the capture; a missing or partial catalog is an error, never a fresh empty replacement.

```sh
node scripts/identity-backup.js backup-all ./data/identities ./fly-garden-full-backup
node scripts/identity-backup.js restore-all ./fly-garden-full-backup ./data/restored-installation
```

Both destination arguments must name nonexistent directories. Restore produces fixture files directly in the new root, with the archived `connectomes/`, `recordings/` and `connectome-recordings/` directories below it, matching the app's layout. Select that root explicitly with `FLY_GARDEN_DATA_DIR`; neither command edits configuration, launches PM2, loads a neural worker, starts capture or advances time. Research individuals remain unloaded until separate explicit admission. Any fixture loaded by the selected startup policy is paused with a fresh command session. An interrupted recording is restored as partial observation history, available through replay, and never resumed automatically. Existing intentional recording gaps remain disclosed; an indexed missing/corrupt chunk fails backup rather than silently declaring success.

The archive is a directory of allowlisted files plus a final `manifest.json` with SHA-256 and byte lengths for every component. Its manifest is capped at 1 MiB, fixture archive at 17 MiB, connectome catalog at 2 MiB, individual connectome checkpoints at 16 MiB, recording exports at 32 MiB in aggregate, typed connectome exports at 34 MiB each with 32 MiB aggregate chunk payload, and all archive data at 1,140 MiB. Application archive version 2 declares the typed component explicitly; version 1 archives remain supported without creating that absent component. See [manual connectome recordings](CONNECTOME_RECORDINGS.md). Checkpoint histories are validated/copied one file at a time; all neural histories are not retained together in RAM. Directory names, file identities, models, graph hashes, selected heads and restore lineage are validated independently of the outer checksums. Extra files, path traversal, symlinks, overlap and incompatible profile substitutions are rejected. SHA-256 detects corruption, not malicious rewriting by a local administrator.

`server/portable-connectome-profiles.js` uses the checked-in graph manifest locks and canonical graph hashes recorded by the complete paused measurements in [CONNECTOME_MEMORY.md](CONNECTOME_MEMORY.md). This permits offline checkpoint validation without loading or copying graph arrays. These descriptors provide **no runtime memory admission evidence**. On the destination machine, separately prepare the exact licensed graph files, configure their local paths, and explicitly obtain current memory evidence before loading. An unavailable graph or capacity estimate cannot cause fixture substitution.

All archived components are validated before a restore destination is created. A fresh directory is reserved exclusively and a `.restore-in-progress` marker is written and synced before any components. Startup and backup refuse this marker, even if a valid fixture catalog is already present. Child stores are written first, and fixture identity data and `RESTORE_COMPLETE.json` are published last. After all components and the completion marker are synced, the in-progress marker is removed and its directory synced. Existing directories are never overwritten or merged. Normal pre-completion write failures remove only the newly created destination. A failure confirming final marker removal reports `RESTORE_DURABILITY_UNCERTAIN` and preserves the completed destination for offline verification. A process/machine crash can leave an incomplete fresh directory; do not select it as an installation unless the restore finished successfully and its completion marker exists. Retry into another new directory, preserving the archive and original stores. The backup likewise publishes its manifest last; a directory without it is not a valid archive. This is a tested local recovery contract, not a power-loss guarantee for arbitrary filesystems.

Focused verification uses tiny synthetic graph fixtures and no downloads or full neural workers:

```sh
node --test server/application-backup.test.js server/identity-backup.test.js server/connectome-store.test.js server/recording-store.test.js
```

## Legacy fixture-only archive

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
