import {
  ApprovedEvidenceApprovalSource,
  ApprovedEvidencePrecedentStatus,
  Criterion,
  EventRegistryAliasType,
  EventRegistryAliasVerificationSource,
  EventStatus,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  Level,
  Role,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceKnowledgePublisher } from '../../src/modules/evidence-knowledge/evidence-knowledge.publisher';
import { EvidenceKnowledgeRepository } from '../../src/modules/evidence-knowledge/evidence-knowledge.repository';
import { EvidenceKnowledgeService } from '../../src/modules/evidence-knowledge/evidence-knowledge.service';
import { AppError } from '../../src/shared/errors/app-error';
import type { AuthenticatedUser } from '../../src/shared/types/auth';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const evidenceId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-07-19T00:00:00.000Z');

const officer: AuthenticatedUser = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'officer@example.com',
  role: Role.officer,
  fullName: 'Officer',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId,
  workspace: null,
};

describe('EvidenceKnowledgeService', () => {
  it('groups aliases into one canonical officer search result', async () => {
    const repository = {
      searchPrecedents: vi.fn().mockResolvedValue([
        precedent({ id: 'precedent-1', sourceEvidenceId: evidenceId }),
        precedent({
          id: 'precedent-2',
          sourceEvidenceId: '55555555-5555-4555-8555-555555555555',
          approvalSource: ApprovedEvidenceApprovalSource.resolution,
          sourceResolutionCaseId: '66666666-6666-4666-8666-666666666666',
        }),
      ]),
      listWorkspaceAbbreviations: vi.fn().mockResolvedValue([]),
    };
    const db = {
      officerSpecialization: {
        findMany: vi.fn().mockResolvedValue([{ criterion: Criterion.volunteer }]),
      },
    };
    const service = new EvidenceKnowledgeService(repository as never, db as never);

    const result = await service.searchOfficer(officer, {
      q: 'MHX 2025',
      criterion: Criterion.volunteer,
      page: 1,
      limit: 10,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      eventId,
      canonicalTitle: 'Mùa hè xanh 2025',
      aliases: ['MHX 2025', 'Chiến dịch MHX'],
      acceptedCount: 2,
      hasResolutionPrecedent: true,
    });
    expect(result.items[0].matchReasons).toContain('verified_alias');
  });

  it('blocks officers outside the requested criterion', async () => {
    const repository = {
      searchPrecedents: vi.fn(),
      listWorkspaceAbbreviations: vi.fn(),
    };
    const db = {
      officerSpecialization: {
        findMany: vi.fn().mockResolvedValue([{ criterion: Criterion.academic }]),
      },
    };
    const service = new EvidenceKnowledgeService(repository as never, db as never);

    await expect(
      service.searchOfficer(officer, {
        q: 'MHX',
        criterion: Criterion.volunteer,
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(repository.searchPrecedents).not.toHaveBeenCalled();
  });
});

describe('EvidenceKnowledgeRepository', () => {
  it('degrades read queries to empty results when the evidence knowledge migration is pending', async () => {
    const missingTableError = {
      code: 'P2021',
      message: 'The table `public.ApprovedEvidencePrecedent` does not exist',
      meta: { table: 'public.ApprovedEvidencePrecedent' },
    };
    const missingAbbreviationTableError = {
      code: 'P2021',
      message: 'The table `public.WorkspaceAbbreviation` does not exist',
      meta: { table: 'public.WorkspaceAbbreviation' },
    };
    const db = {
      approvedEvidencePrecedent: {
        findMany: vi.fn().mockRejectedValue(missingTableError),
        findUnique: vi.fn().mockRejectedValue(missingTableError),
        findFirst: vi.fn().mockRejectedValue(missingTableError),
      },
      workspaceAbbreviation: {
        findMany: vi.fn().mockRejectedValue(missingAbbreviationTableError),
      },
    };
    const repository = new EvidenceKnowledgeRepository(db as never);

    await expect(
      repository.searchPrecedents({ workspaceId, criteria: [Criterion.volunteer], limit: 10 }),
    ).resolves.toEqual([]);
    await expect(repository.getEventDetail({ eventId, workspaceId })).resolves.toEqual([]);
    await expect(repository.getPrecedentById('precedent-1')).resolves.toBeNull();
    await expect(repository.findPrecedentReference({ eventId })).resolves.toBeNull();
    await expect(repository.listWorkspaceAbbreviations(workspaceId)).resolves.toEqual([]);
  });
});

describe('EvidenceKnowledgePublisher', () => {
  it('publishes officer-accepted evidence without copying files', async () => {
    const tx = buildPublisherTx({
      evidenceStatus: EvidenceStatus.accepted,
      event: canonicalEvent(),
    });
    const publisher = new EvidenceKnowledgePublisher();

    const result = await publisher.publishAcceptedEvidence(tx as never, officer, {
      evidenceId,
      reviewTaskId: '77777777-7777-4777-8777-777777777777',
      approvalSource: ApprovedEvidenceApprovalSource.officer,
    });

    expect(result).toMatchObject({ id: 'precedent-1', sourceEvidenceId: evidenceId });
    expect(tx.approvedEvidencePrecedent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceEvidenceId: evidenceId },
        create: expect.objectContaining({
          approvalSource: ApprovedEvidenceApprovalSource.officer,
          eventId,
          sourceEvidenceId: evidenceId,
          previewFileId: '88888888-8888-4888-8888-888888888888',
        }),
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'APPROVED_EVIDENCE_PRECEDENT_PUBLISHED',
          evidenceId,
          eventId,
        }),
      }),
    );
  });

  it('creates a canonical event only for accepted Resolution evidence without an event link', async () => {
    const tx = buildPublisherTx({
      evidenceStatus: EvidenceStatus.accepted,
      event: null,
      matchedEventId: null,
    });
    tx.eventRegistry.findMany.mockResolvedValue([]);
    tx.eventRegistry.create.mockResolvedValue(
      canonicalEvent({ eventName: 'Ngày hội tình nguyện' }),
    );
    const publisher = new EvidenceKnowledgePublisher();

    await publisher.publishAcceptedEvidence(tx as never, officer, {
      evidenceId,
      resolutionCaseId: '99999999-9999-4999-8999-999999999999',
      approvalSource: ApprovedEvidenceApprovalSource.resolution,
    });

    expect(tx.eventRegistry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventName: 'Ngày hội tình nguyện',
          criterion: Criterion.volunteer,
          status: EventStatus.active,
        }),
      }),
    );
    expect(tx.evidence.update).toHaveBeenCalledWith({
      where: { id: evidenceId },
      data: { eventId },
    });
  });

  it('does not index rejected or supplement evidence', async () => {
    const tx = buildPublisherTx({
      evidenceStatus: EvidenceStatus.rejected,
      event: canonicalEvent(),
    });
    const publisher = new EvidenceKnowledgePublisher();

    const result = await publisher.publishAcceptedEvidence(tx as never, officer, {
      evidenceId,
      reviewTaskId: '77777777-7777-4777-8777-777777777777',
      approvalSource: ApprovedEvidenceApprovalSource.officer,
    });

    expect(result).toBeNull();
    expect(tx.approvedEvidencePrecedent.upsert).not.toHaveBeenCalled();
  });
});

