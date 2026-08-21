# Changelog

This file records the versions released in repository history. Section headings include the version, release commit date, and short release commit SHA currently present in git history.

Weekly automation folds `## Unreleased` into a versioned section every Friday.
Use optional markers under Unreleased to control the bump:

- `### Features` or `### Breaking Changes` → minor bump
- otherwise → patch bump

## Unreleased

- Purged unused `gzip`, `libacl1`, and `tar` from API, web, and worker runtime images to close unfixed Debian CVEs without installing replacements.
- Time-boxed Trivy ignore for CVE-2026-5928 (`libc6`/`libc-bin` in Node 26 bookworm-slim; no upstream fixed version).
- Time-boxed Trivy ignore for CVE-2019-1010025 (glibc ASLR-bypass; Debian vendor position is not a vulnerability).
- Time-boxed Trivy ignore for CVE-2026-5450 (`libc6`/`libc-bin` 2.36-9+deb12u14 in Node 26 bookworm-slim; no upstream fixed version).
- Configured Trivy KSV-0125 to treat `repo.ops.e2open.com` as a trusted registry for Kubernetes image pins.
- Wrote web `runtime-config.js` to `/tmp` via a build-time dist symlink so Kubernetes `readOnlyRootFilesystem` no longer crash-loops the web container.
- Installed `libssl3` in the API runtime image so Prisma `migrate deploy` can load `schema-engine` (slim has no `libssl.so.3`; the `openssl` CLI is not required).
- Added a time-boxed Trivy ignore for CVE-2026-6238 (glibc) until Debian bookworm publishes a fixed libc6/libc-bin.

## 0.9.23 - 2026-08-21 - sha-c0f5c80

- Run tavi-dev / internal-db Postgres on Bitnami Secure Images from Artifactory (`sv4.art` source / `repo.ops` pull), with `infra/images/bsi-postgresql.pin.json`, `Refresh BSI images` candidate refresh + deploy, while public compose keeps Docker Hub Postgres.
- Pass jump-host `k8s-login` passcode from repository secret `VKS_PASSCODE` (as `PASSCODE`) during automated `tavi-dev` candidate deploys.
- Split Artifactory credentials into rotatable `ARTIFACTORY_RW_TOKEN` (push via `sv4.art` on `docker-wtg`) and `ARTIFACTORY_RO_TOKEN` (Dependabot pulls on `sv4.art` / `repo.ops` CNAMEs), sharing `ARTIFACTORY_USERNAME`.
- Fixed main/tag internal publish so a skipped PR-only change-detection job no longer suppresses the Artifactory and `tavi-dev` deploy path.
- Fixed Dependabot Docker updates for Kubernetes manifests: ignore release-pinned `tavi-*` images and use the read-only Artifactory token for registry auth.
- After internal Artifactory `sha-*` image publish, automatically deploy those candidates to non-prod `tavi-dev` by SSHing from the `docker-wtg` runner to the jump host and running external `update.sh`.
- Documented the `tavi-dev` candidate channel and required `TAVI_DEV_SSH_*` repository secrets.
- Added standardized light and dark workspace themes with aligned application color tokens.
- Added Trivy container-image and repository-configuration scanning with GitHub code-scanning SARIF reports, and hardened required CI checks so they run on every pull request.
- Hardened container publishing and deployment workflows with a trusted internal-registry push gate, resilient image-cache exports, and immutable release pins for Docker Compose and Kubernetes.
- Fixed deployed API and worker images to retain the generated Prisma client, and added Docker host helper scripts for safe stack startup, shutdown, and GHCR image auto-updates.
- Moved Kubernetes deployment image pins to the internal Artifactory registry and documented the required namespace-local `regcred` image-pull secret.
- Replaced the vulnerable SheetJS browser dependency while preserving workspace XLSX export and local-account CSV import behavior.
- Patched security-sensitive transitive dependencies, including Fastify URI parsing, `js-yaml`, `brace-expansion`, and `nanoid`.

