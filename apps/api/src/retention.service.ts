import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BackupFileSummary,
  BackupRetentionPolicy,
  LogRetentionWindow,
  NotificationRetentionWindow,
  PruneRetentionDataInput,
  PruneRetentionDataResponse,
  RetentionStatus,
  RetentionTarget,
  UpdateRetentionSettingsInput,
} from '@tavi/schemas';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { BackupsService } from './backups.service';
import { PrismaService } from './prisma.service';

const RETENTION_SETTINGS_ID = 'global';
const AUTOMATIC_RETENTION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_RETENTION_SETTINGS = {
  changes: 'twelve_months',
  logins: 'twelve_months',
  notifications: 'one_month',
} as const satisfies UpdateRetentionSettingsInput;
const DEFAULT_BACKUP_RETENTION_POLICY = {
  dailyCount: 7,
  monthlyCount: 3,
  weeklyCount: 4,
} as const satisfies BackupRetentionPolicy;

type QueryMetricRow = {
  retainedCount: bigint | number | string | null;
  retainedSizeBytes: bigint | number | string | null;
};
type StoredRetentionSettingsRow = {
  backupDailyCount: number | null;
  backupMonthlyCount: number | null;
  backupRetention: string;
  backupWeeklyCount: number | null;
  changeRetention: string;
  loginRetention: string;
  notificationRetention: string;
};
type ResolvedRetentionSettings = UpdateRetentionSettingsInput & {
  backups: BackupRetentionPolicy;
};

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private automaticPruneTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly backupsService: BackupsService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    void this.runAutomaticRetentionPrune();
    this.automaticPruneTimer = setInterval(() => {
      void this.runAutomaticRetentionPrune();
    }, AUTOMATIC_RETENTION_PRUNE_INTERVAL_MS);
    this.automaticPruneTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.automaticPruneTimer) {
      clearInterval(this.automaticPruneTimer);
      this.automaticPruneTimer = null;
    }
  }

  async getRetentionStatus(actor: SessionUser): Promise<RetentionStatus> {
    this.authService.requireAdminAccess(actor);
    const settings = await this.readResolvedRetentionSettings();
    return this.buildRetentionStatus(settings);
  }

  async updateRetentionSettings(
    input: UpdateRetentionSettingsInput,
    actor: SessionUser,
  ): Promise<RetentionStatus> {
    this.authService.requireAdminAccess(actor);

    await this.writeRetentionSettings(input);

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'retention_settings_updated',
      input,
    );

    return this.buildRetentionStatus({
      ...(await this.readResolvedRetentionSettings()),
      ...input,
    });
  }

  async pruneRetentionData(
    input: PruneRetentionDataInput,
    actor: SessionUser,
  ): Promise<PruneRetentionDataResponse> {
    this.authService.requireAdminAccess(actor);

    const settings = await this.readResolvedRetentionSettings();
    const result = await this.pruneTarget(input.target, settings);

    await this.authService.recordAudit(
      actor,
      'auth',
      actor.id,
      'retention_pruned',
      {
        deletedCount: result.deletedCount,
        deletedSizeBytes: result.deletedSizeBytes,
        policy: this.getPolicyForTarget(input.target, settings),
        target: input.target,
      },
    );

    return {
      ...result,
      settings: await this.buildRetentionStatus(settings),
      target: input.target,
    };
  }

  private async runAutomaticRetentionPrune() {
    try {
      const settings = await this.readResolvedRetentionSettings();
      const results = await Promise.all(
        (['backups', 'logins', 'changes', 'notifications'] as const).map(
          async (target) => ({
            result: await this.pruneTarget(target, settings),
            target,
          }),
        ),
      );
      const changed = results.filter(({ result }) => result.deletedCount > 0);

      if (changed.length > 0) {
        this.logger.log('Applied retention pruning', {
          results: changed.map(({ result, target }) => ({
            deletedCount: result.deletedCount,
            deletedSizeBytes: result.deletedSizeBytes,
            target,
          })),
        });
      }
    } catch (error) {
      this.logger.error('Unable to apply retention pruning', error);
    }
  }

  private async readResolvedRetentionSettings(): Promise<ResolvedRetentionSettings> {
    const [settings, legacyAuditRetention] = await Promise.all([
      this.readStoredRetentionSettings(),
      this.prisma.auditLogRetention.findUnique({
        where: { id: 'global' },
        select: { olderThan: true },
      }),
    ]);
    const legacyLogRetention = legacyAuditRetention?.olderThan
      ? mapLegacyAuditRetentionWindow(legacyAuditRetention.olderThan)
      : null;

    return {
      backups: toBackupRetentionPolicy(settings),
      changes: isLogRetentionWindow(settings?.changeRetention)
        ? settings.changeRetention
        : (legacyLogRetention ?? DEFAULT_RETENTION_SETTINGS.changes),
      logins: isLogRetentionWindow(settings?.loginRetention)
        ? settings.loginRetention
        : (legacyLogRetention ?? DEFAULT_RETENTION_SETTINGS.logins),
      notifications: isNotificationRetentionWindow(
        settings?.notificationRetention,
      )
        ? settings.notificationRetention
        : DEFAULT_RETENTION_SETTINGS.notifications,
    };
  }

  private async readStoredRetentionSettings() {
    const rows = await this.prisma.$queryRaw<StoredRetentionSettingsRow[]>(
      Prisma.sql`
        SELECT
          "backupDailyCount",
          "backupMonthlyCount",
          "backupRetention",
          "backupWeeklyCount",
          "changeRetention",
          "loginRetention",
          "notificationRetention"
        FROM "RetentionSettings"
        WHERE "id" = ${RETENTION_SETTINGS_ID}
        LIMIT 1
      `,
    );

    return rows[0] ?? null;
  }

  private async writeRetentionSettings(input: UpdateRetentionSettingsInput) {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "RetentionSettings" (
        "id",
        "loginRetention",
        "changeRetention",
        "notificationRetention"
      )
      VALUES (
        ${RETENTION_SETTINGS_ID},
        ${input.logins},
        ${input.changes},
        ${input.notifications}
      )
      ON CONFLICT ("id") DO UPDATE
      SET
        "loginRetention" = EXCLUDED."loginRetention",
        "changeRetention" = EXCLUDED."changeRetention",
        "notificationRetention" = EXCLUDED."notificationRetention"
    `);
  }

  private async buildRetentionStatus(
    settings: ResolvedRetentionSettings,
  ): Promise<RetentionStatus> {
    const [backups, logins, changes, notifications] = await Promise.all([
      this.estimateBackupRetention(settings.backups),
      this.estimateLoginRetention(settings.logins),
      this.estimateChangeRetention(settings.changes),
      this.estimateNotificationRetention(settings.notifications),
    ]);

    return {
      backups: {
        estimatedSizeBytes: backups.sizeBytes,
        policy: settings.backups,
        retainedItemCount: backups.itemCount,
      },
      changes: {
        estimatedSizeBytes: changes.sizeBytes,
        policy: settings.changes,
        retainedItemCount: changes.itemCount,
      },
      logins: {
        estimatedSizeBytes: logins.sizeBytes,
        policy: settings.logins,
        retainedItemCount: logins.itemCount,
      },
      notifications: {
        estimatedSizeBytes: notifications.sizeBytes,
        policy: settings.notifications,
        retainedItemCount: notifications.itemCount,
      },
    };
  }

  private async pruneTarget(
    target: RetentionTarget,
    settings: ResolvedRetentionSettings,
  ) {
    switch (target) {
      case 'backups':
        return this.pruneBackups(settings.backups);
      case 'logins':
        return this.pruneLoginRetention(settings.logins);
      case 'changes':
        return this.pruneChangeRetention(settings.changes);
      case 'notifications':
        return this.pruneNotificationRetention(settings.notifications);
    }
  }

  private getPolicyForTarget(
    target: RetentionTarget,
    settings: ResolvedRetentionSettings,
  ) {
    switch (target) {
      case 'backups':
        return settings.backups;
      case 'logins':
        return settings.logins;
      case 'changes':
        return settings.changes;
      case 'notifications':
        return settings.notifications;
    }
  }

  private async estimateBackupRetention(policy: BackupRetentionPolicy) {
    const backups = await this.backupsService.listStoredBackups();
    const retainedFileNames = selectRetainedBackupFileNames(backups, policy);
    const retainedBackups = backups.filter((backup) =>
      retainedFileNames.has(backup.fileName),
    );

    return {
      itemCount: retainedBackups.length,
      sizeBytes: retainedBackups.reduce(
        (total, backup) => total + backup.sizeBytes,
        0,
      ),
    };
  }

  private async pruneBackups(policy: BackupRetentionPolicy) {
    return this.backupsService.pruneStoredBackups(policy);
  }

  private async estimateLoginRetention(policy: LogRetentionWindow) {
    return this.queryAuditMetrics(
      Prisma.sql`
        a."entityType" = 'auth'
        AND (a."action" = 'login' OR a."action" = 'logout')
        AND ${buildCreatedAtPredicate('a', buildLogRetentionCutoff(new Date(), policy), 'after')}
      `,
    );
  }

  private async pruneLoginRetention(policy: LogRetentionWindow) {
    const cutoff = buildLogRetentionCutoff(new Date(), policy);
    const metrics = await this.queryAuditMetrics(
      Prisma.sql`
        a."entityType" = 'auth'
        AND (a."action" = 'login' OR a."action" = 'logout')
        AND ${buildCreatedAtPredicate('a', cutoff, 'before')}
      `,
    );
    const result = await this.prisma.auditEvent.deleteMany({
      where: {
        action: {
          in: ['login', 'logout'],
        },
        createdAt: {
          lt: cutoff,
        },
        entityType: 'auth',
      },
    });

    return {
      deletedCount: result.count,
      deletedSizeBytes: metrics.sizeBytes,
    };
  }

  private async estimateChangeRetention(policy: LogRetentionWindow) {
    return this.queryAuditMetrics(
      Prisma.sql`
        a."entityType" IN ('project', 'task')
        AND ${buildCreatedAtPredicate('a', buildLogRetentionCutoff(new Date(), policy), 'after')}
      `,
    );
  }

  private async pruneChangeRetention(policy: LogRetentionWindow) {
    const cutoff = buildLogRetentionCutoff(new Date(), policy);
    const metrics = await this.queryAuditMetrics(
      Prisma.sql`
        a."entityType" IN ('project', 'task')
        AND ${buildCreatedAtPredicate('a', cutoff, 'before')}
      `,
    );
    const result = await this.prisma.auditEvent.deleteMany({
      where: {
        createdAt: {
          lt: cutoff,
        },
        entityType: {
          in: ['project', 'task'],
        },
      },
    });

    return {
      deletedCount: result.count,
      deletedSizeBytes: metrics.sizeBytes,
    };
  }

  private async estimateNotificationRetention(
    policy: NotificationRetentionWindow,
  ) {
    const cutoff = buildNotificationRetentionCutoff(new Date(), policy);
    const [auditMetrics, eventMetrics, attemptMetrics] = await Promise.all([
      this.queryAuditMetrics(
        Prisma.sql`
          a."action" LIKE 'email_%'
          AND ${buildCreatedAtPredicate('a', cutoff, 'after')}
        `,
      ),
      this.queryNotificationEventMetrics(cutoff, 'after'),
      this.queryNotificationAttemptMetrics(cutoff, 'after'),
    ]);

    return {
      itemCount:
        auditMetrics.itemCount +
        eventMetrics.itemCount +
        attemptMetrics.itemCount,
      sizeBytes:
        auditMetrics.sizeBytes +
        eventMetrics.sizeBytes +
        attemptMetrics.sizeBytes,
    };
  }

  private async pruneNotificationRetention(
    policy: NotificationRetentionWindow,
  ) {
    const cutoff = buildNotificationRetentionCutoff(new Date(), policy);
    const [auditMetrics, eventMetrics, attemptMetrics] = await Promise.all([
      this.queryAuditMetrics(
        Prisma.sql`
          a."action" LIKE 'email_%'
          AND ${buildCreatedAtPredicate('a', cutoff, 'before')}
        `,
      ),
      this.queryNotificationEventMetrics(cutoff, 'before'),
      this.queryNotificationAttemptMetrics(cutoff, 'before'),
    ]);
    const [deletedAuditEvents, deletedAttempts, deletedNotificationEvents] =
      await this.prisma.$transaction([
        this.prisma.auditEvent.deleteMany({
          where: {
            action: {
              startsWith: 'email_',
            },
            createdAt: {
              lt: cutoff,
            },
          },
        }),
        this.prisma.notificationDeliveryAttempt.deleteMany({
          where: {
            notification: {
              createdAt: {
                lt: cutoff,
              },
            },
          },
        }),
        this.prisma.notificationEvent.deleteMany({
          where: {
            createdAt: {
              lt: cutoff,
            },
          },
        }),
      ]);

    return {
      deletedCount:
        deletedAuditEvents.count +
        deletedAttempts.count +
        deletedNotificationEvents.count,
      deletedSizeBytes:
        auditMetrics.sizeBytes +
        eventMetrics.sizeBytes +
        attemptMetrics.sizeBytes,
    };
  }

  private async queryAuditMetrics(filter: Prisma.Sql) {
    const [row] = await this.prisma.$queryRaw<QueryMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "retainedCount",
        COALESCE(SUM(pg_column_size(a)), 0)::bigint AS "retainedSizeBytes"
      FROM "AuditEvent" a
      WHERE ${filter}
    `);

    return normalizeMetrics(row);
  }

  private async queryNotificationEventMetrics(
    cutoff: Date,
    mode: 'before' | 'after',
  ) {
    const [row] = await this.prisma.$queryRaw<QueryMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "retainedCount",
        COALESCE(SUM(pg_column_size(n)), 0)::bigint AS "retainedSizeBytes"
      FROM "NotificationEvent" n
      WHERE ${buildCreatedAtPredicate('n', cutoff, mode)}
    `);

    return normalizeMetrics(row);
  }

  private async queryNotificationAttemptMetrics(
    cutoff: Date,
    mode: 'before' | 'after',
  ) {
    const [row] = await this.prisma.$queryRaw<QueryMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "retainedCount",
        COALESCE(SUM(pg_column_size(a)), 0)::bigint AS "retainedSizeBytes"
      FROM "NotificationDeliveryAttempt" a
      INNER JOIN "NotificationEvent" n
        ON n."id" = a."notificationId"
      WHERE ${buildCreatedAtPredicate('n', cutoff, mode)}
    `);

    return normalizeMetrics(row);
  }
}

