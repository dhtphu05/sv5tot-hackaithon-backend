import { Criterion, Level, Prisma, Role, WorkspaceType } from '@prisma/client';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import { prisma } from '../src/infrastructure/database/prisma';
import { PasswordService } from '../src/modules/auth/password.service';
import { defaultCriteriaUnitScope, fallbackRulesByLevel } from '../src/modules/rules/criteria.constants';
import { seedNormalizedCriteria } from './seeds/criteria/seed-criteria';

const passwordService = new PasswordService();
const defaultWorkspaceCode = 'DHBK-DHDN';
const economicsWorkspaceCode = 'DHKTE-DHDN';
const cityWorkspaceCode = 'DANANG_CITY';
const universityWorkspaceCode = 'UDN';
const economicsTrialCriteriaVersionName =
  'Bộ tiêu chí thử nghiệm - không sử dụng cho xét duyệt chính thức';

const udnWorkspaces = [
  {
    code: defaultWorkspaceCode,
    name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
    shortName: 'DHBK',
    isActive: true,
    registrationEnabled: true,
  },
  {
    code: economicsWorkspaceCode,
    name: 'Trường Đại học Kinh tế - Đại học Đà Nẵng',
    shortName: 'DHKTE',
    isActive: true,
    registrationEnabled: true,
  },
  {
    code: 'DHSP-DHDN',
    name: 'Trường Đại học Sư phạm - Đại học Đà Nẵng',
    shortName: 'DHSP',
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DHNN-DHDN',
    name: 'Trường Đại học Ngoại ngữ - Đại học Đà Nẵng',
    shortName: 'DHNN',
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'DHSPKT-DHDN',
    name: 'Trường Đại học Sư phạm Kỹ thuật - Đại học Đà Nẵng',
    shortName: 'DHSPKT',
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'VKU-DHDN',
    name: 'Trường Đại học Công nghệ Thông tin và Truyền thông Việt - Hàn - Đại học Đà Nẵng',
    shortName: 'VKU',
    isActive: true,
    registrationEnabled: false,
  },
  {
    code: 'TYD-DHDN',
    name: 'Trường Y Dược - Đại học Đà Nẵng',
    shortName: 'TYD',
    isActive: true,
    registrationEnabled: false,
  },
] as const;

type SeedUser = {
  email: string;
  role: Role;
  fullName: string;
  studentCode?: string;
  className?: string;
  faculty?: string;
  specialization?: Criterion;
  specializations?: Criterion[];
  specializationFacultyScope?: string | null;
};

const demoUsers: SeedUser[] = [
  {
    email: 'student@dut.udn.vn',
    role: Role.student,
    fullName: 'Nguyễn Văn Sinh',
    studentCode: '102220001',
    className: '22T_DT1',
    faculty: 'Khoa Công nghệ Thông tin',
  },
  {
    email: 'student2@dut.udn.vn',
    role: Role.student,
    fullName: 'Demo Student 02',
    studentCode: '102220003',
    className: '22T_DT1',
    faculty: 'Khoa Cong nghe Thong tin',
  },
  {
    email: 'collective@dut.udn.vn',
    role: Role.class_representative,
    fullName: 'Dai dien tap the',
    studentCode: '102220010',
    className: '22T_DT1',
    faculty: 'Khoa Cong nghe Thong tin',
  },
  {
    email: 'classrep@dut.udn.vn',
    role: Role.class_representative,
    fullName: 'Trần Lớp Trưởng',
    studentCode: '102220002',
    className: '22T_DT1',
    faculty: 'Khoa Công nghệ Thông tin',
  },
  {
    email: 'officer@dut.udn.vn',
    role: Role.officer,
    fullName: 'Can bo xet duyet demo',
    faculty: 'Khoa Cong nghe Thong tin',
    specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
  },
  {
    email: 'officer.academic@dut.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ Học tập',
    faculty: 'Khoa Công nghệ Thông tin',
    specialization: Criterion.academic,
  },
  {
    email: 'officer.volunteer@dut.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ Tình nguyện',
    faculty: 'Khoa Công nghệ Thông tin',
    specialization: Criterion.volunteer,
  },
  {
    email: 'officer.ethics@dut.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ Đạo đức',
    faculty: 'Khoa Công nghệ Thông tin',
    specialization: Criterion.ethics,
  },
  {
    email: 'officer.physical@dut.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ Thể lực',
    faculty: 'Khoa Công nghệ Thông tin',
    specialization: Criterion.physical,
  },
  {
    email: 'officer.integration@dut.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ Hội nhập',
    faculty: 'Khoa Công nghệ Thông tin',
    specialization: Criterion.integration,
  },
  {
    email: 'manager@dut.udn.vn',
    role: Role.manager,
    fullName: 'Quản lý Hội Sinh viên',
  },
  {
    email: 'committee@dut.udn.vn',
    role: Role.committee,
    fullName: 'Hội đồng Xét duyệt',
  },
  {
    email: 'admin@dut.udn.vn',
    role: Role.admin,
    fullName: 'Quản trị hệ thống',
  },
];

