import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateLoopImportInput,
  LoopImportMapping,
  LoopImportOverlapAction,
  LoopImportPreview,
  LoopImportUser,
  UpdateLoopImportMappingInput,
  UpdateLoopImportRowDecisionsInput,
} from '@tavi/schemas';
import {
  buildLoopImportPreview,
  hasPreparedLoopImportTask,
  buildPreparedLoopImportProjectKey,
  buildPreparedLoopImportTaskKey,
  expandLoopImportRows,
  loopImportFieldDefinitions,
  loopImportMappingSchema,
} from '@tavi/schemas';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';

type ImportJobRecord = {
  completedAt: Date | null;
  createdAt: Date;
  createdProjectCount: number;
  createdRowCount: number;
  createdTaskCount: number;
  createdByUserId: string;
  failedRowCount: number;
  fileName: string;
  headers: Prisma.JsonValue | null;
  id: string;
  lastError: string | null;
  mapping: Prisma.JsonValue | null;
  skippedRowCount: number;
  sourceSystem: string;
  status: string;
  suggestedMapping: Prisma.JsonValue | null;
  totalRowCount: number;
  updatedAt: Date;
  updatedProjectCount: number;
  updatedRowCount: number;
  updatedTaskCount: number;
};

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async listImports(actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const imports = await this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        createdBy: {
          select: {
            email: true,
            id: true,
            name: true,
          },
        },
      },
    });

    return imports.map((job) => ({
      ...serializeImportJob(job),
      createdBy: {
        email: job.createdBy.email,
        id: job.createdBy.id,
        name: job.createdBy.name,
      },
    }));
  }

  async createLoopImport(input: CreateLoopImportInput, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const content = input.content.trim();

    if (!content) {
      throw new BadRequestException('Import file content cannot be empty');
    }

    const job = await this.prisma.importJob.create({
      data: {
        createdByUserId: actor.id,
        fileName: input.fileName.trim(),
        sourceContent: input.content,
        sourceSystem: 'loop',
        status: 'queued_parse',
      },
    });

    return serializeImportJob(job);
  }

  async getLoopImport(importId: string, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const [job, stagedRows, resultRows, users] = await Promise.all([
      this.prisma.importJob.findUnique({
        where: { id: importId },
      }),
      this.prisma.importRow.findMany({
        where: { importId },
        orderBy: { rowNumber: 'asc' },
        select: {
          projectOverlapAction: true,
          rawData: true,
          rowNumber: true,
          taskOverlapAction: true,
        },
      }),
      this.prisma.importRow.findMany({
        where: {
          importId,
          rowOutcome: {
            not: 'pending',
          },
        },
        orderBy: { rowNumber: 'asc' },
        take: 25,
        select: {
          message: true,
          projectId: true,
          projectOutcome: true,
          rowNumber: true,
          rowOutcome: true,
          taskId: true,
          taskOutcome: true,
          validationErrors: true,
        },
      }),
      this.getImportUsers(),
    ]);

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    const headers = readHeaderList(job.headers);
    const mapping = readLoopImportMapping(job.mapping);
    const suggestedMapping = readLoopImportMapping(job.suggestedMapping);
    const preview = await this.buildLoopImportJobPreview({
      createdByUserId: job.createdByUserId,
      mapping,
      sourceSystem: job.sourceSystem,
      stagedRows,
      users,
    });
    const mappedHeaders = new Set(
      Object.values(mapping).filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0,
      ),
    );

    return {
      ...serializeImportJob(job),
      fields: loopImportFieldDefinitions,
      headers,
      mapping,
      preview: {
        ...preview,
        rows: preview.rows.map((row) => ({
          errors: row.errors,
          projectExternalId: row.project.externalId,
          projectIdentityStrategy: row.project.identityStrategy,
          projectOverlap: row.projectOverlap,
          projectTitle: row.project.title,
          rowNumber: row.rowNumber,
          taskExternalId: row.task.externalId,
          taskIdentityStrategy: row.task.identityStrategy,
          taskOverlap: row.taskOverlap,
          taskStatus: row.task.status,
          taskTitle: row.task.title,
          warnings: row.warnings,
        })),
        unmappedHeaders: headers.filter((header) => !mappedHeaders.has(header)),
      },
      results: resultRows.map((row) => ({
        message: row.message,
        projectId: row.projectId,
        projectOutcome: row.projectOutcome,
        rowNumber: row.rowNumber,
        rowOutcome: row.rowOutcome,
        taskId: row.taskId,
        taskOutcome: row.taskOutcome,
        validationErrors: readValidationErrors(row.validationErrors),
      })),
      suggestedMapping,
    };
  }

  async removeLoopImport(importId: string, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const existingImport = await this.prisma.importJob.findUnique({
      where: { id: importId },
      select: { id: true },
    });

    if (!existingImport) {
      throw new NotFoundException('Import not found');
    }

    await this.prisma.importJob.delete({
      where: { id: importId },
    });

    return { id: importId };
  }

  async updateLoopImportMapping(
    importId: string,
    input: UpdateLoopImportMappingInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const job = await this.prisma.importJob.findUnique({
      where: { id: importId },
      select: {
        headers: true,
        id: true,
        sourceContent: true,
        status: true,
      },
    });

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    if (job.status !== 'awaiting_review') {
      throw new BadRequestException('Only staged imports can update mapping');
    }

    const headers = readHeaderList(job.headers);

    if (headers.length === 0) {
      throw new BadRequestException('Import headers are not available yet');
    }

    const unavailableHeaders = listUnavailableMappedHeaders(
      headers,
      input.mapping,
    );

    if (unavailableHeaders.length > 0) {
      throw new BadRequestException(
        `Mapped headers are not present in the staged import: ${unavailableHeaders.join(', ')}`,
      );
    }

    const mapping = sanitizeLoopImportMapping(headers, input.mapping);
    const stagedRows = buildStagedImportRows(job.sourceContent, mapping);

    await this.prisma.$transaction(async (tx) => {
      await tx.importRow.deleteMany({
        where: { importId },
      });

      if (stagedRows.length > 0) {
        await tx.importRow.createMany({
          data: stagedRows.map((row, index) => ({
            importId,
            rawData: row as Prisma.InputJsonValue,
            rowNumber: index + 1,
          })),
        });
      }

      await tx.importJob.update({
        where: { id: importId },
        data: {
          mapping: mapping,
          totalRowCount: stagedRows.length,
        },
      });
    });

    return this.getLoopImport(importId, actor);
  }

  async updateLoopImportRowDecisions(
    importId: string,
    rowNumber: number,
    input: UpdateLoopImportRowDecisionsInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const [job, stagedRows, users] = await Promise.all([
      this.prisma.importJob.findUnique({
        where: { id: importId },
        select: {
          createdByUserId: true,
          id: true,
          mapping: true,
          sourceSystem: true,
          status: true,
        },
      }),
      this.prisma.importRow.findMany({
        where: { importId },
        orderBy: { rowNumber: 'asc' },
        select: {
          projectOverlapAction: true,
          rawData: true,
          rowNumber: true,
          taskOverlapAction: true,
        },
      }),
      this.getImportUsers(),
    ]);

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    if (job.status !== 'awaiting_review') {
      throw new BadRequestException(
        'Only staged imports can update overlap decisions',
      );
    }

    const preview = await this.buildLoopImportJobPreview({
      createdByUserId: job.createdByUserId,
      mapping: readLoopImportMapping(job.mapping),
      sourceSystem: job.sourceSystem,
      stagedRows,
      users,
    });
    const targetRow = preview.rows.find((row) => row.rowNumber === rowNumber);

    if (!targetRow) {
      throw new NotFoundException('Import row not found');
    }

    const updates: Prisma.PrismaPromise<unknown>[] = [];

    if (input.projectAction !== undefined) {
      const projectGroupKey = buildPreparedLoopImportProjectKey(targetRow);
      const projectRowNumbers = preview.rows
        .filter(
          (row) => buildPreparedLoopImportProjectKey(row) === projectGroupKey,
        )
        .map((row) => row.rowNumber);

      if (!targetRow.projectOverlap && projectRowNumbers.length <= 1) {
        throw new BadRequestException(
          'Project overlap action can only be changed for overlapping rows',
        );
      }

      updates.push(
        this.prisma.importRow.updateMany({
          where: {
            importId,
            rowNumber: {
              in: projectRowNumbers,
            },
          },
          data: {
            projectOverlapAction: input.projectAction,
          },
        }),
      );
    }

    if (input.taskAction !== undefined) {
      const projectGroupKey = buildPreparedLoopImportProjectKey(targetRow);
      const taskGroupKey = buildPreparedLoopImportTaskKey(
        projectGroupKey,
        targetRow,
      );
      const taskRowNumbers = preview.rows
        .filter(
          (row) =>
            buildPreparedLoopImportTaskKey(
              buildPreparedLoopImportProjectKey(row),
              row,
            ) === taskGroupKey,
        )
        .map((row) => row.rowNumber);

      if (!targetRow.taskOverlap && taskRowNumbers.length <= 1) {
        throw new BadRequestException(
          'Task overlap action can only be changed for overlapping rows',
        );
      }

      updates.push(
        this.prisma.importRow.updateMany({
          where: {
            importId,
            rowNumber: {
              in: taskRowNumbers,
            },
          },
          data: {
            taskOverlapAction: input.taskAction,
          },
        }),
      );
    }

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    return this.getLoopImport(importId, actor);
  }

  async queueLoopImportCommit(importId: string, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const [job, stagedRows, users] = await Promise.all([
      this.prisma.importJob.findUnique({
        where: { id: importId },
        select: {
          createdByUserId: true,
          id: true,
          mapping: true,
          sourceSystem: true,
          status: true,
        },
      }),
      this.prisma.importRow.findMany({
        where: { importId },
        orderBy: { rowNumber: 'asc' },
        select: {
          projectOverlapAction: true,
          rawData: true,
          rowNumber: true,
          taskOverlapAction: true,
        },
      }),
      this.getImportUsers(),
    ]);

    if (!job) {
      throw new NotFoundException('Import not found');
    }

    if (job.status !== 'awaiting_review') {
      throw new BadRequestException('Only staged imports can be committed');
    }

    if (stagedRows.length === 0) {
      throw new BadRequestException('No staged rows are available to import');
    }

    const preview = await this.buildLoopImportJobPreview({
      createdByUserId: job.createdByUserId,
      mapping: readLoopImportMapping(job.mapping),
      sourceSystem: job.sourceSystem,
      stagedRows,
      users,
    });

    if (preview.missingRequiredMappings.length > 0) {
      throw new BadRequestException(
        `Map required fields before committing: ${preview.missingRequiredMappings.join(', ')}`,
      );
    }

    if (preview.validRowCount === 0) {
      throw new BadRequestException(
        'No valid rows remain after applying the current mapping',
      );
    }

    if (preview.blockingMissingUserRowCount > 0) {
      throw new BadRequestException(
        'Resolve missing import users that block commit before committing. Create the missing accounts or update the import.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.importJob.update({
        where: { id: importId },
        data: {
          completedAt: null,
          createdProjectCount: 0,
          createdRowCount: 0,
          createdTaskCount: 0,
          failedRowCount: 0,
          lastError: null,
          skippedRowCount: 0,
          status: 'queued_commit',
          updatedProjectCount: 0,
          updatedRowCount: 0,
          updatedTaskCount: 0,
        },
      }),
      this.prisma.importRow.updateMany({
        where: { importId },
        data: {
          message: null,
          projectId: null,
          projectOutcome: 'pending',
          rowOutcome: 'pending',
          taskId: null,
          taskOutcome: 'pending',
          validationErrors: Prisma.DbNull,
        },
      }),
    ]);

    return this.getLoopImport(importId, actor);
  }

  private async buildLoopImportJobPreview({
    createdByUserId,
    mapping,
    sourceSystem,
    stagedRows,
    users,
  }: {
    createdByUserId: string;
    mapping: LoopImportMapping;
    sourceSystem: string;
    stagedRows: Array<{
      projectOverlapAction: LoopImportOverlapAction;
      rawData: Prisma.JsonValue;
      rowNumber: number;
      taskOverlapAction: LoopImportOverlapAction;
    }>;
    users: LoopImportUser[];
  }): Promise<LoopImportPreview> {
    const basePreview = buildLoopImportPreview({
      defaultUserId: createdByUserId,
      mapping,
      rawRows: stagedRows.map((row) => parseRawRow(row.rawData)),
      sampleSize: 0,
      users,
    });
    const rowActionsByNumber = new Map(
      stagedRows.map((row) => [
        row.rowNumber,
        {
          projectAction: row.projectOverlapAction,
          taskAction: row.taskOverlapAction,
        },
      ]),
    );
    const overlapPreview = await buildLoopImportOverlapPreview({
      prisma: this.prisma,
      rowActionsByNumber,
      rows: basePreview.rows,
      sourceSystem,
    });

    return {
      ...basePreview,
      invalidRowCount: overlapPreview.rows.filter(
        (row) => row.errors.length > 0,
      ).length,
      overlappingProjectRowCount: overlapPreview.overlappingProjectRowCount,
      overlappingTaskRowCount: overlapPreview.overlappingTaskRowCount,
      rows: overlapPreview.rows,
      validRowCount: overlapPreview.rows.filter(
        (row) => row.errors.length === 0,
      ).length,
      warningRowCount: overlapPreview.rows.filter(
        (row) => row.warnings.length > 0,
      ).length,
    };
  }

  private async getImportUsers(): Promise<LoopImportUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        email: true,
        id: true,
        name: true,
      },
    });

    return users.map((user) => ({
      email: user.email,
      id: user.id,
      name: user.name,
    }));
  }
}

