import { Role, WorkspaceType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  application: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({ prisma: prismaMock }));

import { ApplicationsService } from '../../src/modules/applications/applications.service';

const cityManager = {
  id: 'city-manager',
  workspaceId: 'city-workspace',
  email: 'manager@danang.city',
  role: Role.city_manager,
  fullName: 'City Manager',
  studentCode: null,
  className: null,
  faculty: null,
  avatarUrl: null,
  workspace: {
    id: 'city-workspace',
    code: 'DANANG_CITY',
    type: WorkspaceType.CITY,
    name: 'Da Nang',
    shortName: 'Da Nang',
  },
};

describe('ApplicationsService City supplement reopening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorizes a City Manager to reopen a supplement for an active School application', async () => {
    prismaMock.application.findUnique.mockResolvedValue({
      id: 'application-school-b',
      workspaceId: 'school-b',
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      status: 'under_review',
      studentId: 'student-b',
    });
    prismaMock.$transaction.mockRejectedValue(new Error('transaction reached'));
    const service = new ApplicationsService({ findById: vi.fn() } as never);

    await expect(
      service.reopenSupplement(cityManager, 'application-school-b', {
        reason: 'Please supplement evidence',
      } as never),
    ).rejects.toThrow('transaction reached');

    expect(prismaMock.application.findUnique).toHaveBeenCalledWith({
      where: { id: 'application-school-b' },
      include: { workspace: { select: { type: true, isActive: true } } },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
});
