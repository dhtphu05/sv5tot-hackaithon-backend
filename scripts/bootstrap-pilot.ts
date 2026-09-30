import 'dotenv/config';
import {
  assertDisposablePilotDatabaseUrl,
  parsePilotBootstrapConfig,
  type PilotSchoolConfig,
  type PilotStaffConfig,
} from './pilot-bootstrap-config';

async function main() {
  let stage: 'configuration' | 'database' = 'configuration';
  try {
    if (process.env.NODE_ENV === 'production')
      throw new Error('Pilot bootstrap is disabled in production.');
    const config = parsePilotBootstrapConfig(process.env);
    if (process.env.DEFAULT_SCHOOL_YEAR !== config.schoolYear) {
      throw new Error('DEFAULT_SCHOOL_YEAR must match PILOT_SCHOOL_YEAR before bootstrap.');
    }
    const databaseUrl = assertDisposablePilotDatabaseUrl(process.env.PILOT_DATABASE_URL);
    process.env.DATABASE_URL = databaseUrl.toString();
    process.env.NODE_ENV = 'test';
    stage = 'database';

    const [
      { prisma },
      { WorkspaceType, Role, Level },
      { PasswordService },
      { fallbackRulesByLevel, defaultCriteriaUnitScope },
      { currentCriteriaSeedConfigs },
      { seedNormalizedCriteria },
    ] = await Promise.all([
      import('../src/infrastructure/database/prisma'),
      import('@prisma/client'),
      import('../src/modules/auth/password.service'),
      import('../src/modules/rules/criteria.constants'),
      import('../prisma/seeds/criteria/current.criteria'),
      import('../prisma/seeds/criteria/seed-criteria'),
    ]);
    try {
      await assertPostgres16(prisma);
      const city = await ensureWorkspace(prisma, {
        code: 'DANANG_CITY',
        type: WorkspaceType.CITY,
        name: 'Thành phố Đà Nẵng',
        shortName: 'Đà Nẵng',
        parentWorkspaceId: null,
      });
      const udn = await ensureWorkspace(prisma, {
        code: 'UDN',
        type: WorkspaceType.UNIVERSITY_SYSTEM,
        name: 'Đại học Đà Nẵng',
        shortName: 'ĐHĐN',
        parentWorkspaceId: city.id,
      });
      const workspaceIds = new Map<string, string>([
        ['DANANG_CITY', city.id],
        ['UDN', udn.id],
      ]);
      for (const school of config.schools) {
        const parentWorkspaceId = school.parentCode === 'UDN' ? udn.id : city.id;
        const workspace = await ensureSchoolWorkspace(
          prisma,
          school,
          parentWorkspaceId,
          WorkspaceType.SCHOOL,
        );
        workspaceIds.set(school.code, workspace.id);
      }

      await ensureSeason(prisma, config.schoolYear, config.seasonDates);
      for (const school of config.schools) {
        await ensureCityCriteria(prisma, {
          workspaceId: workspaceIds.get(school.code)!,
          schoolYear: config.schoolYear,
          fallbackRulesByLevel,
          defaultCriteriaUnitScope,
          Level,
        });
      }
      const cityCriteria = currentCriteriaSeedConfigs.find((item) => item.scope === Level.city);
      if (!cityCriteria) throw new Error('The current City criteria configuration is missing.');
      await seedNormalizedCriteria(prisma, [cityCriteria]);

      const passwordHash = await new PasswordService().hashPassword(config.password!);
      let createdStaffCount = 0;
      let reusedStaffCount = 0;
      for (const member of config.staff) {
        const staff = await ensureStaff(prisma, member, workspaceIds, passwordHash, Role);
        if (staff.created) createdStaffCount += 1;
        else reusedStaffCount += 1;
        if (member.role === Role.city_officer) {
          for (const specialization of member.specializations ?? []) {
            await ensureSpecialization(prisma, staff.id, specialization);
          }
        }
      }

      console.info(
        JSON.stringify({
          result: 'pilot bootstrap completed',
          workspaceCount: config.schools.length + 2,
          staffCreated: createdStaffCount,
          staffReused: reusedStaffCount,
          studentAccountsCreated: 0,
          applicationsCreated: 0,
          registrationOpenedByBootstrap: false,
        }),
      );
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    if (stage === 'configuration' && error instanceof Error) console.error(error.message);
    else console.error('Pilot bootstrap failed. Database details and credentials were suppressed.');
    process.exitCode = 1;
  }
}

async function ensureWorkspace(
  prisma: import('@prisma/client').PrismaClient,
  input: {
    code: string;
    type: import('@prisma/client').WorkspaceType;
    name: string;
    shortName: string;
    parentWorkspaceId: string | null;
  },
) {
  const existing = await prisma.workspace.findUnique({ where: { code: input.code } });
  if (existing) {
    if (
      existing.type !== input.type ||
      existing.parentWorkspaceId !== input.parentWorkspaceId ||
      existing.name !== input.name ||
      existing.shortName !== input.shortName ||
      !existing.isActive ||
      existing.registrationEnabled
    )
      throw new Error(
        `Existing ${input.code} workspace does not match the required active pilot hierarchy.`,
      );
    return existing;
  }
  return prisma.workspace.create({
    data: { ...input, isActive: true, registrationEnabled: false },
  });
}

async function ensureSchoolWorkspace(
  prisma: import('@prisma/client').PrismaClient,
  school: PilotSchoolConfig,
  parentWorkspaceId: string,
  type: import('@prisma/client').WorkspaceType,
) {
  const existing = await prisma.workspace.findUnique({ where: { code: school.code } });
  if (existing) {
    if (
      existing.type !== type ||
      existing.parentWorkspaceId !== parentWorkspaceId ||
      existing.name !== school.name ||
      existing.shortName !== (school.shortName ?? null) ||
      !existing.isActive
    )
      throw new Error(`Existing ${school.code} workspace does not match the pilot configuration.`);
    return existing;
  }
  return prisma.workspace.create({
    data: {
      code: school.code,
      type,
      parentWorkspaceId,
      name: school.name,
      shortName: school.shortName,
      isActive: true,
      registrationEnabled: false,
    },
  });
}

async function ensureSeason(
  prisma: import('@prisma/client').PrismaClient,
  schoolYear: string,
  dates: import('./pilot-bootstrap-config').PilotBootstrapConfig['seasonDates'],
) {
  const existing = await prisma.cityReviewSeason.findUnique({ where: { schoolYear } });
  if (existing) {
    const expected = {
      submissionOpensAt: asDate(dates.submissionOpensAt),
      submissionClosesAt: asDate(dates.submissionClosesAt),
      reviewDeadlineAt: asDate(dates.reviewDeadlineAt),
      supplementDeadlineAt: asDate(dates.supplementDeadlineAt),
      finalizationDeadlineAt: asDate(dates.finalizationDeadlineAt),
    };
    if (
      Object.entries(expected).some(
        ([field, value]) => !sameDate(existing[field as keyof typeof expected], value),
      )
    ) {
      throw new Error(
        `Existing review season ${schoolYear} differs from PILOT_SEASON_DATES_JSON; no dates were overwritten.`,
      );
    }
    return existing;
  }
  return prisma.cityReviewSeason.create({
    data: {
      schoolYear,
      submissionOpensAt: asDate(dates.submissionOpensAt),
      submissionClosesAt: asDate(dates.submissionClosesAt),
      reviewDeadlineAt: asDate(dates.reviewDeadlineAt),
      supplementDeadlineAt: asDate(dates.supplementDeadlineAt),
      finalizationDeadlineAt: asDate(dates.finalizationDeadlineAt),
    },
  });
}

async function ensureCityCriteria(
  prisma: import('@prisma/client').PrismaClient,
  input: {
    workspaceId: string;
    schoolYear: string;
    fallbackRulesByLevel: typeof import('../src/modules/rules/criteria.constants').fallbackRulesByLevel;
    defaultCriteriaUnitScope: string;
    Level: typeof import('@prisma/client').Level;
  },
) {
  const level = input.Level.city;
  const versionName = `City pilot ${input.schoolYear}`;
  const existing = await prisma.criteriaVersion.findUnique({
    where: {
      workspaceId_schoolYear_level_versionName: {
        workspaceId: input.workspaceId,
        schoolYear: input.schoolYear,
        level,
        versionName,
      },
    },
    include: { rules: { select: { ruleKey: true } } },
  });
  const version =
    existing ??
    (await prisma.criteriaVersion.create({
      data: {
        workspaceId: input.workspaceId,
        schoolYear: input.schoolYear,
        unitScope: input.defaultCriteriaUnitScope,
        level,
        versionName,
        isActive: true,
      },
    }));
  if (!version.isActive)
    throw new Error(`City criteria for workspace ${input.workspaceId} is inactive.`);
  const existingKeys = new Set(existing?.rules.map((rule) => rule.ruleKey) ?? []);
  const missingRules = input.fallbackRulesByLevel[level].filter(
    (rule) => !existingKeys.has(rule.ruleKey),
  );
  if (missingRules.length > 0) {
    await prisma.criteriaRule.createMany({
      data: missingRules.map((rule) => ({
        criteriaVersionId: version.id,
        criterion: rule.criterion,
        ruleKey: rule.ruleKey,
        ruleType: rule.ruleType,
        thresholdJson: toJson(rule.thresholdJson),
        evidenceRequirementsJson: toJson(rule.evidenceRequirementsJson),
        humanReadableText: rule.humanReadableText,
      })),
    });
  }
}

async function ensureStaff(
  prisma: import('@prisma/client').PrismaClient,
  member: PilotStaffConfig,
  workspaceIds: Map<string, string>,
  passwordHash: string,
  Role: typeof import('@prisma/client').Role,
): Promise<{ id: string; created: boolean }> {
  const workspaceId =
    member.role === Role.admin ? null : workspaceIds.get(member.workspaceCode ?? '');
  if (member.role !== Role.admin && !workspaceId)
    throw new Error(`No pilot workspace is configured for ${member.role}.`);
  const existing = await prisma.user.findUnique({ where: { email: member.email } });
  if (existing) {
    if (
      existing.role !== member.role ||
      existing.workspaceId !== workspaceId ||
      existing.fullName !== member.fullName ||
      !existing.isActive
    ) {
      throw new Error(
        `Existing staff account ${member.email} has a different role, workspace, or inactive status.`,
      );
    }
    return { id: existing.id, created: false };
  }
  const created = await prisma.user.create({
    data: {
      email: member.email,
      fullName: member.fullName,
      role: member.role,
      workspaceId,
      passwordHash,
      isActive: true,
    },
  });
  return { id: created.id, created: true };
}

async function ensureSpecialization(
  prisma: import('@prisma/client').PrismaClient,
  officerId: string,
  criterion: import('@prisma/client').Criterion,
) {
  const existing = await prisma.officerSpecialization.findFirst({
    where: { officerId, criterion, facultyScope: null },
    select: { id: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive)
      throw new Error(`City officer specialization ${criterion} is inactive.`);
    return;
  }
  await prisma.officerSpecialization.create({
    data: { officerId, criterion, facultyScope: null, isActive: true },
  });
}

async function assertPostgres16(prisma: import('@prisma/client').PrismaClient) {
  const rows = await prisma.$queryRawUnsafe<Array<{ version_num: number }>>(
    "SELECT current_setting('server_version_num')::int AS version_num",
  );
  if (Math.floor(rows[0]?.version_num / 10_000) !== 16) {
    throw new Error('Pilot commands require PostgreSQL 16.');
  }
}

function asDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function toJson(value: unknown) {
  return value === null || value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as import('@prisma/client').Prisma.InputJsonValue);
}

void main();
