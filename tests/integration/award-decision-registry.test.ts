import {
  AwardDecisionStatus,
  AwardRecipientMatchStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import { PasswordService } from '../../src/modules/auth/password.service';

const app = createApp();
const runId = randomUUID().slice(0, 8).toUpperCase();
const password = process.env.SEED_DEFAULT_PASSWORD ?? 'Password@123';
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

type Fixture = {
  workspaceIds: string[];
  userIds: string[];
  tokens: { uploaderA: string; uploaderB: string; uploaderUdn: string; cityUploader: string; student: string; admin: string };
  decisionIds: string[];
};

let fixture: Fixture | null = null;

async function seedUser(role: Role, workspaceId: string | null, key: string) {
  const passwordHash = await new PasswordService().hashPassword(password);
  return prisma.user.create({
    data: {
      workspaceId,
      email: `p2-${key}-${runId.toLowerCase()}@example.test`,
      passwordHash,
      fullName: `Phase 2 ${key}`,
      role,
      studentCode: role === Role.student ? `P2${runId}` : null,
      isActive: true,
    },
  });
}

async function login(email: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return response.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function seedFixture(): Promise<Fixture> {
  const [schoolA, schoolB, udn, city] = await Promise.all([
    prisma.workspace.create({ data: { code: `P2-A-${runId}`, name: `Phase 2 School A ${runId}`, type: WorkspaceType.SCHOOL } }),
    prisma.workspace.create({ data: { code: `P2-B-${runId}`, name: `Phase 2 School B ${runId}`, type: WorkspaceType.SCHOOL } }),
    prisma.workspace.create({ data: { code: `P2-UDN-${runId}`, name: `Phase 2 UDN ${runId}`, type: WorkspaceType.UNIVERSITY_SYSTEM } }),
    prisma.workspace.create({ data: { code: `P2-CITY-${runId}`, name: `Phase 2 City ${runId}`, type: WorkspaceType.CITY } }),
  ]);
  const users = await Promise.all([
    seedUser(Role.data_uploader, schoolA.id, 'uploader-a'),
    seedUser(Role.data_uploader, schoolB.id, 'uploader-b'),
    seedUser(Role.data_uploader, udn.id, 'uploader-udn'),
    seedUser(Role.data_uploader, city.id, 'uploader-city'),
    seedUser(Role.student, schoolA.id, 'student'),
    seedUser(Role.admin, null, 'admin'),
  ]);
  const tokens = await Promise.all(users.map((user) => login(user.email)));
  return {
    workspaceIds: [schoolA.id, schoolB.id, udn.id, city.id],
    userIds: users.map((user) => user.id),
    tokens: {
      uploaderA: tokens[0],
      uploaderB: tokens[1],
      uploaderUdn: tokens[2],
      cityUploader: tokens[3],
      student: tokens[4],
      admin: tokens[5],
    },
    decisionIds: [],
  };
}

async function cleanupFixture(current: Fixture | null) {
  if (!current) return;
  const files = await prisma.file.findMany({
    where: { workspaceId: { in: current.workspaceIds } },
    select: { filePath: true },
  });
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: current.workspaceIds } } });
  await prisma.awardDecision.deleteMany({ where: { issuerWorkspaceId: { in: current.workspaceIds } } });
  await prisma.file.deleteMany({ where: { workspaceId: { in: current.workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: current.userIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: current.workspaceIds } } });
  await Promise.all(
    files.map((file) => fs.rm(path.join(uploadRoot, file.filePath), { force: true }).catch(() => undefined)),
  );
}

