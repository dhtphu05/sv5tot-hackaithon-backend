import { Criterion, EventStatus, Level, Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceMatchingService } from '../../src/modules/evidence-matching/evidence-matching.service';
import { AppError } from '../../src/shared/errors/app-error';

const baseUser = {
  id: 'student-1',
  email: 'student@example.com',
  role: Role.student,
  fullName: 'Student Owner',
  studentCode: '102220001',
  className: null,
  faculty: null,
  avatarUrl: null,
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    eventName: 'Mùa hè xanh 2026',
    criterion: Criterion.volunteer,
    organizer: 'Hội Sinh viên Trường',
    organizerLevel: Level.school,
    startDate: new Date('2026-06-01T00:00:00.000Z'),
    endDate: new Date('2026-06-05T00:00:00.000Z'),
    convertedValue: 5,
    convertedUnit: 'days',
    eligibleLevelsJson: null,
    participantCount: 1,
    rosterIndexed: true,
    sampleCertificateFileId: null,
    decisionDocumentId: null,
    sourceDecisionImportId: null,
    officialDocumentNo: 'QD-123',
    officialIssueDate: null,
    officialSigner: null,
    officialIssuer: null,
    status: EventStatus.active,
    createdBy: 'officer-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    participants: [],
    ...overrides,
  };
}

function participant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'participant-1',
    eventId: 'event-1',
    studentCode: '102220001',
    studentName: 'Nguyen Van Sinh',
    className: '22TCLC',
    faculty: 'CNTT',
    participationStatus: 'confirmed',
    indexedRow: 1,
    convertedValue: 5,
    sourceFileId: null,
    sourceDecisionDocumentId: null,
    sourcePage: null,
    sourceTableIndex: null,
    sourceRowIndex: null,
    ocrConfidence: null,
    normalizedConfidence: null,
    rawRowJson: null,
    ...overrides,
  };
}

describe('EvidenceMatchingService', () => {
  it('uses req.user.studentCode and returns official_match_found when participant exists', async () => {
    const db = {
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue([event({ participants: [participant()] })]),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.search(baseUser, {
      q: 'Mua he xanh 2026',
      criterion: Criterion.volunteer,
      page: 1,
      limit: 5,
      track: false,
    });

    expect(db.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { participants: { where: { studentCode: '102220001' }, take: 1 } },
      }),
    );
    expect(result.items[0]).toMatchObject({
      matchType: 'exact_name_and_student_found',
      importable: true,
      studentStatus: { code: 'official_match_found' },
    });
  });

  it('returns official_match_not_found when event exists without participant', async () => {
    const service = new EvidenceMatchingService(
      {
        eventRegistry: {
          findMany: vi.fn().mockResolvedValue([event()]),
        },
        evidence: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
      { log: vi.fn() } as never,
    );

    const result = await service.search(baseUser, {
      q: 'Mùa hè xanh 2026',
      criterion: Criterion.volunteer,
      page: 1,
      limit: 5,
      track: false,
    });

    expect(result.items[0]).toMatchObject({
      matchType: 'exact_name_student_not_found',
      importable: false,
      participant: null,
      studentStatus: { code: 'official_match_not_found' },
    });
  });

  it('prevents student search for another studentCode', async () => {
    const service = new EvidenceMatchingService({} as never, { log: vi.fn() } as never);

    await expect(
      service.search(baseUser, {
        q: 'Mùa hè xanh',
        studentCode: '999999999',
        page: 1,
        limit: 5,
        track: false,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('returns empty state when no event matches', async () => {
    const service = new EvidenceMatchingService(
      {
        eventRegistry: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        evidence: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
      { log: vi.fn() } as never,
    );

    const result = await service.search(baseUser, {
      q: 'Không có',
      page: 1,
      limit: 5,
      track: false,
    });

    expect(result.items).toEqual([]);
    expect(result.emptyState.studentStatus.code).toBe('official_match_not_found');
  });
});
