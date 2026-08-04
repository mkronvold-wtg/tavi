# Kubernetes manifests

This directory now contains only the supported raw-manifest deployment variants for Tavi. Pick one subdirectory and follow that folder's `README.md`; do not mix manifests across variants.

## Start with the docs

1. [Quickstart](../../docs/QUICKSTART.md) to choose between Docker Compose, published Docker images, and Kubernetes.
2. [Kubernetes deployment guide](../../docs/KUBERNETES.md) for the selection guide, shared requirements, backups, and day-2 operations.
3. [Architecture](../../docs/ARCHITECTURE.md) for the runtime topology across web, API, worker, and database components.
4. [Backups](../../docs/BACKUPS.md) for the shared backup volume and restore workflow used by every Kubernetes variant.

## Deployment variants

| Path | Database | App replicas | Use when |
| --- | --- | --- | --- |
| [`k8s-with-external-db/`](./k8s-with-external-db/README.md) | External PostgreSQL | 1 | You already have a database service and only need Tavi workloads in-cluster |
| [`k8s-with-internal-db/`](./k8s-with-internal-db/README.md) | Single in-cluster PostgreSQL StatefulSet | 1 | You want the simplest self-contained cluster install |
| [`k8s-with-replicas-and-external-db/`](./k8s-with-replicas-and-external-db/README.md) | External PostgreSQL | 3 | You want more resilient app replicas while keeping the database external |
| [`k8s-with-replicas-and-internal-ha-db/`](./k8s-with-replicas-and-internal-ha-db/README.md) | In-cluster CloudNativePG cluster | 3 | You want replicated app workloads and HA PostgreSQL in Kubernetes |

## Notes

1. Each variant directory includes its own `namespace.yaml`, `configmap.yaml`, `secret.example.yaml`, workload manifests, and backup storage templates.
2. The `k8s-with-replicas-and-internal-ha-db/` variant also includes `cloudnative-pg-install/`, a pinned CloudNativePG operator + CRD kustomization used before the HA database cluster is applied.
3. The old top-level manifests were removed because they were a legacy pre-variant set and no longer matched the backup-aware deployment layouts in the supported folders.
4. When you need `TAVI_HOME_URL`, `VITE_API_BASE_URL`, ingress hostnames, or backup PVC settings, edit the files in the chosen variant directory rather than expecting shared manifests at this level.

## Development deployment helper defaults

`tavi-dev.defaults.env` supplies the default `K8S_NAMESPACE` and `K8S_CLUSTER`
used by the external `tavi-dev/update.sh` helper. The helper reads this file
after updating its Tavi source checkout; caller-provided environment values take
precedence. These Kubernetes client settings do not belong in Dockerfiles or
Docker Compose because containers do not use them.

The helper supports `--prepare-only` to validate generated manifests,
`--write-only` to write them without a Kubernetes operation, and `--apply-only`
to validate and apply the manifests already written to `tavi-dev`.
