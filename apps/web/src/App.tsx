import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appName, appRepositoryUrl } from "@tavi/config";
import type {
  AuditEntityType,
  Priority,
  ProjectStatus,
  TaskStatus,
} from "@tavi/schemas";
import "./App.css";
import {
  ApiError,
  bulkCopyTasks,
  bulkDeleteTasks,
  bulkUpdateTasks,
  convertProjectToTask,
  convertTaskToProject,
  createProject,
  createSavedView,
  createTask,
  deleteProject,
  deleteSavedView,
  deleteTask,
  getAuditHistory,
  getLocalLoginHint,
  getNotificationPreferences,
  getSmtpStatus,
  getWorkspace,
  isApiUnavailableError,
  listAuditChanges,
  listAuditEmails,
  listAuditLogins,
  login,
  loginAsGuest,
  logout,
  markAllProjectsViewed,
  markProjectViewed,
  requestPasswordReset,
  renameSavedView,
  reorderProjectTasks,
  resetPasswordWithOtp,
  sendTestEmail,
  updateEmailSettings,
  updateMyProfile,
  updateNotificationPreferences,
  updateProject,
  updateSavedView,
  updateTask,
  updateUserConfig,
  resetUserSettings,
} from "./api";
import { maskSmtpPassword } from "./redact-secrets";
import { BackupSettingsCard } from "./BackupSettingsCard";
import { BuildDateLabel } from "./BuildDateLabel";
import { buildShaLabel } from "./build-info";
import { ExportPanel } from "./ExportPanel";
import { downloadCsvFile } from "./export-utils";
import { ImportPanel } from "./ImportPanel";
import { LocalAccountsPanel } from "./LocalAccountsPanel";
import { Modal } from "./Modal";
import { NotesMarkdown } from "./NotesMarkdown";
import {
  extractUrlFilename,
  truncateDisplayLinkLabel,
} from "./notes-markdown-helpers";
import { PersonalTodoPanel } from "./PersonalTodoPanel";
import { RetentionSettingsPanel } from "./RetentionSettingsPanel";
import { getAppHomeUrl } from "./runtime-config";
import { SearchHighlightedText } from "./SearchHighlightedText";
import {
  clearTaviStorage,
  hasTaviStorage,
  readTaviStorage,
  removeTaviStorage,
  writeTaviStorage,
} from "./storage";
import {
  formatDateTime,
  getLocalTimeZoneLabel,
  localTimeToUtcTime,
  utcTimeToLocalTime,
} from "./time";
import {
  normalizeSearchHighlightTerm,
  textMatchesSearch,
} from "./search-highlight";
import type {
  EmailAuditEvent,
  AuditHistoryEvent,
  CreateProjectPayload,
  CreateTaskPayload,
  GroupBy,
  LoginPayload,
  NotificationPreferences,
  ProjectSortField,
  RequestPasswordResetPayload,
  ResetPasswordWithOtpPayload,
  SavedView,
  SmtpStatus,
  UpdateOwnProfilePayload,
  WorkspaceUser,
  WorkspaceUserConfig,
  UpdateProjectPayload,
  UpdateTaskPayload,
  WorkspaceProject,
  WorkspaceResponse,
  WorkspaceTask,
} from "./types";

const GROUP_LABELS: Record<GroupBy, string> = {
  none: "Projects",
  owner: "Owner",
  priority: "Priority",
  status: "Status",
  progress: "Progress",
};
const appChangelogUrl = `${appRepositoryUrl}/blob/main/CHANGELOG.md`;

const PROJECT_SORT_OPTIONS: Array<{
  label: string;
  value: ProjectSortField;
}> = [
  { label: "Title", value: "title" },
  { label: "Progress", value: "progress" },
  { label: "Priority", value: "priority" },
  { label: "Due Date", value: "dueDate" },
  { label: "Age", value: "age" },
  { label: "Last Updated", value: "lastUpdated" },
];

const WORK_ITEM_STATUS_OPTIONS = [
  { label: "Not Started", value: "not_started" },
  { label: "In Progress", value: "in_progress" },
  { label: "Demo", value: "demo" },
  { label: "Review", value: "review" },
  { label: "Done", value: "done" },
  { label: "Blocked", value: "blocked" },
  { label: "On Hold", value: "on_hold" },
  { label: "Cancelled", value: "canceled" },
] as const;

const PROJECT_STATUS_FILTER_OPTIONS: Array<{
  label: string;
  value: ProjectStatus;
}> = WORK_ITEM_STATUS_OPTIONS.map(({ label, value }) => ({
  label,
  value: value as ProjectStatus,
}));

const TASK_STATUS_OPTIONS: Array<{
  label: string;
  value: TaskStatus;
}> = WORK_ITEM_STATUS_OPTIONS.map(({ label, value }) => ({
  label,
  value: value as TaskStatus,
}));

const DONE_FILTER_HIDDEN_TASK_STATUSES = new Set<TaskStatus>([
  "done",
  "canceled",
]);

const STATUS_LABELS: Record<ProjectStatus | TaskStatus | "todo", string> = {
  todo: "Not Started",
  not_started: "Not Started",
  in_progress: "In Progress",
  demo: "Demo",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  on_hold: "On Hold",
  canceled: "Cancelled",
};

const EMPTY_PROJECT_FORM: CreateProjectPayload = {
  title: "",
  notes: "",
  references: "",
  ownerUserId: null,
  dueDate: "",
  priority: "medium",
};

const EMPTY_LOGIN_FORM: LoginPayload = {
  email: "",
  password: "",
};

const EMPTY_PASSWORD_RESET_FORM = {
  email: "",
  oneTimePassword: "",
  password: "",
  passwordConfirmation: "",
};

const BRAND_MARK = "ᴛᴀᴠi";
const EDITOR_SCROLL_TOP_MARGIN = 132;
const EDITOR_SCROLL_BOTTOM_MARGIN = 24;
const SCROLL_TO_TOP_VISIBILITY_OFFSET = 240;
const PASSWORD_RESET_NOTICE =
  "If that account can receive email, a one-time password was sent. It expires in 10 minutes.";
const PASSWORD_RESET_CODE_PATTERN = /^[0-9A-F]{4}-[0-9A-F]{4}$/;
const GUEST_USER_EMAIL = "guest@tavi.local";
const USER_CONFIG_SYNC_ERROR_MESSAGE =
  "Unable to sync user settings to the server. Your latest changes are still cached in this browser.";
const DEFAULT_DAILY_DIGEST_TIME_UTC = "11:00";
const HOURLY_DIGEST_TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const value = `${String(hour).padStart(2, "0")}:00`;
  const date = new Date();

  date.setHours(hour, 0, 0, 0);

  return {
    label: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
    value,
  };
});
const NOTIFICATION_RATE_OPTIONS = [
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
] as const;
const PERSONAL_TODO_RETENTION_OPTIONS = [
  { label: "Never", value: "never" },
  { label: "1 month", value: "one_month" },
  { label: "3 months", value: "three_months" },
  { label: "6 months", value: "six_months" },
  { label: "12 months", value: "twelve_months" },
  { label: "Delete when done", value: "delete_when_done" },
] as const;
const ROW_EDIT_INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label";

type PasswordResetFormState = {
  email: string;
  oneTimePassword: string;
  password: string;
  passwordConfirmation: string;
};

type WorkspacePanelState = {
  backups: boolean;
  importExport: boolean;
  newProject: boolean;
  personalTodo: boolean;
  profile: boolean;
  settings: boolean;
  view: boolean;
};

const WORKSPACE_THEME_META = {
  light: { colorScheme: "light", label: "Light" },
  sepia: { colorScheme: "light", label: "Sepia" },
  spring: { colorScheme: "light", label: "Spring" },
  summer: { colorScheme: "light", label: "Summer" },
  sunshower: { colorScheme: "light", label: "Sunshower" },
  ocean: { colorScheme: "dark", label: "Ocean" },
  forest: { colorScheme: "dark", label: "Forest" },
  autumn: { colorScheme: "dark", label: "Autumn" },
  "autumn-light": { colorScheme: "light", label: "Autumn Light" },
  coyote: { colorScheme: "light", label: "Coyote" },
  "coyote-dark": { colorScheme: "dark", label: "Coyote Dark" },
  guinness: { colorScheme: "dark", label: "Guinness" },
  night: { colorScheme: "dark", label: "Night" },
  midnight: { colorScheme: "dark", label: "Midnight" },
  pine: { colorScheme: "dark", label: "Pine" },
  obsidian: { colorScheme: "dark", label: "Obsidian" },
} as const satisfies Record<
  string,
  { colorScheme: "dark" | "light"; label: string }
>;

const WORKSPACE_THEMES = Object.keys(WORKSPACE_THEME_META) as WorkspaceTheme[];

type WorkspaceTheme = keyof typeof WORKSPACE_THEME_META;

type WorkspaceFilterState = {
  assigneeUserIds: string[];
  groupBy: GroupBy;
  notViewedOnly: boolean;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
};

type WorkspaceUserConfigWithFilters = Omit<WorkspaceUserConfig, "filters"> & {
  filters: WorkspaceFilterState;
};

type SearchTaskRevealTarget = {
  groupKey: string;
  hiddenByDoneFilter: boolean;
  projectId: string;
  taskId: string;
};
type WorkspaceUserConfigInput = Partial<
  Omit<WorkspaceUserConfig, "filters">
> & {
  filters?: Partial<WorkspaceFilterState> | null;
};

type WorkspaceCollapsedGroups = Partial<
  Record<GroupBy, Record<string, boolean>>
>;

type NoteEditorType = "project" | "task";
type TaskDropPosition = "before" | "after";

type NoteEditorHeights = {
  project: number | null;
  task: number | null;
};

type TaskDragState = {
  projectId: string;
  taskId: string;
  overTaskId: string;
  position: TaskDropPosition;
};

type WorkspacePreferences = {
  autoCollapse: boolean;
  bulkActions: boolean;
  fullWidth: boolean;
  theme: WorkspaceTheme;
};

type NotificationRate = "daily" | "hourly";
type ProjectPickerSortField = "alpha" | "date" | "status" | "assignee";

type BulkTaskDraft = {
  assigneeMode: "keep" | "set" | "clear";
  assigneeUserId: string;
  copyTargetProjectId: string;
  dueDate: string;
  dueDateMode: "keep" | "set" | "clear";
  notesMode: "keep" | "clear";
  priority: Priority | "";
  status: TaskStatus | "";
};

type AuditTarget = {
  emptyMessage: string;
  entityId: string;
  entityType: AuditEntityType;
  subtitle: string;
  title: string;
};

type AdminAuditReportType = "changes" | "emails" | "logins";

const AUDIT_CHANGE_ACTION_OPTIONS = [
  { label: "All actions", value: "" },
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Delete", value: "delete" },
  { label: "Bulk copy", value: "bulk_copy" },
  { label: "Bulk update", value: "bulk_update" },
  { label: "Bulk delete", value: "bulk_delete" },
  { label: "Converted to project", value: "convert_to_project" },
  { label: "Converted from project", value: "convert_from_project" },
  { label: "Converted to task", value: "convert_to_task" },
  { label: "Status override set", value: "status_override_set" },
  { label: "Status override clear", value: "status_override_clear" },
  { label: "Import create", value: "import_create" },
  { label: "Import update", value: "import_update" },
] as const;
const BULK_CLEAR_ASSIGNEE_VALUE = "__none__";

const createEmptyBulkTaskDraft = (): BulkTaskDraft => ({
  assigneeMode: "keep",
  assigneeUserId: "",
  copyTargetProjectId: "",
  dueDate: "",
  dueDateMode: "keep",
  notesMode: "keep",
  priority: "",
  status: "",
});

const DEFAULT_WORKSPACE_PANEL_STATE: WorkspacePanelState = {
  backups: false,
  importExport: false,
  newProject: false,
  personalTodo: false,
  profile: false,
  settings: false,
  view: false,
};

const DEFAULT_WORKSPACE_THEME: WorkspaceTheme = "light";

const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  autoCollapse: true,
  bulkActions: true,
  fullWidth: false,
  theme: DEFAULT_WORKSPACE_THEME,
};

const PANEL_STORAGE_KEY = "workspace.panels";
const ADD_TASK_PANEL_STORAGE_KEY = "workspace.projectAddTask";
const PREFERENCES_STORAGE_KEY = "workspace.preferences";
const FILTER_STORAGE_KEY = "workspace.filters";
const COLLAPSED_GROUPS_STORAGE_KEY = "workspace.collapsedGroups";
const NOTE_EDITOR_HEIGHTS_STORAGE_KEY = "workspace.noteEditorHeights";
const HIDE_DONE_TASKS_STORAGE_KEY = "workspace.hideDoneTasks";
const HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY = "workspace.personalTodos.hideDone";
const UNASSIGNED_PROJECT_TITLE = "Unassigned";
const UNASSIGNED_FILTER_VALUE = "__unassigned__";
const CONVERT_TASK_TO_PROJECT_VALUE = "__convert-task-to-project__";
const NO_TASK_ASSIGNEE_LABEL = "None";
const NO_PROJECT_OWNER_LABEL = "None";
const NO_PROJECT_OWNER_GROUP = "No owner";
const PROJECT_PICKER_HIDDEN_PROJECT_STATUSES = new Set<ProjectStatus>([
  "done",
  "on_hold",
  "canceled",
]);
const PROJECT_PICKER_SORT_OPTIONS: Array<{
  label: string;
  value: ProjectPickerSortField;
}> = [
  { label: "Alpha", value: "alpha" },
  { label: "Date", value: "date" },
  { label: "Status", value: "status" },
  { label: "Project assignee", value: "assignee" },
];
const FIBONACCI_BACKOFF_MS = [
  1_000, 1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 34_000, 55_000,
] as const;
const WORKSPACE_REFETCH_INTERVAL_MS = 15_000;

function getFibonacciBackoffMs(attempt: number) {
  if (attempt <= 1) {
    return FIBONACCI_BACKOFF_MS[0];
  }

  return FIBONACCI_BACKOFF_MS[
    Math.min(attempt - 1, FIBONACCI_BACKOFF_MS.length - 1)
  ];
}

function createDefaultWorkspaceUserConfig(): WorkspaceUserConfigWithFilters {
  return {
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
    panels: { ...DEFAULT_WORKSPACE_PANEL_STATE },
    preferences: { ...DEFAULT_WORKSPACE_PREFERENCES },
  };
}

