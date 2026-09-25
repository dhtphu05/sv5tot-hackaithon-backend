import { AwardDecisionStatus, AwardLevel } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { CitySubmissionEligibilityRepository } from '../../src/modules/applications/city-submission-eligibility.repository';

describe('CitySubmissionEligibilityRepository', () => {
  it('locks the application school without conflicting with recipient foreign-key checks', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'school-a' }]),
    };
    const repository = new CitySubmissionEligibilityRepository({} as never);

    await expect(repository.lockSchoolWorkspaceForEligibility('school-a', tx as never)).resolves.toEqual([
      { id: 'school-a' },
    ]);

    expect((tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain(
      'FOR NO KEY UPDATE',
    );
  });

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

  it('loads only manager-safe application, student, workspace, and prior decision fields', async () => {
    const db = {
      application: { findUnique: vi.fn().mockResolvedValue(null) },
      workspace: { findUnique: vi.fn() },
      awardRecipient: { findMany: vi.fn() },
    };
    const repository = new CitySubmissionEligibilityRepository(db as never);

    await repository.findApplicationForManagerVerification('application-a');

    expect(db.application.findUnique).toHaveBeenCalledWith({
      where: { id: 'application-a' },
      select: {
        id: true,
        studentId: true,
        workspaceId: true,
        schoolYear: true,
        applicationType: true,
        targetLevel: true,
        status: true,
        submittedAt: true,
        student: { select: { workspaceId: true, fullName: true, studentCode: true, className: true } },
        workspace: { select: { code: true, name: true, type: true, isActive: true } },
        eligibilityVerification: {
          select: { decision: true, verificationBasisHash: true, decidedAt: true },
        },
      },
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

  it('locks only the relevant issuer workspace and UDN decisions before the recipient read', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'udn' }]),
    };
    const repository = new CitySubmissionEligibilityRepository({} as never);

    await expect(
      repository.lockUniversityAwardScope(
        {
          issuerWorkspaceId: 'udn',
          institutionWorkspaceId: 'school-a',
          schoolYear: '2025-2026',
        },
        tx as never,
      ),
    ).resolves.toBe(true);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect((tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain(
      'FROM "Workspace"',
    );
    expect((tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('')).toContain(
      'FOR UPDATE',
    );
    expect((tx.$queryRaw.mock.calls[1][0] as TemplateStringsArray).join('')).toContain(
      'FROM "AwardDecision"',
    );
    expect((tx.$queryRaw.mock.calls[1][0] as TemplateStringsArray).join('')).toContain(
      '"schoolYear"',
    );
    expect((tx.$queryRaw.mock.calls[1][0] as TemplateStringsArray).join('')).toContain(
      '"status"',
    );
    expect(tx.$queryRaw.mock.calls[1]).toContain(AwardDecisionStatus.DRAFT);
    expect((tx.$queryRaw.mock.calls[1][0] as TemplateStringsArray).join('')).toContain(
      'FOR UPDATE',
    );
  });
});
