import { z } from "zod";

const PROJECT_NOTES_MAX_LENGTH = 2_000;
const TASK_NOTES_MAX_LENGTH = 2_000;
const REFERENCES_MAX_LENGTH = 2_048;

export type AuditChangeValue = boolean | number | string | null;

export type AuditChangeSet = {
  field: string;
  from: AuditChangeValue;
  to: AuditChangeValue;
};

export function toAuditChangeValue(
  value: Date | AuditChangeValue | undefined,
): AuditChangeValue {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return value ?? null;
}

export function buildAuditChanges<T extends Record<string, AuditChangeValue>>(
  changedFields: string[],
  previous: T,
  next: T,
): AuditChangeSet[] {
  return changedFields.map((field) => ({
    field,
    from: previous[field] ?? null,
    to: next[field] ?? null,
  }));
}

const referencesTextSchema = z.string().trim().max(REFERENCES_MAX_LENGTH);
const optionalReferencesSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  referencesTextSchema.optional(),
);
const nullableReferencesSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? null : value,
  referencesTextSchema.nullable().optional(),
);
const nullableUserIdSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? null : value,
  z.string().min(1).nullable().optional(),
);
const auditDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
const hourlyTimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):00$/, "Expected HH:00");

export const roleSchema = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const auditEntityTypeSchema = z.enum([
  "auth",
  "project",
  "task",
  "saved_view",
]);
export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;

export const auditLogRetentionWindowSchema = z.enum([
  "one_day",
  "one_week",
  "one_month",
  "three_months",
  "six_months",
  "one_year",
]);
export type AuditLogRetentionWindow = z.infer<
  typeof auditLogRetentionWindowSchema
>;

export const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "demo",
  "review",
  "done",
  "blocked",
  "on_hold",
  "canceled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const personalTodoStatusSchema = z.enum(["todo", "done"]);
export type PersonalTodoStatus = z.infer<typeof personalTodoStatusSchema>;

export const personalTodoRetentionPolicySchema = z.enum([
  "never",
  "one_month",
  "three_months",
  "six_months",
  "twelve_months",
  "delete_when_done",
]);
export type PersonalTodoRetentionPolicy = z.infer<
  typeof personalTodoRetentionPolicySchema
>;

export const projectStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "demo",
  "review",
  "done",
  "blocked",
  "on_hold",
  "canceled",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const prioritySchema = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof prioritySchema>;

export const projectSortFieldSchema = z.enum([
  "title",
  "progress",
  "priority",
  "dueDate",
  "age",
  "lastUpdated",
]);
export type ProjectSortField = z.infer<typeof projectSortFieldSchema>;

export const groupBySchema = z.enum([
  "none",
  "owner",
  "status",
  "priority",
  "progress",
]);
export type GroupBy = z.infer<typeof groupBySchema>;

export const workspaceThemeSchema = z.enum([
  "light",
  "sepia",
  "spring",
  "summer",
  "sunshower",
  "ocean",
  "forest",
  "autumn",
  "autumn-light",
  "coyote",
  "coyote-dark",
  "guinness",
  "night",
  "midnight",
  "pine",
  "obsidian",
]);
export type WorkspaceTheme = z.infer<typeof workspaceThemeSchema>;

export const emailAddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
export type EmailAddress = z.infer<typeof emailAddressSchema>;

export const localPasswordSchema = z.string().min(8).max(72);
export type LocalPassword = z.infer<typeof localPasswordSchema>;

export const localAccountNameSchema = z.string().trim().min(1).max(120);
export type LocalAccountName = z.infer<typeof localAccountNameSchema>;

export const localLoginSchema = z.object({
  email: emailAddressSchema,
  password: localPasswordSchema,
});
export type LocalLoginInput = z.infer<typeof localLoginSchema>;

export const passwordResetOtpSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{4}-[0-9a-fA-F]{4}$/, "Expected AAAA-BBBB")
  .transform((value) => value.toUpperCase());
export type PasswordResetOtp = z.infer<typeof passwordResetOtpSchema>;

export const requestPasswordResetSchema = z.object({
  email: emailAddressSchema,
});
export type RequestPasswordResetInput = z.infer<
  typeof requestPasswordResetSchema
>;

export const resetPasswordWithOtpSchema = z.object({
  email: emailAddressSchema,
  oneTimePassword: passwordResetOtpSchema,
  password: localPasswordSchema,
});
export type ResetPasswordWithOtpInput = z.infer<
  typeof resetPasswordWithOtpSchema
>;

export const localAccountSchema = z.object({
  id: z.string().min(1),
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  ownedProjectCount: z.number().int().nonnegative().optional(),
  assignedTaskCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type LocalAccount = z.infer<typeof localAccountSchema>;

export const localAccountResponseSchema = z.object({
  account: localAccountSchema,
  notificationEmailSent: z.boolean().optional(),
});
export type LocalAccountResponse = z.infer<typeof localAccountResponseSchema>;

export const localAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
});
export type LocalAccountsResponse = z.infer<typeof localAccountsResponseSchema>;

export const createLocalAccountSchema = z.object({
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  password: localPasswordSchema,
  sendEmail: z.boolean().optional(),
});
export type CreateLocalAccountInput = z.infer<typeof createLocalAccountSchema>;

export const updateLocalAccountSchema = z
  .object({
    email: emailAddressSchema.optional(),
    name: localAccountNameSchema.optional(),
    role: roleSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.email === undefined &&
      value.name === undefined &&
      value.role === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one local account field must be provided",
        path: ["email"],
      });
    }
  });
export type UpdateLocalAccountInput = z.infer<typeof updateLocalAccountSchema>;

export const setLocalAccountPasswordSchema = z.object({
  password: localPasswordSchema,
  sendEmail: z.boolean().optional(),
});
export type SetLocalAccountPasswordInput = z.infer<
  typeof setLocalAccountPasswordSchema
>;

export const setOwnPasswordSchema = z.object({
  currentPassword: localPasswordSchema,
  password: localPasswordSchema,
});
export type SetOwnPasswordInput = z.infer<typeof setOwnPasswordSchema>;

export const updateOwnProfileSchema = z
  .object({
    email: emailAddressSchema.optional(),
    name: localAccountNameSchema.optional(),
    currentPassword: localPasswordSchema.optional(),
    password: localPasswordSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.email === undefined &&
      value.name === undefined &&
      value.password === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one profile field must be provided",
        path: ["email"],
      });
    }

    if (value.password !== undefined && value.currentPassword === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Current password is required to change your password",
        path: ["currentPassword"],
      });
    }

    if (value.currentPassword !== undefined && value.password === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "New password is required when current password is provided",
        path: ["password"],
      });
    }
  });
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const deleteLocalAccountSchema = z.object({
  nextProjectOwnerUserId: nullableUserIdSchema,
  nextTaskAssigneeUserId: nullableUserIdSchema,
});
export type DeleteLocalAccountInput = z.infer<typeof deleteLocalAccountSchema>;

export const localAccountImportSchema = z.object({
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  password: z.union([localPasswordSchema, z.literal("")]).optional(),
  passwordHash: z.string().min(1).optional(),
});
export type LocalAccountImport = z.infer<typeof localAccountImportSchema>;

export const importLocalAccountsSchema = z
  .object({
    accounts: z.array(localAccountImportSchema).min(1),
  })
  .superRefine((value, context) => {
    const seenEmails = new Set<string>();

    value.accounts.forEach((account, index) => {
      if (seenEmails.has(account.email)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate local account emails are not allowed",
          path: ["accounts", index, "email"],
        });
        return;
      }

      seenEmails.add(account.email);
    });
  });
export type ImportLocalAccountsInput = z.infer<
  typeof importLocalAccountsSchema
>;

export const localAccountImportSummarySchema = z.object({
  processed: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type LocalAccountImportSummary = z.infer<
  typeof localAccountImportSummarySchema
>;

export const importLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
  summary: localAccountImportSummarySchema,
});
export type ImportLocalAccountsResponse = z.infer<
  typeof importLocalAccountsResponseSchema
>;

export const localAccountExportSchema = z.object({
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  passwordHash: z.string().min(1).optional(),
});
export type LocalAccountExport = z.infer<typeof localAccountExportSchema>;

export const exportLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountExportSchema),
});
export type ExportLocalAccountsResponse = z.infer<
  typeof exportLocalAccountsResponseSchema
>;

export const resetDefaultLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
});
export type ResetDefaultLocalAccountsResponse = z.infer<
  typeof resetDefaultLocalAccountsResponseSchema
>;

export const clearAllLocalAccountsSchema = z.object({
  currentPassword: localPasswordSchema,
});
export type ClearAllLocalAccountsInput = z.infer<
  typeof clearAllLocalAccountsSchema
>;

export const clearAllLocalAccountsResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
});
export type ClearAllLocalAccountsResponse = z.infer<
  typeof clearAllLocalAccountsResponseSchema
>;

export const localLoginHintResponseSchema = z.object({
  visible: z.boolean(),
  guestEnabled: z.boolean().default(true),
});
export type LocalLoginHintResponse = z.infer<
  typeof localLoginHintResponseSchema
