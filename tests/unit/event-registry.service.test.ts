import { Criterion, EventStatus, IndexingStatus, Level, Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EventRegistryService } from '../../src/modules/event-registry/event-registry.service';
import { AppError } from '../../src/shared/errors/app-error';

const workspaceId = '11111111-1111-4111-8111-111111111111';

const managerUser = {
  id: 'manager-1',
  email: 'manager@example.com',
  role: Role.manager,
  fullName: 'Manager',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId,
  workspace: null,
};

function staffEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    workspaceId,
    eventName: 'Mua he xanh 2026',
    criterion: Criterion.volunteer,
    organizer: 'Hoi Sinh vien Truong',
    organizerLevel: Level.school,
    startDate: null,
    endDate: null,
    convertedValue: 3,
    convertedUnit: 'days',
    eligibleLevelsJson: null,
    participantCount: 12,
    rosterIndexed: true,
    sampleCertificateFileId: 'file-sample',
    decisionDocumentId: 'decision-document-1',
    sourceDecisionImportId: 'decision-import-1',
    officialDocumentNo: 'QD-123',
    officialIssueDate: null,
    officialSigner: null,
    officialIssuer: null,
    status: EventStatus.active,
    createdBy: 'officer-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    eventFiles: [
      {
        id: 'event-file-1',
        eventId: 'event-1',
        fileId: 'file-roster',
        indexingStatus: IndexingStatus.indexed,
        columnMappingJson: null,
        indexQualityScore: 0.9,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        file: {
          id: 'file-roster',
          originalName: 'roster.csv',
          mimeType: 'text/csv',
          fileSize: 1234,
          filePath: 'event-rosters/event-1/roster.csv',
          publicUrl: 'https://example.test/roster.csv',
        },
      },
    ],
    sourceDecisionImport: {
      id: 'decision-import-1',
      sourceFile: {
        id: 'file-decision',
        originalName: 'decision.pdf',
        mimeType: 'application/pdf',
        fileSize: 4567,
        filePath: 'decision-imports/decision.pdf',
        publicUrl: 'https://example.test/decision.pdf',
      },
    },
    sampleCertificateFile: {
      id: 'file-sample',
      originalName: 'sample.png',
      mimeType: 'image/png',
      fileSize: 789,
      filePath: 'samples/sample.png',
      publicUrl: 'https://example.test/sample.png',
    },
    decisionDocument: {
      documentNo: 'QD-DOC-456',
    },
    ...overrides,
  };
}

describe('EventRegistryService staff workspace', () => {
  it('returns staff event summary without signed URL, raw OCR, or embedded participants', async () => {
    const repository = {
      findStaffWorkspaceById: vi.fn().mockResolvedValue(staffEvent()),
      findLatestCompletedRosterJob: vi.fn().mockResolvedValue({
        resultJson: {
          quality: {
            rowCount: 4,
            missingStudentCodeRows: 1,
            duplicateStudentCodes: ['102220001'],
          },
        },
      }),
    };
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    const result = await service.getStaffWorkspace(managerUser, 'event-1');

    expect(repository.findLatestCompletedRosterJob).toHaveBeenCalledWith('event-file-1');
    expect(result).toMatchObject({
      event: {
        id: 'event-1',
        name: 'Mua he xanh 2026',
        status: EventStatus.active,
        rosterIndexed: true,
        participantCount: 12,
      },
      source: {
        decisionImportId: 'decision-import-1',
        decisionNumber: 'QD-123',
      },
      indexSummary: {
        status: IndexingStatus.indexed,
        validRows: 2,
        warningRows: 1,
        errorRows: 1,
      },
    });
    expect(result.files).toEqual([
      {
        id: 'file-roster',
        originalName: 'roster.csv',
        mimeType: 'text/csv',
        size: 1234,
        role: 'roster',
      },
      {
        id: 'file-decision',
        originalName: 'decision.pdf',
        mimeType: 'application/pdf',
        size: 4567,
        role: 'decision_source',
      },
      {
        id: 'file-sample',
        originalName: 'sample.png',
        mimeType: 'image/png',
        size: 789,
        role: 'sample_certificate',
      },
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('signed');
    expect(serialized).not.toContain('publicUrl');
    expect(serialized).not.toContain('filePath');
    expect(serialized).not.toContain('participants');
    expect(serialized).not.toContain('raw');
  });

  it('rejects students before loading staff workspace detail', async () => {
    const repository = {
      findStaffWorkspaceById: vi.fn(),
      findLatestCompletedRosterJob: vi.fn(),
    };
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    await expect(
      service.getStaffWorkspace({ ...managerUser, role: Role.student }, 'event-1'),
    ).rejects.toBeInstanceOf(AppError);
    expect(repository.findStaffWorkspaceById).not.toHaveBeenCalled();
  });

  it('denies staff access across workspaces', async () => {
    const repository = {
      findStaffWorkspaceById: vi.fn().mockResolvedValue(
        staffEvent({
          workspaceId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
      findLatestCompletedRosterJob: vi.fn(),
    };
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    await expect(service.getStaffWorkspace(managerUser, 'event-1')).rejects.toBeInstanceOf(AppError);
    expect(repository.findLatestCompletedRosterJob).not.toHaveBeenCalled();
  });
});
