import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { appRepositoryUrl } from "@tavi/config";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { maskSmtpPassword } from "./redact-secrets";
import type {
  AuditHistoryEvent,
  EmailAuditEvent,
  Priority,
  RetentionStatus,
  SavedViewPayload,
  UpdateRetentionSettingsPayload,
  UpdateSavedViewPayload,
  WorkspaceProject,
  WorkspaceResponse,
} from "./types";

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

const createResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const readJsonRequestBody = <Payload,>(init?: RequestInit): Payload =>
  JSON.parse(String(init?.body)) as Payload;

const createSmtpStatusPayload = (
  overrides: Partial<{
    configured: boolean;
    dragHandlesEnabled: boolean;
    enabled: boolean;
    fromAddress: string;
    homeUrl: string;
    smtpUrl: string;
    smtpUrlSource: "database" | "environment";
    fromAddressSource: "database" | "environment";
    homeUrlSource: "database" | "environment";
    guestAccessEnabled: boolean;
    host: string | null;
    port: number | null;
    secure: boolean;
  }> = {},
) => ({
  configured: true,
  dragHandlesEnabled: true,
  enabled: true,
  fromAddress: "noreply@tavi.local",
  homeUrl: "http://localhost:5173",
  smtpUrl: "smtp://10.120.64.99:25",
  smtpUrlSource: "environment",
  fromAddressSource: "environment",
  homeUrlSource: "environment",
  guestAccessEnabled: true,
  host: "10.120.64.99",
  port: 25,
  secure: false,
  ...overrides,
});

const createRetentionStatusPayload = (
  overrides: Partial<RetentionStatus> = {},
): RetentionStatus => ({
  backups: {
    estimatedSizeBytes: 5_242_880,
    policy: {
      dailyCount: 7,
      monthlyCount: 3,
      weeklyCount: 4,
    },
    retainedItemCount: 8,
  },
  changes: {
    estimatedSizeBytes: 131_072,
    policy: "twelve_months",
    retainedItemCount: 64,
  },
  logins: {
    estimatedSizeBytes: 65_536,
    policy: "twelve_months",
    retainedItemCount: 31,
  },
  notifications: {
    estimatedSizeBytes: 16_384,
    policy: "one_month",
    retainedItemCount: 12,
  },
  ...overrides,
});

const formatExpectedCalendarDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(
    new Date(value),
  );

const toLocalTimeInputFromUtc = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  const date = new Date();
  date.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const toUtcTimeInputFromLocal = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  const date = new Date();
  date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
};

const createWorkspacePayload = (): WorkspaceResponse => ({
  currentUser: {
    id: "user-1",
    email: "editor@tavi.local",
    name: "Tavi Editor",
    role: "editor",
  },
  users: [
    {
      id: "user-1",
      email: "editor@tavi.local",
      name: "Tavi Editor",
      role: "editor",
    },
    {
      id: "user-2",
      email: "viewer@tavi.local",
      name: "Tavi Viewer",
      role: "viewer",
    },
  ],
  personalTodos: [
    {
      id: "todo-1",
      title: "Private draft",
      notes: "Capture follow-up items",
      dueDate: "2026-04-12T00:00:00.000Z",
      status: "todo",
      sortOrder: 0,
      completedAt: null,
      createdAt: "2026-04-02T08:00:00.000Z",
      updatedAt: "2026-04-02T08:00:00.000Z",
    },
    {
      id: "todo-2",
      title: "Closed loop",
      notes: "Already wrapped",
      dueDate: null,
      status: "done",
      sortOrder: 1,
      completedAt: "2026-04-03T08:00:00.000Z",
      createdAt: "2026-04-03T08:00:00.000Z",
      updatedAt: "2026-04-03T08:00:00.000Z",
    },
  ],
  projects: [
    {
      id: "project-1",
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      ownerName: "Tavi Editor",
      dueDate: null,
      priority: "medium",
      derivedStatus: "in_progress",
      displayStatus: "blocked",
      manualStatus: "blocked",
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: null,
          priority: "medium",
          status: "not_started",
          sortOrder: 0,
          completedAt: null,
          createdAt: "2026-04-01T11:00:00.000Z",
          updatedAt: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "task-2",
          projectId: "project-1",
          title: "Review plan",
          notes: "Validate timing",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "medium",
          status: "in_progress",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-04-01T12:00:00.000Z",
          updatedAt: "2026-04-02T12:00:00.000Z",
        },
      ],
    },
  ],
  savedViews: [
    {
      id: "view-1",
      name: "Blocked review",
      groupBy: "status",
      search: "Roadmap",
      sortBy: ["progress"],
      statusFilters: ["blocked"],
      assigneeUserIds: [],
      collapsedGroupKeys: ["done"],
      expandedProjectIds: ["project-1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  userConfig: {
    addTaskPanels: {},
    collapsedGroups: {},
    filters: {
      assigneeUserIds: [],
      groupBy: "owner",
      notViewedOnly: false,
      sortBy: [],
      statusFilters: [],
    },
    hideDonePersonalTodos: false,
    hideDoneTasksByProject: {},
    noteEditorHeights: {
      project: null,
      task: null,
    },
    panels: {
      backups: false,
      importExport: false,
      newProject: false,
      personalTodo: false,
      profile: false,
      settings: false,
      view: false,
    },
    preferences: {
      autoCollapse: true,
      bulkActions: true,
      fullWidth: false,
      theme: "light",
    },
  },
  workspaceSettings: {
    dragHandlesEnabled: true,
  },
});

const createAdminWorkspacePayload = (): WorkspaceResponse => {
  const payload = createWorkspacePayload();

  payload.currentUser = {
    ...payload.currentUser,
    role: "admin",
  };
  payload.users[0] = {
    ...payload.users[0],
    role: "admin",
  };

  return payload;
};

const createGuestWorkspacePayload = (): WorkspaceResponse => {
  const payload = createWorkspacePayload();

  payload.currentUser = {
    email: "guest@tavi.local",
    id: "guest-user-1",
    name: "Guest",
    role: "viewer",
  };
  payload.personalTodos = [];
  payload.savedViews = [];
  payload.userConfig.panels = {
    backups: false,
    importExport: false,
    newProject: false,
    personalTodo: false,
    profile: false,
    settings: false,
    view: false,
  };

  return payload;
};

const createSortedWorkspacePayload = (): WorkspaceResponse => {
  const payload = createWorkspacePayload();

  payload.projects = [
    {
      id: "project-1",
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      ownerName: "Tavi Editor",
      dueDate: null,
      priority: "medium",
      derivedStatus: "in_progress",
      displayStatus: "blocked",
      manualStatus: "blocked",
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-01-15T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: null,
          priority: "medium",
          status: "not_started",
          sortOrder: 0,
          completedAt: null,
          createdAt: "2026-01-16T09:00:00.000Z",
          updatedAt: "2026-04-03T10:00:00.000Z",
        },
        {
          id: "task-2",
          projectId: "project-1",
          title: "Review plan",
          notes: "Validate timing",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "medium",
          status: "in_progress",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-01-17T09:00:00.000Z",
          updatedAt: "2026-04-07T11:00:00.000Z",
        },
      ],
    },
    {
      id: "project-2",
      title: "Beta rollout",
      notes: "Track launch blockers",
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: "2026-04-10T00:00:00.000Z",
      priority: "high",
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      manualStatus: null,
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 1,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-04-06T08:00:00.000Z",
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Check release notes",
          notes: null,
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: "2026-04-09T00:00:00.000Z",
          priority: "high",
          status: "done",
          sortOrder: 0,
          completedAt: "2026-04-01T12:00:00.000Z",
          createdAt: "2026-02-02T09:00:00.000Z",
          updatedAt: "2026-04-06T08:00:00.000Z",
        },
        {
          id: "task-4",
          projectId: "project-2",
          title: "Confirm staging",
          notes: null,
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: "2026-04-08T00:00:00.000Z",
          priority: "medium",
          status: "not_started",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-02-03T09:00:00.000Z",
          updatedAt: "2026-04-05T09:00:00.000Z",
        },
      ],
    },
    {
      id: "project-3",
      title: "Alpha planning",
      notes: "Prep the next cycle",
      references: null,
      ownerUserId: null,
      ownerName: null,
      dueDate: "2026-04-05T00:00:00.000Z",
      priority: "low",
      derivedStatus: "done",
      displayStatus: "done",
      manualStatus: null,
      taskTotalCount: 2,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 2,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-03-01T09:00:00.000Z",
      updatedAt: "2026-04-01T07:00:00.000Z",
      tasks: [
        {
          id: "task-5",
          projectId: "project-3",
          title: "Outline milestones",
          notes: null,
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: "2026-04-03T00:00:00.000Z",
          priority: "low",
          status: "done",
          sortOrder: 0,
          completedAt: "2026-03-30T09:00:00.000Z",
          createdAt: "2026-03-02T09:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
        {
          id: "task-6",
          projectId: "project-3",
          title: "Close prep work",
          notes: null,
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: "2026-04-04T00:00:00.000Z",
          priority: "low",
          status: "done",
          sortOrder: 1,
          completedAt: "2026-03-31T11:00:00.000Z",
          createdAt: "2026-03-03T09:00:00.000Z",
          updatedAt: "2026-04-02T06:00:00.000Z",
        },
      ],
    },
  ];

  return payload;
};

const createNotificationPreferencesPayload = (
  overrides: Partial<{
    dailyDigestEnabled: boolean;
    dailyDigestTime: string;
    personalTodoRetention:
      | "never"
      | "one_month"
      | "three_months"
      | "six_months"
      | "twelve_months"
      | "delete_when_done";
    personalTodoRemindersEnabled: boolean;
  }> = {},
) => ({
  dailyDigestEnabled: false,
  dailyDigestTime: "11:00",
  personalTodoRetention: "never",
  personalTodoRemindersEnabled: true,
  ...overrides,
});

const getTomorrowLocalDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
};

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year.toString()}-${month}-${day}`;
};

describe("App", () => {
  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

  const renderApp = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>,
    );

  const toggleProjectByTitle = (title: string) => {
    const projectHeading = screen
      .getAllByText(title)
      .find((element) => element.closest("article"));

    expect(projectHeading).toBeDefined();

    const projectCard = projectHeading?.closest("article");

    expect(projectCard).not.toBeNull();

    const expandButton = projectCard?.querySelector("button.group-toggle");

    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton!);

    return projectCard!;
  };

  const toggleGroupByTitle = (title: string) => {
    const groupCard = screen
      .getByRole("heading", { name: title })
      .closest("section");

    expect(groupCard).not.toBeNull();

    const groupHeader = groupCard?.querySelector(".group-header");

    expect(groupHeader).toBeTruthy();
    fireEvent.click(groupHeader!);

    return groupCard!;
  };

  const openPersonalTodoFromProfile = async (
    expectedPanelText: string | null = "Private draft",
  ) => {
    const profileButton = document.querySelector<HTMLButtonElement>(
      ".header-user-button",
    );

    expect(profileButton).not.toBeNull();
    fireEvent.click(profileButton!);

    await waitFor(() => {
      expect(screen.getByText("User Profile")).toBeInTheDocument();
    });

    const profilePanel = screen.getByText("User Profile").closest("section");

    expect(profilePanel).not.toBeNull();
    if (!(profilePanel instanceof HTMLElement)) {
      throw new Error("Expected profile panel");
    }

    const personalTodoTile = within(profilePanel)
      .getByText("Personal ToDo")
      .closest(".settings-item");

    expect(personalTodoTile).not.toBeNull();
    fireEvent.click(personalTodoTile!);

    await waitFor(() => {
      expect(screen.queryByText("User Profile")).not.toBeInTheDocument();
    });

    if (expectedPanelText) {
      await waitFor(() => {
        expect(screen.getByText(expectedPanelText)).toBeInTheDocument();
      });
    }
  };

  const getVisibleProjectTitles = () =>
    Array.from(document.querySelectorAll(".project-card .project-main strong"))
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));

  const getVisiblePersonalTodoTitles = () =>
    Array.from(document.querySelectorAll(".personal-todo-title-cell strong"))
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));

  const getVisibleGroupTitles = () =>
    Array.from(document.querySelectorAll(".group-card .group-header h2"))
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));

  const mockElementHeight = (element: HTMLElement, getHeight: () => number) => {
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      get: getHeight,
    });
  };

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    Reflect.deleteProperty(window, "__TAVI_RUNTIME_CONFIG__");
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoViewDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the login screen hint when the backend says default local users still exist", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ visible: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Local dev users")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "ᴛᴀᴠi" })).toBeInTheDocument();
    expect(
      screen.getByText("- short for Track And Visualize."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We mostly just call it tavi."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View as guest" }),
    ).toBeInTheDocument();
  });

  it("hides the login screen hint when the backend says defaults were removed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ visible: false });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText("Local dev users")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("hides the guest login option when guest access is disabled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ guestEnabled: false, visible: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "View as guest" }),
    ).not.toBeInTheDocument();
  });

  it("logs in through the guest entry point and hides guest-restricted panels", async () => {
    const workspacePayload = createGuestWorkspacePayload();
    let guestAuthenticated = false;
    let guestLoginRequestCount = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return guestAuthenticated
            ? createResponse(workspacePayload)
            : createResponse({ message: "Authentication required" }, 401);
        }

        if (url.endsWith("/auth/local-login-hint")) {
          return createResponse({ guestEnabled: true, visible: false });
        }

        if (url.endsWith("/auth/login/guest")) {
          guestLoginRequestCount += 1;
          expect(init?.method).toBe("POST");
          guestAuthenticated = true;
          return createResponse({
            user: workspacePayload.currentUser,
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "View as guest" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View as guest" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign out" }),
      ).toBeInTheDocument();
    });

    expect(guestLoginRequestCount).toBe(1);
    expect(
      screen.queryByRole("button", { name: "Guest" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Personal ToDo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New Project" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Guest access is read-only for shared projects and tasks.",
      ),
    ).toBeInTheDocument();
  });

  it("shows forgot password only after a failed sign in", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ visible: false });
      }

      if (url.endsWith("/auth/login")) {
        return createResponse({ message: "Invalid credentials" }, 401);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Forgot password" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "editor@tavi.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Forgot password" }),
    ).toBeInTheDocument();
  });

  it("emails and applies a one-time password reset from the login screen", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse({ message: "Authentication required" }, 401);
        }

        if (url.endsWith("/auth/local-login-hint")) {
          return createResponse({ visible: false });
        }

        if (url.endsWith("/auth/login")) {
          return createResponse({ message: "Invalid credentials" }, 401);
        }

        if (url.endsWith("/auth/password-reset/request")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            email: "editor@tavi.local",
          });
          return createResponse({ success: true });
        }

        if (url.endsWith("/auth/password-reset/confirm")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({
            email: "editor@tavi.local",
            oneTimePassword: "ABCD-1234",
            password: "new-password-123",
          });
          return createResponse({ success: true });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "editor@tavi.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Forgot password" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Forgot password" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Email one-time password" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "If that account can receive email, a one-time password was sent. It expires in 10 minutes.",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("One-time password"), {
      target: { value: "abcd1234" },
    });
    expect(screen.getByLabelText("One-time password")).toHaveValue("ABCD-1234");

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(
        screen.getByText("Password updated. Sign in with your new password."),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Forgot password" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("One-time password"),
    ).not.toBeInTheDocument();
  });

  it("blocks pasting the one-time password into the reset field", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse({ message: "Authentication required" }, 401);
        }

        if (url.endsWith("/auth/local-login-hint")) {
          return createResponse({ visible: false });
        }

        if (url.endsWith("/auth/login")) {
          return createResponse({ message: "Invalid credentials" }, 401);
        }

        if (url.endsWith("/auth/password-reset/request")) {
          expect(init?.method).toBe("POST");
          return createResponse({ success: true });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "editor@tavi.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Forgot password" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Forgot password" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Email one-time password" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("One-time password")).toBeInTheDocument();
    });

    const otpInput = screen.getByLabelText("One-time password");
    const pasteEvent = createEvent.paste(otpInput);
    const preventDefaultSpy = vi.spyOn(pasteEvent, "preventDefault");

    fireEvent(otpInput, pasteEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(otpInput).toHaveValue("");
  });

  it("retries workspace loading with fibonacci backoff while the API is unavailable", async () => {
    vi.useFakeTimers();
    const workspacePayload = createWorkspacePayload();
    let workspaceRequests = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (!url.endsWith("/workspace")) {
          throw new Error(`Unexpected fetch: ${url}`);
        }

        workspaceRequests += 1;

        if (workspaceRequests < 4) {
          return createResponse("Bad Gateway", 502);
        }

        return createResponse(workspacePayload);
      }),
    );

    renderApp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(
      screen.getByText(
        "The Tavi API is unavailable and may be restarting. Please wait a moment and try again.",
      ),
    ).toBeInTheDocument();
    expect(workspaceRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(998);
    });
    expect(workspaceRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(workspaceRequests).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(998);
    });
    expect(workspaceRequests).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(workspaceRequests).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    expect(workspaceRequests).toBe(4);
  });

  it("shows the compact workspace header without the workspace title", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.currentUser.name = "Tavi Admin";
    workspacePayload.users[0] = {
      ...workspacePayload.users[0],
      name: "Tavi Admin",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        appHomeUrl: "https://tavi.example.com/current",
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("heading", { level: 1, name: "Workspace" }),
    ).not.toBeInTheDocument();

    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    const headerActions = signOutButton.parentElement;
    const brandLink = screen.getByRole("link", { name: "ᴛᴀᴠi" });

    expect(headerActions).toHaveClass("header-actions");
    expect(headerActions?.firstElementChild).toHaveTextContent("Tavi Admin");
    expect(headerActions?.lastElementChild).toBe(signOutButton);
    expect(brandLink).toHaveAttribute(
      "href",
      "https://tavi.example.com/current",
    );
    expect(brandLink.querySelector(".brand-logo")).not.toBeNull();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(
      Array.from(
        screen.getByLabelText("Group by").querySelectorAll("option"),
      ).map((option) => option.textContent),
    ).toEqual(expect.arrayContaining(["Projects", "Progress"]));
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Group by")).not.toBeInTheDocument();
  });

  it("uses the runtime API base URL override for workspace requests", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://api.tavi.example.com/base/workspace") {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        apiBaseUrl: "https://api.tavi.example.com/base/",
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavi.example.com/base/workspace",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("applies personal saved views and shows override context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("Derived: In Progress")).toBeInTheDocument();
    expect(screen.getByText("Awaiting dependency")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("My view"), {
      target: { value: "view-1" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("Roadmap");
      expect(screen.getByLabelText("Group by")).toHaveValue("status");
      expect(
        screen
          .getByText("Current Search")
          .closest(".saved-view-current-search"),
      ).toHaveTextContent("Roadmap");
      expect(
        screen.getByRole("button", { name: "Sort by: 1 Progress" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Status: Blocked")).toBeInTheDocument();
    });
  });

  it("includes the current workspace search when creating a saved view", async () => {
    const workspacePayload = createWorkspacePayload();
    let savedPayload: SavedViewPayload | null = null;

    workspacePayload.savedViews = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/user-config") && method === "PUT") {
          return createResponse(workspacePayload.userConfig);
        }

        if (url.endsWith("/views") && method === "POST") {
          const payload = readJsonRequestBody<SavedViewPayload>(init);

          savedPayload = payload;
          return createResponse({
            id: "view-new",
            ...payload,
            createdAt: "2026-06-12T16:00:00.000Z",
            updatedAt: "2026-06-12T16:00:00.000Z",
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Kickoff" },
    });
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByLabelText("View name")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Current Search").closest(".saved-view-current-search"),
    ).toHaveTextContent("Kickoff");

    fireEvent.change(screen.getByLabelText("View name"), {
      target: { value: "Kickoff tasks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new" }));

    await waitFor(() => {
      expect(savedPayload).toEqual(
        expect.objectContaining({
          name: "Kickoff tasks",
          search: "Kickoff",
        }),
      );
    });
  });

  it("includes the current workspace search when updating a saved view", async () => {
    const workspacePayload = createWorkspacePayload();
    let updatePayload: UpdateSavedViewPayload | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/user-config") && method === "PUT") {
          return createResponse(workspacePayload.userConfig);
        }

        if (url.endsWith("/views/view-1") && method === "PATCH") {
          const payload = readJsonRequestBody<UpdateSavedViewPayload>(init);

          updatePayload = payload;
          return createResponse({
            ...workspacePayload.savedViews[0],
            ...payload,
            updatedAt: "2026-06-12T16:00:00.000Z",
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("My view"), {
      target: { value: "view-1" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("Roadmap");
    });

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Kickoff" },
    });

    expect(
      screen.getByText("Current Search").closest(".saved-view-current-search"),
    ).toHaveTextContent("Kickoff");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(updatePayload).toEqual(
        expect.objectContaining({
          search: "Kickoff",
        }),
      );
    });
  });

  it("initializes the workspace search from the URL query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    window.history.replaceState({}, "", "/?search=Kickoff");

    renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("Kickoff");
    });
  });

  it("opens, highlights, and scrolls to a task matched by search", async () => {
    const scrollIntoViewMock = vi.fn();

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    window.history.replaceState({}, "", "/?search=Kickoff");

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
    });

    const taskMatch = screen.getByText("Kickoff");
    const taskRow = taskMatch.closest("tr");

    expect(taskMatch).toHaveClass("search-highlight");
    expect(taskRow).toHaveAttribute("data-task-row-id", "task-1");
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
      });
    });
  });

  it("keeps the workspace search query param in sync with the search box", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    window.history.replaceState({}, "", "/?foo=1");

    renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "Roadmap" },
    });

    await waitFor(() => {
      expect(window.location.search).toBe("?foo=1&search=Roadmap");
    });

    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "" },
    });

    await waitFor(() => {
      expect(window.location.search).toBe("?foo=1");
    });
  });

  it("clears the workspace search from the inline clear button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    window.history.replaceState({}, "", "/?foo=1&search=Roadmap");

    renderApp();

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("Roadmap");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("");
      expect(window.location.search).toBe("?foo=1");
    });

    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("copies a project search link with encoded special characters", async () => {
    const workspacePayload = createWorkspacePayload();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      manualStatus: null,
      title: 'Roadmap & QA / "Beta"?',
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        appHomeUrl: "https://tavi",
      },
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText('Roadmap & QA / "Beta"?')).toBeInTheDocument();
    });

    const projectCard = screen
      .getByText('Roadmap & QA / "Beta"?')
      .closest("article");

    expect(projectCard).not.toBeNull();

    const actionLabels = Array.from(
      projectCard!.querySelectorAll(".project-row-actions button"),
    ).map((element) => element.textContent?.trim());

    expect(actionLabels).toEqual(["Add Task", "History", "Link", "Edit"]);

    fireEvent.click(within(projectCard!).getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        "https://tavi?search=Roadmap+%26+QA+%2F+%22Beta%22%3F",
      );
    });

    expect(
      screen.getByText(
        'Copied project link for "Roadmap & QA / "Beta"?" to clipboard.',
      ),
    ).toBeInTheDocument();
  });

  it("warns when the browser blocks copying a project search link", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("blocked"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        appHomeUrl: "https://tavi",
      },
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Browser blocked clipboard access. Copy this project link manually: https://tavi?search=Roadmap+refresh",
        ),
      ).toBeInTheDocument();
    });
  });

  it("copies a clean project link without unrelated query params from the current URL", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    window.history.replaceState({}, "", "/?foo=1");
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(
        `${window.location.origin}?search=Roadmap+refresh`,
      );
    });
  });

  it("applies project status filters only when the green checkmark is used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));

    const statusMenu = screen.getByRole("dialog", { name: "Status" });
    fireEvent.click(
      within(statusMenu).getByRole("checkbox", { name: "Blocked" }),
    );

    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(screen.getByText("Review plan")).toBeInTheDocument();

    fireEvent.click(
      within(statusMenu).getByRole("button", { name: "Apply status" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Status: Blocked" }),
      ).toBeInTheDocument();
    });
  });

  it("shows the full project task list when filtering by assignee", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Assignee: All" }));

    const assigneeMenu = screen.getByRole("dialog", { name: "Assignee" });
    fireEvent.click(
      within(assigneeMenu).getByRole("checkbox", { name: "Tavi Viewer" }),
    );
    fireEvent.click(
      within(assigneeMenu).getByRole("button", { name: "Apply assignee" }),
    );

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
    });
  });

  it("includes projects whose owner matches the assignee filter", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      tasks: workspacePayload.projects[0].tasks.map((task) => ({
        ...task,
        assigneeUserId: "user-1",
        assigneeName: "Tavi Editor",
      })),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Assignee: All" }));

    const assigneeMenu = screen.getByRole("dialog", { name: "Assignee" });
    fireEvent.click(
      within(assigneeMenu).getByRole("checkbox", { name: "Tavi Viewer" }),
    );
    fireEvent.click(
      within(assigneeMenu).getByRole("button", { name: "Apply assignee" }),
    );

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
    });
  });

  it("normalizes multi-sort order and applies it when the menu closes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });

    expect(getVisibleProjectTitles()).toEqual([
      "Roadmap refresh",
      "Beta rollout",
      "Alpha planning",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Title not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", { name: "Title sort order 1" }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Progress not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Due Date not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", { name: "Due Date sort order 1" }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.filters") ?? "{}"),
      ).toEqual(
        expect.objectContaining({
          sortBy: ["progress", "title", "dueDate"],
        }),
      );
    });

    expect(
      screen.getByRole("button", { name: "Sort by: 3 fields" }),
    ).toBeInTheDocument();
    expect(getVisibleProjectTitles()).toEqual([
      "Alpha planning",
      "Beta rollout",
      "Roadmap refresh",
    ]);
  });

  it("orders priority groups from high to medium to low to none", async () => {
    const workspacePayload = createSortedWorkspacePayload();
    const noPriorityProject: WorkspaceProject = {
      ...workspacePayload.projects[0],
      id: "project-4",
      title: "Inbox triage",
      priority: "none" as Priority,
      tasks: [],
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
    };

    workspacePayload.projects = [
      workspacePayload.projects[2],
      noPriorityProject,
      workspacePayload.projects[0],
      workspacePayload.projects[1],
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
      expect(screen.getByText("Inbox triage")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "priority" },
    });

    await waitFor(() => {
      expect(getVisibleGroupTitles()).toEqual([
        "high",
        "medium",
        "low",
        "none",
      ]);
    });
  });

  it("sorts projects by age using project creation time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Age not included in the current sort",
      }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(getVisibleProjectTitles()).toEqual([
        "Roadmap refresh",
        "Beta rollout",
        "Alpha planning",
      ]);
    });
  });

  it("sorts projects by the latest project or task update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Last Updated not included in the current sort",
      }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(getVisibleProjectTitles()).toEqual([
        "Roadmap refresh",
        "Beta rollout",
        "Alpha planning",
      ]);
    });
  });

  it("shows completion percentages in project rows", async () => {
    const workspacePayload = createWorkspacePayload();
    const dueDate = "2026-05-01T00:00:00.000Z";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      dueDate,
      manualStatus: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.queryByText("Derived from task rollup"),
    ).not.toBeInTheDocument();

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();

    const projectMetaItems = Array.from(
      projectCard!.querySelectorAll(".project-meta > *"),
    ).map((element) => element.textContent?.trim());

    expect(projectMetaItems).toEqual([
      "Tavi Editor",
      "Medium",
      "0%",
      formatExpectedCalendarDate(dueDate),
      "tracker.example.com/projects/roa... ↗",
    ]);
  });

  it("renders due dates without local timezone drift", async () => {
    const workspacePayload = createWorkspacePayload();
    const dueDate = "2026-05-01T00:00:00.000Z";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      dueDate,
      tasks: workspacePayload.projects[0]!.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              dueDate,
            }
          : task,
      ),
    };

    const localDateSpy = vi
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockReturnValue("LOCAL-DRIFT");
    const dateTimeFormatSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(function DateTimeFormatMock(
        this: Intl.DateTimeFormat,
        _locales?: string | string[],
        options?: Intl.DateTimeFormatOptions,
      ) {
        return {
          format: () =>
            options?.timeZone === "UTC" ? "UTC-STABLE-DATE" : "NON-UTC-DATE",
        } as Intl.DateTimeFormat;
      } as unknown as typeof Intl.DateTimeFormat);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("UTC-STABLE-DATE")).toBeInTheDocument();

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getAllByText("UTC-STABLE-DATE")).toHaveLength(2);
    });

    expect(localDateSpy).not.toHaveBeenCalled();
    expect(dateTimeFormatSpy).toHaveBeenCalledWith(undefined, {
      timeZone: "UTC",
    });
  });

  it("renders project notes as markdown with CRLF line breaks and linked URLs", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      notes:
        "Blocked on **approvals**\r\nhttps://docs.example.com/spec\r\n- confirm legal",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    expect(
      within(projectCard!).getByText("approvals", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(within(projectCard!).getByText("confirm legal")).toBeInTheDocument();

    const link = within(projectCard!).getByRole("link", {
      name: "https://docs.example.com/spec",
    });

    expect(link).toHaveAttribute("href", "https://docs.example.com/spec");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders task notes as markdown with CRLF line breaks and linked URLs", async () => {
    const workspacePayload = createWorkspacePayload();
    const fileUrl =
      "https://wisetechglobal-my.sharepoint.com/:x:/r/personal/michael_kronvold_wisetechglobal_com/Documents/Documents/KPE/Very%20Long%20Maintenance%20Workbook%202026%20Final%20Review.xlsx?d=wb762eb1726a84dcaa6cab3df556a0cfb&csf=1&web=1&e=rhQ0Pg";

    workspacePayload.projects[0].tasks[0] = {
      ...workspacePayload.projects[0].tasks[0],
      notes: `Review **scope**\r\n${fileUrl}\r\n- confirm owner`,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    expect(
      within(kickoffRow!).getByText("scope", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(within(kickoffRow!).getByText("confirm owner")).toBeInTheDocument();

    const link = within(kickoffRow!).getByRole("link", {
      name: "Very Long Maintenance Workbook 2...",
    });

    expect(link).toHaveAttribute("href", fileUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders URL references as safe external links with shortened labels", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references:
        "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const references = screen.getByRole("link", {
      name: "tracker.example.com/projects/roa... ↗",
    });

    expect(references).toHaveAttribute(
      "href",
      "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones",
    );
    expect(references).toHaveAttribute("target", "_blank");
    expect(references.getAttribute("rel")).toContain("noopener");
    expect(references.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders filename references using only the decoded filename label", async () => {
    const workspacePayload = createWorkspacePayload();
    const fileUrl =
      "https://wisetechglobal-my.sharepoint.com/:x:/r/personal/michael_kronvold_wisetechglobal_com/Documents/Documents/KPE/Very%20Long%20Maintenance%20Workbook%202026%20Final%20Review.xlsx?d=wb762eb1726a84dcaa6cab3df556a0cfb&csf=1&web=1&e=rhQ0Pg";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references: fileUrl,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reference = screen.getByRole("link", {
      name: "Very Long Maintenance Workbook 2... ↗",
    });

    expect(reference).toHaveAttribute("href", fileUrl);
    expect(reference).toHaveAttribute("target", "_blank");
    expect(reference.getAttribute("rel")).toContain("noopener");
    expect(reference.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders multiple references one per line with URLs and plain text", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references:
        "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones\nLoop board - roadmap refresh",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    expect(
      within(projectCard!).getByText("Loop board - roadmap refresh"),
    ).toBeInTheDocument();
    expect(
      within(projectCard!).getByRole("link", {
        name: "tracker.example.com/projects/roa... ↗",
      }),
    ).toBeInTheDocument();
  });

  it("includes multiline references when creating projects", async () => {
    const workspacePayload = createWorkspacePayload();
    const references =
      "Loop board - launch planning\nhttps://tracker.example.com/projects/launch-planning?view=board";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects") && init?.method === "POST") {
          expect(init.body).toBe(
            JSON.stringify({
              title: "Launch planning",
              notes: "",
              references: references,
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
            }),
          );

          workspacePayload.projects.push({
            id: "project-2",
            title: "Launch planning",
            notes: null,
            references: references,
            ownerUserId: "user-1",
            ownerName: "Tavi Editor",
            dueDate: null,
            priority: "medium",
            derivedStatus: "not_started",
            displayStatus: "not_started",
            manualStatus: null,
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          });

          return createResponse({ id: "project-2" }, 201);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("References (one per line)"),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("New project title"), {
      target: { value: "Launch planning" },
    });
    fireEvent.change(screen.getByPlaceholderText("References (one per line)"), {
      target: {
        value: references,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Launch planning",
            notes: "",
            references: references,
            ownerUserId: "user-1",
            dueDate: "",
            priority: "medium",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("includes multiline references when editing projects and uses a textarea", async () => {
    const workspacePayload = createWorkspacePayload();
    const references =
      "Loop board - roadmap v2\nhttps://tracker.example.com/projects/roadmap-v2?tab=overview";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              title: "Roadmap refresh",
              notes: "Awaiting dependency",
              references: references,
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
              manualStatus: "blocked",
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            references: references,
          };

          return createResponse(workspacePayload.projects[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const referencesInput = within(projectCard!).getByDisplayValue(
      "https://tracker.example.com/projects/roadmap-refresh",
    );

    expect(referencesInput.tagName).toBe("TEXTAREA");
    expect(referencesInput).toHaveClass("resizable-notes");

    fireEvent.change(referencesInput, {
      target: { value: references },
    });
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Roadmap refresh",
            notes: "Awaiting dependency",
            references: references,
            ownerUserId: "user-1",
            dueDate: "",
            priority: "medium",
            manualStatus: "blocked",
          }),
          method: "PATCH",
        }),
      );
    });
  });

  it("keeps convert guidance off the main project edit form", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const convertButton = within(projectCard!).getByRole("button", {
      name: "Convert to Task",
    });

    expect(convertButton).toBeDisabled();
    expect(convertButton).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard!).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();
  });

  it("opens project edit mode on control-click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");
    const projectRow = projectCard?.querySelector(".project-row");

    expect(projectCard).not.toBeNull();
    expect(projectRow).not.toBeNull();
    fireEvent.click(projectRow!, { ctrlKey: true });

    await waitFor(() => {
      expect(
        within(projectCard!).getByDisplayValue("Roadmap refresh"),
      ).toBeInTheDocument();
    });
  });

  it("toggles project expansion when clicking the project row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");
    const projectRow = projectCard?.querySelector(".project-row");

    expect(projectCard).not.toBeNull();
    expect(projectRow).not.toBeNull();
    expect(within(projectCard!).queryByText("Kickoff")).not.toBeInTheDocument();

    fireEvent.click(projectRow!);

    await waitFor(() => {
      expect(within(projectCard!).getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(projectRow!);

    await waitFor(() => {
      expect(
        within(projectCard!).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });
  });

  it("toggles top-level group expansion when clicking the group header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const groupCard = screen
      .getByRole("heading", { name: "Tavi Editor" })
      .closest("section");
    const groupHeader = groupCard?.querySelector(".group-header");

    expect(groupCard).not.toBeNull();
    expect(groupHeader).not.toBeNull();

    fireEvent.click(groupHeader!);

    await waitFor(() => {
      expect(screen.queryByText("Roadmap refresh")).not.toBeInTheDocument();
    });

    fireEvent.click(groupHeader!);

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });
  });

  it("scrolls the inline project editor into view when editing starts", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard!).getByDisplayValue("Roadmap refresh"),
      ).toBeInTheDocument();
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("shows a floating to top button after scrolling and scrolls smoothly to the top", async () => {
    const scrollToMock = vi.fn();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "To top" }),
    ).not.toBeInTheDocument();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 320,
    });

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "To top" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "To top" }));

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("deletes a project from the inline project editor", async () => {
    const workspacePayload = createWorkspacePayload();
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "DELETE") {
          workspacePayload.projects = [];
          return createResponse({
            id: "project-1",
            archivedTaskCount: 2,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Delete" }),
    );

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete project "Roadmap refresh" and remove its 2 tasks from the workspace?',
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Roadmap refresh")).not.toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Deleted project "Roadmap refresh" and 2 tasks from the workspace.',
      ),
    ).toBeInTheDocument();
  });

  it("disables project conversion while a project still has active tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const convertButton = within(projectCard!).getByRole("button", {
      name: "Convert to Task",
    });

    expect(convertButton).toBeDisabled();
    expect(convertButton).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard!).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();
  });

  it("converts a taskless project into a task inside Unassigned", async () => {
    const workspacePayload = createWorkspacePayload();
    let convertBody: string | null = null;

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      tasks: [],
    };

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/convert-to-task") &&
          init?.method === "POST"
        ) {
          convertBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects = [
            {
              id: "project-unassigned",
              title: "Unassigned",
              notes: null,
              references: null,
              ownerUserId: "user-1",
              ownerName: "Tavi Editor",
              dueDate: null,
              priority: "medium",
              derivedStatus: "blocked",
              displayStatus: "blocked",
              manualStatus: null,
              taskTotalCount: 1,
              taskTodoCount: 0,
              taskInProgressCount: 0,
              taskBlockedCount: 1,
              taskDoneCount: 0,
              taskCanceledCount: 0,
              taskOverdueCount: 0,
              tasks: [
                {
                  id: "task-3",
                  projectId: "project-unassigned",
                  title: "Roadmap refresh",
                  notes: "Awaiting dependency",
                  assigneeUserId: "user-1",
                  assigneeName: "Tavi Editor",
                  dueDate: null,
                  priority: "medium",
                  status: "blocked",
                  sortOrder: 0,
                  completedAt: null,
                },
              ],
            },
          ];

          return createResponse({
            projectId: "project-unassigned",
            taskId: "task-3",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Convert to Task" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Unassigned")).toBeInTheDocument();
    });

    const unassignedProject = screen.getByText("Unassigned").closest("article");

    expect(unassignedProject).not.toBeNull();
    expect(
      within(unassignedProject!).getByText("Roadmap refresh"),
    ).toBeInTheDocument();
    expect(JSON.parse(convertBody ?? "{}")).toEqual({
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      dueDate: "",
      priority: "medium",
      manualStatus: "blocked",
    });
    expect(
      screen.getByText(
        'Converted project "Roadmap refresh" into a task in Unassigned.',
      ),
    ).toBeInTheDocument();
  });

  it("persists workspace panel toggles across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    await openPersonalTodoFromProfile();
    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    await waitFor(() => {
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
      expect(screen.getByText("Private draft")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("New project title"),
      ).toBeInTheDocument();
    });

    expect(
      JSON.parse(localStorage.getItem("tavi.workspace.panels") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        newProject: true,
        personalTodo: true,
        view: true,
      }),
    );

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
      expect(screen.getByText("Private draft")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("New project title"),
      ).toBeInTheDocument();
    });
  });

  it("opens Personal ToDo when older workspace payloads omit personal todos", async () => {
    const workspacePayload = createWorkspacePayload() as WorkspaceResponse & {
      personalTodos?: WorkspaceResponse["personalTodos"];
    };
    const legacyWorkspacePayload = (({
      personalTodos,
      ...legacyPayload
    }: WorkspaceResponse & {
      personalTodos?: WorkspaceResponse["personalTodos"];
    }) => {
      void personalTodos;
      return legacyPayload;
    })(workspacePayload);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(legacyWorkspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile(null);

    await waitFor(() => {
      expect(
        screen.getByText("No personal ToDo items yet."),
      ).toBeInTheDocument();
    });
  });

  it("renders Personal ToDo notes as markdown", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.personalTodos[0] = {
      ...workspacePayload.personalTodos[0],
      notes:
        "Review the [runbook](https://example.com/runbook.md)\n\n- confirm checklist",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "runbook" })).toHaveAttribute(
        "href",
        "https://example.com/runbook.md",
      );
      expect(screen.getByText("confirm checklist")).toBeInTheDocument();
    });
  });

  it("sorts Personal ToDo items from column headers and hides drag handles while sorted", async () => {
    const workspacePayload = createWorkspacePayload();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    expect(getVisiblePersonalTodoTitles()).toEqual([
      "Private draft",
      "Closed loop",
    ]);
    expect(
      screen.getByRole("button", { name: "Drag to reorder Private draft" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Task: no sort" }));

    expect(getVisiblePersonalTodoTitles()).toEqual([
      "Closed loop",
      "Private draft",
    ]);
    expect(
      screen.queryByRole("button", { name: "Drag to reorder Closed loop" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Task: forward sort" }));

    expect(getVisiblePersonalTodoTitles()).toEqual([
      "Private draft",
      "Closed loop",
    ]);
    expect(
      screen.queryByRole("button", { name: "Drag to reorder Private draft" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Task: reverse sort" }));

    expect(getVisiblePersonalTodoTitles()).toEqual([
      "Private draft",
      "Closed loop",
    ]);
    expect(
      screen.getByRole("button", { name: "Drag to reorder Private draft" }),
    ).toBeInTheDocument();
  });

  it("defaults new Personal ToDo due dates to tomorrow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    const dueDateField = await screen.findByDisplayValue(
      formatDateInputValue(getTomorrowLocalDate()),
    );

    expect(dueDateField).toHaveAttribute("type", "date");
  });

  it("updates Personal ToDo reminder preferences from the panel", async () => {
    const workspacePayload = createWorkspacePayload();
    let notificationPreferencesRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/auth/notification/preferences") &&
          init?.method === "PUT"
        ) {
          notificationPreferencesRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createNotificationPreferencesPayload({
              personalTodoRemindersEnabled: false,
            }),
          );
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(createNotificationPreferencesPayload());
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    const reminderSwitch = await screen.findByRole("switch", {
      name: "Enable reminders",
    });

    expect(reminderSwitch).toBeChecked();
    fireEvent.click(reminderSwitch);

    await waitFor(() => {
      expect(notificationPreferencesRequestBody).toBe(
        JSON.stringify({ personalTodoRemindersEnabled: false }),
      );
      expect(reminderSwitch).not.toBeChecked();
    });
  });

  it("reorders Personal ToDo items even if the browser clears local drag state before drop", async () => {
    const workspacePayload = createWorkspacePayload();
    let reorderBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(createNotificationPreferencesPayload());
        }

        if (url.endsWith("/personal-todos/reorder")) {
          reorderBody = typeof init?.body === "string" ? init.body : null;
          workspacePayload.personalTodos = [
            {
              ...workspacePayload.personalTodos[1]!,
              sortOrder: 0,
            },
            {
              ...workspacePayload.personalTodos[0]!,
              sortOrder: 1,
            },
          ];
          return createResponse({ success: true });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    const draftHandle = await screen.findByRole("button", {
      name: "Drag to reorder Private draft",
    });
    const closedLoopRow = screen.getByText("Closed loop").closest("tr");

    expect(closedLoopRow).not.toBeNull();
    if (!(closedLoopRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected target personal todo row");
    }

    closedLoopRow.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 40,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const dragData = new Map<string, string>();
    const dataTransfer = {
      dropEffect: "move",
      effectAllowed: "move",
      getData: vi.fn((type: string) => dragData.get(type) ?? ""),
      setData: vi.fn((type: string, value: string) => {
        dragData.set(type, value);
      }),
    } as unknown as DataTransfer;

    fireEvent.dragStart(draftHandle, { dataTransfer });
    fireEvent.dragOver(closedLoopRow, { clientY: 30, dataTransfer });
    fireEvent.dragEnd(draftHandle, { dataTransfer });
    fireEvent.drop(closedLoopRow, { clientY: 30, dataTransfer });

    await waitFor(() => {
      expect(reorderBody).toBe('{"todoIds":["todo-2","todo-1"]}');
    });

    await waitFor(() => {
      const reorderedTodoTitles = Array.from(
        document.querySelectorAll(".personal-todo-table tbody tr strong"),
      ).map((element) => element.textContent?.trim());

      expect(reorderedTodoTitles).toEqual(["Closed loop", "Private draft"]);
    });
  });

  it("prevents native browser drop handling during a Personal ToDo drag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(createWorkspacePayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(createNotificationPreferencesPayload());
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await openPersonalTodoFromProfile();

    const draftHandle = await screen.findByRole("button", {
      name: "Drag to reorder Private draft",
    });
    const dataTransfer = {
      effectAllowed: "move",
      getData: vi.fn(() => "todo-1"),
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(draftHandle, { dataTransfer });

    await waitFor(() => {
      const dropEvent = new Event("drop", { cancelable: true });

      window.dispatchEvent(dropEvent);
      expect(dropEvent.defaultPrevented).toBe(true);
    });
  });

  it("lets viewers use Personal ToDo and persists its done toggle across reloads", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.currentUser = {
      ...workspacePayload.currentUser,
      role: "viewer",
    };
    workspacePayload.users[0] = {
      ...workspacePayload.users[0]!,
      role: "viewer",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );
    localStorage.setItem(
      "tavi.workspace.panels",
      JSON.stringify({ personalTodo: true }),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Personal ToDo" }),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task name")).toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: "Complete Closed loop" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Hide done personal to dos",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Closed loop")).not.toBeInTheDocument();
    });

    expect(localStorage.getItem("tavi.workspace.personalTodos.hideDone")).toBe(
      "true",
    );

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task name")).toBeInTheDocument();
      expect(
        screen.queryByRole("checkbox", { name: "Complete Closed loop" }),
      ).not.toBeInTheDocument();
    });
  });

  it("persists grouped collapse state for each group-by mode across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    toggleGroupByTitle("Tavi Viewer");

    await waitFor(() => {
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "status" },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    toggleGroupByTitle("Done");

    await waitFor(() => {
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    expect(
      JSON.parse(
        localStorage.getItem("tavi.workspace.collapsedGroups") ?? "{}",
      ),
    ).toEqual(
      expect.objectContaining({
        owner: {
          "Tavi Viewer": true,
        },
        status: {
          Done: true,
        },
      }),
    );

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "owner" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Tavi Viewer" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "status" },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "owner" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Tavi Viewer" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });
  });

  it("persists workspace preference toggles across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const themeCard = screen
      .getByText("Theme")
      .closest(".settings-item") as HTMLElement | null;
    const autoCollapseSwitch = screen.getByRole("switch", {
      name: "Auto Collapse",
    });
    const bulkActionsSwitch = screen.getByRole("switch", {
      name: "Bulk Actions",
    });
    const fullWidthSwitch = screen.getByRole("switch", {
      name: "Full Width",
    });
    const workspaceShell = screen.getByRole("main");

    expect(themeCard).not.toBeNull();
    expect(
      within(themeCard!).getByRole("button", { name: "Light" }),
    ).toBeInTheDocument();
    expect(autoCollapseSwitch).toBeChecked();
    expect(bulkActionsSwitch).toBeChecked();
    expect(fullWidthSwitch).not.toBeChecked();
    expect(workspaceShell).not.toHaveClass("workspace-shell--full-width");

    fireEvent.click(within(themeCard!).getByRole("button", { name: "Light" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "sepia");
      expect(
        within(themeCard!).getByRole("button", { name: "Sepia" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(themeCard!).getByRole("button", { name: "Sepia" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "spring");
      expect(
        within(themeCard!).getByRole("button", { name: "Spring" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(themeCard!).getByRole("button", { name: "Spring" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "summer");
      expect(
        within(themeCard!).getByRole("button", { name: "Summer" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(themeCard!).getByRole("button", { name: "Summer" }));
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute(
        "data-theme",
        "sunshower",
      );
      expect(
        within(themeCard!).getByRole("button", { name: "Sunshower" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(themeCard!).getByRole("button", { name: "Sunshower" }),
    );
    fireEvent.click(autoCollapseSwitch);
    fireEvent.click(bulkActionsSwitch);
    fireEvent.click(fullWidthSwitch);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "ocean");
      expect(workspaceShell).toHaveClass("workspace-shell--full-width");
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.preferences") ?? "{}"),
      ).toEqual({
        autoCollapse: false,
        bulkActions: false,
        fullWidth: true,
        theme: "ocean",
      });
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const profileButton = screen.getByRole("button", { name: "Tavi Editor" });

    if (profileButton.getAttribute("aria-pressed") !== "true") {
      fireEvent.click(profileButton);
    }

    const reloadedThemeCard = screen
      .getByText("Theme")
      .closest(".settings-item") as HTMLElement | null;

    expect(reloadedThemeCard).not.toBeNull();
    expect(document.documentElement).toHaveAttribute("data-theme", "ocean");
    expect(
      within(reloadedThemeCard!).getByRole("button", { name: "Ocean" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Auto Collapse" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Bulk Actions" }),
    ).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Full Width" })).toBeChecked();
    expect(screen.getByRole("main")).toHaveClass("workspace-shell--full-width");

    const reloadedThemeCycle = [
      {
        buttonLabel: "Ocean",
        expectedLabel: "Forest",
        expectedTheme: "forest",
      },
      {
        buttonLabel: "Forest",
        expectedLabel: "Autumn",
        expectedTheme: "autumn",
      },
      {
        buttonLabel: "Autumn",
        expectedLabel: "Autumn Light",
        expectedTheme: "autumn-light",
      },
      {
        buttonLabel: "Autumn Light",
        expectedLabel: "Coyote",
        expectedTheme: "coyote",
      },
      {
        buttonLabel: "Coyote",
        expectedLabel: "Coyote Dark",
        expectedTheme: "coyote-dark",
      },
      {
        buttonLabel: "Coyote Dark",
        expectedLabel: "Guinness",
        expectedTheme: "guinness",
      },
      {
        buttonLabel: "Guinness",
        expectedLabel: "Night",
        expectedTheme: "night",
      },
      {
        buttonLabel: "Night",
        expectedLabel: "Midnight",
        expectedTheme: "midnight",
      },
      {
        buttonLabel: "Midnight",
        expectedLabel: "Pine",
        expectedTheme: "pine",
      },
      {
        buttonLabel: "Pine",
        expectedLabel: "Obsidian",
        expectedTheme: "obsidian",
      },
      {
        buttonLabel: "Obsidian",
        expectedLabel: "Light",
        expectedTheme: "light",
      },
    ] as const;

    for (const {
      buttonLabel,
      expectedLabel,
      expectedTheme,
    } of reloadedThemeCycle) {
      fireEvent.click(
        within(reloadedThemeCard!).getByRole("button", { name: buttonLabel }),
      );
      await waitFor(() => {
        expect(document.documentElement).toHaveAttribute(
          "data-theme",
          expectedTheme,
        );
        expect(
          within(reloadedThemeCard!).getByRole("button", {
            name: expectedLabel,
          }),
        ).toBeInTheDocument();
      });
    }
  });

  it("keeps the global email notifications toggle in sync after saving", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    let emailSettingsRequestBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "14:00",
          });
        }

        if (url.endsWith("/auth/email/settings") && init?.method === "PUT") {
          emailSettingsRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createSmtpStatusPayload({
              enabled: false,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByText("smtp://10.120.64.99:25")).toBeInTheDocument();
    });

    const emailNotificationsSwitch = screen.getByRole("switch", {
      name: "Email Notifications",
    });

    expect(emailNotificationsSwitch).toBeChecked();

    fireEvent.click(emailNotificationsSwitch);

    await waitFor(() => {
      expect(emailSettingsRequestBody).toBe(
        JSON.stringify({
          dragHandlesEnabled: true,
          enabled: false,
          guestAccessEnabled: true,
        }),
      );
      expect(emailNotificationsSwitch).not.toBeChecked();
    });
  });

  it("toggles task drag handles for the whole workspace from admin settings", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    let emailSettingsRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        if (url.endsWith("/auth/email/settings") && init?.method === "PUT") {
          emailSettingsRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createSmtpStatusPayload({
              dragHandlesEnabled: false,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Drag to reorder Kickoff" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const dragHandlesSwitch = screen.getByRole("switch", {
      name: "Task Drag Handles",
    });

    await waitFor(() => {
      expect(dragHandlesSwitch).not.toBeDisabled();
    });
    expect(dragHandlesSwitch).toBeChecked();

    fireEvent.click(dragHandlesSwitch);

    await waitFor(() => {
      expect(emailSettingsRequestBody).toBe(
        JSON.stringify({
          dragHandlesEnabled: false,
          enabled: true,
          guestAccessEnabled: true,
        }),
      );
      expect(dragHandlesSwitch).not.toBeChecked();
      expect(
        screen.queryByRole("button", { name: "Drag to reorder Kickoff" }),
      ).not.toBeInTheDocument();
    });
  });

  it("toggles guest access from admin settings", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    let emailSettingsRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        if (url.endsWith("/auth/email/settings") && init?.method === "PUT") {
          emailSettingsRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createSmtpStatusPayload({
              guestAccessEnabled: false,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const guestAccessSwitch = screen.getByRole("switch", {
      name: "Guest Access",
    });

    await waitFor(() => {
      expect(guestAccessSwitch).not.toBeDisabled();
    });
    expect(guestAccessSwitch).toBeChecked();

    fireEvent.click(guestAccessSwitch);

    await waitFor(() => {
      expect(emailSettingsRequestBody).toBe(
        JSON.stringify({
          dragHandlesEnabled: true,
          enabled: true,
          guestAccessEnabled: false,
        }),
      );
      expect(guestAccessSwitch).not.toBeChecked();
    });
  });

  it("updates the notification rate between hourly and daily", async () => {
    const workspacePayload = createWorkspacePayload();
    let notificationPreferencesRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/auth/notification/preferences") &&
          init?.method === "PUT"
        ) {
          notificationPreferencesRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createNotificationPreferencesPayload({
              dailyDigestEnabled: true,
              dailyDigestTime: "14:00",
            }),
          );
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(
            createNotificationPreferencesPayload({
              dailyDigestEnabled: false,
              dailyDigestTime: "14:00",
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const notificationRateSelect = screen.getByLabelText("Notification rate");

    await waitFor(() => {
      expect(notificationRateSelect).not.toBeDisabled();
    });

    expect(notificationRateSelect).toHaveValue("hourly");
    expect(
      screen.queryByLabelText("Daily notification time"),
    ).not.toBeInTheDocument();

    fireEvent.change(notificationRateSelect, {
      target: { value: "daily" },
    });

    await waitFor(() => {
      expect(notificationPreferencesRequestBody).toBe(
        JSON.stringify({ dailyDigestEnabled: true }),
      );
      expect(notificationRateSelect).toHaveValue("daily");
      expect(
        screen.getByLabelText("Daily notification time"),
      ).toBeInTheDocument();
    });
  });

  it("saves the daily notification time in UTC while showing browser-local time", async () => {
    const workspacePayload = createWorkspacePayload();
    const initialUtcDigestTime = "11:00";
    const savedUtcDigestTime = "14:00";
    const localDigestTime = toLocalTimeInputFromUtc(savedUtcDigestTime);
    let notificationPreferencesRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/auth/notification/preferences") &&
          init?.method === "PUT"
        ) {
          notificationPreferencesRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createNotificationPreferencesPayload({
              dailyDigestEnabled: true,
              dailyDigestTime: savedUtcDigestTime,
            }),
          );
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(
            createNotificationPreferencesPayload({
              dailyDigestEnabled: true,
              dailyDigestTime: initialUtcDigestTime,
            }),
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const digestTimeInput = await waitFor(() =>
      screen.getByLabelText("Daily notification time"),
    );

    expect(digestTimeInput).toHaveValue(
      toLocalTimeInputFromUtc(initialUtcDigestTime),
    );
    expect(within(digestTimeInput).getAllByRole("option")).toHaveLength(24);

    fireEvent.change(digestTimeInput, {
      target: { value: localDigestTime },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(notificationPreferencesRequestBody).toBe(
        JSON.stringify({
          dailyDigestTime: toUtcTimeInputFromLocal(localDigestTime),
        }),
      );
    });
    expect(digestTimeInput).toHaveValue(localDigestTime);
  });

  it("updates personal todo retention from the user profile", async () => {
    const workspacePayload = createWorkspacePayload();
    let notificationPreferencesRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/auth/notification/preferences") &&
          init?.method === "PUT"
        ) {
          notificationPreferencesRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse(
            createNotificationPreferencesPayload({
              personalTodoRetention: "delete_when_done",
            }),
          );
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(createNotificationPreferencesPayload());
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const retentionSelect = await waitFor(() =>
      screen.getByLabelText("Personal todo retention"),
    );

    expect(retentionSelect).toHaveValue("never");

    fireEvent.change(retentionSelect, {
      target: { value: "delete_when_done" },
    });

    await waitFor(() => {
      expect(notificationPreferencesRequestBody).toBe(
        JSON.stringify({ personalTodoRetention: "delete_when_done" }),
      );
      expect(retentionSelect).toHaveValue("delete_when_done");
      expect(
        screen.getByText(
          "Completed items are removed as soon as you mark them done.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("hides admin settings from non-admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Settings" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    expect(
      screen.queryByRole("switch", { name: "Email Notifications" }),
    ).not.toBeInTheDocument();
  });

  it("shows settings cards in the requested order and links build metadata to the changelog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        return createResponse(createAdminWorkspacePayload());
      }),
    );

    const { container } = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const settingsItems = Array.from(
      container.querySelectorAll(".settings-grid > .settings-item"),
    );

    expect(settingsItems).not.toHaveLength(0);
    expect(settingsItems).toHaveLength(10);
    expect(settingsItems[0]?.textContent).toContain("Email Notifications");
    expect(settingsItems[1]?.textContent).toContain("Task Drag Handles");
    expect(settingsItems[2]?.textContent).toContain("Guest Access");
    expect(settingsItems[3]?.textContent).toContain("Backups");
    expect(settingsItems[4]?.textContent).toContain("Retention");
    expect(settingsItems[5]?.textContent).toContain("Import/Export");
    expect(settingsItems[6]?.textContent).toContain("Local Accounts");
    expect(settingsItems[7]?.textContent).toContain("Audit logins");
    expect(settingsItems[8]?.textContent).toContain("Audit notifications");
    expect(settingsItems[9]?.textContent).toContain("Audit changes");
    expect(
      screen.getByRole("link", { name: "tavi local build" }),
    ).toHaveAttribute("href", `${appRepositoryUrl}/blob/main/CHANGELOG.md`);
    expect(screen.getByText("built local build")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("smtp://10.120.64.99:25")).toBeInTheDocument();
      expect(screen.getByText("noreply@tavi.local")).toBeInTheDocument();
    });
  });

  it("closes settings when opening local accounts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/accounts")) {
          return createResponse({
            accounts: [
              {
                id: "user-1",
                email: "editor@tavi.local",
                name: "Tavi Editor",
                role: "admin",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          });
        }

        return createResponse(createAdminWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(
      screen.getByText("Local Accounts").closest(".settings-item")!,
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
    });
  });

  it("opens the retention panel, saves retention changes, and prunes the selected target", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const updateRequests: UpdateRetentionSettingsPayload[] = [];
    const pruneRequests: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method =
          init?.method ??
          (input instanceof Request ? input.method : undefined) ??
          "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        if (url.endsWith("/retention") && method === "GET") {
          return createResponse(createRetentionStatusPayload());
        }

        if (url.endsWith("/retention") && method === "PUT") {
          const payload = JSON.parse(
            String(init?.body ?? "{}"),
          ) as UpdateRetentionSettingsPayload;
          updateRequests.push(payload);
          return createResponse(
            createRetentionStatusPayload({
              changes: {
                estimatedSizeBytes: 131_072,
                policy: payload.changes,
                retainedItemCount: 64,
              },
              logins: {
                estimatedSizeBytes: 65_536,
                policy: payload.logins,
                retainedItemCount: 31,
              },
              notifications: {
                estimatedSizeBytes: 16_384,
                policy: payload.notifications,
                retainedItemCount: 12,
              },
            }),
          );
        }

        if (url.endsWith("/retention/prune") && method === "POST") {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            target: string;
          };
          pruneRequests.push(payload.target);
          return createResponse({
            deletedCount: 4,
            deletedSizeBytes: 2048,
            settings: createRetentionStatusPayload({
              notifications: {
                estimatedSizeBytes: 8192,
                policy: "two_weeks",
                retainedItemCount: 6,
              },
            }),
            target: payload.target,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByText("Retention").closest(".settings-item")!);

    const panel = await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      const element = screen
        .getByText(
          "Control how long admin-visible logs stay in storage. Backup retention is configured from Settings → Backups.",
        )
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    expect(
      within(panel).getByText(
        "Sizes reflect what would remain if each retention rule were applied now.",
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByLabelText("Backups retention"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(panel).getByLabelText("Notifications retention"),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(panel).getByLabelText("Notifications retention"), {
      target: { value: "two_weeks" },
    });

    await waitFor(() => {
      expect(updateRequests).toEqual([
        {
          changes: "twelve_months",
          logins: "twelve_months",
          notifications: "two_weeks",
        },
      ]);
      expect(
        within(panel).getByText("Retention settings saved."),
      ).toBeInTheDocument();
    });

    const notificationsRow = within(panel)
      .getByLabelText("Notifications retention")
      .closest(".retention-row") as HTMLElement | null;

    expect(notificationsRow).not.toBeNull();
    fireEvent.click(
      within(notificationsRow!).getByRole("button", { name: "Prune now" }),
    );

    const pruneDialog = await screen.findByRole("dialog", {
      name: "Prune notifications",
    });
    fireEvent.click(
      within(pruneDialog).getByRole("button", { name: "Prune now" }),
    );

    await waitFor(() => {
      expect(pruneRequests).toEqual(["notifications"]);
      expect(
        within(panel).getByText(
          "Pruned notifications: removed 2.0 KB across 4 items.",
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText("8.0 KB across 6 records."),
      ).toBeInTheDocument();
    });
  });

  it("opens import/export and backups panels from settings cards and closes them from panel headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(createAdminWorkspacePayload());
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse(createSmtpStatusPayload());
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        if (url.endsWith("/backups")) {
          return createResponse({
            backupDirectory: "/var/tavi/backups",
            backupDirectoryAccessible: true,
            backups: [],
            enabled: true,
            lastError: null,
            lastFailureAt: null,
            lastSuccessAt: null,
            scheduleTime: "02:00",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const importExportCard = screen
      .getByText("Import/Export")
      .closest(".settings-item");

    expect(importExportCard).not.toBeNull();

    fireEvent.click(importExportCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).toBeInTheDocument();
    });

    const exportPanel = screen
      .getByText("Export")
      .closest(".workspace-panel-card");
    const importPanel = screen.getByText("CSV import").closest(".toolbar-card");

    expect(exportPanel).not.toBeNull();
    expect(importPanel).not.toBeNull();
    expect(
      within(exportPanel as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
    expect(
      within(importPanel as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const backupsCard = screen.getByText("Backups").closest(".settings-item");

    expect(backupsCard).not.toBeNull();
    fireEvent.click(backupsCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "Configure scheduled snapshots and preview restore changes.",
        ),
      ).toBeInTheDocument();
    });

    const backupsPanel = screen
      .getByText("Configure scheduled snapshots and preview restore changes.")
      .closest(".workspace-panel-card");

    expect(backupsPanel).not.toBeNull();

    fireEvent.click(
      within(backupsPanel as HTMLElement).getByRole("button", {
        name: "Close",
      }),
    );
    fireEvent.click(
      within(exportPanel as HTMLElement).getByRole("button", { name: "Close" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Configure scheduled snapshots and preview restore changes.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("opens import/export from the user profile panel for non-admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    const importExportCard = screen
      .getByText("Import/Export")
      .closest(".settings-item");

    expect(importExportCard).not.toBeNull();
    fireEvent.click(importExportCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.click(importExportCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("toggles user history from the profile card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.includes("/audit/auth/user-1")) {
          return createResponse([]);
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    const authHistoryCard = screen
      .getByText("User History")
      .closest(".settings-item");

    expect(authHistoryCard).not.toBeNull();
    fireEvent.click(authHistoryCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "User History" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Dates and times use your local timezone \(.+\)\./),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("User Profile")).not.toBeInTheDocument();

    const userHistoryPanel = screen
      .getByRole("heading", { name: "User History" })
      .closest("section");

    expect(userHistoryPanel).not.toBeNull();
    fireEvent.click(
      within(userHistoryPanel as HTMLElement).getByRole("button", {
        name: "Close",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "User History" }),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the profile panel open when entering edit mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    const profilePanel = screen.getByText("User Profile").closest("section");

    expect(profilePanel).not.toBeNull();
    fireEvent.click(
      within(profilePanel!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(screen.getByText("User Profile")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Current password"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    });
  });

  it("saves profile edits from the user panel and closes it", async () => {
    const workspacePayload = createWorkspacePayload();
    let updateProfileRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "11:00",
          });
        }

        if (url.endsWith("/auth/me") && init?.method === "PATCH") {
          updateProfileRequestBody =
            typeof init.body === "string" ? init.body : null;
          workspacePayload.currentUser = {
            ...workspacePayload.currentUser,
            email: "renamed@tavi.local",
            name: "Renamed Editor",
          };
          workspacePayload.users[0] = {
            ...workspacePayload.users[0],
            email: "renamed@tavi.local",
            name: "Renamed Editor",
          };
          return createResponse({
            account: {
              id: "user-1",
              email: "renamed@tavi.local",
              name: "Renamed Editor",
              role: "editor",
              createdAt: "2026-02-01T10:00:00.000Z",
              updatedAt: "2026-02-02T10:00:00.000Z",
            },
            notificationEmailSent: false,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    const profilePanel = screen.getByText("User Profile").closest("section");

    expect(profilePanel).not.toBeNull();
    fireEvent.click(
      within(profilePanel!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Tavi Editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue("Tavi Editor"), {
      target: { value: "Renamed Editor" },
    });
    fireEvent.change(screen.getByDisplayValue("editor@tavi.local"), {
      target: { value: "renamed@tavi.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(JSON.parse(updateProfileRequestBody ?? "{}")).toEqual({
        email: "renamed@tavi.local",
        name: "Renamed Editor",
      });
      expect(
        screen.getByRole("button", { name: "Renamed Editor" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("User Profile")).not.toBeInTheDocument();
    });
  });

  it("persists the per-project add task toggle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    const notesInput = screen.getByPlaceholderText("Task notes");

    expect(notesInput.tagName).toBe("TEXTAREA");
    expect(notesInput).toHaveClass("resizable-notes");

    expect(
      JSON.parse(localStorage.getItem("tavi.workspace.projectAddTask") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        "project-1": true,
      }),
    );

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(reloadedProjectCard).not.toBeNull();
    expect(
      within(reloadedProjectCard!).getByRole("button", { name: "Add Task" }),
    ).toHaveAttribute("aria-pressed", "true");

    const expandButton = reloadedProjectCard?.querySelector(
      "button.group-toggle",
    );

    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });
  });

  it("closes the add task row when a project is collapsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("New task title"),
      ).not.toBeInTheDocument();
      expect(
        within(projectCard!).getByRole("button", { name: "Add Task" }),
      ).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("keeps the last assignee and priority when adding tasks consecutively", async () => {
    const workspacePayload = createWorkspacePayload();
    let createBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/tasks") &&
          init?.method === "POST"
        ) {
          createBody = typeof init.body === "string" ? init.body : null;

          const payload = JSON.parse(createBody ?? "{}") as {
            assigneeUserId?: string;
            notes?: string;
            priority?: "low" | "medium" | "high";
            status?: string;
            title?: string;
          };

          workspacePayload.projects[0]!.tasks.push({
            id: "task-3",
            projectId: "project-1",
            title: payload.title ?? "",
            notes: payload.notes ?? null,
            assigneeUserId: payload.assigneeUserId ?? "user-1",
            assigneeName:
              payload.assigneeUserId === "user-2"
                ? "Tavi Viewer"
                : "Tavi Editor",
            dueDate: null,
            priority: payload.priority ?? "medium",
            status: payload.status === "done" ? "done" : "not_started",
            sortOrder: 2,
            completedAt: null,
            createdAt: "2026-04-03T09:00:00.000Z",
            updatedAt: "2026-04-03T09:00:00.000Z",
          });
          workspacePayload.projects[0]!.taskTotalCount += 1;
          workspacePayload.projects[0]!.taskTodoCount += 1;

          return createResponse(workspacePayload.projects[0]!.tasks[2]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const taskCreateRow = titleInput.closest("tr");

    expect(taskCreateRow).not.toBeNull();
    if (!(taskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected add-task row");
    }

    fireEvent.change(titleInput, {
      target: { value: "Prepare handoff" },
    });
    fireEvent.change(within(taskCreateRow).getByDisplayValue("Tavi Editor"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(taskCreateRow).getByDisplayValue("Medium"), {
      target: { value: "high" },
    });
    fireEvent.click(within(taskCreateRow).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Prepare handoff")).toBeInTheDocument();
    });

    const refreshedTitleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const refreshedTaskCreateRow = refreshedTitleInput.closest("tr");

    expect(refreshedTaskCreateRow).not.toBeNull();
    if (!(refreshedTaskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected refreshed add-task row");
    }

    expect(createBody).toContain('"assigneeUserId":"user-2"');
    expect(createBody).toContain('"priority":"high"');
    expect(refreshedTitleInput).toHaveValue("");
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("Tavi Viewer"),
    ).toHaveValue("user-2");
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("High"),
    ).toHaveValue("high");
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("Not Started"),
    ).toHaveValue("not_started");
  });

  it("allows creating tasks with no assignee and keeps None as the next default", async () => {
    const workspacePayload = createWorkspacePayload();
    let createBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/tasks") &&
          init?.method === "POST"
        ) {
          createBody = typeof init.body === "string" ? init.body : null;

          const payload = JSON.parse(createBody ?? "{}") as {
            assigneeUserId?: string | null;
            notes?: string;
            priority?: "low" | "medium" | "high";
            status?: string;
            title?: string;
          };

          workspacePayload.projects[0]!.tasks.push({
            id: "task-3",
            projectId: "project-1",
            title: payload.title ?? "",
            notes: payload.notes ?? null,
            assigneeUserId: payload.assigneeUserId ?? null,
            assigneeName:
              payload.assigneeUserId === "user-2"
                ? "Tavi Viewer"
                : payload.assigneeUserId === "user-1"
                  ? "Tavi Editor"
                  : null,
            dueDate: null,
            priority: payload.priority ?? "medium",
            status: payload.status === "done" ? "done" : "not_started",
            sortOrder: 2,
            completedAt: null,
            createdAt: "2026-04-03T09:00:00.000Z",
            updatedAt: "2026-04-03T09:00:00.000Z",
          });
          workspacePayload.projects[0]!.taskTotalCount += 1;
          workspacePayload.projects[0]!.taskTodoCount += 1;

          return createResponse(workspacePayload.projects[0]!.tasks[2]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const taskCreateRow = titleInput.closest("tr");

    expect(taskCreateRow).not.toBeNull();
    if (!(taskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected add-task row");
    }

    fireEvent.change(titleInput, {
      target: { value: "Unassigned task" },
    });
    fireEvent.change(within(taskCreateRow).getByDisplayValue("Tavi Editor"), {
      target: { value: "" },
    });
    fireEvent.click(within(taskCreateRow).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Unassigned task")).toBeInTheDocument();
    });

    const refreshedTitleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const refreshedTaskCreateRow = refreshedTitleInput.closest("tr");

    expect(refreshedTaskCreateRow).not.toBeNull();
    if (!(refreshedTaskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected refreshed add-task row");
    }

    expect(createBody).toContain('"assigneeUserId":null');
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("None"),
    ).toHaveValue("");
  });

  it("reorders tasks with the drag handle and saves the new order", async () => {
    const workspacePayload = createWorkspacePayload();
    let reorderBody: string | null = null;

    workspacePayload.projects[0]!.tasks.push({
      id: "task-3",
      projectId: "project-1",
      title: "Share update",
      notes: "Notify stakeholders",
      assigneeUserId: "user-1",
      assigneeName: "Tavi Editor",
      dueDate: null,
      priority: "low",
      status: "not_started",
      sortOrder: 2,
      completedAt: null,
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T09:00:00.000Z",
    });
    workspacePayload.projects[0]!.taskTotalCount = 3;
    workspacePayload.projects[0]!.taskTodoCount = 2;
    workspacePayload.projects[0]!.taskInProgressCount = 1;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/tasks/reorder") &&
          init?.method === "PATCH"
        ) {
          reorderBody = typeof init.body === "string" ? init.body : null;
          const payload = JSON.parse(reorderBody ?? "{}") as {
            taskIds?: string[];
          };
          const taskById = new Map(
            workspacePayload.projects[0]!.tasks.map(
              (task) => [task.id, task] as const,
            ),
          );

          workspacePayload.projects[0]!.tasks =
            payload.taskIds?.map((taskId, index) => ({
              ...taskById.get(taskId)!,
              sortOrder: index,
            })) ?? workspacePayload.projects[0]!.tasks;

          return createResponse({ success: true });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(screen.getByText("Share update")).toBeInTheDocument();
    });

    const kickoffHandle = screen.getByRole("button", {
      name: "Drag to reorder Kickoff",
    });
    const reviewPlanRow = screen.getByText("Review plan").closest("tr");

    expect(reviewPlanRow).not.toBeNull();
    if (!(reviewPlanRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected target task row");
    }

    reviewPlanRow.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 40,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const dataTransfer = {
      dropEffect: "move",
      effectAllowed: "move",
      getData: vi.fn(() => "task-1"),
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(kickoffHandle, { dataTransfer });
    fireEvent.dragOver(reviewPlanRow, { clientY: 30, dataTransfer });
    fireEvent.drop(reviewPlanRow, { clientY: 30, dataTransfer });
    fireEvent.dragEnd(kickoffHandle, { dataTransfer });

    await waitFor(() => {
      expect(reorderBody).toContain('"taskIds":["task-2","task-1","task-3"]');
    });

    const reorderedTaskTitles = Array.from(
      projectCard.querySelectorAll(".task-table tbody tr strong"),
    ).map((element) => element.textContent?.trim());

    expect(reorderedTaskTitles).toEqual([
      "Review plan",
      "Kickoff",
      "Share update",
    ]);
  });

  it("keeps the project open while editing tasks in a modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
      expect(within(projectCard).getByText("Review plan")).toBeInTheDocument();
    });

    const projectToggle = projectCard.querySelector("button.group-toggle");
    const editDialog = within(projectCard).getByRole("dialog", {
      name: "Edit task · Kickoff",
    });

    expect(projectToggle).toHaveTextContent("-");
    expect(
      within(editDialog).getByRole("button", { name: "Save" }),
    ).toBeInTheDocument();
    expect(
      within(editDialog).getByRole("button", { name: "Cancel" }),
    ).toBeInTheDocument();
  });

  it("opens a prefilled follow-up draft when a task moves into review", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;

    workspacePayload.projects[0]!.tasks[0] = {
      ...workspacePayload.projects[0]!.tasks[0]!,
      dueDate: "2026-04-20T00:00:00.000Z",
      priority: "high",
    };

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0]!.tasks[0] = {
            ...workspacePayload.projects[0]!.tasks[0]!,
            status: "review",
          };

          return createResponse(workspacePayload.projects[0]!.tasks[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(projectCard).getByDisplayValue("Not Started"), {
      target: { value: "review" },
    });
    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchBody).toContain('"status":"review"');
      expect(
        within(projectCard).getByDisplayValue("review Kickoff"),
      ).toBeInTheDocument();
    });

    const reviewDraftRow = within(projectCard)
      .getByDisplayValue("review Kickoff")
      .closest("tr");

    expect(reviewDraftRow).not.toBeNull();
    expect(
      within(reviewDraftRow!).getByDisplayValue("High"),
    ).toBeInTheDocument();
    expect(
      within(reviewDraftRow!).getByDisplayValue("2026-04-20"),
    ).toBeInTheDocument();
    expect(
      within(reviewDraftRow!).getByRole("button", { name: "Add" }),
    ).toBeEnabled();

    fireEvent.click(
      within(reviewDraftRow!).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => {
      expect(
        within(projectCard).queryByDisplayValue("review Kickoff"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not open a duplicate review draft when a review task is saved", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchCount = 0;

    workspacePayload.projects[0]!.tasks[0] = {
      ...workspacePayload.projects[0]!.tasks[0]!,
      status: "review",
    };

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchCount += 1;
          return createResponse(workspacePayload.projects[0]!.tasks[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchCount).toBe(1);
      expect(
        within(projectCard).queryByDisplayValue("review Kickoff"),
      ).not.toBeInTheDocument();
    });
  });

  it("persists the project note editor height in local storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard!).getByPlaceholderText("Project notes"),
      ).toBeInTheDocument();
    });

    const projectNotes = within(projectCard!).getByPlaceholderText(
      "Project notes",
    ) as HTMLTextAreaElement;
    let projectNotesHeight = 72;

    mockElementHeight(projectNotes, () => projectNotesHeight);
    fireEvent.pointerDown(projectNotes);
    projectNotesHeight = 180;
    fireEvent.pointerUp(projectNotes);

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem("tavi.workspace.noteEditorHeights") ?? "{}",
        ),
      ).toEqual(
        expect.objectContaining({
          project: 180,
        }),
      );
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(reloadedProjectCard).not.toBeNull();
    fireEvent.click(
      within(reloadedProjectCard!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(
        within(reloadedProjectCard!).getByPlaceholderText("Project notes"),
      ).toHaveStyle({ height: "180px" });
    });
  });

  it("persists the task note editor height in local storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByPlaceholderText("Task notes"),
      ).toBeInTheDocument();
    });

    const taskNotes = within(projectCard).getByPlaceholderText(
      "Task notes",
    ) as HTMLTextAreaElement;
    let taskNotesHeight = 72;

    mockElementHeight(taskNotes, () => taskNotesHeight);
    fireEvent.pointerDown(taskNotes);
    taskNotesHeight = 156;
    fireEvent.pointerUp(taskNotes);

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem("tavi.workspace.noteEditorHeights") ?? "{}",
        ),
      ).toEqual(
        expect.objectContaining({
          task: 156,
        }),
      );
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const reloadedKickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(reloadedKickoffRow).not.toBeNull();
    fireEvent.click(
      within(reloadedKickoffRow!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(
        within(reloadedProjectCard).getByPlaceholderText("Task notes"),
      ).toHaveStyle({ height: "156px" });
    });
  });

  it("opens task edit in a modal without submitting from the first click", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;
    let patchCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchCount += 1;
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks[0] = {
            ...workspacePayload.projects[0].tasks[0],
            title: "Kickoff updated",
          };

          return createResponse(workspacePayload.projects[0].tasks[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    expect(patchCount).toBe(0);
    expect(
      within(projectCard).getByDisplayValue("Kickoff"),
    ).toBeInTheDocument();

    fireEvent.change(within(projectCard).getByDisplayValue("Kickoff"), {
      target: { value: "Kickoff updated" },
    });
    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchCount).toBe(1);
      expect(screen.getByText("Kickoff updated")).toBeInTheDocument();
    });

    expect(patchBody).toBe(
      JSON.stringify({
        projectId: "project-1",
        title: "Kickoff updated",
        notes: "Confirm milestone scope",
        assigneeUserId: "user-1",
        dueDate: "",
        priority: "medium",
        status: "not_started",
      }),
    );
  });

  it("opens task edit mode on control-click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(kickoffRow!, { ctrlKey: true });

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });
  });

  it("moves a task to another project from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;

          const movedTask = {
            ...workspacePayload.projects[0].tasks[0],
            projectId: "project-2",
          };

          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 1;
          workspacePayload.projects[1].tasks = [movedTask];
          workspacePayload.projects[1].taskTotalCount = 1;
          workspacePayload.projects[1].taskTodoCount = 1;

          return createResponse(movedTask);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    const sourceProject = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(sourceProject).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(sourceProject).getByRole("button", { name: /^Project:/ }),
    );
    fireEvent.click(
      within(sourceProject).getByRole("button", {
        name: "Select project Beta rollout",
      }),
    );
    fireEvent.click(
      within(sourceProject).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(
        within(sourceProject).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const destinationHeading = screen
        .getAllByText("Beta rollout")
        .find((element) => element.closest("article"));

      expect(destinationHeading).toBeDefined();

      const destinationProject = destinationHeading?.closest("article");

      expect(destinationProject).not.toBeNull();
      expect(
        within(destinationProject!).getByText("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(patchBody).toBe(
      JSON.stringify({
        projectId: "project-2",
        title: "Kickoff",
        notes: "Confirm milestone scope",
        assigneeUserId: "user-1",
        dueDate: "",
        priority: "medium",
        status: "not_started",
      }),
    );
  });

  it("clears a task assignee to None without leaving the project editor open", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;
    let convertToTaskCount = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks[0] = {
            ...workspacePayload.projects[0].tasks[0],
            assigneeUserId: null,
            assigneeName: null,
          };

          return createResponse(workspacePayload.projects[0].tasks[0]);
        }

        if (
          url.endsWith("/projects/project-1/convert-to-task") &&
          init?.method === "POST"
        ) {
          convertToTaskCount += 1;
          return createResponse(
            {
              message:
                "Move or delete this project's 2 active tasks before converting it into a task.",
            },
            400,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");
    const projectActions = projectCard.querySelector(".project-row-actions");

    expect(projectActions).toBeInstanceOf(HTMLElement);
    if (!(projectActions instanceof HTMLElement)) {
      throw new Error("Expected project actions");
    }
    fireEvent.click(
      within(projectActions).getByRole("button", { name: "Edit" }),
    );

    expect(
      within(projectCard).getByRole("button", { name: "Convert to Task" }),
    ).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(
      within(projectCard).queryByRole("button", { name: "Convert to Task" }),
    ).not.toBeInTheDocument();
    expect(
      within(projectCard).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(
      within(projectCard).getByRole("combobox", { name: "Assignee" }),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchBody).toBe(
        JSON.stringify({
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: null,
          dueDate: "",
          priority: "medium",
          status: "not_started",
        }),
      );
    });

    expect(convertToTaskCount).toBe(0);
  });

  it("scrolls the inline task editor into view when editing starts", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("converts a task into a project from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    let convertBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/tasks/task-1/convert-to-project") &&
          init?.method === "POST"
        ) {
          convertBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 0;
          workspacePayload.projects[0].taskInProgressCount = 1;
          workspacePayload.projects.push({
            id: "project-2",
            title: "Kickoff project",
            notes: "Confirm milestone scope",
            references: null,
            ownerUserId: "user-1",
            ownerName: "Tavi Editor",
            dueDate: null,
            priority: "medium",
            derivedStatus: "not_started",
            displayStatus: "not_started",
            manualStatus: null,
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          });

          return createResponse({
            projectId: "project-2",
            taskId: "task-1",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const sourceProject = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(sourceProject).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(sourceProject).getByDisplayValue("Kickoff"), {
      target: { value: "Kickoff project" },
    });

    const projectPickerButton = within(sourceProject).getByRole("button", {
      name: /^Project:/,
    });

    fireEvent.click(projectPickerButton);
    fireEvent.click(
      within(sourceProject).getByRole("button", {
        name: "Convert to Project",
      }),
    );
    fireEvent.click(
      within(sourceProject).getByRole("button", { name: "Convert" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Kickoff project")).toBeInTheDocument();
      expect(
        within(sourceProject).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    expect(JSON.parse(convertBody ?? "{}")).toEqual({
      title: "Kickoff project",
      notes: "Confirm milestone scope",
      assigneeUserId: "user-1",
      dueDate: "",
      priority: "medium",
      status: "not_started",
    });
    expect(
      screen.getByText('Converted task "Kickoff project" into a project.'),
    ).toBeInTheDocument();
  });

  it("deletes a task from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "DELETE") {
          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 0;

          return createResponse({
            id: "task-1",
            projectId: "project-1",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(projectCard).getByRole("button", { name: "Delete" }),
    );

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete task "Kickoff" from the workspace?',
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(
        within(projectCard).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('Deleted task "Kickoff" from the workspace.'),
    ).toBeInTheDocument();
  });

  it("resets server-backed user settings and clears only tavi-owned browser cache", async () => {
    const confirmMock = vi.fn(() => true);
    const resetResponse = {
      notificationPreferences: createNotificationPreferencesPayload(),
      userConfig: createWorkspacePayload().userConfig,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.endsWith("/auth/settings/reset")) {
          return createResponse(resetResponse);
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(
            createNotificationPreferencesPayload({
              dailyDigestEnabled: true,
              personalTodoRetention: "delete_when_done",
            }),
          );
        }

        return createResponse(createWorkspacePayload());
      }),
    );
    vi.stubGlobal("confirm", confirmMock);
    window.localStorage.setItem("unrelated", "keep");

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(localStorage.getItem("tavi.workspace.panels")).not.toBeNull();
      expect(
        localStorage.getItem("tavi.workspace.projectAddTask"),
      ).not.toBeNull();
      expect(screen.getByText("Reset all user settings")).toBeInTheDocument();
    });

    const resetUserSettingsCard = screen
      .getByText("Reset all user settings")
      .closest(".settings-item");

    expect(resetUserSettingsCard).not.toBeNull();
    fireEvent.click(resetUserSettingsCard as HTMLElement);

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        "Reset all server-backed and browser-cached user settings for this account to their defaults?",
      );
      expect(localStorage.getItem("unrelated")).toBe("keep");
      expect(localStorage.getItem("tavi.workspace.panels")).toBeNull();
      expect(localStorage.getItem("tavi.workspace.projectAddTask")).toBeNull();
      expect(
        screen.getByText(
          /Reset all user settings to defaults and cleared 2 cached Tavi preferences/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it("hydrates server-backed user config into browser cache and syncs changes back", async () => {
    const workspacePayload = createWorkspacePayload();
    const userConfigRequests: unknown[] = [];

    workspacePayload.userConfig = {
      ...workspacePayload.userConfig,
      panels: {
        ...workspacePayload.userConfig.panels,
        view: true,
      },
      preferences: {
        autoCollapse: false,
        bulkActions: false,
        fullWidth: true,
        theme: "forest",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.endsWith("/auth/user-config")) {
          const payload = JSON.parse(String(init?.body ?? "{}"));

          userConfigRequests.push(payload);
          return createResponse(payload);
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse(createNotificationPreferencesPayload());
        }

        return createResponse(workspacePayload);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.preferences") ?? "{}"),
      ).toEqual({
        autoCollapse: false,
        bulkActions: false,
        fullWidth: true,
        theme: "forest",
      });
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.panels") ?? "{}"),
      ).toEqual({ view: true });
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(userConfigRequests).toContainEqual(
        expect.objectContaining({
          addTaskPanels: {
            "project-1": true,
          },
          preferences: {
            autoCollapse: false,
            bulkActions: false,
            fullWidth: true,
            theme: "forest",
          },
        }),
      );
    });
  });

  it("shows admin audit changes with filters and changed values", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "update",
        metadata: {
          title: "Kickoff",
          changedFields: ["assigneeUserId", "status"],
          changes: [
            {
              field: "assigneeUserId",
              from: "user-1",
              to: null,
            },
            {
              field: "status",
              from: "todo",
              to: "in_progress",
            },
          ],
        },
        createdAt: "2026-02-01T12:00:00.000Z",
        actor: {
          id: "user-1",
          email: "editor@tavi.local",
          name: "Tavi Editor",
          role: "admin",
        },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      if (url.includes("/audit/changes")) {
        auditRequests.push(url);
        return createResponse(auditEvents);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditChangesCard = screen
      .getByText("Audit changes")
      .closest(".settings-item");

    expect(auditChangesCard).not.toBeNull();
    fireEvent.click(auditChangesCard as HTMLElement);

    const panel = await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      const element = screen
        .getByText("Admin-only project and task change history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(within(panel).getByText("Task: Kickoff")).toBeInTheDocument();
    });

    expect(within(panel).getByText("Tavi Editor -> None")).toBeInTheDocument();
    expect(
      within(panel).getByText("Not Started -> In Progress"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("Action"), {
      target: { value: "update" },
    });
    fireEvent.change(within(panel).getByLabelText("User"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(panel).getByLabelText("Search"), {
      target: { value: "Kickoff" },
    });

    await waitFor(() => {
      expect(
        auditRequests.some((requestUrl) => {
          const params = new URL(requestUrl, "http://localhost").searchParams;

          return (
            params.get("action") === "update" &&
            params.get("actorUserId") === "user-2" &&
            params.get("search") === "Kickoff"
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Admin-only project and task change history"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows admin audit logins with search and date filters", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-login-1",
        entityType: "auth",
        entityId: "session-1",
        action: "login",
        metadata: {
          title: "Viewer session",
        },
        createdAt: "2026-02-01T08:30:00.000Z",
        actor: {
          id: "user-2",
          email: "viewer@tavi.local",
          name: "Tavi Viewer",
          role: "viewer",
        },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      if (url.includes("/audit/logins")) {
        auditRequests.push(url);
        return createResponse(auditEvents);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditLoginsCard = screen
      .getByText("Audit logins")
      .closest(".settings-item");

    expect(auditLoginsCard).not.toBeNull();
    fireEvent.click(auditLoginsCard as HTMLElement);

    const panel = await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      const element = screen
        .getByText("Admin-only sign-in and sign-out history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(
        within(panel).getByText("Tavi Viewer · viewer@tavi.local"),
      ).toBeInTheDocument();
    });
    expect(
      within(panel).getByText(
        /Dates and times use your local timezone \(.+\)\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(new Date("2026-02-01T08:30:00.000Z")),
      ),
    ).toBeInTheDocument();

    expect(within(panel).queryByLabelText("Action")).not.toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("User"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(panel).getByLabelText("From"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(within(panel).getByLabelText("Search"), {
      target: { value: "viewer" },
    });

    await waitFor(() => {
      expect(
        auditRequests.some((requestUrl) => {
          const params = new URL(requestUrl, "http://localhost").searchParams;

          return (
            params.get("actorUserId") === "user-2" &&
            params.get("fromDate") === "2026-02-01" &&
            params.get("fromDateTime") ===
              new Date(2026, 1, 1, 0, 0, 0, 0).toISOString() &&
            params.get("search") === "viewer"
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Admin-only sign-in and sign-out history"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows admin audit emails with status and user filters", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const auditEvents: EmailAuditEvent[] = [
      {
        id: "email-event-1",
        action: "email_password_reset_failed",
        actor: {
          id: "user-2",
          email: "viewer@tavi.local",
          name: "Tavi Viewer",
          role: "viewer",
        },
        attemptCount: 1,
        createdAt: "2026-02-05T08:30:00.000Z",
        entityId: "user-2",
        entityType: "auth",
        error: "SMTP timeout",
        failedAt: "2026-02-05T08:30:00.000Z",
        kind: "password_reset",
        metadata: {
          expiresAt: "2026-02-05T08:45:00.000Z",
        },
        nextAttemptAt: null,
        recipient: {
          id: "user-2",
          email: "viewer@tavi.local",
          name: "Tavi Viewer",
        },
        response: null,
        sentAt: null,
        skippedAt: null,
        source: "password_reset",
        status: "failed",
        steps: [
          {
            attemptNumber: 1,
            createdAt: "2026-02-05T08:30:00.000Z",
            detail: "SMTP timeout",
            host: "10.120.64.99:25",
            id: "step-1",
            nextAttemptAt: null,
            response: "554 5.7.1 blocked",
            status: "failed",
            title: "Host rejected password reset",
          },
        ],
        subject: "Your Tavi one-time password",
      },
    ];
    const testEmailRequests: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method =
          init?.method ??
          (input instanceof Request ? input.method : undefined) ??
          "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/test") && method === "POST") {
          testEmailRequests.push(url);
          return createResponse({ success: true });
        }

        if (url.includes("/audit/emails")) {
          auditRequests.push(url);
          return createResponse(auditEvents);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditEmailsCard = screen
      .getByText("Audit notifications")
      .closest(".settings-item");

    expect(auditEmailsCard).not.toBeNull();
    fireEvent.click(auditEmailsCard as HTMLElement);

    const panel = await waitFor(() => {
      expect(
        screen.queryByText(
          "Workspace-wide admin controls, tools, and system reports.",
        ),
      ).not.toBeInTheDocument();
      const element = screen
        .getByText("Admin-only email notification delivery history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(
        within(panel).getByText("Tavi Viewer · viewer@tavi.local"),
      ).toBeInTheDocument();
    });
    expect(
      within(panel).getAllByText(
        new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(new Date("2026-02-05T08:30:00.000Z")),
      ).length,
    ).toBeGreaterThan(0);
    expect(within(panel).queryByLabelText("Log aging")).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "Purge logs" }),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText("password reset")).toBeInTheDocument();
    expect(within(panel).getByText("failed")).toBeInTheDocument();
    expect(
      within(panel).queryByText(/Host rejected password reset/i),
    ).not.toBeInTheDocument();

    const summaryButton = within(panel).getByRole("button", {
      name: "password reset notification flow summary",
    });
    const toggleButton = within(panel).getByRole("button", {
      name: "Expand password reset notification flow",
    });
    fireEvent.click(summaryButton);

    await waitFor(() => {
      expect(
        within(panel).getByText(/Host rejected password reset/i),
      ).toBeInTheDocument();
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(within(panel).getByRole("button", { name: "Test email" }));

    await waitFor(() => {
      expect(testEmailRequests).toEqual(["/api/auth/email/test"]);
    });
    await waitFor(() => {
      expect(
        within(panel).getByText("Test email sent to editor@tavi.local."),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(panel).getByLabelText("User"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(panel).getByLabelText("Status"), {
      target: { value: "failed" },
    });
    fireEvent.change(within(panel).getByLabelText("Search"), {
      target: { value: "viewer" },
    });

    await waitFor(() => {
      expect(
        auditRequests.some((requestUrl) => {
          const params = new URL(requestUrl, "http://localhost").searchParams;

          return (
            params.get("userId") === "user-2" &&
            params.get("status") === "failed" &&
            params.get("search") === "viewer"
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Close",
      }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("Admin-only email notification delivery history"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders legacy audit email payloads without crashing", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const legacyAuditEvents = [
      {
        id: "legacy-email-1",
        action: "email_password_reset_failed",
        attemptCount: 1,
        createdAt: "2026-02-05T08:30:00.000Z",
        entityId: "user-2",
        entityType: "auth",
        error: "SMTP timeout",
        failedAt: "2026-02-05T08:30:00.000Z",
        kind: "password_reset",
        metadata: {
          expiresAt: "2026-02-05T08:45:00.000Z",
        },
        recipient: {
          email: "viewer@tavi.local",
          id: "user-2",
          name: "Tavi Viewer",
        },
        source: "password_reset",
        status: "failed",
        subject: "Your Tavi one-time password",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.includes("/audit/emails")) {
          return createResponse(legacyAuditEvents);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditEmailsCard = screen
      .getByText("Audit notifications")
      .closest(".settings-item");

    expect(auditEmailsCard).not.toBeNull();
    fireEvent.click(auditEmailsCard as HTMLElement);

    const panel = await waitFor(() => {
      const element = screen
        .getByText("Admin-only email notification delivery history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(
        within(panel).getByText("Tavi Viewer · viewer@tavi.local"),
      ).toBeInTheDocument();
    });
    expect(within(panel).getByText("password reset")).toBeInTheDocument();
    expect(within(panel).getByText("failed")).toBeInTheDocument();
    expect(
      within(panel).queryByText(/Host rejected password reset/i),
    ).not.toBeInTheDocument();
  });

  it("shows actionable test email errors and refreshes the audit timeline", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const auditEvents: EmailAuditEvent[] = [];
    const detailedError =
      "Test email is unavailable right now. SMTP configuration error: Invalid SMTP_URL smtp://mailer:super-secret@smtp.example.com:587. From noreply@tavi.local. Check SMTP_URL (including protocol, host, port, and any required credentials).";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method =
          init?.method ??
          (input instanceof Request ? input.method : undefined) ??
          "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/test") && method === "POST") {
          return createResponse({ message: detailedError }, 503);
        }

        if (url.includes("/audit/emails")) {
          auditRequests.push(url);
          return createResponse(auditEvents);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditEmailsCard = screen
      .getByText("Audit notifications")
      .closest(".settings-item");

    expect(auditEmailsCard).not.toBeNull();
    fireEvent.click(auditEmailsCard as HTMLElement);

    const panel = await waitFor(() => {
      const element = screen
        .getByText("Admin-only email notification delivery history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Test email" }));

    await waitFor(() => {
      expect(
        within(panel).getByText(maskSmtpPassword(detailedError)),
      ).toBeInTheDocument();
    });
    expect(within(panel).queryByText(/super-secret/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(auditRequests.length).toBeGreaterThan(1);
    });
  });

  it("copies notification flows without expanding them and still lets rows collapse", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    const auditEvents: EmailAuditEvent[] = [
      {
        action: "email_password_reset_failed",
        actor: {
          email: "editor@tavi.local",
          id: "user-1",
          name: "Tavi Editor",
          role: "admin",
        },
        attemptCount: 1,
        createdAt: "2026-02-05T08:30:00.000Z",
        entityId: "user-2",
        entityType: "auth",
        error: "SMTP timeout for smtp://mailer:super-secret@10.120.64.99:25",
        failedAt: "2026-02-05T08:30:00.000Z",
        id: "email-audit-copy",
        kind: "password_reset",
        metadata: {
          expiresAt: "2026-02-05T08:45:00.000Z",
          title: "Reset password for viewer",
        },
        nextAttemptAt: null,
        recipient: {
          email: "viewer@tavi.local",
          id: "user-2",
          name: "Tavi Viewer",
        },
        response: null,
        sentAt: null,
        skippedAt: null,
        source: "password_reset",
        status: "failed",
        steps: [
          {
            attemptNumber: 1,
            createdAt: "2026-02-05T08:30:00.000Z",
            detail:
              "SMTP timeout for smtp://mailer:super-secret@10.120.64.99:25",
            host: "10.120.64.99:25",
            id: "copy-step-1",
            nextAttemptAt: null,
            response: "554 5.7.1 blocked",
            status: "failed",
            title: "Host rejected password reset",
          },
        ],
        subject: "Your Tavi one-time password",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.includes("/audit/emails")) {
          return createResponse(auditEvents);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditEmailsCard = screen
      .getByText("Audit notifications")
      .closest(".settings-item");

    expect(auditEmailsCard).not.toBeNull();
    fireEvent.click(auditEmailsCard as HTMLElement);

    const panel = await waitFor(() => {
      const element = screen
        .getByText("Admin-only email notification delivery history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    const summaryButton = await waitFor(() =>
      within(panel).getByRole("button", {
        name: "password reset notification flow summary",
      }),
    );
    const toggleButton = await waitFor(() =>
      within(panel).getByRole("button", {
        name: "Expand password reset notification flow",
      }),
    );

    expect(
      within(panel).queryByText(/Host rejected password reset/i),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Copy password reset notification flow",
      }),
    );

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Notification: password reset"),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Recipient: Tavi Viewer · viewer@tavi.local"),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Timeline:"),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("Host rejected password reset"),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("smtp://mailer:***@10.120.64.99:25"),
    );
    expect(writeTextMock).not.toHaveBeenCalledWith(
      expect.stringContaining("super-secret"),
    );
    expect(
      within(panel).getByText(
        "Copied password reset notification flow for Tavi Viewer · viewer@tavi.local.",
      ),
    ).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    expect(
      within(panel).queryByText(/Host rejected password reset/i),
    ).not.toBeInTheDocument();

    fireEvent.click(summaryButton);

    await waitFor(() => {
      expect(
        within(panel).getByText(/Host rejected password reset/i),
      ).toBeInTheDocument();
    });
    expect(
      within(panel).getAllByText(/smtp:\/\/mailer:\*\*\*@10\.120\.64\.99:25/i)
        .length,
    ).toBeGreaterThan(0);
    expect(within(panel).queryByText(/super-secret/)).not.toBeInTheDocument();

    fireEvent.click(
      within(panel).getByRole("button", {
        name: "Collapse password reset notification flow",
      }),
    );

    await waitFor(() => {
      expect(
        within(panel).queryByText(/Host rejected password reset/i),
      ).not.toBeInTheDocument();
    });
  });

  it("auto-collapses projects by default and keeps them open when disabled", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "not_started",
          sortOrder: 0,
          completedAt: null,
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    toggleProjectByTitle("Beta rollout");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto Collapse" }));

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });
  });

  it("scrolls the newly expanded project into view when auto-collapse switches focus", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "not_started",
          sortOrder: 0,
          completedAt: null,
        },
      ],
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    const betaProjectCard = screen.getByText("Beta rollout").closest("article");

    expect(betaProjectCard).not.toBeNull();
    if (!(betaProjectCard instanceof HTMLElement)) {
      throw new Error("Expected beta project card");
    }

    betaProjectCard.getBoundingClientRect = () =>
      ({
        bottom: 1020,
        height: 120,
        left: 0,
        right: 500,
        top: 900,
        width: 500,
        x: 0,
        y: 900,
        toJSON: () => ({}),
      }) as DOMRect;

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    scrollIntoViewMock.mockClear();
    toggleProjectByTitle("Beta rollout");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "end",
        inline: "nearest",
      });
    });
  });

  it("keeps a regrouped project in view after a task status change", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    let patchBody: string | null = null;

    workspacePayload.userConfig.filters.groupBy = "status";
    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTodoCount: 2,
      taskInProgressCount: 0,
      tasks: workspacePayload.projects[0].tasks.map((task) => ({
        ...task,
        status: "not_started",
        completedAt: null,
      })),
    };
    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 0,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "in_progress",
          sortOrder: 0,
          completedAt: null,
          createdAt: "2026-04-03T11:00:00.000Z",
          updatedAt: "2026-04-03T11:00:00.000Z",
        },
      ],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            derivedStatus: "in_progress",
            displayStatus: "in_progress",
            taskTodoCount: 1,
            taskInProgressCount: 1,
            updatedAt: "2026-04-03T12:30:00.000Z",
            tasks: workspacePayload.projects[0].tasks.map((task) =>
              task.id === "task-1"
                ? {
                    ...task,
                    status: "in_progress",
                    updatedAt: "2026-04-03T12:30:00.000Z",
                  }
                : task,
            ),
          };

          return createResponse(workspacePayload.projects[0].tasks[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
      expect(screen.getByLabelText("Group by")).toHaveValue("status");
    });

    const roadmapProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(roadmapProjectCard).not.toBeNull();
    if (!(roadmapProjectCard instanceof HTMLElement)) {
      throw new Error("Expected roadmap project card");
    }

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          bottom: 1020,
          height: 120,
          left: 0,
          right: 500,
          top: 900,
          width: 500,
          x: 0,
          y: 900,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(roadmapProjectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(
      within(roadmapProjectCard).getByDisplayValue("Not Started"),
      {
        target: { value: "in_progress" },
      },
    );

    scrollIntoViewMock.mockClear();
    fireEvent.click(
      within(roadmapProjectCard).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(patchBody).toBe(
        JSON.stringify({
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: "user-1",
          dueDate: "",
          priority: "medium",
          status: "in_progress",
        }),
      );
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "end",
        inline: "nearest",
      });
    });
  });

  it("moves Personal ToDo into profile and keeps viewed actions in the View panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Mark all viewed" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Personal ToDo" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByText("Viewed changes")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Mark all viewed" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    await waitFor(() => {
      expect(screen.getByText("User Profile")).toBeInTheDocument();
    });

    const profilePanel = screen.getByText("User Profile").closest("section");

    expect(profilePanel).not.toBeNull();
    if (!(profilePanel instanceof HTMLElement)) {
      throw new Error("Expected profile panel");
    }

    const accountHeading = within(profilePanel).getByText("Account");
    const personalTodoHeading = within(profilePanel).getByText("Personal ToDo");
    const themeHeading = within(profilePanel).getByText("Theme");

    expect(
      accountHeading.compareDocumentPosition(personalTodoHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      personalTodoHeading.compareDocumentPosition(themeHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const personalTodoTile = personalTodoHeading.closest(".settings-item");

    expect(personalTodoTile).not.toBeNull();
    fireEvent.click(personalTodoTile!);

    await waitFor(() => {
      expect(screen.getByText("Private draft")).toBeInTheDocument();
    });
  });

  it("highlights projects and expanded tasks with unviewed changes", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      hasUnviewedChanges: true,
      lastViewedAt: "2026-04-03T10:00:00.000Z",
      tasks: workspacePayload.projects[0].tasks.map((task, index) => ({
        ...task,
        hasUnviewedChanges: index === 0,
      })),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).toHaveClass("project-card--unviewed");

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    expect(screen.getByText("Kickoff").closest("tr")).toHaveClass(
      "task-row--unviewed",
    );
    expect(screen.getByText("Review plan").closest("tr")).not.toHaveClass(
      "task-row--unviewed",
    );
  });

  it("filters not viewed projects before status grouping", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.userConfig.filters.groupBy = "status";
    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      hasUnviewedChanges: false,
      tasks: workspacePayload.projects[0].tasks.map((task, index) => ({
        ...task,
        hasUnviewedChanges: index === 0,
      })),
    };
    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 0,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: null,
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "in_progress",
          sortOrder: 0,
          completedAt: null,
          hasUnviewedChanges: false,
        },
      ],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/user-config") && init?.method === "PUT") {
          return createResponse({
            ...workspacePayload.userConfig,
            filters: {
              ...workspacePayload.userConfig.filters,
              notViewedOnly: true,
            },
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
      expect(screen.getByLabelText("Group by")).toHaveValue("status");
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByText("Viewed changes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Not viewed" }));

    await waitFor(() => {
      expect(getVisibleProjectTitles()).toEqual(["Roadmap refresh"]);
    });
  });

  it("refreshes the signed-in workspace until other-user changes are highlighted", async () => {
    vi.useFakeTimers();
    const initialWorkspacePayload = createWorkspacePayload();
    const refreshedWorkspacePayload = createWorkspacePayload();
    let workspaceRequests = 0;

    refreshedWorkspacePayload.projects[0] = {
      ...refreshedWorkspacePayload.projects[0],
      hasUnviewedChanges: true,
      tasks: refreshedWorkspacePayload.projects[0].tasks.map((task, index) => ({
        ...task,
        hasUnviewedChanges: index === 0,
      })),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (!url.endsWith("/workspace")) {
          throw new Error(`Unexpected request: ${url}`);
        }

        workspaceRequests += 1;
        return createResponse(
          workspaceRequests === 1
            ? initialWorkspacePayload
            : refreshedWorkspacePayload,
        );
      }),
    );

    renderApp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toHaveClass("project-card--unviewed");
    expect(workspaceRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersToNextTimerAsync();
    });

    expect(workspaceRequests).toBeGreaterThanOrEqual(2);
    expect(projectCard).toHaveClass("project-card--unviewed");
  });

  it("marks a project viewed when it is collapsed", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/workspace/projects/project-1/viewed") &&
          init?.method === "POST"
        ) {
          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            hasUnviewedChanges: false,
            lastViewedAt: "2026-04-03T12:00:00.000Z",
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              hasUnviewedChanges: false,
            })),
          };

          return createResponse({
            projectId: "project-1",
            viewedAt: "2026-04-03T12:00:00.000Z",
            viewedTaskCount: 2,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      hasUnviewedChanges: true,
      lastViewedAt: "2026-04-03T10:00:00.000Z",
      tasks: workspacePayload.projects[0].tasks.map((task) => ({
        ...task,
        hasUnviewedChanges: true,
      })),
    };

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspace/projects/project-1/viewed",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  it("marks all unviewed projects from the toolbar", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/workspace/projects/viewed") &&
          init?.method === "POST"
        ) {
          workspacePayload.projects = workspacePayload.projects.map(
            (project) => ({
              ...project,
              hasUnviewedChanges: false,
              lastViewedAt: "2026-04-03T12:00:00.000Z",
              tasks: project.tasks.map((task) => ({
                ...task,
                hasUnviewedChanges: false,
              })),
            }),
          );

          return createResponse({
            viewedAt: "2026-04-03T12:00:00.000Z",
            viewedProjectCount: 1,
            viewedTaskCount: 2,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      hasUnviewedChanges: true,
      lastViewedAt: "2026-04-03T10:00:00.000Z",
      tasks: workspacePayload.projects[0].tasks.map((task) => ({
        ...task,
        hasUnviewedChanges: true,
      })),
    };

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).toHaveClass("project-card--unviewed");

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByText("Viewed changes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Mark all viewed" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspace/projects/viewed",
        expect.objectContaining({
          method: "POST",
        }),
      );
      expect(projectCard).not.toHaveClass("project-card--unviewed");
    });
  });

  it("uses tighter card spacing only while a project is collapsed and highlights expanded projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const collapsedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(collapsedProjectCard).not.toBeNull();
    expect(collapsedProjectCard).toHaveClass("project-card--collapsed");
    expect(collapsedProjectCard).not.toHaveClass("project-card--expanded");

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(collapsedProjectCard).not.toHaveClass("project-card--collapsed");
      expect(collapsedProjectCard).toHaveClass("project-card--expanded");
    });
  });

  it("toggles done and canceled tasks inside an expanded project without keeping hidden selections", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0]?.tasks.push({
      id: "task-3",
      projectId: "project-1",
      title: "Ship recap",
      notes: "Already wrapped",
      assigneeUserId: "user-1",
      assigneeName: "Tavi Editor",
      dueDate: null,
      priority: "low",
      status: "done",
      sortOrder: 2,
      completedAt: "2026-04-03T10:00:00.000Z",
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
    });
    workspacePayload.projects[0]?.tasks.push({
      id: "task-4",
      projectId: "project-1",
      title: "Cut stale scope",
      notes: "Canceled work",
      assigneeUserId: "user-2",
      assigneeName: "Tavi Viewer",
      dueDate: null,
      priority: "low",
      status: "canceled",
      sortOrder: 3,
      completedAt: "2026-04-03T11:00:00.000Z",
      createdAt: "2026-04-03T09:30:00.000Z",
      updatedAt: "2026-04-03T11:00:00.000Z",
    });
    workspacePayload.projects[0]!.taskTotalCount = 4;
    workspacePayload.projects[0]!.taskDoneCount = 1;
    workspacePayload.projects[0]!.taskCanceledCount = 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(screen.getByText("Ship recap")).toBeInTheDocument();
      expect(screen.getByText("Cut stale scope")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Ship recap"));
    fireEvent.click(screen.getByLabelText("Select task Cut stale scope"));

    await waitFor(() => {
      expect(screen.getByText("2 selected tasks")).toBeInTheDocument();
    });

    const doneFilterButton = screen.getByRole("button", {
      name: "Hide done and canceled tasks in Roadmap refresh",
    });

    expect(doneFilterButton).not.toBeDisabled();

    fireEvent.click(doneFilterButton);

    await waitFor(() => {
      expect(screen.queryByText("Ship recap")).not.toBeInTheDocument();
      expect(screen.queryByText("Cut stale scope")).not.toBeInTheDocument();
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
    });

    expect(
      JSON.parse(localStorage.getItem("tavi.workspace.hideDoneTasks") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        "project-1": true,
      }),
    );

    fireEvent.click(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    );

    await waitFor(() => {
      expect(screen.getByText("2 selected tasks")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show done and canceled tasks in Roadmap refresh",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Ship recap")).toBeInTheDocument();
      expect(screen.getByText("Cut stale scope")).toBeInTheDocument();
    });

    expect(localStorage.getItem("tavi.workspace.hideDoneTasks")).toBeNull();

    expect(screen.getByLabelText("Select task Kickoff")).toBeChecked();
    expect(screen.getByLabelText("Select task Review plan")).toBeChecked();
    expect(screen.getByLabelText("Select task Ship recap")).not.toBeChecked();
    expect(
      screen.getByLabelText("Select task Cut stale scope"),
    ).not.toBeChecked();
  });

  it("keeps active task drag handles enabled while done tasks are hidden", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0]?.tasks.push({
      id: "task-3",
      projectId: "project-1",
      title: "Ship recap",
      notes: "Already wrapped",
      assigneeUserId: "user-1",
      assigneeName: "Tavi Editor",
      dueDate: null,
      priority: "low",
      status: "done",
      sortOrder: 2,
      completedAt: "2026-04-03T10:00:00.000Z",
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
    });
    workspacePayload.projects[0]!.taskTotalCount = 3;
    workspacePayload.projects[0]!.taskDoneCount = 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Ship recap")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Hide done and canceled tasks in Roadmap refresh",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Ship recap")).not.toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Drag to reorder Kickoff" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Drag to reorder Review plan" }),
    ).not.toBeDisabled();
  });

  it("clears selected tasks for a collapsed project without affecting other open projects", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "not_started",
          sortOrder: 0,
          completedAt: null,
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto Collapse" }));

    toggleProjectByTitle("Roadmap refresh");
    toggleProjectByTitle("Beta rollout");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    );
    fireEvent.click(screen.getByLabelText("Select all tasks in Beta rollout"));

    await waitFor(() => {
      expect(screen.getByText("3 selected tasks")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Select all tasks in Beta rollout"),
    ).toBeChecked();

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Select task Kickoff")).not.toBeChecked();
    expect(screen.getByLabelText("Select task Review plan")).not.toBeChecked();
    expect(screen.getByLabelText("Select task Draft brief")).toBeChecked();
  });

  it("hides bulk actions UI and clears task selection when bulk actions is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));

    await waitFor(() => {
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tavi Editor" }));

    const bulkActionsSwitch = screen.getByRole("switch", {
      name: "Bulk Actions",
    });

    fireEvent.click(bulkActionsSwitch);

    await waitFor(() => {
      expect(screen.queryByText("1 selected task")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Select task Kickoff"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Select all tasks in Roadmap refresh"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("switch", { name: "Bulk Actions" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Select task Kickoff")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Select task Kickoff")).not.toBeChecked();
    expect(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    ).not.toBeChecked();
    expect(screen.queryByText("1 selected task")).not.toBeInTheDocument();
  });

  it("clears project overrides from the project row action", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              manualStatus: null,
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            displayStatus: "in_progress",
            manualStatus: null,
          };

          return createResponse(workspacePayload.projects[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          body: JSON.stringify({
            manualStatus: null,
          }),
          method: "PATCH",
        }),
      );
    });
  });

  it("shows audit history and applies bulk task updates", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    let auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "update",
        metadata: {
          changedFields: ["status"],
          status: "in_progress",
        },
        createdAt: "2026-02-01T12:00:00.000Z",
        actor: {
          id: "user-1",
          email: "editor@tavi.local",
          name: "Tavi Editor",
          role: "editor",
        },
      },
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.includes("/audit/task/task-1")) {
          return createResponse(auditEvents);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              status: "done",
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            derivedStatus: "done",
            displayStatus: "blocked",
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskDoneCount: 2,
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              status: "done",
              completedAt: "2026-02-01T14:00:00.000Z",
            })),
          };
          auditEvents = [
            {
              id: "event-2",
              entityType: "task",
              entityId: "task-1",
              action: "bulk_update",
              metadata: {
                changedFields: ["status"],
                selectionSize: 2,
                status: "done",
              },
              createdAt: "2026-02-01T14:00:00.000Z",
              actor: {
                id: "user-1",
                email: "editor@tavi.local",
                name: "Tavi Editor",
                role: "editor",
              },
            },
            ...auditEvents,
          ];

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      const projectCard = screen
        .getByText("Roadmap refresh")
        .closest("article");
      const expandButton = projectCard?.querySelector("button.group-toggle");

      expect(expandButton).toBeTruthy();
      fireEvent.click(expandButton!);
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(
      within(kickoffRow!).getByRole("button", { name: "History" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Task history · Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Status In Progress")).toBeInTheDocument();
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
      });
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Status"), {
      target: { value: "done" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(screen.getByText("2 tasks selected")).toBeInTheDocument();
      expect(screen.getByText("Status Done")).toBeInTheDocument();
    });
  });

  it("scrolls project history into view when selected", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      if (url.includes("/audit/project/project-1")) {
        return createResponse([
          {
            id: "event-1",
            entityType: "project",
            entityId: "project-1",
            action: "update",
            metadata: {
              changedFields: ["title"],
              title: "Roadmap refresh",
            },
            createdAt: "2026-02-01T12:00:00.000Z",
            actor: {
              id: "user-1",
              email: "editor@tavi.local",
              name: "Tavi Editor",
              role: "editor",
            },
          },
        ]);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "History" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Project history · Roadmap refresh",
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("Changed title")).toBeInTheDocument();
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
      });
    });
  });

  it("clears task notes through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              notes: null,
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              notes: null,
            })),
          };

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Notes"), {
      target: { value: "clear" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
    });
  });

  it("clears task assignees through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              assigneeUserId: null,
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              assigneeUserId: null,
              assigneeName: null,
            })),
          };

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Assignee"), {
      target: { value: "__none__" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(2);
  });

  it("filters and sorts project picker targets while hiding completed projects", async () => {
    const workspacePayload = createSortedWorkspacePayload();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));

    const bulkCard = screen.getByText("1 selected task").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.click(
      within(bulkCard!).getByRole("button", { name: /^Copy to project:/ }),
    );

    const picker = screen.getByRole("dialog", { name: "Copy to project" });
    const getProjectOptionLabels = () =>
      within(picker)
        .getAllByRole("button", { name: /^Select project / })
        .map((button) => button.textContent ?? "");

    expect(
      within(picker).getByRole("button", {
        name: "Select project Beta rollout",
      }),
    ).toBeInTheDocument();
    expect(
      within(picker).queryByRole("button", {
        name: "Select project Alpha planning",
      }),
    ).not.toBeInTheDocument();

    fireEvent.change(within(picker).getByLabelText("Copy to project search"), {
      target: { value: "road" },
    });

    expect(
      within(picker).getByRole("button", {
        name: "Select project Roadmap refresh",
      }),
    ).toBeInTheDocument();
    expect(
      within(picker).queryByRole("button", {
        name: "Select project Beta rollout",
      }),
    ).not.toBeInTheDocument();

    fireEvent.change(within(picker).getByLabelText("Copy to project search"), {
      target: { value: "" },
    });
    fireEvent.click(within(picker).getByRole("button", { name: "Date" }));

    expect(getProjectOptionLabels()[0]).toContain("Roadmap refresh");

    fireEvent.click(within(picker).getByRole("button", { name: "Alpha" }));

    expect(getProjectOptionLabels()[0]).toContain("Beta rollout");

    fireEvent.click(within(picker).getByLabelText("Show hidden"));

    expect(
      within(picker).getByRole("button", {
        name: "Select project Alpha planning",
      }),
    ).toBeInTheDocument();
  });

  it("copies selected tasks to another project through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Operations uplift",
      notes: null,
      references: null,
      ownerUserId: null,
      ownerName: null,
      dueDate: null,
      priority: "low",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
      tasks: [],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/copy") && init?.method === "POST") {
          expect(init.body).toBe(
            JSON.stringify({
              targetProjectId: "project-2",
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[1] = {
            ...workspacePayload.projects[1],
            derivedStatus: "in_progress",
            displayStatus: "in_progress",
            taskTotalCount: 2,
            taskTodoCount: 1,
            taskInProgressCount: 1,
            updatedAt: "2026-04-03T11:00:00.000Z",
            tasks: [
              {
                ...workspacePayload.projects[0].tasks[0],
                id: "task-3",
                projectId: "project-2",
                sortOrder: 0,
                createdAt: "2026-04-03T11:00:00.000Z",
                updatedAt: "2026-04-03T11:00:00.000Z",
              },
              {
                ...workspacePayload.projects[0].tasks[1],
                id: "task-4",
                projectId: "project-2",
                sortOrder: 1,
                createdAt: "2026-04-03T11:00:01.000Z",
                updatedAt: "2026-04-03T11:00:01.000Z",
              },
            ],
          };

          return createResponse({
            copiedCount: 2,
            copiedTaskIds: ["task-3", "task-4"],
            targetProjectId: "project-2",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Operations uplift")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.click(
      within(bulkCard!).getByRole("button", { name: /^Copy to project:/ }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Copy to project" })).getByRole(
        "button",
        { name: "Select project Operations uplift" },
      ),
    );
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(
        screen.getByText('Copied 2 tasks to "Operations uplift".'),
      ).toBeInTheDocument();
    });
  });

  it("shows Delete between Clear and Apply and archives selected tasks", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/archive") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            derivedStatus: "not_started",
            displayStatus: "blocked",
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          };

          return createResponse({
            archivedCount: 2,
            archivedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();

    const bulkActionButtons = bulkCard?.querySelector(".bulk-action-buttons");

    expect(bulkActionButtons).not.toBeNull();
    expect(
      within(bulkActionButtons as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Clear", "Delete", "Copy", "Apply"]);

    fireEvent.click(
      within(bulkActionButtons as HTMLElement).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(
        screen.getByText("Deleted 2 tasks from the workspace."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
    expect(screen.queryByText("Review plan")).not.toBeInTheDocument();
  });

  it("shows a bulk delete error when archival fails", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/archive") && init?.method === "PATCH") {
          return createResponse(
            { message: "Unable to delete selected tasks" },
            500,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));

    const bulkCard = screen.getByText("1 selected task").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.getByText("Unable to delete selected tasks"),
      ).toBeInTheDocument();
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });
  });
});
