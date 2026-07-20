import { Role } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAdmin: vi.fn(),
  getAdmin: vi.fn(),
  createAdmin: vi.fn(),
  updateAdmin: vi.fn(),
  updateStatusAdmin: vi.fn(),
  listAdminWorkspaceUsers: vi.fn(),
}));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.admin) as Role;
    req.user = {
      id: `${role}-1`,
      workspaceId: role === Role.admin ? null : 'workspace-1',
      email: `${role}@example.test`,
      role,
      fullName: role,
      studentCode: null,
      className: null,
      faculty: null,
      avatarUrl: null,
      workspace: null,
    };
    next();
  },
}));

vi.mock('../../src/modules/workspaces/workspaces.service', () => ({
  WorkspacesService: vi.fn(function WorkspacesService() {
    return mocks;
  }),
}));

import { adminWorkspacesRouter } from '../../src/modules/workspaces/workspaces.routes';
import { errorMiddleware } from '../../src/middlewares/error.middleware';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/workspaces', adminWorkspacesRouter);
  app.use(errorMiddleware);
  return app;
}

describe('admin workspace routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows admin list access and returns existing pagination format', async () => {
    mocks.listAdmin.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          code: 'DHBK-DHDN',
          name: 'DHBK',
          shortName: 'DHBK',
          isActive: true,
          registrationEnabled: true,
          userCount: 10,
          applicationCount: 4,
          createdAt: new Date('2026-07-17T00:00:00.000Z'),
          updatedAt: new Date('2026-07-17T00:00:00.000Z'),
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const response = await request(buildApp())
      .get('/api/admin/workspaces')
      .query({ search: 'dhbk', isActive: true, page: 1, limit: 20 })
      .set('x-test-role', Role.admin)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(mocks.listAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'dhbk', isActive: true, page: 1, limit: 20 }),
    );
  });

  it('denies manager access', async () => {
    const response = await request(buildApp())
      .get('/api/admin/workspaces')
      .set('x-test-role', Role.manager)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });

  it('denies officer access', async () => {
    const response = await request(buildApp())
      .get('/api/admin/workspaces')
      .set('x-test-role', Role.officer)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });

  it('denies committee access', async () => {
    const response = await request(buildApp())
      .get('/api/admin/workspaces')
      .set('x-test-role', Role.committee)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(mocks.listAdmin).not.toHaveBeenCalled();
  });

  it('does not expose a delete workspace route', async () => {
    await request(buildApp())
      .delete('/api/admin/workspaces/11111111-1111-4111-8111-111111111111')
      .set('x-test-role', Role.admin)
      .expect(404);

    expect(mocks.updateStatusAdmin).not.toHaveBeenCalled();
    expect(mocks.updateAdmin).not.toHaveBeenCalled();
  });

  it('rejects update payloads that only try to edit code', async () => {
    const response = await request(buildApp())
      .patch('/api/admin/workspaces/11111111-1111-4111-8111-111111111111')
      .set('x-test-role', Role.admin)
      .send({ code: 'NEW-CODE' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mocks.updateAdmin).not.toHaveBeenCalled();
  });
});