async function buildLoopImportOverlapPreview({
  prisma,
  rowActionsByNumber,
  rows,
  sourceSystem,
}: {
  prisma: PrismaService;
  rowActionsByNumber: Map<
    number,
    {
      projectAction: LoopImportOverlapAction;
      taskAction: LoopImportOverlapAction;
    }
  >;
  rows: LoopImportPreview['rows'];
  sourceSystem: string;
}) {
  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: {
        archivedAt: null,
        sourceSystem,
      },
      select: {
        dueDate: true,
        id: true,
        notes: true,
        ownerUserId: true,
        priority: true,
        sourceExternalId: true,
        title: true,
      },
    }),
    prisma.task.findMany({
      where: {
        archivedAt: null,
        sourceSystem,
      },
      select: {
        assigneeUserId: true,
        completedAt: true,
        dueDate: true,
        id: true,
        notes: true,
        priority: true,
        projectId: true,
        sourceExternalId: true,
        status: true,
        title: true,
      },
    }),
  ]);
  const projectsByExternalId = new Map(
    projects
      .filter(
        (project): project is typeof project & { sourceExternalId: string } =>
          typeof project.sourceExternalId === 'string' &&
          project.sourceExternalId.length > 0,
      )
      .map((project) => [project.sourceExternalId, project]),
  );
  const projectsByNaturalKey = new Map<string, typeof projects>();

  for (const project of projects) {
    const key = `natural:${normalizeImportIdentityKey(project.title)}:${project.ownerUserId ?? ''}:${toIsoDate(project.dueDate) ?? ''}`;
    const existing = projectsByNaturalKey.get(key) ?? [];
    existing.push(project);
    projectsByNaturalKey.set(key, existing);
  }

  const tasksByExternalId = new Map(
    tasks
      .filter(
        (task): task is typeof task & { sourceExternalId: string } =>
          typeof task.sourceExternalId === 'string' &&
          task.sourceExternalId.length > 0,
      )
      .map((task) => [task.sourceExternalId, task]),
  );
  const tasksByNaturalKey = new Map<string, typeof tasks>();

  for (const task of tasks) {
    const key = `natural:${task.projectId}:${normalizeImportIdentityKey(task.title)}:${task.assigneeUserId ?? ''}:${toIsoDate(task.dueDate) ?? ''}`;
    const existing = tasksByNaturalKey.get(key) ?? [];
    existing.push(task);
    tasksByNaturalKey.set(key, existing);
  }

  const simulatedProjects = new Map<
    string,
    {
      action: LoopImportOverlapAction;
      overlap: LoopImportPreview['rows'][number]['projectOverlap'];
      targetProjectId: string;
    }
  >();
  const simulatedTasks = new Map<
    string,
    {
      action: LoopImportOverlapAction;
      overlap: LoopImportPreview['rows'][number]['taskOverlap'];
      targetTaskId: string;
    }
  >();
  let nextSyntheticProjectId = 0;
  let nextSyntheticTaskId = 0;
  let overlappingProjectRowCount = 0;
  let overlappingTaskRowCount = 0;

  const previewRows = rows.map((row) => ({
    ...row,
    errors: [...row.errors],
    project: { ...row.project },
    rawRow: { ...row.rawRow },
    task: { ...row.task },
    warnings: [...row.warnings],
  }));

  for (const row of previewRows) {
    const actions = rowActionsByNumber.get(row.rowNumber) ?? {
      projectAction: 'update',
      taskAction: 'update',
    };
    const projectKey = buildPreparedLoopImportProjectKey(row);
    let simulatedProject = simulatedProjects.get(projectKey);

    if (simulatedProject === undefined) {
      const projectMatch = findExistingPreviewProject({
        projectsByExternalId,
        projectsByNaturalKey,
        row,
      });

      if (projectMatch.error) {
        row.errors.push(projectMatch.error);
        simulatedProject = {
          action: actions.projectAction,
          overlap: null,
          targetProjectId: `preview:new-project:${(++nextSyntheticProjectId).toString()}`,
        };
      } else if (!projectMatch.project) {
        simulatedProject = {
          action: actions.projectAction,
          overlap: null,
          targetProjectId: `preview:new-project:${(++nextSyntheticProjectId).toString()}`,
        };
      } else {
        const overlap = {
          action: actions.projectAction,
          changedFields: listProjectChangedFields(projectMatch.project, row),
          existingId: projectMatch.project.id,
          matchedBy: projectMatch.matchedBy,
          title: projectMatch.project.title,
        } as const;
        simulatedProject = {
          action: actions.projectAction,
          overlap,
          targetProjectId:
            actions.projectAction === 'add'
              ? `preview:new-project:${(++nextSyntheticProjectId).toString()}`
              : projectMatch.project.id,
        };
      }

      simulatedProjects.set(projectKey, simulatedProject);
    }

    if (simulatedProject?.overlap) {
      overlappingProjectRowCount += 1;
      row.projectOverlap = simulatedProject.overlap;
    }

    if (!hasPreparedLoopImportTask(row.task)) {
      continue;
    }

    const taskProjectId = simulatedProject.targetProjectId;
    const taskKey = buildPreparedLoopImportTaskKey(taskProjectId, row);
    let simulatedTask = simulatedTasks.get(taskKey);

    if (simulatedTask === undefined) {
      const taskMatch = findExistingPreviewTask({
        projectId: taskProjectId,
        row,
        tasksByExternalId,
        tasksByNaturalKey,
      });

      if (taskMatch.error) {
        row.errors.push(taskMatch.error);
        simulatedTask = {
          action: actions.taskAction,
          overlap: null,
          targetTaskId: `preview:new-task:${(++nextSyntheticTaskId).toString()}`,
        };
      } else if (!taskMatch.task) {
        simulatedTask = {
          action: actions.taskAction,
          overlap: null,
          targetTaskId: `preview:new-task:${(++nextSyntheticTaskId).toString()}`,
        };
      } else {
        const overlap = {
          action: actions.taskAction,
          changedFields: listTaskChangedFields(
            taskMatch.task,
            taskProjectId,
            row,
          ),
          existingId: taskMatch.task.id,
          matchedBy: taskMatch.matchedBy,
          title: taskMatch.task.title,
        } as const;
        simulatedTask = {
          action: actions.taskAction,
          overlap,
          targetTaskId:
            actions.taskAction === 'add'
              ? `preview:new-task:${(++nextSyntheticTaskId).toString()}`
              : taskMatch.task.id,
        };
      }

      simulatedTasks.set(taskKey, simulatedTask);
    }

    if (simulatedTask?.overlap) {
      overlappingTaskRowCount += 1;
      row.taskOverlap = simulatedTask.overlap;
    }
  }

  return {
    overlappingProjectRowCount,
    overlappingTaskRowCount,
    rows: previewRows,
  };
}

