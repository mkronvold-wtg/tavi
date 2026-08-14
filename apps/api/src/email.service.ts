import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type {
  AuditEntityType,
  EmailAuditSource,
  SmtpStatus,
  UpdateEmailSettingsInput,
} from '@tavi/schemas';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { buildEmailHtml, escapeHtml, parseSmtpUrl } from './email-helpers';
import { PrismaService } from './prisma.service';

const DEFAULT_SMTP_URL = 'smtp://10.120.64.99:25';
const DEFAULT_SMTP_FROM = 'noreply@tavi.local';
const EMAIL_SETTINGS_ID = 'global';
const PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE =
  'Password reset email is unavailable right now';
const TEST_EMAIL_UNAVAILABLE_MESSAGE = 'Test email is unavailable right now';
const EMAIL_AUDIT_SYSTEM_ACTOR = {
  email: 'system@tavi.local',
  id: null,
  name: 'Tavi System',
  role: 'admin' as const,
};

type EmailRecipient = {
  email: string;
  name: string;
};

type EmailAuditActor = {
  email: string;
  id: string | null;
  name: string;
  role: SessionUser['role'];
};

type EmailAuditContext = {
  actor?: EmailAuditActor;
  entityId: string | null;
  entityType: AuditEntityType;
  kind: string;
  metadata?: Record<string, unknown>;
  notificationAuditId?: string;
  source: EmailAuditSource;
};

type ReadyTransportOptions = {
  ignoreEmailEnabled?: boolean;
  throwWhenUnavailable?: boolean;
  unavailableMessage?: string;
};

type ReadyTransportResult = {
  skipReason: string | null;
  transporter: Transporter<SMTPTransport.SentMessageInfo> | null;
};

function buildPasswordEmailBody(password: string, homeUrl: string): string {
  return `Your account password has been set. Use the password below to sign in.

<div style="margin:16px 0;padding:14px 18px;background-color:#1e293b;border:1px solid #334155;border-radius:10px;font-family:monospace;font-size:16px;color:#e2e8f0;word-break:break-all;">
  ${escapeHtml(password)}
</div>

<p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">
  To change your password, sign in to <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>,
  open <strong style="color:#e2e8f0;">Settings</strong>, expand <strong style="color:#e2e8f0;">Local Accounts</strong>,
  and use the <strong style="color:#e2e8f0;">My password</strong> section.
  </p>`;
}

function buildAccountUpdateEmailBody(
  changedFields: string[],
  homeUrl: string,
): string {
  const formattedFields = changedFields
    .map((field) => escapeHtml(field.replace(/_/g, ' ')))
    .join(', ');

  return `Your Tavi account was updated by an administrator.

<p style="margin:16px 0 0;">
  Updated fields: <strong style="color:#e2e8f0;">${formattedFields}</strong>
</p>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  Review your account in <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>.
</p>`;
}

function buildPasswordResetOtpEmailBody(
  oneTimePassword: string,
  homeUrl: string,
  expiresAt: Date,
): string {
  return `A one-time password was requested to reset your Tavi password.

<div style="margin:16px 0;padding:14px 18px;background-color:#1e293b;border:1px solid #334155;border-radius:10px;font-family:monospace;font-size:18px;letter-spacing:0.08em;color:#e2e8f0;">
  ${escapeHtml(oneTimePassword)}
</div>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  This code expires at <strong style="color:#e2e8f0;">${escapeHtml(expiresAt.toISOString())}</strong>.
</p>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  Enter the code on the <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi login screen</a>, set a new password, and sign in again with that new password.
 </p>`;
}