const economicsDemoFaculty = 'Khoa Kinh tế';
const economicsDemoUsers: SeedUser[] = [
  {
    email: 'student@due.udn.vn',
    role: Role.student,
    fullName: 'Sinh viên Demo Kinh tế',
    studentCode: '102220001',
    className: '48K01.1',
    faculty: economicsDemoFaculty,
  },
  {
    email: 'officer@due.udn.vn',
    role: Role.officer,
    fullName: 'Cán bộ xét duyệt Demo Kinh tế',
    faculty: economicsDemoFaculty,
    specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
    specializationFacultyScope: economicsDemoFaculty,
  },
  {
    email: 'manager@due.udn.vn',
    role: Role.manager,
    fullName: 'Quản lý Demo Kinh tế',
    faculty: economicsDemoFaculty,
  },
  {
    email: 'committee@due.udn.vn',
    role: Role.committee,
    fullName: 'Hội đồng Demo Kinh tế',
    faculty: economicsDemoFaculty,
  },
];

const cityDemoUsers: SeedUser[] = [
  {
    email: 'officer@danang.city',
    role: Role.city_officer,
    fullName: 'Cán bộ xét duyệt cấp thành phố',
    specializations: [Criterion.academic, Criterion.ethics, Criterion.volunteer],
  },
  {
    email: 'manager@danang.city',
    role: Role.city_manager,
    fullName: 'Quản lý cấp thành phố',
  },
  {
    email: 'committee@danang.city',
    role: Role.city_committee,
    fullName: 'Hội đồng cấp thành phố',
  },
];

const universityDemoUsers: SeedUser[] = [
  {
    email: 'uploader@udn.vn',
    role: Role.data_uploader,
    fullName: 'Cán bộ tải dữ liệu Đại học Đà Nẵng',
  },
];

const criteriaRules = Object.entries(fallbackRulesByLevel).flatMap(([level, rules]) =>
  rules.map((rule) => ({ level: level as Level, ...rule })),
);

async function seedWorkspaces() {
  const workspaces = new Map<string, Awaited<ReturnType<typeof prisma.workspace.upsert>>>();

  const cityWorkspace = await prisma.workspace.upsert({
    where: { code: cityWorkspaceCode },
    update: {
      name: 'Thành phố Đà Nẵng',
      shortName: 'Đà Nẵng',
      type: WorkspaceType.CITY,
      parentWorkspaceId: null,
      isActive: true,
      registrationEnabled: false,
    },
    create: {
      code: cityWorkspaceCode,
      name: 'Thành phố Đà Nẵng',
      shortName: 'Đà Nẵng',
      type: WorkspaceType.CITY,
      isActive: true,
      registrationEnabled: false,
    },
  });
  const universityWorkspace = await prisma.workspace.upsert({
    where: { code: universityWorkspaceCode },
    update: {
      name: 'Đại học Đà Nẵng',
      shortName: 'ĐHĐN',
      type: WorkspaceType.UNIVERSITY_SYSTEM,
      parentWorkspaceId: cityWorkspace.id,
      isActive: true,
      registrationEnabled: false,
    },
    create: {
      code: universityWorkspaceCode,
      name: 'Đại học Đà Nẵng',
      shortName: 'ĐHĐN',
      type: WorkspaceType.UNIVERSITY_SYSTEM,
      parentWorkspaceId: cityWorkspace.id,
      isActive: true,
      registrationEnabled: false,
    },
  });

  for (const workspaceSeed of udnWorkspaces) {
    const isUdnSchool =
      workspaceSeed.code === defaultWorkspaceCode || workspaceSeed.code === economicsWorkspaceCode;
    const school = {
      ...workspaceSeed,
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: isUdnSchool ? universityWorkspace.id : null,
    };
    const workspace = await prisma.workspace.upsert({
      where: { code: workspaceSeed.code },
      update: school,
      create: school,
    });
    workspaces.set(workspace.code, workspace);
  }

  return {
    cityWorkspace,
    universityWorkspace,
    defaultWorkspace: getSeededWorkspace(workspaces, defaultWorkspaceCode),
    economicsWorkspace: getSeededWorkspace(workspaces, economicsWorkspaceCode),
  };
}

