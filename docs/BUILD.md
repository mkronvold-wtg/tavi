# Build from Source with Docker Compose

Use this guide when you want the checked-out repository to run inside local
development containers. This path installs dependencies, builds the shared
packages, runs database migrations, and starts the apps from source. If you
want a no-build runtime that pulls the published images instead, use
[`DOCKER.md`](./DOCKER.md).

## Requirements

1. Git
2. Docker Engine with the `docker compose` plugin available
3. Node 26 for any commands run directly on the host

## Start the stack

```bash
git clone https://github.com/mkronvold/tavi
cd tavi
./scripts/dev-up
```

What startup does automatically:

1. Starts PostgreSQL
2. Installs workspace dependencies inside the running containers
3. Builds shared packages needed by the apps
4. Runs Prisma generate, migrations, and seed for the API
5. Starts the API, web app, and worker

The compose stack also mounts a shared backup directory into the API and worker:

- host path: `${BACKUP_HOST_DIRECTORY:-../../backups}` from `.env`
- container path: `${BACKUP_DIRECTORY:-/var/tavi/backups}`

Copy `.env.example` to `.env` at the repo root if you want to override those defaults.

If you temporarily run the API or worker directly on the host instead of through Docker, Tavi can fall back from the container path to `BACKUP_HOST_DIRECTORY` so the same repo `.env` still works.

## Open the app

After the stack is healthy, open:

- Web UI: `http://localhost:5173`
- API: `http://localhost:4000/api`
- API metrics: `http://localhost:4000/api/metrics`
- Worker health: `http://localhost:4100/health`
- Worker metrics: `http://localhost:4100/metrics`

## Sign in

Default local accounts:

| Role   | Email               | Password      |
| ------ | ------------------- | ------------- |
| Admin  | `admin@tavi.local`  | `password123` |
| Editor | `editor@tavi.local` | `password123` |
| Viewer | `viewer@tavi.local` | `password123` |

## Stop the stack

```bash
./scripts/dev-down
```

## Reset local Docker data

This removes the local PostgreSQL volume and is destructive for your local environment.

```bash
./scripts/dev-down -v
```

Then start again:

```bash
./scripts/dev-up
```

## Useful commands

Check container state:

```bash
docker compose -f infra/docker/compose-dev.yaml ps
```

Follow logs:

```bash
docker compose -f infra/docker/compose-dev.yaml logs -f api
docker compose -f infra/docker/compose-dev.yaml logs -f web
docker compose -f infra/docker/compose-dev.yaml logs -f worker
docker compose -f infra/docker/compose-dev.yaml logs -f postgres
```

Scheduled backup files appear on the host under the configured backup directory. See [`BACKUPS.md`](./BACKUPS.md) for the in-app backup, upload, download, delete, and restore workflow.

## Optional home link override

These scripts only manage the source-based Docker Compose development stack in `infra/docker/compose-dev.yaml`. They are separate from the published-image local runtime in [`DOCKER.md`](./DOCKER.md), which now also has a dedicated compose file at `infra/docker/compose-prod.yaml`, and this repository does not currently include a separate `.devcontainer` configuration.

If you want the header logo to point somewhere other than the default local URL, set `TAVI_HOME_URL` before startup.

```bash
export TAVI_HOME_URL="https://your-preview-host.example.com"
./scripts/dev-up
```

## Local troubleshooting

| Problem                           | What to check                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Web UI does not load              | Confirm `tavi-web` is running and port `5173` is free                                                                              |
| API calls fail                    | Confirm `tavi-api` is healthy and port `4000` is free                                                                              |
| Imports do not progress           | Confirm `tavi-worker` is running                                                                                                   |
| Login hint is gone                | The default accounts were changed; use the current admin account or reset defaults from [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md) |
| Layout feels wrong after a change | Use `Settings -> Reset all user settings` to restore your synced preferences to defaults and clear the browser cache               |