## 0.9.22 - 2026-06-12 - sha-a229b90

- Included the active workspace Search value in saved-view create and update payloads.
- Added a compact Current Search readout to the View panel so users can see what search text will be captured before saving a view.
- Added regression coverage for creating and updating saved views with the current Search value.

## 0.9.21 - 2026-06-10 - sha-39daeed

- Added short release SHAs to historical changelog section headings and removed duplicate release-commit bullets.
- Closed the User Profile panel automatically when opening Personal ToDo or User History from it.
- Closed the Settings panel automatically when opening Backups, Retention, Import/Export, Local Accounts, Audit logins, Audit notifications, or Audit changes while keeping the selected panel open.

## 0.9.20 - 2026-06-04 - sha-2aa0a4e

- Highlighted matching project, task, reference, and note text while workspace search is active.
- Opened projects automatically when search matches one of their tasks and scrolled the browser to the first matching task row.
- Kept matching hidden done/canceled tasks visible during search reveal so the scroll target is not hidden by the per-project done filter.

## 0.9.19 - 2026-05-22 - sha-0b62951

- Added a shared compact modal dialog foundation for workspace edit and confirmation flows.
- Converted project, task, Personal ToDo, user profile, and Local Accounts edit flows from dense inline editors to modal dialogs while preserving existing save, delete, conversion, movement, and role-based behavior.
- Replaced retention prune and backup restore/delete/clear browser confirmations with typed modal confirmations.
- Updated web regression coverage for the modalized edit and admin workflows.

## 0.9.18 - 2026-05-21 - sha-60badf1

- Updated Prisma to 7.x with CLI datasource configuration in `prisma.config.ts` and PostgreSQL driver-adapter client initialization for the API and worker.
- Cleaned up lint issues surfaced by dependency refreshes so clean workspaces pass the current API and web lint configurations.
- Updated the Dockerfiles to install the pinned pnpm version directly and relink workspace dependencies after source copies so Node base images without Corepack still build.
- Fixed container image workflow validation so clean GitHub runners build shared package artifacts and generate the Prisma client before API lint and typecheck.
- Added build SHA and build date metadata to the Settings panel and passed that metadata through the image build workflow.

## 0.9.17 - 2026-05-13 - sha-0e5e371

- Added Revu-style lifecycle automation for Tavi container images, including Dependabot configuration, safe patch/minor dependency auto-merge, weekly GHCR image refreshes, Kubernetes pull-policy updates for refreshed `latest` images, and lifecycle documentation.

## 0.9.16 - 2026-05-08 - sha-dcd75a4

- Ordered priority groups as `high`, `medium`, `low`, then `none` instead of relying on alphabetical or data insertion order.

## 0.9.15 - 2026-05-08 - sha-544fed0

- Moved `Not viewed` and `Mark all viewed` into the `View` panel so the top workspace controls stay focused on search, grouping, and core actions.
- Scrolled project and task history panels into view automatically when their `History` actions are selected.

## 0.9.14 - 2026-05-07 - sha-8c44fb0

- Added task-level viewed-state behavior, including the `Not viewed` workspace filter, live polling for collaborative updates, and clearer project/task highlight colors.
- Updated workspace filtering and density behavior so project `Status` filters remain project-level, `Assignee` filters include project owners and unassigned work, and the per-project `D` toggle hides both done and cancelled tasks.
- Cleaned up task/project flow details for empty `Unassigned` projects and opened a review follow-up draft when a task moves into `Review`.
- Refreshed notification branding so outbound emails use an email-safe Tavi HTML wrapper and logo.

## 0.9.13 - 2026-05-01 - sha-577a39e

- Fixed local-account delete dependency checks so archived projects/tasks no longer make accounts look blocked by invisible assignments.
- Updated example workspace resets to use the fake default local accounts instead of arbitrary test users, creating missing defaults when needed.
- Ignored `.tmux*` workspace layout files.

