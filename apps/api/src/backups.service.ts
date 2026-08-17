import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { appVersion } from '@tavi/config';
import {
  ImportJobStatus,
  ImportOverlapAction,
  ImportRowOutcome,
  NotificationKind,
  NotificationStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type {
  ApplyBackupRestoreInput,
  ApplyBackupRestoreResult,
  BackupRestoreProjectPreview,
  BackupRestoreUserPreview,
  BackupRestorePreview,
  BackupStatus,
  PreviewBackupRestoreInput,
  UpdateBackupSettingsInput,
  UploadBackupFileInput,
} from '@tavi/schemas';
import {
  backupRetentionWindowSchema,
  emailAddressSchema,
  localAccountNameSchema,
  logRetentionWindowSchema,
  notificationRetentionWindowSchema,
  prioritySchema,
  projectStatusSchema,
  roleSchema,
  taskStatusSchema,
  workspaceUserConfigSchema,
} from '@tavi/schemas';
import { normalizeDigestTimeToHour } from './digest-time';
import { z } from 'zod';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import {
  parseStoredWorkspaceUserConfig,
  serializeWorkspaceUserConfig,
} from './user-config';

const BACKUP_FORMAT = 'tavi-backup-v1';
const BACKUP_SETTINGS_ID = 'global';
const RETENTION_SETTINGS_ID = 'global';
const DEFAULT_BACKUP_SCHEDULE_TIME = '02:00';
const DEFAULT_DAILY_DIGEST_TIME = '11:00';
const DEFAULT_BACKUP_RETENTION = 'six_months';
const DEFAULT_LOGIN_RETENTION = 'twelve_months';
const DEFAULT_CHANGE_RETENTION = 'twelve_months';
const DEFAULT_NOTIFICATION_RETENTION = 'one_month';
const backupTaskStatusSchema = z.preprocess(
  (value) => (value === 'todo' ? 'not_started' : value),
  taskStatusSchema,
);

function buildBackupFileName(now: Date) {
  const compact = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `tavi-backup-${compact}.json`;
}

const backupUserRecordSchema = z.object({
  createdAt: z.string().min(1),
  dailyDigestEnabled: z.boolean(),
  dailyDigestTime: z.string().min(1).optional(),
  email: emailAddressSchema,
  id: z.string().min(1),
  name: localAccountNameSchema,
  passwordHash: z.string().min(1),
  personalTodoRetention: z
    .enum([
      'never',
      'one_month',
      'three_months',
      'six_months',
      'twelve_months',
      'delete_when_done',
    ])
    .optional()
    .default('never'),
  personalTodoRemindersEnabled: z.boolean().optional().default(true),
  userConfig: workspaceUserConfigSchema.optional(),
  updatedAt: z.string().min(1),
});

const backupRoleAssignmentRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  role: roleSchema,
  updatedAt: z.string().min(1),
  userId: z.string().min(1),
});

const backupProjectRecordSchema = z.object({
  archivedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  derivedStatus: projectStatusSchema,
  displayStatus: projectStatusSchema,
  dueDate: z.string().min(1).nullable(),
  id: z.string().min(1),
  manualStatus: projectStatusSchema.nullable(),
  notes: z.string().nullable(),
  ownerUserId: z.string().min(1).nullable(),
  priority: prioritySchema,
  references: z.string().nullable(),
  sourceExternalId: z.string().nullable(),
  sourceSystem: z.string().nullable(),
  taskBlockedCount: z.number().int(),
  taskCanceledCount: z.number().int(),
  taskDoneCount: z.number().int(),
  taskInProgressCount: z.number().int(),
  taskOnHoldCount: z.number().int(),
  taskOverdueCount: z.number().int(),
  taskTodoCount: z.number().int(),
  taskTotalCount: z.number().int(),
  title: z.string().min(1),
  updatedAt: z.string().min(1),
});

const backupTaskRecordSchema = z.object({
  archivedAt: z.string().min(1).nullable(),
  assigneeUserId: z.string().min(1).nullable(),
  completedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  dueDate: z.string().min(1).nullable(),
  id: z.string().min(1),
  notes: z.string().nullable(),
  priority: prioritySchema,
  projectId: z.string().min(1),
  sortOrder: z.number().int(),
  sourceExternalId: z.string().nullable(),
  sourceSystem: z.string().nullable(),
  status: backupTaskStatusSchema,
  title: z.string().min(1),
  updatedAt: z.string().min(1),
});

const backupSavedViewRecordSchema = z.object({
  createdAt: z.string().min(1),
  filtersJson: z.unknown().nullable(),
  groupBy: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  search: z.string(),
  statusFilter: projectStatusSchema.nullable(),
  updatedAt: z.string().min(1),
  userId: z.string().min(1),
});

const backupProjectViewStateRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  projectId: z.string().min(1),
  updatedAt: z.string().min(1),
  userId: z.string().min(1),
  viewedAt: z.string().min(1),
});

const backupTaskViewStateRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  taskId: z.string().min(1),
  updatedAt: z.string().min(1),
  userId: z.string().min(1),
});

const backupImportJobRecordSchema = z.object({
  completedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  createdByUserId: z.string().min(1),
  createdProjectCount: z.number().int(),
  createdRowCount: z.number().int(),
  createdTaskCount: z.number().int(),
  failedRowCount: z.number().int(),
  fileName: z.string().min(1),
  headers: z.unknown().nullable(),
  id: z.string().min(1),
  lastError: z.string().nullable(),
  mapping: z.unknown().nullable(),
  skippedRowCount: z.number().int(),
  sourceContent: z.string(),
  sourceSystem: z.string().min(1),
  status: z.string().min(1),
  suggestedMapping: z.unknown().nullable(),
  totalRowCount: z.number().int(),
  updatedAt: z.string().min(1),
  updatedProjectCount: z.number().int(),
  updatedRowCount: z.number().int(),
  updatedTaskCount: z.number().int(),
});

const backupImportRowRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  importId: z.string().min(1),
  message: z.string().nullable(),
  projectId: z.string().nullable(),
  projectOutcome: z.string().min(1),
  projectOverlapAction: z.string().min(1),
  rawData: z.unknown(),
  rowNumber: z.number().int(),
  rowOutcome: z.string().min(1),
  taskId: z.string().nullable(),
  taskOutcome: z.string().min(1),
  taskOverlapAction: z.string().min(1),
  updatedAt: z.string().min(1),
  validationErrors: z.unknown().nullable(),
});

const backupAuditEventRecordSchema = z.object({
  action: z.string().min(1),
  actorEmail: z.string().min(1),
  actorName: z.string().min(1),
  actorRole: roleSchema.nullable(),
  actorUserId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  entityId: z.string().min(1),
  entityType: z.enum(['auth', 'project', 'saved_view', 'task']),
  id: z.string().min(1),
  metadata: z.unknown().nullable(),
});

const backupAuditLogRetentionRecordSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
  olderThan: z.enum([
    'one_day',
    'one_week',
    'one_month',
    'three_months',
    'six_months',
    'one_year',
  ]),
  updatedAt: z.string().min(1),
});

const backupEmailSettingsRecordSchema = z.object({
  createdAt: z.string().min(1),
  dragHandlesEnabled: z.boolean(),
  enabled: z.boolean(),
  id: z.string().min(1),
  updatedAt: z.string().min(1),
  dailyDigestTime: z.string().min(1).optional(),
});

const backupSettingsRecordSchema = z.object({
  createdAt: z.string().min(1),
  enabled: z.boolean(),
  id: z.string().min(1),
  lastError: z.string().nullable(),
  lastFailureAt: z.string().min(1).nullable(),
  lastScheduledRunAt: z.string().min(1).nullable(),
  lastSuccessAt: z.string().min(1).nullable(),
  scheduleTime: z.string().min(1),
  updatedAt: z.string().min(1),
});

const backupRetentionSettingsRecordSchema = z.object({
  backupRetention: backupRetentionWindowSchema,
  changeRetention: logRetentionWindowSchema,
  createdAt: z.string().min(1),
  id: z.string().min(1),
  loginRetention: logRetentionWindowSchema,
  notificationRetention: notificationRetentionWindowSchema,
  updatedAt: z.string().min(1),
});

