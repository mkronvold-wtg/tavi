# Lifecycle Management

Tavi deploys immutable container references. A deployment manifest always uses a
human-readable tag together with a content digest, so the digest—not a mutable
tag—selects the image that runs.

See [`CI.md`](./CI.md) for validation, SBOM/provenance evidence, and Trivy
scanning. See [`DOCKER.md`](./DOCKER.md) and
[`KUBERNETES.md`](./KUBERNETES.md) for deployment procedures.

## Published images and promotion

Tavi publishes three images:

| Image                           | Dockerfile                       |
| ------------------------------- | -------------------------------- |
| `ghcr.io/mkronvold/tavi-api`    | `infra/docker/api.Dockerfile`    |
| `ghcr.io/mkronvold/tavi-web`    | `infra/docker/web.Dockerfile`    |
| `ghcr.io/mkronvold/tavi-worker` | `infra/docker/worker.Dockerfile` |

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
