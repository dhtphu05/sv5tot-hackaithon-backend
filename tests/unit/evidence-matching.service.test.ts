import { Criterion, EventStatus, Level, Role } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceMatchingService } from '../../src/modules/evidence-matching/evidence-matching.service';
import { AppError } from '../../src/shared/errors/app-error';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const baseUser = {
  id: 'student-1',
  email: 'student@example.com',
  role: Role.student,
  fullName: 'Student Owner',
  studentCode: '102220001',
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId,
  workspace: null,
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
      event: { eventName: 'Mùa hè xanh 2026' },
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

  it('uses student fullName when studentCode is missing', async () => {
    const db = {
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue([
          event({
            participants: [participant({ studentName: 'Nguyễn Văn Sinh' })],
          }),
        ]),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.search(
      { ...baseUser, studentCode: null, fullName: 'Nguyen Van Sinh' },
      {
        q: 'Mùa hè xanh 2026',
        criterion: Criterion.volunteer,
        page: 1,
        limit: 5,
        track: false,
      },
    );

    expect(db.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { participants: true },
      }),
    );
    expect(result).toMatchObject({
      studentCode: null,
      studentName: 'Nguyen Van Sinh',
      items: [
        {
          importable: true,
          participant: { id: 'participant-1' },
          studentStatus: { code: 'official_match_found' },
        },
      ],
    });
  });

  it('allows officer search by studentName without studentCode', async () => {
    const db = {
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue([
          event({
            participants: [participant({ studentName: 'Bùi Quốc Anh' })],
          }),
        ]),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.search(
      { ...baseUser, role: Role.officer, studentCode: null },
      {
        q: 'Mùa hè xanh 2026',
        studentName: 'Bui Quoc Anh',
        page: 1,
        limit: 5,
        track: false,
      },
    );

    expect(result.items[0]).toMatchObject({
      importable: true,
      participant: { studentName: 'Bùi Quốc Anh' },
    });
  });

  it('matches studentName against roster names that include trailing class suffixes', async () => {
    const db = {
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue([
          event({
            participants: [participant({ studentName: 'Bùi Quốc Anh 25N1' })],
          }),
        ]),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.search(
      { ...baseUser, studentCode: null, fullName: 'Bùi Quốc Anh' },
      {
        q: 'Mùa hè xanh 2026',
        page: 1,
        limit: 5,
        track: false,
      },
    );

    expect(result.items[0]).toMatchObject({
      importable: true,
      participant: { studentName: 'Bùi Quốc Anh 25N1' },
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

  it('lists compact official event library without participant or file data', async () => {
    const applicationId = '22222222-2222-4222-8222-222222222222';
    const eventRows = [
      event({ id: 'event-1', eventName: 'Mua he xanh 2026' }),
      event({ id: 'event-2', eventName: 'Hien mau nhan dao' }),
    ];
    const db = {
      application: {
        findUnique: vi.fn().mockResolvedValue({
          id: applicationId,
          studentId: baseUser.id,
          workspaceId,
        }),
      },
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue(eventRows),
        count: vi.fn().mockResolvedValue(2),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([{ eventId: 'event-2' }]),
      },
      $transaction: vi.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.library(baseUser, {
      applicationId,
      criterion: Criterion.volunteer,
      projection: 'full',
      page: 1,
      limit: 20,
    });

    expect(db.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId,
          status: EventStatus.active,
          rosterIndexed: true,
          criterion: Criterion.volunteer,
        }),
        select: expect.objectContaining({
          id: true,
          eventName: true,
          organizer: true,
          organizerLevel: true,
          criterion: true,
        }),
        skip: 0,
        take: 20,
      }),
    );
    expect(db.eventRegistry.findMany.mock.calls[0][0]).not.toHaveProperty('include');
    expect(result).toMatchObject({
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
      items: [
        {
          eventId: 'event-1',
          title: 'Mua he xanh 2026',
          state: 'available',
        },
        {
          eventId: 'event-2',
          title: 'Hien mau nhan dao',
          state: 'already_imported',
        },
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('participant');
    expect(serialized).not.toContain('studentCode');
    expect(serialized).not.toContain('file');
    expect(serialized).not.toContain('confidence');
  });

  it('normalizes student library search aliases and typo variants into one reference result', async () => {
    const applicationId = '22222222-2222-4222-8222-222222222222';
    const eventRows = [
      event({ id: 'event-1', eventName: 'Mùa hè xanh 2025' }),
      event({ id: 'event-duplicate', eventName: 'Mùa hè xanh 2025' }),
      event({ id: 'event-2', eventName: 'Hiến máu nhân đạo 2025' }),
    ];
    const db = {
      application: {
        findUnique: vi.fn().mockResolvedValue({
          id: applicationId,
          studentId: baseUser.id,
          workspaceId,
        }),
      },
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue(eventRows),
      },
      evidence: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    for (const search of [
      'Mùa hè xanh 2025',
      'mua he xanh 2025',
      'MHX 2025',
      'CD MHX',
      'mua he xnah',
    ]) {
      const result = await service.library(baseUser, {
        applicationId,
        search,
        projection: 'reference',
        page: 1,
        limit: 20,
      });

      expect(result.items, search).toEqual([
        {
          eventId: 'event-1',
          title: 'Mùa hè xanh 2025',
          criterion: 'volunteer',
          approvedUsageCount: 0,
        },
      ]);
      expect(result.total, search).toBe(1);
      expect(JSON.stringify(result)).not.toMatch(
        /organizer|organizerLevel|state|participant|studentCode|file|ocr|reviewer|confidence|acceptedCount/i,
      );
    }
  });

  it('lists resolution-approved reference events without requiring official roster indexing', async () => {
    const applicationId = '22222222-2222-4222-8222-222222222222';
    const eventRows = [
      event({
        id: 'resolution-event-1',
        eventName: 'Giải nghiên cứu khoa học sinh viên 2025',
        criterion: Criterion.academic,
        rosterIndexed: false,
      }),
    ];
    const db = {
      application: {
        findUnique: vi.fn().mockResolvedValue({
          id: applicationId,
          studentId: baseUser.id,
          workspaceId,
        }),
      },
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue(eventRows),
        count: vi.fn().mockResolvedValue(1),
      },
      approvedEvidencePrecedent: {
        findMany: vi.fn().mockResolvedValue([
          {
            eventId: 'resolution-event-1',
            sourceEvidence: {
              applicationId: applicationId,
              application: { studentId: baseUser.id },
            },
          },
        ]),
      },
      $transaction: vi.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = new EvidenceMatchingService(db as never, { log: vi.fn() } as never);

    const result = await service.library(baseUser, {
      applicationId,
      criterion: Criterion.academic,
      projection: 'reference',
      page: 1,
      limit: 20,
    });

    expect(db.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId,
          status: EventStatus.active,
          criterion: Criterion.academic,
          approvedEvidencePrecedents: {
            some: {
              workspaceId,
              status: 'active',
            },
          },
        }),
      }),
    );
    expect(db.eventRegistry.findMany.mock.calls[0][0].where).not.toHaveProperty('rosterIndexed');
    expect(result.items).toEqual([
      {
        eventId: 'resolution-event-1',
        title: 'Giải nghiên cứu khoa học sinh viên 2025',
        criterion: 'academic',
        approvedUsageCount: 1,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /organizer|organizerLevel|state|participant|studentCode|file|ocr|reviewer|confidence|acceptedCount/i,
    );
  });

  it('rejects official event library access for non-owner applications', async () => {
    const service = new EvidenceMatchingService(
      {
        application: {
          findUnique: vi.fn().mockResolvedValue({
            id: '22222222-2222-4222-8222-222222222222',
            studentId: 'another-student',
            workspaceId,
          }),
        },
      } as never,
      { log: vi.fn() } as never,
    );

    await expect(
      service.library(baseUser, {
        applicationId: '22222222-2222-4222-8222-222222222222',
        projection: 'full',
        page: 1,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects official event library access outside the student role', async () => {
    const service = new EvidenceMatchingService({} as never, { log: vi.fn() } as never);

    await expect(
      service.library(
        { ...baseUser, role: Role.officer },
        {
          applicationId: '22222222-2222-4222-8222-222222222222',
          projection: 'full',
          page: 1,
          limit: 20,
        },
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});
