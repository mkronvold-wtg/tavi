# Tavi Architecture

> Tavi is our lightweight system for tracking work and projects clearly, without slowing teams down.

## 1. Architecture Summary

Tavi will use a full TypeScript stack approved during requirements clarification. The product will run locally in Docker during development and deploy to Kubernetes in production for resiliency and operational consistency.

Recommended implementation:

- **Frontend:** React + TypeScript
- **Backend API:** Node.js + TypeScript
- **Worker:** Node.js + TypeScript background worker for imports and asynchronous processing
- **Database:** PostgreSQL
- **Deployment:** Docker for local development, Kubernetes for production

This architecture assumes the approved full TypeScript stack decision.

## 2. Key Architectural Decisions

1. Use a monorepo so shared types, schemas, lint rules, and build tooling stay consistent.
2. Separate `web`, `api`, and `worker` runtimes for clearer scaling and operations.
3. Use PostgreSQL as the source of truth for product data, import staging, and audit history.
4. Use REST JSON endpoints backed by shared Zod schemas so the web app, API, and worker stay in sync.
5. Use shared TypeScript schemas to reduce contract drift between frontend and backend.
6. Use enterprise SSO in production and a local-dev auth mode outside production.
7. Persist derived project rollups so the primary workspace stays fast.

## 3. Recommended Stack

| Layer               | Recommendation                                                               | Notes                                                               |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Package management  | `pnpm` workspaces                                                            | Fast installs and good monorepo support                             |
| Build orchestration | `turbo`                                                                      | Optional but useful for caching and task coordination               |
| Web app             | React + TypeScript + Vite                                                    | Good fit for a dense internal SPA                                   |
| Data fetching       | TanStack Query                                                               | Caching, invalidation, and optimistic updates                       |
| Table/view layer    | Native React table markup plus focused inline editors                        | Keeps the dense grouped workspace compact without extra abstraction |
| Styling             | Hand-authored CSS with theme variables                                       | Compact control over density, themes, and row highlighting          |
| Local UI state      | React state/hooks plus storage helpers                                       | Keeps expansion, filters, editors, and browser cache explicit       |
| API                 | NestJS with Fastify adapter                                                  | Structured backend with strong TypeScript ergonomics                |
| Validation          | Zod shared schemas                                                           | Reusable request/response and domain validation                     |
| ORM                 | Prisma                                                                       | Type-safe data access and migration workflow                        |
| Background jobs     | Dedicated Node worker polling PostgreSQL                                     | Handles imports, notifications, digests, reminders, and backups     |
| Database            | PostgreSQL 16+                                                               | Reliable relational model for projects/tasks/imports                |
| Testing             | Vitest, React Testing Library, Jest                                          | Web and API coverage for dense UI and service logic                 |
| Observability       | Structured logs + Prometheus metrics, with OpenTelemetry tracing added later | Good operational baseline without overbuilding the first release    |

## 4. Repository Layout

Recommended monorepo structure:

```text
apps/
  web/
  api/
  worker/
packages/
  ui/
  schemas/
  config/
infra/
  docker/
  k8s/
```

### apps/web

- React SPA
- Dense grouped workspace
- Import and export UI
- Saved views UI
- Settings and local account management UI
- Role-aware navigation

### apps/api

- Auth/session handling
- Project, task, view, import, and audit APIs
- Domain services and rollup logic

### apps/worker

- CSV parsing jobs
- Import staging and commit jobs
- Notification delivery, digest batching, Personal ToDo reminders, and backup scheduling

### packages/schemas

- Shared Zod schemas
- Enums for statuses, priorities, roles
- Generated API client types if desired

## 5. Runtime Components

```text
Browser
  -> Web App
      -> API
          -> PostgreSQL
          -> OIDC/SAML Identity Provider
      -> Worker (via job queue in PostgreSQL)
```

### Web

- Serves the React application
- Reads session state from the API
- Stores reusable workspace state in saved views and per-user config mirrored into browser-local Tavi storage
- Stores panel toggle state, named theme selection, Auto Collapse, Bulk Actions visibility, Full Width, workspace filters including `Not viewed`, per-project Add Task expansion, per-project task `D` hide-done/cancelled visibility, and Personal ToDo `hide done` visibility in per-user config mirrored into browser-local Tavi storage
- Reads deployment-specific browser entry URLs such as the temporary header home link from a small runtime config file so Docker and Kubernetes can override them without rebuilding the app

### API

- Exposes authenticated JSON endpoints
- Enforces RBAC
- Persists projects, shared tasks, personal to-dos, views, imports, and audit events
- Supports unauthenticated local-auth password reset endpoints that email short-lived one-time passwords
- Computes derived project rollups on write

### Worker

- Processes heavy or asynchronous tasks
- Keeps imports and other long-running operations off the request path
- Schedules project/task notification delivery plus owner-only Personal ToDo due reminders

