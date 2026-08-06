# Kubernetes Deployment Guide

Tavi now ships four complete raw-manifest deployment paths under `infra/k8s/`. Pick one folder, follow its `README.md`, and apply only that folder's manifests. The manifest directory index lives at [`../infra/k8s/README.md`](../infra/k8s/README.md).

## Available paths

| Path                                              | App replicas | Database topology                           | Best for                                                                              |
| ------------------------------------------------- | ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `infra/k8s/k8s-with-external-db/`                 | 1            | External PostgreSQL                         | Small production or staging clusters with an existing database service                |
| `infra/k8s/k8s-with-internal-db/`                 | 1            | Single in-cluster PostgreSQL StatefulSet    | Self-contained cluster deployments without external database dependencies             |
| `infra/k8s/k8s-with-replicas-and-external-db/`    | 3            | External PostgreSQL                         | Higher-availability app rollout while keeping database operations outside the cluster |
| `infra/k8s/k8s-with-replicas-and-internal-ha-db/` | 3            | In-cluster CloudNativePG 3-instance cluster | Full in-cluster deployment with replicated app workloads and HA PostgreSQL            |

## Shared requirements

1. A Kubernetes cluster with a compatible ingress controller using `ingressClassName: contour` by default.
2. `kubectl` access with permission to create resources in the `tavi` namespace. The HA internal-database path also needs permission to create cluster-scoped CloudNativePG resources and resources in `cnpg-system`.
3. A namespace-local `regcred` image-pull secret that authenticates the registry hosting the Tavi images. Do not commit its credentials; create it before applying app workloads.
4. Access to:
   - `ghcr.io/mkronvold-wtg/tavi-api`
   - `ghcr.io/mkronvold-wtg/tavi-web`
   - `ghcr.io/mkronvold-wtg/tavi-worker`
5. A strong `COOKIE_SECRET`.

Additional variant-specific requirements:

1. External DB variants need a reachable PostgreSQL server for `DATABASE_URL`.
2. Internal DB variants need cluster storage for database volumes.
3. The `k8s-with-replicas-and-internal-ha-db` path includes a pinned `cloudnative-pg-install/` kustomization for the CloudNativePG operator and CRDs, plus a root `kustomization.yaml` for the rest of the Tavi stack.

## Recommended selection guide

1. Choose `k8s-with-external-db` when you already have a managed PostgreSQL service and only need Tavi app workloads in-cluster.
2. Choose `k8s-with-internal-db` when you want the simplest self-contained cluster install and single-instance PostgreSQL is acceptable.
3. Choose `k8s-with-replicas-and-external-db` when you want more resilient app replicas but still trust an external database service.
4. Choose `k8s-with-replicas-and-internal-ha-db` when you want both replicated app workloads and an operator-managed HA PostgreSQL cluster in Kubernetes.

## Common deployment flow

Each variant README follows the same pattern:

1. Edit `configmap.yaml` and `ingress.yaml` in the chosen folder for your hostname and public URLs.
2. Create real secrets from that folder's `secret.example.yaml`.
3. Create `regcred` in the target namespace with credentials for the selected image registry.
4. Review that folder's `backup-pvc.yaml`. The API and worker share the backup volume, so the storage class must support `ReadWriteMany`.
5. Internal DB variants also ship an optional `postgres-network-policy.example.yaml` you can customize and apply if your cluster uses NetworkPolicy to limit Postgres access to the API and worker pods.
6. Apply the manifests from that folder only.
7. Verify the rollout for the app deployments and, if present, the database workload.

## Installing CloudNativePG for the HA variant

Before applying `infra/k8s/k8s-with-replicas-and-internal-ha-db/postgres-cluster.yaml`, install the pinned CloudNativePG operator bundle that ships in that variant:

```bash
kubectl apply --server-side -k infra/k8s/k8s-with-replicas-and-internal-ha-db/cloudnative-pg-install
kubectl rollout status deployment/cnpg-controller-manager -n cnpg-system
kubectl get crd | rg 'postgresql.cnpg.io'
kubectl apply -k infra/k8s/k8s-with-replicas-and-internal-ha-db
```

The operator kustomization currently pins CloudNativePG `1.29.0` and includes the upstream operator manifest, `cnpg-system` namespace, CRDs, RBAC, webhook configuration, and controller deployment. The root HA-variant `kustomization.yaml` then applies the namespace, config map, backup PVC, CNPG cluster, app services, app deployments, and ingress in one step.

`prisma migrate deploy` creates the required Prisma-managed tables automatically on an empty database, so the production admin bootstrap does not need any manual SQL table creation. In local-auth mode, the API now also auto-creates `admin@tavi.local` on first startup when the `User` table is empty, generates a random 10-character alphanumeric password, and writes that initial password to the API logs.

To find the generated password in Kubernetes:

```bash
kubectl logs -n tavi deployment/tavi-api -c api \
  | rg 'auth.bootstrap.initial_admin_created|initialPassword'
```

If the pod already restarted, check the previous container logs too:

```bash
kubectl logs -n tavi deployment/tavi-api -c api --previous \
  | rg 'auth.bootstrap.initial_admin_created|initialPassword'
```