function normalizeMetrics(row: QueryMetricRow | undefined) {
  return {
    itemCount: toSafeNumber(row?.retainedCount),
    sizeBytes: toSafeNumber(row?.retainedSizeBytes),
  };
}

function toSafeNumber(value: bigint | number | string | null | undefined) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function buildCreatedAtPredicate(
  alias: string,
  cutoff: Date,
  mode: 'before' | 'after',
) {
  return Prisma.sql`${Prisma.raw(`${alias}."createdAt"`)} ${Prisma.raw(
    mode === 'before' ? '<' : '>=',
  )} ${cutoff}`;
}

function mapLegacyAuditRetentionWindow(olderThan: string): LogRetentionWindow {
  if (olderThan === 'six_months') {
    return 'six_months';
  }

  if (olderThan === 'one_year') {
    return 'twelve_months';
  }

  return 'three_months';
}

function normalizeRetentionCount(
  value: number | null | undefined,
  defaultValue: number,
) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : defaultValue;
}

function toBackupRetentionPolicy(
  row: StoredRetentionSettingsRow | null,
): BackupRetentionPolicy {
  return {
    dailyCount: normalizeRetentionCount(
      row?.backupDailyCount,
      DEFAULT_BACKUP_RETENTION_POLICY.dailyCount,
    ),
    monthlyCount: normalizeRetentionCount(
      row?.backupMonthlyCount,
      DEFAULT_BACKUP_RETENTION_POLICY.monthlyCount,
    ),
    weeklyCount: normalizeRetentionCount(
      row?.backupWeeklyCount,
      DEFAULT_BACKUP_RETENTION_POLICY.weeklyCount,
    ),
  };
}

