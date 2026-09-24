import {
  ApplicationStatus,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  EventStatus,
  IndexingStatus,
  ResolutionStatus,
  ReviewTaskStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  evidence: { findMany: vi.fn() },
  reviewTask: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  officerSpecialization: { findMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
  resolutionCase: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { EvidencesService } from '../../src/modules/evidences/evidences.service';
import { EventRegistryService } from '../../src/modules/event-registry/event-registry.service';
import { ResolutionService } from '../../src/modules/resolution/resolution.service';
import { ReviewAssignmentService } from '../../src/modules/review/review-assignment.service';
import { ReviewRepository } from '../../src/modules/review/review.repository';
import { ReviewService } from '../../src/modules/review/review.service';
import { ErrorCodes } from '../../src/shared/errors/error-codes';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const workspaceA = 'workspace-a';
const workspaceB = 'workspace-b';

function user(role: Role, workspaceId = workspaceA): AuthenticatedUser {
  return {
    id: 'actor-a',
    email: 'actor@example.test',
    fullName: 'Actor A',
    role,
    studentCode: null,
    className: null,
    faculty: 'Faculty A',
    avatarUrl: null,
    workspaceId,
    workspace: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.application.findUnique.mockResolvedValue(null);
  prismaMock.evidence.findMany.mockResolvedValue([]);
  prismaMock.reviewTask.findMany.mockResolvedValue([]);
  prismaMock.reviewTask.updateMany.mockRejectedValue(new Error('claim write reached'));
  prismaMock.officerSpecialization.findMany.mockResolvedValue([]);
  prismaMock.officerSpecialization.findFirst.mockResolvedValue(null);
  prismaMock.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  prismaMock.$transaction.mockRejectedValue(new Error('mutation transaction reached'));
});

describe('security baseline workspace boundaries', () => {
  it('builds City Officer task queries against active School workspaces and specializations', async () => {
    prismaMock.officerSpecialization.findMany.mockResolvedValue([
      { criterion: Criterion.academic },
    ]);
    const cityOfficer = {
      ...user(Role.city_officer, 'city-workspace'),
      workspace: {
        id: 'city-workspace',
        code: 'DANANG_CITY',
        type: WorkspaceType.CITY,
        name: 'Da Nang',
        shortName: 'DN',
      },
    };
    const where = await new ReviewRepository().buildTaskWhere(cityOfficer, {
      page: 1,
      limit: 10,
    } as never);

    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { workspace: { is: { type: 'SCHOOL', isActive: true } } },
      ]),
      criterion: { in: [Criterion.academic] },
    });
  });

  it('lets a specialized City Officer claim an unassigned active School task atomically', async () => {
    const schoolTask = {
      id: 'task-school-a',
      workspaceId: workspaceA,
      workspace: { type: 'SCHOOL', isActive: true },
      applicationId: 'application-a',
      collectiveProfileId: null,
      assignedOfficerId: null,
      criterion: Criterion.academic,
      status: 'waiting',
      decision: null,
      officerNote: null,
      officerSuggestedLevel: null,
      levelAssessmentJson: null,
      decisionReason: null,
      supplementRequestJson: null,
      dueDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignedOfficer: null,
      collectiveProfile: null,
      _count: { evidences: 0 },
      application: {
        id: 'application-a',
        workspaceId: workspaceA,
        schoolYear: '2025-2026',
        targetLevel: 'city',
        applicationType: 'individual',
        status: 'under_review',
        student: {
          id: 'student-a',
          fullName: 'Student A',
          studentCode: 'S001',
          className: 'A1',
          faculty: 'Faculty A',
          email: 'student@example.test',
        },
        metrics: [],
        precheckResults: [],
        cascadeReviews: [],
      },
      evidences: [],
    };
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ id: 'spec-1' });
    prismaMock.reviewTask.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.reviewTask.findUniqueOrThrow.mockResolvedValue({
      ...schoolTask,
      assignedOfficerId: 'actor-a',
      status: 'reviewing',
    });
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(schoolTask) } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );
    const cityOfficer = {
      ...user(Role.city_officer, 'city-workspace'),
      workspace: {
        id: 'city-workspace',
        code: 'DANANG_CITY',
        type: WorkspaceType.CITY,
        name: 'Da Nang',
        shortName: 'DN',
      },
    };

    await service.claimTask(cityOfficer, schoolTask.id);

    expect(prismaMock.reviewTask.updateMany).toHaveBeenCalledWith({
      where: { id: schoolTask.id, assignedOfficerId: null },
      data: { assignedOfficerId: cityOfficer.id, status: 'reviewing' },
    });
  });

  it.each([
    ['assigned', 'other-officer', ReviewTaskStatus.reviewing],
    ['final', null, ReviewTaskStatus.accepted],
  ])('rejects City Officer claims for %s School tasks before mutation', async (_case, assignedOfficerId, status) => {
    const task = {
      id: 'task-school-a',
      workspaceId: workspaceA,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      assignedOfficerId,
      status,
      criterion: Criterion.academic,
      application: { student: { faculty: 'Faculty A' } },
      collectiveProfile: null,
    };
    const cityOfficer = {
      ...user(Role.city_officer, 'city-workspace'),
      workspace: {
        id: 'city-workspace',
        code: 'DANANG_CITY',
        type: WorkspaceType.CITY,
        name: 'Da Nang',
        shortName: 'DN',
      },
    };
    const service = new ReviewService(
      { findDetail: vi.fn().mockResolvedValue(task) } as never,
      { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) } as never,
    );

    await expect(service.claimTask(cityOfficer, task.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.reviewTask.updateMany).not.toHaveBeenCalled();
  });

  it('rejects staff evidence upload before storage or database side effects', async () => {
    const evidence = {
      id: 'evidence-b',
      applicationId: 'application-b',
      status: EvidenceStatus.indexed,
      indexingStatus: IndexingStatus.indexed,
      sourceType: EvidenceSourceType.manual_upload,
      evidenceFiles: [],
      application: { workspaceId: workspaceB, status: ApplicationStatus.under_review },
    };
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const storage = { uploadObject: vi.fn().mockResolvedValue(undefined) };
    const jobs = { enqueueIndexingJob: vi.fn() };
    const service = new EvidencesService(repository as never, storage as never, jobs as never);
    const file = {
      originalname: 'evidence.pdf',
      mimetype: 'application/pdf',
      size: 12,
      buffer: Buffer.from('evidence'),
    } as Express.Multer.File;

    await expect(service.uploadFile(user(Role.officer), evidence.id, file)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(jobs.enqueueIndexingJob).not.toHaveBeenCalled();
  });

  it('keeps student evidence uploads limited to the application owner', async () => {
    const evidence = {
      id: 'evidence-a',
      applicationId: 'application-a',
      status: EvidenceStatus.indexed,
      indexingStatus: IndexingStatus.indexed,
      sourceType: EvidenceSourceType.manual_upload,
      evidenceFiles: [],
      application: {
        workspaceId: workspaceA,
        status: ApplicationStatus.draft,
        studentId: 'student-owner',
      },
    };
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const storage = { uploadObject: vi.fn().mockResolvedValue(undefined) };
    const service = new EvidencesService(repository as never, storage as never, {} as never);
    const file = {
      originalname: 'evidence.pdf',
      mimetype: 'application/pdf',
      size: 12,
      buffer: Buffer.from('evidence'),
    } as Express.Multer.File;

    await expect(service.uploadFile(user(Role.student), evidence.id, file)).rejects.toMatchObject({
      statusCode: 403,
    });

    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it.each([Role.manager, Role.officer])(
    'rejects %s from another workspace before ensuring review tasks',
    async (role) => {
      prismaMock.application.findUnique.mockResolvedValue({
        id: 'application-b',
        workspaceId: workspaceB,
        status: ApplicationStatus.under_review,
        student: { faculty: 'Faculty B' },
      });
      const service = new ReviewService({} as never, {} as never);

      await expect(
        service.ensureReviewTasks(user(role), 'application-b', {}),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(prismaMock.evidence.findMany).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a cross-workspace task claim before changing assignment', async () => {
    const task = {
      id: 'task-b',
      workspaceId: workspaceB,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      assignedOfficerId: null,
      status: ReviewTaskStatus.waiting,
      criterion: Criterion.ethics,
      application: { student: { faculty: 'Faculty B' } },
      collectiveProfile: null,
    };
    const reviewRepository = { findDetail: vi.fn().mockResolvedValue(task) };
    const assignmentService = { canOfficerHandleCriterion: vi.fn().mockResolvedValue(true) };
    const service = new ReviewService(reviewRepository as never, assignmentService as never);

    await expect(service.claimTask(user(Role.officer), task.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(assignmentService.canOfficerHandleCriterion).not.toHaveBeenCalled();
    expect(prismaMock.reviewTask.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['status update', (service: ResolutionService, actor: AuthenticatedUser) =>
      service.updateCaseStatus(actor, 'case-b', { status: 'closed', note: 'test' } as never)],
    ['reopen', (service: ResolutionService, actor: AuthenticatedUser) =>
      service.reopenCase(actor, 'case-b', { reason: 'test' } as never)],
  ])('rejects cross-workspace resolution %s before mutation', async (_name, invoke) => {
    prismaMock.resolutionCase.findUnique.mockResolvedValue({
      id: 'case-b',
      workspaceId: workspaceB,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      applicationId: 'application-b',
      status: ResolutionStatus.resolved,
      committeeDecision: null,
      closedAt: new Date(),
    });
    const service = new ResolutionService();

    await expect(invoke(service, user(Role.committee))).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an event file belonging to another event before loading its roster job', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({
        id: 'event-a',
        workspaceId: workspaceA,
        status: EventStatus.active,
        convertedValue: 1,
      }),
      findEventFile: vi.fn().mockResolvedValue({
        id: 'event-file-b',
        eventId: 'event-b',
        fileId: 'file-b',
      }),
      findLatestCompletedRosterJob: vi.fn(),
    };
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    await expect(
      service.confirmIndex(user(Role.manager), 'event-a', {
        eventFileId: 'event-file-b',
        columnMapping: { studentCode: 'studentCode' },
      } as never),
    ).rejects.toMatchObject({ code: ErrorCodes.EVENT_FILE_NOT_FOUND });

    expect(repository.findLatestCompletedRosterJob).not.toHaveBeenCalled();
  });

  it('filters automatic-assignment candidates to the task workspace', async () => {
    const service = new ReviewService({} as never, {} as never);
    const findAssignedOfficer = (service as unknown as {
      findAssignedOfficer: (criterion: Criterion, faculty: string, workspaceId: string) => Promise<string | null>;
    }).findAssignedOfficer.bind(service);

    await findAssignedOfficer(Criterion.ethics, 'Faculty A', workspaceA);

    expect(prismaMock.officerSpecialization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          officer: expect.objectContaining({
            workspace: { is: { type: WorkspaceType.CITY, isActive: true } },
            role: Role.city_officer,
          }),
        }),
      }),
    );
  });

  it('filters submit-time automatic assignment candidates to the application workspace', async () => {
    const officer = { id: 'officer-a', workspaceId: workspaceA };
    prismaMock.officerSpecialization.findMany.mockResolvedValue([
      { officerId: officer.id, facultyScope: 'Faculty A', officer },
    ]);
    prismaMock.reviewTask.groupBy.mockResolvedValue([]);
    const service = new ReviewAssignmentService();

    await service.assignOfficerForCriterion({
      criterion: Criterion.ethics,
      faculty: 'Faculty A',
      workspaceId: workspaceA,
    });

    expect(prismaMock.officerSpecialization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          officer: expect.objectContaining({
            role: Role.city_officer,
            workspace: { is: { type: WorkspaceType.CITY, isActive: true } },
          }),
        }),
      }),
    );
  });

  it('uses criterion specialization, not facultyScope, for claim capability', async () => {
    prismaMock.officerSpecialization.findFirst.mockResolvedValue({ facultyScope: 'Faculty B' });
    const service = new ReviewAssignmentService();

    await expect(
      service.canOfficerHandleCriterion('officer-a', Criterion.ethics, 'Faculty A'),
    ).resolves.toBe(true);
  });
});