function buildTestEmailBody(homeUrl: string): string {
  return `This is a Tavi test email.

<p style="margin:16px 0 0;">
  If you received this message, outbound email delivery from Tavi is working for your account.
</p>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  Return to <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>
  to review the notification audit timeline.
</p>`;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;
  private smtpHost: string | null = null;
  private smtpPort: number | null = null;
  private smtpSecure = false;
  private fromAddress: string = DEFAULT_SMTP_FROM;
  private homeUrl: string = 'http://localhost:5173';
  private configured = false;
  private configurationIssue: string | null = null;

  constructor(
    private readonly logger: AppLogger,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const smtpUrl = process.env.SMTP_URL ?? DEFAULT_SMTP_URL;
    this.fromAddress = process.env.SMTP_FROM ?? DEFAULT_SMTP_FROM;
    this.homeUrl = process.env.TAVI_HOME_URL ?? 'http://localhost:5173';

    try {
      const { auth, host, port, secure } = parseSmtpUrl(smtpUrl);
      this.smtpHost = host;
      this.smtpPort = port;
      this.smtpSecure = secure;

      this.transporter = createTransport({
        host,
        port,
        secure,
        auth,
        tls: secure ? undefined : { rejectUnauthorized: false },
      });

      this.configured = true;
      this.configurationIssue = null;
      this.logger.log(
        `Email transport configured: ${host}:${port} (${secure ? 'TLS' : 'plain'})`,
        'EmailService',
      );
    } catch (error) {
      this.configured = false;
      this.configurationIssue =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Email transport not configured: ${error instanceof Error ? error.message : String(error)}`,
        'EmailService',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async getSmtpStatus(): Promise<SmtpStatus> {
    const settings = await this.readEmailSettings();

    return {
      dragHandlesEnabled: settings?.dragHandlesEnabled ?? true,
      enabled: settings?.enabled ?? true,
      guestAccessEnabled: settings?.guestAccessEnabled ?? true,
      configured: this.configured,
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpSecure,
      fromAddress: this.fromAddress,
    };
  }

  async updateEmailSettings(
    input: UpdateEmailSettingsInput,
  ): Promise<SmtpStatus> {
    const guestAccessEnabled = input.guestAccessEnabled === true;

    await this.prisma.emailSettings.upsert({
      where: { id: EMAIL_SETTINGS_ID },
      update: {
        dragHandlesEnabled: input.dragHandlesEnabled,
        enabled: input.enabled,
        guestAccessEnabled,
      },
      create: {
        dragHandlesEnabled: input.dragHandlesEnabled,
        id: EMAIL_SETTINGS_ID,
        enabled: input.enabled,
        guestAccessEnabled,
      },
    });

    return this.getSmtpStatus();
  }

  async setEmailEnabled(enabled: boolean): Promise<SmtpStatus> {
    const settings = await this.readEmailSettings();

    return this.updateEmailSettings({
      dragHandlesEnabled: settings?.dragHandlesEnabled ?? true,
      enabled,
      guestAccessEnabled: settings?.guestAccessEnabled ?? true,
    });
  }

  async sendPasswordEmail(
    recipient: EmailRecipient,
    plainPassword: string,
    context: Pick<EmailAuditContext, 'actor' | 'entityId'>,
  ): Promise<void> {
    const body = buildPasswordEmailBody(plainPassword, this.homeUrl);
    const sent = await this.sendAuditedEmail({
      context: {
        ...context,
        entityType: 'auth',
        kind: 'password_email',
        source: 'password_email',
      },
      html: buildEmailHtml(this.homeUrl, recipient.name, body),
      recipient,
      subject: 'Your Tavi account password',
      transportOptions: {},
    });

    if (!sent) {
      return;
    }
  }

  async sendAccountUpdateEmail(
    recipient: EmailRecipient,
    changedFields: string[],
    context: Pick<EmailAuditContext, 'actor' | 'entityId'>,
  ): Promise<boolean> {
    const body = buildAccountUpdateEmailBody(changedFields, this.homeUrl);
    return this.sendAuditedEmail({
      context: {
        ...context,
        entityType: 'auth',
        kind: 'account_update',
        metadata: {
          changedFields,
        },
        source: 'account_update',
      },
      html: buildEmailHtml(this.homeUrl, recipient.name, body),
      recipient,
      subject: 'Your Tavi account was updated',
      transportOptions: {},
      suppressFailure: true,
    });
  }

  async assertPasswordResetEmailAvailable(): Promise<void> {
    await this.getReadyTransport('password reset email', {
      ignoreEmailEnabled: true,
      throwWhenUnavailable: true,
    });
  }

  async sendPasswordResetOtpEmail(
    recipient: EmailRecipient,
    oneTimePassword: string,
    expiresAt: Date,
    context: Pick<EmailAuditContext, 'actor' | 'entityId'>,
  ): Promise<void> {
    const body = buildPasswordResetOtpEmailBody(
      oneTimePassword,
      this.homeUrl,
      expiresAt,
    );
    await this.sendAuditedEmail({
      context: {
        ...context,
        entityType: 'auth',
        kind: 'password_reset',
        metadata: {
          expiresAt: expiresAt.toISOString(),
        },
        source: 'password_reset',
      },
      html: buildEmailHtml(this.homeUrl, recipient.name, body),
      recipient,
      subject: 'Your Tavi one-time password',
      transportOptions: {
        ignoreEmailEnabled: true,
        throwWhenUnavailable: true,
        unavailableMessage: PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
      },
      failureErrorMessage: 'Unable to send password reset email',
    });
  }

  async sendTestEmail(
    recipient: EmailRecipient,
    actor: SessionUser,
  ): Promise<void> {
    const body = buildTestEmailBody(this.homeUrl);

    await this.sendAuditedEmail({
      context: {
        actor,
        entityId: actor.id,
        entityType: 'auth',
        kind: 'test_email',
        source: 'test_email',
      },
      html: buildEmailHtml(this.homeUrl, recipient.name, body),
      recipient,
      subject: 'Your Tavi test email',
      transportOptions: {
        ignoreEmailEnabled: true,
        throwWhenUnavailable: true,
        unavailableMessage: this.buildTransportUnavailableMessage(),
      },
      failureErrorMessage: 'Unable to send test email',
    });
  }

  private async getReadyTransport(
    emailType:
      | 'account update email'
      | 'password email'
      | 'test email'
      | 'password reset email',
    options?: ReadyTransportOptions,
  ): Promise<ReadyTransportResult> {
    if (!this.transporter) {
      if (options?.throwWhenUnavailable) {
        throw new ServiceUnavailableException(
          options.unavailableMessage ??
            PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
        );
      }

      this.logger.warn(
        `Skipping ${emailType} — SMTP not configured`,
        'EmailService',
      );
      return {
        skipReason: 'SMTP not configured',
        transporter: null,
      };
    }

    if (!options?.ignoreEmailEnabled) {
      const settings = await this.readEmailSettings();

      if (settings?.enabled === false) {
        if (options?.throwWhenUnavailable) {
          throw new ServiceUnavailableException(
            options.unavailableMessage ??
              PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
          );
        }

        this.logger.warn(
          `Skipping ${emailType} — email delivery is disabled`,
          'EmailService',
        );
        return {
          skipReason: 'Email delivery is disabled',
          transporter: null,
        };
      }
    }

    return {
      skipReason: null,
      transporter: this.transporter,
    };
  }

  private async sendAuditedEmail({
    context,
    failureErrorMessage,
    html,
    recipient,
    subject,
    transportOptions,
    suppressFailure = false,
  }: {
    context: EmailAuditContext;
    html: string;
    recipient: EmailRecipient;
    subject: string;
    failureErrorMessage?: string;
    suppressFailure?: boolean;
    transportOptions: ReadyTransportOptions;
  }): Promise<boolean> {
    const notificationAuditId = context.notificationAuditId ?? randomUUID();
    let readyTransport: ReadyTransportResult;

    try {
      readyTransport = await this.getReadyTransport(
        toEmailTypeLabel(context.kind),
        transportOptions,
      );
    } catch (error) {
      await this.recordEmailAuditStep({
        context,
        detail: error instanceof Error ? error.message : String(error),
        notificationAuditId,
        recipient,
        status: 'failed',
        subject,
        title: `Unable to start ${formatEmailAuditKindLabel(context.kind)}`,
      });
      throw error;
    }

    const { skipReason, transporter } = readyTransport;

    if (!transporter) {
      await this.recordEmailAuditStep({
        context,
        detail: skipReason,
        notificationAuditId,
        recipient,
        status: 'skipped',
        subject,
        title: `Skipped ${formatEmailAuditKindLabel(context.kind)}`,
      });
      return false;
    }

    await this.recordEmailAuditStep({
      context,
      detail: `Sending to ${recipient.email} via ${this.formatSmtpHostLabel()}`,
      host: this.formatSmtpHostLabel(),
      notificationAuditId,
      recipient,
      status: 'processing',
      subject,
      title: `Sending ${formatEmailAuditKindLabel(context.kind)}`,
    });

    try {
      const result = await transporter.sendMail({
        from: this.fromAddress,
        to: recipient.email,
        subject,
        html,
      });

      await this.recordEmailAuditStep({
        context,
        detail: `Accepted by host for ${recipient.email}`,
        host: this.formatSmtpHostLabel(),
        notificationAuditId,
        recipient,
        response: result.response ?? null,
        status: 'sent',
        subject,
        title: `Host accepted ${formatEmailAuditKindLabel(context.kind)}`,
      });

      this.logger.log(
        `${formatEmailAuditKindLogPrefix(context.kind)} sent to ${recipient.email}`,
        'EmailService',
      );

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const response = readEmailTransportResponse(error);

      await this.recordEmailAuditStep({
        context,
        detail: message,
        host: this.formatSmtpHostLabel(),
        notificationAuditId,
        recipient,
        response,
        status: 'failed',
        subject,
        title: `Host rejected ${formatEmailAuditKindLabel(context.kind)}`,
      });

      this.logger.error(
        `Failed to send ${formatEmailAuditKindLogPrefix(context.kind)} to ${recipient.email}: ${message}`,
        undefined,
        'EmailService',
      );

      if (suppressFailure) {
        return false;
      }

      throw new Error(
        this.buildSendFailureMessage({
          host: this.formatSmtpHostLabel(),
          message,
          prefix:
            failureErrorMessage ??
            `Unable to send ${formatEmailAuditKindLabel(context.kind)}`,
          recipient,
          response,
        }),
        { cause: error },
      );
    }
  }

  private async recordEmailAuditStep({
    context,
    detail,
    host,
    notificationAuditId,
    recipient,
    response,
    status,
    subject,
    title,
  }: {
    context: EmailAuditContext;
    detail: string | null;
    host?: string | null;
    notificationAuditId: string;
    recipient: EmailRecipient;
    response?: string | null;
    status: 'failed' | 'processing' | 'sent' | 'skipped';
    subject: string;
    title: string;
  }) {
    const actor = context.actor ?? EMAIL_AUDIT_SYSTEM_ACTOR;

    await this.prisma.auditEvent.create({
      data: {
        actorEmail: actor.email,
        actorName: actor.name,
        actorRole: actor.role,
        actorUserId: actor.id,
        entityId: context.entityId ?? notificationAuditId,
        entityType: context.entityType,
        action: `email_${context.kind}_${status}`,
        metadata: {
          ...context.metadata,
          detail,
          emailKind: context.kind,
          host: host ?? null,
          notificationAuditId,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          recipientUserId: context.entityId,
          response: response ?? null,
          source: context.source,
          status,
          stepTitle: title,
          subject,
        },
      },
    });
  }

  private formatSmtpHostLabel() {
    if (!this.smtpHost || !this.smtpPort) {
      return null;
    }

    return `${this.smtpHost}:${this.smtpPort.toString()}`;
  }

  private buildTransportUnavailableMessage() {
    const details = [
      this.configurationIssue
        ? `SMTP configuration error: ${this.configurationIssue}`
        : 'SMTP transport is not configured',
      this.formatSmtpHostLabel()
        ? `Configured host ${this.formatSmtpHostLabel()}`
        : null,
      `From ${this.fromAddress}`,
      'Check SMTP_URL (including protocol, host, port, and any required credentials)',
    ].filter((value): value is string => Boolean(value));

    return `${TEST_EMAIL_UNAVAILABLE_MESSAGE}. ${details.join('. ')}.`;
  }

  private buildSendFailureMessage({
    host,
    message,
    prefix,
    recipient,
    response,
  }: {
    host: string | null;
    message: string;
    prefix: string;
    recipient: EmailRecipient;
    response: string | null;
  }) {
    const details = [
      prefix,
      `Recipient ${recipient.email}`,
      `From ${this.fromAddress}`,
      host ? `Host ${host}` : null,
      response ? `SMTP response ${response}` : null,
      `Error ${message}`,
    ].filter((value): value is string => Boolean(value));

    return `${details.join('. ')}.`;
  }

  private readEmailSettings() {
    return this.prisma.emailSettings.findUnique({
      where: { id: EMAIL_SETTINGS_ID },
      select: {
        dragHandlesEnabled: true,
        enabled: true,
        guestAccessEnabled: true,
      },
    });
  }
}

export {
  buildAccountUpdateEmailBody,
  buildEmailHtml,
  buildPasswordEmailBody,
  buildTestEmailBody,
  parseSmtpUrl,
  escapeHtml,
};

function formatEmailAuditKindLabel(kind: string) {
  switch (kind) {
    case 'account_update':
      return 'account update email';
    case 'password_email':
      return 'password email';
    case 'password_reset':
      return 'password reset email';
    case 'test_email':
      return 'test email';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function formatEmailAuditKindLogPrefix(kind: string) {
  switch (kind) {
    case 'account_update':
      return 'account update email';
    case 'password_email':
      return 'password email';
    case 'password_reset':
      return 'password reset email';
    case 'test_email':
      return 'test email';
    default:
      return kind.replace(/_/g, ' ');
  }
}

function readEmailTransportResponse(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    typeof error.response === 'string'
  ) {
    return error.response;
  }

  return null;
}

function toEmailTypeLabel(
  kind: string,
):
  | 'account update email'
  | 'password email'
  | 'password reset email'
  | 'test email' {
  switch (kind) {
    case 'account_update':
      return 'account update email';
    case 'password_email':
      return 'password email';
    case 'test_email':
      return 'test email';
    default:
      return 'password reset email';
  }
}
