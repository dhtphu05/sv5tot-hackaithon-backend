import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  DecisionImportStatus,
  FileStorageType,
  FinalStatus,
  JobStatus,
  JobType,
  KnowledgeDecision,
  Level,
  MetricType,
  Prisma,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
  RosterPreviewValidationStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import { PasswordService } from '../../src/modules/auth/password.service';

const app = createApp();
const validPassphrase = process.env.SEED_DEFAULT_PASSWORD ?? ['Password', '@123'].join('');
const schoolYear = '2097-2098';
const runId = `ab-${Date.now()}-${randomUUID().slice(0, 8)}`;
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

type TokenBundle = {
  accessToken: string;
  userId: string;
};

type Side = {
  label: 'A' | 'B';
  workspaceId: string;
  workspaceCode: string;
  faculty: string;
  className: string;
  studentCode: string;
  studentEmail: string;
  officerEmail: string;
  managerEmail: string;
  committeeEmail: string;
  studentId: string;
  officerId: string;
  managerId: string;
  committeeId: string;
  studentToken: string;
  officerToken: string;
  managerToken: string;
  committeeToken: string;
  applicationId: string;
  evidenceId: string;
  fileId: string;
  jobId: string;
  eventId: string;
  participantId: string;
  reviewTaskId: string;
  resolutionCaseId: string;
  decisionImportId: string;
  previewRowId: string;
  knowledgeBaseItemId: string;
  criteriaVersionId: string;
  exportFileId: string;
  chatSessionId: string;
  chatbotActionId: string;
};

type Fixture = {
  a: Side;
  b: Side;
  adminEmail: string;
  adminId: string;
  adminToken: string;
  mismatchJobId: string;
  createdFilePaths: string[];
};

let fixture: Fixture | null = null;

async function login(email: string): Promise<TokenBundle> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password: validPassphrase })
    .expect(200);

  expect(response.body.success).toBe(true);
  return {
    accessToken: response.body.data.accessToken,
    userId: response.body.data.user.id,
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function includesValue(value: unknown, needle: string): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.includes(needle);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value) === needle;
  if (Array.isArray(value)) return value.some((item) => includesValue(item, needle));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) =>
      includesValue(item, needle),
    );
  }
  return false;
}

function expectBodyNotToContain(response: Response, ...needles: string[]) {
  for (const needle of needles) {
    expect(includesValue(response.body, needle)).toBe(false);
    if (typeof response.text === 'string') {
      expect(response.text.includes(needle)).toBe(false);
    }
  }
}

function expectBodyToContain(response: Response, needle: string) {
  expect(includesValue(response.body, needle) || response.text.includes(needle)).toBe(true);
}

function expectNotFound(response: Response) {
  expect([403, 404]).toContain(response.status);
  const code = response.body?.error?.code;
  if (response.status === 404 && code) {
    expect(String(code).toUpperCase()).toContain('NOT_FOUND');
  }
}

function expectRejected(response: Response) {
  expect(response.status).toBeGreaterThanOrEqual(400);
}

