import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupSettingsCard } from "./BackupSettingsCard";
import {
  formatDateTime,
  getLocalTimeZoneLabel,
  localTimeToUtcTime,
  utcTimeToLocalTime,
} from "./time";
import type { BackupRestorePreview, BackupStatus } from "./types";

function createResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createBackupStatus(
  overrides: Partial<BackupStatus> = {},
): BackupStatus {
  return {
    backupDirectory: "/var/tavi/backups",
    backupDirectoryAccessible: true,
    backups: [
      {
        createdAt: "2026-04-18T10:00:00.000Z",
        fileName: "backup-1.json",
        modifiedAt: "2026-04-18T10:00:00.000Z",
        protected: false,
        protectedAt: null,
        protectedByName: null,
        sizeBytes: 1024,
      },
    ],
    enabled: true,
    lastError: null,
    lastFailureAt: null,
    lastScheduledRunAt: null,
    lastSuccessAt: null,
    retentionPolicy: {
      dailyCount: 7,
      monthlyCount: 3,
      weeklyCount: 4,
    },
    scheduleTime: "02:00",
    totalSizeBytes: 1024,
    ...overrides,
  };
}

function createPreview(
  overrides: Partial<BackupRestorePreview> = {},
): BackupRestorePreview {
  return {
    counts: {
      auditEvents: 0,
      backupSettings: 1,
      emailSettings: 1,
      importJobs: 0,
      importRows: 0,
      notificationDeliveryAttempts: 0,
      notificationEvents: 0,
      projects: 1,
      projectViewStates: 0,
      retentionSettings: 1,
      roleAssignments: 0,
      savedViews: 0,
      tasks: 2,
      taskViewStates: 0,
      users: 0,
    },
    createdAt: "2026-04-18T10:00:00.000Z",
    fileName: "backup-1.json",
    format: "tavi-backup-v1",
    projects: [
      {
        backupId: "project-1",
        conflict: { kind: "none" },
        dueDate: null,
        missingAssigneeCount: 0,
        missingOwner: false,
        ownerName: "Tavi Admin",
        taskCount: 2,
        title: "Roadmap refresh",
      },
    ],
    sourceLabel: "Stored backup",
    users: [],
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const onNotice = vi.fn();

  return {
    onNotice,
    ...render(
      <QueryClientProvider client={queryClient}>
        <BackupSettingsCard onNotice={onNotice} variant="panel" />
      </QueryClientProvider>,
    ),
  };
}

describe("BackupSettingsCard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clears existing projects and tasks from restore controls without seeding examples", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/backups") && !init?.method) {
          return createResponse(createBackupStatus());
        }

        if (
          url.endsWith("/backups/restore/preview") &&
          init?.method === "POST"
        ) {
          return createResponse(createPreview());
        }

        if (
          url.endsWith("/workspace/reset-examples") &&
          init?.method === "POST"
        ) {
          expect(JSON.parse(init.body as string)).toEqual({
            password: "current-password-123",
            seedExamples: false,
          });

          return createResponse({
            createdProjectCount: 0,
            createdTaskCount: 0,
            deletedProjectCount: 3,
            deletedTaskCount: 9,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderCard();

    await screen.findByText("backup-1.json");

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText("Projects (1/1)")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear all existing projects/tasks",
      }),
    );

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
        "Cleared workspace data: removed 3 projects and 9 tasks.",
      );
    });
  });

  it("keeps the clear action visible for users-only restore", async () => {
    const basePreview = createPreview();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/backups") && !init?.method) {
          return createResponse(createBackupStatus());
        }

        if (
          url.endsWith("/backups/restore/preview") &&
          init?.method === "POST"
        ) {
          return createResponse({
            ...basePreview,
            counts: {
              ...basePreview.counts,
              users: 1,
            },
            users: [
              {
                backupId: "user-1",
                conflict: { kind: "none" },
                email: "admin@tavi.local",
                name: "Tavi Admin",
                role: "admin",
              },
            ],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    await screen.findByText("backup-1.json");

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Clear all existing projects/tasks",
        }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("radio", { name: "Users only" }));

    await waitFor(() => {
      expect(screen.getByText("Users (1/1)")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Clear all existing projects/tasks" }),
    ).toBeInTheDocument();
  });

  it("shows backup timestamps in local time with timezone and saves schedule time in UTC", async () => {
    const lastSuccessAt = "2026-04-18T11:30:00.000Z";
    const backupModifiedAt = "2026-04-18T10:00:00.000Z";
    let updateRequestBody: string | null = null;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/backups") && !init?.method) {
          return createResponse(
            createBackupStatus({
              backups: [
                {
                  createdAt: backupModifiedAt,
                  fileName: "backup-1.json",
                  modifiedAt: backupModifiedAt,
                  protected: false,
                  protectedAt: null,
                  protectedByName: null,
                  sizeBytes: 1024,
                },
              ],
              lastSuccessAt,
              scheduleTime: "02:00",
            }),
          );
        }

        if (url.endsWith("/backups") && init?.method === "PUT") {
          updateRequestBody = typeof init.body === "string" ? init.body : null;
          const payload = JSON.parse(updateRequestBody ?? "{}") as {
            enabled: boolean;
            scheduleTime: string;
          };

          return createResponse(
            createBackupStatus({
              backups: [
                {
                  createdAt: backupModifiedAt,
                  fileName: "backup-1.json",
                  modifiedAt: backupModifiedAt,
                  protected: false,
                  protectedAt: null,
                  protectedByName: null,
                  sizeBytes: 1024,
                },
              ],
              enabled: payload.enabled,
              lastSuccessAt,
              scheduleTime: payload.scheduleTime,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderCard();

    await screen.findByText("backup-1.json");

    expect(
      screen.getByText(
        `Dates and times use your local timezone (${getLocalTimeZoneLabel()}). Backup time is saved in UTC.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(lastSuccessAt))).toBeInTheDocument();
    expect(
      screen.getByText(`${formatDateTime(backupModifiedAt)} · 1.0 KB`),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Backup time")).toHaveValue(
      utcTimeToLocalTime("02:00"),
    );

    fireEvent.change(screen.getByLabelText("Backup time"), {
      target: { value: "09:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(JSON.parse(updateRequestBody ?? "{}")).toEqual({
        enabled: true,
        scheduleTime: localTimeToUtcTime("09:15"),
      });
      expect(onNotice).toHaveBeenCalledWith(
        `Automatic backups enabled for 09:15 (${getLocalTimeZoneLabel()}).`,
      );
    });
  });

  it("shows storage, saves tiered retention, protects files, and keeps restore controls above the list", async () => {
    const updateRequests: unknown[] = [];
    const protectionRequests: unknown[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/backups") && !init?.method) {
          return createResponse(
            createBackupStatus({
              backups: [
                {
                  createdAt: "2026-04-18T10:00:00.000Z",
                  fileName: "backup-1.json",
                  modifiedAt: "2026-04-18T10:00:00.000Z",
                  protected: false,
                  protectedAt: null,
                  protectedByName: null,
                  sizeBytes: 1024,
                },
                {
                  createdAt: "2026-04-17T10:00:00.000Z",
                  fileName: "backup-2.json",
                  modifiedAt: "2026-04-17T10:00:00.000Z",
                  protected: true,
                  protectedAt: "2026-04-18T12:00:00.000Z",
                  protectedByName: "Tavi Admin",
                  sizeBytes: 2048,
                },
              ],
              totalSizeBytes: 3072,
            }),
          );
        }

        if (url.endsWith("/backups") && init?.method === "PUT") {
          const payload = JSON.parse(String(init.body ?? "{}"));
          updateRequests.push(payload);
          return createResponse(
            createBackupStatus({
              retentionPolicy: payload.retentionPolicy,
              totalSizeBytes: 3072,
            }),
          );
        }

        if (
          url.endsWith("/backups/backup-1.json/protection") &&
          init?.method === "PATCH"
        ) {
          const payload = JSON.parse(String(init.body ?? "{}"));
          protectionRequests.push(payload);
          return createResponse(
            createBackupStatus({
              backups: [
                {
                  createdAt: "2026-04-18T10:00:00.000Z",
                  fileName: "backup-1.json",
                  modifiedAt: "2026-04-18T10:00:00.000Z",
                  protected: true,
                  protectedAt: "2026-04-18T12:30:00.000Z",
                  protectedByName: "Tavi Admin",
                  sizeBytes: 1024,
                },
              ],
              totalSizeBytes: 1024,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderCard();

    await screen.findByText("backup-1.json");
    expect(screen.getByText("3.0 KB")).toBeInTheDocument();
    expect(
      screen.getByText("7 daily / 4 weekly / 3 monthly"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Protected by Tavi Admin/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Daily backup retention"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Weekly backup retention"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save retention" }));

    await waitFor(() => {
      expect(updateRequests).toEqual([
        {
          enabled: true,
          retentionPolicy: {
            dailyCount: 0,
            monthlyCount: 3,
            weeklyCount: 2,
          },
          scheduleTime: "02:00",
        },
      ]);
      expect(onNotice).toHaveBeenCalledWith(
        "Backup retention saved: 0 daily / 2 weekly / 3 monthly.",
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open restore controls" }),
    );
    const restorePanel = document.querySelector(".backup-restore-panel");
    const storedList = document.querySelector(".backup-storage-list");
    expect(restorePanel).not.toBeNull();
    expect(storedList).not.toBeNull();
    expect(
      restorePanel!.compareDocumentPosition(storedList!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Protect" }));

    await waitFor(() => {
      expect(protectionRequests).toEqual([{ protected: true }]);
      expect(onNotice).toHaveBeenCalledWith("Protected backup-1.json.");
    });
  });
});
