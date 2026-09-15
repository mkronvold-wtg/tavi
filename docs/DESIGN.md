# Tavi Design Specification

> Tavi is our lightweight system for tracking work and projects clearly, without slowing teams down.

## 1. Product Summary

Tavi is an internal web application for managing project work as first-class projects and tasks. It replaces Loop as the primary tracker and turns checklist-style work into structured tasks with explicit status, ownership, due dates, and rollup behavior.

The product is optimized for review-heavy team workflows where people need to scan many projects quickly, regroup the view during discussions, and understand project health from task state instead of ad hoc notes or checklists.

## 2. Product Goals

1. Replace checklist-driven project tracking with explicit project and task records.
2. Make project status trustworthy by deriving it from task status and exposing rollup details.
3. Support fast review conversations with compact layouts, inline editing, and collapse/expand controls.
4. Make large worklists manageable through filtering, sorting, regrouping, and saved views.
5. Provide a practical migration path from existing Loop exports.
6. Keep operational recovery simple with visible backup storage usage, tiered backup retention, and explicit protection for must-keep snapshots.

## 3. Non-Goals for v1

1. Arbitrary nested tasks beyond one task level under each project.
2. Bi-directional synchronization with Loop.
3. Mobile-first task management UX.
4. External customer or guest collaboration.
5. Broad portfolio analytics beyond operational status views.

## 4. Intended Users

| Role   | Primary Use                                                                  | Permissions                                                                                                            |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Admin  | Configure access, manage local accounts, manage imports, resolve data issues | Full access, role assignment, local account management, import administration, export of visible data, archive/restore |
| Editor | Create and manage project/task data                                          | Create, edit, regroup, update status, save views, export visible data                                                  |
| Viewer | Follow progress and join reviews                                             | Read-only access to projects, tasks, and saved views, plus export of visible data                                      |

## 5. Core Domain Model

### Project

A project is the top-level tracking unit. It represents a deliverable, initiative, or workstream.

Recommended fields:

- Title
- Owner
- Due date
- Priority
- Derived status
- Optional manual status override
- Notes
- References
- Source metadata for imports
- Created at / updated at / archived at

### Task

A task is a first-class work item directly attached to a project. Tasks are not nested beyond one level in v1.

Recommended fields:

- Title
- Notes
- Assignee
- Due date
- Priority
- Status
- Sort order within the project
- Created at / updated at / completed at
- Source metadata for imports

In this phase, task notes absorb the prior task description and blocked-reason concepts into a single general-purpose field.

### Saved View

A saved view stores a named combination of:

- Search text
- Grouping mode
- Project-status filters
- Project/task assignee filters
- `Not viewed` filter state
- Multi-field sort order
- Expanded/collapsed defaults for the grouped workspace

Milestone 4A scope:

- Saved views are personal only.
- Team/shared views are deferred.
- Visible columns, density, and other future display settings are deferred.

Panel toggle state for View, Import/Export, New Project, Settings, and per-project Add Task is per-user synced UI state and is not part of saved views.
Theme choice, Auto Collapse, Bulk Actions visibility, and Full Width are also per-user synced preferences and are not part of saved views.

### Import Job

An import job records a Loop CSV or export-based migration event, including validation results, row mappings, and completion status.

### Audit Event

An audit event records meaningful changes such as status changes, task reordering, field edits, overrides, and imports.

### Backup Retention Policy

Backup retention is a workspace-level operational policy configured from `Settings` -> `Backups`.

- Defaults: 7 daily, 4 weekly, and 3 monthly retained buckets.
- Each tier is an integer count; `0` disables that tier.
- Selection is deterministic by stored-file modified timestamp in UTC: newest file per UTC day, ISO week, and UTC month, assigned daily first, then weekly, then monthly.
- Protected backup files are excluded from automatic pruning until unprotected.
- Total backup storage is visible beside the active policy so admins can discuss retention without leaving the backup panel.

## 6. Status Model

### Task Statuses

Recommended task statuses:

- `not_started`
- `in_progress`
- `demo`
- `review`
- `done`
- `blocked`
- `on_hold`
- `canceled`

### Project Statuses

Recommended project statuses:

- `not_started`
- `in_progress`
- `demo`
- `review`
- `done`
- `blocked`
- `on_hold`
- `canceled`

### Project Rollup Rules

Default project status is auto-calculated from task state.