const backupNotificationEventRecordSchema = z.object({
  attemptCount: z.number().int(),
  createdAt: z.string().min(1),
  dedupeKey: z.string().nullable(),
  failedAt: z.string().min(1).nullable(),
  id: z.string().min(1),
  kind: z.string().min(1),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().min(1),
  payload: z.unknown(),
  recipientUserId: z.string().min(1).nullable(),
  sentAt: z.string().min(1).nullable(),
  skippedAt: z.string().min(1).nullable(),
  status: z.string().min(1),
  updatedAt: z.string().min(1),
});

const backupNotificationDeliveryAttemptRecordSchema = z.object({
  createdAt: z.string().min(1),
  error: z.string().nullable(),
  id: z.string().min(1),
  notificationId: z.string().min(1),
  status: z.string().min(1),
});

const backupSnapshotSchema = z.object({
  appVersion: z.string().min(1).nullable().optional(),
  createdAt: z.string().min(1),
  data: z.object({
    auditEvents: z.array(backupAuditEventRecordSchema),
    auditLogRetention: backupAuditLogRetentionRecordSchema.nullable(),
    backupSettings: backupSettingsRecordSchema.nullable(),
    emailSettings: backupEmailSettingsRecordSchema.nullable(),
    importJobs: z.array(backupImportJobRecordSchema),
    importRows: z.array(backupImportRowRecordSchema),
    notificationDeliveryAttempts: z.array(
      backupNotificationDeliveryAttemptRecordSchema,
    ),
    notificationEvents: z.array(backupNotificationEventRecordSchema),
    projects: z.array(backupProjectRecordSchema),
    projectViewStates: z
      .array(backupProjectViewStateRecordSchema)
      .optional()
      .default([]),
    taskViewStates: z
      .array(backupTaskViewStateRecordSchema)
      .optional()
      .default([]),
    retentionSettings: backupRetentionSettingsRecordSchema.nullable(),
    roleAssignments: z.array(backupRoleAssignmentRecordSchema),
    savedViews: z.array(backupSavedViewRecordSchema),
    tasks: z.array(backupTaskRecordSchema),
    users: z.array(backupUserRecordSchema),
  }),
  format: z.literal(BACKUP_FORMAT),
  trigger: z.string().min(1),
});

type BackupSnapshot = z.infer<typeof backupSnapshotSchema>;
type BackupAuditLogRetentionRecord = z.infer<
  typeof backupAuditLogRetentionRecordSchema
>;
type BackupProjectRecord = z.infer<typeof backupProjectRecordSchema>;
type BackupRetentionSettingsRecord = z.infer<
  typeof backupRetentionSettingsRecordSchema
>;
type BackupRoleAssignmentRecord = z.infer<
  typeof backupRoleAssignmentRecordSchema
>;
type BackupTaskRecord = z.infer<typeof backupTaskRecordSchema>;
type BackupUserRecord = z.infer<typeof backupUserRecordSchema>;
type CurrentProjectLookup = {
  id: string;
  title: string;
};
type CurrentUserLookup = {
  email: string;
  id: string;
  name: string;
};
type StoredRetentionSettingsRow = {
  backupRetention: string;
  changeRetention: string;
  createdAt: Date;
  id: string;
  loginRetention: string;
  notificationRetention: string;
  updatedAt: Date;
};

function getDefaultBackupDirectory() {
  const cwd = process.cwd();
  const leaf = path.basename(cwd);

  if (leaf === 'api' || leaf === 'worker') {
    return path.resolve(cwd, '../../backups');
  }

  return path.resolve(cwd, 'backups');
}

function getConfiguredBackupDirectories() {
  const candidates: string[] = [];
  const configured = process.env.BACKUP_DIRECTORY?.trim();
  const hostConfigured = process.env.BACKUP_HOST_DIRECTORY?.trim();

  if (configured) {
    candidates.push(path.resolve(configured));
  }

  if (hostConfigured) {
    candidates.push(path.resolve(hostConfigured));
  }

  candidates.push(getDefaultBackupDirectory());

  return [...new Set(candidates)];
}

async function resolveBackupDirectory() {
  for (const directory of getConfiguredBackupDirectories()) {
    try {
      await fs.mkdir(directory, { recursive: true });
      return directory;
    } catch {
      continue;
    }
  }

  throw new BadRequestException('Backup directory is not accessible');
}

function sanitizeBackupFileName(fileName: string) {
  const trimmed = fileName.trim();

  if (
    !trimmed ||
    path.basename(trimmed) !== trimmed ||
    !trimmed.endsWith('.json')
  ) {
    throw new BadRequestException('Backup file name is invalid');
  }

  return trimmed;
}

function toDateOrNull(value: string | null) {
  return value ? new Date(value) : null;
}

