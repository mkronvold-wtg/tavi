# Dependency Churn and Security-Maintenance Audit

**Prepared:** 2026-09-02  
**Repositories examined:** `mkronvold-wtg/tavi`, `mkronvold-wtg/revio`, and
`mkronvold-wtg/content-viewer`

## 1. Executive summary

- Tavi's `npm-all` group made one Dependabot PR (#112) contain **23** updates;
  that creates a large test and rollback surface for an otherwise routine
  weekly change.
- Content Viewer has the inverse problem: it has **seven** individual,
  same-day Dependabot PRs (#34-#40), including five GitHub Action/base-image
  updates. It needs grouping, not more automation.
- Revio is closest to the desired npm model: two weekly groups by dependency
  class (#27 and #28). Its GitHub Actions and Docker lanes remain ungrouped,
  and the current merge workflow can squash-merge any Dependabot update after
  CI, including a major update.
- All three repositories already target Node 26. Standardize that version and
  use Corepack plus the checked-in package-manager version for pnpm
  repositories.
- Tavi has six open runtime, transitive Dependabot alerts. Four `fast-uri`
  high alerts are fixed by `4.1.3`, but the root override pins `4.1.2`;
  `@nestjs/platform-fastify>fastify` also pins an alerting `5.11.0`.
- Tavi's `mysql2@3.15.3` is a high-severity runtime transitive dependency with
  a `3.22.0` fix. It should be traced and remediated in the same narrowly
  scoped security PR rather than deferred to a broad update group.
- Dependabot alerts are disabled for Revio, leaving the Trivy/SARIF
  report-first scan as the only visible dependency-vulnerability signal.
- Content Viewer has no open Dependabot alerts through the API, and it has
  useful dependency-review and Trivy policy workflows. Grouping updates will
  preserve that posture while materially reducing PR volume.
- The first two-week changes are configuration-only, except for Tavi's
  security override update and regenerated lockfile. They avoid framework,
  Node, and package-manager major migrations.
- Do not move to a monorepo. Tavi and Revio already have independent pnpm
  workspaces; Content Viewer has only two direct packages and gains no
  demonstrated benefit from a migration.

## 2. Repository findings

### Tavi

| Area | Current evidence |
| --- | --- |
| Runtime and platform | Node `>=26 <27` (`.node-version`: `26`), pnpm `10.33.0`, workspace lockfile v9 |
| Web | React/React DOM `^19.2.8`, React Router `^7.18.2`, React Query `^5.102.0`, Vite `^8.2.2`, Vitest `^4.1.11` |
| API | NestJS `^11.1.29`, Fastify `5.12.1`, Prisma `^7.9.1`, Jest `^30.4.2` |
| Tooling | TypeScript `~6.0.2`, ESLint `^10.9.0`, `typescript-eslint` `^8.67.0`, Prettier `^3.9.6` |
| Open update pattern | #112 groups 23 npm updates; #111 is a Docker Node digest update |

**Ten most critical direct dependencies**

| Package | Declared version | Why it is critical |
| --- | --- | --- |
| `@nestjs/platform-fastify` | `^11.1.29` | Public API transport and Fastify version resolution |
| `fastify` | `5.12.1` | HTTP request parsing, routing, and proxy trust |
| `@nestjs/core` / `@nestjs/common` | `^11.1.29` | API framework runtime |
| `@prisma/client` | `^7.9.1` | Database access at runtime |
| `@prisma/adapter-pg` | `^7.9.1` | PostgreSQL database adapter |
| `react` / `react-dom` | `^19.2.8` | Web application runtime |
| `react-router-dom` | `^7.18.2` | Client routing and authorization boundaries |
| `@tanstack/react-query` | `^5.102.0` | Client data consistency and cache invalidation |
| `zod` | `^4.4.3` | Shared API and import validation |
| `nodemailer` | `^9.0.5` | Outbound email delivery |

**Duplicates and alignment.** `@tavi/config` and `@tavi/schemas` are correctly
shared internally. Keep `zod` in `@tavi/schemas` as the validation owner. Do
not add a second web test runner: the existing split of Vitest (web) and Jest
(Nest API) is framework-appropriate. `csv-parse`, `nodemailer`, and
`prom-client` are intentionally duplicated in the API and worker because both
runtime images use them; extracting them would add a release surface without
reducing external dependency count.

**Runtime and lockfile actions.**

- Keep `prisma` in `dependencies` until the production image/migration
  workflow proves it is not needed after installation. Moving it now risks
  breaking `prisma generate` or deploy-time migration commands.
- The root has no direct production dependency to remove safely from manifest
  evidence alone. Do not move `dotenv` or `nodemailer` without tracing their
  production imports.
- The v9 `pnpm-lock.yaml` is appropriate for pnpm 10. Its hygiene defect is
  security overrides that intentionally resolve to vulnerable versions:
  `fast-uri@3.1.4 -> 3.1.5`, `fast-uri@4.1.1 -> 4.1.2`, and
  `@nestjs/platform-fastify>fastify -> 5.11.0`.

**Pipeline and security concerns.** `automerge-dependencies.yml` enables
auto-merge for every npm, GitHub Actions, and Docker update type; it does not
limit major updates. Its `pull_request_target` job does not check out PR code,
which is good, but it still needs a patch-only policy. The Trivy workflow
enforces high/critical image findings, but dependency alerts remain separately
open and must be treated as a release gate.

### Revio

| Area | Current evidence |
| --- | --- |
| Runtime and platform | `.nvmrc`: `26`, Node `26.x`, pnpm `10.33.0`, workspace lockfile v9 |
| Web | React/React DOM `^19.2.7`, Vite `^8.2.2`, Vitest `^4.1.11` |
| API | Express `^5.2.1`, Prisma/client `6.19.3`, Zod `4.4.3` |
| Tooling | TypeScript `~7.0.2`, Oxlint `^1.79.0`, Prettier `^3.9.6`, Turbo `^2.10.11` |
| Open update pattern | #27 has 2 production minor/patch updates; #28 has 5 development minor/patch updates |

**Ten most critical direct dependencies**

| Package | Declared version | Why it is critical |
| --- | --- | --- |
| `express` | `^5.2.1` | Public API routing and middleware |
| `@prisma/client` | `6.19.3` | Database access runtime |
| `prisma` | `6.19.3` | Client generation and migration tooling |
| `zod` | `4.4.3` / `^4.4.3` | API contracts and validation |
| `react` / `react-dom` | `^19.2.7` | Web application runtime |
| `@dnd-kit/core` | `^6.3.1` | Planner drag-and-drop behavior |
| `date-fns` | `^4.4.0` | Date calculation and display |
| `papaparse` | `^5.6.0` / `5.6.0` | CSV import/export parsing |
| `read-excel-file` | `9.3.10` | Spreadsheet import parsing |
| `write-excel-file` | `4.1.1` | Spreadsheet export |

**Duplicates and alignment.** `papaparse`, `write-excel-file`, and `zod` occur
in both applications. The import/export and validation rules should be moved
only when a proven shared contract needs them; otherwise, preserve the current
small `@revio/contracts` package. Revio and Tavi should share the pnpm 10,
Prettier 3, Vite 8, Vitest 4, and React 19 update lanes. Keep Oxlint as a
Revio-specific choice rather than adding ESLint solely for consistency.

**Runtime and lockfile actions.**

- `prisma` is correctly a development dependency in `apps/api`; retain it
  there while confirming the deployment image runs generated client output.
- Do not move API parsing packages or `dotenv` without production import
  evidence.
- The pnpm v9 lockfile is healthy. Exact pins for `@prisma/client`,
  `read-excel-file`, `write-excel-file`, and `zod` are deliberate stability
  boundaries; retain them and update them in a grouped, tested lane.

**Pipeline and security concerns.** CI is broad and reliable but combines
format, lint, typecheck, test, application build, and two image builds for
every PR. This is appropriate for grouped updates but should be the single
required check, not duplicated by a second dependency-only build. LCM's
Trivy filesystem and image scans use `exit-code: '0'`, and SARIF uploads are
`continue-on-error`; those scans provide evidence rather than a blocking
vulnerability gate. Dependabot alerts are disabled, so enable them before
claiming the scan is sufficient. The `workflow_run` auto-merge job currently
squash-merges any Dependabot PR after CI, including majors, actions, and
Docker updates.

### Content Viewer

| Area | Current evidence |
| --- | --- |
| Runtime and platform | `.node-version`: `26.0.0`, npm lockfile v3; no `packageManager` field |
| Application | Node ESM server with `mermaid` `^11.17.0` |
| Test/tooling | Native `node --test`; `yaml` `^2.9.0`; no React, Vite, TypeScript, ESLint, Prettier, Jest, Vitest, Cypress, or Playwright |
| Open update pattern | Seven individual Dependabot PRs (#34-#40), including Node image, Actions, and `mermaid` |

**Critical direct dependencies.** The repository has only two direct
dependencies, so a top-ten list would be misleading: `mermaid` `^11.17.0` is
the browser-rendered diagram runtime; `yaml` `^2.9.0` supports tooling and
configuration processing. Verify whether production code imports `yaml`; if
not, move it to `devDependencies` in a separate tested PR.

**Duplicates and alignment.** There are no local overlapping libraries to
consolidate. Do not introduce a framework test stack: native Node tests are
the lowest-churn fit. Align only Node 26, action pinning, dependency grouping,
security-SLA labels, and update schedules with the other repositories.

**Runtime and lockfile actions.** `package-lock.json` v3 matches modern npm.
Add a `packageManager` field so local and CI npm resolution is explicit. Do
not convert this small standalone project to pnpm merely for organizational
uniformity; that would create a one-time lockfile migration with no recurring
benefit.

**Pipeline and security concerns.** The existing Validate, Dependency review,
and Security scan workflows give this repository the strongest PR validation
of the three. Action pins generate digest-only Dependabot changes, which is
desirable, but lack of grouping causes unnecessary individual PRs. The Trivy
workflow's custom policy is blocking, while SARIF upload is intentionally
best-effort. Keep that distinction.

## 3. Low-churn target architecture

| Policy | Standard |
| --- | --- |
| Node | Support only Node `26.x` for this maintenance cycle. Check in `.nvmrc` as `26` and keep `.node-version` at `26`/`26.0.0`; CI must use the version file. Reassess the next Node major only in the 90-day campaign. |
| Package managers | pnpm `10.33.0` with Corepack for Tavi and Revio workspaces; npm `11.6.2` recorded in Content Viewer's `packageManager` field. Do not mix lockfile types in a repository. |
| Runtime versions | Use exact versions for database clients, ORM/tooling pairs, protocol stacks, and packages with a security override. Use caret ranges for application libraries within the same major. |
| Dev-tool versions | Use `~` for TypeScript and exact paired versions for `eslint`/`typescript-eslint`, Vite/plugin, Vitest/jsdom, and Prisma/client. |
| Patch cadence | Weekly grouped PRs. Auto-merge only Dependabot patch updates after all required checks and no open security-policy exception. |
| Minor cadence | Weekly grouped PRs; merge manually after the same required checks. Do not auto-merge ORM, framework, authentication, database, or action minor updates. |
| Major cadence | Monthly, one named ecosystem group per PR, never auto-merged. |
| Security cadence | Security-only PRs bypass the normal schedule. P0 may auto-merge after required checks; P1 and lower require review. |
| Exceptions | An exception requires an owner, affected image/package, exploitability assessment, compensating control, expiry no later than 30 days, and a tracking issue. |

## 4. PR-ready changes

Apply the following as small configuration PRs. Regenerate a lockfile only when
the manifest changes. The proposed package-manager values deliberately keep
the existing npm/pnpm split rather than creating a migration project.

### Tavi

**`package.json` security override diff**

```diff
     "overrides": {
-      "fast-uri@3.1.4": "3.1.5",
-      "fast-uri@4.1.1": "4.1.2",
-      "@nestjs/platform-fastify>fastify": "5.11.0",
+      "fast-uri@3.1.4": "3.1.6",
+      "fast-uri@4.1.1": "4.1.3",
+      "@nestjs/platform-fastify>fastify": "5.12.1",
+      "mysql2": "3.22.0",
```

Then run `corepack pnpm install --lockfile-only` and confirm the changed
dependency path for `mysql2` with `corepack pnpm why mysql2`. Do not retain a
security override when its parent has been updated past the vulnerable range.

**Add `.nvmrc`**

```text
26
```

**Replace the npm section of `.github/dependabot.yml`.** Preserve the existing
private Docker registries and Kubernetes image ignores; replace the broad
`npm-all` group with this narrow set.

```yaml
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    open-pull-requests-limit: 7
    labels: [dependencies, automated]
    groups:
      security-hotfix:
        applies-to: security-updates
        patterns: ["*"]
      react-core:
        patterns: ["react", "react-dom", "react-router-dom", "@types/react", "@types/react-dom"]
        update-types: [minor, patch]
      vite-toolchain:
        patterns: ["vite", "@vitejs/*"]
        update-types: [minor, patch]
      typescript-eslint:
        patterns: ["typescript", "typescript-eslint", "@typescript-eslint/*", "eslint", "@eslint/*", "eslint-*"]
        update-types: [minor, patch]
      test-stack:
        patterns: ["vitest", "jest", "ts-jest", "jsdom", "@testing-library/*", "@types/jest", "supertest", "@types/supertest"]
        update-types: [minor, patch]
      ui-kit:
        patterns: ["@tanstack/react-query", "react-markdown", "remark-*", "write-excel-file"]
        update-types: [minor, patch]
      types:
        patterns: ["@types/*"]
        update-types: [minor, patch]
      misc-npm:
        patterns: ["*"]
        update-types: [minor, patch]
```

**Restrict `.github/workflows/automerge-dependencies.yml`.** In the policy
step, replace the unconditional output with a patch-only decision:

```bash
if [ "$UPDATE_TYPE" = "version-update:semver-patch" ]; then
  echo "automerge=true" >> "$GITHUB_OUTPUT"
else
  echo "automerge=false" >> "$GITHUB_OUTPUT"
  echo "Manual review required for $UPDATE_TYPE."
fi
```

Require the existing application validation, dependency review, and Trivy
high/critical checks through branch protection before enabling auto-merge.

### Revio

**`package.json` and `.nvmrc`.** No manifest version changes are needed:
`packageManager: pnpm@10.33.0`, Node `26.x`, and `.nvmrc` `26` already meet
the baseline. Keep `pnpm install --frozen-lockfile` in CI.

**Replace `.github/dependabot.yml` with grouped lanes**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: tuesday, time: "06:00", timezone: UTC }
    open-pull-requests-limit: 7
    labels: [dependencies, automated]
    groups:
      security-hotfix:
        applies-to: security-updates
        patterns: ["*"]
      react-core:
        patterns: ["react", "react-dom", "@types/react", "@types/react-dom"]
        update-types: [minor, patch]
      vite-toolchain:
        patterns: ["vite", "@vitejs/*"]
        update-types: [minor, patch]
      typescript-eslint:
        patterns: ["typescript", "oxlint", "@types/*"]
        update-types: [minor, patch]
      test-stack:
        patterns: ["vitest", "supertest", "@types/supertest", "tsx"]
        update-types: [minor, patch]
      ui-kit:
        patterns: ["@dnd-kit/*", "date-fns", "papaparse", "read-excel-file", "write-excel-file"]
        update-types: [minor, patch]
      misc-npm:
        patterns: ["*"]
        update-types: [minor, patch]
    ignore:
      - dependency-name: prisma
        update-types: [version-update:semver-major]
      - dependency-name: "@prisma/client"
        update-types: [version-update:semver-major]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: tuesday, time: "06:00", timezone: UTC }
    groups:
      actions-minor-patch:
        patterns: ["*"]
        update-types: [minor, patch]
  - package-ecosystem: docker
    directory: /
    schedule: { interval: weekly, day: tuesday, time: "06:00", timezone: UTC }
    groups:
      docker-minor-patch:
        patterns: ["*"]
        update-types: [minor, patch]
```

**Amend `.github/workflows/dependabot-auto-merge.yml`.** Preserve the
post-CI `workflow_run` merge, but require a `dependencies-automerge` label
before `gh pr merge`. Add that label only from a `pull_request_target`
metadata job when `dependabot/fetch-metadata` reports
`version-update:semver-patch`. This retains private-repository compatibility
while preventing unchecked major/minor/action/Docker merges. Enable Dependabot
alerts in repository security settings and make the LCM Trivy policy fail on
new high/critical runtime findings after approved exceptions are excluded.

### Content Viewer

**`package.json`**

```diff
   "type": "module",
+  "packageManager": "npm@11.6.2",
   "engines": {
```

**Add `.nvmrc`**

```text
26
```

**Replace `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    open-pull-requests-limit: 5
    labels: [dependencies, automated]
    groups:
      security-hotfix:
        applies-to: security-updates
        patterns: ["*"]
      ui-kit:
        patterns: ["mermaid"]
        update-types: [minor, patch]
      misc-npm:
        patterns: ["*"]
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    labels: [dependencies, automated]
    groups:
      actions-minor-patch:
        patterns: ["*"]
        update-types: [minor, patch]
  - package-ecosystem: docker
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    labels: [dependencies, automated]
    groups:
      docker-minor-patch:
        patterns: ["*"]
        update-types: [minor, patch]
```

Keep Validate, Dependency review, and Security scan as the required checks for
all dependency PRs. Add the same label-gated, patch-only `workflow_run`
auto-merge pattern as Revio only after the three checks are required by branch
protection; otherwise leave merge manual.

## 5. Update grouping strategy

| Group | Included package patterns | Schedule | Auto-merge | Required checks |
| --- | --- | --- | --- | --- |
| `react-core` | `react`, `react-dom`, `react-router-dom`, `@types/react*` | Weekly | Patch only | Install, lint, typecheck, test, build |
| `vite-toolchain` | `vite`, `@vitejs/*` | Weekly | Patch only | Web build and browser/unit tests |
| `typescript-eslint` | `typescript`, `typescript-eslint`, `@typescript-eslint/*`, `eslint*`, `@eslint/*`, `oxlint` | Weekly | Patch only; manual for TypeScript | Lint, typecheck, build |
| `test-stack` | `vitest`, `jest`, `ts-jest`, `jsdom`, `@testing-library/*`, `supertest`, `tsx` | Weekly | Patch only | Full test suite |
| `ui-kit` | Tavi query/markdown/export packages; Revio DnD/date/import-export; Content Viewer `mermaid` | Weekly | Manual | Web build and relevant tests |
| `types` | `@types/*` | Weekly | Patch only | Typecheck and test |
| `security-hotfix` | `*`, security updates only | Immediate | P0 only after checks; otherwise manual | Full required checks plus vulnerability policy |

Majors are intentionally omitted from all groups: Dependabot creates one
reviewable PR per major dependency. GitHub Actions and Docker use their own
minor/patch groups; action and base-image majors always require manual review.

## 6. Security triage and remediation SLA

| Class | Current finding | Classification and action | SLA |
| --- | --- | --- | --- |
| P0 reachable runtime | None proven from available evidence | Promote immediately if untrusted URL/host routing reaches Tavi Fastify URI resolution or an affected credential path reaches `mysql2`. | Mitigate/patch in 24 hours |
| P1 runtime not proven reachable | Tavi #25 `mysql2@3.15.3`, high, patch `3.22.0`; #26 `fastify@5.11.0`, medium, patch `5.12.1`; #27-#30 `fast-uri@4.1.2`, high, patch `4.1.3` | Runtime transitive dependencies. The Fastify/URI findings are relevant to host, proxy, SSRF, and URL-policy handling; verify reachability but patch now through the documented override PR. | Patch within 7 days |
| P2 dev/build-time only | No confirmed current finding | Classify only after Dependabot is enabled for Revio and scanner output is reviewed. Keep out of production image where possible. | Patch in next weekly window, maximum 14 days |
| P3 low/transitive | No confirmed current finding | Aggregate with the next compatible dependency group; never suppress without expiry and owner. | 90 days maximum |

Content Viewer returned no open Dependabot alerts. Revio's Dependabot alert API
reports that alerts are disabled, which is a process gap rather than evidence
of zero vulnerabilities. Tavi's six findings are current as of the audit date.

## 7. 30/60/90-day rollout

| Horizon | Deliverables |
| --- | --- |
| Week 1-2 | Land Tavi's security override/lockfile update; replace broad or ungrouped Dependabot configuration; add `.nvmrc` to Tavi and Content Viewer; make all auto-merge lanes patch-only and branch-protection gated; enable Revio Dependabot alerts. |
| Day 30 | Triage every generated alert with the SLA table; verify Tavi's `mysql2` path; move Content Viewer's `yaml` only if production import tracing permits; establish one dashboard/query for grouped PR age, reopen rate, and rollback rate. |
| Day 60 | Align version ranges in paired packages (Prisma/client, Vite/plugin, test runner/environment, TypeScript/linter); remove security overrides made obsolete by parent upgrades; enforce expiring exception records. |
| Day 90 | Run a named major-version campaign, one ecosystem at a time: Node only if support changes, then TypeScript, framework/API stack, and finally test tooling. Measure failed CI and rollback rates before expanding auto-merge. |

## Lowest-churn baseline template

Use this in a future JavaScript repository, substituting its checked-in
manager and project-specific required checks:

```json
{
  "engines": { "node": ">=26 <27" },
  "packageManager": "pnpm@10.33.0"
}
```

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    open-pull-requests-limit: 7
    groups:
      security-hotfix: { applies-to: security-updates, patterns: ["*"] }
      react-core: { patterns: ["react", "react-dom", "@types/react", "@types/react-dom"], update-types: [minor, patch] }
      vite-toolchain: { patterns: ["vite", "@vitejs/*"], update-types: [minor, patch] }
      typescript-eslint: { patterns: ["typescript", "typescript-eslint", "@typescript-eslint/*", "eslint*"], update-types: [minor, patch] }
      test-stack: { patterns: ["vitest", "jest", "@testing-library/*", "jsdom"], update-types: [minor, patch] }
      types: { patterns: ["@types/*"], update-types: [minor, patch] }
      misc-npm: { patterns: ["*"], update-types: [minor, patch] }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday, time: "06:00", timezone: UTC }
    groups:
      actions-minor-patch: { patterns: ["*"], update-types: [minor, patch] }
```

The companion workflow must install from the lockfile, run the existing
lint/typecheck/test/build commands, scan the production artifact, and
auto-merge only patch PRs after required checks are green.
