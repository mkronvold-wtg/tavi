import { setTimeout as delay } from "node:timers/promises";
import {
  buildEmailHtml,
  escapeHtml,
  parseSmtpUrl,
} from "@tavi/config";
import { Prisma, PrismaClient, type NotificationKind } from "@prisma/client";
import { createTransport, type Transporter } from "nodemailer";
import type { WorkerObservability } from "./worker-observability.js";

const DEFAULT_IDLE_DELAY_MS = 5_000;
const DEFAULT_WORK_DELAY_MS = 500;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60_000;
const DEFAULT_SMTP_URL = "smtp://10.120.64.99:25";
const DEFAULT_SMTP_FROM = "noreply@tavi.local";
const DEFAULT_DAILY_DIGEST_TIME = "11:00";
const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 2, 5, 13, 34];
const EMAIL_AUDIT_SYSTEM_ACTOR = {
  actorEmail: "system@tavi.local",
  actorName: "Tavi System",
  actorRole: "admin" as const,
  actorUserId: null,
};

type ScheduledNotificationKind =
  | "daily_non_admin_digest"
  | "hourly_non_admin_digest"
  | "daily_project_summary"
  | "daily_task_summary"
  | "personal_todo_due_3_days"
  | "personal_todo_due_7_days"
  | "personal_todo_due_today"
  | "personal_todo_due_tomorrow"
  | "personal_todo_overdue"
  | "task_due_3_days"
  | "task_due_7_days"
  | "task_due_today"
  | "task_due_tomorrow"
  | "task_overdue";

type NotificationWorkerOptions = {
  idleDelayMs?: number;
  scheduleIntervalMs?: number;
  workDelayMs?: number;
};

type NotificationRecipient = {
  dailyDigestEnabled: boolean;
  email: string;
  id: string;
  name: string;
  personalTodoRemindersEnabled: boolean;
};

type BufferedSummaryKind =
  | "daily_non_admin_digest"
  | "hourly_non_admin_digest";

