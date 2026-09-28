import {
  ApplicationType,
  Criterion,
  EvidenceStatus,
  FinalStatus,
  IndexingStatus,
  Level,
  MetricType,
  ReviewDecision,
  ReviewTaskStatus,
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
const password = 'Password@123';
const runPrefix = process.env.E2E_P3B_RUN_PREFIX ?? `e2e_p3b_nonai_${Date.now()}_${randomUUID()}`;
const schoolYear = process.env.E2E_P3B_NON_AI_SCHOOL_YEAR ?? '2098-2099';
const faculty = `E2E Faculty ${runPrefix.slice(-12)}`;
const studentCode = `P3B${runPrefix.replace(/[^a-z0-9]/gi, '').slice(-16).toUpperCase()}`;
const workspaceCode = `${runPrefix}_school`.toUpperCase();
const cityWorkspaceCode = `${runPrefix}_city`.toUpperCase();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR ?? './uploads');
let workspaceId: string;
let cityWorkspaceId: string;
let seasonId: string | undefined;

const emailFor = (role: string) => `e2e.${runPrefix}.${role}@example.test`;

const accounts = {
  student: emailFor('student'),
  manager: emailFor('manager'),
  committee: emailFor('committee'),
  cityCommittee: emailFor('city-committee'),
  officers: {
    [Criterion.ethics]: emailFor('officer.ethics'),
    [Criterion.academic]: emailFor('officer.academic'),
    [Criterion.physical]: emailFor('officer.physical'),
    [Criterion.volunteer]: emailFor('officer.volunteer'),
    [Criterion.integration]: emailFor('officer.integration'),
  },
};

const criteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

type TokenBundle = {
  accessToken: string;
  userId: string;
};

async function login(email: string): Promise<TokenBundle> {
  const response = await request(app).post('/api/auth/login').send({ email, password }).expect(200);

  expect(response.body.success).toBe(true);
  return {
    accessToken: response.body.data.accessToken,
    userId: response.body.data.user.id,
  };
}

