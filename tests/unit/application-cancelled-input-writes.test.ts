import {
  ApplicationStatus,
  ApplicationType,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Level,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  application: { findUnique: vi.fn() },
}));
const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  application: { updateMany: vi.fn(), applicationDraftSnapshot: { create: vi.fn() } },
  file: { create: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks }));

import { ApplicationsService } from '../../src/modules/applications/applications.service';
import { EvidencesService } from '../../src/modules/evidences/evidences.service';
import { CriteriaCompletionService } from '../../src/modules/criteria-completion/criteria-completion.service';

const application = {
  id: 'application-1',
  studentId: 'student-1',
  workspaceId: 'school-1',
  applicationType: ApplicationType.individual,
  targetLevel: Level.city,
  status: ApplicationStatus.draft,
  cancelledAt: new Date('2026-09-28T00:00:00.000Z'),
  currentDraftVersion: 1,
  schoolYear: '2025-2026',
  submittedAt: null,
  readinessScore: 0,
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
};

const student = {
  id: 'student-1',
  workspaceId: 'school-1',
  role: Role.student,
  email: 'student@example.test',
  fullName: 'Student One',
  studentCode: '0001',
  className: 'A1',
  faculty: null,
  avatarUrl: null,
  workspace: {
    id: 'school-1',
    code: 'SCHOOL',
    type: WorkspaceType.SCHOOL,
    name: 'School',
    shortName: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ id: application.id, cancelledAt: application.cancelledAt }]);
  mocks.$transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) =>
    callback(tx),
  );
  mocks.application.findUnique.mockResolvedValue({
    ...application,
    student,
    workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    evidences: [],
    metrics: [],
    requirementResponses: [],
    reviewTasks: [],
  });
});