function findExistingPreviewProject({
  projectsByExternalId,
  projectsByNaturalKey,
  row,
}: {
  projectsByExternalId: Map<
    string,
    {
      dueDate: Date | null;
      id: string;
      notes: string | null;
      ownerUserId: string | null;
      priority: string;
      sourceExternalId: string | null;
      title: string;
    }
  >;
  projectsByNaturalKey: Map<
    string,
    Array<{
      dueDate: Date | null;
      id: string;
      notes: string | null;
      ownerUserId: string | null;
      priority: string;
      sourceExternalId: string | null;
      title: string;
    }>
  >;
  row: LoopImportPreview['rows'][number];
}) {
  if (row.project.externalId) {
    return {
      matchedBy: 'source_id' as const,
      project: projectsByExternalId.get(row.project.externalId) ?? null,
    };
  }

  const matches =
    projectsByNaturalKey.get(buildPreparedLoopImportProjectKey(row)) ?? [];

  if (matches.length > 1) {
    return {
      error: `Multiple projects match "${row.project.title ?? 'project'}" without a source id`,
      matchedBy: 'natural_key' as const,
      project: null,
    };
  }

  return {
    matchedBy: 'natural_key' as const,
    project: matches[0] ?? null,
  };
}

function findExistingPreviewTask({
  projectId,
  row,
  tasksByExternalId,
  tasksByNaturalKey,
}: {
  projectId: string;
  row: LoopImportPreview['rows'][number];
  tasksByExternalId: Map<
    string,
    {
      assigneeUserId: string | null;
      completedAt: Date | null;
      dueDate: Date | null;
      id: string;
      notes: string | null;
      priority: string;
      projectId: string;
      sourceExternalId: string | null;
      status: string;
      title: string;
    }
  >;
  tasksByNaturalKey: Map<
    string,
    Array<{
      assigneeUserId: string | null;
      completedAt: Date | null;
      dueDate: Date | null;
      id: string;
      notes: string | null;
      priority: string;
      projectId: string;
      sourceExternalId: string | null;
      status: string;
      title: string;
    }>
  >;
}) {
  if (row.task.externalId) {
    return {
      matchedBy: 'source_id' as const,
      task: tasksByExternalId.get(row.task.externalId) ?? null,
    };
  }

  if (projectId.startsWith('preview:new-project:')) {
    return {
      matchedBy: 'natural_key' as const,
      task: null,
    };
  }

  const matches =
    tasksByNaturalKey.get(buildPreparedLoopImportTaskKey(projectId, row)) ?? [];

  if (matches.length > 1) {
    return {
      error: `Multiple tasks match "${row.task.title ?? 'task'}" without a source id`,
      matchedBy: 'natural_key' as const,
      task: null,
    };
  }

  return {
    matchedBy: 'natural_key' as const,
    task: matches[0] ?? null,
  };
}

