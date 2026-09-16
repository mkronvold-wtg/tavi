import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { BackupsService } from './backups.service';
import { PrismaService } from './prisma.service';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  const actor: SessionUser = {
    email: 'admin@tavi.local',
    id: 'user-1',
    name: 'Tavi Admin',
    role: 'admin',
  };

  const createService = () => {
    const auditEventDeleteManyMock = jest.fn();
    const auditLogRetentionFindUniqueMock = jest.fn();
    const loggerErrorMock = jest.fn();
    const loggerLogMock = jest.fn();
    const notificationDeliveryAttemptDeleteManyMock = jest.fn();
    const notificationEventDeleteManyMock = jest.fn();
    const executeRawMock = jest.fn();
    const queryRawMock = jest.fn();
    const recordAuditMock = jest.fn();
    const requireAdminAccessMock = jest.fn();
    const transactionMock = jest.fn(async (operations: unknown[]) =>
      Promise.all(operations as Promise<unknown>[]),
    );
    const pruneStoredBackupsMock = jest.fn();
    const listStoredBackupsMock = jest.fn();

    const prisma = {
      $executeRaw: executeRawMock,
      $queryRaw: queryRawMock,
      $transaction: transactionMock,
      auditEvent: {
        deleteMany: auditEventDeleteManyMock,
      },
      auditLogRetention: {
        findUnique: auditLogRetentionFindUniqueMock,
      },
      notificationDeliveryAttempt: {
        deleteMany: notificationDeliveryAttemptDeleteManyMock,
      },
      notificationEvent: {
        deleteMany: notificationEventDeleteManyMock,
      },
    } as unknown as PrismaService;
    const authService = {
      recordAudit: recordAuditMock,
      requireAdminAccess: requireAdminAccessMock,
    } as unknown as AuthService;
    const backupsService = {
      listStoredBackups: listStoredBackupsMock,
      pruneStoredBackups: pruneStoredBackupsMock,
    } as unknown as BackupsService;
    const logger = {
      error: loggerErrorMock,
      log: loggerLogMock,
    } as unknown as AppLogger;

    return {
      mocks: {
        auditEventDeleteManyMock,
        auditLogRetentionFindUniqueMock,
        listStoredBackupsMock,
        loggerErrorMock,
        loggerLogMock,
        notificationDeliveryAttemptDeleteManyMock,
        notificationEventDeleteManyMock,
        executeRawMock,
        pruneStoredBackupsMock,
        queryRawMock,
        recordAuditMock,
        requireAdminAccessMock,
        transactionMock,
      },
      service: new RetentionService(
        prisma,
        authService,
        backupsService,
        logger,
      ),
    };
  };

  it('returns retention status with live estimates and legacy audit fallback', async () => {
    const { service, mocks } = createService();

    mocks.auditLogRetentionFindUniqueMock.mockResolvedValue({
      olderThan: 'six_months',
    });
    mocks.listStoredBackupsMock.mockResolvedValue([
      {
        createdAt: '2026-04-01T00:00:00.000Z',
        fileName: 'backup-1.json',
        modifiedAt: '2026-04-10T00:00:00.000Z',
        protected: false,
        protectedAt: null,
        protectedByName: null,
        sizeBytes: 512,
      },
      {
        createdAt: '2025-01-01T00:00:00.000Z',
        fileName: 'backup-2.json',
        modifiedAt: '2025-01-01T00:00:00.000Z',
        protected: false,
        protectedAt: null,
        protectedByName: null,
        sizeBytes: 256,
      },
    ]);
    mocks.queryRawMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(4), retainedSizeBytes: BigInt(400) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(3), retainedSizeBytes: BigInt(300) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(2), retainedSizeBytes: BigInt(200) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(5), retainedSizeBytes: BigInt(500) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(7), retainedSizeBytes: BigInt(700) },
      ]);

    const result = await service.getRetentionStatus(actor);

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(result).toEqual({
      backups: {
        estimatedSizeBytes: 768,
        policy: {
          dailyCount: 7,
          monthlyCount: 3,
          weeklyCount: 4,
        },
        retainedItemCount: 2,
      },
      changes: {
        estimatedSizeBytes: 300,
        policy: 'six_months',
        retainedItemCount: 3,
      },
      logins: {
        estimatedSizeBytes: 400,
        policy: 'six_months',
        retainedItemCount: 4,
      },
      notifications: {
        estimatedSizeBytes: 1400,
        policy: 'one_month',
        retainedItemCount: 14,
      },
    });
  });

  it('stores retention settings and records the update', async () => {
    const { service, mocks } = createService();

    mocks.executeRawMock.mockResolvedValue(BigInt(1));
    mocks.listStoredBackupsMock.mockResolvedValue([]);
    mocks.queryRawMock.mockResolvedValue([
      { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
    ]);

    const result = await service.updateRetentionSettings(
      {
        changes: 'twenty_four_months',
        logins: 'thirty_six_months',
        notifications: 'two_weeks',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.executeRawMock).toHaveBeenCalledTimes(1);
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      actor,
      'auth',
      actor.id,
      'retention_settings_updated',
      {
        changes: 'twenty_four_months',
        logins: 'thirty_six_months',
        notifications: 'two_weeks',
      },
    );
    expect(result.backups.policy).toEqual({
      dailyCount: 7,
      monthlyCount: 3,
      weeklyCount: 4,
    });
    expect(result.notifications.policy).toBe('two_weeks');
  });

  it('prunes backups with the resolved tiered retention policy', async () => {
    const { service, mocks } = createService();

    mocks.auditLogRetentionFindUniqueMock.mockResolvedValue(null);
    mocks.pruneStoredBackupsMock.mockResolvedValue({
      deletedCount: 2,
      deletedSizeBytes: 1024,
    });
    mocks.listStoredBackupsMock.mockResolvedValue([]);
    mocks.queryRawMock
      .mockResolvedValueOnce([
        {
          backupDailyCount: 1,
          backupMonthlyCount: 0,
          backupRetention: 'six_months',
          backupWeeklyCount: 2,
          changeRetention: 'twelve_months',
          loginRetention: 'twelve_months',
          notificationRetention: 'one_month',
        },
      ])
      .mockResolvedValue([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ]);

    const result = await service.pruneRetentionData(
      { target: 'backups' },
      actor,
    );

    expect(mocks.pruneStoredBackupsMock).toHaveBeenCalledWith({
      dailyCount: 1,
      monthlyCount: 0,
      weeklyCount: 2,
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      actor,
      'auth',
      actor.id,
      'retention_pruned',
      {
        deletedCount: 2,
        deletedSizeBytes: 1024,
        policy: {
          dailyCount: 1,
          monthlyCount: 0,
          weeklyCount: 2,
        },
        target: 'backups',
      },
    );
    expect(result.deletedCount).toBe(2);
  });

  it('prunes notification retention across audit events, notifications, and attempts', async () => {
    const { service, mocks } = createService();

    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-04-20T03:15:00.000Z').getTime());
    mocks.auditLogRetentionFindUniqueMock.mockResolvedValue(null);
    mocks.listStoredBackupsMock.mockResolvedValue([]);
    mocks.queryRawMock
      .mockResolvedValueOnce([
        {
          backupRetention: 'six_months',
          backupDailyCount: 7,
          backupMonthlyCount: 3,
          backupWeeklyCount: 4,
          changeRetention: 'twelve_months',
          loginRetention: 'twelve_months',
          notificationRetention: 'one_month',
        },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(2), retainedSizeBytes: BigInt(200) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(3), retainedSizeBytes: BigInt(300) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(4), retainedSizeBytes: BigInt(400) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ])
      .mockResolvedValueOnce([
        { retainedCount: BigInt(0), retainedSizeBytes: BigInt(0) },
      ]);
    mocks.auditEventDeleteManyMock.mockResolvedValue({ count: 2 });
    mocks.notificationDeliveryAttemptDeleteManyMock.mockResolvedValue({
      count: 4,
    });
    mocks.notificationEventDeleteManyMock.mockResolvedValue({ count: 3 });

    const result = await service.pruneRetentionData(
      {
        target: 'notifications',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.transactionMock).toHaveBeenCalled();
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      actor,
      'auth',
      actor.id,
      'retention_pruned',
      {
        deletedCount: 9,
        deletedSizeBytes: 900,
        policy: 'one_month',
        target: 'notifications',
      },
    );
    expect(result).toEqual({
      deletedCount: 9,
      deletedSizeBytes: 900,
      settings: {
        backups: {
          estimatedSizeBytes: 0,
          policy: {
            dailyCount: 7,
            monthlyCount: 3,
            weeklyCount: 4,
          },
          retainedItemCount: 0,
        },
        changes: {
          estimatedSizeBytes: 0,
          policy: 'twelve_months',
          retainedItemCount: 0,
        },
        logins: {
          estimatedSizeBytes: 0,
          policy: 'twelve_months',
          retainedItemCount: 0,
        },
        notifications: {
          estimatedSizeBytes: 0,
          policy: 'one_month',
          retainedItemCount: 0,
        },
      },
      target: 'notifications',
    });
  });
});