## 0.9.12 - 2026-05-01 - sha-407da9a

- Added per-user viewed-change tracking for projects and tasks, including subtle unviewed highlights, actor-aware audit-event detection, collapse-to-mark-viewed behavior, and a toolbar `Mark all viewed` action.
- Moved `Personal ToDo` into the User Profile panel and kept the top workspace toolbar focused on shared-workspace review actions.
- Added backup/restore coverage, Prisma persistence, API endpoints, web regression coverage, and documentation for viewed-state behavior.
- Added Kubernetes example NetworkPolicies that keep PostgreSQL reachable only from the Tavi API and worker pods, with deployment docs explaining when and how to apply them.

## 0.9.11 - 2026-04-23 - sha-d23803b

- Added `infra/docker/up.sh` and `infra/docker/down.sh` as convenience wrappers for the published-image `compose-prod` local runtime.
- Made the new Docker helper scripts resolve their own directory before invoking Compose so they work reliably when launched from anywhere in the repo.

## 0.9.10 - 2026-04-22 - sha-e2d146b

- Fixed the Personal ToDo white-screen crash in the real browser drag flow by computing drop position before React clears the drag event target during state updates.
- Kept the Personal ToDo drag path aligned with the working project-task reorder behavior and added regression coverage for the live dragover/drop failure mode.

## 0.9.9 - 2026-04-22 - sha-66f61ae

- Renamed local-account `Reset Defaults` to `Restore Defaults` and added an admin-only `Clear all local accounts` action that requires the current password and preserves the signed-in account plus guest access.
- Fixed the Personal ToDo drag-and-drop reorder flow so browser-cleared drag state no longer leaves the page in a white-screen crash state.
- Updated assignee filtering so matching projects stay visible with their full task list instead of hiding sibling tasks that do not match the selected assignee.

## 0.9.8 - 2026-04-21 - sha-a8c8275

- Added guest access for local auth, including a login-screen `View as guest` path that auto-creates or repairs the dedicated `guest@tavi.local` viewer account.
- Added an admin `Guest Access` toggle in Settings and persisted the workspace-wide flag in `EmailSettings` with a Prisma migration.
- Hid guest-only restricted UI surfaces and blocked guest access to saved views, Personal ToDo, profile edits, and related user settings APIs so guest sessions stay read-only.

## 0.9.7 - 2026-04-21 - sha-226f17a

- Redacted embedded SMTP passwords anywhere `SMTP_URL` reaches the web UI so admin diagnostics never display the raw secret.
- Masked SMTP credentials in test-email error banners, audit-notification rows, and copied notification-flow text while leaving the rest of the connection string visible for troubleshooting.

## 0.9.6 - 2026-04-21 - sha-b259a78

- Consolidated outbound SMTP configuration around a single `SMTP_URL` connection string that now carries protocol, host, port, and optional credentials.
- Updated the API and worker mail transports to parse SMTP authentication directly from `SMTP_URL` and aligned the test-email diagnostics with the new configuration model.
- Moved Kubernetes SMTP examples to secret-backed `SMTP_URL` values and refreshed the Docker runtime examples and docs to match the new secret-based SMTP wiring.

## 0.9.5 - 2026-04-21 - sha-8f475ef

- Added a pinned `cloudnative-pg-install/` kustomization for the `infra/k8s/k8s-with-replicas-and-internal-ha-db/` variant and a root HA stack `kustomization.yaml` so CloudNativePG setup and the rest of the HA manifests are applied in the documented two-step flow.
- Updated Kubernetes deployment documentation to explain the CNPG operator install order, verification commands, and the cluster-scoped permissions required by the HA variant.
- Added project-search links to notification email bodies and synced the worker runtime env wiring so notification emails use the configured `SMTP_FROM`, `SMTP_URL`, and `TAVI_HOME_URL` values in Docker and Kubernetes deployments.

## 0.9.4 - 2026-04-20 - sha-fc1cf2d

