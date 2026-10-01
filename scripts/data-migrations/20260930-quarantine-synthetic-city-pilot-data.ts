import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/infrastructure/database/prisma';

const expectedTestWorkspaceCount = 4;
const auditAction = 'DATA_MIGRATION_QUARANTINE_SYNTHETIC_CITY_PILOT_DATA';
const confirmation = process.env.APPLY_SYNTHETIC_CITY_DATA_QUARANTINE;

if (confirmation !== 'QUARANTINE_SYNTHETIC_CITY_DATA') {
  throw new Error(
    'Set APPLY_SYNTHETIC_CITY_DATA_QUARANTINE=QUARANTINE_SYNTHETIC_CITY_DATA to run this one-time data migration.',
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const databaseHost = new URL(databaseUrl).hostname;
if (!databaseHost.endsWith('supabase.com') && !databaseHost.endsWith('supabase.co')) {
  throw new Error(`Refusing to run against non-Supabase host: ${databaseHost}`);
}

void (async () => {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const testWorkspaces = await tx.workspace.findMany({
          where: {
            isActive: true,
            registrationEnabled: true,
            OR: [
              { code: 'APPROVED-EVIDENCE-TEST' },
              { code: 'E2E-NON-AI' },
              { code: { startsWith: 'AB-A-' } },
              { code: { startsWith: 'AB-B-' } },
            ],
          },
          select: {
            id: true,
            code: true,
            type: true,
            parentWorkspace: { select: { code: true, type: true } },
          },
          orderBy: { code: 'asc' },
        });

        const abSchools = testWorkspaces.filter(
          (workspace) => workspace.code.startsWith('AB-A-') || workspace.code.startsWith('AB-B-'),
        );
        const hasE2e = testWorkspaces.some((workspace) => workspace.code === 'E2E-NON-AI');
        const hasApprovedEvidenceFixture = testWorkspaces.some(
          (workspace) => workspace.code === 'APPROVED-EVIDENCE-TEST',
        );
        if (
          testWorkspaces.length !== expectedTestWorkspaceCount ||
          !hasE2e ||
          !hasApprovedEvidenceFixture ||
          abSchools.length !== 2 ||
          abSchools.some(
            (workspace) =>
              workspace.type !== 'SCHOOL' ||
              workspace.parentWorkspace?.type !== 'CITY' ||
              !workspace.parentWorkspace.code.startsWith('AB-CITY-AB-'),
          ) ||
          testWorkspaces.some((workspace) => workspace.type !== 'SCHOOL')
        ) {
          throw new Error(
            `Expected the four known active synthetic SCHOOL workspaces; found ${testWorkspaces.length}. No data was changed.`,
          );
        }

        const e2eWorkspace = testWorkspaces.find((workspace) => workspace.code === 'E2E-NON-AI');
        if (!e2eWorkspace) throw new Error('E2E workspace is missing.');

        const e2eCityDrafts = await tx.application.findMany({
          where: {
            workspaceId: e2eWorkspace.id,
            applicationType: 'individual',
            targetLevel: 'city',
            schoolYear: '2098-2099',
          },
          select: {
            id: true,
            status: true,
            submittedAt: true,
            finalStatus: true,
            cancelledAt: true,
            archivedAt: true,
            _count: {
              select: { reviewTasks: true, resolutionCases: true, supplementRequests: true },
            },
          },
        });
        if (
          e2eCityDrafts.length !== 1 ||
          e2eCityDrafts[0].status !== 'draft' ||
          e2eCityDrafts[0].submittedAt !== null ||
          e2eCityDrafts[0].finalStatus !== 'pending' ||
          e2eCityDrafts[0].cancelledAt !== null ||
          e2eCityDrafts[0].archivedAt !== null ||
          e2eCityDrafts[0]._count.reviewTasks !== 0 ||
          e2eCityDrafts[0]._count.resolutionCases !== 0 ||
          e2eCityDrafts[0]._count.supplementRequests !== 0
        ) {
          throw new Error(
            'Expected one unsubmitted E2E-only draft without review history; no data was changed.',
          );
        }

        const workspaceIds = testWorkspaces.map((workspace) => workspace.id);
        const applicationId = e2eCityDrafts[0].id;
        const existingAuditCount = await tx.auditLog.count({
          where: {
            action: auditAction,
            OR: [
              { targetType: 'workspace', targetId: { in: workspaceIds } },
              { targetType: 'application', targetId: applicationId },
            ],
          },
        });
        if (existingAuditCount > 0) {
          throw new Error('Quarantine audit records already exist; refusing to apply twice.');
        }

        const registrationUpdate = await tx.workspace.updateMany({
          where: { id: { in: workspaceIds }, registrationEnabled: true },
          data: { registrationEnabled: false },
        });
        if (registrationUpdate.count !== expectedTestWorkspaceCount) {
          throw new Error(
            `Expected to disable ${expectedTestWorkspaceCount} test workspaces; updated ${registrationUpdate.count}.`,
          );
        }

        const applicationUpdate = await tx.application.updateMany({
          where: { id: applicationId, targetLevel: 'city', status: 'draft' },
          data: { targetLevel: 'school' },
        });
        if (applicationUpdate.count !== 1) {
          throw new Error(
            `Expected to quarantine one E2E draft; updated ${applicationUpdate.count}.`,
          );
        }

        const audits = await tx.auditLog.createMany({
          data: [
            ...testWorkspaces.map((workspace) => ({
              workspaceId: workspace.id,
              action: auditAction,
              targetType: 'workspace',
              targetId: workspace.id,
              beforeStateJson: {
                registrationEnabled: true,
              } satisfies Prisma.InputJsonObject,
              afterStateJson: {
                registrationEnabled: false,
              } satisfies Prisma.InputJsonObject,
              note: 'Disable public registration for a synthetic test workspace.',
            })),
            {
              workspaceId: e2eWorkspace.id,
              action: auditAction,
              targetType: 'application',
              targetId: applicationId,
              applicationId,
              beforeStateJson: {
                targetLevel: 'city',
                schoolYear: '2098-2099',
              } satisfies Prisma.InputJsonObject,
              afterStateJson: {
                targetLevel: 'school',
                schoolYear: '2098-2099',
              } satisfies Prisma.InputJsonObject,
              note: 'Quarantine an unsubmitted E2E fixture from City review analytics.',
            },
          ],
        });
        if (audits.count !== expectedTestWorkspaceCount + 1) {
          throw new Error(`Expected five audit records; created ${audits.count}.`);
        }

        const cityAnomaliesRemaining = await tx.application.count({
          where: {
            applicationType: 'individual',
            targetLevel: 'city',
            schoolYear: '2098-2099',
            cancelledAt: null,
          },
        });
        const registrationFlagsRemaining = await tx.workspace.count({
          where: { id: { in: workspaceIds }, registrationEnabled: true },
        });
        if (cityAnomaliesRemaining !== 0 || registrationFlagsRemaining !== 0) {
          throw new Error('In-transaction verification failed; rolling back the migration.');
        }

        return {
          testWorkspacesDisabled: registrationUpdate.count,
          e2eDraftQuarantined: applicationUpdate.count,
          evidencePreserved: true,
          auditRecords: audits.count,
          city2098_2099ApplicationsRemaining: cityAnomaliesRemaining,
          syntheticWorkspacesStillRegistrationEnabled: registrationFlagsRemaining,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    console.log(JSON.stringify({ outcome: 'APPLIED', databaseHost, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed.');
  process.exitCode = 1;
});
