# tavi

tavi — short for Track And Visualize. We mostly just call it tavi.

## Local development

Tavi currently ships as a TypeScript monorepo with:

- `apps/web` - React workspace UI
- `apps/api` - NestJS API with local-auth support
- `apps/worker` - background worker for CSV import staging and commit jobs

## Documentation

- `CHANGELOG.md` - release history by version
- `docs/README.md` - user, admin, and operator guide index
- `docs/QUICKSTART.md` - choose between source build, Docker runtime, and Kubernetes deployment guides
- `docs/BUILD.md` - source-based Docker Compose development guide
- `docs/DOCKER.md` - prebuilt GHCR image runtime guide
- `docs/KUBERNETES.md` - raw-manifest deployment and day-2 operations
- `docs/CI.md` - GitHub Actions validation, image scanning, and code-scanning alerts
- `docs/LCM.md` - container image refreshes and dependency lifecycle management
- `docs/DESIGN.md` and `docs/ARCHITECTURE.md` - product and technical reference specs

### Run locally from source with Docker Compose

```bash
./scripts/dev-up
```

Stop the stack with:

```bash
./scripts/dev-down
```

The local stack exposes:

- web: `http://localhost:5173`
- api: `http://localhost:4000/api`
- api metrics: `http://localhost:4000/api/metrics`
- worker health: `http://localhost:4100/health`
- worker metrics: `http://localhost:4100/metrics`
- postgres: `localhost:5432`

Compose applies the committed Prisma migrations and seeds the local auth accounts automatically when the API container starts.

These scripts manage the source-mounted Docker Compose development stack in `infra/docker/compose-dev.yaml`. The published-image local runtime now has its own compose file at `infra/docker/compose-prod.yaml`, and this repository does not currently define a separate `.devcontainer` setup.

For a local runtime that uses the published GHCR images and does not build from source, use `docs/DOCKER.md`.

The local containers are named `tavi-postgres`, `tavi-api`, `tavi-web`, and `tavi-worker`.

If you need the header logo link to point somewhere other than the current local URL, set `TAVI_HOME_URL` before running `./scripts/dev-up`. The Kubernetes web deployment reads the same `TAVI_HOME_URL` value from the chosen variant's `configmap.yaml` under [`infra/k8s/`](./infra/k8s/README.md).

The local dev stack uses Vite dev mode through Compose. The published
`tavi-web` image serves only its static production assets through its built-in
Node server.

## Container publishing

GitHub Actions publishes the production image set from `infra/docker` to GHCR:

- `ghcr.io/mkronvold/tavi-api`
- `ghcr.io/mkronvold/tavi-web`
- `ghcr.io/mkronvold/tavi-worker`

The `publish-images.yml` workflow builds all three images on pull requests,
then pushes branch, tag, and `sha-*` tags on `main`, version tags, or manual
dispatch. Version tags create a reviewable release-pin pull request; Compose
and Kubernetes consume immutable `tag@sha256:digest` references.

### Local login accounts

- `admin@tavi.local`
- `editor@tavi.local`
- `viewer@tavi.local`

Password for all local accounts:

```text
password123
```

The login screen shows this default-user hint only while these seeded accounts
still exist with `password123`. Admins can recreate them from Settings -> Local
Accounts -> Reset Defaults.
