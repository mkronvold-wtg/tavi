# Continuous Integration and Security Scanning

Tavi uses GitHub Actions to validate code, publish attestable container images,
scan artifacts, and automate reviewed dependency maintenance. The supported
Node baseline is 26, declared in `.node-version` and `package.json`.

See [`WORKFLOWS.md`](./WORKFLOWS.md) for the public/private lane map and
sequence, [`LCM.md`](./LCM.md) for promotion and rollback, and
[`GITHUB-SETUP.md`](./GITHUB-SETUP.md) for required repository settings.

## Workflows

| Workflow                        | When it runs                                               | What it does                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Publish container images`      | Every PR, `main`, `v*` tags, or manual dispatch            | Detects container-relevant PR changes; validates and builds API/web/worker images only when needed, publishing public GHCR images and internal Artifactory images from the trusted `docker-wtg` runner outside PRs. After each internal digest is pushed, a fail-closed High/Critical Trivy scan must pass before `deploy-tavi-dev`. A `v*` tag also opens a release-pin PR. |
| `Scan container images`         | Every PR, `main`, manual dispatch, or a successful refresh | Detects container-relevant PR changes; scans applicable API, web, and worker images with Trivy and uploads High/Critical SARIF findings to GitHub code scanning.                                                                                       |
| `Refresh container images`      | Mondays at 08:17 UTC or manual dispatch                    | Re-validates, tests, rebuilds, attests, and scans candidate `latest` and timestamped refresh images. Public GHCR refresh scans are informational (`exit-code: 0`); internal Artifactory refreshes from `docker-wtg` use the same fail-closed High/Critical gate as internal publish. It does not deploy them. |
| `Refresh BSI images`            | Mondays 07:23 UTC, push to `main` touching BSI pins, or manual dispatch | Internal lane only: resolves latest Bitnami Secure Image tags from `sv4.art` on `docker-wtg`, updates `infra/images/bsi-*.pin.json`, syncs k8s consumers to `repo.ops` pull refs, opens a pin PR when the candidate moves, and deploys the pin to `tavi-dev` after it lands on `main`. |
| `Cut weekly release`            | Fridays at 13:00 UTC or manual dispatch                    | Opens a version-bump PR from the latest default-branch tip when there is work to release. Patch by default; minor when `CHANGELOG.md` Unreleased contains a marked Features or Breaking section. Enables auto-merge after required checks.           |
| `Tag release`                   | Push to `main` that lands a `Release x.y.z` commit         | Creates the annotated `v*` tag and GitHub Release notes from the changelog section. The tag push triggers image publish and the release-pin PR.                                                                                                       |
| `Auto-merge dependency updates` | Dependabot PR events                                       | Approves supported npm, GitHub Actions, and Docker updates of every version type after required checks succeed.                                                                                                                                        |

## Validation

The publish and refresh workflows run:

1. `corepack pnpm install --frozen-lockfile`
2. Builds for `@tavi/config` and `@tavi/schemas`
3. API Prisma client generation
4. `corepack pnpm lint`
5. `corepack pnpm typecheck`
6. `corepack pnpm test`

Image builds are independent per service. Every pull request creates the
required workspace, image-build, and image-scan check runs. Pull requests that
do not modify container-relevant inputs skip those jobs successfully; changes
to application code, packages, container definitions, dependency metadata, or
the relevant workflows run the full candidate-image validation without
publishing. If change detection fails, the workflows run the full validation
instead of skipping it. Run the same root commands locally with Node 26 before
opening a change.

## Internal Artifactory publication

Trusted pushes to the default branch or a version tag (`v*`) build API, web,
and worker images again on the repository-scoped `docker-wtg` self-hosted
runner. Those images are published to
`sv4.art.e2open.com/dcops-docker-repo/tavi-{api,web,worker}` with the same
`latest`, ref, and SHA tag policy as public images. The job logs in with
repository secrets `ARTIFACTORY_USERNAME` and `ARTIFACTORY_RW_TOKEN` via
`docker/login-action` so the write credential can be rotated in GitHub without
touching runner host config. (`sv4.art` and `repo.ops` are CNAME aliases in
dev; push always targets `sv4.art`.)

The `build-and-publish-internal` job is gated to
`github.event_name == 'push'` limited to `refs/heads/main` or
`refs/tags/v*`, and uses `always()` plus an explicit
`needs.validate.result == 'success'` check so a skipped PR-only `changes`
ancestor does not suppress the job on main/tag pushes. Neither
`workflow_dispatch` nor any other branch ref can reach it. Scheduled
refreshes enforce the same default-branch guard and the same Artifactory
login secrets.

After each internal image is pushed, `build-and-publish-internal` scans the
exact `sv4.art.e2open.com` digest with `aquasecurity/trivy-action@v0.36.0`
(High/Critical vulns only, `.trivyignore.yaml`, table report retained 180
days as `internal-<service>-trivy-report`). That scan uses `exit-code: "1"`,
so a new High/Critical finding fails the matrix job and therefore
`deploy-tavi-dev`. This is stricter than the public GHCR publish scan, which
keeps `exit-code: "0"` and leaves enforcement to `trivy-scan.yml`.

The internal matrix is serialized because Tavi currently has one matching
runner. GitHub-hosted runners continue to build and publish public GHCR
images, while Kubernetes deployments consume the internal Artifactory service
through `repo.ops.e2open.com`.

### Dependabot and private app images

Dependabot Docker updates use read-only registries `artifactory-sv4` and
`artifactory-repo-ops` with Dependabot secrets `ARTIFACTORY_USERNAME` and
`ARTIFACTORY_RO_TOKEN`. Kubernetes pins for `tavi-api` / `tavi-web` /
`tavi-worker` remain ignored: those are immutable release pins managed by
publish/release-pin automation.

### Image lanes: public vs internal/BSI

Tavi keeps two parallel image supply chains:

| Lane | Registries | Runners | Used by |
| ---- | ---------- | ------- | ------- |
| **Public** | Docker Hub, GHCR | GitHub-hosted, dockerhost-home | Local compose (`infra/docker`), public GHCR app images, Dependabot for compose base images |
| **Internal / BSI** | `sv4.art` (push/source), `repo.ops` (cluster pull) | `docker-wtg` self-hosted | Artifactory `tavi-{api,web,worker}`, Bitnami Secure Images, `tavi-dev` Kubernetes |

Do not point `tavi-dev` at Docker Hub or GHCR for runtime images.

### BSI PostgreSQL candidates

In-cluster Postgres (internal-db path / tavi-dev) uses Broadcom **Bitnami Secure
Images** already published into Artifactory, not a mirrored Docker Hub
`postgres` image.

| Item | Value |
| ---- | ----- |
| Source (resolve latest) | `sv4.art.e2open.com/bitnami-docker-secure/containers/debian-12/postgresql:latest` |
| Pin file | `infra/images/bsi-postgresql.pin.json` |
| Cluster pull ref | `repo.ops.e2open.com/bitnami-docker-secure/containers/debian-12/postgresql@sha256:…` |
| Consumer | `infra/k8s/k8s-with-internal-db/postgres-statefulset.yaml` |
| Sync command | `node scripts/sync-bsi-pins.mjs` |
| Workflow | `Refresh BSI images` (RO Artifactory login via `ARTIFACTORY_RO_TOKEN`) |

Weekly (and on dispatch) the workflow pulls `:latest` on `docker-wtg`, compares
the digest to the pin, and opens a PR when Broadcom/BSI refreshes land on
`sv4.art`. After the pin merges to `main`, the same workflow deploys to
`tavi-dev` through the jump-host `update.sh` path (with `VKS_PASSCODE`).

Public compose continues to use Docker Hub `postgres:…` pins for
dockerhost-home / local development.

### Candidate deploy to `tavi-dev`

After all three internal images publish successfully, the `Deploy candidates to
tavi-dev` job runs on the same `docker-wtg` runner and SSHes to the jump host
configured by repository secrets. It invokes the external
`tavi-dev/update.sh` helper with the short commit id that matches the
Artifactory `sha-<shortsha>` tags (docker metadata short SHA, 7 hex chars).

| Input | Source |
| ----- | ------ |
| SSH private key | secret `TAVI_DEV_SSH_KEY` |
| SSH host | secret `TAVI_DEV_SSH_HOST` (for example `sv4d-jump`) |
| SSH user | secret `TAVI_DEV_SSH_USER` |
| VKS login passcode | secret `VKS_PASSCODE` (exported on the jump host as `PASSCODE` / `VKS_PASSCODE` for `k8s-login`) |
| Remote helper path | optional variable `TAVI_DEV_UPDATE_SCRIPT` (default `/e2open/home/mkronvold/src/tavi-dev/update.sh`) |
| Candidate id | first 7 chars of `github.sha` (no `sha-` prefix) |
| Image digests | workflow artifacts from internal publish, exported as `TAVI_{API,WEB,WORKER}_DIGEST` |

This path targets namespace `tavi-dev` on the non-prod cluster defaults from
`infra/k8s/tavi-dev.defaults.env`. It is intentionally separate from the
immutable release-pin PR used for production promotion. Weekly `refresh-*`
images are not deployed here.

App images still build from public/GitHub-hosted bases today; expanding BSI base
images for `tavi-api`/`web`/`worker` Dockerfiles and Xray policy gates remain
follow-on work. PostgreSQL on tavi-dev is already on the BSI lane.

## Weekly product release

Dependabot runs on its weekly cadence (typically Monday). The product release is a separate Friday workflow so dependency updates can land and soak before a version cut.

1. `Cut weekly release` runs Friday 13:00 UTC (08:00 CDT / 07:00 CST) or on demand.
2. [`scripts/cut-release.mjs`](../scripts/cut-release.mjs) inspects commits since the last `Release x.y.z` commit and the `## Unreleased` changelog section.
3. If there is nothing to ship, the workflow exits successfully without opening a PR.
4. Otherwise it bumps every workspace `package.json` and `packages/config/src/app-version.ts`, folds Unreleased notes into a dated version section, opens `Release x.y.z`, and enables auto-merge.
5. After that PR merges, `Tag release` creates `vx.y.z` and a GitHub Release. Existing `Publish container images` tag handling publishes images and opens the immutable release-pin PR.

