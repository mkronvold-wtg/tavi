# Continuous Integration and Security Scanning

Tavi uses GitHub Actions to validate code, publish attestable container images,
scan artifacts, and automate reviewed dependency maintenance. The supported
Node baseline is 26, declared in `.node-version` and `package.json`.

See [`LCM.md`](./LCM.md) for promotion and rollback, and
[`GITHUB-SETUP.md`](./GITHUB-SETUP.md) for required repository settings.

## Workflows

| Workflow                        | When it runs                                               | What it does                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Publish container images`      | Every PR, `main`, `v*` tags, or manual dispatch            | Detects container-relevant PR changes; validates and builds API/web/worker images only when needed, publishing public GHCR images and internal Artifactory images from the trusted `docker-wtg` runner outside PRs. A `v*` tag opens a release-pin PR. |
| `Scan container images`         | Every PR, `main`, manual dispatch, or a successful refresh | Detects container-relevant PR changes; scans applicable API, web, and worker images with Trivy and uploads High/Critical SARIF findings to GitHub code scanning.                                                                                       |
| `Refresh container images`      | Mondays at 08:17 UTC or manual dispatch                    | Re-validates, tests, rebuilds, attests, and scans candidate `latest` and timestamped refresh images; also refreshes internal Artifactory images from `docker-wtg`. It does not deploy them.                                                            |
| `Auto-merge dependency updates` | Dependabot PR events                                       | Approves supported patch/minor npm, GitHub Actions, and Docker updates after required checks succeed. Major updates remain manual.                                                                                                                     |

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
`latest`, ref, and SHA tag policy as public images. The runner's host-local
Docker configuration supplies the Artifactory credential; no registry
credential is stored in the workflow.

The `build-and-publish-internal` job is gated to
`github.event_name == 'push'` limited to `refs/heads/main` or
`refs/tags/v*`. Neither `workflow_dispatch` nor any other branch ref can
reach it; the checkout step is unreachable for those event types. Scheduled
refreshes enforce the same default-branch guard.

The internal matrix is serialized because Tavi currently has one matching
runner. GitHub-hosted runners continue to build and publish public GHCR
images, while Kubernetes deployments consume the internal Artifactory service
through `repo.ops.e2open.com`.

This lane establishes internal publication only. BSI base-image selection and
Xray policy enforcement remain separate migration work.

## Image evidence and version promotion

Every published image receives BuildKit SBOM and provenance attestations.
Public GHCR publication also generates a CycloneDX SBOM and a High/Critical
Trivy report from the exact remote digest for each service, retaining them as
workflow artifacts for 180 days alongside the published digest. Internal
Artifactory publication retains its immutable digest as a workflow artifact.

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

### Enforced policy

The scan fails on every High/Critical finding. The minimized, digest-pinned
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
