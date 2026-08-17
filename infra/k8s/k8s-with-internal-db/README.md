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
3. Adjust the `postgres-statefulset.yaml` storage request if `10Gi` is not appropriate. Postgres is the Bitnami Secure Image pin from `infra/images/bsi-postgresql.pin.json` (not Docker Hub). First cutover from official Postgres may need the PVC recreated because the data path is `/bitnami/postgresql`.
4. Update `backup-pvc.yaml` if your cluster needs a different storage class or size. The API and worker share this PVC, so the storage class must support `ReadWriteMany`.
5. If you need downstream archival or off-cluster replication, customize `backup-post-process-pvc.example.yaml` and `backup-post-process-cronjob.example.yaml`.
6. If your cluster enforces or supports NetworkPolicy, customize `postgres-network-policy.example.yaml` to allow only the pods that should reach Postgres before applying it.

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
