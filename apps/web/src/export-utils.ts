import { appName, appVersion } from "@tavi/config";
import writeXlsxFile from "write-excel-file/browser";
import type { GroupBy, ProjectSortField, ProjectStatus } from "./types";
import type { WorkspaceProject, WorkspaceTask } from "./types";

type ExportContext = {
  assigneeUserIds: string[];
  groupBy: GroupBy;
  projects: WorkspaceProject[];
  search: string;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
};

type ExportRow = Record<string, string>;
type FlattenedProjectRow = {
  project: WorkspaceProject;
  task: WorkspaceTask | null;
};

const WORKSPACE_EXPORT_COLUMNS = [
  "Group",
  "Project Title",
  "Project Notes",
  "Project Owner",
  "Project Display Status",
  "Project Derived Status",
  "Project Priority",
  "Project Due Date",
  "Task Title",
  "Task Notes",
  "Task Assignee",
  "Task Status",
  "Task Priority",
  "Task Due Date",
  "Task Completed At",
] as const;

const LOOP_EXPORT_COLUMNS = [
  "Project External Id",
  "Project Title",
  "Project Notes",
  "Project Owner",
  "Project Due Date",
  "Project Priority",
  "Task External Id",
  "Task Title",
  "Task Notes",
  "Task Assignee",
  "Task Due Date",
  "Task Priority",
  "Task Status",
] as const;

export function buildWorkspaceExportRows({
  groupBy,
  projects,
}: Pick<ExportContext, "groupBy" | "projects">): ExportRow[] {
  return flattenProjects(projects).map(({ project, task }) => ({
    Group: formatProjectGroup(project, groupBy),
    "Project Title": project.title,
    "Project Notes": project.notes ?? "",
    "Project Owner": project.ownerName ?? "",
    "Project Display Status": project.displayStatus,
    "Project Derived Status": project.derivedStatus,
    "Project Priority": project.priority,
    "Project Due Date": formatExportDate(project.dueDate),
    "Task Title": task?.title ?? "",
    "Task Notes": task?.notes ?? "",
    "Task Assignee": task?.assigneeName ?? "",
    "Task Status": task?.status ?? "",
    "Task Priority": task?.priority ?? "",
    "Task Due Date": formatExportDate(task?.dueDate ?? null),
    "Task Completed At": formatExportDateTime(task?.completedAt ?? null),
  }));
}

export function buildLoopExportRows(projects: WorkspaceProject[]): ExportRow[] {
  return flattenProjects(projects).map(({ project, task }) => ({
    "Project External Id": "",
    "Project Title": project.title,
    "Project Notes": project.notes ?? "",
    "Project Owner": project.ownerName ?? "",
    "Project Due Date": formatExportDate(project.dueDate),
    "Project Priority": project.priority,
    "Task External Id": "",
    "Task Title": task?.title ?? "",
    "Task Notes": task?.notes ?? "",
    "Task Assignee": task?.assigneeName ?? "",
    "Task Due Date": formatExportDate(task?.dueDate ?? null),
    "Task Priority": task?.priority ?? "",
    "Task Status": task?.status ?? "",
  }));
}

export function createCsvContent(
  rows: ExportRow[],
  headers: readonly string[],
): string {
  const lines = [headers.map(escapeCsvValue).join(",")];

  for (const row of rows) {
    lines.push(
      headers.map((header) => escapeCsvValue(row[header] ?? "")).join(","),
    );
  }

  return lines.join("\n");
}

export function downloadCsvFile(
  prefix: string,
  rows: ExportRow[],
  headers: readonly string[],
) {
  const content = createCsvContent(rows, headers);

  downloadBlob(
    buildFileName(prefix, "csv"),
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
}

export function downloadWorkspaceCsv(context: ExportContext) {
  const rows = buildWorkspaceExportRows(context);
  downloadCsvFile("workspace", rows, WORKSPACE_EXPORT_COLUMNS);
}

export async function downloadWorkspaceXlsx(context: ExportContext) {
  const rows = buildWorkspaceExportRows(context);
  const sheetData = [
    [...WORKSPACE_EXPORT_COLUMNS],
    ...rows.map((row) =>
      WORKSPACE_EXPORT_COLUMNS.map((column) => row[column] ?? ""),
    ),
  ];
  const content = await writeXlsxFile(sheetData, {
    sheet: "Workspace",
  }).toBlob();

  downloadBlob(
    buildFileName("workspace", "xlsx"),
    new Blob([content], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

export function downloadWorkspaceJson(context: ExportContext) {
  const payload = {
    app: {
      name: appName,
      version: appVersion,
    },
    exportedAt: new Date().toISOString(),
    view: {
      groupBy: context.groupBy,
      search: context.search,
      sortBy: context.sortBy,
      statusFilters: context.statusFilters,
      assigneeUserIds: context.assigneeUserIds,
    },
    counts: {
      projectCount: context.projects.length,
      taskCount: context.projects.reduce(
        (count, project) => count + project.tasks.length,
        0,
      ),
    },
    projects: context.projects,
  };

  downloadJsonFile("workspace", payload);
}

export function downloadLoopCsv(projects: WorkspaceProject[]) {
  const rows = buildLoopExportRows(projects);
  downloadCsvFile("loop-export", rows, LOOP_EXPORT_COLUMNS);
}

export function downloadJsonFile(prefix: string, payload: unknown) {
  downloadBlob(
    buildFileName(prefix, "json"),
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
}

function flattenProjects(projects: WorkspaceProject[]): FlattenedProjectRow[] {
  return projects.flatMap<FlattenedProjectRow>((project) => {
    if (project.tasks.length === 0) {
      return [{ project, task: null }];
    }

    return project.tasks.map((task) => ({ project, task }));
  });
}

function formatProjectGroup(project: WorkspaceProject, groupBy: GroupBy) {
  switch (groupBy) {
    case "none":
      return "Projects";
    case "owner":
      return project.ownerName ?? "No owner";
    case "priority":
      return project.priority;
    case "progress":
      return formatProjectProgress(project);
    case "status":
      return formatStatusLabel(project.displayStatus);
  }
}

function formatProjectProgress(project: WorkspaceProject) {
  if (project.taskTotalCount === 0) {
    return "0%";
  }

  return `${Math.round((project.taskDoneCount / project.taskTotalCount) * 100).toString()}%`;
}

function formatStatusLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatExportDate(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatExportDateTime(value: string | null) {
  return value ? value : "";
}

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function buildFileName(prefix: string, extension: string) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `tavi-${prefix}-${dateStamp}.${extension}`;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
