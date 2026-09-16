import { ServiceUnavailableException } from '@nestjs/common';
import { EmailService } from './email.service';
import type { AppLogger } from './app-logger';
import type { PrismaService } from './prisma.service';

describe('EmailService', () => {
  type SendMailArgs = {
    from: string;
    html: string;
    subject: string;
    to: string;
  };

  const createService = (enabled: boolean | null = true) => {
    let currentEnabled = enabled;
    let currentDragHandlesEnabled = true;
    let currentGuestAccessEnabled = true;
    const upsertMock = jest.fn(
      ({
        create,
        update,
      }: {
        create: {
          dragHandlesEnabled: boolean;
          enabled: boolean;
          guestAccessEnabled: boolean;
        };
        update: {
          dragHandlesEnabled: boolean;
          enabled: boolean;
          guestAccessEnabled: boolean;
        };
      }) => {
        currentEnabled = update.enabled ?? create.enabled;
        currentDragHandlesEnabled =
          update.dragHandlesEnabled ?? create.dragHandlesEnabled;
        currentGuestAccessEnabled =
          update.guestAccessEnabled ?? create.guestAccessEnabled;
        return Promise.resolve({
          dragHandlesEnabled: currentDragHandlesEnabled,
          enabled: currentEnabled,
          guestAccessEnabled: currentGuestAccessEnabled,
        });
      },
    );
    const prisma = {
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
      emailSettings: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            currentEnabled === null
              ? null
              : {
                  dragHandlesEnabled: currentDragHandlesEnabled,
                  enabled: currentEnabled,
                  guestAccessEnabled: currentGuestAccessEnabled,
                },
          ),
        ),
        upsert: upsertMock,
      },
    } as unknown as PrismaService;
    const warnMock = jest.fn();
    const logger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: warnMock,
    } as unknown as AppLogger;
    const service = new EmailService(logger, prisma);
    const sendMail = jest.fn<Promise<{ response: string }>, [SendMailArgs]>(
      () =>
        Promise.resolve({
          response: '250 2.0.0 Ok',
        }),
    );

    Object.assign(service, {
      configured: true,
      fromAddress: 'noreply@tavi.local',
      homeUrl: 'http://localhost:5173',
      smtpUrl: 'smtp://10.120.64.99:25',
      smtpHost: '10.120.64.99',
      smtpPort: 25,
      smtpSecure: false,
      transporter: {
        sendMail,
      },
    });

    return {
      logger,
      prisma,
      sendMail,
      service,
      upsertMock,
      warnMock,
    };
  };

  it('defaults email delivery to enabled when no settings record exists', async () => {
    const { service } = createService(null);

    await expect(service.getSmtpStatus()).resolves.toEqual({
      configured: true,
      dragHandlesEnabled: true,
      enabled: true,
      guestAccessEnabled: true,
      fromAddress: 'noreply@tavi.local',
      homeUrl: 'http://localhost:5173',
      smtpUrl: 'smtp://10.120.64.99:25',
      smtpUrlSource: 'environment',
      fromAddressSource: 'environment',
      homeUrlSource: 'environment',
      host: '10.120.64.99',
      port: 25,
      secure: false,
    });
  });

  it('persists the global email delivery setting', async () => {
    const { service, upsertMock } = createService(true);

    await expect(service.setEmailEnabled(false)).resolves.toEqual({
      configured: true,
      dragHandlesEnabled: true,
      enabled: false,
      guestAccessEnabled: true,
      fromAddress: 'noreply@tavi.local',
      homeUrl: 'http://localhost:5173',
      smtpUrl: 'smtp://10.120.64.99:25',
      smtpUrlSource: 'environment',
      fromAddressSource: 'environment',
      homeUrlSource: 'environment',
      host: '10.120.64.99',
      port: 25,
      secure: false,
    });
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: {
        dragHandlesEnabled: true,
        enabled: false,
        guestAccessEnabled: true,
        smtpUrl: undefined,
        fromAddress: null,
        homeUrl: null,
      },
      create: {
        dragHandlesEnabled: true,
        id: 'global',
        enabled: false,
        guestAccessEnabled: true,
        smtpUrl: null,
        fromAddress: null,
        homeUrl: null,
      },
    });
  });

  it('persists task drag handle and delivery settings without a digest override', async () => {
    const { service, upsertMock } = createService(true);

    await expect(
      service.updateEmailSettings({
        dragHandlesEnabled: false,
        enabled: true,
        guestAccessEnabled: false,
      }),
    ).resolves.toEqual({
      configured: true,
      dragHandlesEnabled: false,
      enabled: true,
      guestAccessEnabled: false,
      fromAddress: 'noreply@tavi.local',
      homeUrl: 'http://localhost:5173',
      smtpUrl: 'smtp://10.120.64.99:25',
      smtpUrlSource: 'environment',
      fromAddressSource: 'environment',
      homeUrlSource: 'environment',
      host: '10.120.64.99',
      port: 25,
      secure: false,
    });

    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: {
        dragHandlesEnabled: false,
        enabled: true,
        guestAccessEnabled: false,
        smtpUrl: undefined,
        fromAddress: null,
        homeUrl: null,
      },
      create: {
        dragHandlesEnabled: false,
        id: 'global',
        enabled: true,
        guestAccessEnabled: false,
        smtpUrl: null,
        fromAddress: null,
        homeUrl: null,
      },
    });
  });

  it('skips all outbound email when delivery is disabled', async () => {
    const { sendMail, service, warnMock } = createService(false);

    await service.sendPasswordEmail(
      { email: 'viewer@tavi.local', name: 'Viewer' },
      'temp-password',
      {
        actor: {
          email: 'admin@tavi.local',
          id: 'admin-1',
          name: 'Admin User',
          role: 'admin',
        },
        entityId: 'user-2',
      },
    );
    await expect(
      service.sendAccountUpdateEmail(
        { email: 'viewer@tavi.local', name: 'Viewer' },
        ['name'],
        {
          actor: {
            email: 'admin@tavi.local',
            id: 'admin-1',
            name: 'Admin User',
            role: 'admin',
          },
          entityId: 'user-2',
        },
      ),
    ).resolves.toBe(false);

    expect(sendMail).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      'Skipping password email — email delivery is disabled',
      'EmailService',
    );
    expect(warnMock).toHaveBeenCalledWith(
      'Skipping account update email — email delivery is disabled',
      'EmailService',
    );
  });

  it('sends password reset emails with the one-time password', async () => {
    const { sendMail, service } = createService(true);
    const expiresAt = new Date('2026-04-18T18:40:00.000Z');

    await expect(
      service.sendPasswordResetOtpEmail(
        { email: 'viewer@tavi.local', name: 'Viewer' },
        'ABCD-1234',
        expiresAt,
        {
          actor: {
            email: 'viewer@tavi.local',
            id: 'user-2',
            name: 'Viewer',
            role: 'viewer',
          },
          entityId: 'user-2',
        },
      ),
    ).resolves.toBeUndefined();

    const firstSendMailCall = sendMail.mock.calls.at(0);
    if (!firstSendMailCall) {
      throw new Error('Expected a password reset email send call');
    }

    const [sendMailCall] = firstSendMailCall;

    expect(sendMailCall.from).toBe('noreply@tavi.local');
    expect(sendMailCall.to).toBe('viewer@tavi.local');
    expect(sendMailCall.subject).toBe('Your Tavi one-time password');
    expect(sendMailCall.html).toContain('ABCD-1234');
    expect(sendMailCall.html).not.toContain(['data', 'image'].join(':'));
    expect(sendMailCall.html).not.toContain(['base', '64'].join(''));
    expect(sendMailCall.html).not.toContain('<img');
    expect(sendMailCall.html).toContain('aria-label="Tavi home"');
    expect(sendMailCall.html).toMatch(
      /aria-label="Tavi home"[\s\S]*>\s*Tavi\s*<\/a>/,
    );
  });

  it('still sends password reset emails when delivery is disabled', async () => {
    const { sendMail, service, warnMock } = createService(false);
    const expiresAt = new Date('2026-04-18T18:40:00.000Z');

    await expect(
      service.sendPasswordResetOtpEmail(
        { email: 'viewer@tavi.local', name: 'Viewer' },
        'ABCD-1234',
        expiresAt,
        {
          actor: {
            email: 'viewer@tavi.local',
            id: 'user-2',
            name: 'Viewer',
            role: 'viewer',
          },
          entityId: 'user-2',
        },
      ),
    ).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(warnMock).not.toHaveBeenCalledWith(
      'Skipping password reset email — email delivery is disabled',
      'EmailService',
    );
  });

  it('allows password reset availability when delivery is disabled', async () => {
    const { service } = createService(false);

    await expect(
      service.assertPasswordResetEmailAvailable(),
    ).resolves.toBeUndefined();
  });

  it('blocks password reset when outbound email is unavailable', async () => {
    const { service } = createService(true);

    Object.assign(service, {
      transporter: null,
    });

    await expect(
      service.assertPasswordResetEmailAvailable(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns actionable test email configuration errors', async () => {
    const { service } = createService(true);

    Object.assign(service, {
      configurationIssue: 'Invalid SMTP_URL: missing host',
      smtpHost: null,
      smtpPort: null,
      transporter: null,
    });

    await expect(
      service.sendTestEmail(
        { email: 'admin@tavi.local', name: 'Admin User' },
        {
          email: 'admin@tavi.local',
          id: 'admin-1',
          name: 'Admin User',
          role: 'admin',
        },
      ),
    ).rejects.toThrow(
      'Test email is unavailable right now. SMTP configuration error: Invalid SMTP_URL: missing host. From noreply@tavi.local. Check SMTP_URL (including protocol, host, port, and any required credentials).',
    );
  });

  it('returns actionable SMTP rejection details for test email sends', async () => {
    const { sendMail, service } = createService(true);

    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Connection closed unexpectedly'), {
        response: '554 5.7.1 blocked',
      }),
    );

    await expect(
      service.sendTestEmail(
        { email: 'admin@tavi.local', name: 'Admin User' },
        {
          email: 'admin@tavi.local',
          id: 'admin-1',
          name: 'Admin User',
          role: 'admin',
        },
      ),
    ).rejects.toThrow(
      'Unable to send test email. Recipient admin@tavi.local. From noreply@tavi.local. Host 10.120.64.99:25. SMTP response 554 5.7.1 blocked. Error Connection closed unexpectedly.',
    );
  });
});