function getUtcDayKey(value: string) {
  return value.slice(0, 10);
}

function getUtcMonthKey(value: string) {
  return value.slice(0, 7);
}

function getUtcWeekKey(value: string) {
  const date = new Date(value);
  const day = date.getUTCDay() || 7;
  const thursday = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 4 - day,
    ),
  );
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );

  return `${thursday.getUTCFullYear()}-W${week.toString().padStart(2, '0')}`;
}

function addTierRetainedBackups(
  retainedFileNames: Set<string>,
  assignedBucketKeys: Set<string>,
  backups: BackupFileSummary[],
  count: number,
  buildBucketKey: (modifiedAt: string) => string,
) {
  if (count === 0) {
    return;
  }

  for (const backup of backups) {
    if (retainedFileNames.has(backup.fileName) || backup.protected) {
      continue;
    }

    const bucketKey = buildBucketKey(backup.modifiedAt);
    if (assignedBucketKeys.has(bucketKey)) {
      continue;
    }

    retainedFileNames.add(backup.fileName);
    assignedBucketKeys.add(bucketKey);

    if (assignedBucketKeys.size >= count) {
      return;
    }
  }
}

function selectRetainedBackupFileNames(
  backups: BackupFileSummary[],
  policy: BackupRetentionPolicy,
) {
  const retainedFileNames = new Set(
    backups
      .filter((backup) => backup.protected)
      .map((backup) => backup.fileName),
  );

  addTierRetainedBackups(
    retainedFileNames,
    new Set<string>(),
    backups,
    policy.dailyCount,
    getUtcDayKey,
  );
  addTierRetainedBackups(
    retainedFileNames,
    new Set<string>(),
    backups,
    policy.weeklyCount,
    getUtcWeekKey,
  );
  addTierRetainedBackups(
    retainedFileNames,
    new Set<string>(),
    backups,
    policy.monthlyCount,
    getUtcMonthKey,
  );

  return retainedFileNames;
}

