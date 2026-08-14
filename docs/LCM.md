# Lifecycle Management

Tavi deploys immutable container references. A deployment manifest always uses a
human-readable tag together with a content digest, so the digest—not a mutable
tag—selects the image that runs.

See [`CI.md`](./CI.md) for validation, SBOM/provenance evidence, and Trivy
scanning. See [`DOCKER.md`](./DOCKER.md) and
[`KUBERNETES.md`](./KUBERNETES.md) for deployment procedures.

## Weekly release cut

Product versions are cut on a Friday schedule separate from Dependabot:

1. Monday-oriented dependency updates land through Dependabot and auto-merge.
2. Friday 13:00 UTC (`Cut weekly release`) opens a version PR from current `main` when there are commits or Unreleased changelog notes since the previous release.
3. The release PR bumps workspace package versions, folds `CHANGELOG.md` Unreleased entries into `x.y.z`, and auto-merges after required checks.
4. `Tag release` creates the annotated `vx.y.z` tag and GitHub Release.
5. The existing publish workflow reacts to the `v*` tag, publishes images, and opens the release-pin PR for Compose/Kubernetes promotion.

Version bump policy: patch by default; minor when Unreleased is marked with `### Features` or `### Breaking Changes`. Major bumps stay manual.

## Published images and promotion

Tavi publishes three images:

| Image                           | Dockerfile                       |
| ------------------------------- | -------------------------------- |
| `ghcr.io/mkronvold-wtg/tavi-api`    | `infra/docker/api.Dockerfile`    |
| `ghcr.io/mkronvold-wtg/tavi-web`    | `infra/docker/web.Dockerfile`    |
| `ghcr.io/mkronvold-wtg/tavi-worker` | `infra/docker/worker.Dockerfile` |

The normal publish workflow builds every pull request without pushing. Pushes
to `main` publish candidate `latest`, branch, and `sha-*` tags. A `v*` tag
publishes release-tagged images and opens a release-pin pull request that:

1. Updates `infra/docker/compose-prod.images.env`.
2. Updates API, web, and worker references in every supported raw Kubernetes
   deployment variant.
3. Uses `tag@sha256:digest` for each service image and
   `imagePullPolicy: IfNotPresent`.

Review and merge that pull request to promote the release. The workflow never
changes deployment manifests directly. The checked-in initial pin uses the last
available `sha-*` image because no version-tagged container image existed when
immutable deployment references were introduced.

## Refreshes, base images, and dependencies

The scheduled refresh workflow runs weekly from the default branch. It
validates, tests, rebuilds, scans, and attaches SBOM/provenance evidence to
candidate `latest` and `refresh-*` images. Those tags are diagnostic and
candidate artifacts only; they do not change a deployed environment.

Third-party references are pinned by digest in Dockerfiles, Compose, and raw
Kubernetes manifests:

- Node 26 builder and slim runtime images
- PostgreSQL 16 Alpine
- Alpine backup post-processing examples

Dependabot maintains pnpm/npm, GitHub Actions, Dockerfile, Compose, and raw
Kubernetes image references. A merged digest-update PR intentionally changes a
tracked input. The next versioned image release then promotes the resulting
runtime through a release-pin PR.

The CloudNativePG remote operator bundle remains a manual lifecycle item. Its
upstream kustomization URL is not a container image reference and must be
reviewed with the operator's upgrade documentation.

## Compose rollout and rollback

Always use the checked-in immutable release file plus a local runtime/secrets
file:

```bash
docker compose \
  --env-file infra/docker/compose-prod.images.env \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  pull

docker compose \
  --env-file infra/docker/compose-prod.images.env \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

To roll back, revert the release-pin commit or restore the previous three
references in `compose-prod.images.env`, then run the same `pull` and `up -d`
commands. Do not substitute `latest` or a refresh tag for a reviewed release
pin.

Helper scripts in `infra/docker/`:

- `up.sh` — pull images and start the stack (runs the Compose `migrate` service)
- `down.sh` — stop the stack
- `autoupdate.sh` — GHCR digest watcher for the mutable Docker-host channel

```bash
cd infra/docker
./up.sh
./down.sh
./autoupdate.sh --once
./autoupdate.sh 30
```

## Home Docker-host auto-refresh channel

Trusted self-hosted Compose instances may track a mutable app tag such as
`latest` and refresh automatically. This channel is separate from the immutable
release/Kubernetes pins above.

Requirements:

1. App services use GHCR images (`api`, `web`, `worker`).
2. Postgres and proxies are excluded from auto-refresh.
3. `autoupdate.sh` compares local image digests to remote GHCR manifests before
   pulling.
4. On change, it restarts only through `./up.sh` so migrations stay aligned with
   manual startup.
5. Prefer `./autoupdate.sh --once` under cron or a systemd timer (about every 30
   minutes), with a lock file so cycles cannot overlap.
6. One timer/log/lock per stack instance when multiple Tavi stacks share a host.

Example cron entries:

```cron
*/30 * * * * cd /path/to/tavi-damocles && /bin/bash ./autoupdate.sh --once >> ./autoupdate.log 2>&1
*/30 * * * * cd /path/to/tavi-kronvold && /bin/bash ./autoupdate.sh --once >> ./autoupdate.log 2>&1
```

Do not enable host auto-refresh until the tracked mutable tag has been smoke-tested
(`api`/`worker` can import `@prisma/client`, migrate exits 0, and healthchecks pass).
If a bad candidate is published, pin the host stack to a known-good local or GHCR
tag/digest, set `TAVI_TAG` accordingly, and rerun `./up.sh`.

Rollback on an auto-refresh host means pointing the stack at a known-good tag or
digest and running `./up.sh`, not editing a running container. Do not use
Watchtower unless an explicit exception is approved.

## Kubernetes rollout and rollback

Merge the release-pin pull request, apply the chosen manifest variant, and
watch the rollout:

```bash
kubectl apply -k infra/k8s/k8s-with-external-db
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

Use the matching path for the selected deployment variant. To roll back,
revert the release-pin commit, reapply that variant, and watch the same rollout
statuses. An immutable digest makes the selected rollback artifact explicit and
reproducible.
