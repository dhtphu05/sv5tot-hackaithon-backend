import 'dotenv/config';
import {
  assertDisposablePilotDatabaseUrl,
  parsePilotBootstrapConfig,
} from './pilot-bootstrap-config';

async function main() {
  let stage: 'configuration' | 'database' = 'configuration';
  try {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Pilot verification is disabled in production.');
    const config = parsePilotBootstrapConfig(process.env, {
      requireConfirmation: false,
      requirePassword: false,
    });
    if (process.env.DEFAULT_SCHOOL_YEAR !== config.schoolYear) {
      throw new Error('DEFAULT_SCHOOL_YEAR must match PILOT_SCHOOL_YEAR.');
    }
    process.env.DATABASE_URL = assertDisposablePilotDatabaseUrl(
      process.env.PILOT_DATABASE_URL,
    ).toString();
    process.env.NODE_ENV = 'test';
    stage = 'database';
    const [{ PrismaClient, WorkspaceType, Role, Criterion, Level }, { defaultCriteriaUnitScope }] =
      await Promise.all([
        import('@prisma/client'),
        import('../src/modules/rules/criteria.constants'),
      ]);
    const prisma = new PrismaClient();
    try {
      const versionRows = await prisma.$queryRawUnsafe<Array<{ version_num: number }>>(
        "SELECT current_setting('server_version_num')::int AS version_num",
      );
      if (Math.floor(versionRows[0]?.version_num / 10_000) !== 16) {
        throw new Error('Pilot commands require PostgreSQL 16.');
      }

      const city = await prisma.workspace.findUnique({ where: { code: 'DANANG_CITY' } });
      const udn = await prisma.workspace.findUnique({ where: { code: 'UDN' } });
      assert(
        city?.type === WorkspaceType.CITY && city.isActive && !city.registrationEnabled,
        'DANANG_CITY workspace is missing or misconfigured.',
      );
      assert(
        udn?.type === WorkspaceType.UNIVERSITY_SYSTEM &&
          udn.parentWorkspaceId === city.id &&
          udn.isActive &&
          !udn.registrationEnabled,
        'UDN workspace is missing or misconfigured.',
      );

      const workspaceIds = new Map<string, string>([
        ['DANANG_CITY', city.id],
        ['UDN', udn.id],
      ]);
      const registrationWorkspaceIds = new Set<string>();
      const workspaceSummary: Array<{ code: string; type: string; registrationEnabled: boolean }> =
        [];
      for (const schoolConfig of config.schools) {
        const parentId = schoolConfig.parentCode === 'UDN' ? udn.id : city.id;
        const workspace = await prisma.workspace.findUnique({ where: { code: schoolConfig.code } });
        assert(
          workspace?.type === WorkspaceType.SCHOOL &&
            workspace.parentWorkspaceId === parentId &&
            workspace.isActive,
          `Pilot school ${schoolConfig.code} is missing, inactive, or linked to the wrong parent.`,
        );
        workspaceIds.set(schoolConfig.code, workspace.id);
        workspaceSummary.push({
          code: workspace.code,
          type: workspace.type,
          registrationEnabled: workspace.registrationEnabled,
        });
        if (workspace.registrationEnabled) registrationWorkspaceIds.add(workspace.id);
        const criteria = await prisma.criteriaVersion.findUnique({
          where: {
            workspaceId_schoolYear_level_versionName: {
              workspaceId: workspace.id,
              schoolYear: config.schoolYear,
              level: Level.city,
              versionName: `City pilot ${config.schoolYear}`,
            },
          },
          include: { rules: { select: { id: true } } },
        });
        assert(
          criteria?.isActive && criteria.rules.length > 0,
          `City criteria missing for ${schoolConfig.code}.`,
        );
      }

      const season = await prisma.cityReviewSeason.findUnique({
        where: { schoolYear: config.schoolYear },
      });
      assert(season, `City review season ${config.schoolYear} is missing.`);
      const expectedSeasonDates = {
        submissionOpensAt: new Date(config.seasonDates.submissionOpensAt),
        submissionClosesAt: new Date(config.seasonDates.submissionClosesAt),
        reviewDeadlineAt: config.seasonDates.reviewDeadlineAt
          ? new Date(config.seasonDates.reviewDeadlineAt)
          : null,
        supplementDeadlineAt: config.seasonDates.supplementDeadlineAt
          ? new Date(config.seasonDates.supplementDeadlineAt)
          : null,
        finalizationDeadlineAt: config.seasonDates.finalizationDeadlineAt
          ? new Date(config.seasonDates.finalizationDeadlineAt)
          : null,
      };
      assert(
        Object.entries(expectedSeasonDates).every(([field, expected]) =>
          sameDate(season[field as keyof typeof expectedSeasonDates], expected),
        ),
        'Configured review season dates do not match the pilot season.',
      );
      const cityConfig = await prisma.criteriaConfig.findUnique({
        where: { code: 'DANANG_CITY_CURRENT' },
        include: { rules: { where: { isActive: true }, select: { criterion: true } } },
      });
      const cityConfigCriteria = new Set(cityConfig?.rules.map((rule) => rule.criterion) ?? []);
      assert(
        cityConfig?.scope === Level.city && cityConfig.isActive,
        'Active normalized City criteria configuration is missing.',
      );
      for (const criterion of [
        Criterion.ethics,
        Criterion.academic,
        Criterion.physical,
        Criterion.volunteer,
        Criterion.integration,
      ]) {
        assert(cityConfigCriteria.has(criterion), `City criteria do not include ${criterion}.`);
      }

      const staffCounts: Record<string, number> = {};
      for (const member of config.staff) {
        const workspaceId =
          member.role === Role.admin
            ? null
            : (workspaceIds.get(member.workspaceCode ?? '') ?? null);
        const user = await prisma.user.findUnique({
          where: { email: member.email },
          select: { id: true, fullName: true, role: true, workspaceId: true, isActive: true },
        });
        assert(
          user?.fullName === member.fullName &&
            user.role === member.role &&
            user.workspaceId === workspaceId &&
            user.isActive,
          `Configured staff account ${member.email} is missing or misconfigured.`,
        );
        staffCounts[member.role] = (staffCounts[member.role] ?? 0) + 1;
      }

      const cityOfficers = await prisma.user.findMany({
        where: { role: Role.city_officer, workspaceId: city.id, isActive: true },
        select: { id: true },
      });
      const officerSpecializations = await prisma.officerSpecialization.findMany({
        where: { officerId: { in: cityOfficers.map((officer) => officer.id) }, isActive: true },
        select: { criterion: true, facultyScope: true },
      });
      const requiredCriteria = new Set([
        Criterion.ethics,
        Criterion.academic,
        Criterion.physical,
        Criterion.volunteer,
        Criterion.integration,
      ]);
      const configuredCriteria = new Set(
        officerSpecializations.map((specialization) => specialization.criterion),
      );
      assert(
        officerSpecializations.every((specialization) => specialization.facultyScope === null),
        'City officer specializations must be unscoped.',
      );
      assert(
        configuredCriteria.size === requiredCriteria.size &&
          [...requiredCriteria].every((criterion) => configuredCriteria.has(criterion)),
        'Active City officers must cover exactly the five canonical criteria.',
      );

      const choices = await prisma.workspace.findMany({
        where: { isActive: true, registrationEnabled: true },
        select: { id: true, code: true, type: true },
      });
      assert(
        choices.every(
          (workspace) =>
            workspace.type === WorkspaceType.SCHOOL && workspaceIds.has(workspace.code),
        ),
        'Public registration includes a non-pilot or non-School workspace.',
      );
      assert(
        choices.every((workspace) => registrationWorkspaceIds.has(workspace.id)),
        'Registration workspace discovery is inconsistent.',
      );

      const studentAccountCount = await prisma.user.count({ where: { role: Role.student } });
      const applicationCount = await prisma.application.count();
      const summary = {
        result: 'pilot bootstrap verified',
        database: 'local PostgreSQL 16 disposable database',
        workspaceHierarchy: {
          city: city.code,
          universitySystem: udn.code,
          schools: workspaceSummary,
        },
        season: config.schoolYear,
        staffCounts,
        cityOfficerSpecializations: [...configuredCriteria].sort(),
        publicRegistrationChoiceCodes: choices.map((workspace) => workspace.code).sort(),
        studentAccountsPresent: studentAccountCount,
        applicationsPresent: applicationCount,
        bootstrapCreatesStudentsOrApplications: false,
        criteriaUnitScope: defaultCriteriaUnitScope,
      };
      console.info(JSON.stringify(summary, null, 2));
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    if (stage === 'configuration' && error instanceof Error) console.error(error.message);
    else
      console.error('Pilot verification failed. Database details and credentials were suppressed.');
    process.exitCode = 1;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

void main();