async function writeUpload(relativePath: string, content: string) {
  const absolutePath = path.join(uploadRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
  return absolutePath;
}

async function seedUser(input: {
  workspaceId: string | null;
  email: string;
  role: Role;
  fullName: string;
  faculty?: string | null;
  className?: string | null;
  studentCode?: string | null;
}) {
  const passwordHash = await new PasswordService().hashPassword(validPassphrase);
  return prisma.user.create({
    data: {
      workspaceId: input.workspaceId,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      faculty: input.faculty,
      className: input.className,
      studentCode: input.studentCode,
      isActive: true,
    },
  });
}

async function seedSide(label: 'A' | 'B', createdFilePaths: string[]): Promise<Side> {
  const lower = label.toLowerCase();
  const workspaceCode = `AB-${label}-${runId}`.toUpperCase();
  const faculty = `Faculty ${label} ${runId}`;
  const className = `Class ${label} ${runId}`;
  const studentCode = `SV${label}${runId.replace(/[^0-9a-z]/gi, '').slice(-12)}`;
  const marker = `workspace-${label}-${runId}`;

  const workspace = await prisma.workspace.create({
    data: {
      code: workspaceCode,
      name: `Workspace ${label} ${runId}`,
      shortName: `W${label}`,
      isActive: true,
      registrationEnabled: true,
    },
  });

  const studentEmail = `workspace-${lower}-student-${runId}@example.test`;
  const officerEmail = `workspace-${lower}-officer-${runId}@example.test`;
  const managerEmail = `workspace-${lower}-manager-${runId}@example.test`;
  const committeeEmail = `workspace-${lower}-committee-${runId}@example.test`;

  const student = await seedUser({
    workspaceId: workspace.id,
    email: studentEmail,
    role: Role.student,
    fullName: `Student ${label} ${runId}`,
    faculty,
    className,
    studentCode,
  });
  const officer = await seedUser({
    workspaceId: workspace.id,
    email: officerEmail,
    role: Role.officer,
    fullName: `Officer ${label} ${runId}`,
    faculty,
  });
  const manager = await seedUser({
    workspaceId: workspace.id,
    email: managerEmail,
    role: Role.manager,
    fullName: `Manager ${label} ${runId}`,
    faculty,
  });
  const committee = await seedUser({
    workspaceId: workspace.id,
    email: committeeEmail,
    role: Role.committee,
    fullName: `Committee ${label} ${runId}`,
    faculty,
  });

  await prisma.officerSpecialization.create({
    data: {
      officerId: officer.id,
      criterion: Criterion.ethics,
      facultyScope: faculty,
      isActive: true,
    },
  });

  const criteriaVersion = await prisma.criteriaVersion.create({
    data: {
      workspaceId: workspace.id,
      schoolYear,
      unitScope: 'DHBK-DHDN',
      level: Level.school,
      versionName: `Criteria ${label} ${runId}`,
      isActive: true,
      rules: {
        create: [
          {
            criterion: Criterion.ethics,
            ruleKey: `ethics-note-${label}-${runId}`,
            ruleType: 'human_review_note',
            thresholdJson: Prisma.JsonNull,
            evidenceRequirementsJson: Prisma.JsonNull,
            humanReadableText: `Criteria marker ${marker}`,
          },
        ],
      },
    },
  });

  const application = await prisma.application.create({
    data: {
      workspaceId: workspace.id,
      studentId: student.id,
      schoolYear,
      applicationType: ApplicationType.individual,
      targetLevel: Level.school,
      status: ApplicationStatus.under_review,
      readinessScore: 88,
      submittedAt: new Date(),
      finalStatus: FinalStatus.pending,
    },
  });

  await prisma.applicationMetric.create({
    data: {
      applicationId: application.id,
      metricType: MetricType.gpa,
      value: label === 'A' ? 3.6 : 3.7,
      scale: 4,
    },
  });

  const evidence = await prisma.evidence.create({
    data: {
      applicationId: application.id,
      evidenceName: `Evidence ${label} ${runId}`,
      criterion: Criterion.ethics,
      sourceType: 'manual_upload',
      status: 'indexed',
      indexingStatus: 'indexed',
      assignedOfficerId: officer.id,
      confidence: 0.91,
    },
  });

  const filePath = `workspace-isolation/${runId}/${label}-evidence.txt`;
  createdFilePaths.push(await writeUpload(filePath, `Evidence file ${marker}`));
  const file = await prisma.file.create({
    data: {
      workspaceId: workspace.id,
      ownerId: student.id,
      uploadedBy: student.id,
      storageType: FileStorageType.local,
      filePath,
      publicUrl: `/api/files/download?fixture=${label}`,
      originalName: `${label}-evidence.txt`,
      mimeType: 'text/plain',
      fileSize: 32,
    },
  });

  await prisma.evidenceFile.create({
    data: {
      evidenceId: evidence.id,
      fileId: file.id,
      fileRole: 'primary',
    },
  });

  await prisma.evidenceCard.create({
    data: {
      evidenceId: evidence.id,
      ocrText: `OCR text ${marker}`,
      normalizedFieldsJson: { marker },
      warningsJson: [],
      confidence: 0.9,
      aiSummary: `Summary ${marker}`,
    },
  });

  const job = await prisma.indexingJob.create({
    data: {
      workspaceId: workspace.id,
      jobType: JobType.evidence_ocr,
      targetId: evidence.id,
      status: JobStatus.failed,
      attempts: 1,
      errorMessage: `Fixture failed job ${marker}`,
      resultJson: { marker },
    },
  });

  const event = await prisma.eventRegistry.create({
    data: {
      workspaceId: workspace.id,
      eventName: `Event ${label} ${runId}`,
      criterion: Criterion.ethics,
      organizer: `Organizer ${label}`,
      organizerLevel: Level.school,
      convertedValue: 1,
      convertedUnit: 'event',
      eligibleLevelsJson: [Level.school],
      participantCount: 1,
      rosterIndexed: true,
      status: 'active',
      createdBy: officer.id,
    },
  });

  const participant = await prisma.eventParticipant.create({
    data: {
      eventId: event.id,
      studentCode,
      studentName: student.fullName,
      className,
      faculty,
      participationStatus: 'confirmed',
      convertedValue: 1,
    },
  });

  const reviewTask = await prisma.reviewTask.create({
    data: {
      workspaceId: workspace.id,
      applicationId: application.id,
      criterion: Criterion.ethics,
      assignedOfficerId: officer.id,
      status: ReviewTaskStatus.reviewing,
    },
  });

  await prisma.reviewTaskEvidence.create({
    data: {
      reviewTaskId: reviewTask.id,
      evidenceId: evidence.id,
    },
  });

  const resolutionCase = await prisma.resolutionCase.create({
    data: {
      workspaceId: workspace.id,
      applicationId: application.id,
      evidenceId: evidence.id,
      reviewTaskId: reviewTask.id,
      reason: `Resolution ${marker}`,
      status: 'open',
      createdBy: officer.id,
    },
  });

  const decisionImport = await prisma.decisionImport.create({
    data: {
      workspaceId: workspace.id,
      title: `Decision Import ${label} ${runId}`,
      criterion: Criterion.ethics,
      eventName: `Decision Event ${label} ${runId}`,
      organizer: `Decision Organizer ${label}`,
      organizerLevel: Level.school,
      convertedValue: 1,
      convertedUnit: 'event',
      eligibleLevelsJson: [Level.school],
      status: DecisionImportStatus.preview_ready,
      createdBy: manager.id,
    },
  });

  const previewRow = await prisma.decisionRosterPreviewRow.create({
    data: {
      decisionImportId: decisionImport.id,
      studentCode,
      studentName: student.fullName,
      className,
      faculty,
      criterion: Criterion.ethics,
      convertedValue: 1,
      convertedUnit: 'event',
      participationStatus: 'confirmed',
      validationStatus: RosterPreviewValidationStatus.valid,
      validationWarningsJson: [],
      rawRowJson: { marker },
    },
  });

  const knowledgeBaseItem = await prisma.knowledgeBaseItem.create({
    data: {
      workspaceId: workspace.id,
      evidenceName: `KB Evidence ${label} ${runId}`,
      eventName: `KB Event ${label} ${runId}`,
      criterion: Criterion.ethics,
      level: Level.school,
      decision: KnowledgeDecision.accepted,
      reason: `KB ${marker}`,
      requiredFieldsJson: ['studentCode'],
      commonErrorsJson: [],
      createdBy: manager.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorId: manager.id,
      actorRole: Role.manager,
      action: `AUDIT_${label}_${runId}`,
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      afterStateJson: { marker },
    },
  });

  const exportPath = `exports/${runId}-${label}.csv`;
  createdFilePaths.push(await writeUpload(exportPath, `applicationId\n${application.id}\n`));
  const exportFile = await prisma.file.create({
    data: {
      workspaceId: workspace.id,
      ownerId: manager.id,
      uploadedBy: manager.id,
      storageType: FileStorageType.local,
      filePath: exportPath,
      originalName: `${label}-export.csv`,
      mimeType: 'text/csv',
      fileSize: 64,
    },
  });

  const chatSession = await prisma.chatSession.create({
    data: {
      workspaceId: workspace.id,
      userId: student.id,
      role: Role.student,
      applicationId: application.id,
      provider: 'mock',
      contextScope: 'student_helpdesk',
      status: 'active',
    },
  });

  const chatbotAction = await prisma.chatbotAction.create({
    data: {
      workspaceId: workspace.id,
      sessionId: chatSession.id,
      userId: student.id,
      actionType: 'navigate',
      label: `Open ${label}`,
      route: `/app/my-application?id=${application.id}`,
      requiredRole: Role.student,
      requiresConfirmation: false,
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const studentLogin = await login(studentEmail);
  const officerLogin = await login(officerEmail);
  const managerLogin = await login(managerEmail);
  const committeeLogin = await login(committeeEmail);

  return {
    label,
    workspaceId: workspace.id,
    workspaceCode,
    faculty,
    className,
    studentCode,
    studentEmail,
    officerEmail,
    managerEmail,
    committeeEmail,
    studentId: student.id,
    officerId: officer.id,
    managerId: manager.id,
    committeeId: committee.id,
    studentToken: studentLogin.accessToken,
    officerToken: officerLogin.accessToken,
    managerToken: managerLogin.accessToken,
    committeeToken: committeeLogin.accessToken,
    applicationId: application.id,
    evidenceId: evidence.id,
    fileId: file.id,
    jobId: job.id,
    eventId: event.id,
    participantId: participant.id,
    reviewTaskId: reviewTask.id,
    resolutionCaseId: resolutionCase.id,
    decisionImportId: decisionImport.id,
    previewRowId: previewRow.id,
    knowledgeBaseItemId: knowledgeBaseItem.id,
    criteriaVersionId: criteriaVersion.id,
    exportFileId: exportFile.id,
    chatSessionId: chatSession.id,
    chatbotActionId: chatbotAction.id,
  };
}

async function seedFixture(): Promise<Fixture> {
  const createdFilePaths: string[] = [];
  const a = await seedSide('A', createdFilePaths);
  const b = await seedSide('B', createdFilePaths);

  const adminEmail = `workspace-admin-${runId}@example.test`;
  const admin = await seedUser({
    workspaceId: null,
    email: adminEmail,
    role: Role.admin,
    fullName: `Admin ${runId}`,
  });

  const mismatchJob = await prisma.indexingJob.create({
    data: {
      workspaceId: a.workspaceId,
      jobType: JobType.evidence_ocr,
      targetId: b.evidenceId,
      status: JobStatus.failed,
      attempts: 1,
      errorMessage: `Workspace mismatch ${runId}`,
      resultJson: { workspaceId: a.workspaceId, targetWorkspaceId: b.workspaceId },
    },
  });

  const adminLogin = await login(adminEmail);
  return {
    a,
    b,
    adminEmail,
    adminId: admin.id,
    adminToken: adminLogin.accessToken,
    mismatchJobId: mismatchJob.id,
    createdFilePaths,
  };
}

async function cleanupFixture(current: Fixture | null) {
  if (!current) return;
  const workspaceIds = [current.a.workspaceId, current.b.workspaceId];
  const userIds = [
    current.a.studentId,
    current.a.officerId,
    current.a.managerId,
    current.a.committeeId,
    current.b.studentId,
    current.b.officerId,
    current.b.managerId,
    current.b.committeeId,
    current.adminId,
  ];
  const applicationIds = [current.a.applicationId, current.b.applicationId];
  const evidenceIds = [current.a.evidenceId, current.b.evidenceId];
  const fileIds = [
    current.a.fileId,
    current.a.exportFileId,
    current.b.fileId,
    current.b.exportFileId,
  ];
  const eventIds = [current.a.eventId, current.b.eventId];
  const decisionImportIds = [current.a.decisionImportId, current.b.decisionImportId];
  const reviewTaskIds = [current.a.reviewTaskId, current.b.reviewTaskId];
  const criteriaVersionIds = [current.a.criteriaVersionId, current.b.criteriaVersionId];
  const chatSessionIds = [current.a.chatSessionId, current.b.chatSessionId];

  await prisma.$transaction([
    prisma.chatbotAction.deleteMany({ where: { sessionId: { in: chatSessionIds } } }),
    prisma.chatbotHandoff.deleteMany({ where: { sessionId: { in: chatSessionIds } } }),
    prisma.chatMessage.deleteMany({ where: { sessionId: { in: chatSessionIds } } }),
    prisma.chatSession.deleteMany({ where: { id: { in: chatSessionIds } } }),
    prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.resolutionCase.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.reviewTaskEvidence.deleteMany({ where: { reviewTaskId: { in: reviewTaskIds } } }),
    prisma.reviewTask.deleteMany({ where: { id: { in: reviewTaskIds } } }),
    prisma.precheckResult.deleteMany({ where: { applicationId: { in: applicationIds } } }),
    prisma.cascadeReview.deleteMany({ where: { applicationId: { in: applicationIds } } }),
    prisma.applicationMetric.deleteMany({ where: { applicationId: { in: applicationIds } } }),
    prisma.evidenceCard.deleteMany({ where: { evidenceId: { in: evidenceIds } } }),
    prisma.evidenceFile.deleteMany({ where: { evidenceId: { in: evidenceIds } } }),
    prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.eventFile.deleteMany({ where: { eventId: { in: eventIds } } }),
    prisma.decisionRosterPreviewRow.deleteMany({
      where: { decisionImportId: { in: decisionImportIds } },
    }),
    prisma.decisionTable.deleteMany({ where: { decisionImportId: { in: decisionImportIds } } }),
    prisma.decisionDocument.deleteMany({ where: { decisionImportId: { in: decisionImportIds } } }),
    prisma.indexingJob.deleteMany({
      where: { id: { in: [current.a.jobId, current.b.jobId, current.mismatchJobId] } },
    }),
    prisma.smartReaderJob.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.evidence.deleteMany({ where: { id: { in: evidenceIds } } }),
    prisma.eventRegistry.deleteMany({ where: { id: { in: eventIds } } }),
    prisma.decisionImport.deleteMany({ where: { id: { in: decisionImportIds } } }),
    prisma.knowledgeBaseItem.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
    prisma.criteriaRule.deleteMany({ where: { criteriaVersionId: { in: criteriaVersionIds } } }),
    prisma.criteriaVersion.deleteMany({ where: { id: { in: criteriaVersionIds } } }),
    prisma.application.deleteMany({ where: { id: { in: applicationIds } } }),
    prisma.file.deleteMany({ where: { id: { in: fileIds } } }),
    prisma.officerSpecialization.deleteMany({ where: { officerId: { in: userIds } } }),
    prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } }),
  ]);

  await Promise.all(
    current.createdFilePaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)),
  );
}

