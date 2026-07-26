# tavi Docs

Use this folder as the main entry point for product usage, local setup, and Kubernetes operations.

## Start here

1. Read [`QUICKSTART.md`](./QUICKSTART.md) to choose between [`BUILD.md`](./BUILD.md), [`DOCKER.md`](./DOCKER.md), and [`KUBERNETES.md`](./KUBERNETES.md).
2. Read [`WORKSPACE.md`](./WORKSPACE.md) for the main day-to-day workflow.
3. Read [`SETTINGS.md`](./SETTINGS.md) for the main settings layout, panel launchers, and per-user synced or account-specific preferences.
4. Read [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md) and [`BACKUPS.md`](./BACKUPS.md) for the settings-launched data-management panels.
5. Read [`NOTIFICATIONS.md`](./NOTIFICATIONS.md) and [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md) for email behavior, audit-notification troubleshooting, and local-auth administration.

## User guides

| Guide                                      | Covers                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`WORKSPACE.md`](./WORKSPACE.md)           | Search, grouping, project rollups, task editing, private Personal ToDo use, task moves, and bulk task actions      |
| [`VIEWS.md`](./VIEWS.md)                   | Saving, updating, renaming, deleting, and auditing personal saved views                                            |
| [`NEW_PROJECT.md`](./NEW_PROJECT.md)       | Creating a project from the workspace panel                                                                        |
| [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md)   | Admin-only CSV import, filtered exports, import review, overlap decisions, and workspace clear/reset actions       |
| [`BACKUPS.md`](./BACKUPS.md)               | Automatic backups, backup-now, upload to storage, download, delete, and full or selective restore                  |
| [`NOTIFICATIONS.md`](./NOTIFICATIONS.md)   | Immediate update emails, daily digest behavior, personal to-do due reminders, recipients, and admin email controls |
| [`SETTINGS.md`](./SETTINGS.md)             | Per-user synced preferences, account settings, admin controls, retention, and settings-launched panels             |
| [`LOCAL_ACCOUNTS.md`](./LOCAL_ACCOUNTS.md) | Local-auth account creation, password management, JSON import/export, and reset defaults                           |
| [`AUDIT_HISTORY.md`](./AUDIT_HISTORY.md)   | Project, task, saved-view, auth, audit-change, and audit-notification timelines                                    |

## Setup and operations

| Guide                                  | Covers                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`QUICKSTART.md`](./QUICKSTART.md)     | Which runtime path to use for source builds, published Docker images, or Kubernetes                                      |
| [`BUILD.md`](./BUILD.md)               | Source-based Docker Compose startup, seeded users, and local troubleshooting                                             |
| [`DOCKER.md`](./DOCKER.md)             | Prebuilt GHCR image startup, one-shot migration and seed steps, and local troubleshooting                                |
| [`KUBERNETES.md`](./KUBERNETES.md)     | Raw-manifest deployment, config and secret setup, optional in-cluster PostgreSQL, rollouts, scaling, and troubleshooting |
| [`CI.md`](./CI.md)                     | GitHub Actions validation, container builds, Trivy code scanning, and accepted-risk exception handling                   |
| [`LCM.md`](./LCM.md)                   | Container image refreshes, dependency update automation, deployment consumption, and manual lifecycle review items       |
| [`GITHUB-SETUP.md`](./GITHUB-SETUP.md) | Repository settings for image publishing, code scanning, Dependabot, auto-merge, and GHCR access                         |

## Technical references

| Guide                                      | Covers                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| [`DESIGN.md`](./DESIGN.md)                 | Product goals, scope, UX expectations, and data model                        |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)     | Stack, runtime topology, API and worker boundaries, and deployment model     |
| [`DEVGUIDE.md`](./DEVGUIDE.md)             | AI-oriented lessons learned, validation commands, and common debugging traps |
| [`IMPORT-MAPPING.md`](./IMPORT-MAPPING.md) | CSV import field mapping, checklist splitting, and overlap behavior          |
| [`BRANDING.md`](./BRANDING.md)             | Canonical naming and branding rules                                          |

## Screenshots and reference material

Store screenshots under [`../references/screenshots/`](../references/screenshots/) with descriptive filenames. The current docs use [`../references/screenshots/loop-projects-and-checklist.png`](../references/screenshots/loop-projects-and-checklist.png) as the reference example for legacy Loop checklist data.
