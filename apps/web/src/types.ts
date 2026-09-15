import type {
  ApplyBackupRestoreInput,
  AuditEntityType,
  CreatePersonalTodoInput,
  CreateLocalAccountInput,
  GroupBy,
  ImportPersonalTodosInput,
  ImportLocalAccountsInput,
  ImportRowOutcome,
  LoopImportField,
  LoopImportMissingUser,
  LoopImportMissingAssignee,
  LoopImportOverlapAction,
  LoopImportJobStatus,
  ProjectSortField,
  RequestPasswordResetInput,
  Priority,
  ResetPasswordWithOtpInput,
  PersonalTodo,
  ReorderPersonalTodosInput,
  PruneRetentionDataInput,
  ProjectStatus,
  ResetWorkspaceExamplesInput,
  Role,
  SetLocalAccountPasswordInput,
  SetOwnPasswordInput,
  UpdateRetentionSettingsInput,
  TaskStatus,
  UpdateLocalAccountInput,
  UpdateOwnProfileInput,
  UpdatePersonalTodoInput,
  UpdateNotificationPreferencesInput,
  UpdateLoopImportRowDecisionsInput,
  UpdateEmailSettingsInput,
  UpdateBackupSettingsInput,
  UpdateBackupProtectionInput,
  WorkspaceUserConfig,
} from "@tavi/schemas";

export type {
  ApplyBackupRestoreResult,
  AuditChangesQuery as AuditChangesQueryPayload,
  AuditEmailsQuery as AuditEmailsQueryPayload,
  AuditEntityType,
  AuditLogRetentionPolicy,
  AuditLogRetentionWindow,
  AuditLoginsQuery as AuditLoginsQueryPayload,
  BackupRetentionSummary,
  BackupRetentionWindow,
  BackupRestorePreview,
  BackupStatus,
  ClearAllLocalAccountsInput as ClearAllLocalAccountsPayload,
  ClearAllLocalAccountsResponse,
  ConvertProjectToTaskResponse,
  ConvertTaskToProjectResponse,
  DeleteLocalAccountInput as DeleteLocalAccountPayload,
  DeleteLocalAccountResponse,
  DeletePersonalTodoResponse,
  DeleteProjectResponse,
  DeleteTaskResponse,
  EmailAuditEvent,
  EmailSettings,
  ExportLocalAccountsResponse,
  ImportPersonalTodosResponse,
  GroupBy,
  ImportLocalAccountsResponse,
  ImportRowOutcome,
  LogRetentionSummary,
  LogRetentionWindow,
  LocalAccount,
  LocalLoginHintResponse,
  LocalAccountResponse,
  LocalAccountsResponse,
  LoopImportField,
  LoopImportMissingUser,
  LoopImportMissingAssignee,
  LoopImportOverlapAction,
  LoopImportJobStatus,
  MarkAllProjectsViewedResponse,
  MarkProjectViewedResponse,
  NotificationPreferences,
  NotificationRetentionSummary,
  NotificationRetentionWindow,
  PersonalTodo,
  PersonalTodoStatus,
  PruneRetentionDataResponse,
  ProjectSortField,
  Priority,
  ProjectStatus,
  PurgeAuditLogsInput as PurgeAuditLogsPayload,
  PurgeAuditLogsResponse,
  ResetWorkspaceExamplesResponse,
  RetentionStatus,
  RetentionTarget,
  Role,
  ResetDefaultLocalAccountsResponse,
  SetAuditLogRetentionInput as SetAuditLogRetentionPayload,
  SmtpStatus,
  SuccessResponse,
  TaskStatus,
  UploadBackupFileInput,
  WorkspacePreferences,
  WorkspaceTheme,
  WorkspaceUserConfig,
  ResetUserSettingsResponse,
} from "@tavi/schemas";

