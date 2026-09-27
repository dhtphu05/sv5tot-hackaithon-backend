import {
  AwardDecisionStatus,
  AwardRecipientMatchStatus,
  JobType,
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
import { runIndexingJob } from '../../src/modules/jobs/jobs.service';

const app = createApp();
const runId = randomUUID().slice(0, 8).toUpperCase();
const password = process.env.SEED_DEFAULT_PASSWORD ?? 'Password@123';
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

type Fixture = {
  workspaces: Array<{ id: string; type: WorkspaceType }>;
  users: Array<{ id: string; email: string }>;
  tokens: { uploaderA: string; uploaderUdn: string; studentA: string; studentB: string; admin: string; cityOfficer: string };
  decisionIds: string[];
};

let fixture: Fixture | null = null;

async function seedUser(role: Role, workspaceId: string | null, key: string, studentCode?: string) {
  const passwordHash = await new PasswordService().hashPassword(password);
  return prisma.user.create({
    data: {
      workspaceId,
      email: `award-roster-${key}-${runId.toLowerCase()}@example.test`,
      passwordHash,
      fullName: `Award Roster ${key}`,
      role,
      studentCode: studentCode ?? null,
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
  const udn = await prisma.workspace.create({
    data: { code: `AR-UDN-${runId}`, name: `Award Roster UDN ${runId}`, type: WorkspaceType.UNIVERSITY_SYSTEM },
  });
  const [schoolA, schoolB, city] = await Promise.all([
    prisma.workspace.create({
      data: { code: `AR-A-${runId}`, name: `Award Roster School A ${runId}`, shortName: `ARA${runId}`, type: WorkspaceType.SCHOOL, parentWorkspaceId: udn.id },
    }),
    prisma.workspace.create({
      data: { code: `AR-B-${runId}`, name: `Award Roster School B ${runId}`, shortName: `ARB${runId}`, type: WorkspaceType.SCHOOL, parentWorkspaceId: udn.id },
    }),
    prisma.workspace.create({ data: { code: `AR-CITY-${runId}`, name: `Award Roster City ${runId}`, type: WorkspaceType.CITY } }),
  ]);
  const users = await Promise.all([
    seedUser(Role.data_uploader, schoolA.id, 'uploader-a'),
    seedUser(Role.data_uploader, udn.id, 'uploader-udn'),
    seedUser(Role.student, schoolA.id, 'student-a', '00123456'),
    seedUser(Role.student, schoolB.id, 'student-b', '00123456'),
    seedUser(Role.admin, null, 'admin'),
    seedUser(Role.city_officer, city.id, 'city-officer'),
  ]);
  const tokens = await Promise.all(users.map((user) => login(user.email)));
  return {
    workspaces: [schoolA, schoolB, udn, city],
    users,
    tokens: {
      uploaderA: tokens[0],
      uploaderUdn: tokens[1],
      studentA: tokens[2],
      studentB: tokens[3],
      admin: tokens[4],
      cityOfficer: tokens[5],
    },
    decisionIds: [],
  };
}

async function cleanupFixture(current: Fixture | null) {
  if (!current) return;
  const workspaceIds = current.workspaces.map(({ id }) => id);
  const files = await prisma.file.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { filePath: true } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.indexingJob.deleteMany({ where: { targetId: { in: current.decisionIds } } });
  await prisma.awardDecision.deleteMany({ where: { issuerWorkspaceId: { in: workspaceIds } } });
  await prisma.file.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: current.users.map(({ id }) => id) } } });
  await prisma.workspace.updateMany({ where: { id: { in: workspaceIds } }, data: { parentWorkspaceId: null } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await Promise.all(files.map(({ filePath }) => fs.rm(path.join(uploadRoot, filePath), { force: true }).catch(() => undefined)));
}

async function createDraft(token: string, issuerWorkspaceId?: string) {
  const response = await request(app)
    .post('/api/award-decisions')
    .set(auth(token))
    .send({ ...(issuerWorkspaceId ? { issuerWorkspaceId } : {}), schoolYear: '2025-2026' })
    .expect(201);
  const id = response.body.data.id as string;
  fixture!.decisionIds.push(id);
  return id;
}

async function uploadCsv(token: string, decisionId: string, csv: string) {
  return request(app)
    .post(`/api/award-decisions/${decisionId}/files/roster`)
    .set(auth(token))
    .attach('file', Buffer.from(csv), { filename: 'roster.csv', contentType: 'text/csv' })
    .expect(201);
}

async function processCsv(token: string, decisionId: string) {
  const response = await request(app)
    .post(`/api/award-decisions/${decisionId}/process-roster`)
    .set(auth(token))
    .expect(202);
  expect(response.body.data).toEqual({ status: 'processing' });
  expect(JSON.stringify(response.body)).not.toContain('jobId');
  const job = await prisma.indexingJob.findFirst({
    where: { targetId: decisionId, jobType: JobType.award_roster_ingestion },
    orderBy: { createdAt: 'desc' },
  });
  expect(job).not.toBeNull();
  return runIndexingJob(job!.id);
}

describe('Award roster ingestion', () => {
  beforeAll(async () => {
    fixture = await seedFixture();
  }, 120_000);

  afterAll(async () => cleanupFixture(fixture), 120_000);

  it('processes CSV, matches by school, confirms unmatched rows, and hides internal account IDs', async () => {
    const current = fixture!;
    const decisionId = await createDraft(current.tokens.uploaderA);
    await uploadCsv(
      current.tokens.uploaderA,
      decisionId,
      'MSSV,Họ và tên,Lớp\n00123456,Nguyễn An,22CTT1\n00000002,Sinh viên mới,22CTT2',
    );
    await processCsv(current.tokens.uploaderA, decisionId);

    const preview = await request(app)
      .get(`/api/award-decisions/${decisionId}/roster-preview?page=1&limit=1`)
      .set(auth(current.tokens.uploaderA))
      .expect(200);
    expect(preview.body.data.items[0]).toMatchObject({
      studentCode: '00123456',
      status: 'VALID',
      matchStatus: AwardRecipientMatchStatus.MATCHED,
      institutionWorkspaceId: current.workspaces[0]!.id,
    });
    expect(JSON.stringify(preview.body)).not.toContain('matchedUserId');

    await request(app).post(`/api/award-decisions/${decisionId}/confirm`).set(auth(current.tokens.uploaderA)).expect(200);
    await request(app).post(`/api/award-decisions/${decisionId}/confirm`).set(auth(current.tokens.uploaderA)).expect(409);
    const recipients = await request(app)
      .get(`/api/award-decisions/${decisionId}/recipients`)
      .set(auth(current.tokens.uploaderA))
      .expect(200);
    expect(recipients.body.data.items).toHaveLength(2);
    expect(recipients.body.data.items.map((row: { matchStatus: string }) => row.matchStatus)).toEqual([
      AwardRecipientMatchStatus.MATCHED,
      AwardRecipientMatchStatus.UNMATCHED,
    ]);
    expect(JSON.stringify(recipients.body)).not.toContain('matchedUserId');
    const persisted = await prisma.awardRecipient.findMany({ where: { awardDecisionId: decisionId } });
    expect(persisted).toHaveLength(2);
  });

  it('blocks the whole confirmation for duplicates and leaves the draft and recipients unchanged', async () => {
    const current = fixture!;
    const decisionId = await createDraft(current.tokens.uploaderA);
    await uploadCsv(
      current.tokens.uploaderA,
      decisionId,
      'MSSV,Họ và tên\n00123456,Nguyễn An\n00123456,Nguyễn An',
    );
    await processCsv(current.tokens.uploaderA, decisionId);

    await request(app).post(`/api/award-decisions/${decisionId}/confirm`).set(auth(current.tokens.uploaderA)).expect(409);
    await expect(prisma.awardDecision.findUnique({ where: { id: decisionId } })).resolves.toMatchObject({ status: AwardDecisionStatus.DRAFT });
    await expect(prisma.awardRecipient.count({ where: { awardDecisionId: decisionId } })).resolves.toBe(0);
  });

  it('matches a repeated UDN student code within two different member schools without treating it as a duplicate', async () => {
    const current = fixture!;
    const decisionId = await createDraft(current.tokens.uploaderUdn);
    const schoolA = current.workspaces[0]!;
    const schoolB = current.workspaces[1]!;
    await uploadCsv(
      current.tokens.uploaderUdn,
      decisionId,
      `MSSV,Họ và tên,Trường\n00123456,Nguyễn An,${await workspaceCode(schoolA.id)}\n00123456,Trần Bình,${await workspaceCode(schoolB.id)}`,
    );
    await processCsv(current.tokens.uploaderUdn, decisionId);

    const preview = await request(app)
      .get(`/api/award-decisions/${decisionId}/roster-preview`)
      .set(auth(current.tokens.uploaderUdn))
      .expect(200);
    expect(preview.body.data.validationSummary).toMatchObject({ valid: 2, duplicate: 0, conflict: 0 });
    expect(preview.body.data.items.map((row: { institutionWorkspaceId: string }) => row.institutionWorkspaceId)).toEqual([
      schoolA.id,
      schoolB.id,
    ]);

    await request(app).post(`/api/award-decisions/${decisionId}/confirm`).set(auth(current.tokens.uploaderUdn)).expect(200);
  });

  it('invalidates the old preview after roster replacement and hides internal job results from generic jobs APIs', async () => {
    const current = fixture!;
    const decisionId = await createDraft(current.tokens.uploaderA);
    await uploadCsv(current.tokens.uploaderA, decisionId, 'MSSV,Họ và tên\n00000001,Old roster');
    await processCsv(current.tokens.uploaderA, decisionId);
    const oldJob = await prisma.indexingJob.findFirst({ where: { targetId: decisionId, jobType: JobType.award_roster_ingestion } });

    await uploadCsv(current.tokens.uploaderA, decisionId, 'MSSV,Họ và tên\n00000002,New roster');
    await request(app).get(`/api/award-decisions/${decisionId}/roster-processing`).set(auth(current.tokens.uploaderA)).expect(200).expect((response) => {
      expect(response.body.data).toEqual({ status: 'not_started' });
    });
    await request(app).post(`/api/award-decisions/${decisionId}/confirm`).set(auth(current.tokens.uploaderA)).expect(409);
    await request(app).get(`/api/jobs/${oldJob!.id}`).set(auth(current.tokens.admin)).expect(404);
    await request(app).post(`/api/jobs/${oldJob!.id}/retry`).set(auth(current.tokens.admin)).expect(404);

    await request(app)
      .post(`/api/award-decisions/${decisionId}/process-roster`)
      .set(auth(current.tokens.cityOfficer))
      .expect(403);
  });
});

async function workspaceCode(id: string) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id }, select: { code: true } });
  return workspace.code;
}