1. If a manual override is active, show the override status and keep the derived status visible for context.
2. If the project has no active tasks, set status to `not_started`.
3. If all non-canceled tasks are `done`, set status to `done`.
4. If any actionable task is `review`, set status to `review`.
5. If any actionable task is `demo`, set status to `demo`.
6. If all actionable tasks are `blocked`, set status to `blocked`.
7. If all actionable tasks are `on_hold`, set status to `on_hold`.
8. If all non-canceled tasks are `not_started`, set status to `not_started`.
9. Otherwise set status to `in_progress`.

Override requirements:

- Only admins and editors can set or clear an override.
- An override can optionally be paired with project notes, but notes are not required.
- The UI must always indicate when a displayed project status is overridden instead of derived.

Rollup details shown in the UI should include:

- Total task count
- Counts by task status
- Overdue task count
- Completion ratio

## 7. Core User Workflows

### 7.1 Create a Project

1. User creates a project with core metadata.
2. User adds tasks inline or through a project detail drawer/page.
3. Project appears in the main grouped list with an initial derived status.

### 7.2 Import Existing Work from Loop

1. Admin uploads a Loop export or CSV.
2. System validates required columns and previews the mapping.
3. System fans newline-delimited checklist entries into separate staged tasks under the mapped project, while rows with an empty mapped checklist cell remain project-only.
4. If imported assignees or extra multi-owner project contacts do not exist, preview offers local user creation when name and email are available.
5. Preview shows per-row overlap decisions for existing projects and tasks so the admin can update, add, or ignore overlaps before commit.
6. User confirms the import after resolving missing users that block commit.
7. Import results show successes, skipped rows, and validation failures.

### 7.3 Export Current Workspace

1. User opens the Import/Export panel.
2. User exports the current filtered workspace view as CSV, XLSX, or JSON, or selects the Loop export shape.
3. Export respects the viewer's current access and filter state.

### 7.4 Clear or Reset Workspace Projects/Tasks

1. Admin opens the Import/Export panel and starts either Clear all Projects/Tasks or Reset to example Projects/Tasks.
2. Tavi requires the admin to re-enter the current local password before continuing.
3. System deletes the current project/task workspace data.
4. If the admin chose Reset to example Projects/Tasks, Tavi then seeds a small example workspace.
5. Local accounts, saved views, and import history remain unchanged.

### 7.5 Daily Review / Standup

1. User opens a saved view or applies filters.
2. User groups projects by owner, status, priority, or leaves the list ungrouped.
3. User collapses unrelated groups and expands the project under discussion.
4. User updates task status and notes inline during the review.
5. Project rollup updates immediately.

### 7.6 Exception Handling

1. User marks a task blocked and updates notes if context is needed.
2. Project rollup reflects the change.
3. If the derived project status does not match the team's desired display state, an editor or admin can apply a manual override and optionally update project notes.

### 7.7 Manage Local Accounts

1. Admin opens Settings and expands the Local Accounts panel.
2. Admin can export local accounts as JSON for review or bulk editing. Exported JSON includes password hashes for restore, not plaintext passwords.
3. Admin can import JSON to create or overwrite accounts by email. Existing accounts keep their current password when the imported `password` field is blank and no `passwordHash` is provided, and new JSON accounts must include either `password` or `passwordHash`.
4. Admin can reset the default `admin@tavi.local`, `editor@tavi.local`, and `viewer@tavi.local` accounts back to `password123` without deleting unrelated local accounts.
5. The login hint for the default local users returns only after the backend confirms those seeded accounts exist with their default credentials again.

### 7.8 Recover a Forgotten Local Password

1. User fails one local sign-in attempt.
2. Login screen reveals a `Forgot password` action.
3. User requests a one-time password email for the target address.
4. System sends a one-time password in `AAAA-BBBB` hex format and stores only a hashed copy with a 10-minute expiry.
5. User types the one-time password plus the new password twice on the login screen.
6. System invalidates the one-time password, updates the real password, clears any active session cookie, and returns the user to the normal login screen.

## 8. Functional Requirements

### FR-01 Authentication and Access

- Production access uses enterprise SSO via OIDC or SAML.
- Local development uses a simpler local auth mode.
- Local auth must support admin-managed local accounts plus self-service password changes.
- Local auth must also support login-screen forgot-password recovery by emailing a one-time password that expires after 10 minutes.
- Admin local-account management must support JSON export, JSON or CSV import by email, duplicate handling during import, and reset-to-default for the seeded `@tavi.local` accounts.
- The login screen must show the seeded local-user hint only when the backend confirms the default `@tavi.local` accounts still exist with their default password.
- Authorization must enforce admin/editor/viewer roles.

### FR-02 Project Management

- Users can create, edit, archive, restore, and view projects.
- Projects must support due dates, owners, notes, priority, and newline-delimited references.
- Project notes are a general field and are not required to set manual status overrides.
- Soft deletion or archiving is preferred over hard deletion in v1.

