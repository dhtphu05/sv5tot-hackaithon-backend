import { AwardDecisionStatus, AwardLevel } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CitySubmissionEligibilityRepository } from '../../src/modules/applications/city-submission-eligibility.repository';

describe('CitySubmissionEligibilityRepository', () => {
  it('loads canonical recipients only from confirmed UDN decisions for the application year and school', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn() },
      awardRecipient: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    const recipients = await repository.findConfirmedUniversityRecipients({
      issuerWorkspaceId: 'udn',
      institutionWorkspaceId: 'school-a',
      schoolYear: '2025-2026',
    });

    expect(recipients).toEqual([]);
    expect(db.awardRecipient.findMany).toHaveBeenCalledWith({
      where: {
        institutionWorkspaceId: 'school-a',
        awardDecision: {
          is: {
            issuerWorkspaceId: 'udn',
            awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
            schoolYear: '2025-2026',
            status: AwardDecisionStatus.CONFIRMED,
          },
        },
      },
      select: { studentCode: true, fullName: true, className: true },
    });
  });

  it('does not fetch school-level awards or depend on matchedUserId', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn() },
      awardRecipient: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    await repository.findConfirmedUniversityRecipients({
      issuerWorkspaceId: 'udn',
      institutionWorkspaceId: 'school-a',
      schoolYear: '2025-2026',
    });

    const query = db.awardRecipient.findMany.mock.calls[0][0];
    expect(query.where.awardDecision.is.awardLevel).toBe(AwardLevel.UNIVERSITY_SYSTEM);
    expect(query.select).not.toHaveProperty('matchedUserId');
  });

  it('loads only the current workspace and its immediate parent classification', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn().mockResolvedValue(null) },
      awardRecipient: { findMany: vi.fn() },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    await repository.findWorkspaceContext('school-a');

    expect(db.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: 'school-a' },
      select: {
        id: true,
        type: true,
        parentWorkspaceId: true,
        parentWorkspace: { select: { id: true, type: true } },
      },
    });
  });
});