>;

export const deleteLocalAccountResponseSchema = z.object({
  id: z.string().min(1),
});
export type DeleteLocalAccountResponse = z.infer<
  typeof deleteLocalAccountResponseSchema
>;

export const deleteProjectResponseSchema = z.object({
  id: z.string().min(1),
  archivedTaskCount: z.number().int().nonnegative(),
});
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>;

export const deleteTaskResponseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
});
export type DeleteTaskResponse = z.infer<typeof deleteTaskResponseSchema>;

export const successResponseSchema = z.object({
  success: z.literal(true),
});
export type SuccessResponse = z.infer<typeof successResponseSchema>;

export const resetWorkspaceExamplesSchema = z.object({
  password: localPasswordSchema,
  seedExamples: z.boolean().optional(),
});
export type ResetWorkspaceExamplesInput = z.infer<
  typeof resetWorkspaceExamplesSchema
>;

export const resetWorkspaceExamplesResponseSchema = z.object({
  createdProjectCount: z.number().int().nonnegative(),
  createdTaskCount: z.number().int().nonnegative(),
  deletedProjectCount: z.number().int().nonnegative(),
  deletedTaskCount: z.number().int().nonnegative(),
});
export type ResetWorkspaceExamplesResponse = z.infer<
  typeof resetWorkspaceExamplesResponseSchema
>;

export const markProjectViewedResponseSchema = z.object({
  projectId: z.string().min(1),
  viewedAt: z.string().min(1),
  viewedTaskCount: z.number().int().nonnegative(),
});
export type MarkProjectViewedResponse = z.infer<
  typeof markProjectViewedResponseSchema
>;

export const markAllProjectsViewedResponseSchema = z.object({
  viewedAt: z.string().min(1),
  viewedProjectCount: z.number().int().nonnegative(),
  viewedTaskCount: z.number().int().nonnegative(),
});
export type MarkAllProjectsViewedResponse = z.infer<
  typeof markAllProjectsViewedResponseSchema
>;

export const createProjectSchema = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional(),
  references: optionalReferencesSchema,
  ownerUserId: nullableUserIdSchema,
  dueDate: z.string().optional(),
  priority: prioritySchema.default("medium"),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  manualStatus: projectStatusSchema.optional().nullable(),
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional().nullable(),
  references: nullableReferencesSchema,
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const convertProjectToTaskSchema = updateProjectSchema;
export type ConvertProjectToTaskInput = z.infer<
  typeof convertProjectToTaskSchema
>;

export const convertProjectToTaskResponseSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
export type ConvertProjectToTaskResponse = z.infer<
  typeof convertProjectToTaskResponseSchema
>;

export const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(120),
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional(),
  assigneeUserId: z.string().min(1).nullable(),
  dueDate: z.string().optional(),
  priority: prioritySchema.default("medium"),
  status: taskStatusSchema.default("not_started"),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial().extend({
  assigneeUserId: z.string().min(1).nullable().optional(),
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional().nullable(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const personalTodoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().nullable(),
  dueDate: z.string().nullable(),
  status: personalTodoStatusSchema,
  sortOrder: z.number().int(),
  completedAt: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type PersonalTodo = z.infer<typeof personalTodoSchema>;

export const createPersonalTodoSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional(),
  dueDate: z.string().optional(),
});
export type CreatePersonalTodoInput = z.infer<typeof createPersonalTodoSchema>;

export const updatePersonalTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional().nullable(),
    dueDate: z.string().optional().nullable(),
    status: personalTodoStatusSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.title === undefined &&
      value.notes === undefined &&
      value.dueDate === undefined &&
      value.status === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one personal todo field must be provided",
        path: ["title"],
      });
    }
  });
export type UpdatePersonalTodoInput = z.infer<typeof updatePersonalTodoSchema>;

export const reorderPersonalTodosSchema = z
  .object({
    todoIds: z.array(z.string().min(1)).max(500),
  })
  .superRefine((value, context) => {
    if (new Set(value.todoIds).size !== value.todoIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate personal todo ids are not allowed",
        path: ["todoIds"],
      });
    }
  });
export type ReorderPersonalTodosInput = z.infer<
  typeof reorderPersonalTodosSchema
>;

export const importPersonalTodoItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional(),
  dueDate: z.string().optional().nullable(),
  status: personalTodoStatusSchema.default("todo"),
});
export type ImportPersonalTodoItem = z.infer<
  typeof importPersonalTodoItemSchema
>;

export const importPersonalTodosSchema = z.object({
  personalTodos: z.array(importPersonalTodoItemSchema).max(1_000),
});
export type ImportPersonalTodosInput = z.infer<
  typeof importPersonalTodosSchema
>;

export const importPersonalTodosResponseSchema = z.object({
  importedCount: z.number().int().nonnegative(),
});
export type ImportPersonalTodosResponse = z.infer<
  typeof importPersonalTodosResponseSchema
>;

export const deletePersonalTodoResponseSchema = z.object({
  id: z.string().min(1),
});
export type DeletePersonalTodoResponse = z.infer<
  typeof deletePersonalTodoResponseSchema
>;

export const reorderProjectTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(500),
  })
  .superRefine((value, context) => {
    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type ReorderProjectTasksInput = z.infer<
  typeof reorderProjectTasksSchema
>;

export const convertTaskToProjectSchema = updateTaskSchema.omit({
  projectId: true,
});
export type ConvertTaskToProjectInput = z.infer<
  typeof convertTaskToProjectSchema
>;

export const convertTaskToProjectResponseSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});
export type ConvertTaskToProjectResponse = z.infer<
  typeof convertTaskToProjectResponseSchema
>;

export const bulkArchiveTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .superRefine((value, context) => {
    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type BulkArchiveTasksInput = z.infer<typeof bulkArchiveTasksSchema>;

export const bulkCopyTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(200),
    targetProjectId: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type BulkCopyTasksInput = z.infer<typeof bulkCopyTasksSchema>;

export const bulkUpdateTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(200),
    assigneeUserId: z.string().min(1).nullable().optional(),
    dueDate: z.string().optional().nullable(),
    notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional().nullable(),
    priority: prioritySchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.assigneeUserId === undefined &&
      value.dueDate === undefined &&
      value.notes === undefined &&
      value.priority === undefined &&
      value.status === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one task field must be provided",
        path: ["taskIds"],
      });
    }

    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>;

export const savedViewStateSchema = z.object({
  groupBy: groupBySchema.default("owner"),
  search: z.string().max(250).default(""),
  sortBy: z
    .array(projectSortFieldSchema)
    .max(projectSortFieldSchema.options.length)
    .default([]),
  statusFilters: z
    .array(projectStatusSchema)
    .max(projectStatusSchema.options.length)
    .default([]),
  assigneeUserIds: z.array(z.string().min(1)).max(500).default([]),
  collapsedGroupKeys: z.array(z.string().min(1)).max(200).default([]),
  expandedProjectIds: z.array(z.string().min(1)).max(500).default([]),
});
export type SavedViewStateInput = z.infer<typeof savedViewStateSchema>;