function listProjectChangedFields(
  project: {
    dueDate: Date | null;
    notes: string | null;
    ownerUserId: string | null;
    priority: string;
    sourceExternalId: string | null;
    title: string;
  },
  row: LoopImportPreview['rows'][number],
) {
  const changedFields: string[] = [];
  const nextDueDate = toDate(row.project.dueDate);

  if (project.title !== row.project.title) {
    changedFields.push('title');
  }

  if (project.notes !== row.project.notes) {
    changedFields.push('notes');
  }

  if (project.ownerUserId !== row.project.ownerUserId) {
    changedFields.push('ownerUserId');
  }

  if (project.priority !== row.project.priority) {
    changedFields.push('priority');
  }

  if (toIsoDate(project.dueDate) !== toIsoDate(nextDueDate)) {
    changedFields.push('dueDate');
  }

  if (
    row.project.externalId &&
    project.sourceExternalId !== row.project.externalId
  ) {
    changedFields.push('sourceExternalId');
  }

  return changedFields;
}

function listTaskChangedFields(
  task: {
    assigneeUserId: string | null;
    completedAt: Date | null;
    dueDate: Date | null;
    notes: string | null;
    priority: string;
    projectId: string;
    sourceExternalId: string | null;
    status: string;
    title: string;
  },
  projectId: string,
  row: LoopImportPreview['rows'][number],
) {
  const changedFields: string[] = [];
  const nextDueDate = toDate(row.task.dueDate);
  const nextCompletedAt =
    row.task.status === 'done' ? (task.completedAt ?? new Date()) : null;

  if (task.title !== row.task.title) {
    changedFields.push('title');
  }

  if (task.notes !== row.task.notes) {
    changedFields.push('notes');
  }

  if (task.assigneeUserId !== row.task.assigneeUserId) {
    changedFields.push('assigneeUserId');
  }

  if (task.priority !== row.task.priority) {
    changedFields.push('priority');
  }

  if (task.status !== row.task.status) {
    changedFields.push('status');
  }

  if (task.projectId !== projectId) {
    changedFields.push('projectId');
  }

  if (toIsoDate(task.dueDate) !== toIsoDate(nextDueDate)) {
    changedFields.push('dueDate');
  }

  if (toIsoDate(task.completedAt) !== toIsoDate(nextCompletedAt)) {
    changedFields.push('completedAt');
  }

  if (row.task.externalId && task.sourceExternalId !== row.task.externalId) {
    changedFields.push('sourceExternalId');
  }

  return changedFields;
}

