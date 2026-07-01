import { Criterion, Level, Prisma, Role } from '@prisma/client';
import { env } from '../src/config/env';
import { logger } from '../src/config/logger';
import { prisma } from '../src/infrastructure/database/prisma';
import { PasswordService } from '../src/modules/auth/password.service';
import { fallbackRulesByLevel } from '../src/modules/rules/criteria.constants';

const passwordService = new PasswordService();

type SeedUser = {
  email: string;
  role: Role;
  fullName: string;
  studentCode?: string;
  className?: string;
  faculty?: string;
  specialization?: Criterion;
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
    email: 'classrep@dut.udn.vn',
    role: Role.class_representative,
    fullName: 'Trần Lớp Trưởng',
    studentCode: '102220002',
    className: '22T_DT1',
    faculty: 'Khoa Công nghệ Thông tin',
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

const criteriaRules = Object.entries(fallbackRulesByLevel).flatMap(([level, rules]) =>
  rules.map((rule) => ({ level: level as Level, ...rule })),
);

async function seedUsers(): Promise<void> {
  const passwordHash = await passwordService.hashPassword(env.SEED_DEFAULT_PASSWORD);

  for (const seedUser of demoUsers) {
    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: {
        fullName: seedUser.fullName,
        role: seedUser.role,
        studentCode: seedUser.studentCode,
        className: seedUser.className,
        faculty: seedUser.faculty,
        isActive: true,
      },
      create: {
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

    if (seedUser.specialization) {
      await prisma.officerSpecialization.upsert({
        where: {
          officerId_criterion_facultyScope: {
            officerId: user.id,
            criterion: seedUser.specialization,
            facultyScope: seedUser.faculty ?? '',
          },
        },
        update: {
          isActive: true,
        },
        create: {
          officerId: user.id,
          criterion: seedUser.specialization,
          facultyScope: seedUser.faculty ?? '',
          isActive: true,
        },
      });
    }
  }
}

async function seedCriteriaRules(): Promise<void> {
  const schoolYear = '2025-2026';
  const unitScope = 'DHBK-DHDN';

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
}

function toSeedJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

async function main(): Promise<void> {
  await seedUsers();
  await seedCriteriaRules();
  logger.info({ userCount: demoUsers.length }, 'Seed completed');
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