### FR-03 Task Management

- Users can create, edit, reorder, and archive tasks within a project.
- Tasks must support assignee, due date, priority, status, and notes.
- Shared workspace tasks exist only under a project in v1.
- Users also need a private `Personal ToDo` list that is scoped to the signed-in user and kept out of the shared project hierarchy.

### FR-04 Dense Primary Workspace

- The default workspace is a dense grouped list/table.
- The workspace must display both project rows and task rows.
- Expand/collapse must work at both group and project levels.
- The workspace must visually highlight projects and tasks that contain task changes the signed-in user has not marked viewed.
- The workspace must offer a `Not viewed` filter that narrows to projects with unviewed task changes.
- The workspace should poll for collaborative changes while signed in and back off when the API is unavailable.
- Settings must allow Auto Collapse so opening one project can collapse the others when the user wants a single-project focus mode.
- Settings must allow Bulk Actions to be shown or hidden so task-selection checkboxes can stay out of the way when multi-select editing is not needed.
- Settings must allow Full Width so the workspace can expand past the default centered reading width on large screens.
- Search, grouping, sort, project-status, assignee, and `Not viewed` controls should float left without a framed card.
- Project `Status` filters hide whole projects by display status. `Assignee` filters should keep projects visible when either the project owner or a task assignee matches, including an `Unassigned` option for empty owners or assignees.
- Compact toggle buttons for View, Personal ToDo, New Project, and Settings should float to the right on the same row when space allows.
- Per-project Add Task UI should stay hidden behind a lightweight toggle until needed.
- Expanded task tables should provide a compact per-project `D` toggle that hides `done` and `canceled` task rows without mutating data.
- The Personal ToDo panel should support compact create, edit, reorder, delete, import, and export actions without showing project ownership fields.

### FR-05 Inline Editing

- Core project and task fields must be editable inline without navigating away.
- Inline edits should preserve context and avoid full-page reloads.
- New-task and inline-task editing controls should align to the visible task-table columns.
- Moving a task into `review` should open a prefilled follow-up task draft under the same project rather than creating review work automatically.
- Edit and History row actions should stay compact and right-justified.
- New-task notes must support multiline entry from the inline add-task row.
- Projects must support optional References metadata that accepts one newline-delimited reference per line, with each line allowing either a URL or plain reference text.

### FR-06 Sorting, Filtering, and Regrouping

- Users can sort, filter, and regroup by owner, assignee, status, due date, priority, age, and last updated.
- Filters and grouping state should persist in per-user synced config with a browser-local cache and also be savable as named views.

### FR-07 Rollup and Summary Indicators

- Project status is derived from tasks by default.
- The UI must display rollup counts and completion progress alongside each project.
- Project rows should show completion percentage without requiring expansion.
- Manual overrides must remain visible and auditable.

### FR-08 Saved Views

- Users can save personal workspace views.
- Milestone 4A views persist search, grouping, task-status filtering, task-assignee filtering, and
  expanded/collapsed defaults.
- Team/shared views and future display preferences remain out of scope for this
  pass.
- Panel toggle state is persisted locally in the browser, not in saved views.

### FR-09 Search

- Users can search across project titles, project notes, task titles, task notes, owners, assignees, and references.

### FR-10 Import and Export

- v1 must support CSV or export-based import from Loop.
- Import must provide preview, validation, and error reporting.
- Imported checklist items become tasks in the destination project.
- Newline-delimited checklist cells in Loop exports must create one task per checklist entry.
- Rows with a blank mapped checklist/task-title value must stay valid project-only rows, even when shared task mappings such as status or priority are present.
- Missing imported assignees must be surfaced before commit, with an admin path to create local viewer accounts and generated passwords when email data is present.
- The Import/Export panel must also provide CSV, XLSX, and JSON exports of the current filtered workspace view plus a Loop-oriented export shape.
- The Import/Export panel must provide admin-only clear-only and reset-to-example workspace actions that require current-password confirmation.
- Export must be available to all authenticated users for the data they can see.

### FR-11 Audit History

- Meaningful project and task changes must be auditable.
- Minimum audit events: create, edit, status change, reorder, override, import, archive/restore.

### FR-12 Bulk Actions

- Editors and admins should be able to bulk-update common fields such as assignee, due date, priority, and status for selected tasks.

### FR-13 Accessibility

- Keyboard navigation is required for row navigation and inline edits.
- Status indicators must not rely on color alone.
- Table controls and row actions must remain screen-reader accessible.