function readHeaderList(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((header): header is string => typeof header === 'string');
}

function readLoopImportMapping(
  value: Prisma.JsonValue | null,
): LoopImportMapping {
  const result = loopImportMappingSchema.safeParse(
    normalizeLegacyLoopImportMapping(value),
  );
  return result.success ? stripUndefinedMappings(result.data) : {};
}

function sanitizeLoopImportMapping(
  headers: string[],
  mapping: LoopImportMapping,
): LoopImportMapping {
  const availableHeaders = new Set(headers);
  const sanitized: LoopImportMapping = {};

  for (const [field, value] of Object.entries(mapping)) {
    if (value === null) {
      sanitized[field as keyof LoopImportMapping] = null;
      continue;
    }

    if (typeof value === 'string' && availableHeaders.has(value)) {
      sanitized[field as keyof LoopImportMapping] = value;
    }
  }

  return sanitized;
}

function buildStagedImportRows(content: string, mapping: LoopImportMapping) {
  const parsed = parseImportContent(content);

  return expandLoopImportRows({
    mapping,
    rawRows: parsed.rows,
  });
}

function listUnavailableMappedHeaders(
  headers: string[],
  mapping: LoopImportMapping,
) {
  const availableHeaders = new Set(headers);

  return Object.values(mapping).filter(
    (value): value is string =>
      typeof value === 'string' &&
      value.length > 0 &&
      !availableHeaders.has(value),
  );
}