function App() {
  const queryClient = useQueryClient();
  const [loginForm, setLoginForm] = useState<LoginPayload>(EMPTY_LOGIN_FORM);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [hasFailedLogin, setHasFailedLogin] = useState(false);
  const [passwordResetForm, setPasswordResetForm] =
    useState<PasswordResetFormState>(EMPTY_PASSWORD_RESET_FORM);
  const [passwordResetOpen, setPasswordResetOpen] = useState(false);
  const [passwordResetRequested, setPasswordResetRequested] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(
    null,
  );
  const [passwordResetNotice, setPasswordResetNotice] = useState<string | null>(
    null,
  );
  const [workspacePreferences, setWorkspacePreferences] =
    useState<WorkspacePreferences>(() =>
      normalizeWorkspacePreferences(
        readTaviStorage<Partial<WorkspacePreferences>>(
          PREFERENCES_STORAGE_KEY,
          {},
        ),
      ),
    );

  useEffect(() => {
    if (
      workspacePreferences.theme === DEFAULT_WORKSPACE_PREFERENCES.theme &&
      workspacePreferences.autoCollapse ===
        DEFAULT_WORKSPACE_PREFERENCES.autoCollapse &&
      workspacePreferences.bulkActions ===
        DEFAULT_WORKSPACE_PREFERENCES.bulkActions &&
      workspacePreferences.fullWidth === DEFAULT_WORKSPACE_PREFERENCES.fullWidth
    ) {
      removeTaviStorage(PREFERENCES_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PREFERENCES_STORAGE_KEY, workspacePreferences);
  }, [workspacePreferences]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspacePreferences.theme;
    document.documentElement.style.colorScheme =
      WORKSPACE_THEME_META[workspacePreferences.theme].colorScheme;

    return () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [workspacePreferences.theme]);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
    refetchInterval: (query) => {
      if (isApiUnavailableError(query.state.error)) {
        return getFibonacciBackoffMs(query.state.fetchFailureCount);
      }

      return query.state.data?.currentUser
        ? WORKSPACE_REFETCH_INTERVAL_MS
        : false;
    },
    refetchIntervalInBackground: true,
    retry: false,
  });
  const serverWorkspacePreferences = workspaceQuery.data
    ? normalizeWorkspacePreferences(workspaceQuery.data.userConfig?.preferences)
    : null;
  const hasCachedWorkspacePreferencesRef = useRef(
    hasTaviStorage(PREFERENCES_STORAGE_KEY),
  );

  useEffect(() => {
    if (
      !serverWorkspacePreferences ||
      hasCachedWorkspacePreferencesRef.current
    ) {
      return;
    }

    hasCachedWorkspacePreferencesRef.current = true;
    setWorkspacePreferences((current) =>
      sameWorkspacePreferences(current, serverWorkspacePreferences)
        ? current
        : serverWorkspacePreferences,
    );
  }, [serverWorkspacePreferences]);

  const handleAuthSuccess = async () => {
    setLoginError(null);
    setLoginNotice(null);
    setHasFailedLogin(false);
    setPasswordResetOpen(false);
    setPasswordResetRequested(false);
    setPasswordResetError(null);
    setPasswordResetNotice(null);
    setLoginForm(EMPTY_LOGIN_FORM);
    await queryClient.invalidateQueries({ queryKey: ["workspace"] });
  };
  const handleAuthError = (
    error: unknown,
    fallback: string,
    markFailedLogin: boolean,
  ) => {
    setHasFailedLogin(markFailedLogin);
    setLoginNotice(null);
    setLoginError(error instanceof ApiError ? error.message : fallback);
  };
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: handleAuthSuccess,
    onError: (error) => {
      handleAuthError(error, "Unable to sign in", true);
    },
  });
  const guestLoginMutation = useMutation({
    mutationFn: loginAsGuest,
    onSuccess: handleAuthSuccess,
    onError: (error) => {
      handleAuthError(error, "Unable to sign in as guest", false);
    },
  });

  const requestPasswordResetMutation = useMutation({
    mutationFn: requestPasswordReset,
    onSuccess: (_data, variables) => {
      setLoginError(null);
      setPasswordResetError(null);
      setPasswordResetRequested(true);
      setPasswordResetNotice(PASSWORD_RESET_NOTICE);
      setPasswordResetForm((current) => ({
        ...current,
        email: variables.email,
        oneTimePassword: "",
        password: "",
        passwordConfirmation: "",
      }));
    },
    onError: (error) => {
      setPasswordResetNotice(null);
      setPasswordResetError(
        error instanceof ApiError
          ? error.message
          : "Unable to send a one-time password",
      );
    },
  });

  const confirmPasswordResetMutation = useMutation({
    mutationFn: resetPasswordWithOtp,
    onSuccess: (_data, variables) => {
      setHasFailedLogin(false);
      setLoginError(null);
      setLoginNotice("Password updated. Sign in with your new password.");
      setPasswordResetError(null);
      setPasswordResetNotice(null);
      setPasswordResetOpen(false);
      setPasswordResetRequested(false);
      setPasswordResetForm({
        ...EMPTY_PASSWORD_RESET_FORM,
        email: variables.email,
      });
      setLoginForm({
        email: variables.email,
        password: "",
      });
    },
    onError: (error) => {
      setPasswordResetError(
        error instanceof ApiError
          ? error.message
          : "Unable to reset your password",
      );
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const authRequired =
    workspaceQuery.error instanceof ApiError &&
    workspaceQuery.error.status === 401;
  const localLoginHintQuery = useQuery({
    queryKey: ["localLoginHint"],
    queryFn: getLocalLoginHint,
    enabled: authRequired,
    retry: false,
  });
  const showLocalLoginHint =
    authRequired &&
    localLoginHintQuery.isSuccess &&
    !localLoginHintQuery.isFetching &&
    localLoginHintQuery.data.visible;
  const showGuestLogin =
    authRequired &&
    localLoginHintQuery.isSuccess &&
    !localLoginHintQuery.isFetching &&
    (localLoginHintQuery.data.guestEnabled ?? true);
  const showForgotPassword = hasFailedLogin;
  const authMutationPending =
    loginMutation.isPending || guestLoginMutation.isPending;

  if (workspaceQuery.isLoading) {
    return <div className="screen-state">Loading tavi...</div>;
  }

  if (authRequired) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <header className="login-header">
            <h1 className="login-brand-lockup">
              <img
                alt=""
                aria-hidden="true"
                className="brand-logo login-brand-logo"
                height="44"
                src="/logo.svg"
                width="44"
              />
              <span className="brand-mark">{BRAND_MARK}</span>
            </h1>
            <p className="login-tagline">
              <span>- short for Track And Visualize.</span>
              <span className="login-tagline-followup">
                We mostly just call it tavi.
              </span>
            </p>
          </header>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              loginMutation.mutate(loginForm);
            }}
          >
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
            </label>

            <button type="submit" disabled={authMutationPending}>
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {showForgotPassword || showGuestLogin ? (
            <div className="login-secondary-actions">
              {showGuestLogin ? (
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={authMutationPending}
                  onClick={() => {
                    setLoginError(null);
                    setLoginNotice(null);
                    guestLoginMutation.mutate();
                  }}
                >
                  {guestLoginMutation.isPending
                    ? "Opening guest view..."
                    : "View as guest"}
                </button>
              ) : null}
              {showForgotPassword ? (
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    const nextOpen = !passwordResetOpen;
                    setPasswordResetOpen(nextOpen);
                    setPasswordResetRequested(false);
                    setPasswordResetError(null);
                    setPasswordResetNotice(null);
                    setPasswordResetForm({
                      ...EMPTY_PASSWORD_RESET_FORM,
                      email: loginForm.email,
                    });
                  }}
                >
                  Forgot password
                </button>
              ) : null}
            </div>
          ) : null}

          {passwordResetOpen ? (
            <form
              className="login-form password-reset-form"
              onSubmit={(event) => {
                event.preventDefault();

                if (!passwordResetRequested) {
                  return;
                }

                if (
                  !PASSWORD_RESET_CODE_PATTERN.test(
                    passwordResetForm.oneTimePassword,
                  )
                ) {
                  setPasswordResetError(
                    "Enter the one-time password from your email",
                  );
                  return;
                }

                if (!passwordResetForm.password.trim()) {
                  setPasswordResetError("Enter a new password");
                  return;
                }

                if (
                  passwordResetForm.password !==
                  passwordResetForm.passwordConfirmation
                ) {
                  setPasswordResetError("New passwords do not match");
                  return;
                }

                setPasswordResetError(null);
                setLoginNotice(null);

                const payload: ResetPasswordWithOtpPayload = {
                  email: passwordResetForm.email,
                  oneTimePassword: passwordResetForm.oneTimePassword,
                  password: passwordResetForm.password,
                };

                confirmPasswordResetMutation.mutate(payload);
              }}
            >
              <label>
                Reset email
                <input
                  type="email"
                  value={passwordResetForm.email}
                  onChange={(event) =>
                    setPasswordResetForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>

              <button
                type="button"
                disabled={requestPasswordResetMutation.isPending}
                onClick={() => {
                  setPasswordResetError(null);
                  setLoginNotice(null);

                  const payload: RequestPasswordResetPayload = {
                    email: passwordResetForm.email,
                  };

                  requestPasswordResetMutation.mutate(payload);
                }}
              >
                {requestPasswordResetMutation.isPending
                  ? "Emailing..."
                  : passwordResetRequested
                    ? "Resend one-time password"
                    : "Email one-time password"}
              </button>

              {passwordResetRequested ? (
                <>
                  <label>
                    One-time password
                    <input
                      type="text"
                      inputMode="text"
                      autoCapitalize="characters"
                      autoComplete="off"
                      className="password-reset-code-input"
                      maxLength={9}
                      placeholder="ABCD-1234"
                      value={passwordResetForm.oneTimePassword}
                      onChange={(event) =>
                        setPasswordResetForm((current) => ({
                          ...current,
                          oneTimePassword: normalizePasswordResetCodeInput(
                            event.target.value,
                          ),
                        }))
                      }
                      onDrop={(event) => event.preventDefault()}
                      onPaste={(event) => event.preventDefault()}
                    />
                  </label>

                  <label>
                    New password
                    <input
                      type="password"
                      value={passwordResetForm.password}
                      onChange={(event) =>
                        setPasswordResetForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label>
                    Confirm password
                    <input
                      type="password"
                      value={passwordResetForm.passwordConfirmation}
                      onChange={(event) =>
                        setPasswordResetForm((current) => ({
                          ...current,
                          passwordConfirmation: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={confirmPasswordResetMutation.isPending}
                  >
                    {confirmPasswordResetMutation.isPending
                      ? "Resetting..."
                      : "Reset password"}
                  </button>
                </>
              ) : null}
            </form>
          ) : null}

          {showLocalLoginHint ? (
            <div className="login-hint">
              <strong>Local dev users</strong>
              <span>
                admin@tavi.local, editor@tavi.local, viewer@tavi.local
              </span>
              <span>Password: password123</span>
            </div>
          ) : null}

          {loginNotice ? (
            <p className="workspace-notice">{loginNotice}</p>
          ) : null}
          {passwordResetNotice ? (
            <p className="workspace-notice">{passwordResetNotice}</p>
          ) : null}
          {loginError ? <p className="error-banner">{loginError}</p> : null}
          {passwordResetError ? (
            <p className="error-banner">{passwordResetError}</p>
          ) : null}
        </section>
      </main>
    );
  }

  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <div className="screen-state error-state">
        {workspaceQuery.error instanceof Error
          ? workspaceQuery.error.message
          : "Unable to load the workspace"}
      </div>
    );
  }

  return (
    <WorkspaceScreen
      key={workspaceQuery.data.currentUser.id}
      data={workspaceQuery.data}
      onBulkActionsChange={(bulkActions) =>
        setWorkspacePreferences((current) => ({
          ...current,
          bulkActions,
        }))
      }
      onLogout={() => logoutMutation.mutate()}
      onAutoCollapseChange={(autoCollapse) =>
        setWorkspacePreferences((current) => ({
          ...current,
          autoCollapse,
        }))
      }
      onFullWidthChange={(fullWidth) =>
        setWorkspacePreferences((current) => ({
          ...current,
          fullWidth,
        }))
      }
      onReplacePreferences={setWorkspacePreferences}
      onThemeChange={(theme) =>
        setWorkspacePreferences((current) => ({
          ...current,
          theme,
        }))
      }
      preferences={workspacePreferences}
      queryClient={queryClient}
    />
  );
}

type WorkspaceScreenProps = {
  data: WorkspaceResponse;
  onBulkActionsChange: (bulkActions: boolean) => void;
  onLogout: () => void;
  onAutoCollapseChange: (autoCollapse: boolean) => void;
  onFullWidthChange: (fullWidth: boolean) => void;
  onReplacePreferences: (preferences: WorkspacePreferences) => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  preferences: WorkspacePreferences;
  queryClient: ReturnType<typeof useQueryClient>;
};

function WorkspaceScreen({
  data,
  onBulkActionsChange,
  onLogout,
  onAutoCollapseChange,
  onFullWidthChange,
  onReplacePreferences,
  onThemeChange,
  preferences,
  queryClient,
}: WorkspaceScreenProps) {
  const initialUserConfig = useMemo(
    () => normalizeWorkspaceUserConfig(data.userConfig),
    [data.userConfig],
  );
  const hasInitialCachedWorkspaceUserConfig =
    hasTaviStorage(PANEL_STORAGE_KEY) ||
    hasTaviStorage(FILTER_STORAGE_KEY) ||
    hasTaviStorage(COLLAPSED_GROUPS_STORAGE_KEY) ||
    hasTaviStorage(NOTE_EDITOR_HEIGHTS_STORAGE_KEY) ||
    hasTaviStorage(ADD_TASK_PANEL_STORAGE_KEY) ||
    hasTaviStorage(HIDE_DONE_TASKS_STORAGE_KEY) ||
    hasTaviStorage(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY);
  const hasCachedWorkspaceUserConfigRef = useRef(
    hasInitialCachedWorkspaceUserConfig,
  );
  const [panelState, setPanelState] = useState<WorkspacePanelState>(() =>
    normalizeWorkspacePanelState(
      readTaviStorage<Partial<WorkspacePanelState>>(PANEL_STORAGE_KEY, {}),
    ),
  );
  const [workspaceFilters, setWorkspaceFilters] =
    useState<WorkspaceFilterState>(() =>
      normalizeWorkspaceFilterState(
        readTaviStorage<Partial<WorkspaceFilterState>>(FILTER_STORAGE_KEY, {}),
      ),
    );
  const [collapsedGroupsByGroup, setCollapsedGroupsByGroup] =
    useState<WorkspaceCollapsedGroups>(() =>
      normalizeCollapsedGroupsByGroup(
        readTaviStorage<WorkspaceCollapsedGroups>(
          COLLAPSED_GROUPS_STORAGE_KEY,
          {},
        ),
      ),
    );
  const [noteEditorHeights, setNoteEditorHeights] = useState<NoteEditorHeights>(
    () =>
      normalizeNoteEditorHeights(
        readTaviStorage<Partial<NoteEditorHeights>>(
          NOTE_EDITOR_HEIGHTS_STORAGE_KEY,
          {},
        ),
      ),
  );
  const {
    assigneeUserIds: assigneeFilterUserIds,
    groupBy,
    notViewedOnly,
    sortBy,
    statusFilters,
  } = workspaceFilters;
  const collapsedGroups = useMemo(
    () => collapsedGroupsByGroup[groupBy] ?? {},
    [collapsedGroupsByGroup, groupBy],
  );
  const noteEditorResizeStartHeights = useRef<NoteEditorHeights>({
    project: null,
    task: null,
  });
  const workspaceSearchInputRef = useRef<HTMLInputElement | null>(null);
  const validAssigneeUserIds = useMemo(
    () => new Set(data.users.map((user) => user.id)),
    [data.users],
  );
  const effectiveAssigneeFilterUserIds = useMemo(
    () =>
      assigneeFilterUserIds.filter(
        (userId) =>
          userId === UNASSIGNED_FILTER_VALUE ||
          validAssigneeUserIds.has(userId),
      ),
    [assigneeFilterUserIds, validAssigneeUserIds],
  );
  const smtpStatusQuery = useQuery({
    enabled: data.currentUser.role === "admin",
    queryFn: getSmtpStatus,
    queryKey: ["smtp-status"],
    staleTime: 60_000,
  });
  const [search, setSearch] = useState(() =>
    readWorkspaceSearchQueryFromLocation(),
  );
  const lastSearchTaskRevealKeyRef = useRef<string | null>(null);
  const setProjectExpandedRef = useRef<
    ((projectId: string, nextValue: boolean) => void) | null
  >(null);
  const [pendingSearchTaskReveal, setPendingSearchTaskReveal] =
    useState<SearchTaskRevealTarget | null>(null);
  const [localAccountsOpen, setLocalAccountsOpen] = useState(false);
  const [adminAuditPanel, setAdminAuditPanel] =
    useState<AdminAuditReportType | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [hideDoneTasksByProject, setHideDoneTasksByProject] = useState<
    Record<string, boolean>
  >(() =>
    normalizeBooleanSelection(
      readTaviStorage<Record<string, boolean>>(HIDE_DONE_TASKS_STORAGE_KEY, {}),
    ),
  );
  const [hideDonePersonalTodos, setHideDonePersonalTodos] = useState(
    () =>
      readTaviStorage<boolean>(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY, false) ===
      true,
  );
  const [projectForm, setProjectForm] = useState<CreateProjectPayload>({
    ...EMPTY_PROJECT_FORM,
    ownerUserId: data.currentUser.id,
  });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<UpdateProjectPayload>({
    title: "",
    notes: "",
    references: "",
    ownerUserId: null,
    dueDate: "",
    priority: "medium",
    manualStatus: null,
  });
  const [projectEditError, setProjectEditError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditError, setTaskEditError] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<UpdateTaskPayload>({
    title: "",
    notes: "",
    assigneeUserId: data.currentUser.id,
    dueDate: "",
    priority: "medium",
    status: "not_started",
  });
  const [newTaskByProject, setNewTaskByProject] = useState<
    Record<string, CreateTaskPayload>
  >({});
  const [addTaskPanels, setAddTaskPanels] = useState<Record<string, boolean>>(
    () =>
      normalizeBooleanSelection(
        readTaviStorage<Record<string, boolean>>(
          ADD_TASK_PANEL_STORAGE_KEY,
          {},
        ),
      ),
  );
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(
    null,
  );
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [bulkTaskDraft, setBulkTaskDraft] = useState<BulkTaskDraft>(
    createEmptyBulkTaskDraft,
  );
  const [bulkTaskError, setBulkTaskError] = useState<string | null>(null);
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  const auditHistoryPanelRef = useRef<HTMLDivElement | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [taskDragState, setTaskDragState] = useState<TaskDragState | null>(
    null,
  );
  const [showScrollToTop, setShowScrollToTop] = useState(
    () => readViewportScrollOffset() > SCROLL_TO_TOP_VISIBILITY_OFFSET,
  );
  const canEditWorkspace = data.currentUser.role !== "viewer";
  const isGuestUser = data.currentUser.email === GUEST_USER_EMAIL;
  const appHomeUrl = getAppHomeUrl();
  const currentUserConfig = useMemo(
    () =>
      normalizeWorkspaceUserConfig({
        addTaskPanels,
        collapsedGroups: collapsedGroupsByGroup,
        filters: workspaceFilters,
        hideDonePersonalTodos,
        hideDoneTasksByProject,
        noteEditorHeights,
        panels: panelState,
        preferences,
      }),
    [
      addTaskPanels,
      collapsedGroupsByGroup,
      hideDonePersonalTodos,
      hideDoneTasksByProject,
      noteEditorHeights,
      panelState,
      preferences,
      workspaceFilters,
    ],
  );
  const syncedUserConfigRef = useRef(
    serializeWorkspaceUserConfig(initialUserConfig),
  );
  const skipNextUserConfigSyncRef = useRef(
    !hasInitialCachedWorkspaceUserConfig,
  );
  const { autoCollapse, bulkActions, fullWidth, theme } = preferences;
  const canSelectTasks = canEditWorkspace && bulkActions;
  const invalidateWorkspaceAndAudit = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  const userConfigMutation = useMutation({
    mutationFn: updateUserConfig,
    onSuccess: (_response, nextConfig) => {
      syncedUserConfigRef.current = serializeWorkspaceUserConfig(nextConfig);
      setWorkspaceNotice((current) =>
        current === USER_CONFIG_SYNC_ERROR_MESSAGE ? null : current,
      );
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        current
          ? {
              ...current,
              userConfig: nextConfig,
            }
          : current,
      );
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError
          ? `${USER_CONFIG_SYNC_ERROR_MESSAGE} ${error.message}`
          : USER_CONFIG_SYNC_ERROR_MESSAGE,
      );
    },
  });
  const syncUserConfig = userConfigMutation.mutate;
  const setGroupBy = (nextGroupBy: GroupBy) => {
    setWorkspaceFilters((current) =>
      current.groupBy === nextGroupBy
        ? current
        : {
            ...current,
            groupBy: nextGroupBy,
          },
    );
  };
  const setSortBy = (nextSortBy: ProjectSortField[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.sortBy, nextSortBy)
        ? current
        : {
            ...current,
            sortBy: nextSortBy,
          },
    );
  };
  const setStatusFilters = (nextStatusFilters: ProjectStatus[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.statusFilters, nextStatusFilters)
        ? current
        : {
            ...current,
            statusFilters: nextStatusFilters,
          },
    );
  };
  const setNotViewedOnly = (nextNotViewedOnly: boolean) => {
    setWorkspaceFilters((current) =>
      current.notViewedOnly === nextNotViewedOnly
        ? current
        : {
            ...current,
            notViewedOnly: nextNotViewedOnly,
          },
    );
  };
  const setAssigneeFilterUserIds = (nextAssigneeUserIds: string[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.assigneeUserIds, nextAssigneeUserIds)
        ? current
        : {
            ...current,
            assigneeUserIds: nextAssigneeUserIds,
          },
    );
  };
  const setCollapsedGroupsForGroupBy = useCallback((
    targetGroupBy: GroupBy,
    nextValue:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => {
    setCollapsedGroupsByGroup((current) => {
      const currentSelection = current[targetGroupBy] ?? {};
      const nextSelection = normalizeBooleanSelection(
        typeof nextValue === "function"
          ? nextValue(currentSelection)
          : nextValue,
      );

      if (sameBooleanSelection(currentSelection, nextSelection)) {
        return current;
      }

      if (Object.keys(nextSelection).length === 0) {
        if (!(targetGroupBy in current)) {
          return current;
        }

        const remainingSelections = { ...current };

        delete remainingSelections[targetGroupBy];
        return remainingSelections;
      }

      return {
        ...current,
        [targetGroupBy]: nextSelection,
      };
    });
  }, []);
  const setCollapsedGroups = useCallback((
    nextValue:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => {
    setCollapsedGroupsForGroupBy(groupBy, nextValue);
  }, [groupBy, setCollapsedGroupsForGroupBy]);
  const rememberNoteEditorHeight = (
    editorType: NoteEditorType,
    textarea: HTMLTextAreaElement,
  ) => {
    noteEditorResizeStartHeights.current[editorType] =
      readTextareaHeight(textarea);
  };
  const persistNoteEditorHeight = (
    editorType: NoteEditorType,
    textarea: HTMLTextAreaElement,
  ) => {
    const startHeight = noteEditorResizeStartHeights.current[editorType];
    const nextHeight = readTextareaHeight(textarea);

    noteEditorResizeStartHeights.current[editorType] = null;

    if (
      startHeight === null ||
      nextHeight === null ||
      startHeight === nextHeight
    ) {
      return;
    }

    setNoteEditorHeights((current) =>
      current[editorType] === nextHeight
        ? current
        : {
            ...current,
            [editorType]: nextHeight,
          },
    );
  };

  useEffect(() => {
    if (
      groupBy === "owner" &&
      !notViewedOnly &&
      sortBy.length === 0 &&
      statusFilters.length === 0 &&
      effectiveAssigneeFilterUserIds.length === 0
    ) {
      removeTaviStorage(FILTER_STORAGE_KEY);
      return;
    }

    writeTaviStorage(FILTER_STORAGE_KEY, {
      ...workspaceFilters,
      assigneeUserIds: effectiveAssigneeFilterUserIds,
    });
  }, [
    effectiveAssigneeFilterUserIds,
    groupBy,
    notViewedOnly,
    sortBy,
    statusFilters,
    workspaceFilters,
  ]);

  useEffect(() => {
    syncWorkspaceSearchQueryInLocation(search);
  }, [search]);

  useEffect(() => {
    const activeCollapsedGroups = activeCollapsedGroupsByGroup(
      collapsedGroupsByGroup,
    );

    if (Object.keys(activeCollapsedGroups).length === 0) {
      removeTaviStorage(COLLAPSED_GROUPS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(COLLAPSED_GROUPS_STORAGE_KEY, activeCollapsedGroups);
  }, [collapsedGroupsByGroup]);

  useEffect(() => {
    if (noteEditorHeights.project === null && noteEditorHeights.task === null) {
      removeTaviStorage(NOTE_EDITOR_HEIGHTS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(NOTE_EDITOR_HEIGHTS_STORAGE_KEY, noteEditorHeights);
  }, [noteEditorHeights]);

  useEffect(() => {
    const activePanels = activeBooleanSelection(panelState);

    if (Object.keys(activePanels).length === 0) {
      removeTaviStorage(PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PANEL_STORAGE_KEY, activePanels);
  }, [panelState]);

  useEffect(() => {
    if (data.currentUser.role === "admin" || !panelState.settings) {
      return;
    }

    setPanelState((current) =>
      current.settings
        ? {
            ...current,
            settings: false,
          }
        : current,
    );
  }, [data.currentUser.role, panelState.settings]);

  useEffect(() => {
    const activeAddTaskPanels = activeBooleanSelection(addTaskPanels);

    if (Object.keys(activeAddTaskPanels).length === 0) {
      removeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY, activeAddTaskPanels);
  }, [addTaskPanels]);

  useEffect(() => {
    const activeHiddenDoneTasks = activeBooleanSelection(
      hideDoneTasksByProject,
    );

    if (Object.keys(activeHiddenDoneTasks).length === 0) {
      removeTaviStorage(HIDE_DONE_TASKS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(HIDE_DONE_TASKS_STORAGE_KEY, activeHiddenDoneTasks);
  }, [hideDoneTasksByProject]);

  useEffect(() => {
    if (!hideDonePersonalTodos) {
      removeTaviStorage(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY, true);
  }, [hideDonePersonalTodos]);

  useEffect(() => {
    const serializedCurrentUserConfig =
      serializeWorkspaceUserConfig(currentUserConfig);

    if (skipNextUserConfigSyncRef.current) {
      skipNextUserConfigSyncRef.current = false;
      return;
    }

    if (serializedCurrentUserConfig === syncedUserConfigRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      syncUserConfig(currentUserConfig);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentUserConfig, syncUserConfig]);

  useEffect(() => {
    const syncScrollToTopVisibility = () => {
      setShowScrollToTop(
        readViewportScrollOffset() > SCROLL_TO_TOP_VISIBILITY_OFFSET,
      );
    };

    syncScrollToTopVisibility();
    globalThis.addEventListener("scroll", syncScrollToTopVisibility, {
      passive: true,
    });

    return () => {
      globalThis.removeEventListener("scroll", syncScrollToTopVisibility);
    };
  }, []);

  const clearSelectedTasksForProjects = (projectIds: string[]) => {
    if (projectIds.length === 0) {
      return;
    }

    const taskIdsToClear = new Set(
      data.projects
        .filter((project) => projectIds.includes(project.id))
        .flatMap((project) => project.tasks.map((task) => task.id)),
    );

    if (taskIdsToClear.size === 0) {
      return;
    }

    const hadSelectedTasks = Array.from(taskIdsToClear).some(
      (taskId) => selectedTasks[taskId],
    );

    setSelectedTasks((current) => {
      const nextSelectedTasks = { ...current };
      let changed = false;

      taskIdsToClear.forEach((taskId) => {
        if (taskId in nextSelectedTasks) {
          delete nextSelectedTasks[taskId];
          changed = true;
        }
      });

      return changed ? nextSelectedTasks : current;
    });

    if (hadSelectedTasks) {
      setBulkTaskError(null);
    }
  };
  const clearSelectedTask = (taskId: string) => {
    const hadSelectedTask = Boolean(selectedTasks[taskId]);

    setSelectedTasks((current) => {
      if (!(taskId in current)) {
        return current;
      }

      const nextSelectedTasks = { ...current };

      delete nextSelectedTasks[taskId];
      return nextSelectedTasks;
    });

    if (hadSelectedTask) {
      setBulkTaskError(null);
    }
  };
  const clearAddTaskPanelsForProjects = (projectIds: string[]) => {
    if (projectIds.length === 0) {
      return;
    }

    setAddTaskPanels((current) => {
      const nextAddTaskPanels = { ...current };
      let changed = false;

      for (const projectId of projectIds) {
        if (!(projectId in nextAddTaskPanels)) {
          continue;
        }

        delete nextAddTaskPanels[projectId];
        changed = true;
      }

      return changed ? nextAddTaskPanels : current;
    });
  };
  const clearProjectPanels = (projectId: string) => {
    setExpandedProjects((current) => {
      if (!(projectId in current)) {
        return current;
      }

      const nextExpandedProjects = { ...current };

      delete nextExpandedProjects[projectId];
      return nextExpandedProjects;
    });
    clearAddTaskPanelsForProjects([projectId]);
  };
  const revealExpandedProjectCard = (projectId: string) => {
    const reveal = () => {
      revealElementInViewport(
        document.querySelector<HTMLElement>(
          `[data-project-card-id="${projectId}"]`,
        ),
      );
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(reveal);
      return;
    }

    globalThis.setTimeout(reveal, 0);
  };
  const revealRegroupedStatusProject = async (
    previousProjectStatuses: Map<string, ProjectStatus>,
  ) => {
    await invalidateWorkspaceAndAudit();

    if (groupBy !== "status" || previousProjectStatuses.size === 0) {
      return;
    }

    const refreshedWorkspace = queryClient.getQueryData<WorkspaceResponse>([
      "workspace",
    ]);

    if (!refreshedWorkspace) {
      return;
    }

    const regroupedProjectId = findFirstRegroupedProjectId(
      previousProjectStatuses,
      refreshedWorkspace.projects,
    );

    if (!regroupedProjectId) {
      return;
    }

    revealExpandedProjectCard(regroupedProjectId);
  };
  const markCollapsedProjectsViewed = (projectIds: string[]) => {
    if (isGuestUser || projectIds.length === 0) {
      return;
    }

    const unviewedProjectIds = new Set(
      data.projects
        .filter(projectHasUnviewedChanges)
        .map((project) => project.id),
    );

    for (const projectId of projectIds) {
      if (unviewedProjectIds.has(projectId)) {
        markProjectViewedMutation.mutate(projectId);
      }
    }
  };

  const setProjectExpanded = (projectId: string, nextValue: boolean) => {
    const collapsedProjectIds = !nextValue
      ? [projectId]
      : autoCollapse
        ? Object.keys(expandedProjects).filter(
            (expandedProjectId) => expandedProjectId !== projectId,
          )
        : [];
    const shouldRevealExpandedProject =
      nextValue && autoCollapse && collapsedProjectIds.length > 0;

    clearAddTaskPanelsForProjects(collapsedProjectIds);
    markCollapsedProjectsViewed(collapsedProjectIds);

    const editingTaskProjectId = editingTaskId
      ? findProjectIdForTask(data.projects, editingTaskId)
      : null;

    if (!nextValue) {
      clearSelectedTasksForProjects(collapsedProjectIds);
    } else if (autoCollapse) {
      clearSelectedTasksForProjects(collapsedProjectIds);
    }

    if (
      editingTaskProjectId &&
      collapsedProjectIds.includes(editingTaskProjectId)
    ) {
      setTaskEditError(null);
      setEditingTaskId(null);
    }

    setExpandedProjects((current) => {
      if (!nextValue) {
        if (!current[projectId]) {
          return current;
        }

        const remaining = { ...current };

        delete remaining[projectId];
        return remaining;
      }

      if (!autoCollapse) {
        return {
          ...current,
          [projectId]: true,
        };
      }

      return {
        [projectId]: true,
      };
    });

    if (shouldRevealExpandedProject) {
      revealExpandedProjectCard(projectId);
    }
  };
  const openProjectEditor = (project: WorkspaceProject) => {
    setTaskEditError(null);
    setEditingTaskId(null);
    setProjectExpanded(project.id, true);
    setProjectEditError(null);
    setEditingProjectId(project.id);
    setProjectDraft({
      title: project.title,
      notes: project.notes ?? "",
      references: project.references ?? "",
      ownerUserId: project.ownerUserId,
      dueDate: toDateInput(project.dueDate),
      priority: project.priority,
      manualStatus: project.manualStatus,
    });
  };

  const openTaskEditor = (projectId: string, selectedTask: WorkspaceTask) => {
    setProjectExpanded(projectId, true);
    setProjectEditError(null);
    setEditingProjectId(null);
    setTaskEditError(null);
    setEditingTaskId(selectedTask.id);
    setTaskDraft({
      projectId: selectedTask.projectId,
      title: selectedTask.title,
      notes: selectedTask.notes ?? "",
      assigneeUserId: selectedTask.assigneeUserId,
      dueDate: toDateInput(selectedTask.dueDate),
      priority: selectedTask.priority,
      status: selectedTask.status,
    });
  };

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setProjectForm({
        ...EMPTY_PROJECT_FORM,
        ownerUserId: data.currentUser.id,
      });
      await invalidateWorkspaceAndAudit();
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: UpdateProjectPayload;
    }) => updateProject(projectId, payload),
    onSuccess: async () => {
      setProjectEditError(null);
      setEditingProjectId(null);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setProjectEditError(
        error instanceof ApiError ? error.message : "Unable to save project",
      );
    },
  });
  const convertProjectToTaskMutation = useMutation({
    mutationFn: async ({
      payload,
      project,
    }: {
      payload: UpdateProjectPayload;
      project: WorkspaceProject;
    }) => {
      const result = await convertProjectToTask(project.id, payload);

      return {
        ...result,
        title: payload.title ?? project.title,
      };
    },
    onSuccess: async (result, variables) => {
      setProjectEditError(null);
      setEditingProjectId(null);
      clearProjectPanels(variables.project.id);

      if (
        auditTarget?.entityType === "project" &&
        auditTarget.entityId === variables.project.id
      ) {
        setAuditTarget(null);
      }

      setProjectExpanded(result.projectId, true);
      setWorkspaceNotice(
        `Converted project "${result.title}" into a task in ${UNASSIGNED_PROJECT_TITLE}.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setProjectEditError(
        error instanceof ApiError
          ? error.message
          : "Unable to convert project into a task",
      );
    },
  });
  const deleteProjectMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: string; title: string }) =>
      deleteProject(projectId),
    onSuccess: async (result, variables) => {
      const deletedProject = data.projects.find(
        (project) => project.id === variables.projectId,
      );
      const deletedTaskIds = new Set(
        deletedProject?.tasks.map((task) => task.id) ?? [],
      );

      clearSelectedTasksForProjects([variables.projectId]);
      clearProjectPanels(variables.projectId);
      setProjectEditError(null);
      setEditingProjectId(null);

      if (editingTaskId && deletedTaskIds.has(editingTaskId)) {
        setEditingTaskId(null);
      }

      if (
        auditTarget &&
        ((auditTarget.entityType === "project" &&
          auditTarget.entityId === variables.projectId) ||
          (auditTarget.entityType === "task" &&
            deletedTaskIds.has(auditTarget.entityId)))
      ) {
        setAuditTarget(null);
      }

      setWorkspaceNotice(
        result.archivedTaskCount === 0
          ? `Deleted project "${variables.title}" from the workspace.`
          : `Deleted project "${variables.title}" and ${result.archivedTaskCount.toString()} task${result.archivedTaskCount === 1 ? "" : "s"} from the workspace.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setProjectEditError(
        error instanceof ApiError ? error.message : "Unable to delete project",
      );
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: CreateTaskPayload;
    }) => createTask(projectId, payload),
    onSuccess: async (_, variables) => {
      setProjectExpanded(variables.projectId, true);
      setAddTaskPanels((current) => ({
        ...current,
        [variables.projectId]: true,
      }));
      setNewTaskByProject((current) => ({
        ...current,
        [variables.projectId]: nextTaskPayload(
          data.currentUser.id,
          variables.payload,
        ),
      }));
      await invalidateWorkspaceAndAudit();
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      task: WorkspaceTask;
      taskId: string;
      payload: UpdateTaskPayload;
    }) => updateTask(taskId, payload),
    onSuccess: async (_, variables) => {
      const previousProjectStatuses =
        variables.payload.status === undefined || !variables.payload.projectId
          ? new Map<string, ProjectStatus>()
          : snapshotProjectDisplayStatuses(data.projects, [
              variables.payload.projectId,
            ]);

      setTaskEditError(null);
      setEditingTaskId(null);
      if (variables.payload.projectId) {
        setProjectExpanded(variables.payload.projectId, true);
      }
      if (shouldOpenReviewTaskDraft(variables.task, variables.payload)) {
        const projectId =
          variables.payload.projectId ?? variables.task.projectId;

        setNewTaskByProject((current) => ({
          ...current,
          [projectId]: buildReviewTaskDraft(
            data.currentUser.id,
            variables.task,
          ),
        }));
        setAddTaskPanels((current) => ({
          ...current,
          [projectId]: true,
        }));
      }
      await revealRegroupedStatusProject(previousProjectStatuses);
    },
    onError: (error) => {
      setTaskEditError(
        error instanceof ApiError ? error.message : "Unable to save task",
      );
    },
  });
  const convertTaskToProjectMutation = useMutation({
    mutationFn: async ({
      payload,
      task,
    }: {
      payload: Omit<UpdateTaskPayload, "projectId">;
      task: WorkspaceTask;
    }) => {
      const result = await convertTaskToProject(task.id, payload);

      return {
        ...result,
        title: payload.title ?? task.title,
      };
    },
    onSuccess: async (result, variables) => {
      setTaskEditError(null);
      setEditingTaskId(null);
      clearSelectedTask(variables.task.id);

      if (
        auditTarget?.entityType === "task" &&
        auditTarget.entityId === variables.task.id
      ) {
        setAuditTarget(null);
      }

      setProjectExpanded(result.projectId, true);
      setWorkspaceNotice(`Converted task "${result.title}" into a project.`);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to convert task into a project",
      );
    },
  });
  const deleteTaskMutation = useMutation({
    mutationFn: ({ taskId }: { taskId: string; title: string }) =>
      deleteTask(taskId),
    onSuccess: async (_, variables) => {
      setTaskEditError(null);
      setEditingTaskId(null);
      clearSelectedTask(variables.taskId);

      if (
        auditTarget?.entityType === "task" &&
        auditTarget.entityId === variables.taskId
      ) {
        setAuditTarget(null);
      }

      setWorkspaceNotice(
        `Deleted task "${variables.title}" from the workspace.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError ? error.message : "Unable to delete task",
      );
    },
  });
  const reorderProjectTasksMutation = useMutation({
    mutationFn: ({
      projectId,
      taskIds,
    }: {
      projectId: string;
      taskIds: string[];
    }) => reorderProjectTasks(projectId, { taskIds }),
    onMutate: async (variables) => {
      setWorkspaceNotice(null);
      await queryClient.cancelQueries({ queryKey: ["workspace"] });
      const previous = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);

      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        reorderWorkspaceProjectTasks(
          current,
          variables.projectId,
          variables.taskIds,
        ),
      );

      return { previous };
    },
    onSuccess: async (_result, variables) => {
      setProjectExpanded(variables.projectId, true);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["workspace"], context.previous);
      }

      setWorkspaceNotice(
        error instanceof ApiError ? error.message : "Unable to reorder tasks",
      );
    },
    onSettled: () => {
      setTaskDragState(null);
    },
  });

  const bulkUpdateTaskMutation = useMutation({
    mutationFn: bulkUpdateTasks,
    onSuccess: async (_result, variables) => {
      const previousProjectStatuses =
        variables.status === undefined
          ? new Map<string, ProjectStatus>()
          : snapshotProjectDisplayStatusesForTasks(
              data.projects,
              variables.taskIds,
            );

      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      await revealRegroupedStatusProject(previousProjectStatuses);
    },
    onError: (error) => {
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to update tasks",
      );
    },
  });
  const bulkCopyTaskMutation = useMutation({
    mutationFn: bulkCopyTasks,
    onSuccess: async (result, variables) => {
      const targetProject = data.projects.find(
        (project) => project.id === variables.targetProjectId,
      );

      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      setWorkspaceNotice(
        targetProject
          ? `Copied ${result.copiedCount.toString()} task${result.copiedCount === 1 ? "" : "s"} to "${targetProject.title}".`
          : `Copied ${result.copiedCount.toString()} task${result.copiedCount === 1 ? "" : "s"} to the selected project.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to copy tasks",
      );
    },
  });
  const bulkDeleteTaskMutation = useMutation({
    mutationFn: bulkDeleteTasks,
    onSuccess: async (result) => {
      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      setWorkspaceNotice(
        `Deleted ${result.archivedCount.toString()} task${result.archivedCount === 1 ? "" : "s"} from the workspace.`,
      );

      if (
        auditTarget?.entityType === "task" &&
        result.archivedTaskIds.includes(auditTarget.entityId)
      ) {
        setAuditTarget(null);
      }

      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to delete tasks",
      );
    },
  });

  const createSavedViewMutation = useMutation({
    mutationFn: createSavedView,
    onSuccess: async (savedView: SavedView) => {
      setSavedViewError(null);
      setSelectedSavedViewId(savedView.id);
      setSavedViewName(savedView.name);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to save view",
      );
    },
  });

  const updateSavedViewMutation = useMutation({
    mutationFn: ({
      viewId,
      payload,
    }: {
      viewId: string;
      payload: ReturnType<typeof buildSavedViewPayload>;
    }) => updateSavedView(viewId, payload),
    onSuccess: async () => {
      setSavedViewError(null);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to update view",
      );
    },
  });

  const renameSavedViewMutation = useMutation({
    mutationFn: ({ viewId, name }: { viewId: string; name: string }) =>
      renameSavedView(viewId, { name }),
    onSuccess: async (_, variables) => {
      setSavedViewError(null);
      setSavedViewName(variables.name);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to rename view",
      );
    },
  });

  const deleteSavedViewMutation = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: async (_, deletedViewId) => {
      setSavedViewError(null);

      if (selectedSavedViewId === deletedViewId) {
        setSelectedSavedViewId(null);
        setSavedViewName("");
      }

      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to delete view",
      );
    },
  });
  const markProjectViewedMutation = useMutation({
    mutationFn: markProjectViewed,
    onMutate: async (projectId: string) => {
      setWorkspaceNotice(null);
      await queryClient.cancelQueries({ queryKey: ["workspace"] });
      const previous = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        clearViewedChangesForProjects(current, [projectId], new Date()),
      );

      return { previous };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        clearViewedChangesForProjects(
          current,
          [result.projectId],
          result.viewedAt,
        ),
      );
    },
    onError: (error, _projectId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["workspace"], context.previous);
      }

      setWorkspaceNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to mark project changes viewed.",
      );
    },
  });
  const markAllProjectsViewedMutation = useMutation({
    mutationFn: async (projectIds: string[]) => ({
      ...(await markAllProjectsViewed()),
      projectIds,
    }),
    onMutate: async (projectIds: string[]) => {
      setWorkspaceNotice(null);
      await queryClient.cancelQueries({ queryKey: ["workspace"] });
      const previous = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        clearViewedChangesForProjects(current, projectIds, new Date()),
      );

      return { previous };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        clearViewedChangesForProjects(
          current,
          result.projectIds,
          result.viewedAt,
        ),
      );
      setWorkspaceNotice(
        result.projectIds.length === 0
          ? "All visible projects were already marked viewed."
          : `Marked ${result.projectIds.length.toString()} project${result.projectIds.length === 1 ? "" : "s"} viewed.`,
      );
    },
    onError: (error, _projectIds, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["workspace"], context.previous);
      }

      setWorkspaceNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to mark all changes viewed.",
      );
    },
  });

  const handleMarkAllViewed = () => {
    const unviewedProjectIds = data.projects
      .filter(projectHasUnviewedChanges)
      .map((project) => project.id);

    if (unviewedProjectIds.length > 0) {
      markAllProjectsViewedMutation.mutate(unviewedProjectIds);
    }
  };

  const filteredProjects = useMemo(
    () =>
      filterProjects({
        assigneeUserIds: effectiveAssigneeFilterUserIds,
        notViewedOnly,
        projects: data.projects,
        search,
        statusFilters,
      }),
    [
      data.projects,
      effectiveAssigneeFilterUserIds,
      notViewedOnly,
      search,
      statusFilters,
    ],
  );
  const groupedProjects = useMemo(
    () => groupProjects(filteredProjects, groupBy, sortBy),
    [filteredProjects, groupBy, sortBy],
  );
  const normalizedWorkspaceSearch = useMemo(
    () => normalizeSearchHighlightTerm(search),
    [search],
  );
  const searchTaskRevealTarget = useMemo(
    () =>
      findFirstMatchingSearchTaskTarget(
        groupedProjects,
        normalizedWorkspaceSearch,
        hideDoneTasksByProject,
      ),
    [groupedProjects, hideDoneTasksByProject, normalizedWorkspaceSearch],
  );
  const orderedProjects = useMemo(
    () => groupedProjects.flatMap((group) => group.projects),
    [groupedProjects],
  );
  const selectedSavedView = useMemo(
    () =>
      data.savedViews.find(
        (savedView) => savedView.id === selectedSavedViewId,
      ) ?? null,
    [data.savedViews, selectedSavedViewId],
  );
  const fullProjectById = useMemo(
    () =>
      Object.fromEntries(
        data.projects.map((project) => [project.id, project]),
      ) as Record<string, WorkspaceProject>,
    [data.projects],
  );
  const unviewedProjectCount = useMemo(
    () => data.projects.filter(projectHasUnviewedChanges).length,
    [data.projects],
  );
  const hiddenDoneTaskIds = useMemo(
    () =>
      new Set(
        filteredProjects.flatMap((project) =>
          hideDoneTasksByProject[project.id]
            ? project.tasks
                .filter((task) => isDoneFilterHiddenTask(task))
                .map((task) => task.id)
            : [],
        ),
      ),
    [filteredProjects, hideDoneTasksByProject],
  );
  const visibleTasks = useMemo(
    () =>
      filteredProjects.flatMap((project) =>
        hideDoneTasksByProject[project.id]
          ? project.tasks.filter((task) => !isDoneFilterHiddenTask(task))
          : project.tasks,
      ),
    [filteredProjects, hideDoneTasksByProject],
  );
  const selectedTaskItems = useMemo(
    () => visibleTasks.filter((task) => selectedTasks[task.id]),
    [selectedTasks, visibleTasks],
  );
  const selectedTaskIds = useMemo(
    () => selectedTaskItems.map((task) => task.id),
    [selectedTaskItems],
  );
  const selectedProjectCount = useMemo(
    () => new Set(selectedTaskItems.map((task) => task.projectId)).size,
    [selectedTaskItems],
  );

  useEffect(() => {
    setProjectExpandedRef.current = setProjectExpanded;
  });

  useEffect(() => {
    if (!normalizedWorkspaceSearch || !searchTaskRevealTarget) {
      lastSearchTaskRevealKeyRef.current = null;
      setPendingSearchTaskReveal(null);
      return;
    }

    const revealKey = `${normalizedWorkspaceSearch}:${searchTaskRevealTarget.taskId}`;

    if (lastSearchTaskRevealKeyRef.current === revealKey) {
      return;
    }

    lastSearchTaskRevealKeyRef.current = revealKey;
    setPendingSearchTaskReveal(searchTaskRevealTarget);

    if (collapsedGroups[searchTaskRevealTarget.groupKey]) {
      setCollapsedGroups((current) => {
        if (!current[searchTaskRevealTarget.groupKey]) {
          return current;
        }

        const nextCollapsedGroups = { ...current };

        delete nextCollapsedGroups[searchTaskRevealTarget.groupKey];
        return nextCollapsedGroups;
      });
    }

    if (
      searchTaskRevealTarget.hiddenByDoneFilter &&
      hideDoneTasksByProject[searchTaskRevealTarget.projectId]
    ) {
      setHideDoneTasksByProject((current) => ({
        ...current,
        [searchTaskRevealTarget.projectId]: false,
      }));
    }

    if (!expandedProjects[searchTaskRevealTarget.projectId]) {
      setProjectExpandedRef.current?.(searchTaskRevealTarget.projectId, true);
    }
  }, [
    collapsedGroups,
    expandedProjects,
    hideDoneTasksByProject,
    normalizedWorkspaceSearch,
    searchTaskRevealTarget,
    setCollapsedGroups,
  ]);

  useEffect(() => {
    if (!pendingSearchTaskReveal) {
      return;
    }

    if (
      collapsedGroups[pendingSearchTaskReveal.groupKey] ||
      !expandedProjects[pendingSearchTaskReveal.projectId] ||
      (pendingSearchTaskReveal.hiddenByDoneFilter &&
        hideDoneTasksByProject[pendingSearchTaskReveal.projectId])
    ) {
      return;
    }

    const reveal = () => {
      revealElementInViewport(
        findTaskRowElementById(pendingSearchTaskReveal.taskId),
      );
      setPendingSearchTaskReveal(null);
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(reveal);
      return;
    }

    globalThis.setTimeout(reveal, 0);
  }, [
    collapsedGroups,
    expandedProjects,
    hideDoneTasksByProject,
    pendingSearchTaskReveal,
  ]);

  useEffect(() => {
    if (hiddenDoneTaskIds.size === 0) {
      return;
    }

    const hasHiddenSelectedTasks = Array.from(hiddenDoneTaskIds).some(
      (taskId) => selectedTasks[taskId],
    );

    if (hasHiddenSelectedTasks) {
      setSelectedTasks((current) => {
        const nextSelection = { ...current };

        hiddenDoneTaskIds.forEach((taskId) => {
          delete nextSelection[taskId];
        });

        return nextSelection;
      });
      setBulkTaskError(null);
    }

    if (editingTaskId && hiddenDoneTaskIds.has(editingTaskId)) {
      setTaskEditError(null);
      setEditingTaskId(null);
    }
  }, [editingTaskId, hiddenDoneTaskIds, selectedTasks]);

  const userLookup = useMemo(
    () =>
      Object.fromEntries(data.users.map((user) => [user.id, user])) as Record<
        string,
        WorkspaceUser
      >,
    [data.users],
  );
  const assigneeFilterOptions = useMemo(
    () => [
      { label: "Unassigned", value: UNASSIGNED_FILTER_VALUE },
      ...data.users.map((user) => ({ label: user.name, value: user.id })),
    ],
    [data.users],
  );
  const hasBulkChanges =
    bulkTaskDraft.assigneeMode !== "keep" ||
    bulkTaskDraft.dueDateMode !== "keep" ||
    bulkTaskDraft.notesMode !== "keep" ||
    bulkTaskDraft.priority !== "" ||
    bulkTaskDraft.status !== "";
  const hasBulkCopyTarget = bulkTaskDraft.copyTargetProjectId !== "";
  const bulkTaskActionPending =
    bulkUpdateTaskMutation.isPending ||
    bulkCopyTaskMutation.isPending ||
    bulkDeleteTaskMutation.isPending;
  const stickyBulkActionsVisible =
    canSelectTasks && selectedTaskItems.length > 0;
  const auditHistoryQuery = useQuery({
    queryKey: [
      "audit",
      auditTarget?.entityType ?? "",
      auditTarget?.entityId ?? "",
    ],
    queryFn: () => {
      if (!auditTarget) {
        return Promise.resolve([]);
      }

      return getAuditHistory(auditTarget.entityType, auditTarget.entityId, 25);
    },
    enabled: auditTarget !== null,
  });

  useEffect(() => {
    if (
      auditTarget?.entityType !== "project" &&
      auditTarget?.entityType !== "task"
    ) {
      return;
    }

    auditHistoryPanelRef.current?.scrollIntoView({
      block: "start",
      inline: "nearest",
    });
  }, [auditTarget]);

  const applySavedView = (savedView: SavedView) => {
    setGroupBy(savedView.groupBy);
    setSearch(savedView.search);
    setSortBy(savedView.sortBy);
    setStatusFilters(savedView.statusFilters);
    setAssigneeFilterUserIds(savedView.assigneeUserIds);
    setCollapsedGroupsForGroupBy(
      savedView.groupBy,
      toSelectionMap(savedView.collapsedGroupKeys),
    );
    setExpandedProjects(toSelectionMap(savedView.expandedProjectIds));
    setSelectedSavedViewId(savedView.id);
    setSavedViewName(savedView.name);
    setSavedViewError(null);
  };

  const openAuditHistory = (nextTarget: AuditTarget) => {
    setAuditTarget(nextTarget);
  };

  const clearBulkTaskSelection = () => {
    setBulkTaskError(null);
    setSelectedTasks({});
    setBulkTaskDraft(createEmptyBulkTaskDraft());
  };

  const handleBulkActionsChange = (nextBulkActions: boolean) => {
    if (!nextBulkActions) {
      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
    }

    onBulkActionsChange(nextBulkActions);
  };

  const toggleWorkspacePanel = (panel: keyof WorkspacePanelState) => {
    setWorkspaceNotice(null);
    setPanelState((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };
  const setWorkspacePanelOpen = (
    panel: keyof WorkspacePanelState,
    isOpen: boolean,
  ) => {
    setWorkspaceNotice(null);
    setPanelState((current) =>
      current[panel] === isOpen
        ? current
        : {
            ...current,
            [panel]: isOpen,
          },
    );
  };

  const setAddTaskPanelOpen = (projectId: string, nextValue: boolean) => {
    setWorkspaceNotice(null);
    setAddTaskPanels((current) => {
      if (!nextValue) {
        const remaining = { ...current };

        delete remaining[projectId];
        return remaining;
      }

      return {
        ...current,
        [projectId]: true,
      };
    });
  };

  const applyUserConfigState = useCallback(
    (nextConfig: WorkspaceUserConfig) => {
      skipNextUserConfigSyncRef.current = true;
      syncedUserConfigRef.current = serializeWorkspaceUserConfig(nextConfig);
      setWorkspaceFilters(normalizeWorkspaceFilterState(nextConfig.filters));
      setCollapsedGroupsByGroup(
        normalizeCollapsedGroupsByGroup(nextConfig.collapsedGroups),
      );
      setPanelState(normalizeWorkspacePanelState(nextConfig.panels));
      setAddTaskPanels(normalizeBooleanSelection(nextConfig.addTaskPanels));
      setHideDoneTasksByProject(
        normalizeBooleanSelection(nextConfig.hideDoneTasksByProject),
      );
      setHideDonePersonalTodos(nextConfig.hideDonePersonalTodos === true);
      setNoteEditorHeights(
        normalizeNoteEditorHeights(nextConfig.noteEditorHeights),
      );
      onReplacePreferences(
        normalizeWorkspacePreferences(nextConfig.preferences),
      );
    },
    [onReplacePreferences],
  );

  useEffect(() => {
    if (hasCachedWorkspaceUserConfigRef.current) {
      return;
    }

    applyUserConfigState(initialUserConfig);
  }, [applyUserConfigState, initialUserConfig]);

  const resetUserSettingsMutation = useMutation({
    mutationFn: resetUserSettings,
    onSuccess: (result) => {
      const clearedKeyCount = clearTaviStorage();

      applyUserConfigState(result.userConfig);
      queryClient.setQueryData(
        ["notification-preferences"],
        result.notificationPreferences,
      );
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        current
          ? {
              ...current,
              userConfig: result.userConfig,
            }
          : current,
      );
      setWorkspaceNotice(
        clearedKeyCount === 0
          ? "Reset all user settings to defaults. The browser cache was already clear."
          : `Reset all user settings to defaults and cleared ${clearedKeyCount.toString()} cached Tavi preference${clearedKeyCount === 1 ? "" : "s"}.`,
      );
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to reset your user settings.",
      );
    },
  });
  const handleResetUserSettings = () => {
    if (resetUserSettingsMutation.isPending) {
      return;
    }

    if (
      !window.confirm(
        "Reset all server-backed and browser-cached user settings for this account to their defaults?",
      )
    ) {
      return;
    }

    resetUserSettingsMutation.mutate();
  };

  const applyBulkTaskChanges = () => {
    if (selectedTaskIds.length === 0 || !hasBulkChanges) {
      return;
    }

    if (bulkTaskDraft.dueDateMode === "set" && !bulkTaskDraft.dueDate) {
      setBulkTaskError("Choose a due date or clear it");
      return;
    }

    setBulkTaskError(null);
    bulkUpdateTaskMutation.mutate({
      ...buildBulkTaskPayload(bulkTaskDraft),
      taskIds: selectedTaskIds,
    });
  };

  const deleteSelectedTasks = () => {
    if (selectedTaskIds.length === 0) {
      return;
    }

    setWorkspaceNotice(null);
    setBulkTaskError(null);
    bulkDeleteTaskMutation.mutate({
      taskIds: selectedTaskIds,
    });
  };

  const copySelectedTasks = () => {
    if (selectedTaskIds.length === 0) {
      return;
    }

    if (!bulkTaskDraft.copyTargetProjectId) {
      setBulkTaskError("Choose a project to copy into");
      return;
    }

    setWorkspaceNotice(null);
    setBulkTaskError(null);
    bulkCopyTaskMutation.mutate({
      targetProjectId: bulkTaskDraft.copyTargetProjectId,
      taskIds: selectedTaskIds,
    });
  };
  const copyProjectSearchLink = async (projectTitle: string) => {
    const projectLink = buildWorkspaceSearchLink(appHomeUrl, projectTitle);

    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== "function") {
        throw new Error("Clipboard access unavailable");
      }

      await globalThis.navigator.clipboard.writeText(projectLink);
      setWorkspaceNotice(
        `Copied project link for "${projectTitle}" to clipboard.`,
      );
    } catch {
      setWorkspaceNotice(
        `Browser blocked clipboard access. Copy this project link manually: ${projectLink}`,
      );
    }
  };

  const clearWorkspaceSearch = () => {
    setSearch("");
    workspaceSearchInputRef.current?.focus();
  };

  return (
    <main
      className={`workspace-shell${fullWidth ? " workspace-shell--full-width" : ""}`}
    >
      <header className="workspace-header">
        <div className="workspace-branding">
          <a className="workspace-brand-link" href={appHomeUrl}>
            <img
              alt=""
              aria-hidden="true"
              className="brand-logo"
              height="36"
              src="/logo.svg"
              width="36"
            />
            <span className="brand-mark">{BRAND_MARK}</span>
          </a>
        </div>

        <div className="header-actions">
          {isGuestUser ? (
            <span className="header-user">{data.currentUser.name}</span>
          ) : (
            <button
              type="button"
              className={`header-user header-user-button${panelState.profile ? " is-active" : ""}`}
              aria-pressed={panelState.profile}
              onClick={() =>
                setWorkspacePanelOpen("profile", !panelState.profile)
              }
            >
              {data.currentUser.name}
            </button>
          )}
          <button type="button" className="ghost-button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="workspace-controls">
        <div className="workspace-controls-row">
          <div className="workspace-filter-row">
            <div className="workspace-filter search-filter">
              <input
                ref={workspaceSearchInputRef}
                aria-label="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects and tasks"
              />
              {search.length > 0 ? (
                <button
                  type="button"
                  className="search-filter-clear"
                  aria-label="Clear search"
                  onClick={clearWorkspaceSearch}
                >
                  x
                </button>
              ) : null}
            </div>

            <div className="workspace-filter">
              <select
                aria-label="Group by"
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
              >
                {Object.entries(GROUP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <MultiSelectFilter
              label="Status"
              options={PROJECT_STATUS_FILTER_OPTIONS}
              selectedValues={statusFilters}
              onChange={(nextValues) =>
                setStatusFilters(nextValues.filter(isProjectStatus))
              }
            />

            <MultiSelectFilter
              label="Assignee"
              options={assigneeFilterOptions}
              selectedValues={effectiveAssigneeFilterUserIds}
              onChange={setAssigneeFilterUserIds}
            />

            <MultiSortFilter
              label="Sort by"
              options={PROJECT_SORT_OPTIONS}
              selectedValues={sortBy}
              onChange={setSortBy}
            />
          </div>

          <div className="workspace-panel-toggles">
            {!isGuestUser ? (
              <>
                <button
                  type="button"
                  className={`ghost-button compact-button panel-toggle-button${panelState.view ? " is-active" : ""}`}
                  aria-pressed={panelState.view}
                  onClick={() => toggleWorkspacePanel("view")}
                >
                  View
                </button>
                <button
                  type="button"
                  className={`ghost-button compact-button panel-toggle-button${panelState.newProject ? " is-active" : ""}`}
                  aria-pressed={panelState.newProject}
                  disabled={!canEditWorkspace}
                  onClick={() => toggleWorkspacePanel("newProject")}
                >
                  New Project
                </button>
              </>
            ) : null}
            {data.currentUser.role === "admin" && !isGuestUser ? (
              <button
                type="button"
                className={`ghost-button compact-button panel-toggle-button${panelState.settings ? " is-active" : ""}`}
                aria-pressed={panelState.settings}
                onClick={() => toggleWorkspacePanel("settings")}
              >
                Settings
              </button>
            ) : null}
          </div>
        </div>

        {workspaceNotice ? (
          <p className="workspace-notice">{workspaceNotice}</p>
        ) : null}

        {!canEditWorkspace ? (
          <p className="toolbar-hint">
            {isGuestUser
              ? "Guest access is read-only for shared projects and tasks."
              : "Viewer access is read-only for shared projects and tasks. Personal ToDo, filters, saved views, and audit history remain available."}
          </p>
        ) : null}

        <div className="workspace-panel-stack">
          {panelState.profile && !isGuestUser ? (
            <ProfilePanel
              autoCollapse={autoCollapse}
              bulkActions={bulkActions}
              currentUser={data.currentUser}
              fullWidth={fullWidth}
              isAdmin={data.currentUser.role === "admin"}
              isImportExportOpen={panelState.importExport}
              isPersonalTodoOpen={panelState.personalTodo}
              isUserHistoryOpen={
                auditTarget?.entityType === "auth" &&
                auditTarget.entityId === data.currentUser.id
              }
              onAutoCollapseChange={onAutoCollapseChange}
              onBulkActionsChange={handleBulkActionsChange}
              onResetUserSettings={handleResetUserSettings}
              onClose={() => setWorkspacePanelOpen("profile", false)}
              onFullWidthChange={onFullWidthChange}
              onNotice={setWorkspaceNotice}
              onThemeChange={onThemeChange}
              onToggleImportExportPanel={() =>
                toggleWorkspacePanel("importExport")
              }
              onTogglePersonalTodoPanel={() => {
                toggleWorkspacePanel("personalTodo");
                setWorkspacePanelOpen("profile", false);
              }}
              onToggleUserHistory={() => {
                if (
                  auditTarget?.entityType === "auth" &&
                  auditTarget.entityId === data.currentUser.id
                ) {
                  setAuditTarget(null);
                  setWorkspacePanelOpen("profile", false);
                  return;
                }

                openAuditHistory({
                  emptyMessage: "No sign-in events yet for this account.",
                  entityId: data.currentUser.id,
                  entityType: "auth",
                  subtitle: data.currentUser.email,
                  title: "User History",
                });
                setWorkspacePanelOpen("profile", false);
              }}
              theme={theme}
            />
          ) : null}

          {panelState.view && !isGuestUser ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>Views</strong>
                  <span>
                    Save search, grouping, task filters, and expansion defaults.
                  </span>
                </div>
              </header>

              <div className="saved-view-grid">
                <label>
                  My view
                  <select
                    value={selectedSavedViewId ?? ""}
                    onChange={(event) => {
                      const nextSavedView = data.savedViews.find(
                        (savedView) => savedView.id === event.target.value,
                      );

                      if (!nextSavedView) {
                        setSelectedSavedViewId(null);
                        setSavedViewName("");
                        setSavedViewError(null);
                        return;
                      }

                      applySavedView(nextSavedView);
                    }}
                  >
                    <option value="">Current workspace</option>
                    {data.savedViews.map((savedView) => (
                      <option key={savedView.id} value={savedView.id}>
                        {savedView.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  View name
                  <input
                    value={savedViewName}
                    onChange={(event) => {
                      setSavedViewName(event.target.value);
                      setSavedViewError(null);
                    }}
                    placeholder="Sprint review"
                  />
                </label>

                <div className="saved-view-current-search">
                  <span>Current Search</span>
                  <strong>{search.trim().length > 0 ? search : "No search"}</strong>
                </div>
              </div>

              <div className="saved-view-panel view-panel-controls">
                <header className="panel-header">
                  <div>
                    <strong>Viewed changes</strong>
                    <span>
                      Focus on projects with unviewed task changes or clear them
                      when the workspace is caught up.
                    </span>
                  </div>
                </header>

                <div className="view-panel-actions">
                  <button
                    type="button"
                    className={`workspace-filter-toggle${notViewedOnly ? " is-active" : ""}`}
                    aria-pressed={notViewedOnly}
                    onClick={() => setNotViewedOnly(!notViewedOnly)}
                    title={
                      unviewedProjectCount === 1
                        ? "Show the 1 project with unviewed task changes"
                        : `Show ${unviewedProjectCount.toString()} projects with unviewed task changes`
                    }
                  >
                    Not viewed
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={
                      unviewedProjectCount === 0 ||
                      markAllProjectsViewedMutation.isPending
                    }
                    onClick={handleMarkAllViewed}
                  >
                    {markAllProjectsViewedMutation.isPending
                      ? "Marking..."
                      : "Mark all viewed"}
                  </button>
                </div>
              </div>

              <div className="saved-view-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!selectedSavedView}
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    openAuditHistory({
                      emptyMessage: "No saved-view changes recorded yet.",
                      entityId: selectedSavedView.id,
                      entityType: "saved_view",
                      subtitle: "Personal workspace layout",
                      title: `View history · ${selectedSavedView.name}`,
                    });
                  }}
                >
                  History
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !savedViewName.trim() || createSavedViewMutation.isPending
                  }
                  onClick={() => {
                    createSavedViewMutation.mutate({
                      name: savedViewName.trim(),
                      ...buildSavedViewPayload({
                        assigneeUserIds: effectiveAssigneeFilterUserIds,
                        groupBy,
                        search,
                        sortBy,
                        statusFilters,
                        collapsedGroups,
                        expandedProjects,
                      }),
                    });
                  }}
                >
                  {createSavedViewMutation.isPending ? "Saving..." : "Save new"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !selectedSavedView || updateSavedViewMutation.isPending
                  }
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    updateSavedViewMutation.mutate({
                      viewId: selectedSavedView.id,
                      payload: buildSavedViewPayload({
                        assigneeUserIds: effectiveAssigneeFilterUserIds,
                        groupBy,
                        search,
                        sortBy,
                        statusFilters,
                        collapsedGroups,
                        expandedProjects,
                      }),
                    });
                  }}
                >
                  {updateSavedViewMutation.isPending ? "Updating..." : "Update"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !selectedSavedView ||
                    !savedViewName.trim() ||
                    renameSavedViewMutation.isPending ||
                    savedViewName.trim() === selectedSavedView.name
                  }
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    renameSavedViewMutation.mutate({
                      viewId: selectedSavedView.id,
                      name: savedViewName.trim(),
                    });
                  }}
                >
                  {renameSavedViewMutation.isPending ? "Renaming..." : "Rename"}
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={
                    !selectedSavedView || deleteSavedViewMutation.isPending
                  }
                  onClick={() => {
                    if (selectedSavedView) {
                      deleteSavedViewMutation.mutate(selectedSavedView.id);
                    }
                  }}
                >
                  {deleteSavedViewMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>

              {savedViewError ? (
                <p className="error-banner">{savedViewError}</p>
              ) : null}
            </section>
          ) : null}

          {panelState.personalTodo && !isGuestUser ? (
            <PersonalTodoPanel
              hideDoneTodos={hideDonePersonalTodos}
              onClose={() => setWorkspacePanelOpen("personalTodo", false)}
              onHideDoneChange={setHideDonePersonalTodos}
              onNotice={setWorkspaceNotice}
              personalTodos={data.personalTodos}
            />
          ) : null}

          {panelState.newProject && canEditWorkspace && !isGuestUser ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>New project</strong>
                  <span>Create a project without leaving the workspace.</span>
                </div>
              </header>

              <form
                className="inline-form project-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  createProjectMutation.mutate(
                    normalizeCreateProjectPayload(projectForm),
                  );
                }}
              >
                <input
                  value={projectForm.title}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="New project title"
                />
                <textarea
                  value={projectForm.notes ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className="resizable-notes"
                  placeholder="Notes"
                  rows={2}
                />
                <textarea
                  value={projectForm.references ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      references: event.target.value,
                    }))
                  }
                  className="resizable-notes"
                  placeholder="References (one per line)"
                  rows={2}
                />
                <select
                  value={projectForm.ownerUserId ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      ownerUserId: event.target.value || null,
                    }))
                  }
                >
                  <option value="">{NO_PROJECT_OWNER_LABEL}</option>
                  {data.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                <select
                  value={projectForm.priority}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      priority: event.target.value as Priority,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input
                  type="date"
                  value={projectForm.dueDate}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
                <button
                  type="submit"
                  disabled={createProjectMutation.isPending}
                >
                  Add project
                </button>
              </form>
            </section>
          ) : null}

          {panelState.settings && !isGuestUser ? (
            <SettingsPanel
              adminAuditPanel={adminAuditPanel}
              isBackupsOpen={panelState.backups}
              isAdmin={data.currentUser.role === "admin"}
              isImportExportOpen={panelState.importExport}
              isLocalAccountsOpen={localAccountsOpen}
              onToggleAdminAuditPanel={(panel) => {
                setAdminAuditPanel((current) =>
                  current === panel ? null : panel,
                );
                setWorkspacePanelOpen("settings", false);
              }}
              onToggleBackupsPanel={() => {
                toggleWorkspacePanel("backups");
                setWorkspacePanelOpen("settings", false);
              }}
              onToggleImportExportPanel={() => {
                toggleWorkspacePanel("importExport");
                setWorkspacePanelOpen("settings", false);
              }}
              onToggleLocalAccounts={() => {
                setLocalAccountsOpen((current) => !current);
                setWorkspacePanelOpen("settings", false);
              }}
              onToggleRetentionPanel={() => {
                setRetentionOpen((current) => !current);
                setWorkspacePanelOpen("settings", false);
              }}
              retentionOpen={retentionOpen}
              smtpStatus={smtpStatusQuery.data}
            />
          ) : null}

          {panelState.importExport ? (
            <>
              <ExportPanel
                assigneeUserIds={effectiveAssigneeFilterUserIds}
                groupBy={groupBy}
                onClose={() => toggleWorkspacePanel("importExport")}
                onNotice={setWorkspaceNotice}
                projects={orderedProjects}
                search={search}
                sortBy={sortBy}
                statusFilters={statusFilters}
              />

              {data.currentUser.role === "admin" ? (
                <ImportPanel
                  isAdmin={data.currentUser.role === "admin"}
                  onClose={() => toggleWorkspacePanel("importExport")}
                  onNotice={setWorkspaceNotice}
                  queryClient={queryClient}
                />
              ) : (
                <section className="workspace-panel-card">
                  <header className="panel-header">
                    <div>
                      <strong>Import</strong>
                      <span>
                        Loop CSV staging remains admin-only in this build.
                      </span>
                    </div>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() => toggleWorkspacePanel("importExport")}
                      >
                        Close
                      </button>
                    </div>
                  </header>

                  <p className="toolbar-hint">
                    Ask an admin to stage imports while export wiring lands.
                  </p>
                </section>
              )}
            </>
          ) : null}

          {panelState.backups ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>Backups</strong>
                  <span>
                    Configure scheduled snapshots and preview restore changes.
                  </span>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => toggleWorkspacePanel("backups")}
                  >
                    Close
                  </button>
                </div>
              </header>

              <BackupSettingsCard
                onNotice={setWorkspaceNotice}
                variant="panel"
              />
            </section>
          ) : null}

          {localAccountsOpen ? (
            <LocalAccountsPanel
              currentUser={data.currentUser}
              isAdmin={data.currentUser.role === "admin"}
              onClose={() => setLocalAccountsOpen(false)}
              onNotice={setWorkspaceNotice}
              emailEnabled={smtpStatusQuery.data?.enabled ?? true}
              smtpConfigured={smtpStatusQuery.data?.configured ?? false}
            />
          ) : null}

          {retentionOpen ? (
            <RetentionSettingsPanel onClose={() => setRetentionOpen(false)} />
          ) : null}

          {data.currentUser.role === "admin" && adminAuditPanel ? (
            <AdminAuditReportPanel
              currentUser={data.currentUser}
              onClose={() => setAdminAuditPanel(null)}
              type={adminAuditPanel}
              users={data.users}
            />
          ) : null}
        </div>
      </section>

      {stickyBulkActionsVisible ? (
        <section className="bulk-action-card bulk-action-card--sticky">
          <div className="bulk-action-header">
            <div>
              <strong>
                {selectedTaskItems.length} selected task
                {selectedTaskItems.length === 1 ? "" : "s"}
              </strong>
              <span>
                {selectedProjectCount} project
                {selectedProjectCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="bulk-action-buttons">
              <button
                type="button"
                className="ghost-button"
                onClick={clearBulkTaskSelection}
                disabled={bulkTaskActionPending}
              >
                Clear
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={deleteSelectedTasks}
                disabled={bulkTaskActionPending}
              >
                {bulkDeleteTaskMutation.isPending ? "Deleting..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={copySelectedTasks}
                disabled={!hasBulkCopyTarget || bulkTaskActionPending}
              >
                {bulkCopyTaskMutation.isPending ? "Copying..." : "Copy"}
              </button>
              <button
                type="button"
                disabled={!hasBulkChanges || bulkTaskActionPending}
                onClick={applyBulkTaskChanges}
              >
                {bulkUpdateTaskMutation.isPending ? "Applying..." : "Apply"}
              </button>
            </div>
          </div>

          <div className="bulk-action-grid">
            <label>
              Status
              <select
                value={bulkTaskDraft.status}
                onChange={(event) => {
                  const nextStatus = event.target.value as TaskStatus | "";

                  setBulkTaskDraft((current) => ({
                    ...current,
                    status: nextStatus,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                {TASK_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Assignee
              <select
                value={
                  bulkTaskDraft.assigneeMode === "keep"
                    ? ""
                    : bulkTaskDraft.assigneeMode === "clear"
                      ? BULK_CLEAR_ASSIGNEE_VALUE
                      : bulkTaskDraft.assigneeUserId
                }
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setBulkTaskDraft((current) => ({
                    ...current,
                    assigneeMode:
                      nextValue === ""
                        ? "keep"
                        : nextValue === BULK_CLEAR_ASSIGNEE_VALUE
                          ? "clear"
                          : "set",
                    assigneeUserId:
                      nextValue === "" ||
                      nextValue === BULK_CLEAR_ASSIGNEE_VALUE
                        ? ""
                        : nextValue,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                <option value={BULK_CLEAR_ASSIGNEE_VALUE}>
                  {NO_TASK_ASSIGNEE_LABEL}
                </option>
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                value={bulkTaskDraft.priority}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    priority: event.target.value as Priority | "",
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label>
              Due date
              <input
                type="date"
                value={bulkTaskDraft.dueDate}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                    dueDateMode: event.target.value ? "set" : "keep",
                  }));
                  setBulkTaskError(null);
                }}
              />
            </label>

            <label>
              Notes
              <select
                value={bulkTaskDraft.notesMode}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    notesMode: event.target.value as "keep" | "clear",
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="keep">No change</option>
                <option value="clear">Clear notes</option>
              </select>
            </label>

            <div className="project-picker-field">
              <span>Copy to project</span>
              <ProjectPickerControl
                currentUser={data.currentUser}
                label="Copy to project"
                onChange={(projectId) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    copyTargetProjectId: projectId,
                  }));
                  setBulkTaskError(null);
                }}
                projects={data.projects}
                selectedProjectId={bulkTaskDraft.copyTargetProjectId}
                users={userLookup}
              />
            </div>

            <div className="bulk-date-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    dueDate: "",
                    dueDateMode: "clear",
                  }));
                  setBulkTaskError(null);
                }}
              >
                Clear due date
              </button>
              {bulkTaskDraft.dueDateMode === "clear" ? (
                <span className="status-note">Due date will be removed</span>
              ) : null}
            </div>
          </div>

          {bulkTaskError ? (
            <p className="error-banner">{bulkTaskError}</p>
          ) : null}
        </section>
      ) : null}

      {auditTarget ? (
        <div ref={auditHistoryPanelRef}>
          <AuditHistoryPanel
            currentUser={data.currentUser}
            emptyMessage={auditTarget.emptyMessage}
            errorMessage={
              auditHistoryQuery.error instanceof Error
                ? auditHistoryQuery.error.message
                : null
            }
            events={auditHistoryQuery.data ?? []}
            isError={auditHistoryQuery.isError}
            isLoading={auditHistoryQuery.isLoading}
            onClose={() => setAuditTarget(null)}
            subtitle={auditTarget.subtitle}
            title={auditTarget.title}
            users={userLookup}
          />
        </div>
      ) : null}

      {groupedProjects.map((group) => (
        <section className="group-card" key={group.key}>
          <header
            className="group-header"
            onClick={(event) => {
              if (!shouldToggleProjectFromRowClick(event)) {
                return;
              }

              setCollapsedGroups((current) => ({
                ...current,
                [group.key]: !current[group.key],
              }));
            }}
          >
            <button
              type="button"
              className="group-toggle"
              onClick={() =>
                setCollapsedGroups((current) => ({
                  ...current,
                  [group.key]: !current[group.key],
                }))
              }
            >
              {collapsedGroups[group.key] ? "+" : "-"}
            </button>
            <div>
              <h2>{group.key}</h2>
              <p>
                {group.projects.length} projects /{" "}
                {group.projects.reduce(
                  (total, project) => total + project.tasks.length,
                  0,
                )}{" "}
                tasks
              </p>
            </div>
          </header>

          {!collapsedGroups[group.key] ? (
            <div className="project-list">
              {group.projects.map((project) => {
                const expanded = expandedProjects[project.id] ?? false;
                const fullProject = fullProjectById[project.id] ?? project;
                const hideDoneTasks =
                  hideDoneTasksByProject[project.id] ?? false;
                const showDoneTasks = !hideDoneTasks;
                const addTaskOpen = addTaskPanels[project.id] ?? false;
                const taskDraftValue =
                  newTaskByProject[project.id] ??
                  defaultTaskPayload(data.currentUser.id);
                const doneFilterProjectTaskIds = project.tasks
                  .filter((task) => isDoneFilterHiddenTask(task))
                  .map((task) => task.id);
                const tasksAreFiltered =
                  fullProject.tasks.length !== project.tasks.length;
                const visibleProjectTasks = hideDoneTasks
                  ? project.tasks.filter(
                      (task) => !isDoneFilterHiddenTask(task),
                    )
                  : project.tasks;
                const projectTaskIds = visibleProjectTasks.map(
                  (task) => task.id,
                );
                const showTaskReorderColumn =
                  canEditWorkspace &&
                  (data.workspaceSettings?.dragHandlesEnabled ?? true);
                const taskTableColumnCount =
                  (canSelectTasks ? 1 : 0) +
                  (showTaskReorderColumn ? 1 : 0) +
                  6;
                const taskReorderDisabledReason = !showTaskReorderColumn
                  ? null
                  : reorderProjectTasksMutation.isPending
                    ? "Saving task order..."
                    : tasksAreFiltered
                      ? "Clear task filters to reorder tasks."
                      : fullProject.tasks.length < 2
                        ? "At least two tasks are required to reorder."
                        : null;
                const canReorderProjectTasks =
                  taskReorderDisabledReason === null;
                const activeTaskDragState =
                  taskDragState?.projectId === project.id
                    ? taskDragState
                    : null;
                const selectedProjectTaskCount = projectTaskIds.filter(
                  (taskId) => selectedTasks[taskId],
                ).length;
                const allProjectTasksSelected =
                  projectTaskIds.length > 0 &&
                  selectedProjectTaskCount === projectTaskIds.length;
                const editingProjectTask =
                  editingTaskId && project.tasks.some((task) => task.id === editingTaskId)
                    ? project.tasks.find((task) => task.id === editingTaskId) ??
                      null
                    : null;

                const projectCardClassName = `project-card${
                  expanded ? " project-card--expanded" : ""
                }${
                  project.hasUnviewedChanges === true
                    ? " project-card--unviewed"
                    : ""
                }${
                  expanded || editingProjectId === project.id || addTaskOpen
                    ? ""
                    : " project-card--collapsed"
                }`;

                return (
                  <article
                    className={projectCardClassName}
                    data-project-card-id={project.id}
                    key={project.id}
                  >
                    <div
                      className="project-row"
                      onClick={(event) => {
                        if (
                          canEditWorkspace &&
                          shouldOpenEditorFromModifierClick(event)
                        ) {
                          openProjectEditor(project);
                          return;
                        }

                        if (shouldToggleProjectFromRowClick(event)) {
                          setProjectExpanded(project.id, !expanded);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="group-toggle"
                        onClick={() =>
                          setProjectExpanded(project.id, !expanded)
                        }
                      >
                        {expanded ? "-" : "+"}
                      </button>

                      <div className="project-main">
                        <strong>
                          <SearchHighlightedText
                            search={search}
                            text={project.title}
                          />
                        </strong>
                        <NotesMarkdown
                          className="formatted-notes formatted-notes--project"
                          emptyLabel="No notes"
                          highlight={search}
                          value={project.notes}
                        />
                      </div>

                      <div className="project-status">
                        <span
                          className={`status-pill status-${project.displayStatus}`}
                          title={formatProjectStatusPillLabel(
                            project.displayStatus,
                            project.manualStatus,
                          )}
                        >
                          {formatProjectStatusPillLabel(
                            project.displayStatus,
                            project.manualStatus,
                          )}
                        </span>
                        {project.manualStatus ? (
                          <>
                            <span className="status-note">
                              Derived:{" "}
                              {formatStatusLabel(project.derivedStatus)}
                            </span>
                          </>
                        ) : null}
                      </div>

                      <div className="project-meta">
                        <span
                          className="project-owner-pill"
                          title={formatProjectOwnerLabel(project.ownerName)}
                        >
                          {formatProjectOwnerLabel(project.ownerName)}
                        </span>
                        <span
                          className={`priority-pill priority-${project.priority}`}
                        >
                          {formatPriorityLabel(project.priority)}
                        </span>
                        <span className="project-progress">
                          {formatTaskCompletionPercent(
                            project.taskDoneCount,
                            project.taskTotalCount,
                          )}
                        </span>
                        <span className="project-due-date">
                          {formatDate(project.dueDate)}
                        </span>
                        {parseProjectReferences(project.references).map(
                          (reference, index) => {
                            const referenceHref =
                              toProjectReferenceHref(reference);
                            const referenceLabel =
                              formatProjectReferenceLabel(reference);

                            return referenceHref ? (
                              <a
                                key={`${project.id}-reference-${index.toString()}`}
                                className="project-reference project-reference-link"
                                href={referenceHref}
                                rel="noopener noreferrer"
                                target="_blank"
                                title={reference}
                              >
                                <SearchHighlightedText
                                  search={search}
                                  text={referenceLabel}
                                />{" "}
                                ↗
                              </a>
                            ) : (
                              <span
                                key={`${project.id}-reference-${index.toString()}`}
                                className="project-reference project-reference-text"
                                title={reference}
                              >
                                <SearchHighlightedText
                                  search={search}
                                  text={reference}
                                />
                              </span>
                            );
                          },
                        )}
                      </div>

                      <div className="project-row-actions">
                        {canEditWorkspace && project.manualStatus ? (
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => {
                              setProjectEditError(null);
                              updateProjectMutation.mutate({
                                projectId: project.id,
                                payload: {
                                  manualStatus: null,
                                },
                              });
                            }}
                          >
                            Clear override
                          </button>
                        ) : null}

                        {canEditWorkspace ? (
                          <button
                            type="button"
                            className={`ghost-button compact-button panel-toggle-button${addTaskOpen ? " is-active" : ""}`}
                            aria-pressed={addTaskOpen}
                            onClick={() => {
                              if (!expanded && !addTaskOpen) {
                                setProjectExpanded(project.id, true);
                              }

                              setAddTaskPanelOpen(project.id, !addTaskOpen);
                            }}
                          >
                            Add Task
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="ghost-button compact-button"
                          onClick={() =>
                            openAuditHistory({
                              emptyMessage: "No project changes recorded yet.",
                              entityId: project.id,
                              entityType: "project",
                              subtitle: formatProjectOwnerLabel(
                                project.ownerName,
                              ),
                              title: `Project history · ${project.title}`,
                            })
                          }
                        >
                          History
                        </button>

                        <button
                          type="button"
                          className="ghost-button compact-button"
                          onClick={() => {
                            void copyProjectSearchLink(project.title);
                          }}
                        >
                          Link
                        </button>

                        {canEditWorkspace ? (
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => openProjectEditor(project)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {canEditWorkspace && editingProjectId === project.id ? (
                      <ProjectEditModal
                        data={data}
                        draft={projectDraft}
                        error={projectEditError}
                        isConverting={convertProjectToTaskMutation.isPending}
                        isDeleting={deleteProjectMutation.isPending}
                        isSaving={updateProjectMutation.isPending}
                        noteEditorHeight={noteEditorHeights.project}
                        onCancel={() => {
                          setProjectEditError(null);
                          setEditingProjectId(null);
                        }}
                        onConvert={() =>
                          convertProjectToTaskMutation.mutate({
                            project,
                            payload: normalizeProjectDraftPayload(projectDraft),
                          })
                        }
                        onDelete={() => {
                          if (
                            !window.confirm(
                              `Delete project "${project.title}" and remove its ${project.taskTotalCount.toString()} task${project.taskTotalCount === 1 ? "" : "s"} from the workspace?`,
                            )
                          ) {
                            return;
                          }

                          deleteProjectMutation.mutate({
                            projectId: project.id,
                            title: project.title,
                          });
                        }}
                        onNotesPointerDown={(textarea) =>
                          rememberNoteEditorHeight("project", textarea)
                        }
                        onNotesPointerUp={(textarea) =>
                          persistNoteEditorHeight("project", textarea)
                        }
                        onSave={() =>
                          updateProjectMutation.mutate({
                            projectId: project.id,
                            payload: normalizeProjectDraftPayload(projectDraft),
                          })
                        }
                        project={project}
                        setDraft={setProjectDraft}
                      />
                    ) : null}

                    {expanded ? (
                      <div className="task-panel">
                        <table className="task-table">
                          <thead>
                            <tr>
                              {canSelectTasks ? (
                                <th className="task-select-column">
                                  <input
                                    aria-label={`Select all tasks in ${project.title}`}
                                    checked={allProjectTasksSelected}
                                    onChange={(event) => {
                                      setSelectedTasks((current) => ({
                                        ...current,
                                        ...Object.fromEntries(
                                          projectTaskIds.map((taskId) => [
                                            taskId,
                                            event.target.checked,
                                          ]),
                                        ),
                                      }));
                                      setBulkTaskError(null);
                                    }}
                                    type="checkbox"
                                  />
                                </th>
                              ) : null}
                              {showTaskReorderColumn ? (
                                <th
                                  className="task-reorder-column"
                                  aria-hidden="true"
                                />
                              ) : null}
                              <th>Task</th>
                              <th>Assignee</th>
                              <th>
                                <span className="task-status-heading">
                                  <span>Status</span>
                                  <button
                                    type="button"
                                    className="ghost-button compact-button task-done-toggle"
                                    aria-label={
                                      showDoneTasks
                                        ? `Hide done and canceled tasks in ${project.title}`
                                        : `Show done and canceled tasks in ${project.title}`
                                    }
                                    aria-pressed={showDoneTasks}
                                    disabled={
                                      doneFilterProjectTaskIds.length === 0
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setHideDoneTasksByProject((current) => {
                                        const nextSelection = { ...current };

                                        if (nextSelection[project.id]) {
                                          delete nextSelection[project.id];
                                        } else {
                                          nextSelection[project.id] = true;
                                        }

                                        return nextSelection;
                                      });
                                    }}
                                    title={
                                      doneFilterProjectTaskIds.length === 0
                                        ? "No done or canceled tasks"
                                        : showDoneTasks
                                          ? "Hide done and canceled tasks"
                                          : "Show done and canceled tasks"
                                    }
                                  >
                                    D
                                  </button>
                                </span>
                              </th>
                              <th>Priority</th>
                              <th>Due</th>
                              <th className="task-action-header">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {canEditWorkspace && addTaskOpen ? (
                              <tr className="task-create-row">
                                {canSelectTasks ? (
                                  <td className="task-select-cell" />
                                ) : null}
                                {showTaskReorderColumn ? (
                                  <td className="task-reorder-cell task-reorder-cell--spacer" />
                                ) : null}
                                <td>
                                  <div className="task-create-field">
                                    <input
                                      value={taskDraftValue.title}
                                      onChange={(event) =>
                                        setNewTaskByProject((current) => ({
                                          ...current,
                                          [project.id]: {
                                            ...taskDraftValue,
                                            title: event.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="New task title"
                                    />
                                    <textarea
                                      value={taskDraftValue.notes ?? ""}
                                      onChange={(event) =>
                                        setNewTaskByProject((current) => ({
                                          ...current,
                                          [project.id]: {
                                            ...taskDraftValue,
                                            notes: event.target.value,
                                          },
                                        }))
                                      }
                                      className="resizable-notes task-create-notes"
                                      onPointerDown={(event) =>
                                        rememberNoteEditorHeight(
                                          "task",
                                          event.currentTarget,
                                        )
                                      }
                                      onPointerUp={(event) =>
                                        persistNoteEditorHeight(
                                          "task",
                                          event.currentTarget,
                                        )
                                      }
                                      placeholder="Task notes"
                                      rows={2}
                                      style={toTextareaStyle(
                                        noteEditorHeights.task,
                                      )}
                                    />
                                  </div>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.assigneeUserId ?? ""}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          assigneeUserId:
                                            event.target.value || null,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">
                                      {NO_TASK_ASSIGNEE_LABEL}
                                    </option>
                                    {data.users.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.status}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          status: event.target
                                            .value as TaskStatus,
                                        },
                                      }))
                                    }
                                  >
                                    {TASK_STATUS_OPTIONS.map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.priority}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          priority: event.target
                                            .value as Priority,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="date"
                                    value={taskDraftValue.dueDate}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          dueDate: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </td>
                                <td className="task-action-cell">
                                  <button
                                    type="button"
                                    className="compact-button"
                                    disabled={
                                      !taskDraftValue.title.trim() ||
                                      createTaskMutation.isPending
                                    }
                                    onClick={() =>
                                      createTaskMutation.mutate({
                                        projectId: project.id,
                                        payload: {
                                          ...taskDraftValue,
                                          title: taskDraftValue.title.trim(),
                                        },
                                      })
                                    }
                                  >
                                    {createTaskMutation.isPending
                                      ? "Adding..."
                                      : "Add"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button compact-button"
                                    onClick={() => {
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: defaultTaskPayload(
                                          data.currentUser.id,
                                        ),
                                      }));
                                      setAddTaskPanelOpen(project.id, false);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </td>
                              </tr>
                            ) : null}
                            {visibleProjectTasks.map((task) => (
                              <TaskRow
                                canEditTask={canEditWorkspace}
                                canReorderTask={canReorderProjectTasks}
                                canSelectTasks={canSelectTasks}
                                dragHandleTitle={
                                  taskReorderDisabledReason ?? "Drag to reorder"
                                }
                                hasUnviewedChanges={
                                  task.hasUnviewedChanges === true
                                }
                                editingTaskId={editingTaskId}
                                isSelected={selectedTasks[task.id] ?? false}
                                isTaskDragging={
                                  activeTaskDragState?.taskId === task.id
                                }
                                key={task.id}
                                onEdit={(selectedTask) =>
                                  openTaskEditor(project.id, selectedTask)
                                }
                                onFinishTaskDrag={() => {
                                  setTaskDragState((current) =>
                                    current?.projectId === project.id
                                      ? null
                                      : current,
                                  );
                                }}
                                onPreviewTaskDrop={(position) => {
                                  setTaskDragState((current) => {
                                    if (
                                      !current ||
                                      current.projectId !== project.id ||
                                      current.taskId === task.id
                                    ) {
                                      return current;
                                    }

                                    if (
                                      current.overTaskId === task.id &&
                                      current.position === position
                                    ) {
                                      return current;
                                    }

                                    return {
                                      ...current,
                                      overTaskId: task.id,
                                      position,
                                    };
                                  });
                                }}
                                onStartTaskDrag={() => {
                                  if (!canReorderProjectTasks) {
                                    return;
                                  }

                                  setTaskDragState({
                                    overTaskId: task.id,
                                    position: "before",
                                    projectId: project.id,
                                    taskId: task.id,
                                  });
                                }}
                                onSubmitTaskDrop={(position) => {
                                  if (
                                    !canReorderProjectTasks ||
                                    !activeTaskDragState ||
                                    activeTaskDragState.taskId === task.id
                                  ) {
                                    setTaskDragState((current) =>
                                      current?.projectId === project.id
                                        ? null
                                        : current,
                                    );
                                    return;
                                  }

                                  const currentTaskIds = fullProject.tasks.map(
                                    (currentTask) => currentTask.id,
                                  );
                                  const nextTaskIds = moveTaskIdRelative(
                                    currentTaskIds,
                                    activeTaskDragState.taskId,
                                    task.id,
                                    position,
                                  );

                                  if (
                                    sameStringArray(currentTaskIds, nextTaskIds)
                                  ) {
                                    setTaskDragState((current) =>
                                      current?.projectId === project.id
                                        ? null
                                        : current,
                                    );
                                    return;
                                  }

                                  reorderProjectTasksMutation.mutate({
                                    projectId: project.id,
                                    taskIds: nextTaskIds,
                                  });
                                }}
                                onToggleSelected={(checked) => {
                                  setSelectedTasks((current) => ({
                                    ...current,
                                    [task.id]: checked,
                                  }));
                                  setBulkTaskError(null);
                                }}
                                onViewHistory={() =>
                                  openAuditHistory({
                                    emptyMessage:
                                      "No task changes recorded for this task yet.",
                                    entityId: task.id,
                                    entityType: "task",
                                    subtitle: project.title,
                                    title: `Task history · ${task.title}`,
                                  })
                                }
                                reorderIndicator={
                                  activeTaskDragState?.taskId !== task.id &&
                                  activeTaskDragState?.overTaskId === task.id
                                    ? activeTaskDragState.position
                                    : null
                                }
                                showReorderHandle={showTaskReorderColumn}
                                search={search}
                                task={task}
                              />
                            ))}
                            {hideDoneTasks &&
                            project.tasks.length > 0 &&
                            visibleProjectTasks.length === 0 ? (
                              <tr className="task-empty-row">
                                <td colSpan={taskTableColumnCount}>
                                  Done and canceled tasks are hidden. Use D to
                                  show them.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {editingProjectTask ? (
                      <TaskEditModal
                        data={data}
                        draft={taskDraft}
                        error={taskEditError}
                        noteEditorHeight={noteEditorHeights.task}
                        onCancel={() => {
                          setTaskEditError(null);
                          setEditingTaskId(null);
                        }}
                        onDelete={() => {
                          if (
                            !window.confirm(
                              `Delete task "${editingProjectTask.title}" from the workspace?`,
                            )
                          ) {
                            return;
                          }

                          deleteTaskMutation.mutate({
                            taskId: editingProjectTask.id,
                            title: editingProjectTask.title,
                          });
                        }}
                        onNotesPointerDown={(textarea) =>
                          rememberNoteEditorHeight("task", textarea)
                        }
                        onNotesPointerUp={(textarea) =>
                          persistNoteEditorHeight("task", textarea)
                        }
                        onSave={() => {
                          const normalizedPayload =
                            normalizeTaskDraftPayload(taskDraft);

                          setTaskEditError(null);

                          if (
                            normalizedPayload.projectId ===
                            CONVERT_TASK_TO_PROJECT_VALUE
                          ) {
                            convertTaskToProjectMutation.mutate({
                              payload: {
                                assigneeUserId: normalizedPayload.assigneeUserId,
                                dueDate: normalizedPayload.dueDate,
                                notes: normalizedPayload.notes,
                                priority: normalizedPayload.priority,
                                status: normalizedPayload.status,
                                title: normalizedPayload.title,
                              },
                              task: editingProjectTask,
                            });
                            return;
                          }

                          updateTaskMutation.mutate({
                            task: editingProjectTask,
                            taskId: editingProjectTask.id,
                            payload: normalizedPayload,
                          });
                        }}
                        setDraft={setTaskDraft}
                        task={editingProjectTask}
                        userLookup={userLookup}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}
      {showScrollToTop ? (
        <button
          type="button"
          className="ghost-button compact-button scroll-to-top-button"
          onClick={() => {
            globalThis.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }}
        >
          To top
        </button>
      ) : null}
    </main>
  );
}

type ProjectEditModalProps = {
  data: WorkspaceResponse;
  draft: UpdateProjectPayload;
  error: string | null;
  isConverting: boolean;
  isDeleting: boolean;
  isSaving: boolean;
  noteEditorHeight: number | null;
  onCancel: () => void;
  onConvert: () => void;
  onDelete: () => void;
  onNotesPointerDown: (textarea: HTMLTextAreaElement) => void;
  onNotesPointerUp: (textarea: HTMLTextAreaElement) => void;
  onSave: () => void;
  project: WorkspaceProject;
  setDraft: React.Dispatch<React.SetStateAction<UpdateProjectPayload>>;
};

function ProjectEditModal({
  data,
  draft,
  error,
  isConverting,
  isDeleting,
  isSaving,
  noteEditorHeight,
  onCancel,
  onConvert,
  onDelete,
  onNotesPointerDown,
  onNotesPointerUp,
  onSave,
  project,
  setDraft,
}: ProjectEditModalProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const busy = isSaving || isConverting || isDeleting;

  return (
    <Modal
      className="modal-dialog--wide"
      disableDismiss={busy}
      initialFocusRef={titleInputRef}
      inline
      onClose={onCancel}
      subtitle={formatProjectOwnerLabel(project.ownerName)}
      title={`Edit project · ${project.title}`}
      footer={
        <div className="modal-actions modal-actions--split">
          <div className="modal-danger-actions">
            <button
              type="button"
              className="ghost-button modal-delete-button"
              disabled={busy}
              onClick={onDelete}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={
                busy || !canConvertProjectToTask(project, draft)
              }
              title={projectConvertToTaskNote(project, draft) ?? undefined}
              onClick={onConvert}
            >
              {isConverting ? "Converting..." : "Convert to Task"}
            </button>
          </div>
          <div className="modal-primary-actions">
            <button type="submit" form="project-edit-modal-form" disabled={busy}>
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      }
    >
      <form
        id="project-edit-modal-form"
        className="modal-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {error ? (
          <p className="error-banner modal-field-wide">{error}</p>
        ) : null}
        <label className="modal-field-wide">
          Title
          <input
            ref={titleInputRef}
            value={draft.title ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            placeholder="Project title"
          />
        </label>
        <label className="modal-field-wide">
          Notes
          <textarea
            value={draft.notes ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            className="resizable-notes"
            onPointerDown={(event) => onNotesPointerDown(event.currentTarget)}
            onPointerUp={(event) => onNotesPointerUp(event.currentTarget)}
            placeholder="Project notes"
            rows={4}
            style={toTextareaStyle(noteEditorHeight)}
          />
        </label>
        <label>
          Status override
          <select
            value={draft.manualStatus ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                manualStatus: event.target.value
                  ? (event.target.value as ProjectStatus)
                  : null,
              }))
            }
          >
            <option value="">Derived from tasks</option>
            {PROJECT_STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select
            value={draft.ownerUserId ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                ownerUserId: event.target.value || null,
              }))
            }
          >
            <option value="">{NO_PROJECT_OWNER_LABEL}</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={draft.priority ?? "medium"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: event.target.value as Priority,
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Due date
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
        </label>
        <label className="modal-field-wide">
          References
          <textarea
            value={draft.references ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                references: event.target.value,
              }))
            }
            className="resizable-notes project-references-input"
            placeholder="References (one per line)"
            rows={2}
          />
        </label>
      </form>
    </Modal>
  );
}

type TaskRowProps = {
  canEditTask: boolean;
  canReorderTask: boolean;
  canSelectTasks: boolean;
  dragHandleTitle: string;
  hasUnviewedChanges: boolean;
  editingTaskId: string | null;
  isSelected: boolean;
  isTaskDragging: boolean;
  onEdit: (task: WorkspaceTask) => void;
  onFinishTaskDrag: () => void;
  onPreviewTaskDrop: (position: TaskDropPosition) => void;
  onStartTaskDrag: () => void;
  onSubmitTaskDrop: (position: TaskDropPosition) => void;
  onToggleSelected: (checked: boolean) => void;
  onViewHistory: () => void;
  reorderIndicator: TaskDropPosition | null;
  search: string;
  showReorderHandle: boolean;
  task: WorkspaceTask;
};

type TaskEditModalProps = {
  data: WorkspaceResponse;
  draft: UpdateTaskPayload;
  error: string | null;
  noteEditorHeight: number | null;
  onCancel: () => void;
  onDelete: () => void;
  onNotesPointerDown: (textarea: HTMLTextAreaElement) => void;
  onNotesPointerUp: (textarea: HTMLTextAreaElement) => void;
  onSave: () => void;
  setDraft: React.Dispatch<React.SetStateAction<UpdateTaskPayload>>;
  task: WorkspaceTask;
  userLookup: Record<string, WorkspaceUser>;
};

function TaskEditModal({
  data,
  draft,
  error,
  noteEditorHeight,
  onCancel,
  onDelete,
  onNotesPointerDown,
  onNotesPointerUp,
  onSave,
  setDraft,
  task,
  userLookup,
}: TaskEditModalProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const selectedProjectId = draft.projectId ?? task.projectId;
  const isConvertingToProject =
    selectedProjectId === CONVERT_TASK_TO_PROJECT_VALUE;

  return (
    <Modal
      className="modal-dialog--wide"
      initialFocusRef={titleInputRef}
      inline
      onClose={onCancel}
      subtitle={task.assigneeName ?? NO_TASK_ASSIGNEE_LABEL}
      title={`Edit task · ${task.title}`}
      footer={
        <div className="modal-actions modal-actions--split">
          <div className="modal-danger-actions">
            <button
              type="button"
              className="ghost-button modal-delete-button"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
          <div className="modal-primary-actions">
            <button type="submit" form="task-edit-modal-form">
              {isConvertingToProject ? "Convert" : "Save"}
            </button>
            <button type="button" className="ghost-button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      }
    >
      <form
        id="task-edit-modal-form"
        className="modal-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {error ? (
          <p className="error-banner modal-field-wide">{error}</p>
        ) : null}
        <label className="modal-field-wide">
          Title
          <input
            ref={titleInputRef}
            value={draft.title ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            placeholder="Task title"
          />
        </label>
        <label className="modal-field-wide">
          Notes
          <textarea
            value={draft.notes ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            className="resizable-notes"
            onPointerDown={(event) => onNotesPointerDown(event.currentTarget)}
            onPointerUp={(event) => onNotesPointerUp(event.currentTarget)}
            placeholder="Task notes"
            rows={4}
            style={toTextareaStyle(noteEditorHeight)}
          />
        </label>
        <div className="modal-field-wide">
          <ProjectPickerControl
            currentUser={data.currentUser}
            includeConvertToProject
            label="Project"
            onChange={(projectId) =>
              setDraft((current) => ({
                ...current,
                projectId,
              }))
            }
            projects={data.projects}
            selectedProjectId={selectedProjectId}
            users={userLookup}
          />
        </div>
        <label>
          Assignee
          <select
            aria-label="Assignee"
            value={draft.assigneeUserId ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                assigneeUserId: event.target.value || null,
              }))
            }
          >
            <option value="">{NO_TASK_ASSIGNEE_LABEL}</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={draft.status ?? "not_started"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value as TaskStatus,
              }))
            }
          >
            {TASK_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={draft.priority ?? "medium"}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: event.target.value as Priority,
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Due date
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
        </label>
      </form>
    </Modal>
  );
}

function TaskRow({
  canEditTask,
  canReorderTask,
  canSelectTasks,
  dragHandleTitle,
  hasUnviewedChanges,
  editingTaskId,
  isSelected,
  isTaskDragging,
  onEdit,
  onFinishTaskDrag,
  onPreviewTaskDrop,
  onStartTaskDrag,
  onSubmitTaskDrop,
  onToggleSelected,
  onViewHistory,
  reorderIndicator,
  search,
  showReorderHandle,
  task,
}: TaskRowProps) {
  const rowClassName = [
    hasUnviewedChanges ? "task-row--unviewed" : null,
    editingTaskId === task.id ? "task-row--editing" : null,
    isTaskDragging ? "task-row--dragging" : null,
    reorderIndicator === "before" ? "task-row--drop-before" : null,
    reorderIndicator === "after" ? "task-row--drop-after" : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return (
    <>
      <tr
        className={rowClassName || undefined}
        data-task-row-id={task.id}
        onClick={(event) => {
          if (canEditTask && shouldOpenEditorFromModifierClick(event)) {
            onEdit(task);
          }
        }}
        onDragOver={(event) => {
          if (!canReorderTask) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onPreviewTaskDrop(readTaskDropPosition(event));
        }}
        onDrop={(event) => {
          if (!canReorderTask) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          onSubmitTaskDrop(readTaskDropPosition(event));
        }}
      >
        {canSelectTasks ? (
          <td className="task-select-cell">
            <input
              aria-label={`Select task ${task.title}`}
              checked={isSelected}
              onChange={(event) => onToggleSelected(event.target.checked)}
              type="checkbox"
            />
          </td>
        ) : null}
        {showReorderHandle ? (
          <td className="task-reorder-cell">
            <button
              type="button"
              className={`ghost-button compact-button task-reorder-handle${
                isTaskDragging ? " is-active" : ""
              }`}
              aria-label={`Drag to reorder ${task.title}`}
              title={dragHandleTitle}
              disabled={!canReorderTask}
              draggable={canReorderTask}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDragStart={(event) => {
                if (!canReorderTask) {
                  return;
                }

                event.stopPropagation();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", task.id);
                onStartTaskDrag();
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                onFinishTaskDrag();
              }}
            >
              ::
            </button>
          </td>
        ) : null}
        <td>
          <strong>
            <SearchHighlightedText search={search} text={task.title} />
          </strong>
          <NotesMarkdown
            className="formatted-notes formatted-notes--task task-subtext"
            emptyLabel="No notes"
            highlight={search}
            value={task.notes}
          />
        </td>
        <td>{task.assigneeName ?? NO_TASK_ASSIGNEE_LABEL}</td>
        <td>
          <span className={`status-pill status-${task.status}`}>
            {formatStatusLabel(task.status)}
          </span>
        </td>
        <td>{task.priority}</td>
        <td>{formatDate(task.dueDate)}</td>
        <td className="task-action-cell">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onViewHistory}
          >
            History
          </button>
          {canEditTask ? (
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={() => onEdit(task)}
            >
              Edit
            </button>
          ) : null}
        </td>
      </tr>
    </>
  );
}
function settingsCardButtonProps(action: () => void) {
  return {
    onClick: action,
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    },
    role: "button" as const,
    tabIndex: 0,
  };
}

type ProfilePanelProps = {
  autoCollapse: boolean;
  bulkActions: boolean;
  currentUser: WorkspaceUser;
  fullWidth: boolean;
  isAdmin: boolean;
  isImportExportOpen: boolean;
  isPersonalTodoOpen: boolean;
  isUserHistoryOpen: boolean;
  onAutoCollapseChange: (autoCollapse: boolean) => void;
  onBulkActionsChange: (bulkActions: boolean) => void;
  onResetUserSettings: () => void;
  onClose: () => void;
  onFullWidthChange: (fullWidth: boolean) => void;
  onNotice: (message: string) => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  onToggleImportExportPanel: () => void;
  onTogglePersonalTodoPanel: () => void;
  onToggleUserHistory: () => void;
  theme: WorkspaceTheme;
};

type ProfileEditModalProps = {
  currentPasswordDraft: string;
  currentUser: WorkspaceUser;
  emailDraft: string;
  error: string | null;
  isSaving: boolean;
  nameDraft: string;
  onCancel: () => void;
  onSave: () => void;
  passwordConfirmation: string;
  passwordDraft: string;
  setCurrentPasswordDraft: React.Dispatch<React.SetStateAction<string>>;
  setEmailDraft: React.Dispatch<React.SetStateAction<string>>;
  setNameDraft: React.Dispatch<React.SetStateAction<string>>;
  setPasswordConfirmation: React.Dispatch<React.SetStateAction<string>>;
  setPasswordDraft: React.Dispatch<React.SetStateAction<string>>;
};

function ProfileEditModal({
  currentPasswordDraft,
  currentUser,
  emailDraft,
  error,
  isSaving,
  nameDraft,
  onCancel,
  onSave,
  passwordConfirmation,
  passwordDraft,
  setCurrentPasswordDraft,
  setEmailDraft,
  setNameDraft,
  setPasswordConfirmation,
  setPasswordDraft,
}: ProfileEditModalProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <Modal
      disableDismiss={isSaving}
      initialFocusRef={nameInputRef}
      inline
      onClose={onCancel}
      subtitle={currentUser.email}
      title="Edit user profile"
      footer={
        <div className="modal-actions">
          <button
            type="submit"
            form="profile-edit-modal-form"
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={isSaving}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      }
    >
      <form
        id="profile-edit-modal-form"
        className="modal-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {error ? (
          <p className="error-banner modal-field-wide">{error}</p>
        ) : null}
        <label>
          Name
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            placeholder="Your name"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={emailDraft}
            onChange={(event) => setEmailDraft(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Current password
          <input
            type="password"
            value={currentPasswordDraft}
            onChange={(event) => setCurrentPasswordDraft(event.target.value)}
            placeholder="Current password"
          />
        </label>
        <label>
          Change password
          <input
            type="password"
            value={passwordDraft}
            onChange={(event) => setPasswordDraft(event.target.value)}
            placeholder="New password"
          />
        </label>
        <label>
          Repeat password
          <input
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            placeholder="Repeat new password"
          />
        </label>
      </form>
    </Modal>
  );
}

function ProfilePanel({
  autoCollapse,
  bulkActions,
  currentUser,
  fullWidth,
  isAdmin,
  isImportExportOpen,
  isPersonalTodoOpen,
  isUserHistoryOpen,
  onAutoCollapseChange,
  onBulkActionsChange,
  onResetUserSettings,
  onClose,
  onFullWidthChange,
  onNotice,
  onThemeChange,
  onToggleImportExportPanel,
  onTogglePersonalTodoPanel,
  onToggleUserHistory,
  theme,
}: ProfilePanelProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(currentUser.name);
  const [emailDraft, setEmailDraft] = useState(currentUser.email);
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [digestPrefError, setDigestPrefError] = useState<string | null>(null);
  const [dailyDigestTimeDraft, setDailyDigestTimeDraft] = useState(() =>
    utcTimeToLocalTime(DEFAULT_DAILY_DIGEST_TIME_UTC),
  );
  const notificationPreferencesQuery = useQuery({
    queryFn: getNotificationPreferences,
    queryKey: ["notification-preferences"],
    staleTime: 60_000,
  });
  const dailyDigestEnabled =
    notificationPreferencesQuery.data?.dailyDigestEnabled ?? false;
  const notificationRate: NotificationRate = dailyDigestEnabled
    ? "daily"
    : "hourly";
  const configuredDigestTimeUtc =
    notificationPreferencesQuery.data?.dailyDigestTime ??
    DEFAULT_DAILY_DIGEST_TIME_UTC;
  const configuredDigestTimeLocal = useMemo(
    () => utcTimeToLocalTime(configuredDigestTimeUtc),
    [configuredDigestTimeUtc],
  );
  const personalTodoRetention =
    notificationPreferencesQuery.data?.personalTodoRetention ?? "never";
  const localTimeZoneLabel = useMemo(() => getLocalTimeZoneLabel(), []);
  const currentThemeLabel = getWorkspaceThemeLabel(theme);
  const nextTheme = getNextWorkspaceTheme(theme);
  const nextThemeLabel = getWorkspaceThemeLabel(nextTheme);
  const resetProfileDraft = () => {
    setNameDraft(currentUser.name);
    setEmailDraft(currentUser.email);
    setCurrentPasswordDraft("");
    setPasswordDraft("");
    setPasswordConfirmation("");
    setProfileError(null);
  };
  useEffect(() => {
    setDailyDigestTimeDraft(configuredDigestTimeLocal);
  }, [configuredDigestTimeLocal]);

  const notificationPreferencesMutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onMutate: async (variables) => {
      setDigestPrefError(null);
      const previous = queryClient.getQueryData<NotificationPreferences>([
        "notification-preferences",
      ]);
      queryClient.setQueryData<NotificationPreferences>(
        ["notification-preferences"],
        (current) => ({
          dailyDigestEnabled:
            variables.dailyDigestEnabled ??
            current?.dailyDigestEnabled ??
            false,
          dailyDigestTime:
            variables.dailyDigestTime ??
            current?.dailyDigestTime ??
            configuredDigestTimeUtc,
          personalTodoRetention:
            variables.personalTodoRetention ??
            current?.personalTodoRetention ??
            "never",
          personalTodoRemindersEnabled:
            variables.personalTodoRemindersEnabled ??
            current?.personalTodoRemindersEnabled ??
            true,
        }),
      );
      return { previous };
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(["notification-preferences"], preferences);
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["notification-preferences"],
          context.previous,
        );
      }
      setDigestPrefError(
        error instanceof ApiError
          ? error.message
          : "Unable to update personal preferences.",
      );
    },
  });
  const saveNotificationRate = (rate: NotificationRate) => {
    if (
      notificationPreferencesMutation.isPending ||
      notificationPreferencesQuery.isPending
    ) {
      return;
    }

    notificationPreferencesMutation.mutate({
      dailyDigestEnabled: rate === "daily",
    });
  };
  const saveDailyDigestTime = () => {
    if (
      notificationPreferencesMutation.isPending ||
      notificationPreferencesQuery.isPending
    ) {
      return;
    }

    notificationPreferencesMutation.mutate({
      dailyDigestTime: localTimeToUtcTime(dailyDigestTimeDraft),
    });
  };
  const updateProfileMutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: async ({ account }) => {
      setProfileError(null);
      setIsEditing(false);
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        current
          ? {
              ...current,
              currentUser: {
                ...current.currentUser,
                email: account.email,
                name: account.name,
                role: account.role,
              },
              users: current.users.map((user) =>
                user.id === account.id
                  ? {
                      ...user,
                      email: account.email,
                      name: account.name,
                      role: account.role,
                    }
                  : user,
              ),
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      resetProfileDraft();
      onNotice("Updated your profile.");
      onClose();
    },
    onError: (error) => {
      setProfileError(
        error instanceof ApiError
          ? error.message
          : "Unable to update your profile.",
      );
    },
  });
  const submitProfile = () => {
    const trimmedName = nameDraft.trim();
    const trimmedEmail = emailDraft.trim();
    const hasPasswordInput =
      currentPasswordDraft.trim().length > 0 ||
      passwordDraft.trim().length > 0 ||
      passwordConfirmation.trim().length > 0;

    if (!trimmedName) {
      setProfileError("Enter your name");
      return;
    }

    if (!trimmedEmail) {
      setProfileError("Enter your email");
      return;
    }

    if (hasPasswordInput) {
      if (!currentPasswordDraft.trim()) {
        setProfileError("Enter your current password");
        return;
      }

      if (!passwordDraft.trim()) {
        setProfileError("Enter a new password");
        return;
      }

      if (passwordDraft !== passwordConfirmation) {
        setProfileError("Passwords must match");
        return;
      }
    }

    const payload: UpdateOwnProfilePayload = {};

    if (trimmedName !== currentUser.name) {
      payload.name = trimmedName;
    }

    if (trimmedEmail !== currentUser.email) {
      payload.email = trimmedEmail;
    }

    if (hasPasswordInput) {
      payload.currentPassword = currentPasswordDraft;
      payload.password = passwordDraft;
    }

    if (Object.keys(payload).length === 0) {
      setIsEditing(false);
      resetProfileDraft();
      onClose();
      return;
    }

    setProfileError(null);
    updateProfileMutation.mutate(payload);
  };
  const beginEditing = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resetProfileDraft();
    queueMicrotask(() => setIsEditing(true));
  };

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>User Profile</strong>
          <span>
            Your account details, self-service password changes, and personal
            workspace preferences.
          </span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <div className="settings-item settings-item-wide">
          <div className="settings-item-header">
            <strong>Account</strong>
            <span>{currentUser.role}</span>
          </div>

          <div className="profile-form">
            <div className="profile-form-grid">
              <label>
                Name
                <span className="profile-summary-value">
                  {currentUser.name}
                </span>
              </label>
              <label>
                Email
                <span className="profile-summary-value">
                  {currentUser.email}
                </span>
              </label>
            </div>

            <div className="settings-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={beginEditing}
              >
                Edit
              </button>
            </div>
          </div>
          {isEditing ? (
            <ProfileEditModal
              currentPasswordDraft={currentPasswordDraft}
              currentUser={currentUser}
              emailDraft={emailDraft}
              error={profileError}
              isSaving={updateProfileMutation.isPending}
              nameDraft={nameDraft}
              onCancel={() => {
                setIsEditing(false);
                resetProfileDraft();
              }}
              onSave={submitProfile}
              passwordConfirmation={passwordConfirmation}
              passwordDraft={passwordDraft}
              setCurrentPasswordDraft={setCurrentPasswordDraft}
              setEmailDraft={setEmailDraft}
              setNameDraft={setNameDraft}
              setPasswordConfirmation={setPasswordConfirmation}
              setPasswordDraft={setPasswordDraft}
            />
          ) : null}
        </div>

        <div
          aria-expanded={isPersonalTodoOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onTogglePersonalTodoPanel)}
        >
          <div className="settings-item-header">
            <strong>Personal ToDo</strong>
            <span>{isPersonalTodoOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Open your private task list without changing the shared workspace.
          </p>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Theme</strong>
            <span>{currentThemeLabel}</span>
          </div>
          <p className="toolbar-hint">
            Keep the workspace compact and readable without leaving the browser.
          </p>
          <div className="theme-cycle-controls">
            <button
              type="button"
              className="ghost-button theme-cycle-button"
              onClick={() => onThemeChange(nextTheme)}
              title={`Next theme: ${nextThemeLabel}`}
            >
              {currentThemeLabel}
            </button>
            <span className="theme-cycle-note">Next: {nextThemeLabel}</span>
          </div>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onAutoCollapseChange(!autoCollapse)}
        >
          <div className="settings-item-header">
            <strong>Auto Collapse</strong>
            <span>{autoCollapse ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            When enabled, opening one project collapses the rest.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Auto Collapse</span>
            <input
              aria-label="Auto Collapse"
              checked={autoCollapse}
              className="settings-switch-input"
              onChange={(event) => onAutoCollapseChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onBulkActionsChange(!bulkActions)}
        >
          <div className="settings-item-header">
            <strong>Bulk Actions</strong>
            <span>{bulkActions ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show task selection checkboxes and the multi-task action bar.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Bulk Actions</span>
            <input
              aria-label="Bulk Actions"
              checked={bulkActions}
              className="settings-switch-input"
              onChange={(event) => onBulkActionsChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onFullWidthChange(!fullWidth)}
        >
          <div className="settings-item-header">
            <strong>Full Width</strong>
            <span>{fullWidth ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Let the workspace span the full browser width when needed.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Full Width</span>
            <input
              aria-label="Full Width"
              checked={fullWidth}
              className="settings-switch-input"
              onChange={(event) => onFullWidthChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Notification Rate</strong>
            <span>{notificationRate === "daily" ? "Daily" : "Hourly"}</span>
          </div>
          <p className="toolbar-hint">
            {notificationRate === "daily"
              ? `Task and project changes stay buffered and merge into one daily email at ${configuredDigestTimeLocal} (${localTimeZoneLabel}).`
              : "Task and project changes are grouped into one email per hour, sent on the hour."}{" "}
            Administrative emails still send immediately.
          </p>
          {digestPrefError ? (
            <p className="error-banner">{digestPrefError}</p>
          ) : null}
          <div className="settings-time-controls">
            <label className="settings-time-field">
              <span className="settings-switch-label">Notification rate</span>
              <select
                aria-label="Notification rate"
                disabled={
                  notificationPreferencesMutation.isPending ||
                  notificationPreferencesQuery.isPending
                }
                onChange={(event) => {
                  saveNotificationRate(event.target.value as NotificationRate);
                }}
                value={notificationRate}
              >
                {NOTIFICATION_RATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {notificationRate === "daily" ? (
            <div className="settings-time-controls">
              <label className="settings-time-field">
                <span className="settings-switch-label">Daily send time</span>
                <select
                  aria-label="Daily notification time"
                  disabled={
                    notificationPreferencesMutation.isPending ||
                    notificationPreferencesQuery.isPending
                  }
                  onChange={(event) => {
                    setDailyDigestTimeDraft(event.target.value);
                    setDigestPrefError(null);
                  }}
                  value={dailyDigestTimeDraft}
                >
                  {HOURLY_DIGEST_TIME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-actions">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={
                    notificationPreferencesMutation.isPending ||
                    notificationPreferencesQuery.isPending ||
                    dailyDigestTimeDraft === configuredDigestTimeLocal
                  }
                  onClick={saveDailyDigestTime}
                >
                  {notificationPreferencesMutation.isPending
                    ? "Saving..."
                    : "Save"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Personal ToDo Retention</strong>
            <span>
              {formatPersonalTodoRetentionLabel(personalTodoRetention)}
            </span>
          </div>
          <p className="toolbar-hint">
            Control how long completed personal to dos stay visible in your
            private list.
          </p>
          <label className="settings-time-field">
            <span className="settings-switch-label">Completed items</span>
            <select
              aria-label="Personal todo retention"
              disabled={
                notificationPreferencesMutation.isPending ||
                notificationPreferencesQuery.isPending
              }
              onChange={(event) => {
                setDigestPrefError(null);
                notificationPreferencesMutation.mutate({
                  personalTodoRetention: event.target
                    .value as NotificationPreferences["personalTodoRetention"],
                });
              }}
              value={personalTodoRetention}
            >
              {PERSONAL_TODO_RETENTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="toolbar-hint">
            {personalTodoRetention === "delete_when_done"
              ? "Completed items are removed as soon as you mark them done."
              : personalTodoRetention === "never"
                ? "Completed items remain until you delete them yourself."
                : `Completed items are removed ${formatPersonalTodoRetentionLabel(personalTodoRetention).toLowerCase()} after completion.`}
          </p>
        </div>

        <div
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onResetUserSettings)}
        >
          <div className="settings-item-header">
            <strong>Reset all user settings</strong>
            <span>Defaults</span>
          </div>
          <p className="toolbar-hint">
            Reset server-backed and browser-cached personal settings, including
            theme, layout, panel state, digest preferences, and personal to do
            defaults.
          </p>
        </div>

        <div
          aria-expanded={isUserHistoryOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleUserHistory)}
        >
          <div className="settings-item-header">
            <strong>User History</strong>
            <span>{currentUser.name}</span>
          </div>
          <p className="toolbar-hint">
            Review sign-in events for this browser session identity.
          </p>
        </div>

        {!isAdmin ? (
          <div
            aria-expanded={isImportExportOpen}
            className="settings-item settings-item-toggle"
            {...settingsCardButtonProps(onToggleImportExportPanel)}
          >
            <div className="settings-item-header">
              <strong>Import/Export</strong>
              <span>{isImportExportOpen ? "Open" : "Closed"}</span>
            </div>
            <p className="toolbar-hint">
              Open workspace export tools and, for admins, the Loop import
              staging panel.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatPersonalTodoRetentionLabel(
  value: NotificationPreferences["personalTodoRetention"],
) {
  switch (value) {
    case "one_month":
      return "1 month";
    case "three_months":
      return "3 months";
    case "six_months":
      return "6 months";
    case "twelve_months":
      return "12 months";
    case "delete_when_done":
      return "Delete when done";
    case "never":
    default:
      return "Never";
  }
}

type SettingsPanelProps = {
  adminAuditPanel: AdminAuditReportType | null;
  isBackupsOpen: boolean;
  isAdmin: boolean;
  isImportExportOpen: boolean;
  isLocalAccountsOpen: boolean;
  onToggleAdminAuditPanel: (panel: AdminAuditReportType) => void;
  onToggleBackupsPanel: () => void;
  onToggleImportExportPanel: () => void;
  onToggleLocalAccounts: () => void;
  onToggleRetentionPanel: () => void;
  retentionOpen: boolean;
  smtpStatus: SmtpStatus | undefined;
};

function SettingsPanel({
  adminAuditPanel,
  isBackupsOpen,
  isAdmin,
  isImportExportOpen,
  isLocalAccountsOpen,
  onToggleAdminAuditPanel,
  onToggleBackupsPanel,
  onToggleImportExportPanel,
  onToggleLocalAccounts,
  onToggleRetentionPanel,
  retentionOpen,
  smtpStatus,
}: SettingsPanelProps) {
  const [emailPrefError, setEmailPrefError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const smtpServer =
    smtpStatus?.host && smtpStatus.port != null
      ? `${smtpStatus.secure ? "smtps" : "smtp"}://${smtpStatus.host}:${smtpStatus.port}`
      : null;
  const emailEnabled = smtpStatus?.enabled ?? true;
  const dragHandlesEnabled = smtpStatus?.dragHandlesEnabled ?? true;
  const guestAccessEnabled = smtpStatus?.guestAccessEnabled ?? true;

  const syncWorkspaceDragHandlesEnabled = (enabled: boolean) => {
    queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
      current
        ? {
            ...current,
            workspaceSettings: {
              dragHandlesEnabled: enabled,
            },
          }
        : current,
    );
  };

  const emailSettingsMutation = useMutation({
    mutationFn: updateEmailSettings,
    onMutate: async (variables) => {
      setEmailPrefError(null);
      const previous = queryClient.getQueryData<SmtpStatus>(["smtp-status"]);
      const previousWorkspace = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);
      queryClient.setQueryData<SmtpStatus>(["smtp-status"], (current) =>
        current
          ? {
              ...current,
              dragHandlesEnabled: variables.dragHandlesEnabled,
              enabled: variables.enabled,
              guestAccessEnabled: variables.guestAccessEnabled,
            }
          : current,
      );
      syncWorkspaceDragHandlesEnabled(variables.dragHandlesEnabled);
      return { previous, previousWorkspace };
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["smtp-status"], status);
      syncWorkspaceDragHandlesEnabled(status.dragHandlesEnabled);
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["smtp-status"], context.previous);
      }
      if (context?.previousWorkspace) {
        queryClient.setQueryData(["workspace"], context.previousWorkspace);
      }
      setEmailPrefError(
        error instanceof ApiError
          ? error.message
          : "Unable to update email notifications.",
      );
    },
  });
  const toggleEmailNotifications = () => {
    if (emailSettingsMutation.isPending || !smtpStatus) {
      return;
    }

    emailSettingsMutation.mutate({
      dragHandlesEnabled: smtpStatus.dragHandlesEnabled,
      enabled: !smtpStatus.enabled,
      guestAccessEnabled: smtpStatus.guestAccessEnabled,
    });
  };
  const toggleDragHandles = () => {
    if (emailSettingsMutation.isPending || !smtpStatus) {
      return;
    }

    emailSettingsMutation.mutate({
      dragHandlesEnabled: !smtpStatus.dragHandlesEnabled,
      enabled: smtpStatus.enabled,
      guestAccessEnabled: smtpStatus.guestAccessEnabled,
    });
  };
  const toggleGuestAccess = () => {
    if (emailSettingsMutation.isPending || !smtpStatus) {
      return;
    }

    emailSettingsMutation.mutate({
      dragHandlesEnabled: smtpStatus.dragHandlesEnabled,
      enabled: smtpStatus.enabled,
      guestAccessEnabled: !smtpStatus.guestAccessEnabled,
    });
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>Settings</strong>
          <span>Workspace-wide admin controls, tools, and system reports.</span>
        </div>
        <div className="settings-version">
          <div className="settings-version-row">
            <a
              className="settings-link settings-version-link"
              href={appChangelogUrl}
              rel="noreferrer"
              target="_blank"
              title="View changelog on GitHub"
            >
              {`${appName} ${buildShaLabel}`}
            </a>
          </div>
          <BuildDateLabel />
          {isAdmin && smtpServer ? (
            <span className="settings-version-detail">{smtpServer}</span>
          ) : null}
          {isAdmin && smtpStatus?.fromAddress ? (
            <span className="settings-version-detail">
              {smtpStatus.fromAddress}
            </span>
          ) : null}
        </div>
      </header>

      <div className="settings-grid">
        <div
          className="settings-item settings-item-toggle"
          onClick={toggleEmailNotifications}
        >
          <div className="settings-item-header">
            <strong>Email Notifications</strong>
            <span>{emailEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Enable or disable all Tavi email delivery for every user.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Email Notifications</span>
            <input
              aria-label="Email Notifications"
              checked={emailEnabled}
              className="settings-switch-input"
              onChange={toggleEmailNotifications}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>
        <div
          className="settings-item settings-item-toggle"
          onClick={toggleDragHandles}
        >
          <div className="settings-item-header">
            <strong>Task Drag Handles</strong>
            <span>{dragHandlesEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show or hide manual task-reorder handles for the whole workspace.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Task Drag Handles</span>
            <input
              aria-label="Task Drag Handles"
              checked={dragHandlesEnabled}
              className="settings-switch-input"
              disabled={
                emailSettingsMutation.isPending || !smtpStatus
              }
              onChange={toggleDragHandles}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>
        <div
          className="settings-item settings-item-toggle"
          onClick={toggleGuestAccess}
        >
          <div className="settings-item-header">
            <strong>Guest Access</strong>
            <span>{guestAccessEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show or hide the login screen guest viewer entry point.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Guest Access</span>
            <input
              aria-label="Guest Access"
              checked={guestAccessEnabled}
              className="settings-switch-input"
              disabled={
                emailSettingsMutation.isPending || !smtpStatus
              }
              onChange={toggleGuestAccess}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>
        <div
          aria-expanded={isBackupsOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleBackupsPanel)}
        >
          <div className="settings-item-header">
            <strong>Backups</strong>
            <span>{isBackupsOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Open the backups panel to manage scheduled snapshots and restore
            backups.
          </p>
        </div>
        <div
          aria-expanded={retentionOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleRetentionPanel)}
        >
          <div className="settings-item-header">
            <strong>Retention</strong>
            <span>{retentionOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Set backup and audit retention windows, review current retained
            size, and prune immediately.
          </p>
        </div>
        <div
          aria-expanded={isImportExportOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleImportExportPanel)}
        >
          <div className="settings-item-header">
            <strong>Import/Export</strong>
            <span>{isImportExportOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Open workspace export tools and the Loop import staging panel.
          </p>
        </div>
        <div
          aria-expanded={isLocalAccountsOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleLocalAccounts)}
        >
          <div className="settings-item-header">
            <strong>Local Accounts</strong>
            <span>Local auth</span>
          </div>
          <p className="toolbar-hint">
            Create, import, export, reset, edit, remove, and set passwords for
            local accounts.
          </p>
        </div>
        <div
          aria-expanded={adminAuditPanel === "logins"}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(() => onToggleAdminAuditPanel("logins"))}
        >
          <div className="settings-item-header">
            <strong>Audit logins</strong>
            <span>All users</span>
          </div>
          <p className="toolbar-hint">
            Review sign-in and sign-out history for every account with search,
            date filters, and export.
          </p>
        </div>
        <div
          aria-expanded={adminAuditPanel === "emails"}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(() => onToggleAdminAuditPanel("emails"))}
        >
          <div className="settings-item-header">
            <strong>Audit notifications</strong>
            <span>Email timelines</span>
          </div>
          <p className="toolbar-hint">
            Review email-backed notification timelines, delivery attempts, host
            responses, retries, and outcomes.
          </p>
        </div>
        <div
          aria-expanded={adminAuditPanel === "changes"}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(() => onToggleAdminAuditPanel("changes"))}
        >
          <div className="settings-item-header">
            <strong>Audit changes</strong>
            <span>Projects and tasks</span>
          </div>
          <p className="toolbar-hint">
            Review project and task changes across the workspace with search,
            filters, and export.
          </p>
        </div>
      </div>

    </section>
  );
}

type AdminAuditReportPanelProps = {
  currentUser: WorkspaceUser;
  onClose: () => void;
  type: AdminAuditReportType;
  users: WorkspaceUser[];
};

function AdminAuditReportPanel({
  currentUser,
  onClose,
  type,
  users,
}: AdminAuditReportPanelProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState<EmailAuditEvent["status"] | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [expandedEmailEvents, setExpandedEmailEvents] = useState<
    Record<string, boolean>
  >({});
  const isChangeReport = type === "changes";
  const isEmailReport = type === "emails";

  const userLookup = useMemo(
    () =>
      Object.fromEntries(users.map((user) => [user.id, user])) as Record<
        string,
        WorkspaceUser
      >,
    [users],
  );

  const localizedFromDateTime = fromDate
    ? toLocalDayBoundaryIso(fromDate, "start")
    : undefined;
  const localizedToDateTime = toDate
    ? toLocalDayBoundaryIso(toDate, "end")
    : undefined;
  const localTimeZoneLabel = useMemo(() => getLocalTimeZoneLabel(), []);

  const reportQuery = useQuery({
    queryKey: [
      "audit-report",
      type,
      search,
      selectedUserId,
      action,
      status,
      fromDate,
      toDate,
    ],
    queryFn: async () => {
      if (isEmailReport) {
        return listAuditEmails({
          fromDate: fromDate || undefined,
          fromDateTime: localizedFromDateTime,
          limit: 250,
          search,
          status: status || undefined,
          toDate: toDate || undefined,
          toDateTime: localizedToDateTime,
          userId: selectedUserId || undefined,
        });
      }

      const filters = {
        actorUserId: selectedUserId || undefined,
        fromDate: fromDate || undefined,
        fromDateTime: localizedFromDateTime,
        limit: 250,
        search,
        toDate: toDate || undefined,
        toDateTime: localizedToDateTime,
      };

      if (isChangeReport) {
        return listAuditChanges({
          ...filters,
          action: action || undefined,
        });
      }

      return listAuditLogins(filters);
    },
  });

  const testEmailMutation = useMutation({
    mutationFn: sendTestEmail,
    onSuccess: async () => {
      setRetentionError(null);
      setRetentionMessage(`Test email sent to ${currentUser.email}.`);
      await queryClient.invalidateQueries({ queryKey: ["audit-report"] });
    },
    onError: async (error) => {
      setRetentionMessage(null);
      setRetentionError(
        error instanceof ApiError ? error.message : "Unable to send test email",
      );
      await queryClient.invalidateQueries({ queryKey: ["audit-report"] });
    },
  });

  const historyEvents = isEmailReport
    ? []
    : ((reportQuery.data ?? []) as AuditHistoryEvent[]);
  const emailEvents = isEmailReport
    ? normalizeEmailAuditEvents(reportQuery.data)
    : [];
  const title =
    type === "changes"
      ? "Audit changes"
      : type === "emails"
        ? "Audit notifications"
        : "Audit logins";
  const subtitle =
    type === "changes"
      ? "Admin-only project and task change history"
      : type === "emails"
        ? "Admin-only email notification delivery history"
        : "Admin-only sign-in and sign-out history";
  const emptyMessage = isEmailReport
    ? "No matching notification audit events."
    : "No matching audit events.";
  const toggleEmailEvent = (eventId: string) => {
    setExpandedEmailEvents((current) => ({
      ...current,
      [eventId]: !current[eventId],
    }));
  };
  const handleCopyEmailEvent = async (event: EmailAuditEvent) => {
    const notificationLabel = formatNotificationAuditKindLabel(event);
    const recipientLabel = formatEmailAuditRecipient(event);

    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== "function") {
        throw new Error("Clipboard access unavailable");
      }

      await globalThis.navigator.clipboard.writeText(
        formatEmailAuditFlowTimeline(event),
      );
      setRetentionError(null);
      setRetentionMessage(
        `Copied ${notificationLabel} notification flow for ${recipientLabel}.`,
      );
    } catch {
      setRetentionMessage(null);
      setRetentionError(
        `Browser blocked clipboard access for the ${notificationLabel} notification flow to ${recipientLabel}. Expand the entry and copy it manually.`,
      );
    }
  };

  return (
    <section className="audit-card audit-card--report">
      <div className="panel-header">
        <div>
          <strong>{title}</strong>
          <p className="toolbar-hint">{subtitle}</p>
        </div>
        <div className="settings-actions">
          {isEmailReport ? (
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={testEmailMutation.isPending}
              onClick={() => {
                setRetentionError(null);
                setRetentionMessage(null);
                testEmailMutation.mutate();
              }}
            >
              {testEmailMutation.isPending ? "Sending..." : "Test email"}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={
              (isEmailReport ? emailEvents.length : historyEvents.length) ===
                0 || reportQuery.isLoading
            }
            onClick={() =>
              isEmailReport
                ? exportEmailAuditReportCsv({
                    events: emailEvents,
                  })
                : exportAuditReportCsv({
                    currentUser,
                    events: historyEvents,
                    type,
                    users: userLookup,
                  })
            }
          >
            Export CSV
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {retentionMessage ? (
        <p className="toolbar-hint audit-retention-status">
          {retentionMessage}
        </p>
      ) : null}
      {retentionError ? <p className="error-banner">{retentionError}</p> : null}
      <p className="toolbar-hint audit-retention-status">
        {`Dates and times use your local timezone (${localTimeZoneLabel}).`}
      </p>

      <div className="audit-filter-grid">
        <label className="workspace-filter search-filter">
          Search
          <input
            type="search"
            placeholder={
              isEmailReport
                ? "Search notification history"
                : "Search audit history"
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="workspace-filter">
          User
          <select
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {isChangeReport ? (
          <label className="workspace-filter">
            Action
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              {AUDIT_CHANGE_ACTION_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isEmailReport ? (
          <label className="workspace-filter">
            Status
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as EmailAuditEvent["status"] | "")
              }
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="sent">Sent</option>
              <option value="skipped">Skipped</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        ) : null}
        <label className="workspace-filter">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label className="workspace-filter">
          To
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
      </div>

      {reportQuery.isLoading ? (
        <p>
          {isEmailReport
            ? "Loading notification history..."
            : "Loading audit history..."}
        </p>
      ) : null}
      {reportQuery.isError ? (
        <p className="error-banner">
          {reportQuery.error instanceof Error
            ? reportQuery.error.message
            : isEmailReport
              ? "Unable to load notification history."
              : "Unable to load audit history."}
        </p>
      ) : null}
      {!reportQuery.isLoading &&
      !reportQuery.isError &&
      (isEmailReport ? emailEvents.length : historyEvents.length) === 0 ? (
        <p className="toolbar-hint">{emptyMessage}</p>
      ) : null}

      {!reportQuery.isLoading && !reportQuery.isError && isEmailReport ? (
        <ul className="audit-list">
          {emailEvents.map((event) => {
            const summary = summarizeEmailAuditEvent(event);
            const isExpanded = expandedEmailEvents[event.id] === true;
            const notificationLabel = formatNotificationAuditKindLabel(event);
            const recipientLabel = formatEmailAuditRecipient(event);
            const sourceLabel = formatNotificationAuditSourceLabel(
              event.source,
            );

            return (
              <li
                className={`audit-event audit-event--notification${isExpanded ? " is-expanded" : ""}`}
                key={event.id}
              >
                <div className="audit-event-toolbar">
                  <button
                    type="button"
                    className="audit-event-toggle"
                    aria-expanded={isExpanded}
                    aria-label={`${notificationLabel} notification flow summary`}
                    onClick={() => toggleEmailEvent(event.id)}
                  >
                    <div className="audit-event-header">
                      <strong>{notificationLabel}</strong>
                      <span>{formatEmailAuditStatusLabel(event.status)}</span>
                      <span>{formatDateTime(event.createdAt)}</span>
                    </div>
                    <div className="audit-event-subtitle">
                      <span>{recipientLabel}</span>
                      <span>{sourceLabel}</span>
                    </div>
                    {summary.length > 0 ? (
                      <div className="audit-event-meta audit-event-meta--summary">
                        {summary.map((item) => (
                          <span
                            className="audit-chip"
                            key={`${event.id}-${item}`}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                  <div className="audit-event-toolbar-actions">
                    <button
                      type="button"
                      className="audit-toolbar-button"
                      aria-label={`Copy ${notificationLabel} notification flow`}
                      title="Copy full notification flow"
                      onClick={() => {
                        void handleCopyEmailEvent(event);
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="audit-toolbar-button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${notificationLabel} notification flow`}
                      onClick={() => toggleEmailEvent(event.id)}
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="audit-event-details">
                    <div className="audit-event-meta">
                      {event.actor ? (
                        <span>{`Triggered by ${formatActorSummary(event.actor)}`}</span>
                      ) : (
                        <span>Triggered by system delivery</span>
                      )}
                      <span>{`Attempts ${event.attemptCount.toString()}`}</span>
                      {event.subject ? <span>{event.subject}</span> : null}
                      {event.entityType && event.entityId ? (
                        <span>{`${formatAuditEntityTypeLabel(event.entityType)} ${event.entityId}`}</span>
                      ) : null}
                    </div>
                    {event.steps.length > 0 ? (
                      <ol className="audit-change-list">
                        {event.steps.map((step) => (
                          <li key={step.id}>
                            <strong>{step.title}</strong>
                            <span>{formatDateTime(step.createdAt)}</span>
                            <span>
                              {formatNotificationAuditStepDetail(step)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!reportQuery.isLoading &&
      !reportQuery.isError &&
      !isEmailReport &&
      historyEvents.length > 0 ? (
        <ul className="audit-list">
          {historyEvents.map((event) => {
            const auditChanges = readAuditChanges(event.metadata);
            const eventSummary = summarizeAuditMetadata(
              event.metadata,
              userLookup,
              currentUser,
            );

            return (
              <li key={event.id} className="audit-event">
                <div className="audit-event-header">
                  <strong>{formatAuditActionLabel(event.action)}</strong>
                  <span>{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="audit-event-meta">
                  <span>{formatAuditEntityTitle(event)}</span>
                  <span>{formatActorSummary(event.actor)}</span>
                </div>
                {auditChanges.length > 0 ? (
                  <ul className="audit-change-list">
                    {auditChanges.map((change) => (
                      <li key={`${event.id}-${change.field}`}>
                        <strong>{formatAuditFieldLabel(change.field)}</strong>
                        <span>
                          {formatAuditChangeValue(
                            change.field,
                            change.from,
                            userLookup,
                            currentUser,
                          )}
                          {" -> "}
                          {formatAuditChangeValue(
                            change.field,
                            change.to,
                            userLookup,
                            currentUser,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {eventSummary.length > 0 ? (
                  <div className="audit-event-meta">
                    <span>{eventSummary.join(" · ")}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

type AuditHistoryPanelProps = {
  currentUser: WorkspaceUser;
  emptyMessage: string;
  errorMessage: string | null;
  events: AuditHistoryEvent[];
  isError: boolean;
  isLoading: boolean;
  onClose: () => void;
  subtitle: string;
  title: string;
  users: Record<string, WorkspaceUser>;
};

function AuditHistoryPanel({
  currentUser,
  emptyMessage,
  errorMessage,
  events,
  isError,
  isLoading,
  onClose,
  subtitle,
  title,
  users,
}: AuditHistoryPanelProps) {
  const localTimeZoneLabel = useMemo(() => getLocalTimeZoneLabel(), []);

  return (
    <section className="audit-card">
      <header className="audit-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </header>

      {isLoading ? (
        <p className="toolbar-hint">Loading audit history...</p>
      ) : null}
      {isError ? (
        <p className="error-banner">
          {errorMessage ?? "Unable to load history"}
        </p>
      ) : null}
      {!isLoading && !isError && events.length === 0 ? (
        <p className="toolbar-hint">{emptyMessage}</p>
      ) : null}
      <p className="toolbar-hint audit-retention-status">
        {`Dates and times use your local timezone (${localTimeZoneLabel}).`}
      </p>

      {!isLoading && !isError && events.length > 0 ? (
        <ul className="audit-list">
          {events.map((event) => {
            const auditChanges = readAuditChanges(event.metadata);
            const metadataSummary = summarizeAuditMetadata(
              event.metadata,
              users,
              currentUser,
            );

            return (
              <li className="audit-event" key={event.id}>
                <div className="audit-event-header">
                  <strong>{event.actor.name}</strong>
                  <span>{formatAuditActionLabel(event.action)}</span>
                  <span>{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="audit-event-subtitle">
                  <span>{event.actor.role}</span>
                  <span>{event.actor.email}</span>
                </div>
                {auditChanges.length > 0 ? (
                  <ul className="audit-change-list">
                    {auditChanges.map((change) => (
                      <li key={`${event.id}-${change.field}`}>
                        <strong>{formatAuditFieldLabel(change.field)}</strong>
                        <span>
                          {formatAuditChangeValue(
                            change.field,
                            change.from,
                            users,
                            currentUser,
                          )}
                          {" -> "}
                          {formatAuditChangeValue(
                            change.field,
                            change.to,
                            users,
                            currentUser,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {metadataSummary.length > 0 ? (
                  <div className="audit-event-meta">
                    {metadataSummary.map((item) => (
                      <span className="audit-chip" key={`${event.id}-${item}`}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function buildBulkTaskPayload(draft: BulkTaskDraft) {
  return {
    ...(draft.assigneeMode === "set" && draft.assigneeUserId
      ? { assigneeUserId: draft.assigneeUserId }
      : draft.assigneeMode === "clear"
        ? { assigneeUserId: null }
        : {}),
    ...(draft.priority ? { priority: draft.priority } : {}),
    ...(draft.status ? { status: draft.status } : {}),
    ...(draft.notesMode === "clear" ? { notes: null } : {}),
    ...(draft.dueDateMode === "set"
      ? { dueDate: draft.dueDate }
      : draft.dueDateMode === "clear"
        ? { dueDate: null }
        : {}),
  };
}

function normalizeWorkspacePanelState(
  value: Partial<WorkspacePanelState> | null | undefined,
) {
  return {
    backups: value?.backups === true,
    importExport: value?.importExport === true,
    newProject: value?.newProject === true,
    personalTodo: value?.personalTodo === true,
    profile: value?.profile === true,
    settings: value?.settings === true,
    view: value?.view === true,
  };
}

function normalizeBooleanSelection(
  value: Record<string, unknown> | null | undefined,
) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, isSelected]) => isSelected === true),
  ) as Record<string, boolean>;
}

function activeBooleanSelection(selection: Record<string, boolean>) {
  return Object.fromEntries(
    Object.entries(selection).filter(([, isSelected]) => isSelected),
  );
}

function normalizeWorkspacePreferences(
  value: Partial<WorkspacePreferences> | null | undefined,
): WorkspacePreferences {
  return {
    autoCollapse: value?.autoCollapse !== false,
    bulkActions: value?.bulkActions !== false,
    fullWidth: value?.fullWidth === true,
    theme: normalizeWorkspaceTheme(value?.theme),
  };
}

function normalizeWorkspaceUserConfig(
  value: WorkspaceUserConfigInput | null | undefined,
): WorkspaceUserConfigWithFilters {
  const defaultUserConfig = createDefaultWorkspaceUserConfig();

  return {
    addTaskPanels: normalizeBooleanSelection(value?.addTaskPanels),
    collapsedGroups: normalizeCollapsedGroupsByGroup(value?.collapsedGroups),
    filters: normalizeWorkspaceFilterState(
      value?.filters ?? defaultUserConfig.filters,
    ),
    hideDonePersonalTodos: value?.hideDonePersonalTodos === true,
    hideDoneTasksByProject: normalizeBooleanSelection(
      value?.hideDoneTasksByProject,
    ),
    noteEditorHeights: normalizeNoteEditorHeights(
      value?.noteEditorHeights ?? defaultUserConfig.noteEditorHeights,
    ),
    panels: normalizeWorkspacePanelState(value?.panels),
    preferences: normalizeWorkspacePreferences(value?.preferences),
  };
}

function getNextWorkspaceTheme(theme: WorkspaceTheme): WorkspaceTheme {
  const currentIndex = WORKSPACE_THEMES.indexOf(theme);
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % WORKSPACE_THEMES.length;

  return WORKSPACE_THEMES[nextIndex];
}

function getWorkspaceThemeLabel(theme: WorkspaceTheme) {
  return WORKSPACE_THEME_META[theme].label;
}

function normalizeWorkspaceTheme(value: unknown): WorkspaceTheme {
  if (value === "dark") {
    return "ocean";
  }

  if (
    typeof value === "string" &&
    WORKSPACE_THEMES.includes(value as WorkspaceTheme)
  ) {
    return value as WorkspaceTheme;
  }

  return DEFAULT_WORKSPACE_THEME;
}

function formatTaskCompletionPercent(doneCount: number, totalCount: number) {
  if (totalCount === 0) {
    return "0%";
  }

  return `${Math.round((doneCount / totalCount) * 100).toString()}%`;
}

function summarizeAuditMetadata(
  metadata: Record<string, unknown> | null,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (!metadata) {
    return [];
  }

  const summary: string[] = [];
  const title = readMetadataString(metadata.title);
  const name = readMetadataString(metadata.name);
  const changedFields = readMetadataStringArray(metadata.changedFields);
  const status = readMetadataString(metadata.status);
  const manualStatus = readMetadataString(metadata.manualStatus);
  const assigneeUserId =
    "assigneeUserId" in metadata
      ? readMetadataNullableString(metadata.assigneeUserId)
      : null;
  const priority = readMetadataString(metadata.priority);
  const dueDate = metadata.dueDate;
  const notes =
    readMetadataString(metadata.notes) ??
    readMetadataString(metadata.blockedReason) ??
    readMetadataString(metadata.manualStatusReason);
  const selectionSize = readMetadataNumber(metadata.selectionSize);
  const groupBy = readMetadataString(metadata.groupBy);
  const search = readMetadataString(metadata.search);
  const sortBy = readMetadataStringArray(metadata.sortBy).filter(
    isProjectSortField,
  );
  const statusFilters = readMetadataStringArray(metadata.statusFilters).filter(
    isProjectStatus,
  );
  const assigneeUserIds = readMetadataStringArray(metadata.assigneeUserIds);
  const role = readMetadataString(metadata.role);
  const copiedFromProjectTitle = readMetadataString(
    metadata.copiedFromProjectTitle,
  );
  const ownerUserId =
    "ownerUserId" in metadata
      ? readMetadataNullableString(metadata.ownerUserId)
      : null;

  if (title) {
    summary.push(title);
  } else if (name) {
    summary.push(name);
  }

  if (copiedFromProjectTitle) {
    summary.push(`Copied from project ${copiedFromProjectTitle}`);
  }

  if (changedFields.length > 0) {
    summary.push(
      `Changed ${changedFields.map((field) => formatAuditField(field)).join(", ")}`,
    );
  }

  if (status) {
    summary.push(`Status ${formatStatusLabel(status as TaskStatus)}`);
  }

  if (manualStatus) {
    summary.push(
      `Override ${formatStatusLabel(manualStatus as ProjectStatus)}`,
    );
  }

  if (assigneeUserId !== null) {
    summary.push(
      assigneeUserId
        ? `Assignee ${formatUserReference(assigneeUserId, users, currentUser)}`
        : `Assignee ${NO_TASK_ASSIGNEE_LABEL}`,
    );
  }

  if (ownerUserId !== null) {
    summary.push(
      ownerUserId
        ? `Owner ${formatUserReference(ownerUserId, users, currentUser)}`
        : `Owner ${NO_PROJECT_OWNER_LABEL}`,
    );
  }

  if (priority) {
    summary.push(`Priority ${priority}`);
  }

  if (dueDate !== undefined) {
    const nextDueDate = readMetadataNullableString(dueDate);
    summary.push(
      nextDueDate ? `Due ${formatDate(nextDueDate)}` : "Due cleared",
    );
  }

  if (notes) {
    summary.push(`Notes ${notes}`);
  }

  if (selectionSize) {
    summary.push(
      `${selectionSize} task${selectionSize === 1 ? "" : "s"} selected`,
    );
  }

  if (groupBy) {
    summary.push(`Group ${groupBy.replace(/_/g, " ")}`);
  }

  if (search) {
    summary.push(`Search "${search}"`);
  }

  if (sortBy.length > 0) {
    summary.push(
      `Sort ${sortBy.map((field) => formatProjectSortFieldLabel(field)).join(", ")}`,
    );
  }

  if (statusFilters.length > 0) {
    summary.push(
      `Status ${statusFilters.map((statusValue) => formatStatusLabel(statusValue)).join(", ")}`,
    );
  }

  if (assigneeUserIds.length > 0) {
    summary.push(
      `Assignee ${assigneeUserIds
        .map((userId) => formatUserReference(userId, users, currentUser))
        .join(", ")}`,
    );
  }

  if (role) {
    summary.push(`Role ${role}`);
  }

  return summary.slice(0, 6);
}

type AuditChange = {
  field: string;
  from: unknown;
  to: unknown;
};

function readAuditChanges(
  metadata: Record<string, unknown> | null,
): AuditChange[] {
  if (!metadata || !Array.isArray(metadata.changes)) {
    return [];
  }

  return metadata.changes.flatMap((entry) => {
    if (
      entry &&
      typeof entry === "object" &&
      "field" in entry &&
      typeof entry.field === "string"
    ) {
      return [
        {
          field: entry.field,
          from: "from" in entry ? entry.from : null,
          to: "to" in entry ? entry.to : null,
        },
      ];
    }

    return [];
  });
}

function formatAuditFieldLabel(value: string) {
  return formatAuditField(value);
}

function formatAuditChangeValue(
  field: string,
  value: unknown,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (value === null || value === undefined || value === "") {
    if (field === "assigneeUserId") {
      return NO_TASK_ASSIGNEE_LABEL;
    }

    if (field === "ownerUserId") {
      return NO_PROJECT_OWNER_LABEL;
    }

    return "None";
  }

  if (field === "assigneeUserId" || field === "ownerUserId") {
    return typeof value === "string"
      ? formatUserReference(value, users, currentUser)
      : "None";
  }

  if (field === "status" || field === "manualStatus") {
    return typeof value === "string"
      ? formatStatusLabel(value as ProjectStatus | TaskStatus)
      : "None";
  }

  if (field === "priority") {
    return typeof value === "string"
      ? formatPriorityLabel(value as Priority)
      : "None";
  }

  if (field === "dueDate") {
    return typeof value === "string" ? formatDate(value) : "None";
  }

  if (field === "completedAt" || field === "archivedAt") {
    return typeof value === "string" ? formatDateTime(value) : "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (field === "sortBy") {
      const sortLabels = value
        .filter((entry): entry is string => typeof entry === "string")
        .filter(isProjectSortField)
        .map((entry) => formatProjectSortFieldLabel(entry));

      return sortLabels.length > 0 ? sortLabels.join(", ") : "None";
    }

    return value.join(", ");
  }

  return String(value);
}

function formatActorSummary(actor: AuditHistoryEvent["actor"]) {
  return `${actor.name} · ${actor.email}`;
}

function formatAuditEntityTitle(event: AuditHistoryEvent) {
  const metadataTitle =
    readMetadataString(event.metadata?.title) ??
    readMetadataString(event.metadata?.name);
  const entityLabel =
    event.entityType === "project"
      ? "Project"
      : event.entityType === "task"
        ? "Task"
        : "Auth";

  return metadataTitle
    ? `${entityLabel}: ${metadataTitle}`
    : `${entityLabel}: ${event.entityId}`;
}

function exportAuditReportCsv({
  currentUser,
  events,
  type,
  users,
}: {
  currentUser: WorkspaceUser;
  events: AuditHistoryEvent[];
  type: AdminAuditReportType;
  users: Record<string, WorkspaceUser>;
}) {
  const rows = events.map((event) => ({
    Action: formatAuditActionLabel(event.action),
    Actor: event.actor.name,
    "Actor Email": event.actor.email,
    "Changed Values": readAuditChanges(event.metadata)
      .map(
        (change) =>
          `${formatAuditFieldLabel(change.field)}: ${formatAuditChangeValue(
            change.field,
            change.from,
            users,
            currentUser,
          )} -> ${formatAuditChangeValue(change.field, change.to, users, currentUser)}`,
      )
      .join(" | "),
    "Date/Time": event.createdAt,
    Entity: formatAuditEntityTitle(event),
    Summary: summarizeAuditMetadata(event.metadata, users, currentUser).join(
      " | ",
    ),
  }));

  downloadCsvFile(type === "changes" ? "audit-changes" : "audit-logins", rows, [
    "Date/Time",
    "Action",
    "Entity",
    "Actor",
    "Actor Email",
    "Changed Values",
    "Summary",
  ]);
}

function exportEmailAuditReportCsv({ events }: { events: EmailAuditEvent[] }) {
  const rows = events.map((event) => ({
    Action: formatNotificationAuditKindLabel(event),
    Attempts: event.attemptCount.toString(),
    "Date/Time": event.createdAt,
    Error: event.error ?? "",
    Recipient: formatEmailAuditRecipient(event),
    Source: formatNotificationAuditSourceLabel(event.source),
    Status: formatEmailAuditStatusLabel(event.status),
    Summary: summarizeEmailAuditEvent(event).join(" | "),
    TriggeredBy: event.actor
      ? formatActorSummary(event.actor)
      : "System delivery",
  }));

  downloadCsvFile("audit-notifications", rows, [
    "Date/Time",
    "Action",
    "Status",
    "Source",
    "Recipient",
    "TriggeredBy",
    "Attempts",
    "Error",
    "Summary",
  ]);
}

const EMAIL_AUDIT_STATUS_VALUES: EmailAuditEvent["status"][] = [
  "queued",
  "processing",
  "sent",
  "skipped",
  "failed",
];

const EMAIL_AUDIT_SOURCE_VALUES: EmailAuditEvent["source"][] = [
  "notification",
  "password_reset",
  "account_update",
  "password_email",
  "test_email",
];

function normalizeEmailAuditEvents(value: unknown): EmailAuditEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index) => {
    const record = toUnknownRecord(entry);

    if (!record) {
      return [];
    }

    const eventId =
      readUnknownString(record.id) ?? `email-audit-${index.toString()}`;
    const createdAt =
      readUnknownString(record.createdAt) ?? new Date(0).toISOString();
    const status = isEmailAuditStatus(record.status) ? record.status : "queued";
    const steps = Array.isArray(record.steps)
      ? record.steps.flatMap((step, stepIndex) => {
          const normalizedStep = normalizeEmailAuditStep(step, {
            createdAt,
            eventId,
            fallbackStatus: status,
            stepIndex,
          });

          return normalizedStep ? [normalizedStep] : [];
        })
      : [];

    return [
      {
        id: eventId,
        action: readUnknownString(record.action) ?? "email_notification",
        actor: normalizeEmailAuditActor(record.actor),
        attemptCount:
          typeof record.attemptCount === "number" &&
          Number.isInteger(record.attemptCount) &&
          record.attemptCount >= 0
            ? record.attemptCount
            : Math.max(
                steps.reduce(
                  (highestAttempt, step) =>
                    Math.max(highestAttempt, step.attemptNumber ?? 0),
                  0,
                ),
                steps.length > 0 ? 1 : 0,
              ),
        createdAt,
        entityId: readUnknownNullableString(record.entityId),
        entityType: isAuditEntityTypeValue(record.entityType)
          ? record.entityType
          : null,
        error: readUnknownNullableString(record.error),
        failedAt: readUnknownNullableString(record.failedAt),
        kind: readUnknownNullableString(record.kind),
        metadata: toUnknownRecord(record.metadata),
        nextAttemptAt: readUnknownNullableString(record.nextAttemptAt),
        recipient: normalizeEmailAuditRecipientRecord(record.recipient),
        response: readUnknownNullableString(record.response),
        sentAt: readUnknownNullableString(record.sentAt),
        skippedAt: readUnknownNullableString(record.skippedAt),
        source: isEmailAuditSource(record.source)
          ? record.source
          : "notification",
        status,
        steps,
        subject: readUnknownNullableString(record.subject),
      },
    ];
  });
}

function normalizeEmailAuditActor(value: unknown): EmailAuditEvent["actor"] {
  const record = toUnknownRecord(value);

  if (!record) {
    return null;
  }

  const id = readUnknownString(record.id);
  const email = readUnknownString(record.email);
  const name = readUnknownString(record.name);

  if (!id || !email || !name) {
    return null;
  }

  return {
    id,
    email,
    name,
    role: isRoleValue(record.role) ? record.role : "viewer",
  };
}

function normalizeEmailAuditRecipientRecord(
  value: unknown,
): EmailAuditEvent["recipient"] {
  const record = toUnknownRecord(value);

  return {
    id: record ? readUnknownNullableString(record.id) : null,
    email:
      (record ? readUnknownString(record.email) : null) ?? "Unknown recipient",
    name: record ? readUnknownNullableString(record.name) : null,
  };
}

function normalizeEmailAuditStep(
  value: unknown,
  {
    createdAt,
    eventId,
    fallbackStatus,
    stepIndex,
  }: {
    createdAt: string;
    eventId: string;
    fallbackStatus: EmailAuditEvent["status"];
    stepIndex: number;
  },
): EmailAuditEvent["steps"][number] | null {
  const record = toUnknownRecord(value);

  if (!record) {
    return null;
  }

  return {
    attemptNumber:
      typeof record.attemptNumber === "number" &&
      Number.isInteger(record.attemptNumber) &&
      record.attemptNumber > 0
        ? record.attemptNumber
        : null,
    createdAt: readUnknownString(record.createdAt) ?? createdAt,
    detail: readUnknownNullableString(record.detail),
    host: readUnknownNullableString(record.host),
    id:
      readUnknownString(record.id) ??
      `${eventId}-step-${(stepIndex + 1).toString()}`,
    nextAttemptAt: readUnknownNullableString(record.nextAttemptAt),
    response: readUnknownNullableString(record.response),
    status: isEmailAuditStatus(record.status) ? record.status : fallbackStatus,
    title: readUnknownString(record.title) ?? "Delivery update",
  };
}

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readUnknownString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? maskSmtpPassword(value)
    : null;
}

function readUnknownNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? maskSmtpPassword(value)
    : null;
}

function isEmailAuditStatus(
  value: unknown,
): value is EmailAuditEvent["status"] {
  return (
    typeof value === "string" &&
    EMAIL_AUDIT_STATUS_VALUES.includes(value as EmailAuditEvent["status"])
  );
}

function isEmailAuditSource(
  value: unknown,
): value is EmailAuditEvent["source"] {
  return (
    typeof value === "string" &&
    EMAIL_AUDIT_SOURCE_VALUES.includes(value as EmailAuditEvent["source"])
  );
}

function isAuditEntityTypeValue(value: unknown): value is AuditEntityType {
  return (
    value === "auth" ||
    value === "project" ||
    value === "saved_view" ||
    value === "task"
  );
}

function isRoleValue(value: unknown): value is WorkspaceUser["role"] {
  return value === "admin" || value === "editor" || value === "viewer";
}

function summarizeEmailAuditEvent(event: EmailAuditEvent) {
  const summary: string[] = [];
  const title =
    readMetadataString(event.metadata?.title) ??
    readMetadataString(event.metadata?.taskTitle) ??
    readMetadataString(event.metadata?.projectTitle);
  const expiresAt = readMetadataString(event.metadata?.expiresAt);
  const reason = readMetadataString(event.metadata?.reason);

  if (title) {
    summary.push(title);
  }

  if (event.sentAt) {
    summary.push(`Sent ${formatDateTime(event.sentAt)}`);
  }

  if (event.skippedAt) {
    summary.push(`Skipped ${formatDateTime(event.skippedAt)}`);
  }

  if (event.failedAt) {
    summary.push(`Failed ${formatDateTime(event.failedAt)}`);
  }

  if (reason) {
    summary.push(`Reason ${reason}`);
  }

  if (expiresAt) {
    summary.push(`Expires ${formatDateTime(expiresAt)}`);
  }

  if (event.error) {
    summary.push(`Error ${event.error}`);
  }

  if (event.nextAttemptAt) {
    summary.push(`Next ${formatDateTime(event.nextAttemptAt)}`);
  }

  return summary.slice(0, 6);
}

function formatEmailAuditFlowTimeline(event: EmailAuditEvent) {
  const summary = summarizeEmailAuditEvent(event);
  const lines = [
    `Notification: ${formatNotificationAuditKindLabel(event)}`,
    `Status: ${formatEmailAuditStatusLabel(event.status)}`,
    `Created: ${formatDateTime(event.createdAt)}`,
    `Recipient: ${formatEmailAuditRecipient(event)}`,
    `Source: ${formatNotificationAuditSourceLabel(event.source)}`,
    `Triggered by: ${event.actor ? formatActorSummary(event.actor) : "system delivery"}`,
    `Attempts: ${event.attemptCount.toString()}`,
  ];

  if (event.subject) {
    lines.push(`Subject: ${event.subject}`);
  }

  if (event.entityType && event.entityId) {
    lines.push(
      `Entity: ${formatAuditEntityTypeLabel(event.entityType)} ${event.entityId}`,
    );
  }

  if (summary.length > 0) {
    lines.push(`Summary: ${summary.join(" | ")}`);
  }

  if (event.steps.length > 0) {
    lines.push("Timeline:");
    event.steps.forEach((step) => {
      lines.push(
        `- ${step.title} (${formatDateTime(step.createdAt)}): ${formatNotificationAuditStepDetail(step)}`,
      );
    });
  } else {
    lines.push("Timeline: none recorded");
  }

  return lines.join("\n");
}

function formatNotificationAuditKindLabel(event: EmailAuditEvent) {
  if (event.source === "test_email") {
    return "test email";
  }

  if (event.source === "password_email") {
    return "password email";
  }

  if (event.source === "account_update") {
    return "account update";
  }

  if (event.source === "password_reset") {
    return "password reset";
  }

  return formatAuditActionLabel(event.kind ?? event.action);
}

function formatEmailAuditRecipient(event: EmailAuditEvent) {
  return event.recipient.name
    ? `${event.recipient.name} · ${event.recipient.email}`
    : event.recipient.email;
}

function formatNotificationAuditSourceLabel(source: EmailAuditEvent["source"]) {
  switch (source) {
    case "account_update":
      return "Account update";
    case "password_email":
      return "Password email";
    case "password_reset":
      return "Password reset";
    case "test_email":
      return "Test email";
    default:
      return "Notification worker";
  }
}

function formatEmailAuditStatusLabel(status: EmailAuditEvent["status"]) {
  return status.replace(/_/g, " ");
}

function formatNotificationAuditStepDetail(
  step: EmailAuditEvent["steps"][number],
) {
  const parts = [
    step.detail,
    step.host ? `Host ${step.host}` : null,
    step.response ? `Response ${step.response}` : null,
    step.nextAttemptAt ? `Next ${formatDateTime(step.nextAttemptAt)}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
}

function formatAuditEntityTypeLabel(value: AuditEntityType) {
  switch (value) {
    case "project":
      return "Project";
    case "task":
      return "Task";
    case "saved_view":
      return "Saved view";
    default:
      return "Auth";
  }
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? maskSmtpPassword(value.trim())
    : null;
}

function readMetadataNullableString(value: unknown) {
  return typeof value === "string"
    ? maskSmtpPassword(value)
    : value === null
      ? null
      : null;
}

function readMetadataNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function readMetadataStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function formatAuditActionLabel(action: string) {
  switch (action) {
    case "bulk_copy":
      return "bulk copy";
    case "bulk_delete":
      return "bulk delete";
    case "bulk_update":
      return "bulk update";
    case "convert_from_project":
      return "converted from project";
    case "convert_to_project":
      return "converted to project";
    case "convert_to_task":
      return "converted to task";
    case "status_override_clear":
      return "cleared override";
    case "status_override_set":
      return "set override";
    default:
      return action.replace(/_/g, " ");
  }
}

function formatAuditField(value: string) {
  switch (value) {
    case "assigneeUserId":
      return "assignee";
    case "archivedAt":
      return "archived at";
    case "blockedReason":
    case "description":
    case "manualStatusReason":
      return "notes";
    case "completedAt":
      return "completed at";
    case "dueDate":
      return "due date";
    case "groupBy":
      return "group by";
    case "sortBy":
      return "sort by";
    case "manualStatus":
      return "override";
    case "ownerUserId":
      return "owner";
    case "trackerLink":
    case "references":
      return "references";
    case "assigneeUserIds":
      return "assignee filter";
    case "statusFilter":
    case "statusFilters":
      return "status filter";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatUserReference(
  userId: string,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (userId === currentUser.id) {
    return currentUser.name;
  }

  return users[userId]?.name ?? userId;
}

function filterProjects({
  assigneeUserIds,
  notViewedOnly,
  projects,
  search,
  statusFilters,
}: {
  assigneeUserIds: string[];
  notViewedOnly: boolean;
  projects: WorkspaceProject[];
  search: string;
  statusFilters: ProjectStatus[];
}) {
  const normalizedSearch = normalizeSearchHighlightTerm(search);
  const hasAssigneeFilter = assigneeUserIds.length > 0;

  return projects.flatMap((project) => {
    if (notViewedOnly && !projectHasUnviewedChanges(project)) {
      return [];
    }

    if (
      statusFilters.length > 0 &&
      !statusFilters.includes(project.displayStatus)
    ) {
      return [];
    }

    const projectMatchesAssignee = matchesNullableUserFilter(
      project.ownerUserId,
      assigneeUserIds,
    );
    const hasMatchingAssigneeTask = project.tasks.some((task) =>
      matchesNullableUserFilter(task.assigneeUserId, assigneeUserIds),
    );

    if (
      hasAssigneeFilter &&
      !projectMatchesAssignee &&
      !hasMatchingAssigneeTask
    ) {
      return [];
    }

    if (!normalizedSearch) {
      return [{ ...project, tasks: project.tasks }];
    }

    const projectMatchesSearch = projectMatchesSearchTerm(
      project,
      normalizedSearch,
    );
    const hasMatchingSearchTask = project.tasks.some((task) =>
      taskMatchesSearchTerm(task, normalizedSearch),
    );

    if (!projectMatchesSearch && !hasMatchingSearchTask) {
      return [];
    }

    return [
      {
        ...project,
        tasks: project.tasks,
      },
    ];
  });
}

function projectMatchesSearchTerm(
  project: WorkspaceProject,
  normalizedSearch: string,
) {
  return (
    textMatchesSearch(project.title, normalizedSearch) ||
    textMatchesSearch(project.references, normalizedSearch) ||
    textMatchesSearch(project.notes, normalizedSearch)
  );
}

function taskMatchesSearchTerm(task: WorkspaceTask, normalizedSearch: string) {
  return (
    textMatchesSearch(task.title, normalizedSearch) ||
    textMatchesSearch(task.notes, normalizedSearch)
  );
}

function findFirstMatchingSearchTaskTarget(
  groupedProjects: Array<{ key: string; projects: WorkspaceProject[] }>,
  normalizedSearch: string,
  hideDoneTasksByProject: Record<string, boolean>,
): SearchTaskRevealTarget | null {
  if (!normalizedSearch) {
    return null;
  }

  for (const group of groupedProjects) {
    for (const project of group.projects) {
      const matchingTask = project.tasks.find((task) =>
        taskMatchesSearchTerm(task, normalizedSearch),
      );

      if (!matchingTask) {
        continue;
      }

      return {
        groupKey: group.key,
        hiddenByDoneFilter:
          hideDoneTasksByProject[project.id] === true &&
          isDoneFilterHiddenTask(matchingTask),
        projectId: project.id,
        taskId: matchingTask.id,
      };
    }
  }

  return null;
}

function projectHasUnviewedChanges(project: WorkspaceProject) {
  return (
    project.hasUnviewedChanges === true ||
    project.tasks.some((task) => task.hasUnviewedChanges === true)
  );
}

function isDoneFilterHiddenTask(task: WorkspaceTask) {
  return DONE_FILTER_HIDDEN_TASK_STATUSES.has(task.status);
}

function matchesNullableUserFilter(userId: string | null, userIds: string[]) {
  return userId === null
    ? userIds.includes(UNASSIGNED_FILTER_VALUE)
    : userIds.includes(userId);
}

function groupProjects(
  projects: WorkspaceProject[],
  groupBy: GroupBy,
  sortBy: ProjectSortField[],
) {
  if (groupBy === "none") {
    return [
      { key: GROUP_LABELS.none, projects: sortProjects(projects, sortBy) },
    ];
  }

  const groups = new Map<string, WorkspaceProject[]>();

  for (const project of projects) {
    const key =
      groupBy === "owner"
        ? formatProjectOwnerGroupLabel(project.ownerName)
        : groupBy === "priority"
          ? project.priority
          : groupBy === "progress"
            ? formatProjectProgress(project)
            : formatStatusLabel(project.displayStatus);

    const existing = groups.get(key) ?? [];
    existing.push(project);
    groups.set(key, existing);
  }

  const groupedEntries = [...groups.entries()].map(
    ([key, groupedProjects]) => ({
      key,
      projects: sortProjects(groupedProjects, sortBy),
    }),
  );

  if (groupBy === "status") {
    return groupedEntries.sort(
      (left, right) =>
        statusLabelSortRank(left.key) - statusLabelSortRank(right.key),
    );
  }

  if (groupBy === "priority") {
    return groupedEntries.sort(
      (left, right) =>
        priorityGroupSortRank(left.key) - priorityGroupSortRank(right.key),
    );
  }

  if (groupBy !== "progress") {
    return groupedEntries;
  }

  return groupedEntries.sort(
    (left, right) =>
      parseProgressGroup(right.key) - parseProgressGroup(left.key),
  );
}

function sortProjects(
  projects: WorkspaceProject[],
  sortBy: ProjectSortField[],
) {
  if (sortBy.length === 0) {
    return projects;
  }

  return projects
    .map((project, index) => ({ index, project }))
    .sort((left, right) => {
      for (const sortField of sortBy) {
        const result = compareProjectsByField(
          left.project,
          right.project,
          sortField,
        );

        if (result !== 0) {
          return result;
        }
      }

      return left.index - right.index;
    })
    .map(({ project }) => project);
}

function compareProjectsByField(
  left: WorkspaceProject,
  right: WorkspaceProject,
  field: ProjectSortField,
) {
  switch (field) {
    case "dueDate":
      return compareNullableDateValues(left.dueDate, right.dueDate);
    case "age":
      return compareNullableDateValues(
        left.createdAt ?? null,
        right.createdAt ?? null,
      );
    case "lastUpdated":
      return compareNullableDateValues(
        latestProjectActivity(right),
        latestProjectActivity(left),
      );
    case "priority":
      return prioritySortRank(left.priority) - prioritySortRank(right.priority);
    case "progress":
      return projectCompletionPercent(right) - projectCompletionPercent(left);
    case "title":
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
  }
}

function compareNullableDateValues(left: string | null, right: string | null) {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return left.localeCompare(right);
}

function latestProjectActivity(project: WorkspaceProject) {
  return project.tasks.reduce<string | null>((latest, task) => {
    const taskUpdatedAt = task.updatedAt ?? null;

    return compareNullableDateValues(taskUpdatedAt, latest) > 0
      ? taskUpdatedAt
      : latest;
  }, project.updatedAt ?? null);
}

function prioritySortRank(value: Priority) {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

function priorityGroupSortRank(value: string) {
  switch (value.toLowerCase()) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "none":
      return 3;
    default:
      return 4;
  }
}

function projectCompletionPercent(project: WorkspaceProject) {
  if (project.taskTotalCount === 0) {
    return 0;
  }

  return Math.round((project.taskDoneCount / project.taskTotalCount) * 100);
}

function formatProjectProgress(project: WorkspaceProject) {
  return `${projectCompletionPercent(project).toString()}%`;
}

function parseProgressGroup(value: string) {
  const match = /^(\d+)%$/.exec(value);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function defaultTaskPayload(currentUserId: string): CreateTaskPayload {
  return {
    projectId: "",
    title: "",
    notes: "",
    assigneeUserId: currentUserId,
    dueDate: "",
    priority: "medium",
    status: "not_started",
  };
}

function buildReviewTaskDraft(
  currentUserId: string,
  task: WorkspaceTask,
): CreateTaskPayload {
  return {
    ...defaultTaskPayload(currentUserId),
    dueDate: toDateInput(task.dueDate),
    priority: task.priority,
    title: `review ${task.title}`,
  };
}

function nextTaskPayload(
  currentUserId: string,
  previousPayload: CreateTaskPayload,
): CreateTaskPayload {
  const nextPayload = defaultTaskPayload(currentUserId);

  return {
    ...nextPayload,
    assigneeUserId: previousPayload.assigneeUserId,
    priority: previousPayload.priority ?? nextPayload.priority,
  };
}

function shouldOpenReviewTaskDraft(
  task: WorkspaceTask,
  payload: UpdateTaskPayload,
) {
  return task.status !== "review" && payload.status === "review";
}

function reorderWorkspaceProjectTasks(
  current: WorkspaceResponse | undefined,
  projectId: string,
  orderedTaskIds: string[],
) {
  if (!current) {
    return current;
  }

  return {
    ...current,
    projects: current.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            tasks: reorderTasksByIds(project.tasks, orderedTaskIds),
          }
        : project,
    ),
  };
}

function reorderTasksByIds(tasks: WorkspaceTask[], orderedTaskIds: string[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));

  return orderedTaskIds
    .map((taskId, index) => {
      const task = taskById.get(taskId);

      if (!task) {
        return null;
      }

      return {
        ...task,
        sortOrder: index,
      };
    })
    .filter((task): task is WorkspaceTask => task !== null);
}

function moveTaskIdRelative(
  taskIds: string[],
  draggedTaskId: string,
  targetTaskId: string,
  position: TaskDropPosition,
) {
  if (draggedTaskId === targetTaskId) {
    return taskIds;
  }

  const nextTaskIds = [...taskIds];
  const draggedIndex = nextTaskIds.indexOf(draggedTaskId);
  const targetIndex = nextTaskIds.indexOf(targetTaskId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return taskIds;
  }

  nextTaskIds.splice(draggedIndex, 1);

  let insertIndex = targetIndex;

  if (draggedIndex < targetIndex) {
    insertIndex -= 1;
  }

  if (position === "after") {
    insertIndex += 1;
  }

  nextTaskIds.splice(insertIndex, 0, draggedTaskId);
  return nextTaskIds;
}

function readTaskDropPosition(event: ReactDragEvent<HTMLTableRowElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
}

function normalizeCreateProjectPayload(
  project: CreateProjectPayload,
): CreateProjectPayload {
  const trimmedNotes = project.notes.trim();
  const normalizedReferences = normalizeProjectReferences(project.references);

  return {
    ...project,
    notes: trimmedNotes,
    ownerUserId: project.ownerUserId === "" ? null : project.ownerUserId,
    references: normalizedReferences,
  };
}

function normalizeProjectDraftPayload(
  projectDraft: UpdateProjectPayload,
): UpdateProjectPayload {
  const trimmedNotes = projectDraft.notes?.trim() ?? "";
  const normalizedReferences = normalizeProjectReferences(
    projectDraft.references ?? "",
  );

  return {
    ...projectDraft,
    manualStatus:
      projectDraft.manualStatus === undefined
        ? null
        : projectDraft.manualStatus,
    notes: trimmedNotes ? trimmedNotes : null,
    ownerUserId:
      projectDraft.ownerUserId === undefined
        ? undefined
        : projectDraft.ownerUserId === ""
          ? null
          : projectDraft.ownerUserId,
    references: normalizedReferences ? normalizedReferences : null,
  };
}

function normalizeProjectReferences(value: string) {
  return parseProjectReferences(value).join("\n");
}

function parseProjectReferences(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/u)
    .map((reference) => reference.trim())
    .filter((reference) => reference.length > 0);
}

function toProjectReferenceHref(reference: string) {
  if (!/^https?:\/\//i.test(reference)) {
    return null;
  }

  try {
    const parsed = new URL(reference);

    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? reference
      : null;
  } catch {
    return null;
  }
}

function formatProjectReferenceLabel(reference: string) {
  const referenceHref = toProjectReferenceHref(reference);

  if (!referenceHref) {
    return truncateDisplayLinkLabel(reference);
  }

  const fileName = extractUrlFilename(referenceHref);

  if (fileName) {
    return truncateDisplayLinkLabel(fileName);
  }

  const parsed = new URL(referenceHref);
  const normalizedPath = parsed.pathname.replace(/\/+$/u, "");

  return truncateDisplayLinkLabel(
    normalizedPath ? `${parsed.host}${normalizedPath}` : parsed.host,
  );
}

function normalizeTaskDraftPayload(
  taskDraft: UpdateTaskPayload,
): UpdateTaskPayload {
  const trimmedNotes = taskDraft.notes?.trim() ?? "";

  return {
    ...taskDraft,
    assigneeUserId:
      taskDraft.assigneeUserId === undefined
        ? undefined
        : taskDraft.assigneeUserId === ""
          ? null
          : taskDraft.assigneeUserId,
    notes: trimmedNotes ? trimmedNotes : null,
  };
}

function formatProjectOwnerLabel(ownerName: string | null) {
  return ownerName ?? NO_PROJECT_OWNER_LABEL;
}

function formatProjectStatusPillLabel(
  status: ProjectStatus,
  manualStatus: ProjectStatus | null,
) {
  return `${manualStatus ? "Override · " : ""}${formatStatusLabel(status)}`;
}

function formatProjectOwnerGroupLabel(ownerName: string | null) {
  return ownerName ?? NO_PROJECT_OWNER_GROUP;
}

function canConvertProjectToTask(
  project: WorkspaceProject,
  projectDraft: UpdateProjectPayload,
) {
  return projectConvertToTaskNote(project, projectDraft) === null;
}

function projectConvertToTaskNote(
  project: WorkspaceProject,
  projectDraft: UpdateProjectPayload,
) {
  const nextTitle = projectDraft.title ?? project.title;

  if (!nextTitle.trim()) {
    return "Add a title before converting this project into a task.";
  }

  if (project.taskTotalCount > 0) {
    return `Move or delete this project's ${project.taskTotalCount.toString()} active task${project.taskTotalCount === 1 ? "" : "s"} before converting it into a task.`;
  }

  if (isUnassignedProjectTitle(nextTitle)) {
    return `"${UNASSIGNED_PROJECT_TITLE}" stays reserved as the holding project for converted tasks.`;
  }

  return null;
}

function buildSavedViewPayload({
  assigneeUserIds,
  groupBy,
  search,
  sortBy,
  statusFilters,
  collapsedGroups,
  expandedProjects,
}: {
  assigneeUserIds: string[];
  groupBy: GroupBy;
  search: string;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
  collapsedGroups: Record<string, boolean>;
  expandedProjects: Record<string, boolean>;
}) {
  return {
    assigneeUserIds,
    groupBy,
    search,
    sortBy,
    statusFilters,
    collapsedGroupKeys: activeSelectionKeys(collapsedGroups),
    expandedProjectIds: activeSelectionKeys(expandedProjects),
  };
}

function activeSelectionKeys(selection: Record<string, boolean>) {
  return Object.entries(selection)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function toSelectionMap(values: string[]) {
  return Object.fromEntries(values.map((value) => [value, true]));
}

function formatStatusLabel(value: ProjectStatus | TaskStatus | "todo") {
  return STATUS_LABELS[value];
}

function statusLabelSortRank(value: string) {
  const optionIndex = WORK_ITEM_STATUS_OPTIONS.findIndex(
    (option) => option.label === value,
  );

  if (optionIndex >= 0) {
    return optionIndex;
  }

  if (value === STATUS_LABELS.todo) {
    return 0;
  }

  return Number.MAX_SAFE_INTEGER;
}

function findProjectIdForTask(
  projects: WorkspaceProject[],
  taskId: string,
): string | null {
  for (const project of projects) {
    if (project.tasks.some((task) => task.id === taskId)) {
      return project.id;
    }
  }

  return null;
}

function snapshotProjectDisplayStatuses(
  projects: WorkspaceProject[],
  projectIds: string[],
) {
  const targetProjectIds = new Set(projectIds);
  const statuses = new Map<string, ProjectStatus>();

  for (const project of projects) {
    if (targetProjectIds.has(project.id)) {
      statuses.set(project.id, project.displayStatus);
    }
  }

  return statuses;
}

function snapshotProjectDisplayStatusesForTasks(
  projects: WorkspaceProject[],
  taskIds: string[],
) {
  const targetTaskIds = new Set(taskIds);
  const statuses = new Map<string, ProjectStatus>();

  for (const project of projects) {
    if (project.tasks.some((task) => targetTaskIds.has(task.id))) {
      statuses.set(project.id, project.displayStatus);
    }
  }

  return statuses;
}

function findFirstRegroupedProjectId(
  previousProjectStatuses: Map<string, ProjectStatus>,
  projects: WorkspaceProject[],
) {
  for (const project of projects) {
    if (
      previousProjectStatuses.has(project.id) &&
      previousProjectStatuses.get(project.id) !== project.displayStatus
    ) {
      return project.id;
    }
  }

  return null;
}

function clearViewedChangesForProjects(
  current: WorkspaceResponse | undefined,
  projectIds: string[],
  viewedAt: Date | string,
) {
  if (!current || projectIds.length === 0) {
    return current;
  }

  const viewedProjectIds = new Set(projectIds);
  const viewedAtValue =
    viewedAt instanceof Date ? viewedAt.toISOString() : viewedAt;

  return {
    ...current,
    projects: current.projects.map((project) =>
      viewedProjectIds.has(project.id)
        ? {
            ...project,
            hasUnviewedChanges: false,
            lastViewedAt: viewedAtValue,
            tasks: project.tasks.map((task) => ({
              ...task,
              hasUnviewedChanges: false,
            })),
          }
        : project,
    ),
  };
}

function formatPriorityLabel(value: Priority) {
  return value[0].toUpperCase() + value.slice(1);
}

function formatProjectSortFieldLabel(value: ProjectSortField) {
  switch (value) {
    case "dueDate":
      return "Due date";
    case "age":
      return "Age";
    case "lastUpdated":
      return "Last updated";
    case "progress":
      return "Progress";
    case "priority":
      return "Priority";
    case "title":
      return "Title";
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(
    new Date(value),
  );
}

function toLocalDayBoundaryIso(value: string, boundary: "start" | "end") {
  const [year, month, day] = value.split("-").map((part) => Number(part));

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return undefined;
  }

  const date =
    boundary === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);

  return date.toISOString();
}

function toDateInput(value: string | null) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function isUnassignedProjectTitle(value: string) {
  return value.trim().toLowerCase() === UNASSIGNED_PROJECT_TITLE.toLowerCase();
}

function normalizeWorkspaceFilterState(
  value: Partial<WorkspaceFilterState>,
): WorkspaceFilterState {
  return {
    assigneeUserIds: uniqueStringArray(value.assigneeUserIds ?? []),
    groupBy: isGroupBy(value.groupBy) ? value.groupBy : "owner",
    notViewedOnly: value.notViewedOnly === true,
    sortBy: normalizeProjectSortBy(value.sortBy ?? []),
    statusFilters: uniqueStringArray(
      (value.statusFilters ?? []).filter(isProjectStatus),
    ),
  };
}

function normalizeCollapsedGroupsByGroup(
  value: WorkspaceCollapsedGroups | null | undefined,
): WorkspaceCollapsedGroups {
  return Object.fromEntries(
    Object.entries(value ?? {}).flatMap(([targetGroupBy, selection]) => {
      if (!isGroupBy(targetGroupBy)) {
        return [];
      }

      const normalizedSelection =
        selection && typeof selection === "object" && !Array.isArray(selection)
          ? normalizeBooleanSelection(selection as Record<string, unknown>)
          : {};

      return Object.keys(normalizedSelection).length === 0
        ? []
        : [[targetGroupBy, normalizedSelection]];
    }),
  ) as WorkspaceCollapsedGroups;
}

function activeCollapsedGroupsByGroup(
  value: WorkspaceCollapsedGroups,
): WorkspaceCollapsedGroups {
  return Object.fromEntries(
    Object.entries(value).flatMap(([targetGroupBy, selection]) => {
      if (!isGroupBy(targetGroupBy)) {
        return [];
      }

      const activeSelection = activeBooleanSelection(selection);

      return Object.keys(activeSelection).length === 0
        ? []
        : [[targetGroupBy, activeSelection]];
    }),
  ) as WorkspaceCollapsedGroups;
}

function shouldHandleNonInteractiveRowClick(
  event: React.MouseEvent<HTMLElement>,
) {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }

  if (
    event.target instanceof Element &&
    event.target.closest(ROW_EDIT_INTERACTIVE_SELECTOR)
  ) {
    return false;
  }

  return true;
}

function shouldOpenEditorFromModifierClick(
  event: React.MouseEvent<HTMLElement>,
) {
  if (
    !shouldHandleNonInteractiveRowClick(event) ||
    !(event.ctrlKey || event.metaKey)
  ) {
    return false;
  }

  event.preventDefault();
  return true;
}

function shouldToggleProjectFromRowClick(event: React.MouseEvent<HTMLElement>) {
  return (
    shouldHandleNonInteractiveRowClick(event) &&
    !(event.ctrlKey || event.metaKey)
  );
}

function normalizePasswordResetCodeInput(value: string) {
  const hex = value
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 8);

  if (hex.length <= 4) {
    return hex;
  }

  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

function readWorkspaceSearchQueryFromLocation() {
  if (typeof globalThis.location?.href !== "string") {
    return "";
  }

  return new URL(globalThis.location.href).searchParams.get("search") ?? "";
}

function syncWorkspaceSearchQueryInLocation(search: string) {
  if (
    typeof globalThis.location?.href !== "string" ||
    typeof globalThis.history?.replaceState !== "function"
  ) {
    return;
  }

  const currentUrl = new URL(globalThis.location.href);
  const nextSearch = search.trim().length === 0 ? null : search;
  const currentQueryValue = currentUrl.searchParams.get("search");

  if (currentQueryValue === nextSearch) {
    return;
  }

  if (nextSearch === null) {
    currentUrl.searchParams.delete("search");
  } else {
    currentUrl.searchParams.set("search", nextSearch);
  }

  const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  const currentRelativeUrl = `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;

  if (nextUrl === currentRelativeUrl) {
    return;
  }

  globalThis.history.replaceState(null, "", nextUrl);
}

function buildWorkspaceSearchLink(appHomeUrl: string, search: string) {
  const baseOrigin =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : "https://tavi";
  const workspaceUrl = new URL(appHomeUrl, baseOrigin);
  const workspacePath =
    workspaceUrl.pathname === "/" ? "" : workspaceUrl.pathname;

  workspaceUrl.search = "";
  workspaceUrl.searchParams.set("search", search);
  return `${workspaceUrl.origin}${workspacePath}${workspaceUrl.search}${workspaceUrl.hash}`;
}

function revealElementInViewport(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  const viewportHeight = Math.max(
    globalThis.innerHeight,
    document.documentElement.clientHeight,
  );
  const bounds = element.getBoundingClientRect();
  const aboveViewport = bounds.top < EDITOR_SCROLL_TOP_MARGIN;
  const belowViewport =
    bounds.bottom > viewportHeight - EDITOR_SCROLL_BOTTOM_MARGIN;

  if (
    (aboveViewport || belowViewport) &&
    typeof element.scrollIntoView === "function"
  ) {
    element.scrollIntoView({
      block: aboveViewport ? "start" : "end",
      inline: "nearest",
    });
  }
}

function findTaskRowElementById(taskId: string) {
  return (
    Array.from(document.querySelectorAll<HTMLElement>("[data-task-row-id]")).find(
      (element) => element.dataset.taskRowId === taskId,
    ) ?? null
  );
}

function readViewportScrollOffset() {
  return Math.max(
    typeof globalThis.scrollY === "number" ? globalThis.scrollY : 0,
    typeof globalThis.pageYOffset === "number" ? globalThis.pageYOffset : 0,
    document.documentElement?.scrollTop ?? 0,
    document.body?.scrollTop ?? 0,
  );
}

function normalizeNoteEditorHeights(
  value: Partial<NoteEditorHeights>,
): NoteEditorHeights {
  return {
    project: normalizeNoteEditorHeight(value.project),
    task: normalizeNoteEditorHeight(value.task),
  };
}

function normalizeNoteEditorHeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function readTextareaHeight(textarea: HTMLTextAreaElement) {
  return normalizeNoteEditorHeight(textarea.offsetHeight);
}

function toTextareaStyle(
  height: number | null,
): React.CSSProperties | undefined {
  return height === null ? undefined : { height: `${height.toString()}px` };
}

function uniqueStringArray<Value extends string>(values: Value[]) {
  return [...new Set(values)];
}

function normalizeProjectSortBy(values: ProjectSortField[]) {
  return uniqueStringArray(values.filter(isProjectSortField));
}

function sameStringArray<Value extends string>(left: Value[], right: Value[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameWorkspacePreferences(
  left: WorkspacePreferences,
  right: WorkspacePreferences,
) {
  return (
    left.autoCollapse === right.autoCollapse &&
    left.bulkActions === right.bulkActions &&
    left.fullWidth === right.fullWidth &&
    left.theme === right.theme
  );
}

function sameBooleanSelection(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
) {
  return sameStringArray(activeSelectionKeys(left), activeSelectionKeys(right));
}

function serializeWorkspaceUserConfig(
  value: WorkspaceUserConfig | WorkspaceUserConfigWithFilters,
) {
  const normalized = normalizeWorkspaceUserConfig(value);

  return JSON.stringify({
    addTaskPanels: sortBooleanSelection(normalized.addTaskPanels),
    collapsedGroups: sortCollapsedGroups(normalized.collapsedGroups),
    filters: {
      assigneeUserIds: [...normalized.filters.assigneeUserIds],
      groupBy: normalized.filters.groupBy,
      notViewedOnly: normalized.filters.notViewedOnly,
      sortBy: [...normalized.filters.sortBy],
      statusFilters: [...normalized.filters.statusFilters],
    },
    hideDonePersonalTodos: normalized.hideDonePersonalTodos,
    hideDoneTasksByProject: sortBooleanSelection(
      normalized.hideDoneTasksByProject,
    ),
    noteEditorHeights: normalized.noteEditorHeights,
    panels: normalized.panels,
    preferences: normalized.preferences,
  });
}

function sortBooleanSelection(selection: Record<string, boolean>) {
  return Object.fromEntries(
    Object.entries(selection).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey),
    ),
  );
}

function sortCollapsedGroups(value: WorkspaceCollapsedGroups) {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([groupBy, selection]) => [
        groupBy,
        sortBooleanSelection(selection),
      ]),
  );
}

function isGroupBy(value: unknown): value is GroupBy {
  return (
    value === "none" ||
    value === "owner" ||
    value === "priority" ||
    value === "progress" ||
    value === "status"
  );
}

function isProjectSortField(value: string): value is ProjectSortField {
  return PROJECT_SORT_OPTIONS.some((option) => option.value === value);
}

function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUS_FILTER_OPTIONS.some((option) => option.value === value);
}

type WorkspaceMenuOption<Value extends string> = {
  label: string;
  value: Value;
};

type ProjectPickerControlProps = {
  currentUser: WorkspaceUser;
  includeConvertToProject?: boolean;
  label: string;
  onChange: (projectId: string) => void;
  projects: WorkspaceProject[];
  selectedProjectId: string;
  users: Record<string, WorkspaceUser>;
};

function ProjectPickerControl({
  currentUser,
  includeConvertToProject = false,
  label,
  onChange,
  projects,
  selectedProjectId,
  users,
}: ProjectPickerControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [sortField, setSortField] =
    useState<ProjectPickerSortField>("alpha");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputId = useId();
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );
  const selectedLabel =
    selectedProjectId === CONVERT_TASK_TO_PROJECT_VALUE
      ? "Convert to Project"
      : (selectedProject?.title ?? "Select project");
  const sortedProjects = useMemo(
    () =>
      getProjectPickerProjects({
        currentUser,
        projects,
        query,
        showHidden,
        sortField,
        users,
      }),
    [currentUser, projects, query, showHidden, sortField, users],
  );

  const closePicker = useCallback(() => {
    setIsOpen(false);
  }, []);
  const selectProject = (projectId: string) => {
    onChange(projectId);
    setQuery("");
    closePicker();
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closePicker();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePicker();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePicker, isOpen]);

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="workspace-filter workspace-filter--popup project-picker"
    >
      <button
        type="button"
        className={`workspace-filter-trigger project-picker-trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (isOpen) {
            closePicker();
            return;
          }

          setQuery("");
          setIsOpen(true);
        }}
      >
        <span className="project-picker-trigger-label">
          {label}: {selectedLabel}
        </span>
      </button>

      {isOpen ? (
        <div
          className="workspace-multi-filter-menu project-picker-menu"
          role="dialog"
          aria-label={label}
        >
          <label className="project-picker-search" htmlFor={searchInputId}>
            Search projects
          </label>
          <input
            id={searchInputId}
            ref={searchInputRef}
            aria-label={`${label} search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a project name"
          />

          <label className="project-picker-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
            />
            <span>Show hidden</span>
          </label>

          <div className="project-picker-sort-buttons" aria-label="Sort projects">
            {PROJECT_PICKER_SORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`ghost-button compact-button project-picker-sort-button${sortField === option.value ? " is-active" : ""}`}
                aria-pressed={sortField === option.value}
                onClick={() => setSortField(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="project-picker-results">
            {sortedProjects.length > 0 ? (
              sortedProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`project-picker-option${project.id === selectedProjectId ? " is-selected" : ""}`}
                  aria-label={`Select project ${project.title}`}
                  onClick={() => selectProject(project.id)}
                >
                  <span className="project-picker-option-title">
                    {project.title}
                  </span>
                  <span className="project-picker-option-meta">
                    {formatStatusLabel(project.displayStatus)} ·{" "}
                    {formatProjectPickerOwner(project, users, currentUser)} ·{" "}
                    {formatDate(latestProjectActivity(project))}
                  </span>
                </button>
              ))
            ) : (
              <p className="project-picker-empty">No matching projects</p>
            )}
          </div>

          {includeConvertToProject ? (
            <button
              type="button"
              className={`ghost-button compact-button project-picker-convert${selectedProjectId === CONVERT_TASK_TO_PROJECT_VALUE ? " is-active" : ""}`}
              aria-pressed={selectedProjectId === CONVERT_TASK_TO_PROJECT_VALUE}
              onClick={() => selectProject(CONVERT_TASK_TO_PROJECT_VALUE)}
            >
              Convert to Project
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getProjectPickerProjects({
  currentUser,
  projects,
  query,
  showHidden,
  sortField,
  users,
}: {
  currentUser: WorkspaceUser;
  projects: WorkspaceProject[];
  query: string;
  showHidden: boolean;
  sortField: ProjectPickerSortField;
  users: Record<string, WorkspaceUser>;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  return projects
    .filter(
      (project) =>
        (showHidden || !isProjectPickerHiddenProject(project)) &&
        (!normalizedQuery ||
          project.title.toLowerCase().includes(normalizedQuery)),
    )
    .map((project, index) => ({ index, project }))
    .sort((left, right) => {
      const result = compareProjectPickerProjects(
        left.project,
        right.project,
        sortField,
        users,
        currentUser,
      );

      return result === 0 ? left.index - right.index : result;
    })
    .map(({ project }) => project);
}

function compareProjectPickerProjects(
  left: WorkspaceProject,
  right: WorkspaceProject,
  sortField: ProjectPickerSortField,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  switch (sortField) {
    case "date":
      return compareNullableDateValues(
        latestProjectActivity(right),
        latestProjectActivity(left),
      );
    case "status":
      return (
        statusLabelSortRank(formatStatusLabel(left.displayStatus)) -
        statusLabelSortRank(formatStatusLabel(right.displayStatus))
      );
    case "assignee":
      return formatProjectPickerOwner(left, users, currentUser).localeCompare(
        formatProjectPickerOwner(right, users, currentUser),
        undefined,
        { sensitivity: "base" },
      );
    case "alpha":
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
  }
}

function isProjectPickerHiddenProject(project: WorkspaceProject) {
  return PROJECT_PICKER_HIDDEN_PROJECT_STATUSES.has(project.displayStatus);
}

function formatProjectPickerOwner(
  project: WorkspaceProject,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (project.ownerUserId) {
    return formatUserReference(project.ownerUserId, users, currentUser);
  }

  return project.ownerName ?? NO_PROJECT_OWNER_GROUP;
}

type MultiSelectFilterProps = {
  label: string;
  onChange: (values: string[]) => void;
  options: WorkspaceMenuOption<string>[];
  selectedValues: string[];
};

function MultiSelectFilter({
  label,
  onChange,
  options,
  selectedValues,
}: MultiSelectFilterProps) {
  const [draftValues, setDraftValues] = useState<string[]>(selectedValues);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? `${label}: All`
      : selectedLabels.length <= 2
        ? `${label}: ${selectedLabels.join(", ")}`
        : `${label}: ${selectedLabels.length.toString()} selected`;

  const applyAndClose = () => {
    onChange(
      options
        .filter((option) => draftValues.includes(option.value))
        .map((option) => option.value),
    );
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onChange(
          options
            .filter((option) => draftValues.includes(option.value))
            .map((option) => option.value),
        );
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraftValues(selectedValues);
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, draftValues, onChange, options, selectedValues]);

  return (
    <div
      ref={containerRef}
      className="workspace-filter workspace-filter--multi workspace-filter--popup"
    >
      <button
        type="button"
        className={`workspace-filter-trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (isOpen) {
            applyAndClose();
            return;
          }

          setDraftValues(selectedValues);
          setIsOpen(true);
        }}
      >
        {summary}
      </button>

      {isOpen ? (
        <div
          className="workspace-multi-filter-menu"
          role="dialog"
          aria-label={label}
        >
          {options.map((option) => {
            const checked = draftValues.includes(option.value);

            return (
              <label
                key={option.value}
                className="workspace-multi-filter-option"
              >
                <input
                  checked={checked}
                  onChange={() =>
                    setDraftValues((current) =>
                      checked
                        ? current.filter((value) => value !== option.value)
                        : [...current, option.value],
                    )
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            );
          })}

          <div className="workspace-multi-filter-actions">
            {draftValues.length > 0 ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => setDraftValues([])}
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="workspace-filter-apply"
              aria-label={`Apply ${label.toLowerCase()}`}
              onClick={applyAndClose}
              title={`Apply ${label.toLowerCase()}`}
            >
              ✓
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type MultiSortFilterProps = {
  label: string;
  onChange: (values: ProjectSortField[]) => void;
  options: WorkspaceMenuOption<ProjectSortField>[];
  selectedValues: ProjectSortField[];
};

function MultiSortFilter({
  label,
  onChange,
  options,
  selectedValues,
}: MultiSortFilterProps) {
  const [draftValues, setDraftValues] = useState<
    Record<ProjectSortField, number | null>
  >(() => toProjectSortDraft(selectedValues, options));
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = selectedValues
    .map((value) => options.find((option) => option.value === value)?.label)
    .filter((value): value is string => Boolean(value));
  const summary =
    selectedLabels.length === 0
      ? `${label}: Default`
      : selectedLabels.length <= 2
        ? `${label}: ${selectedLabels
            .map(
              (selectedLabel, index) =>
                `${(index + 1).toString()} ${selectedLabel}`,
            )
            .join(", ")}`
        : `${label}: ${selectedLabels.length.toString()} fields`;

  const applyAndClose = () => {
    onChange(normalizeProjectSortDraft(draftValues, options));
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onChange(normalizeProjectSortDraft(draftValues, options));
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraftValues(toProjectSortDraft(selectedValues, options));
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draftValues, isOpen, onChange, options, selectedValues]);

  return (
    <div
      ref={containerRef}
      className="workspace-filter workspace-filter--multi workspace-filter--popup"
    >
      <button
        type="button"
        className={`workspace-filter-trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (isOpen) {
            applyAndClose();
            return;
          }

          setDraftValues(toProjectSortDraft(selectedValues, options));
          setIsOpen(true);
        }}
      >
        {summary}
      </button>

      {isOpen ? (
        <div
          className="workspace-multi-filter-menu"
          role="dialog"
          aria-label={label}
        >
          {options.map((option) => {
            const selectedOrder = draftValues[option.value];

            return (
              <div key={option.value} className="workspace-multi-filter-option">
                <button
                  type="button"
                  className={`sort-order-button${selectedOrder ? " is-active" : ""}`}
                  aria-label={
                    selectedOrder
                      ? `${option.label} sort order ${selectedOrder.toString()}`
                      : `${option.label} not included in the current sort`
                  }
                  onClick={() =>
                    setDraftValues((current) => ({
                      ...current,
                      [option.value]: nextSortOrder(
                        current[option.value] ?? null,
                        options.length,
                      ),
                    }))
                  }
                >
                  {selectedOrder ?? ""}
                </button>
                <span>{option.label}</span>
              </div>
            );
          })}

          <div className="workspace-multi-filter-actions">
            {hasProjectSortDraft(draftValues) ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() =>
                  setDraftValues(createEmptyProjectSortDraft(options))
                }
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="workspace-filter-apply"
              aria-label="Apply sort"
              onClick={applyAndClose}
              title="Apply sort"
            >
              ✓
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createEmptyProjectSortDraft(
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  return Object.fromEntries(
    options.map((option) => [option.value, null]),
  ) as Record<ProjectSortField, number | null>;
}

function toProjectSortDraft(
  selectedValues: ProjectSortField[],
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  const draft = createEmptyProjectSortDraft(options);

  selectedValues.forEach((value, index) => {
    if (value in draft) {
      draft[value] = index + 1;
    }
  });

  return draft;
}

function normalizeProjectSortDraft(
  draft: Record<ProjectSortField, number | null>,
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  return options
    .map((option, index) => ({
      index,
      order: draft[option.value],
      value: option.value,
    }))
    .filter(
      (
        entry,
      ): entry is {
        index: number;
        order: number;
        value: ProjectSortField;
      } => typeof entry.order === "number",
    )
    .sort((left, right) =>
      left.order === right.order
        ? left.index - right.index
        : left.order - right.order,
    )
    .map((entry) => entry.value);
}

function nextSortOrder(current: number | null, maxOrder: number) {
  if (current === null) {
    return 1;
  }

  return current >= maxOrder ? null : current + 1;
}

function hasProjectSortDraft(draft: Record<ProjectSortField, number | null>) {
  return Object.values(draft).some((value) => value !== null);
}

export default App;