export type WorkspaceUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type WorkspaceTask = {
  id: string;
  projectId: string;
  title: string;
  notes: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  priority: Priority;
  status: TaskStatus;
  sortOrder: number;
  completedAt: string | null;
  hasUnviewedChanges?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspacePersonalTodo = PersonalTodo;

export type WorkspaceProject = {
  id: string;
  title: string;
  notes: string | null;
  references: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  priority: Priority;
  derivedStatus: ProjectStatus;
  displayStatus: ProjectStatus;
  manualStatus: ProjectStatus | null;
  taskTotalCount: number;
  taskTodoCount: number;
  taskInProgressCount: number;
  taskBlockedCount: number;
  taskDoneCount: number;
  taskCanceledCount: number;
  taskOverdueCount: number;
  hasUnviewedChanges?: boolean;
  lastViewedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  tasks: WorkspaceTask[];
};

export type SavedView = {
  id: string;
  name: string;
  groupBy: GroupBy;
  search: string;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
  assigneeUserIds: string[];
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSettings = {
  dragHandlesEnabled: boolean;
};

export type WorkspaceResponse = {
  currentUser: WorkspaceUser;
  personalTodos: WorkspacePersonalTodo[];
  users: WorkspaceUser[];
  projects: WorkspaceProject[];
  savedViews: SavedView[];
  userConfig: WorkspaceUserConfig;
  workspaceSettings?: WorkspaceSettings;
};

export type AuditHistoryActor = {
  id: string | null;
  email: string;
  name: string;
  role: Role;
};

export type AuditHistoryEvent = {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: AuditHistoryActor;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type RequestPasswordResetPayload = RequestPasswordResetInput;

export type ResetPasswordWithOtpPayload = ResetPasswordWithOtpInput;

export type CreateLocalAccountPayload = CreateLocalAccountInput;

export type UpdateLocalAccountPayload = UpdateLocalAccountInput;

export type SetLocalAccountPasswordPayload = SetLocalAccountPasswordInput;

export type SetOwnPasswordPayload = SetOwnPasswordInput;

export type UpdateOwnProfilePayload = UpdateOwnProfileInput;

export type ImportLocalAccountsPayload = ImportLocalAccountsInput;

export type ResetWorkspaceExamplesPayload = ResetWorkspaceExamplesInput;

export type UpdateRetentionSettingsPayload = UpdateRetentionSettingsInput;

export type PruneRetentionDataPayload = PruneRetentionDataInput;

export type CreateProjectPayload = {
  title: string;
  notes: string;
  references: string;
  ownerUserId: string | null;
  dueDate: string;
  priority: Priority;
};

export type UpdateProjectPayload = Omit<
  Partial<CreateProjectPayload>,
  "notes" | "references"
> & {
  manualStatus?: ProjectStatus | null;
  notes?: string | null;
  references?: string | null;
};

export type CreateTaskPayload = {
  projectId: string;
  title: string;
  notes: string;
  assigneeUserId: string | null;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
};

export type CreatePersonalTodoPayload = CreatePersonalTodoInput;

export type UpdateTaskPayload = Omit<
  Partial<CreateTaskPayload>,
  "assigneeUserId" | "notes"
> & {
  assigneeUserId?: string | null;
  notes?: string | null;
};

export type UpdatePersonalTodoPayload = UpdatePersonalTodoInput;

export type ImportPersonalTodosPayload = ImportPersonalTodosInput;

export type ReorderPersonalTodosPayload = ReorderPersonalTodosInput;

export type BulkUpdateTasksPayload = {
  taskIds: string[];
  assigneeUserId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  priority?: Priority;
  status?: TaskStatus;
};

export type BulkDeleteTasksPayload = {
  taskIds: string[];
};

export type BulkCopyTasksPayload = {
  targetProjectId: string;
  taskIds: string[];
};

export type SavedViewPayload = {
  name: string;
  groupBy: GroupBy;
  search: string;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
  assigneeUserIds: string[];
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
};

export type UpdateSavedViewPayload = Omit<SavedViewPayload, "name">;

export type RenameSavedViewPayload = Pick<SavedViewPayload, "name">;

export type LoopImportMapping = Partial<Record<LoopImportField, string | null>>;

export type LoopImportFieldDefinition = {
  key: LoopImportField;
  label: string;
  required: boolean;
  description: string;
};

export type LoopImportCreatedBy = {
  id: string;
  email: string;
  name: string;
};

export type LoopImportPreviewRow = {
  rowNumber: number;
  projectTitle: string | null;
  projectExternalId: string | null;
  projectIdentityStrategy: "natural_key" | "source_id";
  projectOverlap: {
    action: LoopImportOverlapAction;
    changedFields: string[];
    existingId: string;
    matchedBy: "natural_key" | "source_id";
    title: string;
  } | null;
  taskTitle: string | null;
  taskExternalId: string | null;
  taskIdentityStrategy: "natural_key" | "source_id";
  taskOverlap: {
    action: LoopImportOverlapAction;
    changedFields: string[];
    existingId: string;
    matchedBy: "natural_key" | "source_id";
    title: string;
  } | null;
  taskStatus: TaskStatus;
  errors: string[];
  warnings: string[];
};

export type LoopImportPreview = {
  blockingMissingUserRowCount: number;
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  warningRowCount: number;
  missingUserRowCount: number;
  missingUsers: LoopImportMissingUser[];
  missingTaskAssigneeRowCount: number;
  missingTaskAssignees: LoopImportMissingAssignee[];
  missingRequiredMappings: LoopImportField[];
  overlappingProjectRowCount: number;
  overlappingTaskRowCount: number;
  projectSourceIdRowCount: number;
  taskSourceIdRowCount: number;
  unmappedHeaders: string[];
  rows: LoopImportPreviewRow[];
};

export type LoopImportResultRow = {
  rowNumber: number;
  rowOutcome: ImportRowOutcome;
  projectOutcome: ImportRowOutcome;
  taskOutcome: ImportRowOutcome;
  projectId: string | null;
  taskId: string | null;
  message: string | null;
  validationErrors: string[];
};

export type LoopImportJobSummary = {
  id: string;
  fileName: string;
  sourceSystem: string;
  status: LoopImportJobStatus;
  totalRowCount: number;
  createdRowCount: number;
  updatedRowCount: number;
  skippedRowCount: number;
  failedRowCount: number;
  createdProjectCount: number;
  updatedProjectCount: number;
  createdTaskCount: number;
  updatedTaskCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy?: LoopImportCreatedBy;
};

export type LoopImportJob = LoopImportJobSummary & {
  fields: LoopImportFieldDefinition[];
  headers: string[];
  mapping: LoopImportMapping;
  suggestedMapping: LoopImportMapping;
  preview: LoopImportPreview;
  results: LoopImportResultRow[];
};

export type CreateLoopImportPayload = {
  fileName: string;
  content: string;
};

export type UpdateLoopImportMappingPayload = {
  mapping: LoopImportMapping;
};

export type UpdateLoopImportRowDecisionsPayload =
  UpdateLoopImportRowDecisionsInput;

export type UpdateEmailSettingsPayload = UpdateEmailSettingsInput;

export type UpdateNotificationPreferencesPayload =
  UpdateNotificationPreferencesInput;

export type UpdateBackupSettingsPayload = UpdateBackupSettingsInput;
export type UpdateBackupProtectionPayload = UpdateBackupProtectionInput;

export type PreviewBackupRestorePayload = {
  source: ApplyBackupRestoreInput["source"];
};

export type ApplyBackupRestorePayload = ApplyBackupRestoreInput;
