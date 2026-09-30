import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceStatus,
  IndexingStatus,
  Level,
  ReviewTaskStatus,
  Role,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../src/shared/types/auth';
import { ApplicationSubmissionModeService } from '../../src/modules/applications/application-submission-mode.service';
import { SupplementResubmitService } from '../../src/modules/applications/supplement-resubmit.service';

const student = {
  id: 'student-a',
  role: Role.student,
  workspaceId: 'school-a',
} as unknown as AuthenticatedUser;

function activeTask() {
  return {
    id: 'task-volunteer',
    applicationId: 'application-a',
    workspaceId: 'city-a',
    criterion: Criterion.volunteer,
    status: ReviewTaskStatus.supplement_required,
    assignedOfficerId: 'officer-a',
    dueDate: new Date('2099-02-01T00:00:00.000Z'),
    supplementRequestJson: null,
    officerNote: 'Bổ sung giấy xác nhận.',
    supplementRequests: [
      {
        id: 'supplement-a',
        status: 'active',
        officialMessage: 'Bổ sung giấy xác nhận.',
        requestedFieldsJson: [],
        evidenceScopeJson: null,
        acceptedEvidenceTypesJson: null,
        deadline: new Date('2099-02-01T00:00:00.000Z'),
        historyJson: [],
      },
    ],
    application: {
      id: 'application-a',
      studentId: 'student-a',
      schoolYear: '2025-2026',
      applicationType: ApplicationType.individual,
      targetLevel: Level.city,
      status: ApplicationStatus.supplement_required,
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      cancelledAt: null,
      evidences: [
        {
          id: 'evidence-volunteer',
          applicationId: 'application-a',
          criterion: Criterion.volunteer,
          status: EvidenceStatus.indexed,
          indexingStatus: IndexingStatus.failed,
          evidenceCard: null,
        },
      ],
      student: {
        id: 'student-a',
        email: 'student@example.test',
        fullName: 'Student A',
      },
    },
  };
}

function buildDb(
  remainingSupplementTasks: number,
  supplementDeadlineAt = new Date('2099-03-01T00:00:00.000Z'),
) {
  const task = activeTask();
  const tx = {
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('FROM "Application"')) {
        return [{ id: 'application-a', cancelledAt: null }];
      }
      if (sql.includes('FROM "CityReviewSeason"')) {
        return [{ supplementDeadlineAt }];
      }
      return [];
    }),
    reviewTask: {
      findUnique: vi.fn().mockResolvedValue(task),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(remainingSupplementTasks),
    },
    supplementRequest: {
      create: vi.fn(),
      update: vi.fn().mockImplementation(async ({ data }) => ({
        ...task.supplementRequests[0],
        ...data,
      })),
    },
    reviewTaskEvidence: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    application: { update: vi.fn().mockResolvedValue({}) },
    evidence: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    reviewTask: { findUnique: vi.fn().mockResolvedValue(task) },
    application: { findFirst: vi.fn() },
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
  return { db, tx, task };
}

function genericSupplementApplication(criteria: Criterion[]) {
  return {
    status: ApplicationStatus.supplement_required,
    submittedAt: new Date('2026-09-01T00:00:00.000Z'),
    reviewTasks: criteria.map((criterion) => ({
      id: `task-${criterion}`,
      criterion,
      status: ReviewTaskStatus.supplement_required,
    })),
  };
}

describe('canonical supplement resubmit', () => {
  it('keeps generic submit compatibility when exactly one supplement task is active', async () => {
    const db = {
      application: {
        findFirst: vi
          .fn()
          .mockResolvedValue(genericSupplementApplication([Criterion.volunteer])),
      },
    };
    const service = new ApplicationSubmissionModeService(db as never);

    await expect(
      service.assertGenericSubmitAllowed(student, 'application-a'),
    ).resolves.toBeUndefined();
  });

  it('rejects generic application submit when multiple supplement tasks are active', async () => {
    const db = {
      application: {
        findFirst: vi
          .fn()
          .mockResolvedValue(
            genericSupplementApplication([Criterion.volunteer, Criterion.integration]),
          ),
      },
    };
    const service = new ApplicationSubmissionModeService(db as never);

    await expect(service.assertGenericSubmitAllowed(student, 'application-a')).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_NOT_SUBMITTABLE',
    });
  });

  it('resubmits only the selected task and keeps the application in supplement_required while another task still needs supplement', async () => {
    const { db, tx } = buildDb(1);
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'notification-a' }) };
    const service = new SupplementResubmitService(db as never, notifications as never);

    const result = await service.resubmit(student, 'task-volunteer');

    expect(tx.reviewTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-volunteer',
        applicationId: 'application-a',
        status: ReviewTaskStatus.supplement_required,
      },
      data: expect.objectContaining({
        status: ReviewTaskStatus.waiting,
        decision: null,
      }),
    });
    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-a' },
      data: { status: ApplicationStatus.supplement_required },
    });
    expect(tx.evidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          applicationId: 'application-a',
          criterion: Criterion.volunteer,
        }),
      }),
    );
    expect(result.reviewTask).toEqual({ id: 'task-volunteer', status: ReviewTaskStatus.waiting });
    expect(result.application).toEqual({
      id: 'application-a',
      status: ApplicationStatus.supplement_required,
    });
  });

  it('moves the application back to under_review when the selected task is the last outstanding supplement', async () => {
    const { db, tx } = buildDb(0);
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'notification-a' }) };
    const service = new SupplementResubmitService(db as never, notifications as never);

    const result = await service.resubmit(student, 'task-volunteer');

    expect(tx.application.update).toHaveBeenCalledWith({
      where: { id: 'application-a' },
      data: { status: ApplicationStatus.under_review },
    });
    expect(result.application.status).toBe(ApplicationStatus.under_review);
  });

  it('preserves the City supplement deadline before mutating the selected task', async () => {
    const { db, tx } = buildDb(0, new Date('2000-01-01T00:00:00.000Z'));
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'notification-a' }) };
    const service = new SupplementResubmitService(db as never, notifications as never);

    await expect(service.resubmit(student, 'task-volunteer')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CITY_SUPPLEMENT_WINDOW_CLOSED',
    });
    expect(tx.reviewTask.updateMany).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
  });
});
