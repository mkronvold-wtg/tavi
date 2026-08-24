# Settings Guide

Tavi now splits personal controls from workspace administration:

1. `User Profile` opens from the signed-in user name in the header and holds self-service account editing plus personal preferences.
2. `Settings` stays visible only for admins and holds workspace-wide controls plus admin tools.

## Layout

Most launcher cards and audit cards are whole-card click targets. If a card opens another panel, that panel also has an explicit `Close` button in its header.

## User Profile

| Section       | Setting                                              | What it changes                                                                                                                          |
| ------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Account       | Name / Email                                         | Updates the current signed-in local account                                                                                              |
| Account       | Current password + Change password + Repeat password | Lets the current signed-in local account rotate its password                                                                             |
| User tool     | Personal ToDo                                        | Opens or closes the current user's private personal task panel                                                                           |
| User-specific | Theme                                                | Cycles through the Light, Sepia, Spring, Ocean, Forest, Autumn, and Night workspace themes and syncs across browsers after login         |
| User-specific | Auto Collapse                                        | Expands one project at a time by collapsing the rest automatically                                                                       |
| User-specific | Bulk Actions                                         | Shows task selection checkboxes and the bulk action bar                                                                                  |
| User-specific | Full Width                                           | Lets the workspace use the full browser width                                                                                            |
| User-specific | Daily Digest                                         | Sets the current user's digest time in browser-local time, saves it in UTC, and replaces immediate non-admin work emails with one digest |
| User-specific | Reset all user settings                              | Resets the current user's synced settings and clears the cached browser copy after confirmation                                          |
| User-specific | User History                                         | Opens the login and auth event history for the current signed-in identity                                                                |
| User tool     | Import/Export                                        | Opens the dedicated import and export panel for non-admin users                                                                          |

Saving profile edits closes the panel after the update is accepted.

## Admin Settings

| Section    | Setting             | What it changes                                                                                                                         |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Admin-only | Email Notifications | Controls the global outbound email switch                                                                                               |
| Admin-only | Task Drag Handles   | Shows or hides manual task-reorder handles for every user in the workspace                                                              |
| Admin-only | Backups             | Opens the dedicated backup and restore panel                                                                                            |
| Admin-only | Import/Export       | Opens the dedicated import and export panel                                                                                             |
| Admin-only | Retention           | Opens retention controls for backups, login history, change history, and notification history                                           |
| Admin-only | Local Accounts      | Opens the local-auth management panel                                                                                                   |
| Admin-only | Audit Logins        | Opens system-wide sign-in audit history                                                                                                 |
| Admin-only | Audit Notifications | Opens system-wide outbound notification and email delivery history                                                                      |
| Admin-only | Audit Changes       | Opens system-wide project and task change history without email delivery rows                                                           |
| Meta       | Version             | Shows the current app version, changelog link, and build date/time. The timezone label toggles between UTC and the browser's local time |

## Recommended use

1. Turn on `Auto Collapse` when you want only one project open during a live review.
2. Turn on `Bulk Actions` before doing large task cleanups.
3. Turn on `Full Width` when project titles, notes, references, or dense task tables need more horizontal space.
4. Turn on `Daily Digest` if you want one scheduled summary email instead of immediate task and project update, assignment, and due-date emails, then save the time shown in your browser's local timezone.
5. Leave `Task Drag Handles` on when editors should be able to manually reorder visible task lists, or turn it off for cleaner review-only sessions.
6. Use the `Import/Export` and `Backups` launcher cards when you need data-management tools without keeping those panels open all the time.
7. Use `Retention` when you want to prune stored backups or older login, change, and notification history based on the current policy estimates.

## Local Accounts entry point

`Local Accounts` opens the dedicated account-management panel documented in [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md).

Behavior depends on role:

1. Admins can manage all local accounts from `Settings`.
2. Non-admins use `User Profile` for their own name, email, and password changes instead.
3. Users who are locked out of local auth can use the login-screen `Forgot password` flow after one failed sign-in attempt to receive a one-time password by email and set a new password without opening `User Profile` first.

## Reset all user settings

`Reset all user settings` restores the current user's personal settings to defaults on the server and then clears the cached tavi copy in the current browser. That includes:

1. Theme
2. Auto Collapse
3. Bulk Actions
4. Full Width
5. Panel open or closed state
6. Per-project `Add Task` visibility
7. Per-project and personal `hide done` toggles
8. Per-user daily digest settings
9. Personal ToDo reminder and retention settings

It does not delete projects, tasks, imports, backups, accounts, or saved views.

## Related panels launched from Settings

1. [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md) covers exports, CSV import staging, import review, and workspace reset.
2. [`BACKUPS.md`](./BACKUPS.md) covers scheduled backups, backup-now, upload, restore, download, and delete.
3. [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md) covers local-auth account management.
4. [`AUDIT_HISTORY.md`](./AUDIT_HISTORY.md) covers audit timelines and filters.

## Non-obvious behavior

1. Saved views are not the same as personal settings. Resetting user settings does not delete saved views from the server.
2. `User History` is for the current user identity, not a full system-wide audit report.
3. `Daily Digest` applies only to non-admin notification emails. Administrative account emails still send immediately when global email is enabled, and password-reset emails still send whenever SMTP is configured even if `Email Notifications` is off.
4. Admin-only email controls do not force users into digest mode or pick a send time for them. Each user chooses whether non-admin notifications arrive immediately or in the daily digest and saves their own digest time.
5. New users default to digest off and a stored UTC digest time of `11:00`, which corresponds to `5:00 AM` CST.
6. `Personal ToDo` opens from `User Profile` after the account card. Its `hide done` preference is still reset by `Reset all user settings`.
7. `Audit Changes` intentionally excludes outbound email-delivery steps. Use `Audit Notifications` when you need the notification timeline or test-email diagnostics.