describe('cancelled application input writes', () => {
  it('rejects draft edits before creating snapshots or audit records', async () => {
    const repository = { findBareById: vi.fn().mockResolvedValue(application) };
    const service = new ApplicationsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.updateTargetLevel(student, application.id, { targetLevel: Level.city }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
      message: 'Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.',
    });

    expect(tx.application.updateMany).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('rejects autosave and submit before snapshot, precheck, or submit writes', async () => {
    const repository = { findBareById: vi.fn().mockResolvedValue(application) };
    const precheck = { prepareForSubmission: vi.fn(), run: vi.fn() };
    const service = new ApplicationsService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      precheck as never,
      {} as never,
    );

    await expect(service.autosaveDraft(student, application.id, {} as never)).rejects.toMatchObject(
      {
        statusCode: 409,
        code: 'APPLICATION_CANCELLED',
      },
    );
    await expect(service.submit(student, application.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
    });

    expect(precheck.prepareForSubmission).not.toHaveBeenCalled();
    expect(precheck.run).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('rejects supplement reopen before workflow, audit, notification, or outbox writes', async () => {
    const cityManager = {
      ...student,
      id: 'city-manager',
      role: Role.city_manager,
      workspaceId: 'city-workspace',
      workspace: {
        id: 'city-workspace',
        code: 'CITY',
        type: WorkspaceType.CITY,
        name: 'City',
        shortName: null,
      },
    };
    const notifications = { create: vi.fn() };
    const outbox = { enqueue: vi.fn() };
    mocks.application.findUnique.mockResolvedValue({
      ...application,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    });
    const service = new ApplicationsService(
      {} as never,
      notifications as never,
      {} as never,
      outbox as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.reopenSupplement(cityManager, application.id, {
        reason: 'Please add evidence',
      } as never),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
    });

    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects evidence upload before writing to object storage', async () => {
    const evidence = {
      id: 'evidence-1',
      applicationId: application.id,
      application: {
        ...application,
        student,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
      sourceType: EvidenceSourceType.manual_upload,
      status: 'draft',
      indexingStatus: 'not_started',
      evidenceFiles: [],
      evidenceCard: null,
      criterion: 'academic',
      evidenceName: 'Transcript',
    };
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const storage = { uploadObject: vi.fn(), deleteObject: vi.fn() };
    const service = new EvidencesService(
      repository as never,
      storage as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.uploadFile(student, evidence.id, {
        originalname: 'transcript.pdf',
        mimetype: 'application/pdf',
        size: 10,
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'APPLICATION_CANCELLED',
    });

    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(tx.file.create).not.toHaveBeenCalled();
  });

  it('removes the uploaded object when cancellation wins before file metadata commits', async () => {
    const evidence = {
      id: 'evidence-1',
      applicationId: application.id,
      application: {
        ...application,
        cancelledAt: null,
        student,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.draft,
      indexingStatus: IndexingStatus.not_started,
      evidenceFiles: [],
      evidenceCard: null,
      criterion: 'academic',
      evidenceName: 'Transcript',
    };
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const storage = { uploadObject: vi.fn(), deleteObject: vi.fn() };
    const service = new EvidencesService(
      repository as never,
      storage as never,
      {} as never,
      {} as never,
    );
    tx.$queryRaw.mockResolvedValueOnce([{ id: application.id, cancelledAt: new Date() }]);

    await expect(
      service.uploadFile(student, evidence.id, {
        originalname: 'transcript.pdf',
        mimetype: 'application/pdf',
        size: 10,
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File),
    ).rejects.toMatchObject({ code: 'APPLICATION_CANCELLED' });

    expect(storage.uploadObject).toHaveBeenCalledOnce();
    expect(storage.deleteObject).toHaveBeenCalledOnce();
    expect(tx.file.create).not.toHaveBeenCalled();
  });

  it('rejects evidence create, update, delete, indexing, card correction, and confirmation', async () => {
    const evidence = {
      id: 'evidence-1',
      applicationId: application.id,
      application: {
        ...application,
        student,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.draft,
      indexingStatus: IndexingStatus.not_started,
      evidenceFiles: [
        { id: 'link-1', fileId: 'file-1', file: { filePath: 'key', storageType: 'local' } },
      ],
      evidenceCard: {
        id: 'card-1',
        updatedAt: new Date(),
        confirmationStatus: 'pending',
        extractedFieldsJson: {},
        normalizedFieldsJson: {},
        confirmedFieldsJson: {},
        fieldConfidenceJson: {},
        warningsJson: [],
      },
      criterion: 'academic',
      evidenceName: 'Transcript',
    };
    const repository = {
      findApplication: vi.fn().mockResolvedValue({ ...application, student }),
      findEvidence: vi.fn().mockResolvedValue(evidence),
    };
    const storage = { uploadObject: vi.fn(), deleteObject: vi.fn() };
    const jobs = { enqueueIndexingJob: vi.fn() };
    const service = new EvidencesService(
      repository as never,
      storage as never,
      jobs as never,
      {} as never,
    );

    await expect(
      service.create(student, application.id, {
        evidenceName: 'New',
        criterion: 'academic',
        sourceType: EvidenceSourceType.manual_upload,
      } as never),
    ).rejects.toMatchObject({ code: 'APPLICATION_CANCELLED' });
    await expect(
      service.update(student, evidence.id, { evidenceName: 'Updated' } as never),
    ).rejects.toMatchObject({ code: 'APPLICATION_CANCELLED' });
    await expect(service.delete(student, evidence.id)).rejects.toMatchObject({
      code: 'APPLICATION_CANCELLED',
    });
    await expect(service.startIndexing(student, evidence.id, {} as never)).rejects.toMatchObject({
      code: 'APPLICATION_CANCELLED',
    });
    await expect(
      service.saveCardCorrections(student, evidence.id, { fields: {} } as never),
    ).rejects.toMatchObject({ code: 'APPLICATION_CANCELLED' });
    await expect(service.confirmCard(student, evidence.id, {} as never)).rejects.toMatchObject({
      code: 'APPLICATION_CANCELLED',
    });

    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(jobs.enqueueIndexingJob).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('denies manager and admin edits to City student-owned criterion and evidence content', async () => {
    const activeApplication = {
      ...application,
      cancelledAt: null,
      student,
    };
    const criteria = new CriteriaCompletionService({
      findApplicationContext: vi.fn().mockResolvedValue(activeApplication),
    } as never);
    const manager = { ...student, id: 'manager-1', role: Role.manager };
    const admin = { ...manager, id: 'admin-1', role: Role.admin };
    const evidenceRepository = {
      findApplication: vi.fn().mockResolvedValue({ ...activeApplication, student }),
      findEvidence: vi.fn().mockResolvedValue({
        id: 'evidence-1',
        applicationId: application.id,
        application: {
          ...activeApplication,
          student,
          workspace: { type: WorkspaceType.SCHOOL, isActive: true },
        },
        criterion: 'academic',
        evidenceFiles: [],
      }),
    };
    const evidenceService = new EvidencesService(
      evidenceRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      criteria.createResponse(manager, application.id, {} as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(criteria.createResponse(admin, application.id, {} as never)).rejects.toMatchObject(
      { statusCode: 403 },
    );
    await expect(
      evidenceService.create(manager, application.id, {} as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(evidenceService.create(admin, application.id, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