export const createSavedViewSchema = savedViewStateSchema.extend({
  name: z.string().trim().min(1).max(80),
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = savedViewStateSchema;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;

export const renameSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type RenameSavedViewInput = z.infer<typeof renameSavedViewSchema>;

export const auditHistoryParamsSchema = z.object({
  entityType: auditEntityTypeSchema,
  entityId: z.string().min(1),
});
export type AuditHistoryParams = z.infer<typeof auditHistoryParamsSchema>;

export const auditHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;

export const auditChangesQuerySchema = z.object({
  action: z.string().trim().min(1).max(80).optional(),
  actorUserId: z.string().min(1).optional(),
  fromDate: auditDateSchema.optional(),
  fromDateTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(5_000).default(250),
  search: z.string().trim().max(250).default(""),
  toDate: auditDateSchema.optional(),
  toDateTime: z.string().datetime().optional(),
});
export type AuditChangesQuery = z.infer<typeof auditChangesQuerySchema>;

export const auditLoginsQuerySchema = z.object({
  actorUserId: z.string().min(1).optional(),
  fromDate: auditDateSchema.optional(),
  fromDateTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(5_000).default(250),
  search: z.string().trim().max(250).default(""),
  toDate: auditDateSchema.optional(),
  toDateTime: z.string().datetime().optional(),
});
export type AuditLoginsQuery = z.infer<typeof auditLoginsQuerySchema>;

export const emailAuditStatusSchema = z.enum([
  "queued",
  "processing",
  "sent",
  "skipped",
  "failed",
]);
export type EmailAuditStatus = z.infer<typeof emailAuditStatusSchema>;

export const emailAuditSourceSchema = z.enum([
  "notification",
  "account_update",
  "password_email",
  "password_reset",
  "test_email",
]);
export type EmailAuditSource = z.infer<typeof emailAuditSourceSchema>;

export const auditEmailsQuerySchema = z.object({
  fromDate: auditDateSchema.optional(),
  fromDateTime: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(5_000).default(250),
  search: z.string().trim().max(250).default(""),
  status: emailAuditStatusSchema.optional(),
  toDate: auditDateSchema.optional(),
  toDateTime: z.string().datetime().optional(),
  userId: z.string().min(1).optional(),
});
export type AuditEmailsQuery = z.infer<typeof auditEmailsQuerySchema>;

export const emailAuditActorSchema = z.object({
  id: z.string().nullable(),
  email: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: roleSchema,
});
export type EmailAuditActor = z.infer<typeof emailAuditActorSchema>;

export const emailAuditRecipientSchema = z.object({
  id: z.string().nullable(),
  email: z.string().trim().min(1),
  name: z.string().trim().min(1).nullable(),
});
export type EmailAuditRecipient = z.infer<typeof emailAuditRecipientSchema>;

export const emailAuditStepSchema = z.object({
  attemptNumber: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  detail: z.string().trim().min(1).nullable(),
  host: z.string().trim().min(1).nullable(),
  id: z.string().min(1),
  nextAttemptAt: z.string().datetime().nullable(),
  response: z.string().trim().min(1).nullable(),
  status: emailAuditStatusSchema,
  title: z.string().trim().min(1),
});
export type EmailAuditStep = z.infer<typeof emailAuditStepSchema>;

export const emailAuditEventSchema = z.object({
  action: z.string().trim().min(1),
  actor: emailAuditActorSchema.nullable(),
  attemptCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  entityId: z.string().nullable(),
  entityType: auditEntityTypeSchema.nullable(),
  error: z.string().nullable(),
  failedAt: z.string().datetime().nullable(),
  id: z.string().min(1),
  kind: z.string().trim().min(1).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
  recipient: emailAuditRecipientSchema,
  response: z.string().trim().min(1).nullable(),
  sentAt: z.string().datetime().nullable(),
  skippedAt: z.string().datetime().nullable(),
  source: emailAuditSourceSchema,
  status: emailAuditStatusSchema,
  steps: z.array(emailAuditStepSchema),
  subject: z.string().trim().min(1).nullable(),
});
export type EmailAuditEvent = z.infer<typeof emailAuditEventSchema>;

export const auditLogRetentionPolicySchema = z.object({
  olderThan: auditLogRetentionWindowSchema.nullable(),
});
export type AuditLogRetentionPolicy = z.infer<
  typeof auditLogRetentionPolicySchema
>;

export const setAuditLogRetentionSchema = z.object({
  olderThan: auditLogRetentionWindowSchema,
});
export type SetAuditLogRetentionInput = z.infer<
  typeof setAuditLogRetentionSchema
>;

export const purgeAuditLogsSchema = z.object({
  olderThan: auditLogRetentionWindowSchema,
});
export type PurgeAuditLogsInput = z.infer<typeof purgeAuditLogsSchema>;

export const purgeAuditLogsResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
});
export type PurgeAuditLogsResponse = z.infer<
  typeof purgeAuditLogsResponseSchema
>;

export const backupRetentionWindowSchema = z.enum([
  "one_week",
  "two_weeks",
  "one_month",
  "three_months",
  "six_months",
  "forever",
]);
export type BackupRetentionWindow = z.infer<typeof backupRetentionWindowSchema>;

export const backupRetentionPolicySchema = z.object({
  dailyCount: z.number().int().nonnegative(),
  monthlyCount: z.number().int().nonnegative(),
  weeklyCount: z.number().int().nonnegative(),
});
export type BackupRetentionPolicy = z.infer<typeof backupRetentionPolicySchema>;

export const logRetentionWindowSchema = z.enum([
  "three_months",
  "six_months",
  "twelve_months",
  "twenty_four_months",
  "thirty_six_months",
]);
export type LogRetentionWindow = z.infer<typeof logRetentionWindowSchema>;

export const notificationRetentionWindowSchema = z.enum([
  "one_week",
  "two_weeks",
  "one_month",
]);
export type NotificationRetentionWindow = z.infer<
  typeof notificationRetentionWindowSchema
>;

export const retentionTargetSchema = z.enum([
  "backups",
  "logins",
  "changes",
  "notifications",
]);
export type RetentionTarget = z.infer<typeof retentionTargetSchema>;

const retentionMetricsSchema = z.object({
  estimatedSizeBytes: z.number().int().nonnegative(),
  retainedItemCount: z.number().int().nonnegative(),
});

export const backupRetentionSummarySchema = retentionMetricsSchema.extend({
  policy: backupRetentionPolicySchema,
});
export type BackupRetentionSummary = z.infer<
  typeof backupRetentionSummarySchema
>;

export const logRetentionSummarySchema = retentionMetricsSchema.extend({
  policy: logRetentionWindowSchema,
});
export type LogRetentionSummary = z.infer<typeof logRetentionSummarySchema>;

export const notificationRetentionSummarySchema = retentionMetricsSchema.extend(
  {
    policy: notificationRetentionWindowSchema,
  },
);
export type NotificationRetentionSummary = z.infer<
  typeof notificationRetentionSummarySchema
>;

export const retentionStatusSchema = z.object({
  backups: backupRetentionSummarySchema,
  changes: logRetentionSummarySchema,
  logins: logRetentionSummarySchema,
  notifications: notificationRetentionSummarySchema,
});
export type RetentionStatus = z.infer<typeof retentionStatusSchema>;

export const updateRetentionSettingsSchema = z.object({
  changes: logRetentionWindowSchema,
  logins: logRetentionWindowSchema,
  notifications: notificationRetentionWindowSchema,
});
export type UpdateRetentionSettingsInput = z.infer<
  typeof updateRetentionSettingsSchema
>;

export const pruneRetentionDataSchema = z.object({
  target: retentionTargetSchema,
});
export type PruneRetentionDataInput = z.infer<typeof pruneRetentionDataSchema>;

export const pruneRetentionDataResponseSchema = z.object({
  deletedCount: z.number().int().nonnegative(),
  deletedSizeBytes: z.number().int().nonnegative(),
  settings: retentionStatusSchema,
  target: retentionTargetSchema,
});
export type PruneRetentionDataResponse = z.infer<
  typeof pruneRetentionDataResponseSchema
>;

export const loopImportJobStatusSchema = z.enum([
  "queued_parse",
  "parsing",
  "awaiting_review",
  "queued_commit",
  "committing",
  "completed",
  "failed",
]);
export type LoopImportJobStatus = z.infer<typeof loopImportJobStatusSchema>;

export const importRowOutcomeSchema = z.enum([
  "pending",
  "created",
  "updated",
  "skipped",
  "failed",
]);
export type ImportRowOutcome = z.infer<typeof importRowOutcomeSchema>;

export const loopImportFieldSchema = z.enum([
  "projectExternalId",
  "projectTitle",
  "projectNotes",
  "projectOwner",
  "projectDueDate",
  "projectPriority",
  "taskExternalId",
  "taskTitle",
  "taskNotes",
  "taskAssignee",
  "taskDueDate",
  "taskPriority",
  "taskStatus",
  "taskBlockedReason",
]);
export type LoopImportField = z.infer<typeof loopImportFieldSchema>;

export type LoopImportFieldDefinition = {
  key: LoopImportField;
  label: string;
  required: boolean;
  description: string;
};

export const loopImportFieldDefinitions: ReadonlyArray<LoopImportFieldDefinition> =
  [
    {
      key: "projectTitle",
      label: "Project title",
      required: true,
      description: "Top-level Loop track or project name.",
    },
    {
      key: "taskTitle",
      label: "Task title",
      required: true,
      description: "Checklist item or task title to create under the project.",
    },
    {
      key: "projectExternalId",
      label: "Project source id",
      required: false,
      description:
        "Stable source identifier used for idempotent project updates.",
    },
    {
      key: "taskExternalId",
      label: "Task source id",
      required: false,
      description: "Stable source identifier used for idempotent task updates.",
    },
    {
      key: "projectNotes",
      label: "Project notes",
      required: false,
      description:
        "Optional project notes. Project summary, description, or manual override reasons from prior exports can map here.",
    },
    {
      key: "projectOwner",
      label: "Project owner",
      required: false,
      description:
        "Owner email or display name. Defaults to the import creator.",
    },
    {
      key: "projectDueDate",
      label: "Project due date",
      required: false,
      description: "Project due date.",
    },
    {
      key: "projectPriority",
      label: "Project priority",
      required: false,
      description: "Maps to low, medium, or high.",
    },
    {
      key: "taskNotes",
      label: "Task notes",
      required: false,
      description: "Optional task notes, details, or longer-form context.",
    },
    {
      key: "taskAssignee",
      label: "Task assignee",
      required: false,
      description:
        "Assignee email or display name. Defaults to the import creator.",
    },
    {
      key: "taskDueDate",
      label: "Task due date",
      required: false,
      description: "Task due date.",
    },
    {
      key: "taskPriority",
      label: "Task priority",
      required: false,
      description: "Maps to low, medium, or high.",
    },
    {
      key: "taskStatus",
      label: "Task status",
      required: false,
      description:
        "Maps common Loop-style status values to Tavi task statuses.",
    },
    {
      key: "taskBlockedReason",
      label: "Task blocked detail",
      required: false,
      description:
        "Optional source column to append into task notes when blockers are tracked separately.",
    },
  ] as const;