## 6. Data Model

Recommended primary tables:

- `users`
- `role_assignments`
- `projects`
- `tasks`
- `personal_todos`
- `task_view_states`
- `project_view_states` for compatibility with older snapshots
- `saved_views`
- `imports`
- `import_rows`
- `audit_events`
- `email_settings`
- `backup_settings`
- `retention_settings`
- `backup_file_protections`
- `notification_events`
- `notification_delivery_attempts`

`retention_settings` keeps the legacy `backup_retention` window for upgrade compatibility and stores the active tiered backup policy as daily, weekly, and monthly bucket counts. The defaults are 7 daily, 4 weekly, and 3 monthly; zero disables a tier. `backup_file_protections` records protected stored-backup file names, the protection timestamp, and the admin user when available. It is intentionally database-backed rather than filesystem-backed so protection survives process restarts and shared Kubernetes volume remounts.

### projects

Important columns:

- `id`
- `title`
- `notes`
- `references`
- `owner_user_id`
- `due_date`
- `priority`
- `derived_status`
- `display_status`
- `task_total_count`
- `task_todo_count` (still named this way in storage and API payloads, but now counts `not_started` tasks)
- `task_in_progress_count`
- `task_blocked_count`
- `task_on_hold_count`
- `task_done_count`
- `task_canceled_count`
- `task_overdue_count`
- `source_system`
- `source_external_id`
- `archived_at`
- `created_at`
- `updated_at`

### tasks

Important columns:

- `id`
- `project_id`
- `title`
- `notes`
- `assignee_user_id`
- `status`
- `priority`
- `due_date`
- `sort_order`

Status enums currently use the same ordered set for shared task and project workflows:

1. `not_started`
2. `in_progress`
3. `demo`
4. `review`
5. `done`
6. `blocked`
7. `on_hold`
8. `canceled`

Legacy compatibility still matters in a few read paths:

- old saved views can contain `todo`
- old backup snapshots can contain `todo`
- Personal ToDo items still use their own `todo` / `done` status model and are not part of the shared project-task status enum

Project rollup still persists the existing aggregate counters only. `demo` and `review` affect derived project status, but they do not currently have dedicated stored counter columns.

### personal_todos

Important columns:

- `id`
- `user_id`
- `title`
- `notes`
- `due_date`
- `status`
- `sort_order`
- `completed_at`
- `created_at`
- `updated_at`
- `source_system`
- `source_external_id`
- `archived_at`
- `created_at`
- `updated_at`
- `completed_at`

Migration note:

- Existing task descriptions and blocked reasons should be preserved by merging them into `tasks.notes`.
- Existing project override reasons should seed `projects.notes`.

### task_view_states

Important columns:

- `id`
- `user_id`
- `task_id`
- `created_at`
- `updated_at`

This table stores per-user viewed state for shared tasks. Workspace responses mark a task unviewed for a user when that active task does not have a current `task_view_states` row for that user. Project cards derive their unviewed state from their active tasks, so a project is highlighted when any visible task under it needs attention. Task writes mark the actor's row viewed and remove other users' rows for that task; collapsing a project and `Mark all viewed` upsert rows for active tasks.

`project_view_states` may still be present in older databases or backup snapshots, but task-level state is the workspace source of truth for current unviewed highlights.

### saved_views

Store:

- Name
- Owner scope for Milestone 4A
- Search text
- Grouping mode
- Project-status filters
- Project/task assignee filters
- `Not viewed` filter state
- Multi-field project sort order
- Expanded/collapsed defaults for groups and projects

### users

Important columns:

- `id`
- `email`
- `name`
- `password_hash`
- `password_reset_otp_hash`
- `password_reset_otp_expires_at`
- `daily_digest_enabled`
- `daily_digest_time`
- `personal_todo_retention`
- `personal_todo_reminders_enabled`
- `user_config_json`
- `created_at`
- `updated_at`

Password-reset notes:

- Forgot-password recovery stores only a hashed one-time password, never the plaintext code.
- Reset codes expire after 10 minutes and are cleared after success, expiry, or any later password change.
- Per-user synced workspace state now lives in `user_config_json` and is mirrored into browser-local Tavi storage for faster startup

### imports / import_rows

Use these tables to:

- Store import job metadata
- Stage parsed source rows
- Record validation errors
- Track row-level create/update outcomes

## 7. Rollup Strategy

The grouped workspace is read-heavy, so project rollups should be persisted rather than recalculated from scratch for every request.

Recommended approach:

1. Task writes occur in a transaction.
2. The API updates task state.
3. The API recomputes rollup counters for the affected project.
4. The API derives the new project status unless a manual override exists.
5. The API records an audit event.

This keeps reads simple and fast while preserving a clear source of truth.

## 8. API Design

