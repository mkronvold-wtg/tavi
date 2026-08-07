# Goal: Artifactory Kubernetes migration

## User Request

Implement and validate the Artifactory Kubernetes migration, then create a PR
targeting `main` without merging it. Reconcile the supplied migration base with
`origin/main`, preserving main's corrected GHCR owner references and current CI
documentation, plus namespace-local `regcred` guidance. Kubernetes deployments
must pull Artifactory images from `repo.ops.e2open.com/dcops-docker-repo`;
Docker Compose and public images must remain on GHCR. CI publishes internal
images to `sv4.art.e2open.com/dcops-docker-repo`. Credentialed internal
publication must be limited to trusted default-branch pushes and version tags.

## Refined Goal

Rebase the migration branch onto the current `origin/main` and make the
registry split explicit and reliable. Public GHCR publication, security
evidence, and Compose release pins remain intact; trusted CI events also
publish API, web, and worker images to Artifactory and retain their digest
artifacts. Tagged releases create pinning PRs that use GHCR `tag@digest`
references for Compose and Artifactory `tag@digest` references for every
Kubernetes deployment variant, all of which use the namespace-local `regcred`
pull secret.

## Acceptance Criteria

- [ ] The branch is rebased on `origin/main`; its changes retain main's
      corrected GHCR owner handling and current CI documentation while omitting
      unrelated migration-branch history and changes.
- [ ] The credentialed `docker-wtg` runner can publish internal API, web, and
      worker images only for a push to the default branch or a version tag.
      Neither `workflow_dispatch` nor arbitrary branch refs can reach it, and
      scheduled refreshes remain limited to the default branch.
- [ ] Public GHCR image jobs, artifacts, scans, and full-validation behavior
      survive unchanged in purpose; condition or path detection failures do not
      become success-shaped skips.
- [ ] Internal API, web, and worker images publish to
      `sv4.art.e2open.com/dcops-docker-repo` and upload retained internal
      digest artifacts.
- [ ] Release pinning downloads and consumes both public and internal digest
      artifacts, updating Compose only with GHCR `tag@sha256:digest` references
      and every Kubernetes deployment variant only with
      `repo.ops.e2open.com/dcops-docker-repo` `tag@sha256:digest` references.
- [ ] Every Kubernetes application deployment specifies `imagePullSecrets:
      - name: regcred`, and documentation precisely explains namespace-local
      regcred creation and use without adding credentials to the repository.
- [ ] Relevant existing formatting, workflow syntax/static checks, and
      targeted tests pass without installing dependencies unless a validation
      command proves they are missing.
- [ ] A clean PR targets `main`, is not merged, and reports its number, final
      commit, validation results, and blockers to the parent session.

## Scope Boundaries

**In scope:**
- Git reconciliation, GitHub Actions workflow safety and release pinning,
  release-pin script support, Kubernetes manifests, and directly related docs.
- Creating and monitoring a PR without merging it.

**Out of scope:**
- Adding registry credentials or secrets to the repository.
- Changing Docker Compose away from public GHCR images.
- Altering unrelated application behavior, dependencies, or infrastructure.

## Applicable Project Conventions

**Quality gate command:**
- `pnpm format`
- Targeted existing workflow/static checks and relevant tests identified in the
  repository; package scripts also provide `pnpm lint`, `pnpm typecheck`, and
  `pnpm test`.

**Commit convention:**
- Conventional commits are observed; release pins use
  `chore(release): pin <version> images`.
- Builder commit: `type(scope): [B] description`, no more than 72 characters.
- Assisted-by trailer required: `Assisted-by: Claude:Sonnet-4.6`

**Guidelines:**
- No `AGENTS.md`, `CONSTITUTION.md`, `.agents/guidelines/`, or
  `.github/guidelines/` exists.

**Rules:**
- Keep existing GHCR publication, CycloneDX/SBOM evidence, Trivy scanning, and
  digest artifact retention.
- Do not weaken security controls or let untrusted refs execute on the
  credentialed self-hosted runner.
