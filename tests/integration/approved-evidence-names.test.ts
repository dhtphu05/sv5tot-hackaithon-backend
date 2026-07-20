import { Criterion, KnowledgeDecision, Level, Role } from '@prisma/client';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import { PasswordService } from '../../src/modules/auth/password.service';

const app = createApp();
const validPassphrase = process.env.SEED_DEFAULT_PASSWORD ?? ['Password', '@123'].join('');
const workspaceId = '33333333-3333-4333-8333-333333333333';
const faculty = 'Approved Evidence Test Faculty';
const titlePrefix = 'Approved Evidence Names Test';

const accounts = {
  student: 'approved-evidence.student@dut.udn.vn',
  officer: 'approved-evidence.officer@dut.udn.vn',
  manager: 'approved-evidence.manager@dut.udn.vn',
};

async function seedUser(input: {
  email: string;
  role: Role;
  fullName: string;
  studentCode?: string;
  specialization?: Criterion;
}) {
  const passwordHash = await new PasswordService().hashPassword(validPassphrase);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      workspaceId,
      fullName: input.fullName,
      role: input.role,
      passwordHash,
      studentCode: input.studentCode,
      faculty,
      isActive: true,
    },
    create: {
      workspaceId,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      studentCode: input.studentCode,
      faculty,
      isActive: true,
    },
  });

  if (input.specialization) {
    await prisma.officerSpecialization.upsert({
      where: {
        officerId_criterion_facultyScope: {
          officerId: user.id,
          criterion: input.specialization,
          facultyScope: faculty,
        },
      },
      update: { isActive: true },
      create: {
        officerId: user.id,
        criterion: input.specialization,
        facultyScope: faculty,
        isActive: true,
      },
    });
  }

  return user;
}

async function login(email: string) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: validPassphrase })
    .expect(200);

  return response.body.data.accessToken as string;
}

describe('approved evidence names knowledge-base endpoint', () => {
  let studentToken: string;
  let officerToken: string;
  let managerToken: string;

  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: workspaceId },
      update: {
        code: 'APPROVED-EVIDENCE-TEST',
        name: 'Approved Evidence Test Workspace',
        shortName: 'AET',
        isActive: true,
        registrationEnabled: true,
      },
      create: {
        id: workspaceId,
        code: 'APPROVED-EVIDENCE-TEST',
        name: 'Approved Evidence Test Workspace',
        shortName: 'AET',
        isActive: true,
        registrationEnabled: true,
      },
    });

    const student = await seedUser({
      email: accounts.student,
      role: Role.student,
      fullName: 'Approved Evidence Student',
      studentCode: '209900001',
    });
    const officer = await seedUser({
      email: accounts.officer,
      role: Role.officer,
      fullName: 'Approved Evidence Officer',
      specialization: Criterion.academic,
    });
    const manager = await seedUser({
      email: accounts.manager,
      role: Role.manager,
      fullName: 'Approved Evidence Manager',
    });

    await prisma.knowledgeBaseItem.deleteMany({
      where: {
        OR: [
          { createdBy: { in: [student.id, officer.id, manager.id] } },
          { evidenceName: { startsWith: titlePrefix } },
        ],
      },
    });

    await prisma.knowledgeBaseItem.createMany({
      data: [
        {
          workspaceId,
          evidenceName: `${titlePrefix} Academic`,
          eventName: `${titlePrefix} Academic Event`,
          criterion: Criterion.academic,
          level: Level.school,
          decision: KnowledgeDecision.accepted,
          reason: 'Sensitive review reason',
          requiredFieldsJson: ['Sensitive field'],
          commonErrorsJson: ['Sensitive error'],
          createdBy: manager.id,
        },
        {
          workspaceId,
          evidenceName: `${titlePrefix} Volunteer`,
          eventName: `${titlePrefix} Volunteer Event`,
          criterion: Criterion.volunteer,
          level: Level.city,
          decision: KnowledgeDecision.accepted,
          reason: 'Another sensitive review reason',
          requiredFieldsJson: ['Another sensitive field'],
          commonErrorsJson: ['Another sensitive error'],
          createdBy: manager.id,
        },
        {
          workspaceId,
          evidenceName: `${titlePrefix} Rejected`,
          eventName: `${titlePrefix} Rejected Event`,
          criterion: Criterion.academic,
          level: Level.school,
          decision: KnowledgeDecision.rejected,
          reason: 'Rejected reason',
          createdBy: manager.id,
        },
      ],
    });

    studentToken = await login(accounts.student);
    officerToken = await login(accounts.officer);
    managerToken = await login(accounts.manager);
  });

  it('returns only safe name fields to students', async () => {
    const response = await request(app)
      .get('/api/knowledge-base/approved-evidence-names')
      .query({ q: titlePrefix, limit: 10 })
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(200);

    const items = response.body.data.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        criterion: expect.any(String),
      }),
    );
    expect(items[0]).not.toHaveProperty('reason');
    expect(items[0]).not.toHaveProperty('requiredFieldsJson');
    expect(items[0]).not.toHaveProperty('commonErrorsJson');
    expect(items[0]).not.toHaveProperty('eventName');
    expect(items.map((item: { title: string }) => item.title)).not.toContain(
      `${titlePrefix} Rejected`,
    );
  });

  it('scopes officer results to active specializations', async () => {
    const response = await request(app)
      .get('/api/knowledge-base/approved-evidence-names')
      .query({ q: titlePrefix, limit: 10 })
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0]).toMatchObject({
      title: `${titlePrefix} Academic`,
      criterion: Criterion.academic,
      eventName: `${titlePrefix} Academic Event`,
      level: Level.school,
      usageCount: expect.any(Number),
      updatedAt: expect.any(String),
    });
  });

  it('lets managers filter accepted evidence names by criterion and query', async () => {
    const response = await request(app)
      .get('/api/knowledge-base/approved-evidence-names')
      .query({ q: titlePrefix, criterion: Criterion.volunteer, page: 1, limit: 10 })
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(response.body.data.items).toEqual([
      expect.objectContaining({
        title: `${titlePrefix} Volunteer`,
        criterion: Criterion.volunteer,
      }),
    ]);
    expect(response.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });
});
