// Owns export job requests for applications and review results.
import { FileStorageType, Role, type Prisma } from '@prisma/client';
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
import type { ExportReviewResultsInput } from './exports.validation';

export class ExportsService {
  constructor(private readonly storage = new LocalStorageService()) {}

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

    return { format: 'csv', file };
  }

  async getDownloadFile(user: AuthenticatedUser, fileId: string) {
    if (user.role !== Role.manager && user.role !== Role.committee && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Export download is restricted');
    }
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file || !file.filePath.startsWith('exports/')) {
      throw new AppError(404, ErrorCodes.EXPORT_FILE_NOT_FOUND, 'Export file not found');
    }
    const absolutePath = path.resolve(uploadConfig.uploadDir, file.filePath);
    const root = path.resolve(uploadConfig.uploadDir);
    if (!absolutePath.startsWith(root)) {
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

    return applications.map((application) => ({
      studentCode: application.student.studentCode,
      fullName: application.student.fullName,
      className: application.student.className,
      faculty: application.student.faculty,
      schoolYear: application.schoolYear,
      targetLevel: application.targetLevel,
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
      finalNote:
        application.auditLogs.find((log) => log.action === auditActions.FINAL_RESULT_CONFIRMED)
          ?.note ?? null,
    }));
  }
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  const headers = [
    'studentCode',
    'fullName',
    'className',
    'faculty',
    'schoolYear',
    'targetLevel',
    'finalLevel',
    'finalStatus',
    'applicationStatus',
    'readinessScore',
    'submittedAt',
    'completedAt',
    'criteriaTaskStatuses',
    'finalNote',
  ];
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