- Buffered non-admin project and task notifications so users receive one hourly summary email, or one daily digest if they prefer daily delivery.
- Replaced the profile `Daily Digest` toggle with a `Notification Rate` selector and restricted daily send times to hourly values.
- Normalized legacy digest times in auth and backup flows, and filtered internal batched notification records out of the admin audit-notifications view.
## 0.9.3 - 2026-04-20 - sha-e9d79ab

- Added `Demo` and `Review` workflow statuses, renamed `ToDo` to `Not Started`, and updated derived project-status rollups to match the new status model.
- Updated workspace filters, imports, saved views, and rollup behavior to support the new project and task statuses.
- Added `docs/DEVGUIDE.md` and refreshed the workspace, design, and architecture documentation around the updated status model.
## 0.9.2 - 2026-04-20 - sha-3f51ef2

- Refreshed product and operator documentation across architecture, design, settings, notifications, import/export, branding, and workspace guides.
- Consolidated the written guidance shipped alongside the current 0.9.x feature set.
## 0.9.1 - 2026-04-20 - sha-df8b27f

- Polished the settings experience by tightening the audit-notification expander, removing duplicate email controls from audit changes, and refining CSV import panel copy and spacing.
- Made new-task notes multiline and expandable in the inline workspace add-task flow.
- Added corresponding web and audit test coverage for the settings and import/export refinements.
## 0.9.0 - 2026-04-20 - sha-e268952

- Added the retention settings panel for backup, login-log, change-log, and notification retention, including estimated sizes and prune-now actions.
- Added server-backed user configuration with browser sync, reset support, backup/restore coverage, and personal to-do retention preferences.
- Added forgot-password email reset, workspace search clear, project search-link copy, and additional workspace reset and rollup polish.
## 0.3.8 - 2026-04-18 - sha-0f69465

- Expanded the prebuilt Docker runtime documentation and added `infra/docker/compose-prod.env.example` for published-image local runs.
- Refined the `compose-prod` workflow and supporting documentation for image-based deployments.
## 0.3.7 - 2026-04-18 - sha-e747d23

- Split the source-mounted development stack and published-image runtime into `compose-dev.yaml` and `compose-prod.yaml`.
- Tightened local-account administration behavior and updated scripts and deployment docs to match the new compose layout.
## 0.3.6 - 2026-04-18 - sha-ac85100

- Replaced the external local-auth seed script with an API-managed bootstrap service for default local users.
- Added bootstrap-focused API tests and simplified the deployment and local-account documentation around startup seeding.
## 0.3.5 - 2026-04-18 - sha-5d491a3

- Added one-shot local admin seeding helpers for Docker and Kubernetes startup flows.
- Documented seeded local account setup and bootstrap behavior for source and deployed environments.
## 0.3.4 - 2026-04-17 - sha-200d9e7

- Switched the web image to a static production-serving path with `serve-dist.mjs`.
- Updated Docker, Kubernetes, and README guidance for the production web runtime.
## 0.3.3 - 2026-04-17 - sha-98f1aa5

- Aligned package and container version metadata across the monorepo after the 0.3.2 deployment changes.
- Refreshed the Docker build files to ship the matching release version consistently.
## 0.3.2 - 2026-04-17 - sha-a5daed8

- Hardened Docker and Kubernetes manifests for the API, web, and worker services.
- Improved rendered markdown handling for notes and tightened notification, backup, and personal to-do behavior around the deployment updates.
## 0.3.1 - 2026-04-16 - sha-5c2f2ad

- Added the Personal ToDo experience across the API and web app, including reminders, settings, and workspace integration.
- Expanded local account administration, notification behavior, and workspace polish, and refreshed the related documentation.
## 0.3.0 - 2026-04-13 - sha-da1290f

- Initial shipped Tavi release with project and task management, CSV imports, audit history, local account administration, saved views, and broader UX polish.
- Established the first documented release baseline for the repository.
