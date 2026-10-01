import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';

const schoolYear = '2026-2027';
const auditAction = 'DATA_MIGRATION_CREATE_CITY_REVIEW_SEASON_2026_2027';
const submissionOpensAt = new Date('2026-09-28T17:00:00.000Z');
const submissionClosesAt = new Date('2026-10-08T16:59:59.999Z');

if (process.env.APPLY_CITY_REVIEW_SEASON_2026_2027 !== 'OPEN_2026_2027_SUBMISSION_WINDOW') {
  throw new Error(
    'Set APPLY_CITY_REVIEW_SEASON_2026_2027=OPEN_2026_2027_SUBMISSION_WINDOW to create the season.',
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const databaseHost = new URL(databaseUrl).hostname;
if (!databaseHost.endsWith('supabase.com') && !databaseHost.endsWith('supabase.co')) {
  throw new Error(`Refusing to run against non-Supabase host: ${databaseHost}`);
}

if (submissionOpensAt >= submissionClosesAt) {
  throw new Error('The submission window must open before it closes.');
}

const prisma = new PrismaClient();

void (async () => {
  try {
    const season = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.cityReviewSeason.findUnique({ where: { schoolYear } });
        if (existing)
          throw new Error(`${schoolYear} review season already exists; no data changed.`);

        const cityWorkspace = await tx.workspace.findUnique({
          where: { code: 'DANANG_CITY' },
          select: { id: true, type: true, isActive: true },
        });
        if (!cityWorkspace || cityWorkspace.type !== 'CITY' || !cityWorkspace.isActive) {
          throw new Error('DANANG_CITY must resolve to an active CITY workspace.');
        }

        const created = await tx.cityReviewSeason.create({
          data: {
            schoolYear,
            submissionOpensAt,
            submissionClosesAt,
          },
        });

        const audit = await tx.auditLog.create({
          data: {
            workspaceId: cityWorkspace.id,
            action: auditAction,
            targetType: 'city_review_season',
            targetId: created.id,
            afterStateJson: {
              schoolYear,
              submissionOpensAt: submissionOpensAt.toISOString(),
              submissionClosesAt: submissionClosesAt.toISOString(),
              reviewDeadlineAt: null,
              supplementDeadlineAt: null,
              finalizationDeadlineAt: null,
            } satisfies Prisma.InputJsonObject,
            note: 'Submission period configured from the dates provided by the system owner.',
          },
        });

        const [stored, auditCount] = await Promise.all([
          tx.cityReviewSeason.findUnique({ where: { schoolYear } }),
          tx.auditLog.count({ where: { action: auditAction, targetId: created.id } }),
        ]);
        if (
          !stored ||
          stored.submissionOpensAt?.getTime() !== submissionOpensAt.getTime() ||
          stored.submissionClosesAt?.getTime() !== submissionClosesAt.getTime() ||
          stored.reviewDeadlineAt !== null ||
          stored.supplementDeadlineAt !== null ||
          stored.finalizationDeadlineAt !== null ||
          auditCount !== 1 ||
          !audit.id
        ) {
          throw new Error('Season verification failed; rolling back.');
        }

        return stored;
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
          outcome: 'CREATED',
          databaseHost,
          schoolYear: season.schoolYear,
          submissionOpensAtLocal: '2026-09-29 00:00:00 Asia/Ho_Chi_Minh',
          submissionClosesAtLocal: '2026-10-08 23:59:59.999 Asia/Ho_Chi_Minh',
          reviewDeadlineAt: season.reviewDeadlineAt,
          supplementDeadlineAt: season.supplementDeadlineAt,
          finalizationDeadlineAt: season.finalizationDeadlineAt,
          version: season.version,
          auditAction,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Season creation failed.');
  process.exitCode = 1;
});
