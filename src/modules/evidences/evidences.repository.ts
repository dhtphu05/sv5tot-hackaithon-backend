// Owns evidence records, evidence files, indexing triggers, and evidence cards.
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import type { ListEvidencesQuery } from './evidences.validation';

export const evidenceInclude = {
  application: { include: { student: true, metrics: true } },
  collectiveProfile: true,
  event: true,
  evidenceFiles: {
    include: {
      file: true,
    },
    orderBy: { id: 'asc' },
  },
  evidenceCard: true,
} satisfies Prisma.EvidenceInclude;

export class EvidencesRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  findApplication(id: string) {
    return this.db.application.findUnique({ where: { id }, include: { student: true } });
  }

  findEvidence(id: string) {
    return this.db.evidence.findUnique({ where: { id }, include: evidenceInclude });
  }

  findLatestEvidenceJob(evidenceId: string) {
    return this.db.indexingJob.findFirst({
      where: { targetId: evidenceId, jobType: 'evidence_ocr' },
      orderBy: { createdAt: 'desc' },
    });
  }

  findLatestSmartReaderJob(evidenceId: string) {
    return this.db.smartReaderJob.findFirst({
      where: { evidenceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findEvidenceJobIds(evidenceId: string) {
    const jobs = await this.db.indexingJob.findMany({
      where: { targetId: evidenceId, jobType: 'evidence_ocr' },
      select: { id: true },
    });
    return jobs.map((job) => job.id);
  }

  findEvidenceAuditLogs(evidenceId: string, jobIds: string[]) {
    return this.db.auditLog.findMany({
      where: {
        OR: [
          { evidenceId },
          { targetType: 'evidence', targetId: evidenceId },
          { targetType: 'indexing_job', targetId: { in: jobIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findEvidenceAuditSummaryLogs(evidenceId: string) {
    return this.db.auditLog.findMany({
      where: { evidenceId },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async list(applicationId: string, query: ListEvidencesQuery) {
    const where: Prisma.EvidenceWhereInput = {
      applicationId,
      ...(query.criterion ? { criterion: query.criterion } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.indexingStatus ? { indexingStatus: query.indexingStatus } : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.db.$transaction([
      this.db.evidence.findMany({
        where,
        include: evidenceInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      this.db.evidence.count({ where }),
    ]);

    return { items, total };
  }
}
