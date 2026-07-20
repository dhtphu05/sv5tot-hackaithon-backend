import { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('../../src/modules/auth/token.service', () => ({
  TokenService: vi.fn(function TokenService() {
    return {
      verifyAccessToken: vi.fn().mockReturnValue({ sub: 'user-1', type: 'access' }),
    };
  }),
}));

import { requireAuth } from '../../src/middlewares/auth.middleware';

const workspace = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'DHBK-DHDN',
  name: 'Trường Đại học Bách khoa - Đại học Đà Nẵng',
  shortName: 'DHBK',
  isActive: true,
};

function buildReq(): Request {
  return {
    header: vi.fn((name: string) => (name === 'authorization' ? 'Bearer token' : undefined)),
  } as unknown as Request;
}

describe('requireAuth workspace enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a global admin with null workspace', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'admin-1',
      workspaceId: null,
      email: 'admin@dut.udn.vn',
      role: Role.admin,
      fullName: 'Admin',
      studentCode: null,
      className: null,
      faculty: null,
      avatarUrl: null,
      isActive: true,
      workspace: null,
    });
    const req = buildReq();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({
      role: Role.admin,
      workspaceId: null,
      workspace: null,
    });
  });

  it('rejects a non-admin user with null workspace', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'student-1',
      workspaceId: null,
      email: 'student@dut.udn.vn',
      role: Role.student,
      fullName: 'Student',
      studentCode: 'SV001',
      className: null,
      faculty: null,
      avatarUrl: null,
      isActive: true,
      workspace: null,
    });
    const next = vi.fn() as NextFunction;

    await requireAuth(buildReq(), {} as Response, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        code: 'USER_WORKSPACE_REQUIRED',
      }),
    );
  });

  it('attaches workspace summary for configured users', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'student-1',
      workspaceId: workspace.id,
      email: 'student@dut.udn.vn',
      role: Role.student,
      fullName: 'Student',
      studentCode: 'SV001',
      className: null,
      faculty: null,
      avatarUrl: null,
      isActive: true,
      workspace,
    });
    const req = buildReq();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({
      workspaceId: workspace.id,
      workspace: {
        id: workspace.id,
        code: workspace.code,
        name: workspace.name,
        shortName: workspace.shortName,
      },
    });
  });
});
