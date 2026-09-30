import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const expectedCount = 66;
const expectedRemainingSchoolCount = 4;
const expectedSchoolYear = '2025-2026';
const auditAction = 'DATA_MIGRATION_DUT_2025_2026_APPLICATIONS_TO_CITY';
const confirmation = process.env.APPLY_DUT_CITY_APPLICATION_DATA_MIGRATION;

if (confirmation !== '66_DUT_2025_2026') {
  throw new Error(
    'Set APPLY_DUT_CITY_APPLICATION_DATA_MIGRATION=66_DUT_2025_2026 to run this one-time data migration.',
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const databaseHost = new URL(databaseUrl).hostname;
if (!databaseHost.endsWith('supabase.com') && !databaseHost.endsWith('supabase.co')) {
  throw new Error(`Refusing to run against non-Supabase host: ${databaseHost}`);
}

const prisma = new PrismaClient();

void (async () => {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const workspace = await tx.workspace.findUnique({
          where: { code: 'DHBK-DHDN' },
          select: { id: true, type: true, isActive: true },
        });

        if (!workspace || workspace.type !== 'SCHOOL' || !workspace.isActive) {
          throw new Error('DUT must resolve to an active SCHOOL workspace.');
        }

        const where = {
          applicationType: 'individual' as const,
          targetLevel: 'school' as const,
          schoolYear: expectedSchoolYear,
          workspaceId: workspace.id,
        };
        const candidates = await tx.application.findMany({
          where,
          select: {
            id: true,
            status: true,
            submittedAt: true,
            finalStatus: true,
            cancelledAt: true,
            archivedAt: true,
          },
          orderBy: { id: 'asc' },
        });

        if (candidates.length !== expectedCount) {
          throw new Error(
            `Expected ${expectedCount} DUT individual school applications for ${expectedSchoolYear}; found ${candidates.length}. No data was changed.`,
          );
        }

        if (candidates.some((application) => application.cancelledAt || application.archivedAt)) {
          throw new Error('Cancelled or archived applications were found; no data was changed.');
        }

        const candidateIds = candidates.map((application) => application.id);
        const existingAuditCount = await tx.auditLog.count({
          where: {
            action: auditAction,
            targetType: 'application',
            targetId: { in: candidateIds },
          },
        });
        if (existingAuditCount > 0) {
          throw new Error('Migration audit records already exist; refusing to apply twice.');
        }

        const update = await tx.application.updateMany({
          where: { id: { in: candidateIds }, targetLevel: 'school' },
          data: { targetLevel: 'city' },
        });
        if (update.count !== expectedCount) {
          throw new Error(`Expected to update ${expectedCount} records; updated ${update.count}.`);
        }

        const audits = await tx.auditLog.createMany({
          data: candidates.map((application) => ({
            workspaceId: workspace.id,
            action: auditAction,
            targetType: 'application',
            targetId: application.id,
            applicationId: application.id,
            beforeStateJson: {
              targetLevel: 'school',
              schoolYear: expectedSchoolYear,
            } satisfies Prisma.InputJsonObject,
            afterStateJson: {
              targetLevel: 'city',
              schoolYear: expectedSchoolYear,
            } satisfies Prisma.InputJsonObject,
            note: 'One-time conversion of valid DUT 2025-2026 applications to City scope.',
          })),
        });
        if (audits.count !== expectedCount) {
          throw new Error(`Expected ${expectedCount} audit records; created ${audits.count}.`);
        }

        const cityCount = await tx.application.count({
          where: { ...where, targetLevel: 'city' },
        });
        const schoolCountRemaining = await tx.application.count({
          where: {
            applicationType: 'individual',
            targetLevel: 'school',
            workspaceId: workspace.id,
          },
        });
        const auditCount = await tx.auditLog.count({
          where: { action: auditAction, workspaceId: workspace.id },
        });
        if (
          cityCount < expectedCount ||
          schoolCountRemaining !== expectedRemainingSchoolCount ||
          auditCount !== expectedCount
        ) {
          throw new Error('In-transaction verification failed; rolling back the migration.');
        }

        return {
          converted: update.count,
          submitted: candidates.filter((application) => application.submittedAt).length,
          drafts: candidates.filter((application) => !application.submittedAt).length,
          passed: candidates.filter((application) => application.finalStatus === 'passed').length,
          failed: candidates.filter((application) => application.finalStatus === 'failed').length,
          waitingOrInReview: candidates.filter((application) =>
            ['submitted', 'under_review', 'supplement_required', 'resolution_needed'].includes(
              application.status,
            ),
          ).length,
          auditRecords: audits.count,
          verifiedCityApplicationsInDutWorkspaceAndYear: cityCount,
          dutSchoolApplicationsRemainingOutside2025_2026: schoolCountRemaining,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    console.log(
      JSON.stringify(
        {
          outcome: 'APPLIED',
          databaseHost,
          schoolYear: expectedSchoolYear,
          ...result,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