function parseRawRow(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  return value;
}

function readValidationErrors(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function parseImportContent(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error('Expected a header row and at least one data row');
  }

  const delimiter = detectDelimiter(lines[0] ?? '');
  const rows = parse(content, {
    bom: true,
    columns: false,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  if (rows.length < 2) {
    throw new Error('Expected a header row and at least one data row');
  }

  const [rawHeaderRow, ...dataRows] = rows;

  if (!rawHeaderRow) {
    throw new Error('Expected a header row and at least one data row');
  }

  const headers = rawHeaderRow.map((value) => String(value ?? '').trim());

  if (headers.some((header) => header.length === 0)) {
    throw new Error('Header row contains blank column names');
  }

  if (new Set(headers).size !== headers.length) {
    throw new Error('Header row contains duplicate column names');
  }

  return {
    headers,
    rows: dataRows.map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, normalizeCell(values[index])]),
      ),
    ),
  };
}

function detectDelimiter(headerLine: string) {
  const candidates = [',', ';', '\t'] as const;

  return candidates.reduce(
    (best, candidate) =>
      countDelimiter(headerLine, candidate) > countDelimiter(headerLine, best)
        ? candidate
        : best,
    candidates[0],
  );
}

function countDelimiter(value: string, delimiter: string) {
  return value.split(delimiter).length - 1;
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return null;
  }

  const nextValue = value.toString().trim();
  return nextValue.length > 0 ? nextValue : null;
}

