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

<<<<<<< HEAD
function activeTask() {
=======
function activeTask(targetLevel: Level = Level.city) {
>>>>>>> origin/main
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
<<<<<<< HEAD
        evidenceScopeJson: { evidenceIds: ['evidence-volunteer'] },
=======
        evidenceScopeJson: null,
>>>>>>> origin/main
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
<<<<<<< HEAD
      targetLevel: Level.city,
=======
      targetLevel,
>>>>>>> origin/main
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
<<<<<<< HEAD
        {
          id: 'evidence-ethics',
          applicationId: 'application-a',
          criterion: Criterion.ethics,
          status: EvidenceStatus.accepted,
          indexingStatus: IndexingStatus.failed,
          evidenceCard: null,
        },
=======
>>>>>>> origin/main
      ],
      student: {
        id: 'student-a',
        email: 'student@example.test',
        fullName: 'Student A',
      },
    },
  };
}

<<<<<<< HEAD
function buildDb(remainingSupplementTasks: number, updateCount = 1) {
  const task = activeTask();
=======
function buildDb(
  remainingSupplementTasks: number,
  supplementDeadlineAt = new Date('2099-03-01T00:00:00.000Z'),
  targetLevel: Level = Level.city,
) {
  const task = activeTask(targetLevel);
>>>>>>> origin/main
  const tx = {
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join('');
      if (sql.includes('FROM "Application"')) {
        return [{ id: 'application-a', cancelledAt: null }];
      }
      if (sql.includes('FROM "CityReviewSeason"')) {
<<<<<<< HEAD
        return [{ supplementDeadlineAt: new Date('2099-03-01T00:00:00.000Z') }];
=======
        return [{ supplementDeadlineAt }];
>>>>>>> origin/main
      }
      return [];
    }),
    reviewTask: {
      findUnique: vi.fn().mockResolvedValue(task),
<<<<<<< HEAD
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
=======
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
>>>>>>> origin/main
      count: vi.fn().mockResolvedValue(remainingSupplementTasks),
    },
    supplementRequest: {
      create: vi.fn(),
<<<<<<< HEAD
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
=======
      update: vi.fn().mockImplementation(async ({ data }) => ({
>>>>>>> origin/main
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
<<<<<<< HEAD
    $transaction: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
=======
    $transaction: vi.fn(async (callback) => callback(tx)),
>>>>>>> origin/main
  };
  return { db, tx, task };
}

<<<<<<< HEAD
describe('canonical supplement resubmit', () => {
  it('resubmits only the selected task and preserves another active supplement task', async () => {
=======
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
>>>>>>> origin/main
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
<<<<<<< HEAD
        where: expect.objectContaining({ criterion: Criterion.volunteer }),
      }),
    );
    expect(result.reviewTask).toEqual({ id: 'task-volunteer', status: ReviewTaskStatus.waiting });
    expect(result.application.status).toBe(ApplicationStatus.supplement_required);
  });

  it('moves the application back to under_review when the selected task is the last supplement', async () => {
=======
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
>>>>>>> origin/main
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

<<<<<<< HEAD
  it('does not write application state when the selected task changed before resubmit', async () => {
    const { db, tx } = buildDb(0, 0);
=======
  it('preserves the City supplement deadline before mutating the selected task', async () => {
    const { db, tx } = buildDb(0, new Date('2000-01-01T00:00:00.000Z'));
>>>>>>> origin/main
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'notification-a' }) };
    const service = new SupplementResubmitService(db as never, notifications as never);

    await expect(service.resubmit(student, 'task-volunteer')).rejects.toMatchObject({
      statusCode: 409,
<<<<<<< HEAD
    });
    expect(tx.application.update).not.toHaveBeenCalled();
  });
});

describe('generic application submit mode', () => {
  it('blocks generic submit when more than one submitted criterion is waiting for supplement', async () => {
    const db = {
      application: {
        findFirst: vi.fn().mockResolvedValue({
          status: ApplicationStatus.supplement_required,
          submittedAt: new Date('2026-09-01T00:00:00.000Z'),
          reviewTasks: [
            { id: 'task-academic', criterion: Criterion.academic },
            { id: 'task-ethics', criterion: Criterion.ethics },
          ],
        }),
      },
    };
    const service = new ApplicationSubmissionModeService(db as never);

    await expect(service.assertGenericSubmitAllowed(student, 'application-a')).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_NOT_SUBMITTABLE',
    });
=======
      code: 'CITY_SUPPLEMENT_WINDOW_CLOSED',
    });
    expect(tx.reviewTask.updateMany).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
  });

  it('rejects supplement resubmission for a legacy school-level individual application', async () => {
    const { db, tx } = buildDb(0, undefined, Level.school);
    const notifications = { create: vi.fn().mockResolvedValue({ id: 'notification-a' }) };
    const service = new SupplementResubmitService(db as never, notifications as never);

    await expect(service.resubmit(student, 'task-volunteer')).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_NOT_SUBMITTABLE',
    });
    expect(tx.reviewTask.updateMany).not.toHaveBeenCalled();
    expect(tx.application.update).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
>>>>>>> origin/main
  });
});
