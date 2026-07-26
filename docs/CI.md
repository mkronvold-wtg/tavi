# Continuous Integration and Security Scanning

Tavi uses GitHub Actions to validate source changes, build container images, scan
published artifacts, and automate safe dependency updates. This document covers
the CI behavior and Security tab integration. See [`LCM.md`](./LCM.md) for image
refresh cadence, image tags, deployment consumption, and lifecycle maintenance.

## Workflows

| Workflow                        | When it runs                                                                             | What it does                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Publish container images`      | Relevant pull requests, `main` and version-tag pushes, or manual dispatch                | Installs dependencies, generates required artifacts, lints, typechecks, and builds the API, web, and worker images. It pushes images only outside pull requests. |
| `Scan container images`         | Relevant pull requests and `main` pushes, manual dispatch, or a successful image refresh | Scans API, web, and worker images with Trivy and uploads SARIF findings to GitHub code scanning.                                                                 |
| `Refresh container images`      | Every Monday at 08:17 UTC or manual dispatch                                             | Validates the workspace, rebuilds images without cache using current base layers, and publishes `latest` plus a timestamped refresh tag.                         |
| `Auto-merge dependency updates` | Dependabot pull-request events                                                           | Approves and enables auto-merge for supported patch and minor updates. Major updates remain manual.                                                              |

The workflow definitions are under [`.github/workflows/`](../.github/workflows/).

## Validation and image builds

`Publish container images` and `Refresh container images` run the same workspace
validation before building images:

1. Install dependencies with `corepack pnpm install --frozen-lockfile`.
2. Build `@tavi/config` and `@tavi/schemas`.
3. Generate the API Prisma client.
4. Run `corepack pnpm lint`.
5. Run `corepack pnpm typecheck`.

The API, web, and worker images are then built independently, so a failure is
reported against the affected service. Pull requests build images without
publishing them. Image tags and deployment rollout procedures are documented in
[`LCM.md`](./LCM.md).

The current workflows do not run the web Vitest suite. Run it locally with:

```bash
corepack pnpm --filter @tavi/config build
corepack pnpm --filter @tavi/schemas build
corepack pnpm --filter @tavi/web test
```

## Trivy container scanning

`Scan container images` scans `HIGH` and `CRITICAL` vulnerabilities in the API,
web, and worker images. It scans locally built candidate images for pull
requests and `main` pushes. After a successful image refresh, it scans the
published GHCR `latest` images instead.

Each service uploads a separate SARIF category:

| Service | GitHub code-scanning category |
| ------- | ----------------------------- |
| API     | `trivy-api`                   |
| Web     | `trivy-web`                   |
| Worker  | `trivy-worker`                |

Review findings in **GitHub Security > Code scanning alerts**. The scan uses
`security-events: write`; it requires no additional secret. The
published-image scan also uses `packages: read` to pull images from GHCR.

### Report-only policy

The scan is intentionally report-only while the alert baseline is established:

- Findings do not fail the scan job.
- Scan execution and SARIF upload failures do fail the job.
- Only `HIGH` and `CRITICAL` findings are included in SARIF.

Do not make vulnerability findings blocking until the initial alert baseline has
been reviewed. When a gate is adopted, document the threshold and exception
review policy in this file and update the workflow deliberately.

### Accepted-risk exceptions

[`.trivyignore.yaml`](../.trivyignore.yaml) is the single, version-controlled
registry for temporary Trivy exceptions. Do not add an exception without:

1. A specific vulnerability or finding `id`.
2. A short `statement` explaining why the risk is accepted.
3. An `expired_at` date so the exception is automatically reconsidered.

For example:

```yaml
vulnerabilities:
  - id: CVE-2026-12345
    statement: Fixed base image is not yet available; refresh after the vendor release.
    expired_at: 2026-09-01
```

Remove the entry as soon as the finding is remediated. The refresh scan checks
out the exception policy associated with the refreshed source revision, keeping
the policy and image lifecycle event auditable.

## Pull-request expectations

For source, dependency, Dockerfile, or workflow changes that match the workflow
path filters, review:

1. `Validate workspace`.
2. The three `Build <service> image` jobs.
3. The three `Scan <service> image` jobs.
4. Any new or changed code-scanning alerts.

Use [`GITHUB-SETUP.md`](./GITHUB-SETUP.md) to configure the required repository
features, workflow permissions, and recommended required checks.