function toDate(value: string | null) {
  return value ? new Date(value) : null;
}

function toIsoDate(value: Date | null) {
  return value?.toISOString() ?? null;
}

function normalizeImportIdentityKey(value: string | null) {
  return value?.trim().toLowerCase() ?? '';
}

function serializeImportJob(job: ImportJobRecord) {
  return {
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    createdProjectCount: job.createdProjectCount,
    createdRowCount: job.createdRowCount,
    createdTaskCount: job.createdTaskCount,
    failedRowCount: job.failedRowCount,
    fileName: job.fileName,
    id: job.id,
    lastError: job.lastError,
    skippedRowCount: job.skippedRowCount,
    sourceSystem: job.sourceSystem,
    status: job.status,
    totalRowCount: job.totalRowCount,
    updatedAt: job.updatedAt,
    updatedProjectCount: job.updatedProjectCount,
    updatedRowCount: job.updatedRowCount,
    updatedTaskCount: job.updatedTaskCount,
  };
}

function stripUndefinedMappings(
  mapping: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value !== undefined),
  ) as LoopImportMapping;
}

function normalizeLegacyLoopImportMapping(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return {};
  }

  const mapping = { ...(value as Record<string, unknown>) };

  if (
    mapping['taskNotes'] === undefined &&
    typeof mapping['taskDescription'] === 'string'
  ) {
    mapping['taskNotes'] = mapping['taskDescription'];
  }

  return mapping;
}