export type LoopImportMapping = Partial<Record<LoopImportField, string | null>>;

export const loopImportMappingSchema = z.object({
  projectExternalId: z.string().trim().min(1).max(200).nullable().optional(),
  projectTitle: z.string().trim().min(1).max(200).nullable().optional(),
  projectNotes: z.string().trim().min(1).max(200).nullable().optional(),
  projectOwner: z.string().trim().min(1).max(200).nullable().optional(),
  projectDueDate: z.string().trim().min(1).max(200).nullable().optional(),
  projectPriority: z.string().trim().min(1).max(200).nullable().optional(),
  taskExternalId: z.string().trim().min(1).max(200).nullable().optional(),
  taskTitle: z.string().trim().min(1).max(200).nullable().optional(),
  taskNotes: z.string().trim().min(1).max(200).nullable().optional(),
  taskAssignee: z.string().trim().min(1).max(200).nullable().optional(),
  taskDueDate: z.string().trim().min(1).max(200).nullable().optional(),
  taskPriority: z.string().trim().min(1).max(200).nullable().optional(),
  taskStatus: z.string().trim().min(1).max(200).nullable().optional(),
  taskBlockedReason: z.string().trim().min(1).max(200).nullable().optional(),
});

export const createLoopImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(5_000_000),
});
export type CreateLoopImportInput = z.infer<typeof createLoopImportSchema>;

export const updateLoopImportMappingSchema = z.object({
  mapping: loopImportMappingSchema,
});
export type UpdateLoopImportMappingInput = z.infer<
  typeof updateLoopImportMappingSchema
>;

export const loopImportOverlapActionSchema = z.enum([
  "update",
  "add",
  "ignore",
]);
export type LoopImportOverlapAction = z.infer<
  typeof loopImportOverlapActionSchema
>;

export const updateLoopImportRowDecisionsSchema = z
  .object({
    projectAction: loopImportOverlapActionSchema.optional(),
    taskAction: loopImportOverlapActionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.projectAction === undefined && value.taskAction === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one overlap action must be provided",
        path: ["projectAction"],
      });
    }
  });
export type UpdateLoopImportRowDecisionsInput = z.infer<
  typeof updateLoopImportRowDecisionsSchema
>;

export type LoopImportUser = {
  id: string;
  email: string;
  name: string;
};

type LoopImportMissingAssigneeResolution = {
  canCreate: boolean;
  email: string | null;
  label: string;
  name: string;
};

export type LoopImportMissingAssignee = LoopImportMissingAssigneeResolution & {
  rowCount: number;
  rowNumbers: number[];
};

type LoopImportMissingUserResolution = {
  blocksCommit: boolean;
  canCreate: boolean;
  email: string | null;
  label: string;
  name: string;
  sourceLabels: string[];
};

export type LoopImportMissingUser = LoopImportMissingUserResolution & {
  rowCount: number;
  rowNumbers: number[];
};

export type LoopImportPreviewOverlap = {
  action: LoopImportOverlapAction;
  changedFields: string[];
  existingId: string;
  matchedBy: "natural_key" | "source_id";
  title: string;
};

export type PreparedLoopImportEntity = {
  dueDate: string | null;
  externalId: string | null;
  identityStrategy: "natural_key" | "source_id";
  priority: Priority;
};

export type PreparedLoopImportProject = PreparedLoopImportEntity & {
  notes: string | null;
  ownerUserId: string | null;
  title: string | null;
};

export type PreparedLoopImportTask = PreparedLoopImportEntity & {
  assigneeUserId: string;
  notes: string | null;
  status: TaskStatus;
  title: string | null;
};

export type PreparedLoopImportRow = {
  errors: string[];
  missingImportUsers: LoopImportMissingUserResolution[];
  missingTaskAssignee: LoopImportMissingAssigneeResolution | null;
  project: PreparedLoopImportProject;
  projectOverlap: LoopImportPreviewOverlap | null;
  rawRow: Record<string, string | null>;
  rowNumber: number;
  task: PreparedLoopImportTask;
  taskOverlap: LoopImportPreviewOverlap | null;
  warnings: string[];
};

export type LoopImportPreview = {
  blockingMissingUserRowCount: number;
  invalidRowCount: number;
  missingUserRowCount: number;
  missingUsers: LoopImportMissingUser[];
  missingTaskAssigneeRowCount: number;
  missingTaskAssignees: LoopImportMissingAssignee[];
  missingRequiredMappings: LoopImportField[];
  overlappingProjectRowCount: number;
  overlappingTaskRowCount: number;
  projectSourceIdRowCount: number;
  rows: PreparedLoopImportRow[];
  taskSourceIdRowCount: number;
  totalRowCount: number;
  validRowCount: number;
  warningRowCount: number;
};

const LOOP_IMPORT_REQUIRED_FIELDS = ["projectTitle", "taskTitle"] as const;

const LOOP_IMPORT_FIELD_ALIASES: Record<LoopImportField, string[]> = {
  projectExternalId: ["project id", "project external id", "track id"],
  projectTitle: ["project title", "project", "track title", "track name"],
  projectNotes: [
    "project notes",
    "project summary",
    "project description",
    "manual status reason",
    "override reason",
    "project reason",
  ],
  projectOwner: ["project owner", "owner", "project lead"],
  projectDueDate: ["project due date", "project due"],
  projectPriority: ["project priority"],
  taskExternalId: ["task id", "task external id", "checklist item id"],
  taskTitle: ["task title", "task", "checklist item", "checklist title"],
  taskNotes: ["task notes", "task description", "task details"],
  taskAssignee: ["task assignee", "assignee"],
  taskDueDate: ["task due date", "item due date"],
  taskPriority: ["task priority"],
  taskStatus: ["task status", "item status", "checklist status"],
  taskBlockedReason: ["blocked reason", "task blocked reason", "blocker"],
};

export function suggestLoopImportMapping(headers: string[]): LoopImportMapping {
  const normalizedHeaders = new Map<string, string[]>();

  for (const header of headers) {
    const normalizedHeader = normalizeLoopImportHeader(header);
    const existing = normalizedHeaders.get(normalizedHeader) ?? [];
    existing.push(header);
    normalizedHeaders.set(normalizedHeader, existing);
  }

  const usedHeaders = new Set<string>();
  const mapping: LoopImportMapping = {};

  for (const field of loopImportFieldDefinitions) {
    const aliases = LOOP_IMPORT_FIELD_ALIASES[field.key] ?? [];

    for (const alias of aliases) {
      const candidates = normalizedHeaders.get(alias) ?? [];
      const match = candidates.find((candidate) => !usedHeaders.has(candidate));

      if (!match) {
        continue;
      }

      mapping[field.key] = match;
      usedHeaders.add(match);
      break;
    }
  }

  return mapping;
}

export function expandLoopImportRows({
  mapping,
  rawRows,
}: {
  mapping: LoopImportMapping;
  rawRows: Array<Record<string, unknown>>;
}) {
  const taskTitleHeader = mapping.taskTitle;

  if (!taskTitleHeader) {
    return rawRows;
  }

  const taskExternalIdHeader = mapping.taskExternalId;

  return rawRows.flatMap((rawRow) => {
    const taskTitle = toImportString(rawRow[taskTitleHeader]);
    const splitTaskTitles = splitChecklistTaskTitles(taskTitle);

    if (splitTaskTitles.length <= 1) {
      return [rawRow];
    }

    return splitTaskTitles.map((title) => ({
      ...rawRow,
      [taskTitleHeader]: title,
      ...(taskExternalIdHeader ? { [taskExternalIdHeader]: null } : {}),
    }));
  });
}

