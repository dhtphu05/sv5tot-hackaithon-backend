import {
  ApplicationStatus,
  ApplicationType,
  AwardDecisionStatus,
  AwardLevel,
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
  WorkspaceType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import { PasswordService } from '../../src/modules/auth/password.service';
import { TokenService } from '../../src/modules/auth/token.service';

const app = createApp();
const tokenService = new TokenService();
const validPassphrase = process.env.SEED_DEFAULT_PASSWORD ?? ['Password', '@123'].join('');
const schoolYear = '2097-2098';
const runId = process.env.E2E_P3B_RUN_PREFIX ?? `ab-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
  cityWorkspaceId: string;
  cityManagerId: string;
  cityManagerToken: string;
  cityOfficerId: string;
  adminEmail: string;
  adminId: string;
  adminToken: string;
  mismatchJobId: string;
  createdFilePaths: string[];
  createdUploadFileIds: string[];
  createdUploadJobIds: string[];
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

async function seedSide(
  label: 'A' | 'B',
  createdFilePaths: string[],
  cityWorkspaceId: string,
): Promise<Side> {
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
      type: WorkspaceType.SCHOOL,
      parentWorkspaceId: cityWorkspaceId,
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
  const cityWorkspace = await prisma.workspace.create({
    data: {
      code: `AB-CITY-${runId}`.toUpperCase(),
      name: `City Workspace ${runId}`,
      shortName: 'AB City',
      type: WorkspaceType.CITY,
      isActive: true,
    },
  });
  const a = await seedSide('A', createdFilePaths, cityWorkspace.id);
  const b = await seedSide('B', createdFilePaths, cityWorkspace.id);

  const cityManager = await seedUser({
    workspaceId: cityWorkspace.id,
    email: `workspace-city-manager-${runId}@example.test`,
    role: Role.city_manager,
    fullName: `City Manager ${runId}`,
  });
  const cityOfficer = await seedUser({
    workspaceId: cityWorkspace.id,
    email: `workspace-city-officer-${runId}@example.test`,
    role: Role.city_officer,
    fullName: `City Officer ${runId}`,
  });
  await prisma.officerSpecialization.create({
    data: {
      officerId: cityOfficer.id,
      criterion: Criterion.academic,
      facultyScope: a.faculty,
      isActive: true,
    },
  });

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
  const cityManagerLogin = await login(cityManager.email);
  return {
    a,
    b,
    cityWorkspaceId: cityWorkspace.id,
    cityManagerId: cityManager.id,
    cityManagerToken: cityManagerLogin.accessToken,
    cityOfficerId: cityOfficer.id,
    adminEmail,
    adminId: admin.id,
    adminToken: adminLogin.accessToken,
    mismatchJobId: mismatchJob.id,
    createdFilePaths,
    createdUploadFileIds: [],
    createdUploadJobIds: [],
  };
}

async function cleanupFixture(current: Fixture | null) {
  if (!current) return;
  const workspaceIds = [current.a.workspaceId, current.b.workspaceId, current.cityWorkspaceId];
  const userIds = [
    current.a.studentId,
    current.a.officerId,
    current.a.managerId,
    current.a.committeeId,
    current.b.studentId,
    current.b.officerId,
    current.b.managerId,
    current.b.committeeId,
    current.cityManagerId,
    current.cityOfficerId,
    current.adminId,
  ];
  const applicationIds = [current.a.applicationId, current.b.applicationId];
  const evidenceIds = [current.a.evidenceId, current.b.evidenceId];
  const fileIds = [
    current.a.fileId,
    current.a.exportFileId,
    current.b.fileId,
    current.b.exportFileId,
    ...current.createdUploadFileIds,
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
    prisma.reviewTask.deleteMany({
      where: { OR: [{ id: { in: reviewTaskIds } }, { applicationId: { in: applicationIds } }] },
    }),
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
      where: {
        OR: [
          {
            id: {
              in: [current.a.jobId, current.b.jobId, current.mismatchJobId, ...current.createdUploadJobIds],
            },
          },
          { workspaceId: { in: workspaceIds } },
        ],
      },
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

  it('enforces the City submission season and application-scoped deadline exceptions', async () => {
    const current = fixture!;
    const now = new Date();
    const startYear = 1900 + (Date.now() % 90);
    const seasonYear = process.env.E2E_P3B_SCHOOL_YEAR ?? `${startYear}-${startYear + 1}`;
    const workspace = await prisma.workspace.create({
      data: {
        code: `CITY-SEASON-${runId}`.toUpperCase(),
        name: `City Season School ${runId}`,
        shortName: 'CSS',
        type: WorkspaceType.SCHOOL,
        isActive: true,
        registrationEnabled: true,
      },
    });
    const users: Array<{ id: string; email: string; token: string }> = [];
    const applicationIds: string[] = [];
    const extraWorkspaceIds: string[] = [];
    const awardDecisionIds: string[] = [];
    let seasonId: string | undefined;
    let scenarioFailed = false;
    let scenarioError: unknown;

    try {
      for (const label of ['A', 'B', 'C', 'D', 'E']) {
        const email = `city-season-${label.toLowerCase()}-${runId}@example.test`;
        const user = await seedUser({
          workspaceId: workspace.id,
          email,
          role: Role.student,
          fullName: `Season Student ${label} ${runId}`,
          studentCode: `${label}${runId.replace(/[^0-9a-z]/gi, '').slice(-12)}`,
          className: 'Season Class',
        });
        users.push({ ...user, token: '' });
        users[users.length - 1].token = tokenService.createAccessToken(user.id);
        const application = await prisma.application.create({
          data: {
            workspaceId: workspace.id,
            studentId: user.id,
            schoolYear: seasonYear,
            applicationType: ApplicationType.individual,
            targetLevel: Level.city,
            status: ApplicationStatus.draft,
            finalStatus: FinalStatus.pending,
          },
        });
        applicationIds.push(application.id);
      }

      const createSeason = await request(app)
        .post('/api/manager/city-review-seasons')
        .set(auth(current.cityManagerToken))
        .send({
          schoolYear: seasonYear,
          submissionOpensAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          submissionClosesAt: new Date(now.getTime() + 6 * 60_000).toISOString(),
          reviewDeadlineAt: null,
          supplementDeadlineAt: null,
          finalizationDeadlineAt: null,
          reason: 'Integration test season setup',
        })
        .expect(201);
      seasonId = createSeason.body.data.id as string;

      const cityOfficerToken = tokenService.createAccessToken(current.cityOfficerId);
      const cityCommitteeEmail = `city-season-committee-${runId}@example.test`;
      const cityCommittee = await seedUser({
        workspaceId: current.cityWorkspaceId,
        email: cityCommitteeEmail,
        role: Role.city_committee,
        fullName: `City Season Committee ${runId}`,
      });
      users.push({ ...cityCommittee, token: '' });
      users[users.length - 1].token = tokenService.createAccessToken(cityCommittee.id);
      const uploaderEmail = `city-season-uploader-${runId}@example.test`;
      const uploader = await seedUser({
        workspaceId: workspace.id,
        email: uploaderEmail,
        role: Role.data_uploader,
        fullName: `City Season Uploader ${runId}`,
      });
      users.push({ ...uploader, token: '' });
      users[users.length - 1].token = tokenService.createAccessToken(uploader.id);

      const managerDeniedRoles = [
        ['city_officer', cityOfficerToken],
        ['city_committee', users[5].token],
        ['data_uploader', users[6].token],
        ['legacy manager', current.a.managerToken],
        ['legacy committee', current.a.committeeToken],
        ['student', users[0].token],
      ] as const;
      for (const [, token] of managerDeniedRoles) {
        await request(app)
          .get(`/api/manager/city-review-seasons/${seasonYear}`)
          .set(auth(token))
          .expect(403);
        await request(app)
          .get(`/api/manager/applications/${applicationIds[2]}/submission-deadline`)
          .set(auth(token))
          .expect(403);
      }

      await request(app)
        .get(`/api/manager/city-review-seasons/${seasonYear}`)
        .set(auth(current.adminToken))
        .expect(200);
      await request(app)
        .get(`/api/manager/city-review-seasons/${seasonYear}`)
        .set(auth(current.cityManagerToken))
        .expect(200);
      await request(app)
        .get(`/api/manager/city-review-seasons/${seasonYear}`)
        .set(auth(current.a.managerToken))
        .expect(403);
      await request(app)
        .get(`/api/applications/${applicationIds[1]}/submission-deadline`)
        .set(auth(users[0].token))
        .expect(404);
      await request(app)
        .get(`/api/manager/applications/${applicationIds[2]}/submission-deadline`)
        .set(auth(current.adminToken))
        .expect(200);

      const beforeOpen = await request(app)
        .get(`/api/applications/${applicationIds[0]}/submission-deadline`)
        .set(auth(users[0].token))
        .expect(200);
      expect(beforeOpen.body.data.submission.status).toBe('NOT_OPEN');
      const applicationBeforeClosedSubmit = await prisma.application.findUniqueOrThrow({
        where: { id: applicationIds[0] },
        select: { status: true, submittedAt: true, updatedAt: true, readinessScore: true },
      });
      const blockedBeforeOpen = await request(app)
        .post(`/api/applications/${applicationIds[0]}/submit`)
        .set(auth(users[0].token))
        .send({ allowSubmitWithWarnings: true })
        .expect(409);
      expect(blockedBeforeOpen.body.error.code).toBe('CITY_SUBMISSION_NOT_OPEN');
      await expect(
        prisma.application.findUniqueOrThrow({
          where: { id: applicationIds[0] },
          select: { status: true, submittedAt: true, updatedAt: true, readinessScore: true },
        }),
      ).resolves.toEqual(applicationBeforeClosedSubmit);
      await expect(prisma.reviewTask.count({ where: { applicationId: applicationIds[0] } })).resolves.toBe(0);
      await expect(prisma.notification.count({ where: { applicationId: applicationIds[0] } })).resolves.toBe(0);
      await expect(prisma.precheckResult.count({ where: { applicationId: applicationIds[0] } })).resolves.toBe(0);
      await expect(prisma.emailOutbox.count({ where: { applicationId: applicationIds[0] } })).resolves.toBe(0);
      await expect(
        prisma.auditLog.count({
          where: {
            applicationId: applicationIds[0],
            action: { in: ['PRECHECK_COMPLETED', 'APPLICATION_READINESS_UPDATED', 'REVIEW_TASK_CREATED', 'APPLICATION_SUBMITTED'] },
          },
        }),
      ).resolves.toBe(0);

      const openAt = new Date(now.getTime() - 60_000).toISOString();
      const closeAt = new Date(now.getTime() + 60_000).toISOString();
      await request(app)
        .patch(`/api/manager/city-review-seasons/${seasonYear}`)
        .set(auth(current.cityManagerToken))
        .send({
          submissionOpensAt: openAt,
          submissionClosesAt: closeAt,
          reviewDeadlineAt: null,
          supplementDeadlineAt: null,
          finalizationDeadlineAt: null,
          expectedVersion: 1,
          reason: 'Open integration test window',
        })
        .expect(200);
      const open = await request(app)
        .get(`/api/applications/${applicationIds[0]}/submission-deadline`)
        .set(auth(users[0].token))
        .expect(200);
      expect(open.body.data.submission.status).toBe('OPEN');
      const submittedInsideWindow = await request(app)
        .post(`/api/applications/${applicationIds[0]}/submit`)
        .set(auth(users[0].token))
        .send({ allowSubmitWithWarnings: true })
        .expect(200);
      expect(submittedInsideWindow.body.data.application.status).toBe(ApplicationStatus.under_review);
      await expect(
        prisma.reviewTask.count({ where: { applicationId: applicationIds[0] } }),
      ).resolves.toBe(5);

      const baseCloseAt = new Date(now.getTime() - 60_000);
      await request(app)
        .patch(`/api/manager/city-review-seasons/${seasonYear}`)
        .set(auth(current.cityManagerToken))
        .send({
          submissionOpensAt: new Date(now.getTime() - 120_000).toISOString(),
          submissionClosesAt: baseCloseAt.toISOString(),
          reviewDeadlineAt: null,
          supplementDeadlineAt: null,
          finalizationDeadlineAt: null,
          expectedVersion: 2,
          reason: 'Close integration test window',
        })
        .expect(200);

      const grantUntil = new Date(now.getTime() + 60 * 60_000).toISOString();
      await request(app)
        .put(`/api/manager/applications/${applicationIds[1]}/submission-deadline-exception`)
        .set(auth(current.cityManagerToken))
        .send({ validUntil: grantUntil, reason: 'Grant one-app integration extension' })
        .expect(200);
      const extended = await request(app)
        .get(`/api/manager/applications/${applicationIds[1]}/submission-deadline`)
        .set(auth(current.cityManagerToken))
        .expect(200);
      expect(extended.body.data.submission.status).toBe('EXCEPTION_ACTIVE');
      expect(extended.body.data.exception.reason).toBe('Grant one-app integration extension');
      const submittedWithException = await request(app)
        .post(`/api/applications/${applicationIds[1]}/submit`)
        .set(auth(users[1].token))
        .send({ allowSubmitWithWarnings: true })
        .expect(200);
      expect(submittedWithException.body.data.application.status).toBe(ApplicationStatus.under_review);
      await expect(
        prisma.reviewTask.count({ where: { applicationId: applicationIds[1] } }),
      ).resolves.toBe(5);

      const unaffected = await request(app)
        .get(`/api/manager/applications/${applicationIds[2]}/submission-deadline`)
        .set(auth(current.cityManagerToken))
        .expect(200);
      expect(unaffected.body.data.submission.status).toBe('CLOSED');
      const blockedUnaffected = await request(app)
        .post(`/api/applications/${applicationIds[2]}/submit`)
        .set(auth(users[2].token))
        .send({ allowSubmitWithWarnings: true })
        .expect(409);
      expect(blockedUnaffected.body.error.code).toBe('CITY_SUBMISSION_CLOSED');
      await expect(
        prisma.application.findUniqueOrThrow({
          where: { id: applicationIds[2] },
          select: { status: true, submittedAt: true },
        }),
      ).resolves.toMatchObject({ status: ApplicationStatus.draft, submittedAt: null });
      await expect(
        prisma.reviewTask.count({ where: { applicationId: applicationIds[2] } }),
      ).resolves.toBe(0);
      await expect(
        prisma.notification.count({ where: { applicationId: applicationIds[2] } }),
      ).resolves.toBe(0);
      await expect(
        prisma.auditLog.count({
          where: { applicationId: applicationIds[2], action: 'APPLICATION_SUBMITTED' },
        }),
      ).resolves.toBe(0);

      await request(app)
        .put(`/api/manager/applications/${applicationIds[3]}/submission-deadline-exception`)
        .set(auth(current.cityManagerToken))
        .send({
          validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
          reason: 'Expired integration extension',
        })
        .expect(200);
      await prisma.citySubmissionWindowException.update({
        where: { applicationId: applicationIds[3] },
        data: { validUntil: new Date(Date.now() - 30_000) },
      });
      const expired = await request(app)
        .get(`/api/manager/applications/${applicationIds[3]}/submission-deadline`)
        .set(auth(current.cityManagerToken))
        .expect(200);
      expect(expired.body.data.submission.status).toBe('CLOSED');
      expect(expired.body.data.submission.exceptionActive).toBe(false);

      await request(app)
        .put(`/api/manager/applications/${applicationIds[4]}/submission-deadline-exception`)
        .set(auth(current.cityManagerToken))
        .send({
          validUntil: new Date(now.getTime() + 60 * 60_000).toISOString(),
          reason: 'Extension that is revoked',
        })
        .expect(200);
      await request(app)
        .delete(`/api/manager/applications/${applicationIds[4]}/submission-deadline-exception`)
        .set(auth(current.cityManagerToken))
        .send({ reason: 'Revoke integration extension' })
        .expect(200);
      const revoked = await request(app)
        .get(`/api/manager/applications/${applicationIds[4]}/submission-deadline`)
        .set(auth(current.cityManagerToken))
        .expect(200);
      expect(revoked.body.data.submission.status).toBe('CLOSED');
      expect(revoked.body.data.exception.revokedAt).not.toBeNull();
      await expect(
        prisma.auditLog.count({
          where: {
            targetType: 'city_submission_window_exception',
            targetId: { in: [applicationIds[1], applicationIds[3], applicationIds[4]] },
          },
        }),
      ).resolves.toBe(4);

      const udnWorkspace = await prisma.workspace.create({
        data: {
          code: `CITY-SEASON-UDN-${runId}`.toUpperCase(),
          name: `City Season UDN ${runId}`,
          type: WorkspaceType.UNIVERSITY_SYSTEM,
          isActive: true,
        },
      });
      extraWorkspaceIds.push(udnWorkspace.id);
      const eligibilitySchool = await prisma.workspace.create({
        data: {
          code: `CITY-SEASON-ELIGIBILITY-SCHOOL-${runId}`.toUpperCase(),
          name: `City Season Eligibility School ${runId}`,
          type: WorkspaceType.SCHOOL,
          parentWorkspaceId: udnWorkspace.id,
          isActive: true,
          registrationEnabled: true,
        },
      });
      extraWorkspaceIds.push(eligibilitySchool.id);
      const verificationAward = await prisma.awardDecision.create({
        data: {
          issuerWorkspaceId: udnWorkspace.id,
          awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
          schoolYear: seasonYear,
          status: AwardDecisionStatus.CONFIRMED,
          createdById: current.cityManagerId,
          confirmedById: current.cityManagerId,
          confirmedAt: new Date(),
        },
      });
      awardDecisionIds.push(verificationAward.id);
      await prisma.awardRecipient.create({
        data: {
          awardDecisionId: verificationAward.id,
          studentCode: `AWARDCODE-${runId}`,
          fullName: `Verification Candidate ${runId}`,
          className: `Verification Class ${runId}`,
          institutionWorkspaceId: eligibilitySchool.id,
        },
      });

      const eligibilityCases = [
        {
          label: 'needs-verification',
          code: `VERIFY-${runId}`,
          fullName: `Verification Candidate ${runId}`,
          className: `Verification Class ${runId}`,
          expectedCode: 'CITY_SUBMISSION_NEEDS_VERIFICATION',
        },
        {
          label: 'not-eligible',
          code: `NOAWARD-${runId}`,
          fullName: `No Recipient ${runId}`,
          className: `No Award Class ${runId}`,
          expectedCode: 'CITY_SUBMISSION_NOT_ELIGIBLE',
        },
      ];
      for (const eligibilityCase of eligibilityCases) {
        const email = `city-season-${eligibilityCase.label}-${runId}@example.test`;
        const student = await seedUser({
          workspaceId: eligibilitySchool.id,
          email,
          role: Role.student,
          fullName: eligibilityCase.fullName,
          studentCode: eligibilityCase.code,
          className: eligibilityCase.className,
        });
        users.push({ ...student, token: tokenService.createAccessToken(student.id) });
        const application = await prisma.application.create({
          data: {
            workspaceId: eligibilitySchool.id,
            studentId: student.id,
            schoolYear: seasonYear,
            applicationType: ApplicationType.individual,
            targetLevel: Level.city,
            status: ApplicationStatus.draft,
            finalStatus: FinalStatus.pending,
          },
        });
        applicationIds.push(application.id);

        await request(app)
          .put(`/api/manager/applications/${application.id}/submission-deadline-exception`)
          .set(auth(current.cityManagerToken))
          .send({
            validUntil: new Date(Date.now() + 60 * 60_000).toISOString(),
            reason: `Eligibility remains required for ${eligibilityCase.label}.`,
          })
          .expect(200);

        const applicationBeforeEligibilityGate = await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
          select: {
            status: true,
            submittedAt: true,
            updatedAt: true,
            readinessScore: true,
            currentDraftVersion: true,
          },
        });

        const blockedByEligibility = await request(app)
          .post(`/api/applications/${application.id}/submit`)
          .set(auth(tokenService.createAccessToken(student.id)))
          .send({ allowSubmitWithWarnings: true })
          .expect(409);
        expect(blockedByEligibility.body.error.code).toBe(eligibilityCase.expectedCode);

        await expect(
          prisma.application.findUniqueOrThrow({
            where: { id: application.id },
            select: {
              status: true,
              submittedAt: true,
              updatedAt: true,
              readinessScore: true,
              currentDraftVersion: true,
            },
          }),
        ).resolves.toEqual(applicationBeforeEligibilityGate);
        await expect(prisma.reviewTask.count({ where: { applicationId: application.id } })).resolves.toBe(0);
        await expect(prisma.notification.count({ where: { applicationId: application.id } })).resolves.toBe(0);
        await expect(prisma.precheckResult.count({ where: { applicationId: application.id } })).resolves.toBe(0);
        await expect(prisma.emailOutbox.count({ where: { applicationId: application.id } })).resolves.toBe(0);
        await expect(
          prisma.auditLog.count({
            where: {
              applicationId: application.id,
              action: { in: ['PRECHECK_COMPLETED', 'APPLICATION_READINESS_UPDATED', 'REVIEW_TASK_CREATED', 'APPLICATION_SUBMITTED'] },
            },
          }),
        ).resolves.toBe(0);
        await expect(
          prisma.citySubmissionWindowException.findUnique({ where: { applicationId: application.id } }),
        ).resolves.toMatchObject({ revokedAt: null });
      }

      const beforeSideEffects = await prisma.application.findUniqueOrThrow({
        where: { id: applicationIds[2] },
        select: { status: true, submittedAt: true },
      });
      expect(beforeSideEffects).toMatchObject({ status: ApplicationStatus.draft, submittedAt: null });
      await expect(
        prisma.reviewTask.count({ where: { applicationId: { in: [applicationIds[2], applicationIds[3], applicationIds[4]] } } }),
      ).resolves.toBe(0);
    } catch (error) {
      scenarioFailed = true;
      scenarioError = error;
    } finally {
      const cleanupFailures: unknown[] = [];
      const userIds = users.map((user) => user.id);
      const cleanupSteps = [
        () => seasonId
          ? prisma.auditLog.deleteMany({ where: { targetId: seasonId, targetType: 'city_review_season' } })
          : Promise.resolve({ count: 0 }),
        () => seasonId
          ? prisma.cityReviewSeason.deleteMany({ where: { id: seasonId } })
          : Promise.resolve({ count: 0 }),
        () => prisma.auditLog.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        () => prisma.emailOutbox.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        () => prisma.notification.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        () => prisma.citySubmissionWindowException.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        async () => {
          const tasks = await prisma.reviewTask.findMany({
            where: { applicationId: { in: applicationIds } },
            select: { id: true },
          });
          return prisma.reviewTaskEvidence.deleteMany({
            where: { reviewTaskId: { in: tasks.map((task) => task.id) } },
          });
        },
        () => prisma.reviewTask.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        () => prisma.precheckResult.deleteMany({ where: { applicationId: { in: applicationIds } } }),
        () => prisma.application.deleteMany({ where: { id: { in: applicationIds } } }),
        () => prisma.awardDecision.deleteMany({ where: { id: { in: awardDecisionIds } } }),
        () => prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }),
        () => prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        () => prisma.workspace.updateMany({
          where: { id: { in: extraWorkspaceIds } },
          data: { parentWorkspaceId: null },
        }),
        () => prisma.workspace.deleteMany({ where: { id: { in: extraWorkspaceIds } } }),
        () => prisma.workspace.deleteMany({ where: { id: workspace.id } }),
      ];
      for (const cleanup of cleanupSteps) {
        try {
          await cleanup();
        } catch (cleanupError) {
          cleanupFailures.push(cleanupError);
        }
      }
      if (cleanupFailures.length > 0) {
        scenarioFailed = true;
        scenarioError = new AggregateError(
          [...(scenarioError ? [scenarioError] : []), ...cleanupFailures],
          'City submission integration cleanup failed',
        );
      }
    }
    if (scenarioFailed) throw scenarioError;
  }, 180_000);

  it('isolates evidence and file access across workspaces', async () => {
    const current = fixture!;
    const { a, b } = current;

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

    const filesBefore = await prisma.file.count({ where: { workspaceId: b.workspaceId } });
    const evidenceFilesBefore = await prisma.evidenceFile.count({ where: { evidenceId: b.evidenceId } });
    const jobsBefore = await prisma.indexingJob.count({
      where: { targetId: b.evidenceId, jobType: JobType.evidence_ocr },
    });
    expectNotFound(
      await request(app)
        .post(`/api/evidences/${b.evidenceId}/files`)
        .set(auth(a.officerToken))
        .attach('file', Buffer.from('%PDF-1.4 test'), {
          filename: 'cross-workspace.pdf',
          contentType: 'application/pdf',
        }),
    );
    expect(await prisma.file.count({ where: { workspaceId: b.workspaceId } })).toBe(filesBefore);
    expect(await prisma.evidenceFile.count({ where: { evidenceId: b.evidenceId } })).toBe(
      evidenceFilesBefore,
    );
    expect(
      await prisma.indexingJob.count({
        where: { targetId: b.evidenceId, jobType: JobType.evidence_ocr },
      }),
    ).toBe(jobsBefore);

    const sameWorkspaceUpload = await request(app)
      .post(`/api/evidences/${a.evidenceId}/files`)
      .set(auth(a.officerToken))
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'same-workspace.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    current.createdUploadFileIds.push(sameWorkspaceUpload.body.data.file.id);
    current.createdUploadJobIds.push(sameWorkspaceUpload.body.data.jobId);
    current.createdFilePaths.push(
      path.resolve(uploadRoot, sameWorkspaceUpload.body.data.file.storageKey),
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

    const bTaskCountBeforeEnsure = await prisma.reviewTask.count({
      where: { applicationId: b.applicationId },
    });
    const ensuredForB = await request(app)
      .post(`/api/review/applications/${b.applicationId}/tasks/ensure`)
      .set(auth(fixture!.cityManagerToken))
      .send({})
      .expect(200);
    expect(ensuredForB.body.data.ensuredCount).toBeGreaterThan(0);
    expect(
      await prisma.reviewTask.count({ where: { applicationId: b.applicationId } }),
    ).toBeGreaterThan(bTaskCountBeforeEnsure);

    await prisma.officerSpecialization.createMany({
      data: [a, b].map((side) => ({
        officerId: side.officerId,
        criterion: Criterion.academic,
        facultyScope: a.faculty,
        isActive: true,
      })),
    });
    await prisma.reviewTask.createMany({
      data: [Criterion.physical, Criterion.volunteer].map((criterion) => ({
        workspaceId: a.workspaceId,
        applicationId: a.applicationId,
        criterion,
        assignedOfficerId: a.officerId,
        status: ReviewTaskStatus.waiting,
      })),
    });
    await request(app)
      .post(`/api/review/applications/${a.applicationId}/tasks/ensure`)
      .set(auth(fixture!.cityManagerToken))
      .send({})
      .expect(200);
    const academicTask = await prisma.reviewTask.findFirstOrThrow({
      where: { applicationId: a.applicationId, criterion: Criterion.academic },
      select: { assignedOfficerId: true },
    });
    expect(academicTask.assignedOfficerId).toBe(fixture!.cityOfficerId);

    const originalTask = await prisma.reviewTask.findUniqueOrThrow({
      where: { id: a.reviewTaskId },
      select: { assignedOfficerId: true, status: true },
    });
    try {
      await prisma.reviewTask.update({
        where: { id: b.reviewTaskId },
        data: { assignedOfficerId: null },
      });
      expectNotFound(
        await request(app)
          .post(`/api/review/tasks/${b.reviewTaskId}/claim`)
          .set(auth(a.officerToken)),
      );
      expect(
        (await prisma.reviewTask.findUniqueOrThrow({
          where: { id: b.reviewTaskId },
          select: { assignedOfficerId: true },
        })).assignedOfficerId,
      ).toBeNull();

      await prisma.reviewTask.update({
        where: { id: a.reviewTaskId },
        data: { assignedOfficerId: null, status: ReviewTaskStatus.waiting },
      });
      await request(app)
        .post(`/api/review/tasks/${a.reviewTaskId}/claim`)
        .set(auth(a.officerToken))
        .expect(200);

      await prisma.reviewTask.update({
        where: { id: a.reviewTaskId },
        data: { assignedOfficerId: b.officerId, status: ReviewTaskStatus.reviewing },
      });
      expectRejected(
        await request(app)
          .post(`/api/review/tasks/${a.reviewTaskId}/claim`)
          .set(auth(a.officerToken)),
      );

      await prisma.reviewTask.update({
        where: { id: a.reviewTaskId },
        data: { assignedOfficerId: null, status: ReviewTaskStatus.accepted },
      });
      expectRejected(
        await request(app)
          .post(`/api/review/tasks/${a.reviewTaskId}/claim`)
          .set(auth(a.officerToken)),
      );
    } finally {
      await prisma.reviewTask.update({
        where: { id: a.reviewTaskId },
        data: originalTask,
      });
      await prisma.reviewTask.update({
        where: { id: b.reviewTaskId },
        data: { assignedOfficerId: b.officerId },
      });
    }

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

    const caseBefore = await prisma.resolutionCase.findUniqueOrThrow({
      where: { id: b.resolutionCaseId },
      select: { status: true, closedAt: true },
    });
    const applicationBefore = await prisma.application.findUniqueOrThrow({
      where: { id: b.applicationId },
      select: { status: true },
    });
    await request(app)
      .patch(`/api/resolution/cases/${b.resolutionCaseId}/status`)
      .set(auth(a.managerToken))
      .send({ status: 'closed', note: 'cross workspace status attempt' })
      .expect(403);
    expectNotFound(
      await request(app)
        .post(`/api/resolution/cases/${b.resolutionCaseId}/reopen`)
        .set(auth(a.committeeToken))
        .send({ reason: 'cross workspace reopen attempt' }),
    );
    expect(
      await prisma.resolutionCase.findUniqueOrThrow({
        where: { id: b.resolutionCaseId },
        select: { status: true, closedAt: true },
      }),
    ).toEqual(caseBefore);
    expect(
      await prisma.application.findUniqueOrThrow({
        where: { id: b.applicationId },
        select: { status: true },
      }),
    ).toEqual(applicationBefore);

    await request(app)
      .patch(`/api/resolution/cases/${a.resolutionCaseId}/status`)
      .set(auth(a.managerToken))
      .send({ status: 'resolved', note: 'same workspace status update' })
      .expect(403);
    await request(app)
      .post(`/api/resolution/cases/${a.resolutionCaseId}/reopen`)
      .set(auth(a.committeeToken))
      .send({ reason: 'same workspace reopen' })
      .expect(200);
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

    const eventFileA = await prisma.eventFile.create({
      data: { eventId: a.eventId, fileId: a.fileId },
    });
    const eventFileB = await prisma.eventFile.create({
      data: { eventId: b.eventId, fileId: b.fileId },
    });
    const rosterJob = await prisma.indexingJob.create({
      data: {
        workspaceId: a.workspaceId,
        jobType: JobType.event_roster_indexing,
        targetId: eventFileA.id,
        status: JobStatus.completed,
        resultJson: {
          columns: ['code', 'name', 'class', 'faculty', 'status', 'value'],
          rows: [
            {
              code: a.studentCode,
              name: `Updated participant ${runId}`,
              class: a.className,
              faculty: a.faculty,
              status: 'confirmed',
              value: 1,
            },
          ],
          suggestedMapping: {
            studentCode: 'code',
            studentName: 'name',
            className: 'class',
            faculty: 'faculty',
            participationStatus: 'status',
            convertedValue: 'value',
          },
          quality: {
            rowCount: 1,
            missingStudentCodeRows: 0,
            duplicateStudentCodes: [],
            confidence: 1,
          },
        },
      },
    });
    const participantsBefore = await prisma.eventParticipant.findMany({
      where: { eventId: a.eventId },
      orderBy: { studentCode: 'asc' },
      select: { studentCode: true, studentName: true },
    });
    try {
      expectNotFound(
        await request(app)
          .post(`/api/events/${a.eventId}/confirm-index`)
          .set(auth(a.managerToken))
          .send({
            eventFileId: eventFileB.id,
            replaceExisting: true,
            columnMapping: { studentCode: 'code', studentName: 'name' },
          }),
      );
      expect(
        await prisma.eventParticipant.findMany({
          where: { eventId: a.eventId },
          orderBy: { studentCode: 'asc' },
          select: { studentCode: true, studentName: true },
        }),
      ).toEqual(participantsBefore);

      await request(app)
        .post(`/api/events/${a.eventId}/confirm-index`)
        .set(auth(a.managerToken))
        .send({
          eventFileId: eventFileA.id,
          replaceExisting: false,
          columnMapping: { studentCode: 'code', studentName: 'name' },
        })
        .expect(200);
    } finally {
      await prisma.indexingJob.delete({ where: { id: rosterJob.id } });
    }
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