The web image serves only its built assets through the static Node server.
Vite preview is a development-only tool and is not included in the production
image.

## Immutable image releases

Every app deployment now uses a `tag@sha256:digest` reference with
`imagePullPolicy: IfNotPresent`. A version-tagged image publish opens a
release-pin pull request that updates all four Kubernetes variants together.
Review and merge that PR, then apply the selected variant:

```bash
kubectl apply -k infra/k8s/k8s-with-external-db
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

Use the matching variant path in place of `k8s-with-external-db`. To roll back,
revert the release-pin commit, reapply the selected variant, and watch the
same rollout statuses. Candidate `latest` and weekly `refresh-*` images are
not deployment inputs.

Third-party Node, PostgreSQL, and Alpine image inputs are also digest-pinned
and updated by Dependabot. The CloudNativePG operator bundle remains a
separately reviewed remote-manifest lifecycle item. See [`LCM.md`](./LCM.md)
for the full policy.

## Backups and restore

Each deployment path now mounts a shared backup directory into both the API and worker at `/var/tavi/backups`.

1. Automatic backups are scheduled from the Tavi UI by an admin. The worker writes complete JSON snapshots into the shared backup PVC.
2. The API reads the same shared directory so admins can preview and restore stored backups from the UI.
3. Replica variants require the same backup PVC to be mounted into multiple pods at once, which is why the template uses `ReadWriteMany`.
4. Full restore replaces the full Tavi dataset. Selective restore supports projects/tasks or users only, with previewed conflict choices before apply.
5. Admins can also create an immediate backup, upload a backup into storage, download stored backups, and delete stored backups from the UI once the shared backup volume is mounted.

Each folder also includes:

- `backup-post-process-pvc.example.yaml`
- `backup-post-process-cronjob.example.yaml`

These are operator templates, not manifests you should apply unchanged. Customize at least:

1. The cron schedule.
2. The image and command used to copy, compress, encrypt, or ship backups.
3. The retention logic.
4. The target PVC size and storage class.

The example cronjob copies the current backup directory into a second PVC and prunes older archive folders. Replace that command with whatever post-processing your environment requires.

## Day-2 operations

Most app operations stay the same across all four paths:

```bash
kubectl get deploy,pods -n tavi
kubectl logs -n tavi deployment/tavi-api -c api --tail=200
kubectl logs -n tavi deployment/tavi-api -c migrate --tail=200
kubectl logs -n tavi deployment/tavi-web -c web --tail=200
kubectl logs -n tavi deployment/tavi-worker -c worker --tail=200

kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

Database-specific checks depend on the selected path:

```bash
# Single in-cluster PostgreSQL variant
kubectl get statefulset,pvc -n tavi
kubectl logs -n tavi statefulset/tavi-postgres --tail=200

# CloudNativePG HA variant
kubectl get deployment -n cnpg-system cnpg-controller-manager
kubectl get crd | rg 'postgresql.cnpg.io'
kubectl get cluster.postgresql.cnpg.io -n tavi
kubectl get pods -n tavi
kubectl describe cluster.postgresql.cnpg.io/tavi-postgres -n tavi
```

## Troubleshooting

| Symptom                                       | Likely cause                                                                               | What to inspect                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API pod stuck in `Init`                       | Migration failure or bad database secret                                                   | `kubectl logs -n tavi deployment/tavi-api -c migrate --tail=200`                                                                                                                                                                                    |
| Web loads but API requests fail               | `VITE_API_BASE_URL`, ingress, or `CORS_ORIGIN` mismatch                                    | The chosen folder's `configmap.yaml`, `ingress.yaml`, and browser network tab                                                                                                                                                                       |
| Imports or notifications never finish         | Worker unavailable or cannot reach the database                                            | `kubectl logs -n tavi deployment/tavi-worker -c worker --tail=200`                                                                                                                                                                                  |
| Backups never appear in the UI                | Backup PVC not mounted, not `ReadWriteMany`, or worker cannot write to `/var/tavi/backups` | `kubectl describe pvc -n tavi tavi-backups`, `kubectl logs -n tavi deployment/tavi-worker -c worker --tail=200`                                                                                                                                     |
| Single-instance Postgres never becomes ready  | Bad DB secret values, PVC binding issue, or storage-class problem                          | `kubectl get pvc -n tavi`, `kubectl describe pod -n tavi tavi-postgres-0`, `kubectl logs -n tavi statefulset/tavi-postgres --tail=200`                                                                                                              |
| CloudNativePG cluster does not become healthy | Missing operator/CRDs, bad bootstrap secrets, or storage issue                             | `kubectl get deployment -n cnpg-system cnpg-controller-manager`, `kubectl get crd \| rg 'postgresql.cnpg.io'`, `kubectl get cluster.postgresql.cnpg.io -n tavi`, `kubectl describe cluster.postgresql.cnpg.io/tavi-postgres -n tavi`, operator logs |
| Ingress host does not respond                 | DNS or ingress-controller issue                                                            | `kubectl get ingress -n tavi`, ingress-controller logs                                                                                                                                                                                              |
