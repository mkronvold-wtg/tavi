import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProject } from "./types";
import {
  buildLoopExportRows,
  buildWorkspaceExportRows,
  createCsvContent,
  downloadWorkspaceXlsx,
} from "./export-utils";

const writeXlsxFileMock = vi.hoisted(() => vi.fn());

vi.mock("write-excel-file/browser", () => ({
  default: writeXlsxFileMock,
}));

const sampleProjects: WorkspaceProject[] = [
  {
    id: "project-1",
    title: "Roadmap refresh",
    notes: "Discuss sequencing",
    references: null,
    ownerUserId: "user-1",
    ownerName: "Taylor",
    dueDate: "2026-04-30T00:00:00.000Z",
    priority: "high",
    derivedStatus: "in_progress",
    displayStatus: "blocked",
    manualStatus: "blocked",
    taskTotalCount: 1,
    taskTodoCount: 0,
    taskInProgressCount: 1,
    taskBlockedCount: 0,
    taskDoneCount: 0,
    taskCanceledCount: 0,
    taskOverdueCount: 0,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    tasks: [
      {
        id: "task-1",
        projectId: "project-1",
        title: "Validate milestones",
        notes: "Blocked: waiting on approvals",
        assigneeUserId: "user-2",
        assigneeName: "Jordan",
        dueDate: "2026-04-28T00:00:00.000Z",
        priority: "medium",
        status: "blocked",
        sortOrder: 0,
        completedAt: null,
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ],
  },
];

describe("export-utils", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    writeXlsxFileMock.mockReset();
  });

  it("builds workspace export rows with project and task notes", () => {
    expect(
      buildWorkspaceExportRows({ groupBy: "owner", projects: sampleProjects }),
    ).toEqual([
      expect.objectContaining({
        Group: "Taylor",
        "Project Notes": "Discuss sequencing",
        "Task Notes": "Blocked: waiting on approvals",
        "Task Status": "blocked",
      }),
    ]);
  });

  it("builds loop export rows with notes fields", () => {
    expect(buildLoopExportRows(sampleProjects)).toEqual([
      expect.objectContaining({
        "Project Notes": "Discuss sequencing",
        "Task Notes": "Blocked: waiting on approvals",
        "Task Status": "blocked",
      }),
    ]);
  });

  it("creates CSV output with escaped values", () => {
    const content = createCsvContent(
      [
        {
          Notes: 'Needs "quotes"',
          Title: "Roadmap refresh",
        },
      ],
      ["Title", "Notes"],
    );

    expect(content).toContain("Title,Notes");
    expect(content).toContain('"Needs ""quotes"""');
  });

  it("downloads an XLSX workbook with the current workspace rows", async () => {
    const workbookContent = new Blob(["xlsx-content"]);
    const toBlob = vi.fn(async () => workbookContent);
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => "blob:workspace",
    );
    const revokeObjectURL = vi.fn();
    const downloadedFileNames: string[] = [];

    writeXlsxFileMock.mockReturnValue({ toBlob });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedFileNames.push(this.download);
    });

    await downloadWorkspaceXlsx({
      assigneeUserIds: [],
      groupBy: "owner",
      projects: sampleProjects,
      search: "",
      sortBy: [],
      statusFilters: [],
    });

    expect(writeXlsxFileMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining(["Group", "Project Title", "Task Status"]),
        expect.arrayContaining(["Taylor", "Roadmap refresh", "blocked"]),
      ]),
      { sheet: "Workspace" },
    );
    expect(toBlob).toHaveBeenCalledOnce();
    expect(downloadedFileNames).toEqual([
      `tavi-workspace-${new Date().toISOString().slice(0, 10)}.xlsx`,
    ]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workspace");

    const downloadedBlob = createObjectURL.mock.calls[0]?.[0];
    expect(downloadedBlob).toBeInstanceOf(Blob);

    if (!downloadedBlob) {
      throw new Error("Expected XLSX content to be downloaded.");
    }

    expect(downloadedBlob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    await expect(downloadedBlob.text()).resolves.toBe("xlsx-content");
  });
});
