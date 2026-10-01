import 'dotenv/config';
import { Prisma, PrismaClient, WorkspaceType } from '@prisma/client';

const expectedProjectRef = 'gvoccbqxackcacwhnoiz';
const expectedSchoolYear = '2025-2026';
const expectedAuditCount = 42;
const auditAction = 'DATA_MIGRATION_PURGE_INVALID_PRESEASON_CITY_APPLICATION';

if (process.env.APPLY_INVALID_PRESEASON_CITY_PURGE !== 'PURGE_ONE_CANCELLED_PRESEASON_FIXTURE') {
  throw new Error('Set APPLY_INVALID_PRESEASON_CITY_PURGE to the one-time approved value to apply.');
}

const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(rawDatabaseUrl);
const connectionIdentity = `${databaseUrl.hostname} ${decodeURIComponent(databaseUrl.username)}`;
if (!connectionIdentity.includes(expectedProjectRef)) {
  throw new Error('Refusing to run against a database other than the audited Supabase project.');
}

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$transaction(
    async (tx) => {
      const season = await tx.cityReviewSeason.findUnique({
        where: { schoolYear: expectedSchoolYear },
        select: { submissionOpensAt: true },
      });
      if (!season?.submissionOpensAt) {
        throw new Error('The current City season opening time is not configured; no data was changed.');
      }

      const candidates = await tx.application.findMany({
        where: {
          workspace: { is: { code: 'DHBK-DHDN', type: WorkspaceType.SCHOOL, isActive: true } },
          applicationType: 'individual',
          targetLevel: 'city',
          schoolYear: expectedSchoolYear,
          status: 'completed',
          finalStatus: 'pending',
          submittedAt: { lt: season.submissionOpensAt },
          createdAt: { lt: season.submissionOpensAt },
          cancelledAt: { not: null },
          archivedAt: null,
          student: { is: { role: 'student', isActive: false } },
        },
        select: {
          id: true,
          workspaceId: true,
          schoolYear: true,
          status: true,
          finalStatus: true,
          finalLevel: true,
          createdAt: true,
          submittedAt: true,
          cancelledAt: true,
          cancelledBy: { select: { role: true } },
          student: { select: { workspaceId: true } },
          reviewTasks: {
            select: { id: true, criterion: true, status: true, decision: true },
          },
          evidences: { select: { id: true, evidenceFiles: { select: { fileId: true } }, evidenceCard: { select: { id: true } } } },
          finalDecisionHistory: { select: { id: true } },
          _count: { select: { auditLogs: true, resolutionCases: true } },
        },
      });

      if (candidates.length !== 1) {
        throw new Error(`Expected one cancelled out-of-season fixture; found ${candidates.length}. No data was changed.`);
      }

      const application = candidates[0];
      const expectedCriteria = new Set(['ethics', 'academic', 'physical', 'volunteer', 'integration']);
      const taskCriteria = application.reviewTasks.map(({ criterion }) => criterion);
      if (
        application.createdAt >= season.submissionOpensAt ||
        !application.submittedAt ||
        application.submittedAt >= season.submissionOpensAt ||
        !application.cancelledAt ||
        application.cancelledBy?.role !== 'admin' ||
        application.student.workspaceId !== application.workspaceId ||
        application.reviewTasks.length !== 5 ||
        new Set(taskCriteria).size !== 5 ||
        taskCriteria.some((criterion) => !expectedCriteria.has(criterion)) ||
        application.reviewTasks.some(
          (task) => task.status !== 'accepted' || task.decision !== 'accepted',
        ) ||
        application.evidences.length !== 5 ||
        application.evidences.some(({ evidenceFiles }) => evidenceFiles.length !== 0) ||
        application.finalDecisionHistory.length !== 1 ||
        application._count.auditLogs !== expectedAuditCount ||
        application._count.resolutionCases !== 0
      ) {
        throw new Error('The candidate no longer matches the audited invalid fixture. No data was changed.');
      }

      const evidenceIds = application.evidences.map(({ id }) => id);
      const evidenceCardIds = application.evidences.flatMap((evidence) =>
        evidence.evidenceCard ? [evidence.evidenceCard.id] : [],
      );
      const targetIds = [application.id, ...evidenceIds, ...evidenceCardIds];
      const indexingJobs = await tx.indexingJob.findMany({
        where: { targetId: { in: targetIds } },
        select: { id: true },
      });
      const smartReaderJobs = await tx.smartReaderJob.findMany({
        where: { evidenceId: { in: evidenceIds } },
        select: { id: true },
      });
      const priorPurgeAuditCount = await tx.auditLog.count({
        where: { action: auditAction, targetType: 'application', targetId: application.id },
      });
      if (priorPurgeAuditCount !== 0) {
        throw new Error('A purge audit already exists for this application; refusing to repeat.');
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Application" WHERE "id" = ${application.id}::uuid FOR UPDATE
      `);

      await tx.applicationFinalDecisionHistory.deleteMany({ where: { applicationId: application.id } });
      await tx.indexingJob.deleteMany({ where: { id: { in: indexingJobs.map(({ id }) => id) } } });
      await tx.smartReaderJob.deleteMany({ where: { id: { in: smartReaderJobs.map(({ id }) => id) } } });
      await tx.auditLog.create({
        data: {
          workspaceId: application.workspaceId,
          action: auditAction,
          targetType: 'application',
          targetId: application.id,
          beforeStateJson: {
            workspaceCode: 'DHBK-DHDN',
            schoolYear: expectedSchoolYear,
            targetLevel: 'city',
            status: 'completed',
            cancelled: true,
            ownerActive: false,
            submittedBeforeSeason: true,
            reviewTasks: application.reviewTasks.length,
            evidences: application.evidences.length,
          },
          afterStateJson: { purged: true, reason: 'cancelled out-of-season test fixture' },
          note: 'Purge one cancelled application submitted before the official season; preserve only this non-PII maintenance audit.',
        },
      });

      await tx.application.delete({ where: { id: application.id } });

      const [
        remainingApplication,
        remainingEvidence,
        remainingTasks,
        remainingJobs,
        remainingSmartReaderJobs,
        cleanupAudit,
      ] = await Promise.all([
        tx.application.count({ where: { id: application.id } }),
        tx.evidence.count({ where: { applicationId: application.id } }),
        tx.reviewTask.count({ where: { applicationId: application.id } }),
        tx.indexingJob.count({ where: { targetId: { in: targetIds } } }),
        tx.smartReaderJob.count({ where: { evidenceId: { in: evidenceIds } } }),
        tx.auditLog.count({ where: { action: auditAction, targetType: 'application', targetId: application.id } }),
      ]);
      if (
        remainingApplication ||
        remainingEvidence ||
        remainingTasks ||
        remainingJobs ||
        remainingSmartReaderJobs ||
        cleanupAudit !== 1
      ) {
        throw new Error('Post-purge verification failed; transaction rolled back.');
      }

      return {
        projectRef: expectedProjectRef,
        deletedApplications: 1,
        deletedReviewTasks: application.reviewTasks.length,
        deletedEvidenceRecords: application.evidences.length,
        deletedEvidenceFiles: 0,
        deletedFinalHistoryRows: application.finalDecisionHistory.length,
        removedLinkedAuditRows: application._count.auditLogs,
        deletedIndexingJobs: indexingJobs.length,
        deletedSmartReaderJobs: smartReaderJobs.length,
        retainedNonPiiMaintenanceAuditRows: cleanupAudit,
        storageObjectsToDelete: 0,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log(JSON.stringify({ outcome: 'APPLIED', ...result }, null, 2));
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Invalid application purge failed.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