function getSeededWorkspace(
  workspaces: Map<string, Awaited<ReturnType<typeof prisma.workspace.upsert>>>,
  code: string,
) {
  const workspace = workspaces.get(code);
  if (!workspace) {
    throw new Error(`Workspace ${code} was not seeded`);
  }
  return workspace;
}

async function seedUserList(users: SeedUser[], workspaceId: string | null): Promise<void> {
  const passwordHash = await passwordService.hashPassword(env.SEED_DEFAULT_PASSWORD);

  for (const seedUser of users) {
    const userWorkspaceId = seedUser.role === Role.admin ? null : workspaceId;
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        workspaceId: userWorkspaceId,
        fullName: seedUser.fullName,
        role: seedUser.role,
        studentCode: seedUser.studentCode,
        className: seedUser.className,
        faculty: seedUser.faculty,
        isActive: true,
      },
      create: {
        workspaceId: userWorkspaceId,
        email: seedUser.email,
        passwordHash,
        fullName: seedUser.fullName,
        role: seedUser.role,
        studentCode: seedUser.studentCode,
        className: seedUser.className,
        faculty: seedUser.faculty,
        isActive: true,
      },
    });

    const specializations = seedUser.specializations ?? (seedUser.specialization ? [seedUser.specialization] : []);
    if (seedUser.role === Role.officer || seedUser.role === Role.city_officer) {
      await prisma.officerSpecialization.updateMany({
        where: { officerId: user.id },
        data: { isActive: false },
      });
    }

    for (const specialization of specializations) {
      const facultyScope = seedUser.specializationFacultyScope ?? null;
      const existing = await prisma.officerSpecialization.findFirst({
        where: { officerId: user.id, criterion: specialization, facultyScope },
        select: { id: true },
      });

      if (existing) {
        await prisma.officerSpecialization.update({
          where: { id: existing.id },
          data: { isActive: true },
        });
      } else {
        await prisma.officerSpecialization.create({
          data: {
            officerId: user.id,
            criterion: specialization,
            facultyScope,
            isActive: true,
          },
        });
      }
    }
  }
}

async function seedUsers(): Promise<void> {
  const { cityWorkspace, universityWorkspace, defaultWorkspace, economicsWorkspace } =
    await seedWorkspaces();
  await seedUserList(demoUsers, defaultWorkspace.id);
  await seedUserList(economicsDemoUsers, economicsWorkspace.id);
  await seedUserList(cityDemoUsers, cityWorkspace.id);
  await seedUserList(universityDemoUsers, universityWorkspace.id);
}

