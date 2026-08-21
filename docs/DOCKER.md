# Docker Runtime Guide

Use this guide to run Tavi from published immutable GHCR images. For
source-driven development, use [`BUILD.md`](./BUILD.md).

## Requirements

1. Docker Engine with Docker Compose.
2. Access to the Tavi GHCR packages when they are private.
3. Free local ports `5173`, `4000`, `4100`, and `5432`.

Run `docker login ghcr.io` before pulling private packages.

## Configure the runtime

The repository commits release image references in
`infra/docker/compose-prod.images.env`. Do not edit that file locally; it is
updated by a reviewable version-release pull request.

Copy the runtime example and set real secrets:

```bash
cp infra/docker/compose-prod.env.example infra/docker/compose-prod.env
```

Set at least `TAVI_COOKIE_SECRET` and `POSTGRES_PASSWORD`. Useful runtime
variables include:

| Variable                                                                                       | Purpose                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| `TAVI_COOKIE_SECRET`                                                                           | Required API session secret           |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                            | Bundled PostgreSQL credentials        |
| `TAVI_DATABASE_URL`                                                                            | Optional API/worker database override |
| `TAVI_WEB_HOST_PORT`, `TAVI_API_HOST_PORT`, `TAVI_WORKER_HOST_PORT`, `TAVI_POSTGRES_HOST_PORT` | Host ports                            |
| `TAVI_HOME_URL`, `TAVI_API_BASE_URL`, `TAVI_CORS_ORIGIN`                                       | Browser and API URLs                  |
| `TAVI_BACKUP_DIRECTORY`                                                                        | Shared API and worker backup path     |
| `SMTP_URL`, `SMTP_FROM`                                                                        | Optional outbound email configuration |

## Start and stop the stack

```bash
docker compose \
  --env-file infra/docker/compose-prod.images.env \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

The one-shot `migrate` service runs the Prisma migration CLI shipped in the
minimal API runtime before API and worker start. The API image copies the
OpenSSL 3 schema engine to `/app/schema-engine` and sets
`PRISMA_SCHEMA_ENGINE_BINARY` so migrate does not need the `openssl` CLI on a
read-only root filesystem. The API and worker images are built with `pnpm deploy`
and must regenerate or copy the Prisma client into the deployed package after
deploy—`@prisma/client` alone is not enough at runtime. The web image serves
static assets through its built-in Node server and writes `runtime-config.js` to
`/tmp` at start (`/app/dist/runtime-config.js` is a symlink).

Follow the API logs to capture the generated initial admin password for an
empty local-auth database:

```bash
docker compose \
  --env-file infra/docker/compose-prod.images.env \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  logs -f api
```

Stop the stack with:

```bash
docker compose \
  --env-file infra/docker/compose-prod.images.env \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  down
```

The stack creates named PostgreSQL and backup volumes automatically.

## Pull and inspect the release images

```bash
set -a
. ./infra/docker/compose-prod.images.env
set +a

docker pull "$TAVI_API_IMAGE"
docker pull "$TAVI_WEB_IMAGE"
docker pull "$TAVI_WORKER_IMAGE"
```

Every value contains a tag and digest. The digest is immutable, so a later
movement of a tag cannot change the pulled image.

## Manual migration

Compose runs migrations automatically. For a manually managed network, use the
same immutable API reference:

```bash
set -a
. ./infra/docker/compose-prod.images.env
. ./infra/docker/compose-prod.env
set +a

docker run --rm \
  --network tavi-net \
  -e DATABASE_URL="$TAVI_DATABASE_URL" \
  "$TAVI_API_IMAGE" \
  ./node_modules/.bin/prisma migrate deploy
```

## Helper scripts

From `infra/docker/` after creating `compose-prod.env`:

```bash
./up.sh
./down.sh
./autoupdate.sh --once
```

`up.sh` and `down.sh` use `compose-prod.images.env` when present (immutable pin
channel). Without that file they honor image references from Compose/`compose-prod.env`
(mutable home Docker-host channel).

`autoupdate.sh` watches GHCR digests for `api`, `web`, and `worker`, pulls only
when they change, and restarts through `./up.sh`. Prefer `--once` under cron or a
systemd timer. See [`LCM.md`](./LCM.md) for the auto-refresh channel rules.

## Release and rollback

Promote a new version by reviewing and merging its generated release-pin pull
request, then running the Compose `pull` and `up -d` commands above. Candidate
`latest` and `refresh-*` images are not deployment inputs for the immutable
channel.

To roll back an immutable deploy, restore the three references in
`infra/docker/compose-prod.images.env` from the previous release-pin commit
and run the same commands. See [`LCM.md`](./LCM.md) for the full promotion,
refresh, auto-refresh, and rollback policy.

## Open the app

- Web UI: `http://localhost:5173`
- API: `http://localhost:4000/api`
- API metrics: `http://localhost:4000/api/metrics`
- Worker health: `http://localhost:4100/health`
- Worker metrics: `http://localhost:4100/metrics`