function precedent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'precedent-1',
    workspaceId,
    criterion: Criterion.volunteer,
    eventId,
    sourceEvidenceId: evidenceId,
    sourceEvidenceCardId: null,
    sourceReviewTaskId: null,
    sourceResolutionCaseId: null,
    previewFileId: null,
    approvalSource: ApprovedEvidenceApprovalSource.officer,
    organizer: 'Hội Sinh viên',
    organizerLevel: Level.school,
    applicableLevel: Level.school,
    eventYear: 2025,
    schoolYear: '2025-2026',
    criteriaVersionId: null,
    normalizedTitleKey: 'mua he xanh 2025',
    normalizedOrganizerKey: 'hoi sinh vien',
    ocrSearchKey: null,
    ocrMetadataJson: null,
    auditSummaryJson: null,
    status: ApprovedEvidencePrecedentStatus.active,
    createdBy: officer.id,
    createdAt: now,
    updatedAt: now,
    event: canonicalEvent({
      aliases: [
        alias({ alias: 'MHX 2025', normalizedAliasKey: 'mhx 2025' }),
        alias({ alias: 'Chiến dịch MHX', normalizedAliasKey: 'chien dich mhx' }),
      ],
    }),
    ...overrides,
  };
}

function alias(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alias-1',
    workspaceId,
    eventId,
    criterion: Criterion.volunteer,
    alias: 'MHX',
    normalizedAliasKey: 'mhx',
    aliasType: EventRegistryAliasType.alias,
    verificationSource: EventRegistryAliasVerificationSource.officer,
    createdBy: officer.id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function canonicalEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    workspaceId,
    eventName: 'Mùa hè xanh 2025',
    criterion: Criterion.volunteer,
    organizer: 'Hội Sinh viên',
    organizerLevel: Level.school,
    startDate: new Date('2025-07-01T00:00:00.000Z'),
    endDate: null,
    convertedValue: null,
    convertedUnit: null,
    eligibleLevelsJson: null,
    participantCount: 0,
    rosterIndexed: false,
    sampleCertificateFileId: null,
    decisionDocumentId: null,
    sourceDecisionImportId: null,
    officialDocumentNo: null,
    officialIssueDate: null,
    officialSigner: null,
    officialIssuer: null,
    status: EventStatus.active,
    createdBy: officer.id,
    createdAt: now,
    updatedAt: now,
    aliases: [],
    ...overrides,
  };
}

