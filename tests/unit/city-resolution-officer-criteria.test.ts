import { Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  resolutionCase: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  officerSpecialization: { findMany: vi.fn(), findFirst: vi.fn() },
  reviewTask: { findFirst: vi.fn() },
  reviewTaskEvidence: { findMany: vi.fn() },
  knowledgeBaseItem: { findMany: vi.fn() },
  auditLog: { findMany: vi.fn() },
  precheckResult: { findFirst: vi.fn() },
  cascadeReview: { findFirst: vi.fn() },
  evidence: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ResolutionService } from '../../src/modules/resolution/resolution.service';

const cityId = '22222222-2222-4222-8222-222222222222';
const user = {
  id: 'city-officer-1',
  email: 'officer@city.test',
  role: Role.city_officer,
  fullName: 'City Officer',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspaceId: cityId,
  workspace: { id: cityId, type: WorkspaceType.CITY, code: 'CITY', name: 'Da Nang', shortName: 'DN' },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.resolutionCase.findMany.mockResolvedValue([]);
  prismaMock.resolutionCase.count.mockResolvedValue(0);
  prismaMock.officerSpecialization.findMany.mockResolvedValue([{ criterion: 'volunteer' }]);
  prismaMock.officerSpecialization.findFirst.mockResolvedValue(null);
  prismaMock.reviewTask.findFirst.mockResolvedValue(null);
  prismaMock.reviewTaskEvidence.findMany.mockResolvedValue([]);
  prismaMock.knowledgeBaseItem.findMany.mockResolvedValue([]);
  prismaMock.auditLog.findMany.mockResolvedValue([]);
  prismaMock.precheckResult.findFirst.mockResolvedValue(null);
  prismaMock.cascadeReview.findFirst.mockResolvedValue(null);
  prismaMock.evidence.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (queries: unknown) =>
    Array.isArray(queries) ? Promise.all(queries) : {},
  );
});

describe('City Officer resolution criterion scope', () => {
  it('filters resolution lists to active specializations even when a task is assigned', async () => {
    await new ResolutionService().listCases(user, { page: 1, limit: 10 } as never);

    expect(prismaMock.officerSpecialization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ officerId: user.id, isActive: true }) }),
    );
    expect(prismaMock.resolutionCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({
                  OR: expect.arrayContaining([
                    { evidence: { criterion: { in: ['volunteer'] } } },
                    { evidenceId: null, reviewTask: { criterion: { in: ['volunteer'] } } },
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects detail access to a different criterion before honoring assignment', async () => {
    prismaMock.resolutionCase.findUnique.mockResolvedValue({
      id: 'case-1',
      workspaceId: 'school-1',
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      applicationId: 'application-1',
      evidenceId: 'evidence-1',
      reviewTaskId: 'task-1',
      createdBy: user.id,
      evidence: { id: 'evidence-1', criterion: 'arts' },
    });
    prismaMock.reviewTask.findFirst.mockResolvedValue({
      id: 'task-1',
      applicationId: 'application-1',
      criterion: 'arts',
      assignedOfficerId: user.id,
    });

    await expect(new ResolutionService().getCaseDetail(user, 'case-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