function isLogRetentionWindow(value: string | null | undefined) {
  return (
    value === 'three_months' ||
    value === 'six_months' ||
    value === 'twelve_months' ||
    value === 'twenty_four_months' ||
    value === 'thirty_six_months'
  );
}

function isNotificationRetentionWindow(value: string | null | undefined) {
  return value === 'one_week' || value === 'two_weeks' || value === 'one_month';
}

function buildLogRetentionCutoff(reference: Date, policy: LogRetentionWindow) {
  if (policy === 'three_months') {
    return subtractUtcMonths(reference, 3);
  }

  if (policy === 'six_months') {
    return subtractUtcMonths(reference, 6);
  }

  if (policy === 'twelve_months') {
    return subtractUtcMonths(reference, 12);
  }

  if (policy === 'twenty_four_months') {
    return subtractUtcMonths(reference, 24);
  }

  return subtractUtcMonths(reference, 36);
}

function buildNotificationRetentionCutoff(
  reference: Date,
  policy: NotificationRetentionWindow,
) {
  if (policy === 'one_week') {
    return subtractUtcDays(reference, 7);
  }

  if (policy === 'two_weeks') {
    return subtractUtcDays(reference, 14);
  }

  return subtractUtcMonths(reference, 1);
}

function subtractUtcDays(reference: Date, days: number) {
  const next = new Date(reference);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function subtractUtcMonths(reference: Date, months: number) {
  const totalMonths = reference.getUTCFullYear() * 12 + reference.getUTCMonth();
  const nextTotalMonths = totalMonths - months;
  const nextYear = Math.floor(nextTotalMonths / 12);
  const nextMonth = nextTotalMonths % 12;
  const nextDay = Math.min(
    reference.getUTCDate(),
    getUtcDaysInMonth(nextYear, nextMonth),
  );

  return new Date(
    Date.UTC(
      nextYear,
      nextMonth,
      nextDay,
      reference.getUTCHours(),
      reference.getUTCMinutes(),
      reference.getUTCSeconds(),
      reference.getUTCMilliseconds(),
    ),
  );
}

function getUtcDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
