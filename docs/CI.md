# Continuous Integration and Security Scanning

Tavi uses GitHub Actions to validate code, publish attestable container images,
scan artifacts, and automate reviewed dependency maintenance. The supported
Node baseline is 26, declared in `.node-version` and `package.json`.

See [`LCM.md`](./LCM.md) for promotion and rollback, and
[`GITHUB-SETUP.md`](./GITHUB-SETUP.md) for required repository settings.

## Workflows

| Workflow                        | When it runs                                               | What it does                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Publish container images`      | Every PR, `main`, `v*` tags, or manual dispatch            | Validates and tests the workspace, builds API/web/worker images, and publishes immutable evidence outside PRs. A `v*` tag opens a release-pin PR. |
| `Scan container images`         | Every PR, `main`, manual dispatch, or a successful refresh | Runs Trivy for API, web, and worker images and uploads High/Critical SARIF findings to GitHub code scanning.                                      |
| `Refresh container images`      | Mondays at 08:17 UTC or manual dispatch                    | Re-validates, tests, rebuilds, attests, and scans candidate `latest` and timestamped refresh images. It does not deploy them.                     |
| `Auto-merge dependency updates` | Dependabot PR events                                       | Approves supported patch/minor npm, GitHub Actions, and Docker updates after required checks succeed. Major updates remain manual.                |

## Validation

The publish and refresh workflows run:

1. `corepack pnpm install --frozen-lockfile`
2. Builds for `@tavi/config` and `@tavi/schemas`
3. API Prisma client generation
4. `corepack pnpm lint`
5. `corepack pnpm typecheck`
6. `corepack pnpm test`

Image builds are independent per service. Every pull request builds candidate
images without publishing because these job names are required checks on
`main`. Run the same root commands locally with Node 26 before opening a
change.

## Image evidence and version promotion

Every published image receives BuildKit SBOM and provenance attestations. The
workflow also generates a CycloneDX SBOM and a High/Critical Trivy report from
the exact remote digest for each service, retaining them as workflow artifacts
for 180 days alongside the published digest.

For a `v*` tag, the workflow downloads those three digest records and uses
[`scripts/update-release-pins.mjs`](../scripts/update-release-pins.mjs) to
create a pull request that updates:

- `infra/docker/compose-prod.images.env`
- API, web, and worker deployments in all supported raw Kubernetes variants

The PR is the promotion handoff. Images are always expressed as
`tag@sha256:digest`; candidate `latest` and `refresh-*` tags never alter a
deployment by themselves.

## Trivy container scanning

Trivy scans High and Critical vulnerabilities for locally built candidates on
pull requests and `main`. After a successful weekly refresh it also scans the
published GHCR `latest` images. Findings are separated by SARIF category:

| Service | Category       |
| ------- | -------------- |
| API     | `trivy-api`    |
| Web     | `trivy-web`    |
| Worker  | `trivy-worker` |

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
