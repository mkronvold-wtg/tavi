# GitHub Setup

This page lists repository settings that support Tavi's lifecycle automation.

## Required repository features

1. Enable GitHub Actions.
2. Enable GitHub Packages access for `GITHUB_TOKEN` so workflows can publish GHCR images.
3. Enable Dependabot alerts and Dependabot security updates.
4. Enable Dependabot version updates from `.github/dependabot.yml`.
5. Enable code scanning so Trivy SARIF findings appear under GitHub Security.
6. Enable auto-merge for the repository if patch/minor Dependabot PRs should merge automatically after required checks pass.

## Workflow permissions

The image publish workflow uses `GITHUB_TOKEN` with:

- `attestations: write`
- `contents: read`
- `id-token: write`
- `packages: write`

The version-release job additionally needs:

- `contents: write`
- `pull-requests: write`

The Trivy scanning workflow uses:

- `contents: read`
- `packages: read`
- `security-events: write`

The Dependabot auto-merge workflow uses `pull_request_target` and does not check out PR code. It needs:

- `contents: write`
- `pull-requests: write`

Repository settings must allow GitHub Actions to create and approve pull requests for the approval step to work.

## Branch protection

Use branch protection on `main` so auto-merge waits for required checks.
Require these checks immediately:

1. `Validate workspace`
2. container image build jobs from `Publish container images`

After the Trivy baseline is remediated or time-boxed and the workflow exit code
is made blocking, also require:

1. `Scan api image`
2. `Scan web image`
3. `Scan worker image`

Keep major dependency updates manual even when auto-merge is enabled. Confirm
that Dependabot security updates are enabled in repository settings as well as
version updates from `.github/dependabot.yml`.

## GHCR package visibility

If the repository or packages are private, deployment hosts need permission to pull:

- `ghcr.io/mkronvold/tavi-api`
- `ghcr.io/mkronvold/tavi-web`
- `ghcr.io/mkronvold/tavi-worker`

Use `docker login ghcr.io` for Docker hosts or an image pull secret for Kubernetes clusters.