function readBackupUserDailyDigestTime(
  user: BackupUserRecord,
  snapshot: BackupSnapshot,
) {
  return normalizeDigestTimeToHour(
    user.dailyDigestTime ??
      snapshot.data.emailSettings?.dailyDigestTime ??
      DEFAULT_DAILY_DIGEST_TIME,
    DEFAULT_DAILY_DIGEST_TIME,
  );
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function mapLegacyAuditRetentionWindow(
  value: BackupAuditLogRetentionRecord['olderThan'],
): BackupRetentionSettingsRecord['loginRetention'] {
  if (value === 'six_months') {
    return 'six_months';
  }

  if (value === 'one_year') {
    return 'twelve_months';
  }

  return 'three_months';
}

function readBackupRetentionSettings(snapshot: BackupSnapshot) {
  if (snapshot.data.retentionSettings) {
    return snapshot.data.retentionSettings;
  }

  const legacyWindow = snapshot.data.auditLogRetention?.olderThan;
  const legacyLogRetention = legacyWindow
    ? mapLegacyAuditRetentionWindow(legacyWindow)
    : null;

  return {
    backupRetention: DEFAULT_BACKUP_RETENTION,
    changeRetention: legacyLogRetention ?? DEFAULT_CHANGE_RETENTION,
    createdAt: snapshot.createdAt,
    id: 'global',
    loginRetention: legacyLogRetention ?? DEFAULT_LOGIN_RETENTION,
    notificationRetention: DEFAULT_NOTIFICATION_RETENTION,
    updatedAt: snapshot.createdAt,
  } satisfies BackupRetentionSettingsRecord;
}

function isBackupRetentionWindow(value: string) {
  return (
    value === 'one_week' ||
    value === 'two_weeks' ||
    value === 'one_month' ||
    value === 'three_months' ||
    value === 'six_months' ||
    value === 'forever'
  );
}

function isLogRetentionWindow(value: string) {
  return (
    value === 'three_months' ||
    value === 'six_months' ||
    value === 'twelve_months' ||
    value === 'twenty_four_months' ||
    value === 'thirty_six_months'
  );
}

function isNotificationRetentionWindow(value: string) {
  return value === 'one_week' || value === 'two_weeks' || value === 'one_month';
}

function toBackupRetentionSettingsRecord(
  row: StoredRetentionSettingsRow | null,
): BackupRetentionSettingsRecord | null {
  if (
    !row ||
    !isBackupRetentionWindow(row.backupRetention) ||
    !isLogRetentionWindow(row.changeRetention) ||
    !isLogRetentionWindow(row.loginRetention) ||
    !isNotificationRetentionWindow(row.notificationRetention)
  ) {
    return null;
  }

  return {
    backupRetention: row.backupRetention,
    changeRetention: row.changeRetention,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    loginRetention: row.loginRetention,
    notificationRetention: row.notificationRetention,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildSnapshotCounts(snapshot: BackupSnapshot) {
  return {
    auditEvents: snapshot.data.auditEvents.length,
    backupSettings: snapshot.data.backupSettings ? 1 : 0,
    emailSettings: snapshot.data.emailSettings ? 1 : 0,
    importJobs: snapshot.data.importJobs.length,
    importRows: snapshot.data.importRows.length,
    notificationDeliveryAttempts:
      snapshot.data.notificationDeliveryAttempts.length,
    notificationEvents: snapshot.data.notificationEvents.length,
    projects: snapshot.data.projects.length,
    projectViewStates: snapshot.data.projectViewStates.length,
    taskViewStates: snapshot.data.taskViewStates.length,
    retentionSettings: snapshot.data.retentionSettings ? 1 : 0,
    roleAssignments: snapshot.data.roleAssignments.length,
    savedViews: snapshot.data.savedViews.length,
    tasks: snapshot.data.tasks.length,
    users: snapshot.data.users.length,
  };
}

@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async getBackupStatus(): Promise<BackupStatus> {
    const [settings, directoryState] = await Promise.all([
      this.readBackupSettings(),
      this.readBackupDirectoryState(),
    ]);

    return {
      backupDirectory: directoryState.directory,
      backupDirectoryAccessible: directoryState.accessible,
      backups: directoryState.backups,
      enabled: settings?.enabled ?? false,
      lastError: settings?.lastError ?? null,
      lastFailureAt: settings?.lastFailureAt?.toISOString() ?? null,
      lastScheduledRunAt: settings?.lastScheduledRunAt?.toISOString() ?? null,
      lastSuccessAt: settings?.lastSuccessAt?.toISOString() ?? null,
      scheduleTime: settings?.scheduleTime ?? DEFAULT_BACKUP_SCHEDULE_TIME,
    };
  }

  async listStoredBackups() {
    const directoryState = await this.readBackupDirectoryState();
    return directoryState.backups;
  }

  async pruneStoredBackups(cutoff: Date | null) {
    if (cutoff === null) {
      return {
        deletedCount: 0,
        deletedSizeBytes: 0,
      };
    }

    const directoryState = await this.readBackupDirectoryState();

    if (!directoryState.accessible) {
      return {
        deletedCount: 0,
        deletedSizeBytes: 0,
      };
    }

    let deletedCount = 0;
    let deletedSizeBytes = 0;

    for (const backup of directoryState.backups) {
      if (new Date(backup.modifiedAt) >= cutoff) {
        continue;
      }

      await fs
        .unlink(path.join(directoryState.directory, backup.fileName))
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
          }

          throw error;
        });
      deletedCount += 1;
      deletedSizeBytes += backup.sizeBytes;
    }

    return {
      deletedCount,
      deletedSizeBytes,
    };
  }

  async updateBackupSettings(
    actor: SessionUser,
    input: UpdateBackupSettingsInput,
  ): Promise<BackupStatus> {
    await this.prisma.backupSettings.upsert({
      where: { id: BACKUP_SETTINGS_ID },
      update: {
        enabled: input.enabled,
        scheduleTime: input.scheduleTime,
      },
      create: {
        enabled: input.enabled,
        id: BACKUP_SETTINGS_ID,
        scheduleTime: input.scheduleTime,
      },
    });

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'backup_settings_updated',
      {
        enabled: input.enabled,
        scheduleTime: input.scheduleTime,
      },
    );

    return this.getBackupStatus();
  }

  async createBackupNow(actor: SessionUser): Promise<BackupStatus> {
    const createdAt = new Date();
    const snapshot = await this.buildSnapshot(createdAt, 'manual');
    const fileName = buildBackupFileName(createdAt);

    try {
      await this.writeSnapshotFile(fileName, snapshot);
      await this.prisma.backupSettings.upsert({
        where: { id: BACKUP_SETTINGS_ID },
        update: {
          lastError: null,
          lastSuccessAt: createdAt,
        },
        create: {
          enabled: false,
          id: BACKUP_SETTINGS_ID,
          lastError: null,
          lastSuccessAt: createdAt,
          scheduleTime: DEFAULT_BACKUP_SCHEDULE_TIME,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.backupSettings.upsert({
        where: { id: BACKUP_SETTINGS_ID },
        update: {
          lastError: message,
          lastFailureAt: createdAt,
        },
        create: {
          enabled: false,
          id: BACKUP_SETTINGS_ID,
          lastError: message,
          lastFailureAt: createdAt,
          scheduleTime: DEFAULT_BACKUP_SCHEDULE_TIME,
        },
      });
      throw error;
    }

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'backup_created',
      {
        fileName,
        trigger: 'manual',
      },
    );

    return this.getBackupStatus();
  }

  async uploadBackupFile(
    actor: SessionUser,
    input: UploadBackupFileInput,
  ): Promise<BackupStatus> {
    const snapshot = this.parseSnapshotContent(input.content);
    const fileName = sanitizeBackupFileName(input.fileName);

    await this.writeSnapshotFile(fileName, snapshot);

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'backup_uploaded',
      {
        fileName,
      },
    );

    return this.getBackupStatus();
  }

  async downloadBackupFile(fileName: string) {
    const sanitizedFileName = sanitizeBackupFileName(fileName);
    const directory = await resolveBackupDirectory();
    const content = await fs
      .readFile(path.join(directory, sanitizedFileName), 'utf8')
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new NotFoundException('Backup file not found');
        }

        throw error;
      });

    return {
      content,
      fileName: sanitizedFileName,
    };
  }

  async deleteBackupFile(
    actor: SessionUser,
    fileName: string,
  ): Promise<BackupStatus> {
    const sanitizedFileName = sanitizeBackupFileName(fileName);
    const directory = await resolveBackupDirectory();
    await fs
      .unlink(path.join(directory, sanitizedFileName))
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new NotFoundException('Backup file not found');
        }

        throw error;
      });

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'backup_deleted',
      {
        fileName: sanitizedFileName,
      },
    );

    return this.getBackupStatus();
  }

  async previewRestore(
    input: PreviewBackupRestoreInput,
  ): Promise<BackupRestorePreview> {
    const snapshot = await this.readSnapshot(input.source);
    const [currentProjects, currentUsers] = await Promise.all([
      this.prisma.project.findMany({
        select: {
          id: true,
          sourceExternalId: true,
          sourceSystem: true,
          title: true,
        },
      }),
      this.prisma.user.findMany({
        select: {
          email: true,
          id: true,
          name: true,
        },
      }),
    ]);

    const currentProjectsById = new Map(
      currentProjects.map((project) => [project.id, project]),
    );
    const currentProjectsBySource = new Map(
      currentProjects
        .filter(
          (project) =>
            project.sourceSystem !== null && project.sourceExternalId !== null,
        )
        .map((project) => [
          `${project.sourceSystem}:${project.sourceExternalId}`,
          project,
        ]),
    );
    const currentUsersByEmail = new Map(
      currentUsers.map((user) => [user.email, user]),
    );
    const currentUsersById = new Map(
      currentUsers.map((user) => [user.id, user]),
    );
    const snapshotUsersById = new Map(
      snapshot.data.users.map((user) => [user.id, user]),
    );
    const snapshotRolesByUserId = new Map(
      snapshot.data.roleAssignments.map((assignment) => [
        assignment.userId,
        assignment,
      ]),
    );
    const tasksByProjectId = new Map<string, BackupTaskRecord[]>();

    for (const task of snapshot.data.tasks) {
      const existing = tasksByProjectId.get(task.projectId);
      if (existing) {
        existing.push(task);
      } else {
        tasksByProjectId.set(task.projectId, [task]);
      }
    }

    const users: BackupRestoreUserPreview[] = snapshot.data.users.map(
      (user) => {
        const idMatch = currentUsersById.get(user.id);
        const emailMatch = currentUsersByEmail.get(user.email);
        const match = emailMatch ?? idMatch ?? null;
        const kind: BackupRestoreUserPreview['conflict']['kind'] =
          emailMatch && emailMatch.id !== user.id
            ? 'email'
            : idMatch
              ? 'id'
              : 'none';
        const roleAssignment = snapshotRolesByUserId.get(user.id);

        return {
          backupId: user.id,
          conflict: {
            existingEmail: match?.email ?? null,
            existingId: match?.id ?? null,
            kind,
            matchedBy: kind === 'none' ? null : kind,
          },
          email: user.email,
          name: user.name,
          role: roleAssignment?.role ?? Role.viewer,
        };
      },
    );

    const projects: BackupRestoreProjectPreview[] = snapshot.data.projects.map(
      (project) => {
        const idMatch = currentProjectsById.get(project.id);
        const sourceKey =
          project.sourceSystem && project.sourceExternalId
            ? `${project.sourceSystem}:${project.sourceExternalId}`
            : null;
        const sourceMatch = sourceKey
          ? currentProjectsBySource.get(sourceKey)
          : null;
        const match = sourceMatch ?? idMatch ?? null;
        const kind: BackupRestoreProjectPreview['conflict']['kind'] =
          sourceMatch ? 'source_identity' : idMatch ? 'id' : 'none';
        const tasks = tasksByProjectId.get(project.id) ?? [];
        const missingOwner =
          project.ownerUserId !== null
            ? this.resolveRestoreUserId(
                project.ownerUserId,
                snapshotUsersById,
                currentUsersById,
                currentUsersByEmail,
              ) === null
            : false;
        const missingAssigneeCount = tasks.filter((task) => {
          if (!task.assigneeUserId) {
            return false;
          }

          return (
            this.resolveRestoreUserId(
              task.assigneeUserId,
              snapshotUsersById,
              currentUsersById,
              currentUsersByEmail,
            ) === null
          );
        }).length;

        return {
          backupId: project.id,
          conflict: {
            existingId: match?.id ?? null,
            existingTitle: match?.title ?? null,
            kind,
            matchedBy:
              kind === 'source_identity'
                ? 'source_identity'
                : kind === 'id'
                  ? 'id'
                  : null,
          },
          dueDate: project.dueDate,
          missingAssigneeCount,
          missingOwner,
          ownerName:
            project.ownerUserId !== null
              ? (snapshotUsersById.get(project.ownerUserId)?.name ?? null)
              : null,
          taskCount: tasks.length,
          title: project.title,
        };
      },
    );

    return {
      counts: buildSnapshotCounts(snapshot),
      createdAt: snapshot.createdAt,
      fileName:
        input.source.kind === 'stored'
          ? sanitizeBackupFileName(input.source.fileName)
          : input.source.fileName,
      format: snapshot.format,
      projects,
      sourceLabel:
        input.source.kind === 'stored'
          ? 'Stored backup'
          : 'Uploaded backup file',
      users,
    };
  }

  async applyRestore(
    actor: SessionUser,
    input: ApplyBackupRestoreInput,
  ): Promise<ApplyBackupRestoreResult> {
    const snapshot = await this.readSnapshot(input.source);

    if (input.scope === 'full') {
      return this.applyFullRestore(actor, snapshot);
    }

    if (input.scope === 'projects_tasks') {
      return this.applyProjectRestore(actor, snapshot, input);
    }

    return this.applyUserRestore(actor, snapshot, input);
  }

  private async applyFullRestore(
    actor: SessionUser,
    snapshot: BackupSnapshot,
  ): Promise<ApplyBackupRestoreResult> {
    // Full restores rewrite large view-state tables; default 5s interactive
    // transaction timeout is too low for production-sized backups.
    await this.prisma.$transaction(
      async (tx) => {
      await tx.notificationDeliveryAttempt.deleteMany({});
      await tx.notificationEvent.deleteMany({});
      await tx.importRow.deleteMany({});
      await tx.importJob.deleteMany({});
      await tx.savedView.deleteMany({});
      await tx.taskViewState.deleteMany({});
      await tx.projectViewState.deleteMany({});
      await tx.auditEvent.deleteMany({});
      await tx.task.deleteMany({});
      await tx.project.deleteMany({});
      await tx.roleAssignment.deleteMany({});
      await tx.user.deleteMany({});
      await tx.auditLogRetention.deleteMany({});
      await tx.$executeRaw(Prisma.sql`DELETE FROM "RetentionSettings"`);
      await tx.emailSettings.deleteMany({});
      await tx.backupSettings.deleteMany({});

      for (const user of snapshot.data.users) {
        await tx.user.create({
          data: {
            createdAt: new Date(user.createdAt),
            dailyDigestEnabled: user.dailyDigestEnabled,
            dailyDigestTime: readBackupUserDailyDigestTime(user, snapshot),
            email: user.email,
            id: user.id,
            name: user.name,
            passwordHash: user.passwordHash,
            personalTodoRetention: user.personalTodoRetention,
            personalTodoRemindersEnabled: user.personalTodoRemindersEnabled,
            userConfigJson: user.userConfig
              ? serializeWorkspaceUserConfig(user.userConfig)
              : null,
            updatedAt: new Date(user.updatedAt),
          },
        });
      }

      for (const assignment of snapshot.data.roleAssignments) {
        await tx.roleAssignment.create({
          data: {
            createdAt: new Date(assignment.createdAt),
            id: assignment.id,
            role: assignment.role,
            updatedAt: new Date(assignment.updatedAt),
            userId: assignment.userId,
          },
        });
      }

      for (const project of snapshot.data.projects) {
        await tx.project.create({
          data: {
            archivedAt: toDateOrNull(project.archivedAt),
            createdAt: new Date(project.createdAt),
            derivedStatus: project.derivedStatus,
            displayStatus: project.displayStatus,
            dueDate: toDateOrNull(project.dueDate),
            id: project.id,
            manualStatus: project.manualStatus,
            notes: project.notes,
            ownerUserId: project.ownerUserId,
            priority: project.priority,
            references: project.references,
            sourceExternalId: project.sourceExternalId,
            sourceSystem: project.sourceSystem,
            taskBlockedCount: project.taskBlockedCount,
            taskCanceledCount: project.taskCanceledCount,
            taskDoneCount: project.taskDoneCount,
            taskInProgressCount: project.taskInProgressCount,
            taskOnHoldCount: project.taskOnHoldCount,
            taskOverdueCount: project.taskOverdueCount,
            taskTodoCount: project.taskTodoCount,
            taskTotalCount: project.taskTotalCount,
            title: project.title,
            updatedAt: new Date(project.updatedAt),
          },
        });
      }

      for (const task of snapshot.data.tasks) {
        await tx.task.create({
          data: {
            archivedAt: toDateOrNull(task.archivedAt),
            assigneeUserId: task.assigneeUserId,
            completedAt: toDateOrNull(task.completedAt),
            createdAt: new Date(task.createdAt),
            dueDate: toDateOrNull(task.dueDate),
            id: task.id,
            notes: task.notes,
            priority: task.priority,
            projectId: task.projectId,
            sortOrder: task.sortOrder,
            sourceExternalId: task.sourceExternalId,
            sourceSystem: task.sourceSystem,
            status: task.status,
            title: task.title,
            updatedAt: new Date(task.updatedAt),
          },
        });
      }

      for (const savedView of snapshot.data.savedViews) {
        await tx.savedView.create({
          data: {
            createdAt: new Date(savedView.createdAt),
            filtersJson:
              savedView.filtersJson === null
                ? Prisma.DbNull
                : toJsonValue(savedView.filtersJson),
            groupBy: savedView.groupBy,
            id: savedView.id,
            name: savedView.name,
            search: savedView.search,
            statusFilter: savedView.statusFilter,
            updatedAt: new Date(savedView.updatedAt),
            userId: savedView.userId,
          },
        });
      }

      for (const viewState of snapshot.data.projectViewStates) {
        await tx.projectViewState.create({
          data: {
            createdAt: new Date(viewState.createdAt),
            id: viewState.id,
            projectId: viewState.projectId,
            updatedAt: new Date(viewState.updatedAt),
            userId: viewState.userId,
            viewedAt: new Date(viewState.viewedAt),
          },
        });
      }

      if (snapshot.data.projectViewStates.length === 0) {
        const viewedAt = new Date();

        await tx.projectViewState.createMany({
          data: snapshot.data.users.flatMap((user) =>
            snapshot.data.projects.map((project) => ({
              id: `project_view_restore_${user.id}_${project.id}`,
              projectId: project.id,
              userId: user.id,
              viewedAt,
            })),
          ),
        });
      }

      for (const viewState of snapshot.data.taskViewStates) {
        await tx.taskViewState.create({
          data: {
            createdAt: new Date(viewState.createdAt),
            id: viewState.id,
            taskId: viewState.taskId,
            updatedAt: new Date(viewState.updatedAt),
            userId: viewState.userId,
          },
        });
      }

      if (snapshot.data.taskViewStates.length === 0) {
        const activeProjectIds = new Set(
          snapshot.data.projects
            .filter((project) => project.archivedAt === null)
            .map((project) => project.id),
        );

        await tx.taskViewState.createMany({
          data: snapshot.data.users.flatMap((user) =>
            snapshot.data.tasks
              .filter(
                (task) =>
                  task.archivedAt === null &&
                  activeProjectIds.has(task.projectId),
              )
              .map((task) => ({
                id: `task_view_restore_${user.id}_${task.id}`,
                taskId: task.id,
                userId: user.id,
              })),
          ),
          skipDuplicates: true,
        });
      }

      for (const job of snapshot.data.importJobs) {
        await tx.importJob.create({
          data: {
            completedAt: toDateOrNull(job.completedAt),
            createdAt: new Date(job.createdAt),
            createdByUserId: job.createdByUserId,
            createdProjectCount: job.createdProjectCount,
            createdRowCount: job.createdRowCount,
            createdTaskCount: job.createdTaskCount,
            failedRowCount: job.failedRowCount,
            fileName: job.fileName,
            headers:
              job.headers === null ? Prisma.DbNull : toJsonValue(job.headers),
            id: job.id,
            lastError: job.lastError,
            mapping:
              job.mapping === null ? Prisma.DbNull : toJsonValue(job.mapping),
            skippedRowCount: job.skippedRowCount,
            sourceContent: job.sourceContent,
            sourceSystem: job.sourceSystem,
            status: job.status as ImportJobStatus,
            suggestedMapping:
              job.suggestedMapping === null
                ? Prisma.DbNull
                : toJsonValue(job.suggestedMapping),
            totalRowCount: job.totalRowCount,
            updatedAt: new Date(job.updatedAt),
            updatedProjectCount: job.updatedProjectCount,
            updatedRowCount: job.updatedRowCount,
            updatedTaskCount: job.updatedTaskCount,
          },
        });
      }

      for (const row of snapshot.data.importRows) {
        await tx.importRow.create({
          data: {
            createdAt: new Date(row.createdAt),
            id: row.id,
            importId: row.importId,
            message: row.message,
            projectId: row.projectId,
            projectOutcome: row.projectOutcome as ImportRowOutcome,
            projectOverlapAction:
              row.projectOverlapAction as ImportOverlapAction,
            rawData: toJsonValue(row.rawData),
            rowNumber: row.rowNumber,
            rowOutcome: row.rowOutcome as ImportRowOutcome,
            taskId: row.taskId,
            taskOutcome: row.taskOutcome as ImportRowOutcome,
            taskOverlapAction: row.taskOverlapAction as ImportOverlapAction,
            updatedAt: new Date(row.updatedAt),
            validationErrors:
              row.validationErrors === null
                ? Prisma.DbNull
                : toJsonValue(row.validationErrors),
          },
        });
      }

      for (const event of snapshot.data.auditEvents) {
        await tx.auditEvent.create({
          data: {
            action: event.action,
            actorEmail: event.actorEmail,
            actorName: event.actorName,
            actorRole: event.actorRole,
            actorUserId: event.actorUserId,
            createdAt: new Date(event.createdAt),
            entityId: event.entityId,
            entityType: event.entityType,
            id: event.id,
            metadata:
              event.metadata === null
                ? Prisma.DbNull
                : toJsonValue(event.metadata),
          },
        });
      }

      if (snapshot.data.auditLogRetention) {
        await tx.auditLogRetention.create({
          data: {
            createdAt: new Date(snapshot.data.auditLogRetention.createdAt),
            id: snapshot.data.auditLogRetention.id,
            olderThan: snapshot.data.auditLogRetention.olderThan,
            updatedAt: new Date(snapshot.data.auditLogRetention.updatedAt),
          },
        });
      }

      const retentionSettings = readBackupRetentionSettings(snapshot);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "RetentionSettings" (
          "id",
          "backupRetention",
          "loginRetention",
          "changeRetention",
          "notificationRetention",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${retentionSettings.id},
          ${retentionSettings.backupRetention},
          ${retentionSettings.loginRetention},
          ${retentionSettings.changeRetention},
          ${retentionSettings.notificationRetention},
          ${new Date(retentionSettings.createdAt)},
          ${new Date(retentionSettings.updatedAt)}
        )
      `);

      if (snapshot.data.emailSettings) {
        await tx.emailSettings.create({
          data: {
            createdAt: new Date(snapshot.data.emailSettings.createdAt),
            dragHandlesEnabled: snapshot.data.emailSettings.dragHandlesEnabled,
            enabled: snapshot.data.emailSettings.enabled,
            id: snapshot.data.emailSettings.id,
            updatedAt: new Date(snapshot.data.emailSettings.updatedAt),
          },
        });
      }

      if (snapshot.data.backupSettings) {
        await tx.backupSettings.create({
          data: {
            createdAt: new Date(snapshot.data.backupSettings.createdAt),
            enabled: snapshot.data.backupSettings.enabled,
            id: snapshot.data.backupSettings.id,
            lastError: snapshot.data.backupSettings.lastError,
            lastFailureAt: toDateOrNull(
              snapshot.data.backupSettings.lastFailureAt,
            ),
            lastScheduledRunAt: toDateOrNull(
              snapshot.data.backupSettings.lastScheduledRunAt,
            ),
            lastSuccessAt: toDateOrNull(
              snapshot.data.backupSettings.lastSuccessAt,
            ),
            scheduleTime: snapshot.data.backupSettings.scheduleTime,
            updatedAt: new Date(snapshot.data.backupSettings.updatedAt),
          },
        });
      }

      for (const event of snapshot.data.notificationEvents) {
        await tx.notificationEvent.create({
          data: {
            attemptCount: event.attemptCount,
            createdAt: new Date(event.createdAt),
            dedupeKey: event.dedupeKey,
            failedAt: toDateOrNull(event.failedAt),
            id: event.id,
            kind: event.kind as NotificationKind,
            lastError: event.lastError,
            nextAttemptAt: new Date(event.nextAttemptAt),
            payload: toJsonValue(event.payload),
            recipientUserId: event.recipientUserId,
            sentAt: toDateOrNull(event.sentAt),
            skippedAt: toDateOrNull(event.skippedAt),
            status: event.status as NotificationStatus,
            updatedAt: new Date(event.updatedAt),
          },
        });
      }

      for (const attempt of snapshot.data.notificationDeliveryAttempts) {
        await tx.notificationDeliveryAttempt.create({
          data: {
            createdAt: new Date(attempt.createdAt),
            error: attempt.error,
            id: attempt.id,
            notificationId: attempt.notificationId,
            status: attempt.status as NotificationStatus,
          },
        });
      }
      },
      { maxWait: 60_000, timeout: 600_000 },
    );

    const reauthenticateRequired = !this.snapshotHasAdminAccessForActor(
      actor,
      snapshot.data.users,
      snapshot.data.roleAssignments,
    );

    await this.recordRestoreAudit(actor, 'backup_restore_full', {
      backupCreatedAt: snapshot.createdAt,
      fileFormat: snapshot.format,
      trigger: snapshot.trigger,
    });

    return {
      reauthenticateRequired,
      scope: 'full',
      summary: {
        fullRestoreApplied: true,
        projectsCreated: snapshot.data.projects.length,
        projectsReplaced: 0,
        projectsSkipped: 0,
        tasksCreated: snapshot.data.tasks.length,
        usersCreated: snapshot.data.users.length,
        usersReplaced: 0,
        usersSkipped: 0,
      },
    };
  }

  private async applyProjectRestore(
    actor: SessionUser,
    snapshot: BackupSnapshot,
    input: ApplyBackupRestoreInput,
  ): Promise<ApplyBackupRestoreResult> {
    const selectedProjectIds = new Set(input.projectIds ?? []);

    if (selectedProjectIds.size === 0) {
      throw new BadRequestException('Select at least one project to restore');
    }

    const snapshotProjects = snapshot.data.projects.filter((project) =>
      selectedProjectIds.has(project.id),
    );

    if (snapshotProjects.length === 0) {
      throw new BadRequestException(
        'Selected projects are not present in the backup',
      );
    }

    const snapshotUsersById = new Map(
      snapshot.data.users.map((user) => [user.id, user]),
    );
    const snapshotTasksByProjectId = new Map<string, BackupTaskRecord[]>();

    for (const task of snapshot.data.tasks) {
      const existing = snapshotTasksByProjectId.get(task.projectId);
      if (existing) {
        existing.push(task);
      } else {
        snapshotTasksByProjectId.set(task.projectId, [task]);
      }
    }

    const [currentProjects, currentUsers] = await Promise.all([
      this.prisma.project.findMany({
        select: {
          id: true,
          sourceExternalId: true,
          sourceSystem: true,
          title: true,
        },
      }),
      this.prisma.user.findMany({
        select: {
          email: true,
          id: true,
          name: true,
        },
      }),
    ]);

    const currentProjectsById = new Map(
      currentProjects.map((project) => [project.id, project]),
    );
    const currentProjectsBySource = new Map(
      currentProjects
        .filter(
          (project) =>
            project.sourceSystem !== null && project.sourceExternalId !== null,
        )
        .map((project) => [
          `${project.sourceSystem}:${project.sourceExternalId}`,
          project,
        ]),
    );
    const currentUsersByEmail = new Map(
      currentUsers.map((user) => [user.email, user]),
    );
    const currentUsersById = new Map(
      currentUsers.map((user) => [user.id, user]),
    );

    const summary = {
      fullRestoreApplied: false,
      projectsCreated: 0,
      projectsReplaced: 0,
      projectsSkipped: 0,
      tasksCreated: 0,
      usersCreated: 0,
      usersReplaced: 0,
      usersSkipped: 0,
    };

    await this.prisma.$transaction(async (tx) => {
      for (const project of snapshotProjects) {
        const existingProject = this.matchExistingProject(
          project,
          currentProjectsById,
          currentProjectsBySource,
        );
        const conflictAction =
          input.projectConflictResolutions?.[project.id] ??
          (existingProject ? 'skip' : 'replace');

        if (existingProject && conflictAction === 'skip') {
          summary.projectsSkipped += 1;
          continue;
        }

        if (existingProject) {
          await tx.project.delete({
            where: { id: existingProject.id },
          });
          summary.projectsReplaced += 1;
        } else {
          summary.projectsCreated += 1;
        }

        const createdProject = await tx.project.create({
          data: {
            archivedAt: toDateOrNull(project.archivedAt),
            createdAt: new Date(project.createdAt),
            derivedStatus: project.derivedStatus,
            displayStatus: project.displayStatus,
            dueDate: toDateOrNull(project.dueDate),
            manualStatus: project.manualStatus,
            notes: project.notes,
            ownerUserId: this.resolveRestoreUserId(
              project.ownerUserId,
              snapshotUsersById,
              currentUsersById,
              currentUsersByEmail,
            ),
            priority: project.priority,
            references: project.references,
            sourceExternalId: project.sourceExternalId,
            sourceSystem: project.sourceSystem,
            taskBlockedCount: project.taskBlockedCount,
            taskCanceledCount: project.taskCanceledCount,
            taskDoneCount: project.taskDoneCount,
            taskInProgressCount: project.taskInProgressCount,
            taskOnHoldCount: project.taskOnHoldCount,
            taskOverdueCount: project.taskOverdueCount,
            taskTodoCount: project.taskTodoCount,
            taskTotalCount: project.taskTotalCount,
            title: project.title,
            updatedAt: new Date(project.updatedAt),
          },
        });

        const tasks = snapshotTasksByProjectId.get(project.id) ?? [];

        for (const task of tasks) {
          await tx.task.create({
            data: {
              archivedAt: toDateOrNull(task.archivedAt),
              assigneeUserId: this.resolveRestoreUserId(
                task.assigneeUserId,
                snapshotUsersById,
                currentUsersById,
                currentUsersByEmail,
              ),
              completedAt: toDateOrNull(task.completedAt),
              createdAt: new Date(task.createdAt),
              dueDate: toDateOrNull(task.dueDate),
              notes: task.notes,
              priority: task.priority,
              projectId: createdProject.id,
              sortOrder: task.sortOrder,
              sourceExternalId: task.sourceExternalId,
              sourceSystem: task.sourceSystem,
              status: task.status,
              title: task.title,
              updatedAt: new Date(task.updatedAt),
            },
          });
          summary.tasksCreated += 1;
        }
      }

      await this.authService.recordAudit(
        actor,
        'auth',
        actor.id,
        'backup_restore_projects',
        {
          projectsCreated: summary.projectsCreated,
          projectsReplaced: summary.projectsReplaced,
          projectsSkipped: summary.projectsSkipped,
          tasksCreated: summary.tasksCreated,
        },
        tx,
      );
    });

    return {
      reauthenticateRequired: false,
      scope: 'projects_tasks',
      summary,
    };
  }

  private async applyUserRestore(
    actor: SessionUser,
    snapshot: BackupSnapshot,
    input: ApplyBackupRestoreInput,
  ): Promise<ApplyBackupRestoreResult> {
    const selectedUserIds = new Set(input.userIds ?? []);

    if (selectedUserIds.size === 0) {
      throw new BadRequestException('Select at least one user to restore');
    }

    const snapshotUsers = snapshot.data.users.filter((user) =>
      selectedUserIds.has(user.id),
    );

    if (snapshotUsers.length === 0) {
      throw new BadRequestException(
        'Selected users are not present in the backup',
      );
    }

    const roleAssignmentsByUserId = new Map<string, BackupRoleAssignmentRecord>(
      snapshot.data.roleAssignments.map((assignment) => [
        assignment.userId,
        assignment,
      ]),
    );
    const currentUsers = await this.prisma.user.findMany({
      select: {
        email: true,
        id: true,
        name: true,
      },
    });
    const currentUsersByEmail = new Map(
      currentUsers.map((user) => [user.email, user]),
    );
    const currentUsersById = new Map(
      currentUsers.map((user) => [user.id, user]),
    );

    const summary = {
      fullRestoreApplied: false,
      projectsCreated: 0,
      projectsReplaced: 0,
      projectsSkipped: 0,
      tasksCreated: 0,
      usersCreated: 0,
      usersReplaced: 0,
      usersSkipped: 0,
    };

    await this.prisma.$transaction(async (tx) => {
      for (const user of snapshotUsers) {
        const existingUser =
          currentUsersByEmail.get(user.email) ?? currentUsersById.get(user.id);
        const conflictAction =
          input.userConflictResolutions?.[user.id] ??
          (existingUser ? 'skip' : 'replace');
        const roleAssignment = roleAssignmentsByUserId.get(user.id);

        if (existingUser && conflictAction === 'skip') {
          summary.usersSkipped += 1;
          continue;
        }

        if (existingUser) {
          await tx.user.update({
            where: { id: existingUser.id },
            data: {
              dailyDigestEnabled: user.dailyDigestEnabled,
              dailyDigestTime: readBackupUserDailyDigestTime(user, snapshot),
              email: user.email,
              name: user.name,
              passwordHash: user.passwordHash,
              personalTodoRetention: user.personalTodoRetention,
              personalTodoRemindersEnabled: user.personalTodoRemindersEnabled,
              userConfigJson: user.userConfig
                ? serializeWorkspaceUserConfig(user.userConfig)
                : null,
              roleAssignment: roleAssignment
                ? {
                    upsert: {
                      create: { role: roleAssignment.role },
                      update: { role: roleAssignment.role },
                    },
                  }
                : undefined,
            },
          });
          summary.usersReplaced += 1;
          continue;
        }

        await tx.user.create({
          data: {
            createdAt: new Date(user.createdAt),
            dailyDigestEnabled: user.dailyDigestEnabled,
            dailyDigestTime: readBackupUserDailyDigestTime(user, snapshot),
            email: user.email,
            id: user.id,
            name: user.name,
            passwordHash: user.passwordHash,
            personalTodoRetention: user.personalTodoRetention,
            personalTodoRemindersEnabled: user.personalTodoRemindersEnabled,
            userConfigJson: user.userConfig
              ? serializeWorkspaceUserConfig(user.userConfig)
              : null,
            roleAssignment: roleAssignment
              ? {
                  create: {
                    createdAt: new Date(roleAssignment.createdAt),
                    id: roleAssignment.id,
                    role: roleAssignment.role,
                    updatedAt: new Date(roleAssignment.updatedAt),
                  },
                }
              : undefined,
            updatedAt: new Date(user.updatedAt),
          },
        });
        summary.usersCreated += 1;
      }

      await this.authService.recordAudit(
        actor,
        'auth',
        actor.id,
        'backup_restore_users',
        {
          usersCreated: summary.usersCreated,
          usersReplaced: summary.usersReplaced,
          usersSkipped: summary.usersSkipped,
        },
        tx,
      );
    });

    const reauthenticateRequired =
      snapshotUsers.some(
        (user) => user.id === actor.id || user.email === actor.email,
      ) &&
      !this.snapshotHasAdminAccessForActor(
        actor,
        snapshotUsers,
        snapshot.data.roleAssignments.filter((assignment) =>
          selectedUserIds.has(assignment.userId),
        ),
      );

    return {
      reauthenticateRequired,
      scope: 'users',
      summary,
    };
  }

  private async readBackupSettings() {
    return this.prisma.backupSettings.findUnique({
      where: { id: BACKUP_SETTINGS_ID },
      select: {
        enabled: true,
        lastError: true,
        lastFailureAt: true,
        lastScheduledRunAt: true,
        lastSuccessAt: true,
        scheduleTime: true,
      },
    });
  }

  private async readRetentionSettings() {
    const rows = await this.prisma.$queryRaw<StoredRetentionSettingsRow[]>(
      Prisma.sql`
        SELECT
          "id",
          "backupRetention",
          "loginRetention",
          "changeRetention",
          "notificationRetention",
          "createdAt",
          "updatedAt"
        FROM "RetentionSettings"
        WHERE "id" = ${RETENTION_SETTINGS_ID}
        LIMIT 1
      `,
    );

    return toBackupRetentionSettingsRecord(rows[0] ?? null);
  }

  private async readBackupDirectoryState() {
    const candidates = getConfiguredBackupDirectories();

    for (const directory of candidates) {
      try {
        await fs.mkdir(directory, { recursive: true });
        const entries = await fs.readdir(directory, { withFileTypes: true });
        const backupFiles = await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map(async (entry) => {
              const filePath = path.join(directory, entry.name);
              const stats = await fs.stat(filePath);

              return {
                createdAt: stats.birthtime.toISOString(),
                fileName: entry.name,
                modifiedAt: stats.mtime.toISOString(),
                sizeBytes: stats.size,
              };
            }),
        );

        backupFiles.sort((left, right) =>
          right.modifiedAt.localeCompare(left.modifiedAt),
        );

        return {
          accessible: true,
          backups: backupFiles,
          directory,
        };
      } catch {
        continue;
      }
    }

    return {
      accessible: false,
      backups: [],
      directory: candidates[0] ?? getDefaultBackupDirectory(),
    };
  }

  private parseSnapshotContent(content: string) {
    try {
      return backupSnapshotSchema.parse(JSON.parse(content) as unknown);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException('Backup file is not a valid Tavi backup');
      }

      throw new BadRequestException('Backup file is not valid JSON');
    }
  }

  private async writeSnapshotFile(fileName: string, snapshot: BackupSnapshot) {
    const directory = await resolveBackupDirectory();

    const tempPath = path.join(directory, `${fileName}.tmp-${process.pid}`);
    const finalPath = path.join(directory, fileName);
    await fs.writeFile(
      tempPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8',
    );
    await fs.rename(tempPath, finalPath);
  }

  private async buildSnapshot(
    createdAt: Date,
    trigger: string,
  ): Promise<BackupSnapshot> {
    const [
      users,
      roleAssignments,
      projects,
      projectViewStates,
      taskViewStates,
      tasks,
      savedViews,
      importJobs,
      importRows,
      auditEvents,
      auditLogRetention,
      retentionSettings,
      emailSettings,
      backupSettings,
      notificationEvents,
      notificationDeliveryAttempts,
    ] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.roleAssignment.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.project.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.projectViewState.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.taskViewState.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.task.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.savedView.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.importJob.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.importRow.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.auditLogRetention.findUnique({
        where: { id: 'global' },
      }),
      this.readRetentionSettings(),
      this.prisma.emailSettings.findUnique({ where: { id: 'global' } }),
      this.prisma.backupSettings.findUnique({
        where: { id: BACKUP_SETTINGS_ID },
      }),
      this.prisma.notificationEvent.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.notificationDeliveryAttempt.findMany({
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      appVersion,
      createdAt: createdAt.toISOString(),
      data: {
        auditEvents: auditEvents.map((event) => ({
          action: event.action,
          actorEmail: event.actorEmail,
          actorName: event.actorName,
          actorRole: event.actorRole,
          actorUserId: event.actorUserId,
          createdAt: event.createdAt.toISOString(),
          entityId: event.entityId,
          entityType: event.entityType,
          id: event.id,
          metadata: event.metadata,
        })),
        auditLogRetention: auditLogRetention
          ? {
              createdAt: auditLogRetention.createdAt.toISOString(),
              id: auditLogRetention.id,
              olderThan: auditLogRetention.olderThan,
              updatedAt: auditLogRetention.updatedAt.toISOString(),
            }
          : null,
        backupSettings: backupSettings
          ? {
              createdAt: backupSettings.createdAt.toISOString(),
              enabled: backupSettings.enabled,
              id: backupSettings.id,
              lastError: backupSettings.lastError,
              lastFailureAt:
                backupSettings.lastFailureAt?.toISOString() ?? null,
              lastScheduledRunAt:
                backupSettings.lastScheduledRunAt?.toISOString() ?? null,
              lastSuccessAt:
                backupSettings.lastSuccessAt?.toISOString() ?? null,
              scheduleTime: backupSettings.scheduleTime,
              updatedAt: backupSettings.updatedAt.toISOString(),
            }
          : null,
        emailSettings: emailSettings
          ? {
              createdAt: emailSettings.createdAt.toISOString(),
              dragHandlesEnabled: emailSettings.dragHandlesEnabled,
              enabled: emailSettings.enabled,
              id: emailSettings.id,
              updatedAt: emailSettings.updatedAt.toISOString(),
            }
          : null,
        importJobs: importJobs.map((job) => ({
          completedAt: job.completedAt?.toISOString() ?? null,
          createdAt: job.createdAt.toISOString(),
          createdByUserId: job.createdByUserId,
          createdProjectCount: job.createdProjectCount,
          createdRowCount: job.createdRowCount,
          createdTaskCount: job.createdTaskCount,
          failedRowCount: job.failedRowCount,
          fileName: job.fileName,
          headers: job.headers,
          id: job.id,
          lastError: job.lastError,
          mapping: job.mapping,
          skippedRowCount: job.skippedRowCount,
          sourceContent: job.sourceContent,
          sourceSystem: job.sourceSystem,
          status: job.status,
          suggestedMapping: job.suggestedMapping,
          totalRowCount: job.totalRowCount,
          updatedAt: job.updatedAt.toISOString(),
          updatedProjectCount: job.updatedProjectCount,
          updatedRowCount: job.updatedRowCount,
          updatedTaskCount: job.updatedTaskCount,
        })),
        importRows: importRows.map((row) => ({
          createdAt: row.createdAt.toISOString(),
          id: row.id,
          importId: row.importId,
          message: row.message,
          projectId: row.projectId,
          projectOutcome: row.projectOutcome,
          projectOverlapAction: row.projectOverlapAction,
          rawData: row.rawData,
          rowNumber: row.rowNumber,
          rowOutcome: row.rowOutcome,
          taskId: row.taskId,
          taskOutcome: row.taskOutcome,
          taskOverlapAction: row.taskOverlapAction,
          updatedAt: row.updatedAt.toISOString(),
          validationErrors: row.validationErrors,
        })),
        notificationDeliveryAttempts: notificationDeliveryAttempts.map(
          (attempt) => ({
            createdAt: attempt.createdAt.toISOString(),
            error: attempt.error,
            id: attempt.id,
            notificationId: attempt.notificationId,
            status: attempt.status,
          }),
        ),
        notificationEvents: notificationEvents.map((event) => ({
          attemptCount: event.attemptCount,
          createdAt: event.createdAt.toISOString(),
          dedupeKey: event.dedupeKey,
          failedAt: event.failedAt?.toISOString() ?? null,
          id: event.id,
          kind: event.kind,
          lastError: event.lastError,
          nextAttemptAt: event.nextAttemptAt.toISOString(),
          payload: event.payload,
          recipientUserId: event.recipientUserId,
          sentAt: event.sentAt?.toISOString() ?? null,
          skippedAt: event.skippedAt?.toISOString() ?? null,
          status: event.status,
          updatedAt: event.updatedAt.toISOString(),
        })),
        projects: projects.map((project) => ({
          archivedAt: project.archivedAt?.toISOString() ?? null,
          createdAt: project.createdAt.toISOString(),
          derivedStatus: project.derivedStatus,
          displayStatus: project.displayStatus,
          dueDate: project.dueDate?.toISOString() ?? null,
          id: project.id,
          manualStatus: project.manualStatus,
          notes: project.notes,
          ownerUserId: project.ownerUserId,
          priority: project.priority,
          references: project.references,
          sourceExternalId: project.sourceExternalId,
          sourceSystem: project.sourceSystem,
          taskBlockedCount: project.taskBlockedCount,
          taskCanceledCount: project.taskCanceledCount,
          taskDoneCount: project.taskDoneCount,
          taskInProgressCount: project.taskInProgressCount,
          taskOnHoldCount: project.taskOnHoldCount,
          taskOverdueCount: project.taskOverdueCount,
          taskTodoCount: project.taskTodoCount,
          taskTotalCount: project.taskTotalCount,
          title: project.title,
          updatedAt: project.updatedAt.toISOString(),
        })),
        projectViewStates: projectViewStates.map((viewState) => ({
          createdAt: viewState.createdAt.toISOString(),
          id: viewState.id,
          projectId: viewState.projectId,
          updatedAt: viewState.updatedAt.toISOString(),
          userId: viewState.userId,
          viewedAt: viewState.viewedAt.toISOString(),
        })),
        taskViewStates: taskViewStates.map((viewState) => ({
          createdAt: viewState.createdAt.toISOString(),
          id: viewState.id,
          taskId: viewState.taskId,
          updatedAt: viewState.updatedAt.toISOString(),
          userId: viewState.userId,
        })),
        retentionSettings,
        roleAssignments: roleAssignments.map((assignment) => ({
          createdAt: assignment.createdAt.toISOString(),
          id: assignment.id,
          role: assignment.role,
          updatedAt: assignment.updatedAt.toISOString(),
          userId: assignment.userId,
        })),
        savedViews: savedViews.map((savedView) => ({
          createdAt: savedView.createdAt.toISOString(),
          filtersJson: savedView.filtersJson,
          groupBy: savedView.groupBy,
          id: savedView.id,
          name: savedView.name,
          search: savedView.search,
          statusFilter: savedView.statusFilter,
          updatedAt: savedView.updatedAt.toISOString(),
          userId: savedView.userId,
        })),
        tasks: tasks.map((task) => ({
          archivedAt: task.archivedAt?.toISOString() ?? null,
          assigneeUserId: task.assigneeUserId,
          completedAt: task.completedAt?.toISOString() ?? null,
          createdAt: task.createdAt.toISOString(),
          dueDate: task.dueDate?.toISOString() ?? null,
          id: task.id,
          notes: task.notes,
          priority: task.priority,
          projectId: task.projectId,
          sortOrder: task.sortOrder,
          sourceExternalId: task.sourceExternalId,
          sourceSystem: task.sourceSystem,
          status: task.status,
          title: task.title,
          updatedAt: task.updatedAt.toISOString(),
        })),
        users: users.map((user) => ({
          createdAt: user.createdAt.toISOString(),
          dailyDigestEnabled: user.dailyDigestEnabled,
          dailyDigestTime: user.dailyDigestTime,
          email: user.email,
          id: user.id,
          name: user.name,
          passwordHash: user.passwordHash,
          personalTodoRetention: user.personalTodoRetention,
          personalTodoRemindersEnabled: user.personalTodoRemindersEnabled,
          userConfig: parseStoredWorkspaceUserConfig(user.userConfigJson),
          updatedAt: user.updatedAt.toISOString(),
        })),
      },
      format: BACKUP_FORMAT,
      trigger,
    };
  }

  private async readSnapshot(source: PreviewBackupRestoreInput['source']) {
    const content =
      source.kind === 'stored'
        ? await fs
            .readFile(
              path.join(
                await resolveBackupDirectory(),
                sanitizeBackupFileName(source.fileName),
              ),
              'utf8',
            )
            .catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new NotFoundException('Backup file not found');
              }

              throw error;
            })
        : source.content;

    try {
      return this.parseSnapshotContent(content);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException('Backup file could not be parsed');
    }
  }

  private matchExistingProject(
    project: BackupProjectRecord,
    currentProjectsById: Map<string, CurrentProjectLookup>,
    currentProjectsBySource: Map<string, CurrentProjectLookup>,
  ) {
    if (project.sourceSystem && project.sourceExternalId) {
      const sourceMatch = currentProjectsBySource.get(
        `${project.sourceSystem}:${project.sourceExternalId}`,
      );

      if (sourceMatch) {
        return sourceMatch;
      }
    }

    return currentProjectsById.get(project.id) ?? null;
  }

  private resolveRestoreUserId(
    backupUserId: string | null,
    snapshotUsersById: Map<string, BackupUserRecord>,
    currentUsersById: Map<string, CurrentUserLookup>,
    currentUsersByEmail: Map<string, CurrentUserLookup>,
  ) {
    if (!backupUserId) {
      return null;
    }

    const directMatch = currentUsersById.get(backupUserId);

    if (directMatch) {
      return directMatch.id;
    }

    const snapshotUser = snapshotUsersById.get(backupUserId);

    if (!snapshotUser) {
      return null;
    }

    return currentUsersByEmail.get(snapshotUser.email)?.id ?? null;
  }

  private snapshotHasAdminAccessForActor(
    actor: SessionUser,
    users: BackupUserRecord[],
    roleAssignments: BackupRoleAssignmentRecord[],
  ) {
    const roleAssignmentsByUserId = new Map(
      roleAssignments.map((assignment) => [assignment.userId, assignment]),
    );
    const matchedUser =
      users.find((user) => user.id === actor.id) ??
      users.find((user) => user.email === actor.email);

    if (!matchedUser) {
      return false;
    }

    return roleAssignmentsByUserId.get(matchedUser.id)?.role === Role.admin;
  }

  private async recordRestoreAudit(
    actor: SessionUser,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    const persistedActor = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true },
    });

    await this.prisma.auditEvent.create({
      data: {
        action,
        actorEmail: actor.email,
        actorName: actor.name,
        actorRole: actor.role,
        actorUserId: persistedActor?.id,
        entityId: actor.id,
        entityType: 'auth',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