export class NotificationWorker {
  private readonly idleDelayMs: number;
  private readonly scheduleIntervalMs: number;
  private readonly workDelayMs: number;
  private readonly fromAddress: string;
  private readonly homeUrl: string;
  private readonly transporter: Transporter | null;
  private readonly configured: boolean;
  private readonly smtpHostLabel: string | null;
  private lastScheduleCheckAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly observability: WorkerObservability,
    options: NotificationWorkerOptions = {},
  ) {
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.scheduleIntervalMs =
      options.scheduleIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
    this.workDelayMs = options.workDelayMs ?? DEFAULT_WORK_DELAY_MS;
    this.fromAddress = process.env.SMTP_FROM ?? DEFAULT_SMTP_FROM;
    this.homeUrl = process.env.TAVI_HOME_URL ?? "http://localhost:5173";

    try {
      const smtpUrl = process.env.SMTP_URL ?? DEFAULT_SMTP_URL;
      const { auth, host, port, secure } = parseSmtpUrl(smtpUrl);
      this.smtpHostLabel = `${host}:${port.toString()}`;

      this.transporter = createTransport({
        host,
        port,
        secure,
        ...(auth ? { auth } : {}),
        ...(secure ? {} : { tls: { rejectUnauthorized: false } }),
      });
      this.configured = true;
      this.observability.logger.info("worker.notifications.transport_ready", {
        host,
        port,
        secure,
      });
    } catch (error) {
      this.transporter = null;
      this.configured = false;
      this.smtpHostLabel = null;
      this.observability.logger.warn("worker.notifications.transport_unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const handledNotification = await this.processNextNotification();
      const scheduledWork = await this.runScheduledWork();
      const handledWork = handledNotification || scheduledWork;

      await delay(handledWork ? this.workDelayMs : this.idleDelayMs, undefined, {
        signal,
      }).catch(() => undefined);
    }
  }

  private async processNextNotification() {
    const eventId = await this.claimNextNotification();

    if (!eventId) {
      return false;
    }

    const startedAt = this.observability.startJob("notification");

    try {
      const event = await this.prisma.notificationEvent.findUnique({
        where: { id: eventId },
        include: {
          recipient: {
            select: {
              dailyDigestEnabled: true,
              email: true,
              id: true,
              name: true,
              personalTodoRemindersEnabled: true,
            },
          },
        },
      });

      if (!event) {
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const skipReason = await this.getSkipReason(event.kind, event.recipient);

      if (skipReason) {
        await this.completeEvent(event, "skipped", { reason: skipReason });
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const email = buildNotificationEmail({
        homeUrl: this.homeUrl,
        kind: event.kind,
        payload: toRecord(event.payload),
        recipientName: event.recipient!.name,
      });

      await this.recordNotificationAuditStep({
        attemptNumber: event.attemptCount,
        detail: `Sending ${email.subject} to ${event.recipient!.email} via ${this.smtpHostLabel ?? "unknown host"}`,
        event,
        status: "processing",
        subject: email.subject,
        title: `Sending ${event.kind.replace(/_/g, " ")}`,
      });

      const sendResult = await this.transporter!.sendMail({
        from: this.fromAddress,
        html: email.html,
        subject: email.subject,
        to: event.recipient!.email,
      });

      await this.completeEvent(event, "sent", {
        response:
          typeof sendResult.response === "string" ? sendResult.response : null,
        subject: email.subject,
      });
      this.observability.logger.info("worker.notifications.sent", {
        eventId: event.id,
        kind: event.kind,
        recipientUserId: event.recipientUserId,
      });
      this.observability.finishJob("notification", "completed", startedAt);
    } catch (error) {
      await this.failEvent(eventId, error);
      this.observability.finishJob("notification", "failed", startedAt);
    }

    return true;
  }

  private async runScheduledWork() {
    const now = Date.now();

    if (now - this.lastScheduleCheckAt < this.scheduleIntervalMs) {
      return false;
    }

    this.lastScheduleCheckAt = now;
    const startedAt = this.observability.startJob("digest");

    try {
      const [dueReminderCount, hourlyDigestCount, dailyDigestCount] =
        await Promise.all([
          this.queueDueDateNotifications(new Date(now)),
          this.queueHourlyNonAdminDigests(new Date(now)),
          this.queueDailyNonAdminDigests(new Date(now)),
        ]);

      const queuedCount =
        dueReminderCount + hourlyDigestCount + dailyDigestCount;

      if (queuedCount > 0) {
        this.observability.logger.info("worker.notifications.scheduled", {
          dailyDigestCount,
          dueReminderCount,
          hourlyDigestCount,
          queuedCount,
        });
      }

      this.observability.finishJob("digest", "completed", startedAt);
      return queuedCount > 0;
    } catch (error) {
      this.observability.logger.error("worker.notifications.schedule_failed", {
        error,
      });
      this.observability.finishJob("digest", "failed", startedAt);
      return false;
    }
  }

  private async claimNextNotification() {
    const now = new Date();
    const candidate = await this.prisma.notificationEvent.findFirst({
      where: {
        kind: {
          notIn: [...BUFFERED_NON_ADMIN_UPDATE_KINDS],
        },
        nextAttemptAt: {
          lte: now,
        },
        status: "queued",
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.prisma.notificationEvent.updateMany({
      where: {
        id: candidate.id,
        nextAttemptAt: {
          lte: now,
        },
        status: "queued",
      },
      data: {
        attemptCount: {
          increment: 1,
        },
        status: "processing",
      },
    });

    return claimed.count === 1 ? candidate.id : null;
  }

  private async completeEvent(
    event: {
      attemptCount: number;
      id: string;
      kind: string;
      payload: unknown;
      recipient: NotificationRecipient | null;
      recipientUserId: string | null;
    },
    status: "sent" | "skipped",
    details: {
      reason?: string;
      response?: string | null;
      subject?: string;
    } = {},
  ) {
    const completedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.notificationEvent.update({
        where: { id: event.id },
        data: {
          failedAt: null,
          lastError: details.reason ?? null,
          nextAttemptAt: completedAt,
          sentAt: status === "sent" ? completedAt : null,
          skippedAt: status === "skipped" ? completedAt : null,
          status,
        },
      }),
      this.prisma.notificationDeliveryAttempt.create({
        data: {
          error: details.reason ?? null,
          notificationId: event.id,
          status,
        },
      }),
    ]);

    if (isBufferedSummaryKind(event.kind)) {
      if (status === "sent") {
        await this.consumeBufferedSourceNotifications(event, completedAt);
      } else {
        await this.releaseBufferedSourceNotifications(
          event,
          details.reason ?? "Notification was skipped",
        );
      }
    }

    await this.recordNotificationAuditStep({
      attemptNumber: event.attemptCount,
      detail:
        status === "sent"
          ? `Host accepted delivery for ${event.recipient?.email ?? "unknown recipient"}`
          : details.reason ?? "Notification was skipped",
      event,
      response: details.response ?? null,
      status,
      ...(details.subject !== undefined ? { subject: details.subject } : {}),
      title:
        status === "sent"
          ? `Host accepted ${event.kind.replace(/_/g, " ")}`
          : `Skipped ${event.kind.replace(/_/g, " ")}`,
    });
  }

  private async failEvent(eventId: string, error: unknown) {
    const current = await this.prisma.notificationEvent.findUnique({
      where: { id: eventId },
      select: {
        attemptCount: true,
      },
    });
    const message = error instanceof Error ? error.message : String(error);

    const event = await this.prisma.notificationEvent.findUnique({
      where: { id: eventId },
      include: {
        recipient: {
          select: {
            dailyDigestEnabled: true,
            email: true,
            id: true,
            name: true,
            personalTodoRemindersEnabled: true,
          },
        },
      },
    });

    if (!current || current.attemptCount >= MAX_ATTEMPTS) {
      await this.prisma.$transaction([
        this.prisma.notificationEvent.update({
          where: { id: eventId },
          data: {
            failedAt: new Date(),
            lastError: message,
            status: "failed",
          },
        }),
        this.prisma.notificationDeliveryAttempt.create({
          data: {
            error: message,
            notificationId: eventId,
            status: "failed",
          },
        }),
      ]);

      this.observability.logger.error("worker.notifications.failed", {
        error: message,
        eventId,
      });

      if (event) {
        if (isBufferedSummaryKind(event.kind)) {
          await this.releaseBufferedSourceNotifications(event, message);
        }

        await this.recordNotificationAuditStep({
          attemptNumber: current?.attemptCount ?? null,
          detail: message,
          event,
          response: readTransportResponse(error),
          status: "failed",
          title: `Host rejected ${event.kind.replace(/_/g, " ")}`,
        });
      }
      return;
    }

    const retryMinutes =
      RETRY_MINUTES[
        Math.min(current.attemptCount - 1, RETRY_MINUTES.length - 1)
      ] ?? 34;
    const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000);

    await this.prisma.$transaction([
      this.prisma.notificationEvent.update({
        where: { id: eventId },
        data: {
          lastError: message,
          nextAttemptAt,
          status: "queued",
        },
      }),
      this.prisma.notificationDeliveryAttempt.create({
        data: {
          error: message,
          notificationId: eventId,
          status: "failed",
        },
      }),
    ]);

    this.observability.logger.warn("worker.notifications.retry_scheduled", {
      error: message,
      eventId,
      nextAttemptAt,
    });

    if (event) {
      await this.recordNotificationAuditStep({
        attemptNumber: current.attemptCount,
        detail: message,
        event,
        nextAttemptAt,
        response: readTransportResponse(error),
        status: "failed",
        title: `Attempt ${current.attemptCount.toString()} failed`,
      });
      await this.recordNotificationAuditStep({
        attemptNumber: current.attemptCount,
        detail: `Retry scheduled for ${nextAttemptAt.toISOString()}`,
        event,
        nextAttemptAt,
        status: "queued",
        title: "Retry scheduled",
      });
    }
  }

  private async recordNotificationAuditStep({
    attemptNumber,
    detail,
    event,
    nextAttemptAt,
    response,
    status,
    subject,
    title,
  }: {
    attemptNumber: number | null;
    detail: string | null;
    event: {
      id: string;
      kind: string;
      payload: unknown;
      recipient: NotificationRecipient | null;
      recipientUserId: string | null;
    };
    nextAttemptAt?: Date;
    response?: string | null;
    status: "failed" | "processing" | "queued" | "sent" | "skipped";
    subject?: string;
    title: string;
  }) {
    const payload = toRecord(event.payload);
    const entityType = readNotificationEntityType(event.kind, payload);
    const entityId = readNotificationEntityId(payload);

    await this.prisma.auditEvent.create({
      data: {
        ...EMAIL_AUDIT_SYSTEM_ACTOR,
        action: `email_notification_${status}`,
        entityId: entityId ?? event.id,
        entityType,
        metadata: {
          ...payload,
          attemptNumber,
          detail,
          emailKind: event.kind,
          host: this.smtpHostLabel,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
          notificationAuditId: event.id,
          notificationEventId: event.id,
          recipientEmail: event.recipient?.email ?? null,
          recipientName: event.recipient?.name ?? null,
          recipientUserId: event.recipientUserId,
          response: response ?? null,
          source: "notification",
          status,
          stepTitle: title,
          subject: subject ?? null,
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  private async getSkipReason(
    kind: string,
    recipient: NotificationRecipient | null,
  ) {
    if (isLegacyDailySummaryKind(kind)) {
      return "legacy_daily_summary_disabled";
    }

    if (!recipient) {
      return "recipient_missing";
    }

    if (!this.configured || !this.transporter) {
      return "smtp_not_configured";
    }

    const settings = await this.prisma.emailSettings.findUnique({
      where: { id: "global" },
      select: { enabled: true },
    });

    if (settings?.enabled === false) {
      return "email_disabled";
    }

    if (kind === "daily_non_admin_digest" && !recipient.dailyDigestEnabled) {
      return "daily_digest_disabled";
    }

    if (kind === "hourly_non_admin_digest" && recipient.dailyDigestEnabled) {
      return "batched_into_digest";
    }

    if (
      isPersonalTodoReminderKind(kind) &&
      !recipient.personalTodoRemindersEnabled
    ) {
      return "personal_todo_reminders_disabled";
    }

    return null;
  }

  private async consumeBufferedSourceNotifications(
    event: {
      kind: string;
      payload: unknown;
    },
    completedAt: Date,
  ) {
    const sourceNotificationIds = readBufferedSourceNotificationIds(event.payload);

    if (sourceNotificationIds.length === 0) {
      return;
    }

    await this.prisma.notificationEvent.updateMany({
      where: {
        id: {
          in: sourceNotificationIds,
        },
        status: "processing",
      },
      data: {
        failedAt: null,
        lastError:
          event.kind === "daily_non_admin_digest"
            ? "batched_into_digest"
            : "batched_into_hourly_digest",
        nextAttemptAt: completedAt,
        skippedAt: completedAt,
        status: "skipped",
      },
    });
  }

  private async releaseBufferedSourceNotifications(
    event: {
      payload: unknown;
    },
    _reason: string,
  ) {
    const sourceNotificationIds = readBufferedSourceNotificationIds(event.payload);

    if (sourceNotificationIds.length === 0) {
      return;
    }

    await this.prisma.notificationEvent.updateMany({
      where: {
        id: {
          in: sourceNotificationIds,
        },
        status: "processing",
      },
      data: {
        failedAt: null,
        lastError: "buffered_pending",
        nextAttemptAt: new Date(),
        skippedAt: null,
        status: "queued",
      },
    });
  }

  private async queueDueDateNotifications(now: Date) {
    const dayKey = formatUtcDate(now);
    const [tasks, personalTodos] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          assignee: {
            is: {
              dailyDigestEnabled: false,
            },
          },
          archivedAt: null,
          assigneeUserId: {
            not: null,
          },
          dueDate: {
            not: null,
          },
          status: {
            notIn: ["canceled", "done", "on_hold"],
          },
        },
        select: {
          assigneeUserId: true,
          dueDate: true,
          id: true,
          title: true,
          project: {
            select: {
              title: true,
            },
          },
        },
      }),
      this.prisma.personalTodo.findMany({
        where: {
          dueDate: {
            not: null,
          },
          status: "todo",
          user: {
            is: {
              personalTodoRemindersEnabled: true,
            },
          },
        },
        select: {
          dueDate: true,
          id: true,
          title: true,
          userId: true,
        },
      }),
    ]);

    const taskEvents = tasks
      .map((task) => {
        const kind = getDueReminderKind(task.dueDate!, now);

        if (!kind || !task.assigneeUserId) {
          return null;
        }

        return {
          dedupeKey: `${kind}:${task.id}:${task.assigneeUserId}:${dayKey}`,
          kind,
          payload: {
            dueDate: task.dueDate!.toISOString(),
            projectTitle: task.project?.title ?? null,
            taskId: task.id,
            taskTitle: task.title,
          },
          recipientUserId: task.assigneeUserId,
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);
    const personalTodoEvents = personalTodos
      .map((todo) => {
        const kind = getPersonalTodoDueReminderKind(todo.dueDate!, now);

        if (!kind) {
          return null;
        }

        return {
          dedupeKey: `${kind}:${todo.id}:${todo.userId}:${dayKey}`,
          kind,
          payload: {
            dueDate: todo.dueDate!.toISOString(),
            taskTitle: todo.title,
          },
          recipientUserId: todo.userId,
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);
    const events = [...taskEvents, ...personalTodoEvents];

    return this.queueEvents(events);
  }

  private async queueHourlyNonAdminDigests(now: Date) {
    const digestWindow = getHourlyDigestWindow(now, this.scheduleIntervalMs);

    if (!digestWindow) {
      return 0;
    }

    const recipients = await this.prisma.user.findMany({
      where: {
        dailyDigestEnabled: false,
      },
      select: {
        id: true,
      },
    });
    const recipientUserIds = recipients.map((recipient) => recipient.id);

    if (recipientUserIds.length === 0) {
      return 0;
    }

    const notifications = await this.readBufferedNotifications(
      recipientUserIds,
      digestWindow.windowEnd,
    );
    const notificationsByRecipient =
      groupBufferedNotificationsByRecipient(notifications);
    let queuedCount = 0;

    for (const recipientUserId of recipientUserIds) {
      const digestNotifications =
        notificationsByRecipient.get(recipientUserId) ?? [];

      if (digestNotifications.length === 0) {
        continue;
      }

      queuedCount += await this.queueBufferedDigestEvent({
        dedupeKey: `hourly_non_admin_digest:${recipientUserId}:${digestWindow.summaryHour}`,
        kind: "hourly_non_admin_digest",
        payload: {
          itemCount: digestNotifications.length,
          items: digestNotifications.map((notification) => ({
            createdAt: notification.createdAt.toISOString(),
            kind: notification.kind,
            payload: toRecord(notification.payload),
          })),
          summaryHour: digestWindow.summaryHour,
          windowEnd: digestWindow.windowEnd.toISOString(),
          windowStart: digestWindow.windowStart.toISOString(),
        },
        recipientUserId,
        sourceNotificationIds: digestNotifications.map(
          (notification) => notification.id,
        ),
      });
    }

    return queuedCount;
  }

  private async queueDailyNonAdminDigests(now: Date) {
    const digestUsers = await this.prisma.user.findMany({
      where: {
        dailyDigestEnabled: true,
      },
      select: {
        dailyDigestTime: true,
        id: true,
      },
    });

    if (digestUsers.length === 0) {
      return 0;
    }

    const recipientIdsByDigestTime = new Map<string, string[]>();

    for (const user of digestUsers) {
      const digestTime = normalizeDigestTimeToHour(
        user.dailyDigestTime,
        DEFAULT_DAILY_DIGEST_TIME,
      );
      const current = recipientIdsByDigestTime.get(digestTime) ?? [];
      current.push(user.id);
      recipientIdsByDigestTime.set(digestTime, current);
    }

    let queuedCount = 0;

    for (const [digestTime, recipientUserIds] of recipientIdsByDigestTime) {
      const digestWindow = getDigestWindow(now, digestTime);

      if (!digestWindow) {
        continue;
      }

      const [notifications, tasks, projects] = await Promise.all([
        this.readBufferedNotifications(recipientUserIds, digestWindow.windowEnd),
        this.prisma.task.findMany({
          where: {
            archivedAt: null,
            assigneeUserId: {
              in: recipientUserIds,
            },
            status: {
              notIn: ["canceled", "done"],
            },
          },
          select: {
            assigneeUserId: true,
            dueDate: true,
            id: true,
            project: {
              select: {
                title: true,
              },
            },
            status: true,
            title: true,
          },
          orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
        }),
        this.prisma.project.findMany({
          where: {
            archivedAt: null,
            ownerUserId: {
              in: recipientUserIds,
            },
            OR: [
              {
                displayStatus: {
                  not: "done",
                },
              },
              {
                taskOverdueCount: {
                  gt: 0,
                },
              },
            ],
          },
          select: {
            displayStatus: true,
            dueDate: true,
            id: true,
            ownerUserId: true,
            taskBlockedCount: true,
            taskDoneCount: true,
            taskOnHoldCount: true,
            taskOverdueCount: true,
            taskTotalCount: true,
            title: true,
          },
          orderBy: [{ updatedAt: "desc" }],
        }),
      ]);

      const notificationsByRecipient =
        groupBufferedNotificationsByRecipient(notifications);

      const tasksByAssignee = new Map<string, typeof tasks>();

      for (const task of tasks) {
        if (!task.assigneeUserId) {
          continue;
        }

        const current = tasksByAssignee.get(task.assigneeUserId) ?? [];
        current.push(task);
        tasksByAssignee.set(task.assigneeUserId, current);
      }

      const projectsByOwner = new Map<string, typeof projects>();

      for (const project of projects) {
        if (!project.ownerUserId) {
          continue;
        }

        const current = projectsByOwner.get(project.ownerUserId) ?? [];
        current.push(project);
        projectsByOwner.set(project.ownerUserId, current);
      }

      for (const recipientUserId of recipientUserIds) {
        const digestNotifications =
          notificationsByRecipient.get(recipientUserId) ?? [];
        const taskSummaryItems = tasksByAssignee.get(recipientUserId) ?? [];
        const projectSummaryItems = projectsByOwner.get(recipientUserId) ?? [];

        if (
          digestNotifications.length === 0 &&
          taskSummaryItems.length === 0 &&
          projectSummaryItems.length === 0
        ) {
          continue;
        }

        queuedCount += await this.queueBufferedDigestEvent({
          dedupeKey: `daily_non_admin_digest:${recipientUserId}:${digestWindow.summaryDate}`,
          kind: "daily_non_admin_digest",
          payload: {
            itemCount: digestNotifications.length,
            items: digestNotifications.map((notification) => ({
              createdAt: notification.createdAt.toISOString(),
              kind: notification.kind,
              payload: toRecord(notification.payload),
            })),
            projectSummary:
              projectSummaryItems.length > 0
                ? summarizeOwnedProjects(projectSummaryItems)
                : null,
            summaryDate: digestWindow.summaryDate,
            taskSummary:
              taskSummaryItems.length > 0
                ? summarizeAssignedTasks(taskSummaryItems, now)
                : null,
            windowEnd: digestWindow.windowEnd.toISOString(),
            windowStart: digestWindow.windowStart.toISOString(),
          },
          recipientUserId,
          sourceNotificationIds: digestNotifications.map(
            (notification) => notification.id,
          ),
        });
      }
    }

    return queuedCount;
  }

  private readBufferedNotifications(
    recipientUserIds: string[],
    windowEnd: Date,
  ): Promise<
    Array<{
      createdAt: Date;
      id: string;
      kind: string;
      payload: unknown;
      recipientUserId: string | null;
    }>
  > {
    if (recipientUserIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.notificationEvent.findMany({
      where: {
        createdAt: {
          lte: windowEnd,
        },
        kind: {
          in: [...BUFFERED_NON_ADMIN_UPDATE_KINDS],
        },
        recipientUserId: {
          in: recipientUserIds,
        },
        status: "queued",
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        createdAt: true,
        id: true,
        kind: true,
        payload: true,
        recipientUserId: true,
      },
    });
  }

  private async queueBufferedDigestEvent(input: {
    dedupeKey: string;
    kind: BufferedSummaryKind;
    payload: Record<string, unknown>;
    recipientUserId: string;
    sourceNotificationIds: string[];
  }) {
    const existing = await this.prisma.notificationEvent.findUnique({
      where: {
        dedupeKey: input.dedupeKey,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      return 0;
    }

    const queuedAt = new Date();
    const bufferingState =
      input.kind === "daily_non_admin_digest"
        ? "buffered_for_daily_digest"
        : "buffered_for_hourly_digest";

    await this.prisma.$transaction(async (tx) => {
      await tx.notificationEvent.create({
        data: {
          dedupeKey: input.dedupeKey,
          kind: input.kind,
          payload: {
            ...input.payload,
            sourceNotificationIds: input.sourceNotificationIds,
          } as Prisma.InputJsonValue,
          recipientUserId: input.recipientUserId,
        },
      });

      if (input.sourceNotificationIds.length === 0) {
        return;
      }

      await tx.notificationEvent.updateMany({
        where: {
          id: {
            in: input.sourceNotificationIds,
          },
          status: "queued",
        },
        data: {
          failedAt: null,
          lastError: bufferingState,
          nextAttemptAt: queuedAt,
          skippedAt: null,
          status: "processing",
        },
      });
    });

    return 1;
  }

  private async queueEvents(
    events: Array<{
      dedupeKey: string;
      kind: ScheduledNotificationKind;
      payload: Record<string, unknown>;
      recipientUserId: string;
    }>,
  ) {
    if (events.length === 0) {
      return 0;
    }

    const result = await this.prisma.notificationEvent.createMany({
      data: events.map((event) => ({
        dedupeKey: event.dedupeKey,
        kind: event.kind,
        payload: event.payload as Prisma.InputJsonValue,
        recipientUserId: event.recipientUserId,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }
}

function buildNotificationEmail(input: {
  homeUrl: string;
  kind: string;
  payload: Record<string, unknown>;
  recipientName: string;
}) {
  const content = buildNotificationContent(
    input.homeUrl,
    input.kind,
    input.payload,
  );

  return toEmail(input, content.subject, content.bodyHtml);
}

function buildNotificationContent(
  homeUrl: string,
  kind: string,
  payload: Record<string, unknown>,
): {
  bodyHtml: string;
  subject: string;
} {
  const taskTitleText = readString(payload.taskTitle) ?? "Untitled task";
  const projectTitleText = readString(payload.projectTitle) ?? "Unassigned";
  const actorNameText = readString(payload.actorName) ?? "Someone";
  const taskTitle = escapeHtml(taskTitleText);
  const projectTitle = buildProjectNameHtml({
    fallback: "Unassigned",
    homeUrl,
    projectTitle: readString(payload.projectTitle),
    strong: true,
  });
  const actorName = escapeHtml(actorNameText);
  const dueDate = formatDate(readString(payload.dueDate));

  switch (kind) {
    case "task_assigned":
      return {
        bodyHtml: `${actorName} assigned you <strong>${taskTitle}</strong> in ${projectTitle}.${dueDate ? `<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate}</strong></p>` : ""}`,
        subject: `New task assigned: ${taskTitleText}`,
      };
    case "task_unassigned":
      return {
        bodyHtml: `${actorName} removed you from <strong>${taskTitle}</strong> in ${projectTitle}.`,
        subject: `Task unassigned: ${taskTitleText}`,
      };
    case "task_updated":
      return {
        bodyHtml: buildChangeUpdateBody({
          actorName,
          entityHtml: `<strong>${taskTitle}</strong>`,
          fromLines: readStringArray(payload.fromLines),
          projectHtml: projectTitle,
          toLines: readStringArray(payload.toLines),
        }),
        subject: `Task updated: ${taskTitleText}`,
      };
    case "task_due_date_added":
      return {
        bodyHtml: `${actorName} added a due date to <strong>${taskTitle}</strong> in ${projectTitle}.<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
        subject: `Due date added: ${taskTitleText}`,
      };
    case "task_due_date_changed":
      return {
        bodyHtml: `${actorName} changed the due date for <strong>${taskTitle}</strong> in ${projectTitle}.<p style="margin:12px 0 0;">New due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
        subject: `Due date changed: ${taskTitleText}`,
      };
    case "task_blocked":
      return {
        bodyHtml: `${actorName} marked <strong>${taskTitle}</strong> as blocked in ${projectTitle}.`,
        subject: `Task blocked: ${taskTitleText}`,
      };
    case "task_unblocked":
      return {
        bodyHtml: `${actorName} moved <strong>${taskTitle}</strong> out of blocked status in ${projectTitle}.`,
        subject: `Task unblocked: ${taskTitleText}`,
      };
    case "task_on_hold":
      return {
        bodyHtml: `${actorName} put <strong>${taskTitle}</strong> on hold in ${projectTitle}.`,
        subject: `Task on hold: ${taskTitleText}`,
      };
    case "task_resumed":
      return {
        bodyHtml: `${actorName} took <strong>${taskTitle}</strong> off hold in ${projectTitle}.`,
        subject: `Task resumed: ${taskTitleText}`,
      };
    case "task_reopened":
      return {
        bodyHtml: `${actorName} reopened <strong>${taskTitle}</strong> in ${projectTitle}.`,
        subject: `Task reopened: ${taskTitleText}`,
      };
    case "task_completed":
      return {
        bodyHtml: `${actorName} marked <strong>${taskTitle}</strong> done in ${projectTitle}.`,
        subject: `Task completed: ${taskTitleText}`,
      };
    case "task_moved":
      return {
        bodyHtml: `${actorName} moved <strong>${taskTitle}</strong> to ${projectTitle}.`,
        subject: `Task moved: ${taskTitleText}`,
      };
    case "project_owner_assigned":
      return {
        bodyHtml: `${actorName} assigned you as the owner of ${projectTitle}.`,
        subject: `You now own: ${projectTitleText}`,
      };
    case "project_owner_changed":
      return {
        bodyHtml: `${actorName} assigned you as the new owner of ${projectTitle}.`,
        subject: `Project owner changed: ${projectTitleText}`,
      };
    case "project_owner_removed":
      return {
        bodyHtml: `${actorName} removed you as the owner of ${projectTitle}.`,
        subject: `Owner removed: ${projectTitleText}`,
      };
    case "project_updated":
      return {
        bodyHtml: buildChangeUpdateBody({
          actorName,
          entityHtml: projectTitle,
          fromLines: readStringArray(payload.fromLines),
          toLines: readStringArray(payload.toLines),
        }),
        subject: `Project updated: ${projectTitleText}`,
      };
    case "project_blocked":
      return {
        bodyHtml: `${actorName} marked ${projectTitle} as blocked.`,
        subject: `Project blocked: ${projectTitleText}`,
      };
    case "project_on_hold":
      return {
        bodyHtml: `${actorName} put ${projectTitle} on hold.`,
        subject: `Project on hold: ${projectTitleText}`,
      };
    case "project_resumed":
      return {
        bodyHtml: `${actorName} took ${projectTitle} off hold.`,
        subject: `Project resumed: ${projectTitleText}`,
      };
    case "task_due_7_days":
    case "task_due_3_days":
    case "task_due_tomorrow":
    case "task_due_today":
    case "task_overdue":
      return {
        bodyHtml: `<strong>${taskTitle}</strong> in ${projectTitle} is ${dueReminderBody(kind, dueDate)}.`,
        subject: `${dueReminderSubject(kind)}: ${taskTitleText}`,
      };
    case "personal_todo_due_7_days":
    case "personal_todo_due_3_days":
    case "personal_todo_due_tomorrow":
    case "personal_todo_due_today":
    case "personal_todo_overdue":
      return {
        bodyHtml: `<strong>${taskTitle}</strong> is ${dueReminderBody(toTaskDueReminderKind(kind), dueDate)}.`,
        subject: `${dueReminderSubject(toTaskDueReminderKind(kind))}: ${taskTitleText}`,
      };
    case "daily_non_admin_digest":
      return {
        bodyHtml: buildDailyNonAdminDigestBody(homeUrl, payload),
        subject: buildDailyNonAdminDigestSubject(payload),
      };
    case "hourly_non_admin_digest":
      return {
        bodyHtml: buildHourlyNonAdminDigestBody(homeUrl, payload),
        subject: buildHourlyNonAdminDigestSubject(payload),
      };
    case "daily_task_summary":
      return {
        bodyHtml: buildDailyTaskSummaryBody(homeUrl, payload),
        subject: "Daily task summary",
      };
    case "daily_project_summary":
      return {
        bodyHtml: buildDailyProjectSummaryBody(homeUrl, payload),
        subject: "Daily project summary",
      };
    default:
      return {
        bodyHtml: "You have a new notification in Tavi.",
        subject: "Tavi notification",
      };
  }
}

function buildDailyTaskSummaryBody(
  homeUrl: string,
  payload: Record<string, unknown>,
) {
  const totalOpenCount = readNumber(payload.totalOpenCount);
  const overdueCount = readNumber(payload.overdueCount);
  const dueTodayCount = readNumber(payload.dueTodayCount);
  const blockedCount = readNumber(payload.blockedCount);
  const onHoldCount = readNumber(payload.onHoldCount);
  const items = readRecordArray(payload.items);

  return `Here is your current task summary.

<p style="margin:16px 0 0;">
  Open tasks: <strong style="color:#e2e8f0;">${totalOpenCount}</strong><br />
  Overdue: <strong style="color:#e2e8f0;">${overdueCount}</strong><br />
  Due today: <strong style="color:#e2e8f0;">${dueTodayCount}</strong><br />
  Blocked: <strong style="color:#e2e8f0;">${blockedCount}</strong><br />
  On hold: <strong style="color:#e2e8f0;">${onHoldCount}</strong>
</p>

${buildTaskList(homeUrl, items)}`;
}

function buildDailyProjectSummaryBody(
  homeUrl: string,
  payload: Record<string, unknown>,
) {
  const activeProjectCount = readNumber(payload.activeProjectCount);
  const blockedProjectCount = readNumber(payload.blockedProjectCount);
  const onHoldProjectCount = readNumber(payload.onHoldProjectCount);
  const overdueTaskCount = readNumber(payload.overdueTaskCount);
  const items = readRecordArray(payload.items);

  return `Here is your current project-owner summary.

<p style="margin:16px 0 0;">
  Active projects: <strong style="color:#e2e8f0;">${activeProjectCount}</strong><br />
  Blocked projects: <strong style="color:#e2e8f0;">${blockedProjectCount}</strong><br />
  On-hold projects: <strong style="color:#e2e8f0;">${onHoldProjectCount}</strong><br />
  Overdue tasks across owned projects: <strong style="color:#e2e8f0;">${overdueTaskCount}</strong>
</p>

${buildProjectList(homeUrl, items)}`;
}

function buildDailyNonAdminDigestSubject(payload: Record<string, unknown>) {
  const itemCount = readNumber(payload.itemCount);

  return itemCount > 0 ? `Daily digest (${itemCount} updates)` : "Daily digest";
}

function buildHourlyNonAdminDigestSubject(payload: Record<string, unknown>) {
  const itemCount = readNumber(payload.itemCount);

  return itemCount === 1
    ? "Hourly updates (1 update)"
    : `Hourly updates (${itemCount} updates)`;
}

function buildDailyNonAdminDigestBody(
  homeUrl: string,
  payload: Record<string, unknown>,
) {
  const itemCount = readNumber(payload.itemCount);
  const items = readRecordArray(payload.items);
  const taskSummary = toNullableRecord(payload.taskSummary);
  const projectSummary = toNullableRecord(payload.projectSummary);
  const sections = [
    `Here is your daily digest.

<p style="margin:16px 0 0;">
  Updates since your last digest: <strong style="color:#e2e8f0;">${itemCount}</strong>
</p>`,
  ];

  if (taskSummary) {
    sections.push(
      buildDigestSection(
        "Assigned tasks",
        buildDailyTaskSummaryBody(homeUrl, taskSummary),
      ),
    );
  }

  if (projectSummary) {
    sections.push(
      buildDigestSection(
        "Projects you own",
        buildDailyProjectSummaryBody(homeUrl, projectSummary),
      ),
    );
  }

  if (items.length > 0) {
    sections.push(buildDigestNotificationList(homeUrl, items));
  }

  return sections.join("\n\n");
}

function buildHourlyNonAdminDigestBody(
  homeUrl: string,
  payload: Record<string, unknown>,
): string {
  const itemCount = readNumber(payload.itemCount);
  const items = readRecordArray(payload.items);

  return [
    `Here are your latest workspace updates.

<p style="margin:16px 0 0;">
  Updates in this batch: <strong style="color:#e2e8f0;">${itemCount}</strong>
</p>`,
    buildDigestNotificationList(homeUrl, items),
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function buildDigestSection(title: string, bodyHtml: string) {
  return `<div style="margin:20px 0 0;">
  <div style="margin:0 0 8px;color:#94a3b8;font-size:13px;font-weight:600;">${escapeHtml(title)}</div>
  ${bodyHtml}
</div>`;
}

function buildDigestNotificationList(
  homeUrl: string,
  items: Array<Record<string, unknown>>,
): string {
  return buildDigestSection(
    "Recent updates",
    items.map((item) => buildDigestNotificationCard(homeUrl, item)).join(""),
  );
}

function buildDigestNotificationCard(
  homeUrl: string,
  item: Record<string, unknown>,
): string {
  const kind = readString(item.kind) ?? "notification";
  const createdAt = formatDigestTimestamp(readString(item.createdAt));
  const content = buildNotificationContent(homeUrl, kind, toRecord(item.payload));

  return `<div style="margin:12px 0 0;padding:14px 16px;background-color:#111827;border:1px solid #334155;border-radius:10px;">
  <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
    <strong style="color:#e2e8f0;">${escapeHtml(content.subject)}</strong>
    ${
      createdAt
        ? `<span style="color:#94a3b8;font-size:12px;white-space:nowrap;">${escapeHtml(createdAt)}</span>`
        : ""
    }
  </div>
  <div style="margin:10px 0 0;">${content.bodyHtml}</div>
</div>`;
}

function buildTaskList(homeUrl: string, items: Array<Record<string, unknown>>) {
  if (items.length === 0) {
    return "";
  }

  return `<ul style="margin:16px 0 0;padding-left:20px;">${items
    .map((item) => {
      const title = escapeHtml(readString(item.taskTitle) ?? "Untitled task");
      const projectTitle = buildProjectNameHtml({
        fallback: "Unassigned",
        homeUrl,
        projectTitle: readString(item.projectTitle),
      });
      const status = escapeHtml(formatStatus(readString(item.status)));
      const dueDate = formatDate(readString(item.dueDate));

      return `<li style="margin:0 0 8px;"><strong style="color:#e2e8f0;">${title}</strong> - ${projectTitle} (${status}${dueDate ? `, due ${dueDate}` : ""})</li>`;
    })
    .join("")}</ul>`;
}

function buildProjectList(
  homeUrl: string,
  items: Array<Record<string, unknown>>,
) {
  if (items.length === 0) {
    return "";
  }

  return `<ul style="margin:16px 0 0;padding-left:20px;">${items
    .map((item) => {
      const title = buildProjectNameHtml({
        fallback: "Untitled project",
        homeUrl,
        projectTitle: readString(item.projectTitle),
        strong: true,
      });
      const status = escapeHtml(formatStatus(readString(item.status)));
      const overdueTaskCount = readNumber(item.taskOverdueCount);
      const blockedTaskCount = readNumber(item.taskBlockedCount);

      return `<li style="margin:0 0 8px;">${title} - ${status} (${blockedTaskCount} blocked, ${overdueTaskCount} overdue)</li>`;
    })
    .join("")}</ul>`;
}

function toEmail(
  input: {
    homeUrl: string;
    recipientName: string;
  },
  subject: string,
  bodyHtml: string,
) {
  return {
    html: buildEmailHtml(input.homeUrl, input.recipientName, bodyHtml),
    subject,
  };
}

function buildChangeUpdateBody(input: {
  actorName: string;
  entityHtml: string;
  fromLines: string[];
  projectHtml?: string;
  toLines: string[];
}) {
  const projectContext = input.projectHtml ? ` in ${input.projectHtml}` : "";

  return `${input.actorName} updated ${input.entityHtml}${projectContext}.

${buildChangeFence("From", input.fromLines)}
${buildChangeFence("To", input.toLines)}`;
}

function buildChangeFence(label: "From" | "To", lines: string[]) {
  const content =
    lines.length > 0
      ? lines.map((line) => escapeHtml(line)).join('\n')
      : "No changed values";

  return `<div style="margin:16px 0 0;">
  <div style="margin:0 0 6px;color:#94a3b8;font-size:13px;font-weight:600;">${label}:</div>
  <pre style="margin:0;padding:14px 16px;background-color:#111827;border:1px solid #334155;border-radius:10px;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${content}</pre>
</div>`;
}

function buildProjectNameHtml(input: {
  fallback: string;
  homeUrl: string;
  projectTitle: string | null | undefined;
  strong?: boolean;
}) {
  const projectTitle = input.projectTitle?.trim() ?? "";
  const label = projectTitle.length > 0 ? projectTitle : input.fallback;
  const content = input.strong
    ? `<strong>${escapeHtml(label)}</strong>`
    : escapeHtml(label);

  if (projectTitle.length === 0) {
    return content;
  }

  return `<a href="${escapeHtml(buildProjectSearchUrl(input.homeUrl, projectTitle))}" style="color:#93c5fd;text-decoration:none;">${content}</a>`;
}

function buildProjectSearchUrl(homeUrl: string, projectTitle: string) {
  try {
    const url = new URL(homeUrl);

    url.search = "";
    url.searchParams.set("search", projectTitle);
    return url.toString();
  } catch {
    const baseUrl = homeUrl.split("?")[0] ?? homeUrl;
    return `${baseUrl}?search=${encodeURIComponent(projectTitle)}`;
  }
}

function summarizeAssignedTasks(
  tasks: Array<{
    dueDate: Date | null;
    id: string;
    project: {
      title: string;
    } | null;
    status: string;
    title: string;
  }>,
  now: Date,
) {
  const items = tasks.slice(0, 8).map((task) => ({
    dueDate: task.dueDate?.toISOString() ?? null,
    projectTitle: task.project?.title ?? null,
    status: task.status,
    taskId: task.id,
    taskTitle: task.title,
  }));

  return {
    blockedCount: tasks.filter((task) => task.status === "blocked").length,
    dueTodayCount: tasks.filter((task) => getDueReminderKind(task.dueDate, now) === "task_due_today").length,
    items,
    onHoldCount: tasks.filter((task) => task.status === "on_hold").length,
    overdueCount: tasks.filter((task) => getDueReminderKind(task.dueDate, now) === "task_overdue").length,
    totalOpenCount: tasks.length,
  };
}

function summarizeOwnedProjects(
  projects: Array<{
    displayStatus: string;
    dueDate: Date | null;
    id: string;
    taskBlockedCount: number;
    taskDoneCount: number;
    taskOnHoldCount: number;
    taskOverdueCount: number;
    taskTotalCount: number;
    title: string;
  }>,
) {
  return {
    activeProjectCount: projects.length,
    blockedProjectCount: projects.filter(
      (project) => project.displayStatus === "blocked",
    ).length,
    items: projects.slice(0, 8).map((project) => ({
      dueDate: project.dueDate?.toISOString() ?? null,
      projectId: project.id,
      projectTitle: project.title,
      status: project.displayStatus,
      taskBlockedCount: project.taskBlockedCount,
      taskDoneCount: project.taskDoneCount,
      taskOnHoldCount: project.taskOnHoldCount,
      taskOverdueCount: project.taskOverdueCount,
      taskTotalCount: project.taskTotalCount,
    })),
    onHoldProjectCount: projects.filter(
      (project) => project.displayStatus === "on_hold",
    ).length,
    overdueTaskCount: projects.reduce(
      (total, project) => total + project.taskOverdueCount,
      0,
    ),
  };
}

function getDueReminderKind(
  dueDate: Date | null,
  now: Date,
): Exclude<ScheduledNotificationKind, "daily_project_summary" | "daily_task_summary"> | null {
  if (!dueDate) {
    return null;
  }

  const difference = dayDifferenceUtc(now, dueDate);

  switch (difference) {
    case 7:
      return "task_due_7_days";
    case 3:
      return "task_due_3_days";
    case 1:
      return "task_due_tomorrow";
    case 0:
      return "task_due_today";
    default:
      return difference < 0 ? "task_overdue" : null;
  }
}

function getPersonalTodoDueReminderKind(
  dueDate: Date | null,
  now: Date,
): Exclude<
  ScheduledNotificationKind,
  | "daily_non_admin_digest"
  | "daily_project_summary"
  | "daily_task_summary"
  | "task_due_3_days"
  | "task_due_7_days"
  | "task_due_today"
  | "task_due_tomorrow"
  | "task_overdue"
> | null {
  const kind = getDueReminderKind(dueDate, now);

  switch (kind) {
    case "task_due_7_days":
      return "personal_todo_due_7_days";
    case "task_due_3_days":
      return "personal_todo_due_3_days";
    case "task_due_tomorrow":
      return "personal_todo_due_tomorrow";
    case "task_due_today":
      return "personal_todo_due_today";
    case "task_overdue":
      return "personal_todo_overdue";
    default:
      return null;
  }
}

function dayDifferenceUtc(left: Date, right: Date) {
  const leftStart = Date.UTC(
    left.getUTCFullYear(),
    left.getUTCMonth(),
    left.getUTCDate(),
  );
  const rightStart = Date.UTC(
    right.getUTCFullYear(),
    right.getUTCMonth(),
    right.getUTCDate(),
  );

  return Math.round((rightStart - leftStart) / 86_400_000);
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dueReminderSubject(kind: string) {
  switch (kind) {
    case "task_due_7_days":
      return "Due in 7 days";
    case "task_due_3_days":
      return "Due in 3 days";
    case "task_due_tomorrow":
      return "Due tomorrow";
    case "task_due_today":
      return "Due today";
    default:
      return "Task overdue";
  }
}

function dueReminderBody(kind: string, dueDate: string | null) {
  switch (kind) {
    case "task_due_7_days":
      return `due in 7 days (${dueDate ?? "-"})`;
    case "task_due_3_days":
      return `due in 3 days (${dueDate ?? "-"})`;
    case "task_due_tomorrow":
      return `due tomorrow (${dueDate ?? "-"})`;
    case "task_due_today":
      return `due today (${dueDate ?? "-"})`;
    default:
      return `overdue${dueDate ? ` since ${dueDate}` : ""}`;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleDateString();
}

function formatDigestTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function formatStatus(value: string | null) {
  switch (value) {
    case "todo":
    case "not_started":
      return "Not Started";
    case "in_progress":
      return "In Progress";
    case "on_hold":
      return "On Hold";
    case "canceled":
      return "Cancelled";
    case "demo":
      return "Demo";
    case "review":
      return "Review";
    case "done":
      return "Done";
    case "blocked":
      return "Blocked";
    default:
      return value ? value.replace(/_/g, " ") : "unknown";
  }
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const BUFFERED_NON_ADMIN_UPDATE_KINDS = new Set<NotificationKind>([
  "project_blocked",
  "project_on_hold",
  "project_owner_assigned",
  "project_owner_changed",
  "project_owner_removed",
  "project_resumed",
  "project_updated",
  "task_assigned",
  "task_blocked",
  "task_completed",
  "task_due_date_added",
  "task_due_date_changed",
  "task_moved",
  "task_on_hold",
  "task_reopened",
  "task_resumed",
  "task_unassigned",
  "task_unblocked",
  "task_updated",
]);

function isBufferedSummaryKind(kind: string): kind is BufferedSummaryKind {
  return kind === "daily_non_admin_digest" || kind === "hourly_non_admin_digest";
}

function isLegacyDailySummaryKind(kind: string) {
  return kind === "daily_task_summary" || kind === "daily_project_summary";
}

function isPersonalTodoReminderKind(kind: string) {
  return kind.startsWith("personal_todo_due_") || kind === "personal_todo_overdue";
}

function toTaskDueReminderKind(kind: string) {
  switch (kind) {
    case "personal_todo_due_7_days":
      return "task_due_7_days";
    case "personal_todo_due_3_days":
      return "task_due_3_days";
    case "personal_todo_due_tomorrow":
      return "task_due_tomorrow";
    case "personal_todo_due_today":
      return "task_due_today";
    case "personal_todo_overdue":
      return "task_overdue";
    default:
      return kind;
  }
}

function normalizeDigestTimeToHour(
  value: string | null | undefined,
  fallback = "11:00",
) {
  const safeFallback = /^([01]\d|2[0-3]):00$/.test(fallback)
    ? fallback
    : "11:00";

  if (typeof value !== "string") {
    return safeFallback;
  }

  const parsed = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!parsed) {
    return safeFallback;
  }

  return `${parsed[1]}:00`;
}

function getDigestWindow(now: Date, digestTime: string) {
  const [hours, minutes] = digestTime.split(":").map((value) => Number(value));
  const windowEnd = new Date(now);

  windowEnd.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);

  if (now < windowEnd) {
    return null;
  }

  const windowStart = new Date(windowEnd);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);

  return {
    summaryDate: formatUtcDate(windowEnd),
    windowEnd,
    windowStart,
  };
}

function getHourlyDigestWindow(now: Date, scheduleIntervalMs: number) {
  const windowEnd = new Date(now);
  windowEnd.setUTCMinutes(0, 0, 0);

  if (now.getTime() - windowEnd.getTime() >= scheduleIntervalMs) {
    return null;
  }

  const windowStart = new Date(windowEnd);
  windowStart.setUTCHours(windowStart.getUTCHours() - 1);

  return {
    summaryHour: windowEnd.toISOString().slice(0, 13),
    windowEnd,
    windowStart,
  };
}

function groupBufferedNotificationsByRecipient(
  notifications: Array<{
    createdAt: Date;
    id: string;
    kind: string;
    payload: unknown;
    recipientUserId: string | null;
  }>,
) {
  const notificationsByRecipient = new Map<string, typeof notifications>();

  for (const notification of notifications) {
    if (!notification.recipientUserId) {
      continue;
    }

    const current =
      notificationsByRecipient.get(notification.recipientUserId) ?? [];
    current.push(notification);
    notificationsByRecipient.set(notification.recipientUserId, current);
  }

  return notificationsByRecipient;
}

function readBufferedSourceNotificationIds(payload: unknown) {
  const sourceNotificationIds = toRecord(payload).sourceNotificationIds;

  return Array.isArray(sourceNotificationIds)
    ? sourceNotificationIds.filter(
        (notificationId): notificationId is string =>
          typeof notificationId === "string" && notificationId.length > 0,
      )
    : [];
}

function toNullableRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNotificationEntityType(
  kind: string,
  payload: Record<string, unknown>,
) {
  if (kind.startsWith("project_") || readString(payload.projectId)) {
    return "project" as const;
  }

  if (
    kind.startsWith("task_") ||
    kind.startsWith("personal_todo_") ||
    readString(payload.taskId)
  ) {
    return "task" as const;
  }

  return "auth" as const;
}

function readNotificationEntityId(payload: Record<string, unknown>) {
  return readString(payload.projectId) ?? readString(payload.taskId) ?? null;
}

function readTransportResponse(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    typeof error.response === "string"
  ) {
    return error.response;
  }

  return null;
}
