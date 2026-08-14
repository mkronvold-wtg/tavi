# GitHub Setup

This page lists repository settings that support Tavi's lifecycle automation.

## Required repository features

1. Enable GitHub Actions.
2. Enable GitHub Packages access for `GITHUB_TOKEN` so workflows can publish GHCR images.
3. Enable Dependabot alerts and Dependabot security updates.
4. Enable Dependabot version updates from `.github/dependabot.yml`.
5. Enable code scanning so Trivy SARIF findings appear under GitHub Security.
6. Enable auto-merge for the repository if supported Dependabot PRs should merge automatically after required checks pass.

## Workflow permissions

The image publish workflow uses `GITHUB_TOKEN` with:

- `attestations: write`
- `contents: read`
- `id-token: write`
- `packages: write`

The version-release / release-pin job additionally needs:

- `contents: write`
- `pull-requests: write`

The weekly release cut and tag workflows also need:

- `contents: write` (create release branches/tags and GitHub Releases)
- `pull-requests: write` (open and auto-merge the Friday release PR)

Repository settings must allow GitHub Actions to create and approve pull requests so the Friday release PR can enable auto-merge the same way Dependabot does.

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
Require:

1. `Validate workspace`
2. container image build jobs from `Publish container images`
3. `Scan api image`
4. `Scan web image`
5. `Scan worker image`

All supported Dependabot updates, including major updates, wait for the same
required checks before merging. Confirm that Dependabot security updates are
enabled in repository settings as well as version updates from
`.github/dependabot.yml`.

TypeScript major upgrades are ignored in Dependabot until Nest CLI and
`typescript-eslint` officially support TypeScript 7+. Workspace packages pin
`typescript` to the 6.0.x line (`~6.0.2`).

## GHCR package visibility

If the repository or packages are private, deployment hosts need permission to pull:

- `ghcr.io/mkronvold-wtg/tavi-api`
- `ghcr.io/mkronvold-wtg/tavi-web`
- `ghcr.io/mkronvold-wtg/tavi-worker`

Use `docker login ghcr.io` for Docker hosts or an image pull secret for Kubernetes clusters.

## Artifactory publish secrets

Internal image publish jobs on the repository-scoped `docker-wtg` runner log in
to `sv4.art.e2open.com` with repository secrets (not host-local Docker config):

| Secret | Purpose |
| ------ | ------- |
| `ARTIFACTORY_USERNAME` | Artifactory username (often an email identity) |
| `ARTIFACTORY_TOKEN` | Artifactory identity/API token with push to `dcops-docker-repo` |

Set the same two names as **Dependabot secrets** as well
(`gh secret set … --app dependabot`) so `.github/dependabot.yml` can use the
`artifactory-docker` registry when a Docker dependency points at
`sv4.art.e2open.com`.

Rotate the token in GitHub only; workflows pick up the new value on the next run.

## `tavi-dev` candidate deploy secrets

After internal Artifactory publish, CI deploys `sha-*` candidates to non-prod
`tavi-dev` by SSHing from the `docker-wtg` runner to the jump host and running
`update.sh`. Configure these repository secrets before the job can succeed:

| Secret | Purpose |
| ------ | ------- |
| `TAVI_DEV_SSH_KEY` | Private key accepted by the jump host for the deploy user |
| `TAVI_DEV_SSH_HOST` | Jump host hostname (for example `sv4d-jump`) |
| `TAVI_DEV_SSH_USER` | SSH username on the jump host |

Optional repository variable:

| Variable | Purpose | Default |
| -------- | ------- | ------- |
| `TAVI_DEV_UPDATE_SCRIPT` | Absolute path to `update.sh` on the jump host | `/e2open/home/mkronvold/src/tavi-dev/update.sh` |

Cluster-side prerequisites (not stored in GitHub):

1. Jump host can run `update.sh` and reach cluster `sv4d-cops-nonp`.
2. Namespace `tavi-dev` exists with image pull secret `regcred` for
   `repo.ops.e2open.com`.
3. The helper's Tavi source checkout stays usable for manifest generation.

This automation does not deploy weekly `refresh-*` tags and does not modify
checked-in production pins.