function buildPublisherTx(input: {
  evidenceStatus: EvidenceStatus;
  event: ReturnType<typeof canonicalEvent> | null;
  matchedEventId?: string | null;
}) {
  const evidence = {
    id: evidenceId,
    applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    collectiveProfileId: null,
    evidenceName: input.event ? 'Mùa hè xanh 2025' : 'Ngày hội tình nguyện',
    criterion: Criterion.volunteer,
    sourceType: EvidenceSourceType.manual_upload,
    eventId: input.event?.id ?? null,
    status: input.evidenceStatus,
    indexingStatus: IndexingStatus.indexed,
    confidence: null,
    assignedOfficerId: officer.id,
    createdAt: now,
    updatedAt: now,
    event: input.event,
    evidenceCard: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      evidenceId,
      ocrText: 'Mùa hè xanh 2025',
      extractedFieldsJson: { eventName: 'Mùa hè xanh 2025' },
      normalizedFieldsJson: null,
      warningsJson: [],
      matchedEventId: input.matchedEventId ?? input.event?.id ?? null,
      matchedParticipantId: null,
      matchedKnowledgeItemIds: null,
      confidence: 0.91,
      sourceEndpoint: null,
      smartreaderJobId: null,
      aiSummary: null,
      rawAiResponse: null,
      rawResponseJson: null,
      createdAt: now,
      updatedAt: now,
    },
    evidenceFiles: [
      {
        evidenceId,
        fileId: '88888888-8888-4888-8888-888888888888',
        fileRole: 'certificate',
        file: {
          id: '88888888-8888-4888-8888-888888888888',
          originalName: 'certificate.pdf',
          mimeType: 'application/pdf',
          fileSize: 1234,
        },
      },
    ],
    application: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId,
      targetLevel: Level.school,
      schoolYear: '2025-2026',
      student: { faculty: 'CNTT' },
    },
  };
  return {
    evidence: {
      findUnique: vi.fn().mockResolvedValue(evidence),
      update: vi.fn().mockResolvedValue({ ...evidence, eventId }),
    },
    eventRegistry: {
      findFirst: vi.fn().mockResolvedValue(input.event),
      findMany: vi.fn().mockResolvedValue(input.event ? [input.event] : []),
      create: vi
        .fn()
        .mockResolvedValue(input.event ?? canonicalEvent({ eventName: evidence.evidenceName })),
    },
    eventRegistryAlias: {
      upsert: vi.fn().mockResolvedValue(alias()),
    },
    criteriaVersion: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    },
    approvedEvidencePrecedent: {
      upsert: vi.fn().mockResolvedValue({
        id: 'precedent-1',
        sourceEvidenceId: evidenceId,
        approvalSource: ApprovedEvidenceApprovalSource.officer,
        criterion: Criterion.volunteer,
        sourceReviewTaskId: null,
        sourceResolutionCaseId: null,
      }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
}