async function seedCriteriaRules(): Promise<void> {
  const schoolYear = '2025-2026';
  const unitScope = defaultWorkspaceCode;
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { code: unitScope },
  });

  for (const level of Object.values(Level)) {
    await prisma.criteriaVersion.upsert({
      where: {
        schoolYear_unitScope_level_versionName: {
          schoolYear,
          unitScope,
          level,
          versionName: `MVP ${level}`,
        },
      },
      update: {
        isActive: true,
      },
      create: {
        schoolYear,
        workspaceId: workspace.id,
        unitScope,
        level,
        versionName: `MVP ${level}`,
        isActive: true,
      },
    });
  }

  for (const rule of criteriaRules) {
    const criteriaVersion = await prisma.criteriaVersion.findUniqueOrThrow({
      where: {
        schoolYear_unitScope_level_versionName: {
          schoolYear,
          unitScope,
          level: rule.level,
          versionName: `MVP ${rule.level}`,
        },
      },
    });

    await prisma.criteriaRule.upsert({
      where: {
        criteriaVersionId_ruleKey: {
          criteriaVersionId: criteriaVersion.id,
          ruleKey: rule.ruleKey,
        },
      },
      update: {
        criterion: rule.criterion,
        ruleType: rule.ruleType,
        thresholdJson: toSeedJson(rule.thresholdJson),
        evidenceRequirementsJson: toSeedJson(rule.evidenceRequirementsJson),
        humanReadableText: rule.humanReadableText,
      },
      create: {
        criteriaVersionId: criteriaVersion.id,
        criterion: rule.criterion,
        ruleKey: rule.ruleKey,
        ruleType: rule.ruleType,
        thresholdJson: toSeedJson(rule.thresholdJson),
        evidenceRequirementsJson: toSeedJson(rule.evidenceRequirementsJson),
        humanReadableText: rule.humanReadableText,
      },
    });
  }

  await seedEconomicsTrialCriteria(schoolYear);
}

async function seedEconomicsTrialCriteria(schoolYear: string): Promise<void> {
  const economicsWorkspace = await prisma.workspace.findUniqueOrThrow({
    where: { code: economicsWorkspaceCode },
  });
  const level = Level.school;
  const criteriaVersion = await prisma.criteriaVersion.upsert({
    where: {
      schoolYear_unitScope_level_versionName: {
        schoolYear,
        unitScope: defaultCriteriaUnitScope,
        level,
        versionName: economicsTrialCriteriaVersionName,
      },
    },
    update: {
      workspaceId: economicsWorkspace.id,
      isActive: true,
    },
    create: {
      schoolYear,
      workspaceId: economicsWorkspace.id,
      unitScope: defaultCriteriaUnitScope,
      level,
      versionName: economicsTrialCriteriaVersionName,
      isActive: true,
    },
  });

  for (const rule of fallbackRulesByLevel[level]) {
    await prisma.criteriaRule.upsert({
      where: {
        criteriaVersionId_ruleKey: {
          criteriaVersionId: criteriaVersion.id,
          ruleKey: rule.ruleKey,
        },
      },
      update: {
        criterion: rule.criterion,
        ruleType: rule.ruleType,
        thresholdJson: toSeedJson(rule.thresholdJson),
        evidenceRequirementsJson: toSeedJson(rule.evidenceRequirementsJson),
        humanReadableText: `[DHKTE thử nghiệm] ${rule.humanReadableText}`,
      },
      create: {
        criteriaVersionId: criteriaVersion.id,
        criterion: rule.criterion,
        ruleKey: rule.ruleKey,
        ruleType: rule.ruleType,
        thresholdJson: toSeedJson(rule.thresholdJson),
        evidenceRequirementsJson: toSeedJson(rule.evidenceRequirementsJson),
        humanReadableText: `[DHKTE thử nghiệm] ${rule.humanReadableText}`,
      },
    });
  }
}

function toSeedJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

async function main(): Promise<void> {
  await seedUsers();
  await seedCriteriaRules();
  const normalizedCriteriaSeed = await seedNormalizedCriteria(prisma);
  logger.info(
    {
      workspaceCount: udnWorkspaces.length,
      defaultWorkspaceCode,
      registrationEnabledWorkspaceCodes: udnWorkspaces
        .filter((workspace) => workspace.registrationEnabled)
        .map((workspace) => workspace.code),
      demoUserCount: demoUsers.length + economicsDemoUsers.length,
      economicsDemoUserCount: economicsDemoUsers.length,
      economicsTrialCriteriaVersionName,
      normalizedCriteria: {
        configCount: normalizedCriteriaSeed.configCount,
        ruleCount: normalizedCriteriaSeed.ruleCount,
        mandatoryCount: normalizedCriteriaSeed.mandatoryCount,
        priorityCount: normalizedCriteriaSeed.priorityCount,
        manualReviewCount: normalizedCriteriaSeed.manualReviewCount,
        deactivatedRuleCount: normalizedCriteriaSeed.deactivatedRuleCount,
      },
    },
    'Seed completed',
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error({ error }, 'Seed failed');
    await prisma.$disconnect();
    process.exit(1);
  });