### FR-14 Performance

- The primary workspace should remain responsive with large grouped lists.
- Expanding, collapsing, filtering, and inline edits must feel immediate in normal use.

## 9. UX Requirements

### Interaction Model

- Desktop-first experience optimized for review conversations and operational tracking.
- Compact row density with minimal visual chrome.
- Secondary actions should be visually quiet until hover or focus.
- Common edits should happen inline or in lightweight drawers/modals.
- Theme should be selectable from a named cycle of Light, Sepia, Spring, Ocean, Forest, Autumn, and Night in User Profile and persist per browser.

### Visualization Requirements

- Group headers must show counts and the active grouping context.
- Project rows must show rollup progress without requiring expansion.
- Task rows must be easy to scan with stable column alignment.
- Users must be able to collapse unrelated content quickly to focus the discussion.

### Layout Requirements

- Support sticky top controls and stable columns for large lists.
- Preserve user column preferences where practical.
- Keep filters and grouping controls compact and close to the data.

### Responsiveness

- v1 should target desktop and large laptop screens first.
- Smaller screens may support read/update workflows, but full dense-table management is not a v1 priority.

## 10. Business Rules

1. Every task belongs to exactly one project.
2. Projects support only one task level in v1.
3. Archived projects and tasks are hidden from default views but recoverable.
4. Task notes are available regardless of status, and blocked tasks do not require a dedicated blocked-reason field.
5. Manual project status overrides remain auditable and do not require notes.
6. Imported records should preserve source metadata for traceability.
7. Panel toggle state should persist locally per browser and be clearable without removing unrelated site data.
8. Exports should only include data visible to the authenticated user at export time.
9. Theme choice, Auto Collapse, Bulk Actions visibility, and Full Width preferences should persist locally per browser and not affect saved views.
10. References are optional project metadata stored as newline-delimited entries. URL values should open externally rather than embedding another tracker inside Tavi, display without protocol/query/fragment noise, and plain-text entries should remain visible as metadata.
11. Personal ToDo items are private to their owner, do not appear in the shared workspace list, and can send only due-date reminder emails.

## 11. v1 Scope

### In Scope

- Internal authenticated web app
- Admin/editor/viewer roles
- Projects with one level of tasks
- Dense grouped list/table workspace
- Inline editing
- Filtering, sorting, regrouping, saved views
- Derived project status with manual override
- Project references as newline-delimited links or reference text
- Private Personal ToDo panel with reorder, private import/export, and owner-only due reminders
- CSV/export-based Loop import
- CSV, XLSX, JSON, and Loop-oriented exports of the current filtered workspace
- Settings and User Profile panels with local account management, named workspace themes, Auto Collapse, Bulk Actions visibility, and Full Width in local-auth mode
- Audit history

### Nice to Have if Time Allows

- Basic dashboard summaries
- Per-user default views
- Bulk-edit improvements beyond the initial field set

### Out of Scope for v1

- Full Loop sync
- Deep task nesting
- Native mobile app
- External collaborator access
- Advanced reporting suites

## 12. Suggested Supporting Documents

To reduce ambiguity before implementation, the following supporting docs are recommended after [`DESIGN.md`](./DESIGN.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md) are accepted:

1. [`WORKSPACE.md`](./WORKSPACE.md) for the dense workspace workflow, inline editing, task reorder, and add-task behavior.
2. [`SETTINGS.md`](./SETTINGS.md) for per-user synced preferences, retention, and admin panel entry points.
3. [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md) for CSV import staging, preview, overlap choices, and export behavior.
4. [`BACKUPS.md`](./BACKUPS.md) for backup scheduling, storage, restore preview, and restore scope behavior.
5. [`NOTIFICATIONS.md`](./NOTIFICATIONS.md) for immediate emails, daily digest, Personal ToDo reminders, and audit-notification diagnostics.
6. [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md) for local account lifecycle rules and local-auth recovery.
7. [`AUDIT_HISTORY.md`](./AUDIT_HISTORY.md) for project/task/auth/audit reporting behavior.
8. [`IMPORT-MAPPING.md`](./IMPORT-MAPPING.md) for CSV import column mapping and checklist-splitting rules.
9. [`BRANDING.md`](./BRANDING.md) for canonical naming, stylized display usage, and first-use product copy.

## 13. Reference Alignment

TrackForge and current Loop screenshots should be used during UI review to validate layout density, row hierarchy, and control placement before implementation begins. They are reference inputs for interaction quality, not the source of truth for the product model.

Store reference screenshots under `references/screenshots/` using descriptive filenames so the design discussion can cite them directly as new examples are added.
