import {
  Criterion,
  EventStatus,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Level,
  Role,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/shared/errors/app-error';
import { ErrorCodes } from '../../src/shared/errors/error-codes';

const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  eventRegistry: { findUnique: vi.fn() },
  eventParticipant: { findMany: vi.fn(), findUnique: vi.fn() },
  evidence: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: prismaMock,
}));

import { importEventAsEvidence } from '../../src/modules/decision-imports/decision-imports.service';

const user = {
  id: 'admin-1',
  email: 'admin@5tot.test',
  role: Role.admin,
  fullName: 'Admin',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId: null,
  workspace: null,
};

const application = {
  id: 'application-1',
  studentId: 'student-1',
  workspaceId: 'workspace-1',
  status: 'draft',
  student: {
    id: 'student-1',
    fullName: 'Nguyen Van Sinh',
    studentCode: null,
  },
};

const event = {
  id: 'event-1',
  workspaceId: 'workspace-1',
  eventName: 'Mùa hè xanh 2026',
  criterion: Criterion.volunteer,
  organizer: 'Hội Sinh viên',
  organizerLevel: Level.school,
  startDate: null,
  endDate: null,
  convertedValue: 5,
  convertedUnit: 'days',
  officialDocumentNo: 'QD-123',
  status: EventStatus.active,
};

const participant = {
  id: 'participant-1',
  eventId: 'event-1',
  studentCode: 'GENERATED-001',
  studentName: 'Nguyễn Văn Sinh',
  className: '22TCLC',
  faculty: 'CNTT',
  participationStatus: 'confirmed',
  convertedValue: 5,
};

describe('importEventAsEvidence participant name matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.application.findUnique.mockResolvedValue(application);
    prismaMock.eventRegistry.findUnique.mockResolvedValue(event);
    prismaMock.evidence.findFirst.mockResolvedValue(null);
    prismaMock.eventParticipant.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback({
        evidence: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'evidence-1',
            applicationId: 'application-1',
            evidenceName: event.eventName,
            criterion: Criterion.volunteer,
            sourceType: EvidenceSourceType.event_import,
            eventId: event.id,
            status: EvidenceStatus.under_review,
            indexingStatus: IndexingStatus.indexed,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
        evidenceCard: {
          create: vi.fn().mockResolvedValue({
            id: 'card-1',
            extractedFieldsJson: {
              studentName: participant.studentName,
              studentCode: participant.studentCode,
              eventName: event.eventName,
            },
            warningsJson: [],
            matchedEventId: event.id,
            matchedParticipantId: participant.id,
          }),
        },
        application: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }),
    );
  });

  it('imports evidence when application has no studentCode but fullName matches one participant', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([participant]);

    const result = await importEventAsEvidence({
      user,
      eventId: event.id,
      applicationId: application.id,
    });

    expect(prismaMock.eventParticipant.findMany).toHaveBeenCalledWith({
      where: { eventId: event.id },
    });
    expect(prismaMock.eventParticipant.findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      evidence: { id: 'evidence-1', eventId: event.id },
      card: {
        matchingStatus: {
          code: 'official_match_found',
          matchedParticipantId: participant.id,
        },
      },
      alreadyImported: false,
    });
  });

  it('does not import when the application fullName matches multiple participants', async () => {
    prismaMock.eventParticipant.findMany.mockResolvedValue([
      participant,
      { ...participant, id: 'participant-2', studentCode: 'GENERATED-002', studentName: 'Nguyen Van Sinh' },
    ]);

    await expect(
      importEventAsEvidence({
        user,
        eventId: event.id,
        applicationId: application.id,
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409,
    } satisfies Partial<AppError>);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