Use a REST JSON API under `/api`.

Suggested endpoint groups:

- `/auth`
- `/users`
- `/projects`
- `/tasks`
- `/views`
- `/imports`
- `/audit`

Representative endpoints:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/tasks`
- `PATCH /api/tasks/:taskId`
- `POST /api/projects/:projectId/status-override`
- `DELETE /api/projects/:projectId/status-override`
- `POST /api/workspace/projects/:projectId/viewed`
- `POST /api/workspace/projects/viewed`
- `GET /api/views`
- `POST /api/views`
- `GET /api/auth/local-login-hint`
- `GET /api/auth/accounts`
- `GET /api/auth/accounts/export`
- `POST /api/auth/accounts`
- `POST /api/auth/accounts/import`
- `POST /api/auth/accounts/reset-defaults`
- `PATCH /api/auth/accounts/:userId`
- `POST /api/auth/accounts/:userId/password`
- `DELETE /api/auth/accounts/:userId`
- `POST /api/imports/loop`
- `GET /api/imports/:importId`

Query behavior should support:

- Filtering
- Sorting
- Grouping hints
- Pagination or cursoring for large result sets
- Inclusion of project rollup data with task children

Shared schemas and typed client helpers keep the API contract explicit without requiring a separate generated OpenAPI layer in the current build.

## 9. Frontend Architecture

### State Model

- Server state comes from TanStack Query.
- Local state stores expanded rows, transient editing state, and active inline editors.
- Server-backed per-user config, mirrored into browser-local Tavi storage after login, persists grouping, project-status filters, project/task assignee filters, `Not viewed`, multi-field sort order, panel toggles, named theme selection, Auto Collapse, Bulk Actions visibility, Full Width, per-project task `D` visibility, and other personal UI preferences.
- Saved views persist reusable workspace configurations.
- Saved views intentionally do not persist per-user panel toggles or other personal UI preferences.

### UI Composition

Recommended modules:

- Workspace shell
- Grouped project/task table
- Project inline row editor
- Task inline editor
- Filter and grouping controls
- View panel
- Import/Export panel
- Settings panel
- Local accounts panel
- Audit/history panel

### Rendering Strategy

- Keep primary interactions inline to minimize context switching.
- Use optimistic updates where safe, but reconcile against server responses.
- Preserve expansion state while filters or grouping change when practical.
- Poll the workspace in the background for collaborative changes, using a short steady interval while healthy and backoff while the API is unavailable.

## 10. Backend Architecture

Recommended API modules:

- `auth`
- `workspace`
- `users`
- `projects`
- `tasks`
- `views`
- `imports`
- `audit`
- `health`

Recommended service boundaries:

- `WorkspaceService` for the aggregated workspace payload and admin reset/example seeding
- `ProjectService` for project CRUD and rollup orchestration
- `TaskService` for task CRUD, ordering, and status updates
- `ViewService` for saved views
- `ImportService` for upload, preview, staging, and commit
- `LocalAccountService` for local account CRUD, role changes, and password management
- `AuditService` for immutable change history

Use request validation at the edge and keep business rules in service-layer code rather than controllers.

## 11. Authentication and Security

### Production Auth

- Use OIDC or SAML with the enterprise identity provider.
- Prefer backend-managed sessions with secure, HTTP-only cookies.
- Run the web app and API under the same origin to simplify auth and reduce CORS complexity.

### Local Development Auth

- Enable a local auth mode only outside production.
- Allow preconfigured local roles for testing admin/editor/viewer behavior.
- Allow admins to create, edit, remove, and set passwords for local accounts.
- Allow admins to export local accounts as JSON with password hashes for restore, import JSON account changes by email, and reset the seeded `@tavi.local` accounts back to known credentials without deleting unrelated local accounts.
- Require current-password confirmation for destructive admin workspace reset actions such as clearing or reseeding example project/task data from the Import/Export panel.
- Allow non-admins to change only their own local password.
- Expose an unauthenticated login-hint endpoint so the login screen advertises the seeded local users only while those accounts still exist with their default password.
- Guard the local auth mode behind environment configuration so it cannot be enabled accidentally in production.

### Security Controls

- RBAC enforced in API guards
- CSRF protection for session-authenticated write operations
- Input validation on every write path
- Audit trail for sensitive actions
- Secret management through Kubernetes secrets or an external secret manager
- HTTPS-only production traffic

## 12. Import Architecture

Recommended import flow:

1. User uploads a CSV or export file.
2. API validates basic structure and creates an import job.
3. Worker parses rows into `import_rows`, expanding newline-delimited checklist cells into separate staged task rows and keeping blank checklist rows as project-only stages.
4. User reviews a preview and mapping summary, including missing import users and per-row project/task overlaps.
5. Admin can create missing local viewer accounts from preview when name and email are available, including extra project-owner contacts from multi-owner cells.
6. Admin can choose update, add, or ignore per overlapping row before commit, with project-level choices propagating across checklist-split rows for the same staged project.
7. Worker commits valid rows to projects/tasks in batches once blocking missing users are cleared. Project-only rows commit only the project mutation.
8. Import result captures created, updated, skipped, and failed rows.

Implementation notes:

- Preserve source IDs for traceability.
- Make imports idempotent where possible.
- Batch writes to avoid long transactions.
- Fail individual rows clearly without hiding errors behind a generic import failure.
- Re-stage import rows when mapping changes so checklist splitting stays aligned with the chosen task-title column.
- If a row has no mapped task-title value, ignore task-side fields for that row and treat it as a project-only import.

### Export architecture

- Support on-demand exports of the current filtered workspace view as CSV, XLSX, and JSON.
- Support a Loop-oriented export that flattens projects and tasks into a row-based interchange shape.
- Support an admin-only reset endpoint that deletes current project/task data and reseeds a compact example workspace after current-password confirmation.
- Export scope must be limited to the current user's visible data and active filter state.
- In the current implementation, exports are generated in the web app from the already-loaded filtered workspace data rather than through dedicated API endpoints.
- Local-account bulk import/export/reset remains API-backed because the server owns password rules, seeded-account reset behavior, and login-hint visibility.
- If export volume or access rules outgrow the workspace payload, dedicated export endpoints can be added later without changing the panel UX.
- Clear local-storage actions should remove only Tavi-owned browser keys, not unrelated site data.

## 13. Local Development

Recommended local stack via Docker Compose:

- `web`
- `api`
- `worker`
- `postgres`

Local development requirements:

- Fast container rebuilds with bind mounts
- Committed Prisma migrations applied automatically on local stack startup
- Seed data for realistic grouped views
- Simple local auth mode
- One-command startup for the full stack

The developer workflow should not require Kubernetes for normal day-to-day feature work.

## 14. Kubernetes Deployment

Recommended production topology:

- `web` Deployment
- `api` Deployment
- `worker` Deployment
- Ingress for web and API routing
- Managed PostgreSQL outside the cluster when possible
- Raw Kubernetes manifests checked into `infra/k8s/`

Recommended Kubernetes practices:

- Readiness and liveness probes on every runtime
- Horizontal autoscaling for `web` and `api`
- Rolling deployments
- Run committed Prisma migrations before API pods become ready
- Pod disruption budgets for API and worker where appropriate
- Config via ConfigMaps and secrets via Secrets or external secret sync

Use raw manifests as the repo standard for the initial implementation. Do not introduce Helm or Kustomize unless the deployment complexity later proves that they are needed.

Use separate images for `web`, `api`, and `worker` so they can scale independently.

## 15. Observability and Operations

Minimum operational baseline:

- Structured JSON logs from the API and worker with request IDs, correlation IDs, and import/job identifiers
- Prometheus metrics at `/api/metrics` for API latency, status codes, and process health
- Worker readiness at `/health` and Prometheus metrics at `/metrics` for job throughput, duration, and import row failures
- Kubernetes scrape annotations and health probes wired to those endpoints

Distributed tracing can layer on later once the logging and metrics baseline is proven useful in production.

Operational requirements:

- Automated database migrations in deployment workflows using `prisma migrate deploy`
- Tavi JSON backups on the shared backup volume with API and worker access
- Tiered backup pruning after scheduled, manual, uploaded, and explicit prune operations
- Protected backup files excluded from automatic pruning until an admin removes protection
- Clear rollback path for app releases and schema changes

## 16. Performance and Reliability Targets

Initial targets for v1:

- Initial workspace load under 2 seconds for common team views
- Inline task update round trip under 300 ms in normal conditions
- Import preview generation fast enough for typical Loop export sizes
- No full-table recalculation of project status on normal page loads

Key performance strategies:

- Persisted rollup counters
- Proper indexing on owner, assignee, status, due date, and notification query paths
- Efficient grouped-list rendering and targeted row updates
- Background processing for imports

## 17. Testing Strategy

Recommended coverage layers:

- Unit tests for rollup logic, validation, and permissions
- Integration tests for API modules and database behavior
- Component tests for grouped table and inline editing
- End-to-end tests for login, workspace filtering, status updates, and import preview

Suggested tooling:

- Vitest for unit and integration tests
- React Testing Library for UI behavior
- Playwright for end-to-end coverage

## 18. Suggested Supporting Documents

After this document, the next most valuable technical docs are:

1. `docs/API-CONTRACT.md`
2. `docs/DATA-DICTIONARY.md`
3. [`IMPORT-MAPPING.md`](./IMPORT-MAPPING.md)
4. `docs/OPS-RUNBOOK.md`
5. `adr/` decision records for stack, auth, rollup persistence, and deployment model