export function prepareLoopImportRow({
  defaultUserId,
  mapping,
  rawRow,
  rowNumber,
  users,
}: {
  defaultUserId: string;
  mapping: LoopImportMapping;
  rawRow: Record<string, unknown>;
  rowNumber: number;
  users: LoopImportUser[];
}): PreparedLoopImportRow {
  const normalizedRawRow = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [key, toImportString(value)]),
  ) as Record<string, string | null>;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of LOOP_IMPORT_REQUIRED_FIELDS) {
    if (!mapping[field]) {
      const fieldDefinition = loopImportFieldDefinitions.find(
        (definition) => definition.key === field,
      );
      errors.push(`Map a column to ${fieldDefinition?.label ?? field}`);
    }
  }

  const projectTitle = readMappedValue(normalizedRawRow, mapping.projectTitle);
  const taskTitle = readMappedValue(normalizedRawRow, mapping.taskTitle);
  const projectExternalId = readMappedValue(
    normalizedRawRow,
    mapping.projectExternalId,
  );
  const taskExternalId = readMappedValue(
    normalizedRawRow,
    mapping.taskExternalId,
  );
  const projectNotes = readMappedValue(normalizedRawRow, mapping.projectNotes);
  const taskAssigneeValue = readMappedValue(
    normalizedRawRow,
    mapping.taskAssignee,
  );
  const taskDueDateValue = readMappedValue(
    normalizedRawRow,
    mapping.taskDueDate,
  );
  const taskNotes = readMappedValue(normalizedRawRow, mapping.taskNotes);
  const taskPriorityValue = readMappedValue(
    normalizedRawRow,
    mapping.taskPriority,
  );
  const taskBlockedReason = readMappedValue(
    normalizedRawRow,
    mapping.taskBlockedReason,
  );
  const taskStatusValue = readMappedValue(normalizedRawRow, mapping.taskStatus);

  if (mapping.projectTitle && !projectTitle) {
    errors.push("Project title is required");
  }

  const projectDueDate = normalizeImportDate(
    readMappedValue(normalizedRawRow, mapping.projectDueDate),
    "Project due date",
    errors,
  );
  const taskDueDate = normalizeImportDate(
    taskDueDateValue,
    "Task due date",
    errors,
  );
  const projectPriority = normalizeImportPriority(
    readMappedValue(normalizedRawRow, mapping.projectPriority),
    "Project priority",
    errors,
  );
  const taskPriority = normalizeImportPriority(
    taskPriorityValue,
    "Task priority",
    errors,
  );
  const taskStatus = normalizeImportTaskStatus(taskStatusValue, errors);
  const projectOwnerCandidates = parseImportUserCandidates(
    readMappedValue(normalizedRawRow, mapping.projectOwner),
  );
  const primaryProjectOwnerCandidate = projectOwnerCandidates[0] ?? null;
  const additionalProjectOwnerCandidates = projectOwnerCandidates.slice(1);
  const trackMissingProjectOwners = projectOwnerCandidates.length > 1;

  if (projectOwnerCandidates.length > 1 && primaryProjectOwnerCandidate) {
    warnings.push(
      `Project owner lists multiple people. Tavi will use "${primaryProjectOwnerCandidate.label}" as the project owner and leave the others for manual task assignment.`,
    );
  }

  const projectOwner = primaryProjectOwnerCandidate
    ? resolveImportUserCandidate({
        blocksCommit: false,
        candidate: primaryProjectOwnerCandidate,
        defaultUserId,
        fieldLabel: "Project owner",
        missingEmailHelpText:
          "Create the account to use this person as the project owner.",
        missingNoEmailHelpText:
          "did not match a known user and does not include an email address.",
        sourceLabel: "Project owner",
        trackMissingUser: trackMissingProjectOwners,
        useDefaultUserId: true,
        users,
        warnings,
      })
    : {
        missingUser: null,
        userId: null,
      };
  const additionalProjectOwners = additionalProjectOwnerCandidates.map(
    (candidate) =>
      resolveImportUserCandidate({
        blocksCommit: false,
        candidate,
        defaultUserId,
        fieldLabel: "Additional project owner",
        missingEmailHelpText:
          "Create the account if this person should be assigned to tasks after import.",
        missingNoEmailHelpText:
          "did not match a known user and does not include an email address.",
        sourceLabel: "Additional project owner",
        trackMissingUser: true,
        useDefaultUserId: false,
        users,
        warnings,
      }),
  );
  const taskAssignee = resolveImportUser({
    defaultUserId,
    fieldLabel: "Task assignee",
    trackMissingAssignee: true,
    users,
    value: taskAssigneeValue,
    warnings,
  });

  return {
    errors,
    missingImportUsers: [
      ...(projectOwner.missingUser ? [projectOwner.missingUser] : []),
      ...additionalProjectOwners.flatMap((entry) =>
        entry.missingUser ? [entry.missingUser] : [],
      ),
      ...taskAssignee.missingUsers,
    ],
    missingTaskAssignee: taskAssignee.missingAssignee,
    project: {
      dueDate: projectDueDate,
      externalId: projectExternalId,
      identityStrategy: projectExternalId ? "source_id" : "natural_key",
      notes: projectNotes,
      ownerUserId: projectOwner.userId,
      priority: projectPriority,
      title: projectTitle,
    },
    projectOverlap: null,
    rawRow: normalizedRawRow,
    rowNumber,
    task: {
      assigneeUserId: taskAssignee.userId ?? defaultUserId,
      dueDate: taskDueDate,
      externalId: taskExternalId,
      identityStrategy: taskExternalId ? "source_id" : "natural_key",
      notes: mergeTaskNotes(taskNotes, taskBlockedReason),
      priority: taskPriority,
      status: taskStatus,
      title: taskTitle,
    },
    taskOverlap: null,
    warnings,
  };
}

export function buildLoopImportPreview({
  defaultUserId,
  mapping,
  rawRows,
  sampleSize = 25,
  users,
}: {
  defaultUserId: string;
  mapping: LoopImportMapping;
  rawRows: Array<Record<string, unknown>>;
  sampleSize?: number;
  users: LoopImportUser[];
}): LoopImportPreview {
  const rows = rawRows.map((rawRow, index) =>
    prepareLoopImportRow({
      defaultUserId,
      mapping,
      rawRow,
      rowNumber: index + 1,
      users,
    }),
  );
  const missingTaskAssigneesByKey = new Map<
    string,
    LoopImportMissingAssignee
  >();
  const missingUsersByKey = new Map<string, LoopImportMissingUser>();
  let blockingMissingUserRowCount = 0;
  let missingUserRowCount = 0;
  let missingTaskAssigneeRowCount = 0;

  for (const row of rows) {
    if (!row.missingTaskAssignee) {
      // Keep processing generic missing users below.
    } else {
      missingTaskAssigneeRowCount += 1;
      const missingAssignee = row.missingTaskAssignee;
      const key =
        missingAssignee.email?.toLowerCase() ??
        missingAssignee.label.toLowerCase();
      const existing = missingTaskAssigneesByKey.get(key);

      if (existing) {
        existing.rowCount += 1;
        existing.rowNumbers.push(row.rowNumber);
      } else {
        missingTaskAssigneesByKey.set(key, {
          ...missingAssignee,
          rowCount: 1,
          rowNumbers: [row.rowNumber],
        });
      }
    }

    if (row.missingImportUsers.length === 0) {
      continue;
    }

    missingUserRowCount += 1;

    if (row.missingImportUsers.some((entry) => entry.blocksCommit)) {
      blockingMissingUserRowCount += 1;
    }

    for (const missingUser of row.missingImportUsers) {
      const key =
        missingUser.email?.toLowerCase() ?? missingUser.label.toLowerCase();
      const existing = missingUsersByKey.get(key);

      if (existing) {
        existing.blocksCommit ||= missingUser.blocksCommit;
        existing.rowCount += 1;
        existing.rowNumbers.push(row.rowNumber);
        existing.sourceLabels = [
          ...new Set([...existing.sourceLabels, ...missingUser.sourceLabels]),
        ];
        continue;
      }

      missingUsersByKey.set(key, {
        ...missingUser,
        rowCount: 1,
        rowNumbers: [row.rowNumber],
      });
    }
  }

  return {
    blockingMissingUserRowCount,
    invalidRowCount: rows.filter((row) => row.errors.length > 0).length,
    missingUserRowCount,
    missingUsers: [...missingUsersByKey.values()].sort((left, right) => {
      if (left.blocksCommit !== right.blocksCommit) {
        return left.blocksCommit ? -1 : 1;
      }

      return (
        left.name.localeCompare(right.name) ||
        (left.email ?? "").localeCompare(right.email ?? "")
      );
    }),
    missingTaskAssigneeRowCount,
    missingTaskAssignees: [...missingTaskAssigneesByKey.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        (left.email ?? "").localeCompare(right.email ?? ""),
    ),
    missingRequiredMappings: LOOP_IMPORT_REQUIRED_FIELDS.filter(
      (field) => !mapping[field],
    ),
    overlappingProjectRowCount: 0,
    overlappingTaskRowCount: 0,
    projectSourceIdRowCount: rows.filter(
      (row) => row.project.identityStrategy === "source_id",
    ).length,
    rows: sampleSize > 0 ? rows.slice(0, sampleSize) : rows,
    taskSourceIdRowCount: rows.filter(
      (row) => row.task.identityStrategy === "source_id",
    ).length,
    totalRowCount: rows.length,
    validRowCount: rows.filter((row) => row.errors.length === 0).length,
    warningRowCount: rows.filter((row) => row.warnings.length > 0).length,
  };
}

export function normalizeLoopImportHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function readMappedValue(
  rawRow: Record<string, string | null>,
  header: string | null | undefined,
) {
  if (!header) {
    return null;
  }

  return rawRow[header] ?? null;
}

function toImportString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue ? nextValue : null;
}