describe('workspace A/B HTTP isolation flow', () => {
  beforeAll(async () => {
    fixture = await seedFixture();
  }, 120_000);

  afterAll(async () => {
    await cleanupFixture(fixture);
  }, 120_000);

  it('isolates application and manager views across workspaces', async () => {
    const { a, b } = fixture!;

    expectNotFound(
      await request(app)
        .get(`/api/applications/${b.applicationId}/timeline`)
        .set(auth(a.studentToken)),
    );

    expectNotFound(
      await request(app)
        .patch(`/api/applications/${b.applicationId}/draft`)
        .set(auth(a.studentToken))
        .send({ notes: 'cross workspace update attempt' }),
    );

    expectNotFound(
      await request(app)
        .get(`/api/manager/applications/${b.applicationId}/summary`)
        .set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app)
        .get(`/api/manager/results/${b.applicationId}`)
        .set(auth(a.managerToken)),
    );

    const list = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, limit: 100 })
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyToContain(list, a.applicationId);
    expectBodyNotToContain(list, b.applicationId, b.studentCode);

    const dashboard = await request(app)
      .get('/api/manager/dashboard-summary')
      .set(auth(a.managerToken))
      .expect(200);
    expect(dashboard.body.data.applicationOverview.totalApplications).toBe(
      await prisma.application.count({ where: { workspaceId: a.workspaceId } }),
    );
    expect(dashboard.body.data.reviewTaskSummary.total).toBe(
      await prisma.reviewTask.count({ where: { workspaceId: a.workspaceId } }),
    );
    expectBodyNotToContain(dashboard, b.applicationId, b.officerId, b.studentCode);

    const workload = await request(app)
      .get('/api/manager/workloads')
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyNotToContain(workload, b.officerId, b.officerEmail, b.reviewTaskId);

    const inbox = await request(app)
      .get('/api/manager/committee-inbox')
      .query({ limit: 100 })
      .set(auth(a.committeeToken))
      .expect(200);
    expectBodyNotToContain(inbox, b.applicationId, b.resolutionCaseId, b.studentCode);
  });

  it('isolates evidence and file access across workspaces', async () => {
    const { a, b } = fixture!;

    expectNotFound(
      await request(app)
        .get(`/api/applications/${b.applicationId}/evidences`)
        .set(auth(a.studentToken)),
    );

    expectNotFound(
      await request(app).get(`/api/evidences/${b.evidenceId}`).set(auth(a.studentToken)),
    );

    expectNotFound(
      await request(app).get(`/api/evidences/${b.evidenceId}`).set(auth(a.officerToken)),
    );

    expectNotFound(
      await request(app).get(`/api/evidences/${b.evidenceId}/card`).set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app).get(`/api/files/${b.fileId}`).set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app).get(`/api/files/${b.fileId}/signed-url`).set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app)
        .patch(`/api/evidences/${b.evidenceId}`)
        .set(auth(a.studentToken))
        .send({ evidenceName: 'Cross workspace edit' }),
    );

    expectNotFound(
      await request(app).delete(`/api/evidences/${b.evidenceId}`).set(auth(a.studentToken)),
    );
  });

  it('isolates review and resolution flows across workspaces', async () => {
    const { a, b } = fixture!;

    const queue = await request(app)
      .get('/api/review/tasks')
      .query({ assignedToMe: true, limit: 100 })
      .set(auth(a.officerToken))
      .expect(200);
    expectBodyToContain(queue, a.reviewTaskId);
    expectBodyNotToContain(queue, b.reviewTaskId, b.applicationId);

    expectNotFound(
      await request(app).get(`/api/review/tasks/${b.reviewTaskId}`).set(auth(a.officerToken)),
    );

    expectNotFound(
      await request(app)
        .post(`/api/review/tasks/${b.reviewTaskId}/decision`)
        .set(auth(a.officerToken))
        .send({
          decision: ReviewDecision.accepted,
          officerNote: 'cross workspace decision attempt',
        }),
    );

    const assignResponse = await request(app)
      .post(`/api/manager/review-tasks/${a.reviewTaskId}/assign`)
      .set(auth(a.managerToken))
      .send({ assignedOfficerId: b.officerId, overrideSpecialization: true });
    expectRejected(assignResponse);
    const taskAfterAssign = await prisma.reviewTask.findUniqueOrThrow({
      where: { id: a.reviewTaskId },
      select: { assignedOfficerId: true },
    });
    expect(taskAfterAssign.assignedOfficerId).not.toBe(b.officerId);

    expectNotFound(
      await request(app)
        .get(`/api/resolution/cases/${b.resolutionCaseId}`)
        .set(auth(a.committeeToken)),
    );

    expectNotFound(
      await request(app)
        .post(`/api/resolution/cases/${b.resolutionCaseId}/decision`)
        .set(auth(a.committeeToken))
        .send({ decision: 'accepted', note: 'cross workspace decision attempt' }),
    );
  });

  it('isolates event registry and decision imports across workspaces', async () => {
    const { a, b } = fixture!;

    const events = await request(app)
      .get('/api/events')
      .query({ limit: 100 })
      .set(auth(a.studentToken))
      .expect(200);
    expectBodyToContain(events, a.eventId);
    expectBodyNotToContain(events, b.eventId, b.studentCode);

    expectNotFound(
      await request(app).get(`/api/events/${b.eventId}`).set(auth(a.studentToken)),
    );

    expectNotFound(
      await request(app)
        .post(`/api/events/${b.eventId}/check-participant`)
        .set(auth(a.studentToken))
        .send({ applicationId: a.applicationId }),
    );

    expectRejected(
      await request(app)
        .post(`/api/events/${b.eventId}/import-as-evidence`)
        .set(auth(a.studentToken))
        .send({ applicationId: a.applicationId, evidenceName: 'Cross workspace event evidence' }),
    );

    expectNotFound(
      await request(app)
        .patch(`/api/events/${b.eventId}`)
        .set(auth(a.managerToken))
        .send({ organizer: 'Cross Workspace Organizer' }),
    );

    const imports = await request(app)
      .get('/api/decision-imports')
      .query({ limit: 100 })
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyNotToContain(imports, b.decisionImportId, b.previewRowId);

    expectNotFound(
      await request(app)
        .get(`/api/decision-imports/${b.decisionImportId}`)
        .set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app)
        .get(`/api/decision-imports/${b.decisionImportId}/preview`)
        .set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app)
        .post(`/api/decision-imports/${b.decisionImportId}/confirm`)
        .set(auth(a.managerToken))
        .send({ includeWarningRows: true, includeInvalidRows: true }),
    );
  });

  it('isolates knowledge base, evidence matching and criteria selection across workspaces', async () => {
    const { a, b } = fixture!;

    const kbSearch = await request(app)
      .get('/api/knowledge-base/search')
      .query({ q: `KB Event B ${runId}`, criterion: Criterion.ethics, limit: 20 })
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyNotToContain(kbSearch, b.knowledgeBaseItemId, `KB Event B ${runId}`);

    const matching = await request(app)
      .get('/api/evidence-matching/search')
      .query({
        q: `Event B ${runId}`,
        criterion: Criterion.ethics,
        applicationId: a.applicationId,
        limit: 20,
      })
      .set(auth(a.studentToken))
      .expect(200);
    expectBodyNotToContain(matching, b.eventId, b.participantId, b.knowledgeBaseItemId);

    await request(app)
      .post(`/api/applications/${a.applicationId}/precheck`)
      .set(auth(a.studentToken))
      .send({ level: Level.school, runMode: 'sync' })
      .expect(201);
    const latestPrecheck = await prisma.precheckResult.findFirstOrThrow({
      where: { applicationId: a.applicationId },
      orderBy: { createdAt: 'desc' },
    });
    expect(includesValue(latestPrecheck.resultJson, a.criteriaVersionId)).toBe(true);
    expect(includesValue(latestPrecheck.resultJson, b.criteriaVersionId)).toBe(false);

    const cascade = await request(app)
      .post(`/api/applications/${a.applicationId}/cascade-review`)
      .set(auth(a.studentToken))
      .send({ includeUpgradeHints: false })
      .expect(201);
    expectBodyNotToContain(cascade, b.criteriaVersionId, `Criteria marker workspace-B-${runId}`);

    await prisma.criteriaVersion.update({
      where: { id: a.criteriaVersionId },
      data: { isActive: false },
    });
    await request(app)
      .post(`/api/applications/${a.applicationId}/precheck`)
      .set(auth(a.studentToken))
      .send({ level: Level.school, runMode: 'sync' })
      .expect(201);
    const fallbackPrecheck = await prisma.precheckResult.findFirstOrThrow({
      where: { applicationId: a.applicationId },
      orderBy: { createdAt: 'desc' },
    });
    expect(includesValue(fallbackPrecheck.resultJson, b.criteriaVersionId)).toBe(false);
    expect(includesValue(fallbackPrecheck.resultJson, `Criteria marker workspace-B-${runId}`)).toBe(
      false,
    );
  });

  it('isolates jobs and rejects workspace/target mismatch jobs', async () => {
    const { a, b, mismatchJobId } = fixture!;

    expectNotFound(
      await request(app).get(`/api/jobs/${b.jobId}`).set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app).post(`/api/jobs/${b.jobId}/retry`).set(auth(a.officerToken)),
    );

    expectNotFound(
      await request(app).get(`/api/jobs/${mismatchJobId}`).set(auth(a.managerToken)),
    );

    expectNotFound(
      await request(app).post(`/api/jobs/${mismatchJobId}/retry`).set(auth(a.managerToken)),
    );

    const retryOwn = await request(app)
      .post(`/api/jobs/${a.jobId}/retry`)
      .set(auth(a.managerToken))
      .expect(200);
    expect(retryOwn.body.data.id).toBe(a.jobId);
    const retried = await prisma.indexingJob.findUniqueOrThrow({ where: { id: a.jobId } });
    expect(retried.workspaceId).toBe(a.workspaceId);
  });

  it('isolates audit, chatbot actions and exports across workspaces', async () => {
    const { a, b } = fixture!;

    const audit = await request(app)
      .get('/api/audit/logs')
      .query({ targetId: b.applicationId, limit: 100 })
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyNotToContain(audit, b.applicationId, `AUDIT_B_${runId}`);

    expectNotFound(
      await request(app)
        .post(`/api/chatbot/actions/${b.chatbotActionId}/execute`)
        .set(auth(a.studentToken)),
    );

    expectNotFound(
      await request(app)
        .post('/api/chatbot/message')
        .set(auth(a.studentToken))
        .send({
          text: 'Cho toi xem ho so nay',
          applicationId: b.applicationId,
          contextScope: 'student_helpdesk',
        }),
    );

    const smartbotNoContext = await request(app)
      .post('/api/smartbot/tools/application-status')
      .set('Authorization', 'Bearer test-smartbot-webhook-token')
      .send({ applicationId: b.applicationId })
      .expect(200);
    expectBodyNotToContain(smartbotNoContext, b.applicationId, b.studentCode);

    const appJson = await request(app)
      .get('/api/exports/applications.json')
      .query({ schoolYear })
      .set(auth(a.managerToken))
      .expect(200);
    expectBodyToContain(appJson, a.applicationId);
    expectBodyNotToContain(appJson, b.applicationId, b.studentCode);

    const tasksCsv = await request(app)
      .get('/api/exports/review-tasks.csv')
      .query({ schoolYear })
      .set(auth(a.managerToken))
      .expect(200);
    expect(tasksCsv.text).toContain(a.reviewTaskId);
    expect(tasksCsv.text).not.toContain(b.reviewTaskId);
    expect(tasksCsv.text).not.toContain(b.applicationId);

    expectNotFound(
      await request(app)
        .get(`/api/exports/${b.exportFileId}/download`)
        .set(auth(a.managerToken)),
    );
  });

  it('preserves explicit global admin access without granting global access to workspace roles', async () => {
    const { a, b, adminToken } = fixture!;

    const adminSummary = await request(app)
      .get(`/api/manager/applications/${b.applicationId}/summary`)
      .set(auth(adminToken))
      .expect(200);
    expectBodyToContain(adminSummary, b.applicationId);

    const adminFile = await request(app)
      .get(`/api/files/${b.fileId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(adminFile.body.data.id).toBe(b.fileId);

    const adminJob = await request(app)
      .get(`/api/jobs/${b.jobId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(adminJob.body.data.id).toBe(b.jobId);

    const managerAOnB = await request(app)
      .get(`/api/manager/applications/${b.applicationId}/summary`)
      .set(auth(a.managerToken));
    expectNotFound(managerAOnB);
  });
});
