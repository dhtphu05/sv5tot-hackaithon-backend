import {
  ApplicationType,
  Criterion,
  EvidenceStatus,
  FinalStatus,
  Level,
  MetricType,
  ReviewDecision,
  ReviewTaskStatus,
  Role,
} from '@prisma/client';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import { PasswordService } from '../../src/modules/auth/password.service';

const app = createApp();
const password = 'Password@123';
const schoolYear = '2098-2099';
const faculty = 'E2E Faculty';

const accounts = {
  student: 'e2e.student@dut.udn.vn',
  manager: 'e2e.manager@dut.udn.vn',
  committee: 'e2e.committee@dut.udn.vn',
  officers: {
    [Criterion.ethics]: 'e2e.officer.ethics@dut.udn.vn',
    [Criterion.academic]: 'e2e.officer.academic@dut.udn.vn',
    [Criterion.physical]: 'e2e.officer.physical@dut.udn.vn',
    [Criterion.volunteer]: 'e2e.officer.volunteer@dut.udn.vn',
    [Criterion.integration]: 'e2e.officer.integration@dut.udn.vn',
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
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

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
  studentCode?: string;
  className?: string;
  specialization?: Criterion;
}) {
  const passwordHash = await new PasswordService().hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      fullName: input.fullName,
      role: input.role,
      passwordHash,
      studentCode: input.studentCode,
      className: input.className,
      faculty,
      isActive: true,
    },
    create: {
      email: input.email,
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
    const student = await seedUser({
      email: accounts.student,
      role: Role.student,
      fullName: 'E2E Student',
      studentCode: 'E2E209899',
      className: 'E2E-CLASS',
    });
    await seedUser({
      email: accounts.manager,
      role: Role.manager,
      fullName: 'E2E Manager',
    });
    await seedUser({
      email: accounts.committee,
      role: Role.committee,
      fullName: 'E2E Committee',
    });

    for (const criterion of criteria) {
      await seedUser({
        email: accounts.officers[criterion],
        role: Role.officer,
        fullName: `E2E Officer ${criterion}`,
        specialization: criterion,
      });
    }

    await prisma.application.deleteMany({
      where: {
        studentId: student.id,
        schoolYear,
        applicationType: ApplicationType.individual,
      },
    });
  });

  it('covers draft, evidence upload, submission, officer review, manager dashboard and finalization', async () => {
    const student = await login(accounts.student);
    const manager = await login(accounts.manager);
    const committee = await login(accounts.committee);

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
      .send({ schoolYear, targetLevel: Level.school })
      .expect(200);
    const applicationId = started.body.data.id as string;
    expect(started.body.data).toMatchObject({
      id: applicationId,
      status: 'draft',
      targetLevel: Level.school,
    });

    const draft = await request(app)
      .patch(`/api/applications/${applicationId}/draft`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        targetLevel: Level.school,
        basicInfo: {
          fullName: 'E2E Student',
          studentCode: 'E2E209899',
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
      { metricType: MetricType.gpa, value: 3.6, scale: 4 },
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
      const evidenceId = created.body.data.id as string;
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

    const listedEvidences = await request(app)
      .get(`/api/applications/${applicationId}/evidences`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect(listedEvidences.body.data).toHaveLength(criteria.length);

    const submitted = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('Authorization', `Bearer ${student.accessToken}`)
      .send({
        allowSubmitWithWarnings: true,
        studentNote: 'Submit E2E non-AI application.',
      })
      .expect(200);
    expect(submitted.body.data.application).toMatchObject({
      id: applicationId,
      status: 'under_review',
    });
    expect(submitted.body.data.reviewTasks).toHaveLength(criteria.length);
    for (const task of submitted.body.data.reviewTasks) {
      expect(task).toMatchObject({
        criterion: expect.stringMatching(
          /^(ethics|academic|physical|volunteer|integration)$/,
        ),
        status: ReviewTaskStatus.waiting,
        assignedOfficer: expect.objectContaining({ id: expect.any(String) }),
      });
    }

    const managerApplications = await request(app)
      .get('/api/manager/applications')
      .query({ schoolYear, status: 'under_review', q: 'E2E Student' })
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(managerApplications.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: applicationId,
          status: 'under_review',
          reviewProgress: expect.objectContaining({ totalTasks: criteria.length }),
        }),
      ]),
    );

    const workloads = await request(app)
      .get('/api/manager/workloads')
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(workloads.body.data.officers.some((officer: { workload: { totalActive: number } }) => officer.workload.totalActive > 0)).toBe(
      true,
    );

    for (const criterion of criteria) {
      const officer = await login(accounts.officers[criterion]);
      const taskList = await request(app)
        .get('/api/review/tasks')
        .query({ applicationId, criterion, assignedToMe: true })
        .set('Authorization', `Bearer ${officer.accessToken}`)
        .expect(200);
      expect(taskList.body.data).toHaveLength(1);
      const task = taskList.body.data[0];

      const detail = await request(app)
        .get(`/api/review/tasks/${task.id}`)
        .set('Authorization', `Bearer ${officer.accessToken}`)
        .expect(200);
      expect(detail.body.data.task).toMatchObject({
        id: task.id,
        criterion,
        status: ReviewTaskStatus.reviewing,
      });
      expect(detail.body.data.evidences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: evidenceIds[criterion],
            criterion,
          }),
        ]),
      );

      const decision = await request(app)
        .post(`/api/review/tasks/${task.id}/decision`)
        .set('Authorization', `Bearer ${officer.accessToken}`)
        .send({
          decision: ReviewDecision.accepted,
          officerNote: `Accepted ${criterion} in E2E flow.`,
          evidenceDecisions: [
            {
              evidenceId: evidenceIds[criterion],
              status: EvidenceStatus.accepted,
              note: 'Valid uploaded proof.',
            },
          ],
        })
        .expect(200);
      expect(decision.body.data.reviewProgress.accepted).toBeGreaterThanOrEqual(1);
    }

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
        accepted: criteria.length,
        canAggregate: true,
      },
      resolutionSummary: { open: 0 },
      suggestedFinalStatus: FinalStatus.passed,
      suggestedFinalLevel: Level.school,
      canFinalize: true,
    });

    const finalized = await request(app)
      .post(`/api/manager/applications/${applicationId}/finalize`)
      .set('Authorization', `Bearer ${committee.accessToken}`)
      .send({
        finalStatus: FinalStatus.passed,
        finalLevel: Level.school,
        finalNote: 'E2E committee confirms non-AI application flow.',
        overrideAggregation: false,
        notifyStudent: true,
      })
      .expect(200);
    expect(finalized.body.data.finalResult).toMatchObject({
      finalStatus: FinalStatus.passed,
      finalLevel: Level.school,
    });
    expect(finalized.body.data.application).toMatchObject({
      id: applicationId,
      status: 'completed',
      finalStatus: FinalStatus.passed,
    });

    const notifications = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${student.accessToken}`)
      .expect(200);
    expect(notifications.body.data).toEqual(
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
    expect(timeline.body.data.items.length).toBeGreaterThan(0);
  });
});