function normalizeImportDate(
  value: string | null,
  fieldLabel: string,
  errors: string[],
) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${fieldLabel} is not a valid date`);
    return null;
  }

  return parsed.toISOString();
}

function normalizeImportPriority(
  value: string | null,
  fieldLabel: string,
  errors: string[],
): Priority {
  if (!value) {
    return "medium";
  }

  const normalizedValue = normalizeLoopImportHeader(value).replace(/ /g, "_");

  switch (normalizedValue) {
    case "low":
    case "minor":
    case "p3":
      return "low";
    case "medium":
    case "normal":
    case "med":
    case "p2":
      return "medium";
    case "high":
    case "urgent":
    case "critical":
    case "p1":
      return "high";
    default:
      errors.push(`${fieldLabel} must map to low, medium, or high`);
      return "medium";
  }
}

function normalizeImportTaskStatus(value: string | null, errors: string[]) {
  if (!value) {
    return "not_started";
  }

  const normalizedValue = normalizeLoopImportHeader(value).replace(/ /g, "_");

  switch (normalizedValue) {
    case "todo":
    case "to_do":
    case "not_started":
    case "open":
    case "pending":
      return "not_started";
    case "in_progress":
    case "inprogress":
    case "doing":
    case "active":
      return "in_progress";
    case "demo":
    case "demonstration":
    case "walkthrough":
      return "demo";
    case "review":
    case "in_review":
    case "qa":
    case "testing":
      return "review";
    case "blocked":
    case "stuck":
      return "blocked";
    case "on_hold":
    case "paused":
    case "hold":
      return "on_hold";
    case "done":
    case "complete":
    case "completed":
    case "closed":
      return "done";
    case "canceled":
    case "cancelled":
    case "wont_do":
      return "canceled";
    default:
      errors.push(`Task status "${value}" is not supported`);
      return "not_started";
  }
}

function resolveImportUser({
  defaultUserId,
  fieldLabel,
  trackMissingAssignee,
  users,
  value,
  warnings,
}: {
  defaultUserId: string;
  fieldLabel: string;
  trackMissingAssignee: boolean;
  users: LoopImportUser[];
  value: string | null;
  warnings: string[];
}) {
  if (!value) {
    return {
      missingUsers: [],
      missingAssignee: null,
      userId: defaultUserId,
    };
  }

  const candidate = parseImportUserCandidate(value);
  const resolved = resolveImportUserCandidate({
    blocksCommit: true,
    candidate,
    defaultUserId,
    fieldLabel,
    missingEmailHelpText:
      "Create the account or update the import before committing.",
    missingNoEmailHelpText:
      "did not match a known user and does not include an email address.",
    sourceLabel: fieldLabel,
    trackMissingUser: trackMissingAssignee,
    useDefaultUserId: true,
    users,
    warnings,
  });

  return {
    missingAssignee: resolved.missingUser
      ? {
          canCreate: resolved.missingUser.canCreate,
          email: resolved.missingUser.email,
          label: resolved.missingUser.label,
          name: resolved.missingUser.name,
        }
      : null,
    missingUsers: resolved.missingUser ? [resolved.missingUser] : [],
    userId: resolved.userId,
  };
}

function mergeTaskNotes(notes: string | null, blockedReason: string | null) {
  const normalizedNotes = normalizeOptionalImportText(notes);
  const normalizedBlockedReason = normalizeOptionalImportText(blockedReason);

  if (normalizedNotes && normalizedBlockedReason) {
    return `${normalizedNotes}\n\nBlocked: ${normalizedBlockedReason}`;
  }

  if (normalizedNotes) {
    return normalizedNotes;
  }

  if (normalizedBlockedReason) {
    return `Blocked: ${normalizedBlockedReason}`;
  }

  return null;
}

function normalizeOptionalImportText(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitChecklistTaskTitles(value: string | null) {
  if (!value) {
    return [];
  }

  const taskTitles = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return taskTitles.length > 1 ? taskTitles : [value];
}

function parseImportUserCandidates(value: string | null) {
  if (!value) {
    return [];
  }

  const normalizedValue = value.trim().replace(/\s+/g, " ");
  const structuredMatches = [
    ...normalizedValue.matchAll(
      /([^<;,]+?)\s*<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/gi,
    ),
  ];

  if (structuredMatches.length > 1) {
    return structuredMatches.map((match) => {
      const email = match[2]!.toLowerCase();
      const name =
        normalizeImportUserName(match[1] ?? "") ??
        deriveImportUserNameFromEmail(email);

      return {
        email,
        label: `${name} <${email}>`,
        name,
      };
    });
  }

  return [parseImportUserCandidate(normalizedValue)];
}

function parseImportUserCandidate(value: string) {
  const label = value.trim().replace(/\s+/g, " ");
  const emailMatch = label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (!emailMatch) {
    return {
      email: null,
      label,
      name: label,
    };
  }

  const email = emailMatch[0].toLowerCase();
  const name = normalizeImportUserName(
    label.replace(emailMatch[0], " ").replace(/[<>()]/g, " "),
  );

  return {
    email,
    label: name ? `${name} <${email}>` : email,
    name: name || deriveImportUserNameFromEmail(email),
  };
}

function resolveImportUserCandidate({
  blocksCommit,
  candidate,
  defaultUserId,
  fieldLabel,
  missingEmailHelpText,
  missingNoEmailHelpText,
  sourceLabel,
  trackMissingUser,
  useDefaultUserId,
  users,
  warnings,
}: {
  blocksCommit: boolean;
  candidate: ReturnType<typeof parseImportUserCandidate>;
  defaultUserId: string;
  fieldLabel: string;
  missingEmailHelpText: string;
  missingNoEmailHelpText: string;
  sourceLabel: string;
  trackMissingUser: boolean;
  useDefaultUserId: boolean;
  users: LoopImportUser[];
  warnings: string[];
}) {
  const matchedUser = findMatchingImportUser(candidate, users);

  if (matchedUser) {
    return {
      missingUser: null,
      userId: matchedUser.id,
    };
  }

  if (trackMissingUser) {
    warnings.push(
      candidate.email
        ? `${fieldLabel} "${candidate.label}" did not match a known user. ${missingEmailHelpText}`
        : `${fieldLabel} "${candidate.label}" ${missingNoEmailHelpText}`,
    );

    return {
      missingUser: {
        blocksCommit,
        canCreate: candidate.email !== null,
        email: candidate.email,
        label: candidate.label,
        name: candidate.name,
        sourceLabels: [sourceLabel],
      },
      userId: useDefaultUserId ? defaultUserId : null,
    };
  }

  warnings.push(
    `${fieldLabel} "${candidate.label}" did not match a known user. Defaulted to the import creator.`,
  );
  return {
    missingUser: null,
    userId: defaultUserId,
  };
}

function findMatchingImportUser(
  candidate: ReturnType<typeof parseImportUserCandidate>,
  users: LoopImportUser[],
) {
  return users.find(
    (user) =>
      user.email.trim().toLowerCase() === candidate.email ||
      user.email.trim().toLowerCase() === candidate.name.toLowerCase() ||
      user.name.trim().toLowerCase() === candidate.name.toLowerCase() ||
      user.name.trim().toLowerCase() === candidate.label.toLowerCase(),
  );
}

function normalizeImportUserName(value: string) {
  const normalized = value
    .replace(/\s[-|]+\s*/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function deriveImportUserNameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? email;
  const segments = localPart
    .split(/[._-]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return email;
  }

  return segments
    .map((segment) => segment[0]!.toUpperCase() + segment.slice(1))
    .join(" ");
}

export function buildPreparedLoopImportProjectKey(
  prepared: Pick<PreparedLoopImportRow, "project">,
) {
  if (prepared.project.externalId) {
    return `external:${prepared.project.externalId}`;
  }

  return `natural:${normalizePreparedLoopImportKey(prepared.project.title)}:${prepared.project.ownerUserId ?? ""}:${prepared.project.dueDate ?? ""}`;
}

export function buildPreparedLoopImportTaskKey(
  projectId: string,
  prepared: Pick<PreparedLoopImportRow, "task">,
) {
  if (prepared.task.externalId) {
    return `external:${prepared.task.externalId}`;
  }

  return `natural:${projectId}:${normalizePreparedLoopImportKey(prepared.task.title)}:${prepared.task.assigneeUserId}:${prepared.task.dueDate ?? ""}`;
}

export function hasPreparedLoopImportTask(
  task: Pick<PreparedLoopImportTask, "title">,
) {
  return Boolean(task.title);
}

function normalizePreparedLoopImportKey(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

// ---------------------------------------------------------------------------
// Non-admin notifications
// ---------------------------------------------------------------------------

export const notificationKindSchema = z.enum([
  "daily_non_admin_digest",
  "hourly_non_admin_digest",
  "task_assigned",
  "task_unassigned",
  "task_updated",
  "task_due_date_added",
  "task_due_date_changed",
  "task_blocked",
  "task_unblocked",
  "task_on_hold",
  "task_resumed",
  "task_reopened",
  "task_completed",
  "task_moved",
  "project_updated",
  "project_owner_assigned",
  "project_owner_changed",
  "project_owner_removed",
  "project_blocked",
  "project_on_hold",
  "project_resumed",
  "task_due_7_days",
  "task_due_3_days",
  "task_due_tomorrow",
  "task_due_today",
  "task_overdue",
  "daily_task_summary",
  "daily_project_summary",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationStatusSchema = z.enum([
  "queued",
  "processing",
  "sent",
  "skipped",
  "failed",
]);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export type ImmediateNotificationInput = {
  dedupeKey?: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  recipientUserId: string;
};

export type NotificationTaskSnapshot = {
  assigneeUserId: string | null;
  dueDate: string | null;
  id: string;
  projectId: string;
  projectTitle: string;
  status: TaskStatus;
  title: string;
};

export type NotificationProjectSnapshot = {
  id: string;
  ownerUserId: string | null;
  status: ProjectStatus;
  title: string;
};

export function buildImmediateTaskNotifications(input: {
  actorName: string;
  nextTask: NotificationTaskSnapshot;
  previousTask?: NotificationTaskSnapshot | null;
}): ImmediateNotificationInput[] {
  const { actorName, nextTask, previousTask = null } = input;
  const notifications: ImmediateNotificationInput[] = [];

  const queueForAssignee = (
    kind: NotificationKind,
    recipientUserId: string | null,
    payload: Record<string, unknown> = {},
  ) => {
    if (!recipientUserId) {
      return;
    }

    notifications.push({
      kind,
      payload: buildTaskNotificationPayload(
        actorName,
        previousTask,
        nextTask,
        payload,
      ),
      recipientUserId,
    });
  };

  if (previousTask === null) {
    queueForAssignee("task_assigned", nextTask.assigneeUserId);

    if (nextTask.dueDate) {
      queueForAssignee("task_due_date_added", nextTask.assigneeUserId);
    }

    if (nextTask.status === "blocked") {
      queueForAssignee("task_blocked", nextTask.assigneeUserId);
    }

    if (nextTask.status === "on_hold") {
      queueForAssignee("task_on_hold", nextTask.assigneeUserId);
    }

    if (nextTask.status === "done") {
      queueForAssignee("task_completed", nextTask.assigneeUserId);
    }

    return notifications;
  }

  if (previousTask.assigneeUserId !== nextTask.assigneeUserId) {
    queueForAssignee("task_unassigned", previousTask.assigneeUserId, {
      nextAssigneeUserId: nextTask.assigneeUserId,
    });

    queueForAssignee(
      previousTask.assigneeUserId === null ? "task_assigned" : "task_assigned",
      nextTask.assigneeUserId,
      {
        previousAssigneeUserId: previousTask.assigneeUserId,
      },
    );
  }

  if (previousTask.dueDate === null && nextTask.dueDate !== null) {
    queueForAssignee("task_due_date_added", nextTask.assigneeUserId);
  } else if (
    previousTask.dueDate !== null &&
    nextTask.dueDate !== null &&
    previousTask.dueDate !== nextTask.dueDate
  ) {
    queueForAssignee("task_due_date_changed", nextTask.assigneeUserId);
  }

  if (previousTask.status !== "blocked" && nextTask.status === "blocked") {
    queueForAssignee("task_blocked", nextTask.assigneeUserId);
  } else if (
    previousTask.status === "blocked" &&
    nextTask.status !== "blocked" &&
    nextTask.status !== "on_hold"
  ) {
    queueForAssignee("task_unblocked", nextTask.assigneeUserId);
  }

  if (previousTask.status !== "on_hold" && nextTask.status === "on_hold") {
    queueForAssignee("task_on_hold", nextTask.assigneeUserId);
  } else if (
    previousTask.status === "on_hold" &&
    nextTask.status !== "on_hold" &&
    nextTask.status !== "blocked"
  ) {
    queueForAssignee("task_resumed", nextTask.assigneeUserId);
  }

  if (
    previousTask.status === "done" &&
    nextTask.status !== "done" &&
    nextTask.status !== "canceled"
  ) {
    queueForAssignee("task_reopened", nextTask.assigneeUserId);
  }

  if (previousTask.status !== "done" && nextTask.status === "done") {
    queueForAssignee("task_completed", nextTask.assigneeUserId);
  }

  if (previousTask.projectId !== nextTask.projectId) {
    queueForAssignee("task_moved", nextTask.assigneeUserId);
  }

  return notifications;
}

export function buildImmediateProjectNotifications(input: {
  actorName: string;
  nextProject: NotificationProjectSnapshot;
  previousProject?: NotificationProjectSnapshot | null;
}): ImmediateNotificationInput[] {
  const { actorName, nextProject, previousProject = null } = input;
  const notifications: ImmediateNotificationInput[] = [];

  const queueForOwner = (
    kind: NotificationKind,
    recipientUserId: string | null,
    payload: Record<string, unknown> = {},
  ) => {
    if (!recipientUserId) {
      return;
    }

    notifications.push({
      kind,
      payload: {
        actorName,
        nextOwnerUserId: nextProject.ownerUserId,
        previousOwnerUserId: previousProject?.ownerUserId ?? null,
        previousStatus: previousProject?.status ?? null,
        projectId: nextProject.id,
        projectTitle: nextProject.title,
        status: nextProject.status,
        ...payload,
      },
      recipientUserId,
    });
  };

  if (previousProject === null) {
    queueForOwner("project_owner_assigned", nextProject.ownerUserId);

    if (nextProject.status === "blocked") {
      queueForOwner("project_blocked", nextProject.ownerUserId);
    }

    if (nextProject.status === "on_hold") {
      queueForOwner("project_on_hold", nextProject.ownerUserId);
    }

    return notifications;
  }

  if (previousProject.ownerUserId !== nextProject.ownerUserId) {
    queueForOwner("project_owner_removed", previousProject.ownerUserId);

    queueForOwner(
      previousProject.ownerUserId === null
        ? "project_owner_assigned"
        : "project_owner_changed",
      nextProject.ownerUserId,
    );
  }

  if (
    previousProject.status !== "blocked" &&
    nextProject.status === "blocked"
  ) {
    queueForOwner("project_blocked", nextProject.ownerUserId);
  }

  if (
    previousProject.status !== "on_hold" &&
    nextProject.status === "on_hold"
  ) {
    queueForOwner("project_on_hold", nextProject.ownerUserId);
  } else if (
    previousProject.status === "on_hold" &&
    nextProject.status !== "on_hold" &&
    nextProject.status !== "blocked"
  ) {
    queueForOwner("project_resumed", nextProject.ownerUserId);
  }

  return notifications;
}

function buildTaskNotificationPayload(
  actorName: string,
  previousTask: NotificationTaskSnapshot | null,
  nextTask: NotificationTaskSnapshot,
  payload: Record<string, unknown>,
) {
  return {
    actorName,
    dueDate: nextTask.dueDate,
    previousAssigneeUserId: previousTask?.assigneeUserId ?? null,
    previousDueDate: previousTask?.dueDate ?? null,
    previousProjectId: previousTask?.projectId ?? null,
    previousProjectTitle: previousTask?.projectTitle ?? null,
    previousStatus: previousTask?.status ?? null,
    projectId: nextTask.projectId,
    projectTitle: nextTask.projectTitle,
    status: nextTask.status,
    taskId: nextTask.id,
    taskTitle: nextTask.title,
    ...payload,
  };
}

// ---------------------------------------------------------------------------
// Email settings and SMTP status
// ---------------------------------------------------------------------------

export const dailyDigestTimeSchema = hourlyTimeOfDaySchema;

export const emailSettingsSchema = z.object({
  enabled: z.boolean(),
  dragHandlesEnabled: z.boolean(),
  guestAccessEnabled: z.boolean(),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export const updateEmailSettingsSchema = z.object({
  enabled: z.boolean(),
  dragHandlesEnabled: z.boolean(),
  guestAccessEnabled: z.boolean(),
  smtpUrl: z.string().trim().min(1).optional(),
  fromAddress: z.string().trim().email().optional(),
  homeUrl: z.string().trim().url().optional(),
});
export type UpdateEmailSettingsInput = z.infer<
  typeof updateEmailSettingsSchema
>;

export const notificationPreferencesSchema = z.object({
  dailyDigestEnabled: z.boolean(),
  dailyDigestTime: dailyDigestTimeSchema,
  personalTodoRetention: personalTodoRetentionPolicySchema,
  personalTodoRemindersEnabled: z.boolean(),
});
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

export const updateNotificationPreferencesSchema = z
  .object({
    dailyDigestEnabled: z.boolean().optional(),
    dailyDigestTime: dailyDigestTimeSchema.optional(),
    personalTodoRetention: personalTodoRetentionPolicySchema.optional(),
    personalTodoRemindersEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.dailyDigestEnabled !== undefined ||
      value.dailyDigestTime !== undefined ||
      value.personalTodoRetention !== undefined ||
      value.personalTodoRemindersEnabled !== undefined,
    {
      message: "At least one notification preference must be provided.",
    },
  );
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

const workspacePanelStateSchema = z.object({
  backups: z.boolean(),
  importExport: z.boolean(),
  newProject: z.boolean(),
  personalTodo: z.boolean(),
  profile: z.boolean(),
  settings: z.boolean(),
  view: z.boolean(),
});
export type WorkspacePanelState = z.infer<typeof workspacePanelStateSchema>;

export const workspacePreferencesSchema = z.object({
  autoCollapse: z.boolean(),
  bulkActions: z.boolean(),
  fullWidth: z.boolean(),
  theme: workspaceThemeSchema,
});
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;

export const workspaceFilterStateSchema = z.object({
  assigneeUserIds: z.array(z.string().min(1)),
  groupBy: groupBySchema,
  notViewedOnly: z.boolean().default(false),
  sortBy: z.array(projectSortFieldSchema),
  statusFilters: z.array(projectStatusSchema),
});
export type WorkspaceFilterState = z.infer<typeof workspaceFilterStateSchema>;

const workspaceBooleanSelectionSchema = z.record(z.string(), z.boolean());

const workspaceCollapsedGroupsSchema = z.object({
  none: workspaceBooleanSelectionSchema.optional(),
  owner: workspaceBooleanSelectionSchema.optional(),
  priority: workspaceBooleanSelectionSchema.optional(),
  progress: workspaceBooleanSelectionSchema.optional(),
  status: workspaceBooleanSelectionSchema.optional(),
});
export type WorkspaceCollapsedGroups = z.infer<
  typeof workspaceCollapsedGroupsSchema
>;

const noteEditorHeightsSchema = z.object({
  project: z.number().int().positive().nullable(),
  task: z.number().int().positive().nullable(),
});
export type NoteEditorHeights = z.infer<typeof noteEditorHeightsSchema>;

export const workspaceUserConfigSchema = z.object({
  addTaskPanels: workspaceBooleanSelectionSchema,
  collapsedGroups: workspaceCollapsedGroupsSchema,
  filters: workspaceFilterStateSchema,
  hideDonePersonalTodos: z.boolean(),
  hideDoneTasksByProject: workspaceBooleanSelectionSchema,
  noteEditorHeights: noteEditorHeightsSchema,
  panels: workspacePanelStateSchema,
  preferences: workspacePreferencesSchema,
});
export type WorkspaceUserConfig = z.infer<typeof workspaceUserConfigSchema>;

export const resetUserSettingsResponseSchema = z.object({
  notificationPreferences: notificationPreferencesSchema,
  userConfig: workspaceUserConfigSchema,
});
export type ResetUserSettingsResponse = z.infer<
  typeof resetUserSettingsResponseSchema
>;

export const smtpStatusSchema = z.object({
  enabled: z.boolean(),
  configured: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  secure: z.boolean(),
  fromAddress: z.string(),
  smtpUrl: z.string(),
  homeUrl: z.string().url(),
  smtpUrlSource: z.enum(["database", "environment"]),
  fromAddressSource: z.enum(["database", "environment"]),
  homeUrlSource: z.enum(["database", "environment"]),
  dragHandlesEnabled: z.boolean(),
  guestAccessEnabled: z.boolean(),
});
export type SmtpStatus = z.infer<typeof smtpStatusSchema>;

export const backupFileSummarySchema = z.object({
  createdAt: z.string().min(1),
  fileName: z.string().min(1),
  modifiedAt: z.string().min(1),
  protected: z.boolean(),
  protectedAt: z.string().nullable(),
  protectedByName: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
});
export type BackupFileSummary = z.infer<typeof backupFileSummarySchema>;

export const backupStatusSchema = z.object({
  backupDirectory: z.string().min(1),
  backupDirectoryAccessible: z.boolean(),
  backups: z.array(backupFileSummarySchema),
  enabled: z.boolean(),
  lastError: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastScheduledRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  retentionPolicy: backupRetentionPolicySchema,
  scheduleTime: timeOfDaySchema,
  totalSizeBytes: z.number().int().nonnegative(),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const updateBackupSettingsSchema = z.object({
  enabled: z.boolean(),
  retentionPolicy: backupRetentionPolicySchema.optional(),
  scheduleTime: timeOfDaySchema,
});
export type UpdateBackupSettingsInput = z.infer<
  typeof updateBackupSettingsSchema
>;

export const updateBackupProtectionSchema = z.object({
  protected: z.boolean(),
});
export type UpdateBackupProtectionInput = z.infer<
  typeof updateBackupProtectionSchema
>;

export const uploadBackupFileSchema = z.object({
  content: z.string().min(1),
  fileName: z.string().trim().min(1),
});
export type UploadBackupFileInput = z.infer<typeof uploadBackupFileSchema>;

export const backupRestoreSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    fileName: z.string().trim().min(1),
    kind: z.literal("stored"),
  }),
  z.object({
    content: z.string().min(1),
    fileName: z.string().trim().min(1),
    kind: z.literal("upload"),
  }),
]);
export type BackupRestoreSource = z.infer<typeof backupRestoreSourceSchema>;

export const backupRestoreConflictActionSchema = z.enum(["skip", "replace"]);
export type BackupRestoreConflictAction = z.infer<
  typeof backupRestoreConflictActionSchema
>;

export const backupRestoreScopeSchema = z.enum([
  "full",
  "projects_tasks",
  "users",
]);
export type BackupRestoreScope = z.infer<typeof backupRestoreScopeSchema>;

export const backupRestoreConflictSchema = z.object({
  existingEmail: z.string().nullable().optional(),
  existingId: z.string().nullable().optional(),
  existingTitle: z.string().nullable().optional(),
  kind: z.enum(["email", "id", "none", "source_identity"]),
  matchedBy: z.enum(["email", "id", "source_identity"]).nullable().optional(),
});
export type BackupRestoreConflict = z.infer<typeof backupRestoreConflictSchema>;

export const backupRestoreProjectPreviewSchema = z.object({
  backupId: z.string().min(1),
  conflict: backupRestoreConflictSchema,
  dueDate: z.string().nullable(),
  missingAssigneeCount: z.number().int().nonnegative(),
  missingOwner: z.boolean(),
  ownerName: z.string().nullable(),
  taskCount: z.number().int().nonnegative(),
  title: z.string().min(1),
});
export type BackupRestoreProjectPreview = z.infer<
  typeof backupRestoreProjectPreviewSchema
>;

export const backupRestoreUserPreviewSchema = z.object({
  backupId: z.string().min(1),
  conflict: backupRestoreConflictSchema,
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
});
export type BackupRestoreUserPreview = z.infer<
  typeof backupRestoreUserPreviewSchema
>;

export const backupSnapshotCountsSchema = z.object({
  auditEvents: z.number().int().nonnegative(),
  backupSettings: z.number().int().nonnegative(),
  emailSettings: z.number().int().nonnegative(),
  importJobs: z.number().int().nonnegative(),
  importRows: z.number().int().nonnegative(),
  notificationDeliveryAttempts: z.number().int().nonnegative(),
  notificationEvents: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  projectViewStates: z.number().int().nonnegative(),
  retentionSettings: z.number().int().nonnegative(),
  roleAssignments: z.number().int().nonnegative(),
  savedViews: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
  taskViewStates: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
});
export type BackupSnapshotCounts = z.infer<typeof backupSnapshotCountsSchema>;

export const backupRestorePreviewSchema = z.object({
  counts: backupSnapshotCountsSchema,
  createdAt: z.string().min(1),
  fileName: z.string().min(1),
  format: z.string().min(1),
  projects: z.array(backupRestoreProjectPreviewSchema),
  sourceLabel: z.string().min(1),
  users: z.array(backupRestoreUserPreviewSchema),
});
export type BackupRestorePreview = z.infer<typeof backupRestorePreviewSchema>;

export const previewBackupRestoreSchema = z.object({
  source: backupRestoreSourceSchema,
});
export type PreviewBackupRestoreInput = z.infer<
  typeof previewBackupRestoreSchema
>;

export const applyBackupRestoreSchema = z.object({
  projectConflictResolutions: z
    .record(z.string(), backupRestoreConflictActionSchema)
    .optional(),
  projectIds: z.array(z.string().min(1)).optional(),
  scope: backupRestoreScopeSchema,
  source: backupRestoreSourceSchema,
  userConflictResolutions: z
    .record(z.string(), backupRestoreConflictActionSchema)
    .optional(),
  userIds: z.array(z.string().min(1)).optional(),
});
export type ApplyBackupRestoreInput = z.infer<typeof applyBackupRestoreSchema>;

export const applyBackupRestoreResultSchema = z.object({
  reauthenticateRequired: z.boolean(),
  scope: backupRestoreScopeSchema,
  summary: z.object({
    fullRestoreApplied: z.boolean(),
    projectsCreated: z.number().int().nonnegative(),
    projectsReplaced: z.number().int().nonnegative(),
    projectsSkipped: z.number().int().nonnegative(),
    tasksCreated: z.number().int().nonnegative(),
    usersCreated: z.number().int().nonnegative(),
    usersReplaced: z.number().int().nonnegative(),
    usersSkipped: z.number().int().nonnegative(),
  }),
});
export type ApplyBackupRestoreResult = z.infer<
  typeof applyBackupRestoreResultSchema
>;
