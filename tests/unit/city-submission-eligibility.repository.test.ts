import { AwardDecisionStatus, AwardLevel } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CitySubmissionEligibilityRepository } from '../../src/modules/applications/city-submission-eligibility.repository';

describe('CitySubmissionEligibilityRepository', () => {
  it('filters canonical recipient matching by issuer, level, confirmed status, school year, institution, and student code', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn() },
      awardRecipient: { findFirst: vi.fn().mockResolvedValue({ id: 'recipient-1' }) },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    const found = await repository.hasConfirmedAward({
      awardLevel: AwardLevel.UNIVERSITY_SYSTEM,
      issuerWorkspaceId: 'udn',
      institutionWorkspaceId: 'school-a',
      studentCode: '000123',
      schoolYear: '2025-2026',
    });

    expect(found).toBe(true);
    expect(db.awardRecipient.findFirst).toHaveBeenCalledWith({
      where: {
        studentCode: '000123',
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
      select: { id: true },
    });
  });

  it('does not make matchedUserId part of canonical identity matching', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn() },
      awardRecipient: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    await repository.hasConfirmedAward({
      awardLevel: AwardLevel.SCHOOL,
      issuerWorkspaceId: 'school-a',
      institutionWorkspaceId: 'school-a',
      studentCode: '000123',
      schoolYear: '2025-2026',
    });

    const query = db.awardRecipient.findFirst.mock.calls[0][0];
    expect(query.where).not.toHaveProperty('matchedUserId');
    expect(query.where.institutionWorkspaceId).toBe('school-a');
    expect(query.where.studentCode).toBe('000123');
  });

  it('loads only the current workspace and its immediate parent classification', async () => {
    const db = {
      application: { findUnique: vi.fn() },
      workspace: { findUnique: vi.fn().mockResolvedValue(null) },
      awardRecipient: { findFirst: vi.fn() },
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