Bump rule:

- **patch** by default
- **minor** when Unreleased contains a marked `### Features` or `### Breaking Changes` section
- major remains manual

## Image evidence and version promotion

Every published image receives BuildKit SBOM and provenance attestations.
Public GHCR publication also generates a CycloneDX SBOM and a High/Critical
Trivy report from the exact remote digest for each service, retaining them as
workflow artifacts for 180 days alongside the published digest. Internal
Artifactory publication retains the same digest artifact plus a fail-closed
High/Critical Trivy table report (`internal-<service>-trivy-report`, 180 days)
from the exact `sv4.art` digest.

For a `v*` tag, the workflow downloads the public GHCR digest records and the
internal Artifactory digest records, then uses
[`scripts/update-release-pins.mjs`](../scripts/update-release-pins.mjs) to
create a pull request that updates:

- `infra/docker/compose-prod.images.env` — GHCR `tag@sha256:digest` references
- API, web, and worker deployments in all supported raw Kubernetes variants — `repo.ops.e2open.com/dcops-docker-repo` `tag@sha256:digest` references

The PR is the promotion handoff. Images are always expressed as
`tag@sha256:digest`; candidate `latest` and `refresh-*` tags never alter a
deployment by themselves.

## Trivy container scanning

Trivy scans High and Critical vulnerabilities for locally built candidates on
pull requests and `main`. After a successful weekly refresh it also scans the
published GHCR `latest` images. Findings are separated by SARIF category:

| Service      | Category            |
| ------------ | ------------------- |
| API          | `trivy-api`         |
| Web          | `trivy-web`         |
| Worker       | `trivy-worker`      |
| Filesystem   | `trivy-filesystem`  |

Scan jobs write SARIF artifacts only. A final `Upload Trivy code scanning results`
job downloads every artifact and uploads all categories in one place so GitHub
code scanning never evaluates a pull request while `trivy-api` / `trivy-web` /
`trivy-worker` are still in flight (which produced the “configurations not found”
warning). When image scans are skipped for a non-container PR, that upload job
sends empty placeholder SARIF for the missing image categories so the same
configuration set remains present; required `Scan * image` checks and the
High/Critical enforce step still own the security gate.

Review findings in **GitHub Security > Code scanning alerts**. The workflow
uses `security-events: write`; remote-image scans also use `packages: read`.

Filesystem misconfiguration scanning uses [`trivy.yaml`](../trivy.yaml) and
check data under [`trivy-data/`](../trivy-data/). KSV-0125 (restrict images to
trusted registries) treats `repo.ops.e2open.com` as trusted alongside Trivy's
built-in Azure Container Registry, Amazon ECR, and Google Container Registry
suffixes. Kubernetes app and BSI PostgreSQL pins pull from that Artifactory
host, so they are not untrusted-registry findings. Adding a registry to
`trivy-data/ksv0125.yaml` replaces the check's default list; keep the existing
suffixes when extending it.

### Enforced policy

The scan fails on every High/Critical finding. That fail-closed gate applies
to PR/`main` `trivy-scan.yml` jobs **and** to the private Artifactory lane
(`build-and-publish-internal` and `refresh-internal`). Public GHCR publish
and refresh scans still record High/Critical reports with `exit-code: "0"`;
they do not block GHCR publication. The minimized, digest-pinned
baseline reduced each image from 428 results to 27/28 results; the remaining
unfixed upstream Debian and Prisma CLI findings have individually reviewed,
time-boxed exceptions in [`.trivyignore.yaml`](../.trivyignore.yaml).

First remediate findings through dependency updates, base-image digest updates,
or image-content reduction. Only unavoidable findings may be added to the
exception registry, with:

1. A specific vulnerability `id`
2. An owner and mitigation in `statement`
3. An `expired_at` date

Remove an exception as soon as the upstream fix is published. The three service
scan jobs are required checks on `main`; do not add broad or permanent
suppressions.

## Pull-request expectations

Every pull request must pass:

1. `Validate workspace`
2. All three image build jobs
3. All three Trivy scan jobs
4. New code-scanning alerts
5. SBOM/provenance and the generated release-pin PR for a version-tagged build
