# Lifecycle Management

Tavi uses two complementary lifecycle paths to keep container deployments current:

1. Scheduled image refreshes rebuild the published GHCR app images with fresh base layers.
2. Dependabot PRs update source-controlled dependencies such as pnpm packages, GitHub Actions, and Dockerfile base tags.

These paths solve different problems. Image refreshes reduce exposure to CVEs fixed in upstream base layers without changing the repository. Dependabot PRs change tracked source files and should pass the normal review and validation flow.

## Published app images

Tavi publishes three app images:

| Image                           | Dockerfile                       |
| ------------------------------- | -------------------------------- |
| `ghcr.io/mkronvold/tavi-api`    | `infra/docker/api.Dockerfile`    |
| `ghcr.io/mkronvold/tavi-web`    | `infra/docker/web.Dockerfile`    |
| `ghcr.io/mkronvold/tavi-worker` | `infra/docker/worker.Dockerfile` |

The normal publish workflow keeps the existing release behavior:

- PRs build images without pushing them.
- `main` publishes `latest`, branch tags, and `sha-*` tags.
- version tags publish tag and `sha-*` tags.

The scheduled refresh workflow runs from the default branch, rebuilds the same three images with `pull: true` and `no-cache: true`, then publishes:

- `latest`
- `refresh-YYYYMMDD-HHMMSS`

It intentionally does not publish `sha-*` tags because a refresh is not tied to a new source commit.

## Container vulnerability scanning

The `Scan container images` workflow uses Trivy to scan the API, web, and worker
images for `HIGH` and `CRITICAL` vulnerabilities. Findings are uploaded as SARIF
to GitHub Security > Code scanning alerts under separate `trivy-api`, `trivy-web`,
and `trivy-worker` categories.

- Pull requests, `main` pushes, and manual runs build and scan the candidate
  images locally.
- A successful scheduled image refresh triggers a scan of the published GHCR
  `latest` images.
- The workflow is report-only: vulnerabilities create Security alerts without
  blocking image publication. Scan or SARIF-upload failures still fail the
  workflow.

Review the initial alert baseline before making a vulnerability threshold
blocking. Document accepted exceptions in the version-controlled
`.trivyignore.yaml` file with an ID, rationale, and expiration date.

## Dependency PR automation

Dependabot is configured for:

- pnpm/npm dependencies from the repository root
- GitHub Actions workflow versions
- Dockerfile base-image references under `infra/docker/`

Patch and minor Dependabot updates are eligible for auto-approval and auto-merge after required checks pass. Major updates remain manual because they can include breaking changes or runtime behavior changes.

Suggested manual review prompt for major dependency PRs:

```text
Review this dependency update for Tavi. Focus on breaking changes, runtime or build changes, security implications, migration notes, and whether the Docker/Kubernetes deployment docs need updates.
```

## Docker Compose image refresh consumption

The published-image compose stack in `infra/docker/compose-prod.yaml` uses `TAVI_TAG`, defaulting to `latest`.

To consume a refreshed `latest` image:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  pull

docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

To pin a specific refresh build, set `TAVI_TAG=refresh-YYYYMMDD-HHMMSS` in the compose env file and run the same pull and up commands.

## Kubernetes image refresh consumption

The raw Kubernetes manifests use `:latest` for Tavi app images and set Tavi app containers to `imagePullPolicy: Always`. That keeps rollouts compatible with weekly `latest` refreshes.

After a scheduled refresh publishes new images, replace running pods with:

```bash
kubectl rollout restart deployment/tavi-api -n tavi
kubectl rollout restart deployment/tavi-web -n tavi
kubectl rollout restart deployment/tavi-worker -n tavi
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

If you pin manifests to a timestamped `refresh-*` tag or a release tag, update the selected variant's manifests first, then apply them and watch the rollout.

## Manual lifecycle items

Some deployment pins are intentionally documented for manual review in this first lifecycle pass:

- `postgres:16-alpine` in Docker Compose and the single-node internal PostgreSQL Kubernetes variant
- `alpine:3.22` in backup post-processing CronJob examples
- the pinned CloudNativePG operator bundle URL under `infra/k8s/k8s-with-replicas-and-internal-ha-db/cloudnative-pg-install/`

Review these periodically when planning database or cluster-operator maintenance. They are outside the first Dependabot automation scope because raw Kubernetes manifest pins and remote kustomize URLs are not as cleanly handled as pnpm, GitHub Actions, and Dockerfile dependencies.
