// Owns export job requests for applications and review results.
import { FileStorageType, ReviewTaskStatus, Role, type Prisma } from '@prisma/client';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { uploadConfig } from '../../config/upload';
import { prisma } from '../../infrastructure/database/prisma';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { createApplicationAudit } from '../applications/application.helpers';
import type {
  ExportApplicationsQuery,
  ExportReviewResultsInput,
  ExportReviewTasksQuery,
} from './exports.validation';

export class ExportsService {
  constructor(private readonly storage = new LocalStorageService()) {}

  async exportApplicationsJson(user: AuthenticatedUser, query: ExportApplicationsQuery) {
    const items = await this.buildApplicationRows(query);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'EXPORT_APPLICATIONS_JSON',
      targetType: 'export',
      targetId: 'applications.json',
      afterStateJson: { rowCount: items.length, filters: query },
    });
    return {
      exportedAt: new Date().toISOString(),
      filters: query,
      items,
    };
  }

  async exportApplicationsCsv(user: AuthenticatedUser, query: ExportApplicationsQuery) {
    const items = await this.buildApplicationRows(query);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'EXPORT_APPLICATIONS_CSV',
      targetType: 'export',
      targetId: 'applications.csv',
      afterStateJson: { rowCount: items.length, filters: query },
    });
    return toCsv(items, applicationCsvHeaders);
  }

  async exportReviewTasksCsv(user: AuthenticatedUser, query: ExportReviewTasksQuery) {
    const items = await this.buildReviewTaskRows(query);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'EXPORT_REVIEW_TASKS_CSV',
      targetType: 'export',
      targetId: 'review-tasks.csv',
      afterStateJson: { rowCount: items.length, filters: query },
    });
    return toCsv(items, reviewTaskCsvHeaders);
  }

  async exportReviewResults(user: AuthenticatedUser, input: ExportReviewResultsInput) {
    const data = await this.buildRows(input);
    if (input.format === 'json') {
      await createApplicationAudit(prisma, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.EXPORT_REVIEW_RESULTS_CREATED,
        targetType: 'export',
        targetId: 'json',
        afterStateJson: { rowCount: data.length, format: input.format },
      });
      return { format: 'json', data };
    }
    if (input.format !== 'csv') {
      throw new AppError(400, ErrorCodes.EXPORT_FORMAT_NOT_SUPPORTED, 'Unsupported export format');
    }

    const csv = toCsv(data);
    const stored = await this.storage.saveFile({
      buffer: Buffer.from(csv, 'utf8'),
      originalName: `review-results-${Date.now()}.csv`,
      mimeType: 'text/csv',
      directory: 'exports',
    });
    const file = await prisma.file.create({
      data: {
        ownerId: user.id,
        uploadedBy: user.id,
        storageType: FileStorageType.local,
        filePath: stored.filePath,
        publicUrl: stored.publicUrl,
        originalName: path.basename(stored.filePath),
        mimeType: 'text/csv',
        fileSize: stored.size,
      },
    });
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.EXPORT_REVIEW_RESULTS_CREATED,
      targetType: 'file',
      targetId: file.id,
      afterStateJson: { rowCount: data.length, format: input.format },
    });

    return {
      format: 'csv',
      fileId: file.id,
      downloadUrl: `/api/exports/${file.id}/download`,
      file,
    };
  }

  async getDownloadFile(user: AuthenticatedUser, fileId: string) {
    if (user.role !== Role.manager && user.role !== Role.committee && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Export download is restricted');
    }
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file || !isExportFilePath(file.filePath)) {
      throw new AppError(404, ErrorCodes.EXPORT_FILE_NOT_FOUND, 'Export file not found');
    }
    const absolutePath = path.resolve(uploadConfig.uploadDir, file.filePath);
    const root = path.resolve(uploadConfig.uploadDir);
    const relativePath = path.relative(root, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new AppError(400, ErrorCodes.EXPORT_FILE_NOT_FOUND, 'Invalid export path');
    }
    await fs.access(absolutePath);
    await createApplicationAudit(prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.EXPORT_REVIEW_RESULTS_DOWNLOADED,
      targetType: 'file',
      targetId: file.id,
    });
    return { file, absolutePath };
  }

  private async buildRows(input: ExportReviewResultsInput) {
    const where: Prisma.ApplicationWhereInput = {
      ...(input.schoolYear ? { schoolYear: input.schoolYear } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
      ...(input.faculty ? { student: { faculty: input.faculty } } : {}),
    };
    const applications = await prisma.application.findMany({
      where,
      include: {
        student: true,
        reviewTasks: true,
        cascadeReviews: { orderBy: { createdAt: 'desc' }, take: 1 },
        auditLogs: {
          where: {
            action: {
              in: [auditActions.APPLICATION_FINALIZED, auditActions.FINAL_RESULT_CONFIRMED],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return applications.map((application) => {
      const latestCascade = application.cascadeReviews[0] ?? null;
      return {
      studentCode: application.student.studentCode,
      fullName: application.student.fullName,
      className: application.student.className,
      faculty: application.student.faculty,
      schoolYear: application.schoolYear,
      targetLevel: application.targetLevel,
      cascadeSuggestedLevel: latestCascade?.suggestedLevel ?? null,
      finalLevel: application.finalLevel,
      finalStatus: application.finalStatus,
      applicationStatus: application.status,
      readinessScore: application.readinessScore,
      submittedAt: application.submittedAt,
      completedAt:
        application.auditLogs.find((log) => log.action === auditActions.APPLICATION_FINALIZED)
          ?.createdAt ?? null,
      criteriaTaskStatuses: Object.fromEntries(
        application.reviewTasks.map((task) => [task.criterion, task.status]),
      ),
      cascadeReviewCreatedAt: latestCascade?.createdAt ?? null,
      cascadeSnapshot: latestCascade?.levelResultsJson ?? null,
      finalNote:
        application.auditLogs.find((log) => log.action === auditActions.FINAL_RESULT_CONFIRMED)
          ?.note ?? null,
      };
    });
  }

  private async buildApplicationRows(query: ExportApplicationsQuery) {
    const where = buildApplicationWhere(query);
    const applications = await prisma.application.findMany({
      where,
      include: {
        student: true,
        evidences: { select: { id: true } },
        reviewTasks: { select: { status: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { submittedAt: 'desc' }],
    });

    return applications.map((application) => {
      const count = (status: ReviewTaskStatus) =>
        application.reviewTasks.filter((task) => task.status === status).length;
      return {
        applicationId: application.id,
        schoolYear: application.schoolYear,
        applicationType: application.applicationType,
        targetLevel: application.targetLevel,
        status: application.status,
        studentCode: application.student.studentCode,
        studentName: application.student.fullName,
        className: application.student.className,
        faculty: application.student.faculty,
        evidenceCount: application.evidences.length,
        reviewTaskCount: application.reviewTasks.length,
        acceptedTaskCount: count(ReviewTaskStatus.accepted),
        rejectedTaskCount: count(ReviewTaskStatus.rejected),
        supplementTaskCount: count(ReviewTaskStatus.supplement_required),
        resolutionTaskCount: count(ReviewTaskStatus.resolution_needed),
        updatedAt: application.updatedAt.toISOString(),
      };
    });
  }

  private async buildReviewTaskRows(query: ExportReviewTasksQuery) {
    const where: Prisma.ReviewTaskWhereInput = {
      ...(query.criterion ? { criterion: query.criterion } : {}),
      application: buildApplicationWhere(query),
    };
    const tasks = await prisma.reviewTask.findMany({
      where,
      include: {
        assignedOfficer: true,
        application: { include: { student: true } },
        evidences: { select: { evidenceId: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return tasks.map((task) => ({
      reviewTaskId: task.id,
      applicationId: task.applicationId,
      schoolYear: task.application?.schoolYear,
      targetLevel: task.application?.targetLevel,
      applicationStatus: task.application?.status,
      criterion: task.criterion,
      status: task.status,
      decision: task.decision,
      assignedOfficerId: task.assignedOfficerId,
      assignedOfficerName: task.assignedOfficer?.fullName,
      studentCode: task.application?.student.studentCode,
      studentName: task.application?.student.fullName,
      className: task.application?.student.className,
      faculty: task.application?.student.faculty,
      evidenceCount: task.evidences.length,
      dueDate: task.dueDate?.toISOString() ?? null,
      updatedAt: task.updatedAt.toISOString(),
    }));
  }
}

function isExportFilePath(filePath: string) {
  return filePath.replace(/\\/g, '/').startsWith('exports/');
}

function buildApplicationWhere(input: ExportApplicationsQuery): Prisma.ApplicationWhereInput {
  return {
    ...(input.schoolYear ? { schoolYear: input.schoolYear } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
    ...(input.faculty ? { student: { faculty: input.faculty } } : {}),
    ...(input.fromDate || input.toDate
      ? {
          updatedAt: {
            ...(input.fromDate ? { gte: new Date(input.fromDate) } : {}),
            ...(input.toDate ? { lte: new Date(input.toDate) } : {}),
          },
        }
      : {}),
  };
}

const applicationCsvHeaders = [
  'applicationId',
  'schoolYear',
  'applicationType',
  'targetLevel',
  'status',
  'studentCode',
  'studentName',
  'className',
  'faculty',
  'evidenceCount',
  'reviewTaskCount',
  'acceptedTaskCount',
  'rejectedTaskCount',
  'supplementTaskCount',
  'resolutionTaskCount',
  'updatedAt',
] as const;

const reviewTaskCsvHeaders = [
  'reviewTaskId',
  'applicationId',
  'schoolYear',
  'targetLevel',
  'applicationStatus',
  'criterion',
  'status',
  'decision',
  'assignedOfficerId',
  'assignedOfficerName',
  'studentCode',
  'studentName',
  'className',
  'faculty',
  'evidenceCount',
  'dueDate',
  'updatedAt',
] as const;

function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  headers: readonly string[] = [
    'studentCode',
    'fullName',
    'className',
    'faculty',
    'schoolYear',
    'targetLevel',
    'cascadeSuggestedLevel',
    'finalLevel',
    'finalStatus',
    'applicationStatus',
    'readinessScore',
    'submittedAt',
    'completedAt',
    'criteriaTaskStatuses',
    'cascadeReviewCreatedAt',
    'cascadeSnapshot',
    'finalNote',
  ],
): string {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ].join('\n');
}

function escapeCsv(value: unknown): string {
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object' && value !== null
        ? JSON.stringify(value)
        : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}
