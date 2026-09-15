# Backups and Restore Guide

The `Backups` panel is the admin-facing control surface for scheduled backups, manual snapshots, stored backup files, and restore.

## Open the panel

1. Open `Settings`.
2. Select the `Backups` settings card.
3. Use the header `Close` button when you want to hide the panel again.

## What the panel shows

| Area              | What it does                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Automatic Backups | Enables or disables the worker-driven backup schedule                                                                          |
| Backup time       | Shows the daily backup time in your browser's local timezone and saves it in UTC when you use `Save`                           |
| Backup retention  | Keeps the newest backup per UTC day, ISO week, and month; defaults to 7 daily, 4 weekly, and 3 monthly                         |
| Upload Backup     | Validates a Tavi backup JSON file and saves it into backup storage                                                             |
| Backup Now        | Creates a fresh backup immediately and saves it into backup storage                                                            |
| Status grid       | Shows the active backup directory, last success, last failure, stored-backup count, total storage, and active retention policy |
| Restore controls  | Previews a stored backup, then applies a full or selective restore; controls open above the stored-backup list                 |
| Stored Backups    | Lists saved backup files with `Protect`/`Unprotect`, `Restore`, `Download`, and `Delete` controls                              |

## Stored backup workflow

All backups now go through storage first.

1. Scheduled backups are written by the worker into the configured backup directory.
2. `Backup Now` writes a new stored snapshot into the same directory.
3. `Upload Backup` stores the uploaded JSON file before it can be restored.
4. Restore preview and restore apply always run from a stored backup file.

Visible backup timestamps such as `Last success`, `Last failure`, stored-backup modified times, and restore preview times use the browser's local timezone and include the timezone label.

## Retention and protection

Backup retention is configured in `Settings` -> `Backups` and applies to scheduled backups, manual `Backup Now` files, and uploaded backups. The default policy keeps:

1. 7 daily buckets
2. 4 weekly buckets
3. 3 monthly buckets

Each tier accepts a non-negative integer. `0` disables that tier. The retention pass sorts stored backups by modified timestamp newest-first, then file name for deterministic ties. It assigns at most one unprotected backup to each UTC calendar-day bucket, ISO-week bucket, and UTC calendar-month bucket, in that order, so the same unprotected file is not counted in multiple tiers.

`Protect` stores per-file protection metadata in PostgreSQL. Protected backup files are excluded from automatic pruning until an admin chooses `Unprotect`; they still appear in total storage usage and can be restored, downloaded, or manually deleted. Deleting a file also removes its protection metadata, and missing-file metadata is cleaned up the next time the backup directory is scanned.

## Restore workflow

1. Select `Restore` from a stored backup row, or choose a stored backup in the restore controls.
2. Review the backup preview counts and metadata.
3. Choose one restore scope:
   - `Full restore`
   - `Projects and tasks only`
   - `Users only`
4. For selective restore, choose the projects or users to include.
5. For `Projects and tasks only`, you can also clear the current project/task workspace first without reseeding example projects.
6. Resolve any conflicts by choosing `Skip` or `Replace existing`.
7. Confirm the restore.

## Restore scope behavior

| Scope                   | What it changes                                                                  |
| ----------------------- | -------------------------------------------------------------------------------- |
| Full restore            | Replaces the full Tavi dataset with the selected backup                          |
| Projects and tasks only | Restores selected projects plus their tasks without replacing user records       |
| Users only              | Restores selected users and role assignments without replacing projects or tasks |

Full backups include per-user task viewed state, so task-level unviewed-change highlights survive a full restore. Older backups that predate task viewed-state data are restored with existing active tasks treated as already viewed to avoid flooding users with old highlights. Legacy project viewed-state records may also be present in snapshots for compatibility, but current workspace highlighting is derived from task viewed state.

## Download and delete

1. `Download` streams the selected stored backup JSON file to your browser.
2. `Protect` or `Unprotect` toggles whether automatic retention pruning can remove the selected stored backup.
3. `Delete` removes the stored file from backup storage after confirmation.

Deleting a backup file does not change live workspace data. It only removes that stored snapshot from the backup directory.

## Backup directory behavior

Tavi supports the same repo `.env` in both local and containerized development:

1. It tries `BACKUP_DIRECTORY` first.
2. If that path is not usable for the current process, it falls back to `BACKUP_HOST_DIRECTORY`.
3. If neither is set, it falls back to the local default `backups` folder for the current runtime.

This means:

1. Docker and Kubernetes can keep using container paths like `/var/tavi/backups`.
2. Locally started API or worker processes can still use the host backup path without rewriting the shared `.env`.

## Runtime notes

1. Docker Compose mounts the same backup directory into both the API and worker.
2. Published-image Docker runs should mount the same host `./backups` directory into both containers.
3. Kubernetes variants mount the same backup PVC into the API and worker, and replica variants require shared-write storage.

## Non-obvious behavior

1. The API reads stored backups, but the worker is what creates scheduled backups.
2. A restore preview does not change data; it only computes counts, conflict matches, and selectable restore items.
3. Full restore can require reauthentication if the current signed-in account is replaced or loses admin access.
4. Backup upload accepts only valid Tavi backup JSON, not arbitrary exported JSON from other systems.
5. Backup schedule times are stored in UTC even though the UI shows them in browser-local time.
