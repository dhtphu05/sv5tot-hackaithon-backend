import {
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  IndexingStatus,
  Role,
  WorkspaceType,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  evidence: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: mocks }));

import { EvidencesRepository } from '../../src/modules/evidences/evidences.repository';
import { EvidencesService } from '../../src/modules/evidences/evidences.service';

describe('evidence read performance', () => {
  it('loads only evidence-list fields instead of full application and OCR records', async () => {
    mocks.evidence.findMany.mockResolvedValue([]);
    mocks.evidence.count.mockResolvedValue(0);
    mocks.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));

    const repository = new EvidencesRepository(mocks as never);
    await repository.list('application-1', { page: 1, limit: 20 } as never);

    const options = mocks.evidence.findMany.mock.calls[0][0];
    expect(options.include).not.toHaveProperty('application');
    expect(options.include).not.toHaveProperty('event');
    expect(options.include).not.toHaveProperty('collectiveProfile');
    expect(options.include.evidenceFiles.include.file.select).toEqual({
      id: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      publicUrl: true,
    });
    expect(options.include.evidenceCard.select).not.toHaveProperty('rawAiResponse');
    expect(options.include.evidenceCard.select).not.toHaveProperty('rawResponseJson');
  });

  it('starts independent evidence card read queries concurrently', async () => {
    let resolveJob!: (value: null) => void;
    let resolveSmartReader!: (value: null) => void;
    let resolveAudit!: (value: never[]) => void;
    const repository = {
      findEvidence: vi.fn().mockResolvedValue({
        id: 'evidence-1',
        applicationId: 'application-1',
        evidenceName: 'GPA evidence',
        criterion: Criterion.academic,
        sourceType: EvidenceSourceType.manual_upload,
        status: EvidenceStatus.draft,
        indexingStatus: IndexingStatus.not_started,
        confidence: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        application: {
          id: 'application-1',
          studentId: 'student-1',
          workspaceId: 'school-1',
        },
        evidenceFiles: [],
        evidenceCard: null,
      }),
      findLatestEvidenceJob: vi.fn(
        () => new Promise<null>((resolve) => (resolveJob = resolve)),
      ),
      findLatestSmartReaderJob: vi.fn(
        () => new Promise<null>((resolve) => (resolveSmartReader = resolve)),
      ),
      findEvidenceAuditSummaryLogs: vi.fn(
        () => new Promise<never[]>((resolve) => (resolveAudit = resolve)),
      ),
    };
    const service = new EvidencesService(repository as never, {} as never, {} as never, {} as never);
    const student = {
      id: 'student-1',
      workspaceId: 'school-1',
      email: 'student@example.test',
      role: Role.student,
      fullName: 'Student One',
      studentCode: '0001',
      className: 'A1',
      faculty: null,
      avatarUrl: null,
      workspace: null,
    };

    const response = service.getCard(student, 'evidence-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(repository.findLatestEvidenceJob).toHaveBeenCalledOnce();
    expect(repository.findLatestSmartReaderJob).toHaveBeenCalledOnce();
    expect(repository.findEvidenceAuditSummaryLogs).toHaveBeenCalledOnce();

    resolveJob(null);
    resolveSmartReader(null);
    resolveAudit([]);
    await expect(response).resolves.toHaveProperty('evidence.id', 'evidence-1');
  });

  it('does not search for a duplicate OCR job after creating new file IDs', async () => {
    const application = {
      id: 'application-1',
      studentId: 'student-1',
      workspaceId: 'school-1',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'draft',
      cancelledAt: null,
    };
    const evidence = {
      id: 'evidence-1',
      applicationId: application.id,
      evidenceName: 'GPA evidence',
      criterion: Criterion.academic,
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.draft,
      indexingStatus: IndexingStatus.not_started,
      confidence: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      application,
      evidenceFiles: [],
      evidenceCard: null,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: application.id, cancelledAt: null }]),
      file: {
        create: vi.fn().mockResolvedValue({
          id: 'file-1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          filePath: 'evidence/key',
          fileSize: 1024,
          originalName: 'gpa.pdf',
          mimeType: 'application/pdf',
          publicUrl: null,
          storageType: FileStorageType.local,
        }),
      },
      evidenceFile: { create: vi.fn().mockResolvedValue({ id: 'evidence-file-1' }) },
      indexingJob: {
        findMany: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'job-1',
          jobType: 'evidence_ocr',
          status: 'queued',
        }),
      },
      evidence: {
        update: vi.fn().mockResolvedValue({
          status: EvidenceStatus.pending_indexing,
          indexingStatus: IndexingStatus.pending_indexing,
          evidenceFiles: [
            {
              fileRole: 'primary',
              file: {
                id: 'file-1',
                originalName: 'gpa.pdf',
                mimeType: 'application/pdf',
                fileSize: 3,
                publicUrl: null,
              },
            },
          ],
          evidenceCard: null,
        }),
      },
      evidenceCard: { update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    mocks.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const storage = {
      uploadObject: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new EvidencesService(
      repository as never,
      storage as never,
      {} as never,
      audit as never,
    );
    const student = {
      id: 'student-1',
      workspaceId: 'school-1',
      email: 'student@example.test',
      role: Role.student,
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

    const result = await service.uploadFile(
      student,
      evidence.id,
      {
        buffer: Buffer.from('pdf'),
        originalname: 'gpa.pdf',
        mimetype: 'application/pdf',
        size: 3,
      } as never,
    );

    expect(tx.indexingJob.findMany).not.toHaveBeenCalled();
    expect(tx.indexingJob.create).toHaveBeenCalledOnce();
    expect(result.evidence.indexingStatus).toBe(IndexingStatus.pending_indexing);
  });

  it('uses the evidence update result instead of reloading after queueing OCR', async () => {
    const evidence = {
      id: 'evidence-2',
      applicationId: 'application-2',
      evidenceName: 'Transcript',
      criterion: Criterion.academic,
      sourceType: EvidenceSourceType.manual_upload,
      status: EvidenceStatus.draft,
      indexingStatus: IndexingStatus.not_started,
      confidence: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      application: {
        id: 'application-2',
        studentId: 'student-2',
        workspaceId: 'school-2',
      },
      evidenceFiles: [
        {
          id: 'evidence-file-2',
          fileId: 'file-2',
          file: {
            id: 'file-2',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      ],
      evidenceCard: null,
    };
    const repository = { findEvidence: vi.fn().mockResolvedValue(evidence) };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'application-2', cancelledAt: null }]),
      evidence: {
        update: vi.fn().mockResolvedValue({
          status: EvidenceStatus.pending_indexing,
          indexingStatus: IndexingStatus.pending_indexing,
        }),
      },
    };
    const job = { id: 'job-2', status: 'queued', attempts: 0, errorMessage: null };
    mocks.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );
    const jobs = { enqueueIndexingJob: vi.fn().mockResolvedValue({ job, reused: false }) };
    const service = new EvidencesService(repository as never, {} as never, jobs as never, {} as never);
    const student = {
      id: 'student-2',
      workspaceId: 'school-2',
      email: 'student@example.test',
      role: Role.student,
      fullName: 'Student Two',
      studentCode: '0002',
      className: 'A1',
      faculty: null,
      avatarUrl: null,
      workspace: null,
    };

    const result = await service.startIndexing(student, evidence.id, {} as never);

    expect(repository.findEvidence).toHaveBeenCalledOnce();
    expect(result.evidence.indexingStatus).toBe(IndexingStatus.pending_indexing);
  });

  it('returns a newly created evidence DTO without a follow-up evidence read', async () => {
    const application = {
      id: 'application-3',
      studentId: 'student-3',
      workspaceId: 'school-3',
      applicationType: 'individual',
      targetLevel: 'city',
      status: 'draft',
      cancelledAt: null,
    };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: application.id, cancelledAt: null }]),
      evidence: {
        create: vi.fn().mockResolvedValue({
          id: 'evidence-3',
          applicationId: application.id,
          evidenceName: 'GPA evidence',
          criterion: Criterion.academic,
          sourceType: EvidenceSourceType.manual_upload,
          status: EvidenceStatus.draft,
          indexingStatus: IndexingStatus.not_started,
          confidence: null,
          createdAt: now,
          updatedAt: now,
          eventId: null,
        }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-3' }) },
    };
    mocks.$transaction.mockImplementation((callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
    );
    const repository = {
      findApplication: vi.fn().mockResolvedValue(application),
      findEvidence: vi.fn(),
    };
    const service = new EvidencesService(repository as never, {} as never, {} as never, {} as never);
    const student = {
      id: 'student-3',
      workspaceId: 'school-3',
      email: 'student@example.test',
      role: Role.student,
      fullName: 'Student Three',
      studentCode: '0003',
      className: 'A1',
      faculty: null,
      avatarUrl: null,
      workspace: null,
    };

    const result = await service.create(student, application.id, {
      evidenceName: 'GPA evidence',
      criterion: Criterion.academic,
      sourceType: EvidenceSourceType.manual_upload,
    } as never);

    expect(repository.findEvidence).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'evidence-3', files: [], card: null });
  });
});