async function seedUser(input: {
  email: string;
  role: Role;
  fullName: string;
  workspaceId?: string;
  studentCode?: string;
  className?: string;
  specialization?: Criterion;
}) {
  const passwordHash = await new PasswordService().hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      workspaceId: input.workspaceId ?? workspaceId,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
      studentCode: input.studentCode,
      className: input.className,
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

describe('non-AI individual application end-to-end flow', () => {
  beforeAll(async () => {
    const cityWorkspace = await prisma.workspace.create({
      data: {
        code: cityWorkspaceCode,
        name: `E2E Non-AI City Workspace ${runPrefix}`,
        shortName: `E2E-${runPrefix.slice(-8)}`,
        type: WorkspaceType.CITY,
        isActive: true,
      },
    });
    cityWorkspaceId = cityWorkspace.id;

    const workspace = await prisma.workspace.create({
      data: {
        code: workspaceCode,
        name: `E2E Non-AI Workspace ${runPrefix}`,
        shortName: `E2E-${runPrefix.slice(-8)}`,
        type: WorkspaceType.SCHOOL,
        parentWorkspaceId: null,
        isActive: true,
        registrationEnabled: true,
      },
    });
    workspaceId = workspace.id;

    const now = Date.now();
    const season = await prisma.cityReviewSeason.create({
      data: {
        schoolYear,
        submissionOpensAt: new Date(now - 60_000),
        submissionClosesAt: new Date(now + 3_600_000),
        supplementDeadlineAt: new Date(now + 86_400_000),
      },
    });
    seasonId = season.id;

    await seedUser({
      email: accounts.student,
      role: Role.student,
      fullName: `E2E Student ${runPrefix}`,
      studentCode,
      className: 'E2E-CLASS',
    });
    await seedUser({
      email: accounts.manager,
      role: Role.city_manager,
      fullName: `E2E Manager ${runPrefix}`,
      workspaceId: cityWorkspaceId,
    });
    await seedUser({
      email: accounts.committee,
      role: Role.committee,
      fullName: `E2E Committee ${runPrefix}`,
    });
    await seedUser({
      email: accounts.cityCommittee,
      role: Role.city_committee,
      fullName: `E2E City Committee ${runPrefix}`,
      workspaceId: cityWorkspaceId,
    });

    for (const criterion of criteria) {
      await seedUser({
        email: accounts.officers[criterion],
        role: Role.city_officer,
        fullName: `E2E Officer ${criterion} ${runPrefix}`,
        specialization: criterion,
        workspaceId: cityWorkspaceId,
      });
    }
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { contains: runPrefix } },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const workspaces = await prisma.workspace.findMany({
      where: { code: { in: [workspaceCode, cityWorkspaceCode] } },
      select: { id: true },
    });
    const workspaceIds = workspaces.map(({ id }) => id);
    const applications = await prisma.application.findMany({
      where: { studentId: { in: userIds }, schoolYear, applicationType: ApplicationType.individual },
      select: { id: true },
    });
    const applicationIds = applications.map(({ id }) => id);
    const files = await prisma.file.findMany({
      where: { ownerId: { in: userIds }, workspaceId: { in: workspaceIds } },
      select: { filePath: true },
    });
    const failures: unknown[] = [];
    const cleanupSteps = [
      () => prisma.auditLog.deleteMany({
        where: {
          OR: [
            { applicationId: { in: applicationIds } },
            { workspaceId: { in: workspaceIds } },
            { actorId: { in: userIds } },
            ...(seasonId ? [{ targetId: seasonId, targetType: 'city_review_season' }] : []),
          ],
        },
      }),
      () => prisma.emailOutbox.deleteMany({
        where: {
          OR: [
            { applicationId: { in: applicationIds } },
            { relatedUserId: { in: userIds } },
            { recipientEmail: { contains: runPrefix } },
          ],
        },
      }),
      () => prisma.citySubmissionWindowException.deleteMany({
        where: { applicationId: { in: applicationIds } },
      }),
      () => prisma.applicationFinalDecisionHistory.deleteMany({
        where: { applicationId: { in: applicationIds } },
      }),
      () => prisma.notification.deleteMany({
        where: {
          OR: [
            { applicationId: { in: applicationIds } },
            { userId: { in: userIds } },
            { workspaceId: { in: workspaceIds } },
          ],
        },
      }),
      () => prisma.application.deleteMany({ where: { id: { in: applicationIds } } }),
      () => prisma.file.deleteMany({
        where: { ownerId: { in: userIds }, workspaceId: { in: workspaceIds } },
      }),
      () => prisma.indexingJob.deleteMany({ where: { workspaceId: { in: workspaceIds } } }),
      () => seasonId
        ? prisma.cityReviewSeason.deleteMany({ where: { id: seasonId } })
        : Promise.resolve({ count: 0 }),
      () => prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      () => prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } }),
    ];
    for (const cleanup of cleanupSteps) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    await Promise.all(files.map(({ filePath }) =>
      fs.rm(path.join(uploadRoot, filePath), { force: true }).catch((error) => failures.push(error)),
    ));
    if (failures.length > 0) throw new AggregateError(failures, `Cleanup failed for ${runPrefix}`);
  }, 120_000);

  it('covers draft, evidence upload, submission, officer review, manager dashboard and finalization', async () => {
    const student = await login(accounts.student);
    const manager = await login(accounts.manager);
    const committee = await login(accounts.committee);
    const cityCommittee = await login(accounts.cityCommittee);

    const currentBeforeStart = await request(app)
      .get('/api/applications/current')
      .query({ schoolYear })
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect(currentBeforeStart.body.data).toMatchObject({
      application: null,
      state: 'not_started',
      schoolYear,
    });

    const started = await request(app)
      .post('/api/applications/current/start')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ schoolYear, targetLevel: Level.city })
      .expect(201);
    const applicationId = started.body.data.id as string;
    expect(started.body.data).toMatchObject({
      id: applicationId,
      status: 'draft',
      targetLevel: Level.city,
    });

    const draft = await request(app)
      .patch(`/api/applications/${applicationId}/draft`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        targetLevel: Level.city,
        basicInfo: {
          fullName: `E2E Student ${runPrefix}`,
          studentCode,
          className: 'E2E-CLASS',
          faculty,
          phone: '0900000000',
        },
        notes: 'E2E autosave non-AI flow.',
        draftData: {
          checklist: criteria.map((criterion) => ({ criterion, done: true })),
        },
      })
      .expect(200);
    expect(draft.body.data).toMatchObject({
      applicationId,
      currentDraftVersion: expect.any(Number),
      savedAt: expect.any(String),
    });

    const metricInputs = [
      { metricType: MetricType.gpa, value: 1, scale: 4 },
      { metricType: MetricType.conduct_score, value: 92 },
      { metricType: MetricType.physical_score, value: 8.5 },
      { metricType: MetricType.volunteer_days, value: 12 },
      { metricType: MetricType.foreign_language_score, value: 7.5 },
    ];

    for (const metric of metricInputs) {
      const response = await request(app)
        .post(`/api/applications/${applicationId}/metrics`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .send(metric)
        .expect(200);
      expect(response.body.data.metric).toMatchObject({
        metricType: metric.metricType,
        value: metric.value,
      });
    }

    const evidenceIds: Record<string, string> = {};
    for (const criterion of criteria) {
      const created = await request(app)
        .post(`/api/applications/${applicationId}/evidences`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .send({
          evidenceName: `E2E ${criterion} evidence`,
          criterion,
          sourceType: 'manual_upload',
        })
        .expect(201);
      const evidenceId = (created.body.data.evidence?.id ?? created.body.data.id) as string;
      expect(evidenceId).toEqual(expect.any(String));
      evidenceIds[criterion] = evidenceId;

      const uploaded = await request(app)
        .post(`/api/evidences/${evidenceId}/files`)
        .set('Authorization', `Bearer ${student.accessToken}`)
        .attach('file', Buffer.from(`%PDF-1.4\nE2E evidence ${criterion}\n%%EOF`), {
          filename: `${criterion}.pdf`,
          contentType: 'application/pdf',
        })
        .expect(201);

      expect(uploaded.body.data.evidence).toMatchObject({
        id: evidenceId,
        status: EvidenceStatus.pending_indexing,
        indexingStatus: 'pending_indexing',
      });
      expect(uploaded.body.data.file).toMatchObject({
        originalName: `${criterion}.pdf`,
        mimeType: 'application/pdf',
      });
    }

    const priorityEvidence = await request(app)
      .post(`/api/applications/${applicationId}/evidences`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        evidenceName: 'E2E priority evidence',
        criterion: Criterion.priority,
        sourceType: 'manual_upload',
      })
      .expect(201);
    evidenceIds[Criterion.priority] = (priorityEvidence.body.data.evidence?.id ??
      priorityEvidence.body.data.id) as string;

    const listedEvidences = await request(app)
      .get(`/api/applications/${applicationId}/evidences`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect(listedEvidences.body.data.items ?? listedEvidences.body.data).toHaveLength(
      criteria.length + 1,
    );

    const submitted = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        allowSubmitWithWarnings: true,
        studentNote: 'Submit while saved evidence OCR is pending.',
      })
      .expect(200);
    expect(submitted.body.data.application).toMatchObject({
      id: applicationId,
      status: 'under_review',
    });
    expect(submitted.body.data.reviewTasks).toHaveLength(criteria.length);
    for (const task of submitted.body.data.reviewTasks) {
      expect(task).toMatchObject({
        criterion: expect.stringMatching(/^(ethics|academic|physical|volunteer|integration)$/),
        status: ReviewTaskStatus.waiting,
        assignedOfficer: expect.objectContaining({ id: expect.any(String) }),
      });
    }

    const ensuredTasks = await request(app)
      .post(`/api/review/applications/${applicationId}/tasks/ensure`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ mode: 'missing_only' })
      .expect(200);
    expect(ensuredTasks.body.data.ensuredCount).toBe(0);
    expect(ensuredTasks.body.data.createdTaskIds).toEqual([]);

    const repeatedEnsure = await request(app)
      .post(`/api/review/applications/${applicationId}/tasks/ensure`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ mode: 'missing_only' })
      .expect(200);
    expect(repeatedEnsure.body.data).toEqual({ ensuredCount: 0, createdTaskIds: [] });

    const tasksAfterRepeatedEnsure = await prisma.reviewTask.findMany({
      where: { applicationId },
      select: { criterion: true },
    });
    expect(tasksAfterRepeatedEnsure).toHaveLength(criteria.length);
    expect(new Set(tasksAfterRepeatedEnsure.map((task) => task.criterion))).toEqual(
      new Set(criteria),
    );

    await prisma.evidence.updateMany({
      where: { id: { in: Object.values(evidenceIds) } },
      data: { status: EvidenceStatus.indexed, indexingStatus: IndexingStatus.failed },
    });

    const managerApplications = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, status: 'under_review', q: 'E2E Student' })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(managerApplications.body.data.items ?? managerApplications.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: applicationId,
          status: 'under_review',
          reviewTaskCount: criteria.length,
        }),
      ]),
    );

    const workloads = await request(app)
      .get('/api/manager/workloads')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(
      workloads.body.data.officers.some((officer: { totalOpen: number }) => officer.totalOpen > 0),
    ).toBe(true);

    for (const criterion of criteria) {
      const officer = await login(accounts.officers[criterion]);
      const taskList = await request(app)
        .get('/api/review/tasks')
        .query({ applicationId, criterion, assignedToMe: true })
        .set('Authorization', `Bearer ${officer.accessToken}`)
        .expect(200);
      const tasks = taskList.body.data.items ?? taskList.body.data;
      expect(tasks).toHaveLength(1);
      const task = tasks[0];

      const detail = await request(app)
        .get(`/api/review/tasks/${task.id}`)
        .set('Authorization', `Bearer ${officer.accessToken}`)
        .expect(200);
      expect(detail.body.data.task).toMatchObject({
        id: task.id,
        criterion,
      });
      expect([ReviewTaskStatus.waiting, ReviewTaskStatus.reviewing]).toContain(
        detail.body.data.task.status,
      );
      expect(detail.body.data.evidences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: evidenceIds[criterion],
            criterion,
          }),
        ]),
      );

      const rejected = criterion === Criterion.ethics;
      const needsSupplement = criterion === Criterion.volunteer;
      const needsResolution = criterion === Criterion.integration;
      const decisionPayload = {
        decision: rejected
          ? ReviewDecision.rejected
          : needsSupplement
            ? ReviewDecision.supplement_required
            : needsResolution
              ? ReviewDecision.resolution_needed
              : ReviewDecision.accepted,
        officerSuggestedLevel:
          rejected || needsSupplement || needsResolution ? undefined : Level.school,
        officerNote: rejected
          ? 'Rejected after human review.'
          : needsSupplement
            ? 'Please provide clearer volunteer evidence for this criterion.'
            : needsResolution
              ? 'Please have the committee verify the integration evidence.'
              : `Accepted ${criterion} in E2E flow.`,
        evidenceDecisions: [
          {
            evidenceId: evidenceIds[criterion],
            status: rejected
              ? EvidenceStatus.rejected
              : needsSupplement
                ? EvidenceStatus.needs_supplement
                : needsResolution
                  ? EvidenceStatus.resolution_needed
                  : EvidenceStatus.accepted,
            note: rejected
              ? 'Human reviewer rejected this proof.'
              : needsSupplement
                ? 'The volunteer proof needs a clearer record.'
                : needsResolution
                  ? 'The integration proof needs committee review.'
                  : 'Valid uploaded proof.',
          },
        ],
      };
      if (rejected) {
        const concurrentDecisions = await Promise.all([
          request(app)
            .post(`/api/review/tasks/${task.id}/decision`)
            .set('Authorization', `Bearer ${officer.accessToken}`)
            .send(decisionPayload),
          request(app)
            .post(`/api/review/tasks/${task.id}/decision`)
            .set('Authorization', `Bearer ${officer.accessToken}`)
            .send(decisionPayload),
        ]);
        expect(concurrentDecisions.map((response) => response.status).sort()).toEqual([200, 409]);
        expect(
          await prisma.auditLog.count({
            where: { targetId: task.id, action: 'REVIEW_DECISION_REJECTED' },
          }),
        ).toBe(1);
      } else {
        await request(app)
          .post(`/api/review/tasks/${task.id}/decision`)
          .set('Authorization', `Bearer ${officer.accessToken}`)
          .send(decisionPayload)
          .expect(200);
      }
    }

    const tasksBeforeResubmit = await prisma.reviewTask.findMany({
      where: { applicationId },
      select: { criterion: true, status: true },
    });
    expect(tasksBeforeResubmit).toEqual(
      expect.arrayContaining([
        { criterion: Criterion.ethics, status: ReviewTaskStatus.rejected },
        { criterion: Criterion.academic, status: ReviewTaskStatus.accepted },
        { criterion: Criterion.physical, status: ReviewTaskStatus.accepted },
        { criterion: Criterion.volunteer, status: ReviewTaskStatus.supplement_required },
        { criterion: Criterion.integration, status: ReviewTaskStatus.resolution_needed },
      ]),
    );

    const closedWindow = new Date(Date.now() - 60_000);
    await request(app)
      .patch(`/api/manager/city-review-seasons/${schoolYear}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({
        submissionOpensAt: new Date(Date.now() - 120_000).toISOString(),
        submissionClosesAt: closedWindow.toISOString(),
        reviewDeadlineAt: null,
        supplementDeadlineAt: closedWindow.toISOString(),
        finalizationDeadlineAt: null,
        expectedVersion: 1,
        reason: 'Close initial and supplement windows for integration regression.',
      })
      .expect(200);

    const beforeBlockedResubmit = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, submittedAt: true },
    });
    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({ allowSubmitWithWarnings: true })
      .expect(409)
      .expect(({ body }) => {
        expect(body.error.code).toBe('CITY_SUPPLEMENT_WINDOW_CLOSED');
      });
    await expect(
      prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { status: true, submittedAt: true },
      }),
    ).resolves.toEqual(beforeBlockedResubmit);
    await expect(
      prisma.reviewTask.findMany({
        where: { applicationId },
        select: { criterion: true, status: true },
      }),
    ).resolves.toEqual(tasksBeforeResubmit);

    await request(app)
      .patch(`/api/manager/city-review-seasons/${schoolYear}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({
        submissionOpensAt: new Date(Date.now() - 120_000).toISOString(),
        submissionClosesAt: closedWindow.toISOString(),
        reviewDeadlineAt: null,
        supplementDeadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
        finalizationDeadlineAt: null,
        expectedVersion: 2,
        reason: 'Reopen only the supplement deadline for integration regression.',
      })
      .expect(200);

    const precheckBeforeResubmit = await prisma.precheckResult.findFirstOrThrow({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const stalePrecheckAt = new Date(Date.now() - 60_000);
    await prisma.precheckResult.update({
      where: { id: precheckBeforeResubmit.id },
      data: { createdAt: stalePrecheckAt },
    });
    const precheckCountBeforeResubmit = await prisma.precheckResult.count({
      where: { applicationId },
    });

    const resubmitted = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        allowSubmitWithWarnings: true,
        studentNote: 'Resubmit volunteer evidence without resetting other City tasks.',
      })
      .expect(200);
    expect(resubmitted.body.data.reviewTasks).toHaveLength(criteria.length);
    expect(
      await prisma.supplementRequest.findMany({
        where: { applicationId },
        select: { status: true, resubmittedAt: true },
      }),
    ).toEqual([
      expect.objectContaining({ status: 'resubmitted', resubmittedAt: expect.any(Date) }),
    ]);
    expect(
      await prisma.precheckResult.count({ where: { applicationId } }),
    ).toBe(precheckCountBeforeResubmit + 1);
    expect(
      (await prisma.precheckResult.findFirstOrThrow({
        where: { applicationId },
        orderBy: { createdAt: 'desc' },
      })).createdAt.getTime(),
    ).toBeGreaterThan(stalePrecheckAt.getTime());

    const tasksAfterResubmit = await prisma.reviewTask.findMany({
      where: { applicationId },
      select: { criterion: true, status: true },
    });
    expect(tasksAfterResubmit).toEqual(
      expect.arrayContaining([
        { criterion: Criterion.ethics, status: ReviewTaskStatus.rejected },
        { criterion: Criterion.academic, status: ReviewTaskStatus.accepted },
        { criterion: Criterion.physical, status: ReviewTaskStatus.accepted },
        { criterion: Criterion.volunteer, status: ReviewTaskStatus.waiting },
        { criterion: Criterion.integration, status: ReviewTaskStatus.resolution_needed },
      ]),
    );

    const volunteerOfficer = await login(accounts.officers[Criterion.volunteer]);
    const volunteerTask = await prisma.reviewTask.findFirstOrThrow({
      where: { applicationId, criterion: Criterion.volunteer },
      select: { id: true },
    });
    await request(app)
      .post(`/api/review/tasks/${volunteerTask.id}/decision`)
      .set('Authorization', `Bearer ${volunteerOfficer.accessToken}`)
      .send({
        decision: ReviewDecision.accepted,
        officerSuggestedLevel: Level.school,
        officerNote: 'Reviewed the resubmitted volunteer evidence.',
        evidenceDecisions: [
          {
            evidenceId: evidenceIds[Criterion.volunteer],
            status: EvidenceStatus.accepted,
            note: 'Updated proof is sufficient.',
          },
        ],
      })
      .expect(200);

    const integrationTask = await prisma.reviewTask.findFirstOrThrow({
      where: { applicationId, criterion: Criterion.integration },
      select: { id: true },
    });
    const resolutionCase = await prisma.resolutionCase.findFirstOrThrow({
      where: { applicationId, reviewTaskId: integrationTask.id },
      select: { id: true, status: true },
    });
    expect(resolutionCase.status).toBe('open');
    const resolutionDecision = await request(app)
      .post(`/api/resolution/cases/${resolutionCase.id}/resolve`)
      .set('Authorization', `Bearer ${cityCommittee.accessToken}`)
      .send({
        decision: 'accepted',
        note: 'The committee verified the integration evidence.',
        evidenceDecisions: [
          {
            evidenceId: evidenceIds[Criterion.integration],
            decision: 'accepted',
            note: 'The submitted integration proof is sufficient.',
          },
        ],
      })
      .expect(200);
    expect(resolutionDecision.body.data.relatedTask).toMatchObject({
      id: integrationTask.id,
      status: ReviewTaskStatus.accepted,
      decision: ReviewDecision.accepted,
    });

    const aggregation = await request(app)
      .get(`/api/manager/applications/${applicationId}/aggregation`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(aggregation.body.data).toMatchObject({
      application: {
        id: applicationId,
        status: 'under_review',
      },
      reviewProgress: {
        totalTasks: criteria.length,
        accepted: criteria.length - 1,
        rejected: 1,
        canAggregate: true,
      },
      resolutionSummary: { open: 0 },
      suggestedFinalStatus: FinalStatus.pending,
      suggestedFinalLevel: null,
      canFinalize: true,
    });

    const preFinalApplication = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(preFinalApplication).toMatchObject({
      status: 'under_review',
      finalStatus: FinalStatus.pending,
      finalizedAt: null,
    });

    await request(app)
      .post(`/api/manager/applications/${applicationId}/finalize`)
      .set('Authorization', `Bearer ${committee.accessToken}`)
      .send({
        finalStatus: FinalStatus.failed,
        finalLevel: null,
        finalNote: 'Legacy school committee cannot finalize a City application.',
        overrideAggregation: false,
        notifyStudent: false,
      })
      .expect(403);

    const finalizePayload = {
      finalStatus: FinalStatus.passed,
      finalLevel: Level.school,
      finalNote: 'City Committee confirms the result after reviewing advisory warnings.',
      overrideAggregation: false,
      notifyStudent: true,
    };
    const finalizeAttempts = await Promise.all([
      request(app)
        .post(`/api/manager/applications/${applicationId}/finalize`)
        .set('Authorization', `Bearer ${cityCommittee.accessToken}`)
        .send(finalizePayload),
      request(app)
        .post(`/api/manager/applications/${applicationId}/finalize`)
        .set('Authorization', `Bearer ${cityCommittee.accessToken}`)
        .send(finalizePayload),
    ]);
    expect(finalizeAttempts.map((response) => response.status).sort()).toEqual([200, 409]);
    const finalized = finalizeAttempts.find((response) => response.status === 200)!;
    expect(finalized.body.data.finalResult).toMatchObject({
      finalStatus: FinalStatus.passed,
      finalLevel: Level.school,
    });
    expect(finalized.body.data.application).toMatchObject({
      id: applicationId,
      status: 'completed',
      finalStatus: FinalStatus.passed,
    });
    expect(
      await prisma.auditLog.count({ where: { applicationId, action: 'APPLICATION_FINALIZED' } }),
    ).toBe(1);

    const notifications = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect(notifications.body.data.items ?? notifications.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationId,
          type: 'result_available',
        }),
      ]),
    );

    const timeline = await request(app)
      .get(`/api/applications/${applicationId}/timeline`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect((timeline.body.data.items ?? timeline.body.data).length).toBeGreaterThan(0);

    const taskSnapshotBeforeCancel = await prisma.reviewTask.findMany({
      where: { applicationId },
      select: { id: true, criterion: true, status: true, decision: true },
      orderBy: { criterion: 'asc' },
    });
    expect(taskSnapshotBeforeCancel).toHaveLength(criteria.length);

    const cancelled = await request(app)
      .post(`/api/manager/applications/${applicationId}/cancel`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ reason: 'E2E lifecycle rehearsal cancellation.' })
      .expect(200);
    expect(cancelled.body.data.finalDecisionSuperseded).toBe(true);
    expect(cancelled.body.data.application).toMatchObject({
      status: 'completed',
      finalStatus: FinalStatus.pending,
      finalLevel: null,
      finalNote: null,
      cancelledById: manager.userId,
      cancelReason: 'E2E lifecycle rehearsal cancellation.',
    });

    const history = await prisma.applicationFinalDecisionHistory.findMany({
      where: { applicationId },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      finalStatus: FinalStatus.passed,
      finalLevel: Level.school,
      supersedeReason: 'E2E lifecycle rehearsal cancellation.',
    });

    const analyticsAfterCancel = await request(app)
      .get('/api/analytics/city')
      .query({ schoolYear, workspaceId })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(analyticsAfterCancel.body.data).toMatchObject({
      cancelledCount: 1,
      finalResults: { finalized: 0, passed: 0 },
    });

    const activeListAfterCancel = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, workspaceId, q: studentCode })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(activeListAfterCancel.body.data.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: applicationId })]),
    );
    const cancelledList = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, workspaceId, q: studentCode, lifecycle: 'cancelled' })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(cancelledList.body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: applicationId })]),
    );

    const aggregationAuditCount = await prisma.auditLog.count({
      where: { applicationId, action: 'APPLICATION_AGGREGATED' },
    });
    await request(app)
      .get(`/api/manager/applications/${applicationId}/aggregation`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: { applicationId, action: 'APPLICATION_AGGREGATED' },
      }),
    ).toBe(aggregationAuditCount);

    const officialResultsWhileCancelled = await request(app)
      .post('/api/exports/review-results')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ format: 'json', schoolYear, targetLevel: Level.city })
      .expect(201);
    expect(officialResultsWhileCancelled.body.data.data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ studentCode })]),
    );

    const exceptionAuditCount = await prisma.auditLog.count({
      where: {
        applicationId,
        action: {
          in: [
            'CITY_SUBMISSION_WINDOW_EXCEPTION_GRANTED',
            'CITY_SUBMISSION_WINDOW_EXCEPTION_REVOKED',
          ],
        },
      },
    });
    await request(app)
      .put(`/api/manager/applications/${applicationId}/submission-deadline-exception`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'Cancelled application must not receive a deadline exception.',
      })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('APPLICATION_CANCELLED'));
    await request(app)
      .delete(`/api/manager/applications/${applicationId}/submission-deadline-exception`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ reason: 'Cancelled application must not change deadline exceptions.' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('APPLICATION_CANCELLED'));
    expect(
      await prisma.citySubmissionWindowException.findUnique({ where: { applicationId } }),
    ).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          applicationId,
          action: {
            in: [
              'CITY_SUBMISSION_WINDOW_EXCEPTION_GRANTED',
              'CITY_SUBMISSION_WINDOW_EXCEPTION_REVOKED',
            ],
          },
        },
      }),
    ).toBe(exceptionAuditCount);

    await request(app)
      .post(`/api/manager/applications/${applicationId}/archive`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ reason: 'Archive canceled rehearsal record.' })
      .expect(200);
    const archivedCancelledList = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, workspaceId, q: studentCode, lifecycle: 'cancelled', archive: 'only' })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(archivedCancelledList.body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: applicationId })]),
    );

    const reopened = await request(app)
      .post(`/api/manager/applications/${applicationId}/reopen-cancelled`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ reason: 'Reopen the record to complete the lifecycle rehearsal.' })
      .expect(200);
    expect(reopened.body.data).toMatchObject({
      status: 'under_review',
      finalStatus: FinalStatus.pending,
      finalLevel: null,
      cancelledAt: null,
      archivedAt: null,
    });
    expect(
      await prisma.reviewTask.findMany({
        where: { applicationId },
        select: { id: true, criterion: true, status: true, decision: true },
        orderBy: { criterion: 'asc' },
      }),
    ).toEqual(taskSnapshotBeforeCancel);

    await request(app)
      .post(`/api/manager/applications/${applicationId}/finalize`)
      .set('Authorization', `Bearer ${cityCommittee.accessToken}`)
      .send({
        finalStatus: FinalStatus.passed,
        finalLevel: Level.school,
        finalNote: 'Explicitly re-finalized after reopening cancellation.',
        overrideAggregation: false,
        notifyStudent: true,
      })
      .expect(200);
    expect(await prisma.applicationFinalDecisionHistory.count({ where: { applicationId } })).toBe(
      1,
    );

    await request(app)
      .post(`/api/manager/applications/${applicationId}/archive`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ reason: 'Archive the current official result.' })
      .expect(200);
    const analyticsAfterArchive = await request(app)
      .get('/api/analytics/city')
      .query({ schoolYear, workspaceId })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(analyticsAfterArchive.body.data).toMatchObject({
      cancelledCount: 0,
      finalResults: { finalized: 1, passed: 1 },
    });

    const officialResultsAfterArchive = await request(app)
      .post('/api/exports/review-results')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ format: 'json', schoolYear, targetLevel: Level.city })
      .expect(201);
    expect(officialResultsAfterArchive.body.data.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentCode, finalStatus: FinalStatus.passed }),
      ]),
    );

    await request(app)
      .post(`/api/manager/applications/${applicationId}/unarchive`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({})
      .expect(200);
    const activeListAfterUnarchive = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, workspaceId, q: studentCode })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(activeListAfterUnarchive.body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: applicationId })]),
    );
  }, 600_000);
});
