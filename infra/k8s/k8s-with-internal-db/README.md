# Kubernetes path: internal database

Use this path when the cluster should run a single PostgreSQL instance for Tavi.

## Deploys

| Component                     | Manifest                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Namespace                     | `namespace.yaml`                                                                       |
| ConfigMap                     | `configmap.yaml`                                                                       |
| Secret template               | `secret.example.yaml`                                                                  |
| Backup storage                | `backup-pvc.yaml`                                                                      |
| Backup post-process templates | `backup-post-process-pvc.example.yaml`, `backup-post-process-cronjob.example.yaml`     |
| Optional DB network policy    | `postgres-network-policy.example.yaml`                                                 |
| PostgreSQL                    | `postgres-headless-service.yaml`, `postgres-service.yaml`, `postgres-statefulset.yaml` |
| API                           | `api-deployment.yaml`, `api-service.yaml`                                              |
| Web                           | `web-deployment.yaml`, `web-service.yaml`                                              |
| Worker                        | `worker-deployment.yaml`                                                               |
| Ingress                       | `ingress.yaml`                                                                         |

## Requirements

1. A Kubernetes cluster with a default storage class or another `ReadWriteOnce` storage class available.
2. A compatible ingress controller. The checked-in ingress manifest defaults to `ingressClassName: contour`.
3. Access to Artifactory via namespace `regcred` for `repo.ops.e2open.com` (app images under `dcops-docker-repo` and BSI Postgres under `bitnami-docker-secure`).

## Configure

1. Edit `configmap.yaml` and `ingress.yaml` for your public hostname.
2. Create a real secret from `secret.example.yaml`. The checked-in example points `DATABASE_URL` at `tavi-postgres`.
3. Adjust the `postgres-statefulset.yaml` storage request if `10Gi` is not appropriate. Postgres is the Bitnami Secure Image pin from `infra/images/bsi-postgresql.pin.json` (not Docker Hub). See **Official Postgres → BSI cutover** below before applying over an existing official-Postgres PVC.
4. Update `backup-pvc.yaml` if your cluster needs a different storage class or size. The API and worker share this PVC, so the storage class must support `ReadWriteMany`.
5. If you need downstream archival or off-cluster replication, customize `backup-post-process-pvc.example.yaml` and `backup-post-process-cronjob.example.yaml`.
6. If your cluster enforces or supports NetworkPolicy, customize `postgres-network-policy.example.yaml` to allow only the pods that should reach Postgres before applying it.

## Official Postgres → BSI cutover

Do **not** reuse the existing official-Postgres data directory in place. Live `tavi-dev` (as of investigation) runs:

| Item | Official (current) | BSI Bitnami (target) |
| --- | --- | --- |
| Image | `postgres:18-alpine` | `repo.ops…/bitnami-docker-secure/…/postgresql@sha256:…` |
| UID / fsGroup | `70` | `1001` |
| Mount | `/var/lib/postgresql/data` | `/bitnami/postgresql` |
| PGDATA layout | `…/data/pgdata` | Bitnami under `/bitnami/postgresql` |
| Env | `POSTGRES_*` | `POSTGRESQL_*` (still sourced from secret keys `POSTGRES_*`) |
| PVC name (default) | `postgres-data-tavi-postgres-0` | same VCT name `postgres-data` → **same claim name** |

**Conclusion:** keep the same volumeClaimTemplate name only if you **delete** the bound claim first so Bitnami can initdb on empty storage. Renaming the VCT creates a new PVC and orphans the old one (also valid; reclaim/delete the orphan later). The `tavi-backups` RWX PVC is unrelated and must stay.

### Preferred migration: Tavi logical backup / restore

App backups are JSON `tavi-backup-v1` on the backup PVC (not `pg_dump`). On `tavi-dev` this path already has daily files under `/var/tavi/backups` (e.g. ~5 MB, dozens of snapshots). That is enough for full dataset restore after a fresh DB.

1. **Pre-cutover backup**
   - Settings → Backup Now (or wait for the latest scheduled file).
   - Optionally copy the newest `tavi-backup-*.json` off-cluster.
   - Confirm API/worker still mount `tavi-backups`.
2. **Scale app off the DB** (avoid writes during cutover):

   ```bash
   kubectl -n tavi-dev scale deploy/tavi-api deploy/tavi-worker --replicas=0
   ```

3. **Tear down official Postgres + its PVC** (data on that claim will be destroyed):

   ```bash
   kubectl -n tavi-dev delete sts/tavi-postgres --cascade=orphan
   kubectl -n tavi-dev delete pod/tavi-postgres-0 --force --grace-period=0 2>/dev/null || true
   kubectl -n tavi-dev delete pvc/postgres-data-tavi-postgres-0
   ```

4. **Apply BSI StatefulSet** (from this path / refresh-bsi deploy) and wait Ready:

   ```bash
   kubectl apply -f infra/k8s/k8s-with-internal-db/postgres-statefulset.yaml
   # namespace overlay to tavi-dev if needed
   kubectl -n tavi-dev rollout status sts/tavi-postgres
   ```

5. **Bring API/worker back** (migrate init runs against empty DB schema):

   ```bash
   kubectl -n tavi-dev scale deploy/tavi-api deploy/tavi-worker --replicas=1
   kubectl -n tavi-dev rollout status deploy/tavi-api
   ```

6. **Full restore** from Settings (or API) using the pre-cutover JSON backup. Verify projects/tasks/users and a post-restore Backup Now.

### Optional: `pg_dump` only if app backups are missing

If no usable `tavi-backup-*.json` exists, take a logical dump before step 3, restore into Bitnami after step 4 (same major PG 18), then still prefer app-level backup going forward. Physical/file copy of `pgdata` into `/bitnami/postgresql` is **not** supported across images/UIDs.

### Size notes (tavi-dev snapshot)

- DB ~15 MB logical / ~70 MB on disk — low risk, short cutover window.
- Backup PVC independent (`tavi-backups`, ontap-nas RWX); do not delete it.

## Install

```bash
kubectl apply -f infra/k8s/k8s-with-internal-db/namespace.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/configmap.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/backup-pvc.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/postgres-headless-service.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/postgres-service.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/postgres-statefulset.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/api-service.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/web-service.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/api-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/worker-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/web-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/ingress.yaml
```

Apply the post-process templates only after customizing them:

```bash
kubectl apply -f infra/k8s/k8s-with-internal-db/backup-post-process-pvc.example.yaml
kubectl apply -f infra/k8s/k8s-with-internal-db/backup-post-process-cronjob.example.yaml
```

Apply the example Postgres NetworkPolicy only after confirming the allowed pod labels match your deployment:

```bash
kubectl apply -f infra/k8s/k8s-with-internal-db/postgres-network-policy.example.yaml
```

## Verify

```bash
kubectl rollout status statefulset/tavi-postgres -n tavi
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```