describe('Award Decision registry workspace isolation', () => {
  beforeAll(async () => {
    fixture = await seedFixture();
  }, 120_000);

  afterAll(async () => {
    await cleanupFixture(fixture);
  }, 120_000);

  it('creates school and UDN drafts with levels derived from workspace type', async () => {
    const current = fixture!;
    const school = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    const udn = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderUdn))
      .send({ schoolYear: '2025-2026', decisionNumber: '45-QĐ/HSV' })
      .expect(201);

    expect(school.body.data).toMatchObject({ awardLevel: 'SCHOOL', status: 'DRAFT' });
    expect(udn.body.data).toMatchObject({ awardLevel: 'UNIVERSITY_SYSTEM', status: 'DRAFT' });
    current.decisionIds.push(school.body.data.id, udn.body.data.id);
  });

  it('isolates list, detail, update, and direct file upload by issuer workspace', async () => {
    const current = fixture!;
    const schoolA = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    const schoolB = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderB))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    current.decisionIds.push(schoolA.body.data.id, schoolB.body.data.id);

    const listA = await request(app).get('/api/award-decisions').set(auth(current.tokens.uploaderA)).expect(200);
    expect(JSON.stringify(listA.body)).toContain(schoolA.body.data.id);
    expect(JSON.stringify(listA.body)).not.toContain(schoolB.body.data.id);

    await request(app)
      .get(`/api/award-decisions/${schoolB.body.data.id}`)
      .set(auth(current.tokens.uploaderA))
      .expect(404);
    await request(app)
      .patch(`/api/award-decisions/${schoolB.body.data.id}`)
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2026-2027' })
      .expect(404);

    const beforeFiles = await prisma.file.count({ where: { workspaceId: { in: current.workspaceIds } } });
    await request(app)
      .post(`/api/award-decisions/${schoolB.body.data.id}/files/decision`)
      .set(auth(current.tokens.uploaderA))
      .attach('file', Buffer.from('pdf'), { filename: 'decision.pdf', contentType: 'application/pdf' })
      .expect(404);
    await expect(prisma.file.count({ where: { workspaceId: { in: current.workspaceIds } } })).resolves.toBe(beforeFiles);
  });

  it('stores both file kinds in the decision workspace without starting jobs', async () => {
    const current = fixture!;
    const created = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    const decisionId = created.body.data.id as string;
    current.decisionIds.push(decisionId);

    const decisionFile = await request(app)
      .post(`/api/award-decisions/${decisionId}/files/decision`)
      .set(auth(current.tokens.uploaderA))
      .attach('file', Buffer.from('pdf'), { filename: 'decision.pdf', contentType: 'application/pdf' })
      .expect(201);
    const rosterFile = await request(app)
      .post(`/api/award-decisions/${decisionId}/files/roster`)
      .set(auth(current.tokens.uploaderA))
      .attach('file', Buffer.from('csv'), { filename: 'roster.csv', contentType: 'text/csv' })
      .expect(201);

    expect(decisionFile.body.data.decisionFile).toMatchObject({ originalName: 'decision.pdf' });
    expect(rosterFile.body.data.rosterFile).toMatchObject({ originalName: 'roster.csv' });
    const attachedFileIds = [decisionFile.body.data.decisionFile.id, rosterFile.body.data.rosterFile.id];
    const files = await prisma.file.findMany({ where: { id: { in: attachedFileIds } } });
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.workspaceId === current.workspaceIds[0])).toBe(true);
    await expect(prisma.indexingJob.count({ where: { targetId: decisionId } })).resolves.toBe(0);
  });

  it('stores duplicate unmatched recipients without requiring a user account', async () => {
    const current = fixture!;
    const created = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    const decisionId = created.body.data.id as string;
    current.decisionIds.push(decisionId);

    await prisma.awardRecipient.createMany({
      data: [1, 2].map((sourceRow) => ({
        awardDecisionId: decisionId,
        studentCode: `NO-ACCOUNT-${runId}`,
        fullName: 'Sinh viên chưa có tài khoản',
        matchedUserId: null,
        matchStatus: AwardRecipientMatchStatus.UNMATCHED,
        sourceRow,
      })),
    });
    await expect(prisma.awardRecipient.count({ where: { awardDecisionId: decisionId } })).resolves.toBe(2);
  });

  it('keeps admin global while rejecting students, City roles, City issuers, and uploader tenant switching', async () => {
    const current = fixture!;
    const forbiddenInputs = [
      { token: current.tokens.student, body: { schoolYear: '2025-2026' }, status: 403 },
      { token: current.tokens.uploaderA, body: { issuerWorkspaceId: current.workspaceIds[1], schoolYear: '2025-2026' }, status: 404 },
      { token: current.tokens.admin, body: { issuerWorkspaceId: current.workspaceIds[3], schoolYear: '2025-2026' }, status: 400 },
    ];
    for (const input of forbiddenInputs) {
      await request(app).post('/api/award-decisions').set(auth(input.token)).send(input.body).expect(input.status);
    }
    await request(app).get('/api/award-decisions').set(auth(current.tokens.cityUploader)).expect(403);
    await request(app).get('/api/events').set(auth(current.tokens.uploaderA)).expect(403);
    await request(app).get('/api/decision-imports').set(auth(current.tokens.uploaderA)).expect(403);

    const adminDecision = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.admin))
      .send({ issuerWorkspaceId: current.workspaceIds[2], schoolYear: '2025-2026' })
      .expect(201);
    current.decisionIds.push(adminDecision.body.data.id);
    const adminList = await request(app).get('/api/award-decisions').set(auth(current.tokens.admin)).expect(200);
    expect(JSON.stringify(adminList.body)).toContain(adminDecision.body.data.id);
  });

  it('allows draft updates but rejects metadata changes after confirmation', async () => {
    const current = fixture!;
    const created = await request(app)
      .post('/api/award-decisions')
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2025-2026' })
      .expect(201);
    const decisionId = created.body.data.id as string;
    current.decisionIds.push(decisionId);

    await request(app)
      .patch(`/api/award-decisions/${decisionId}`)
      .set(auth(current.tokens.uploaderA))
      .send({ decisionNumber: 'QD-2026/5TOT' })
      .expect(200);
    await prisma.awardDecision.update({
      where: { id: decisionId },
      data: { status: AwardDecisionStatus.CONFIRMED },
    });
    await request(app)
      .patch(`/api/award-decisions/${decisionId}`)
      .set(auth(current.tokens.uploaderA))
      .send({ schoolYear: '2026-2027' })
      .expect(409);
  });
});
