import { Role } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  getAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  setAdminUserActive: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  setOfficerSpecializations: vi.fn(),
}));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.admin) as Role;
    req.user = {
      id: `${role}-1`, workspaceId: null, email: `${role}@example.test`, role, fullName: role,
      studentCode: null, className: null, faculty: null, avatarUrl: null, workspace: null,
    };
    next();
  },
}));

vi.mock('../../src/modules/users/users.service', () => ({
  UsersService: vi.fn(function UsersService() { return mocks; }),
}));

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { adminUsersRouter } from '../../src/modules/users/users.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/users', adminUsersRouter);
  app.use(errorMiddleware);
  return app;
}

describe('admin user routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows admin to list accounts', async () => {
    mocks.listAdminUsers.mockResolvedValue({ users: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await request(buildApp()).get('/api/admin/users').set('x-test-role', Role.admin).expect(200);
    expect(mocks.listAdminUsers).toHaveBeenCalledOnce();
  });

  it('parses a false active filter as false', async () => {
    mocks.listAdminUsers.mockResolvedValue({ users: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    await request(buildApp()).get('/api/admin/users').query({ isActive: false }).set('x-test-role', Role.admin).expect(200);
    expect(mocks.listAdminUsers).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it.each([Role.student, Role.data_uploader, Role.city_officer, Role.city_manager, Role.city_committee, Role.manager])(
    'denies %s from account administration', async (role) => {
      await request(buildApp()).get('/api/admin/users').set('x-test-role', role).expect(403);
      expect(mocks.listAdminUsers).not.toHaveBeenCalled();
    },
  );

  it('rejects non-canonical specialization criteria before calling the service', async () => {
    const response = await request(buildApp())
      .put('/api/admin/users/officer-1/specializations')
      .set('x-test-role', Role.admin)
      .send({ criteria: ['ethics', 'collective'] })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mocks.setOfficerSpecializations).not.toHaveBeenCalled();
  });

  it('requires a JSON boolean when changing account activity', async () => {
    await request(buildApp())
      .patch('/api/admin/users/11111111-1111-4111-8111-111111111111/status')
      .set('x-test-role', Role.admin)
      .send({ isActive: 'false' })
      .expect(400);
    expect(mocks.setAdminUserActive).not.toHaveBeenCalled();
  });

  it('allows admin to reset a password and returns only the safe result', async () => {
    mocks.resetAdminUserPassword.mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111' });
    const response = await request(buildApp())
      .post('/api/admin/users/11111111-1111-4111-8111-111111111111/reset-password')
      .set('x-test-role', Role.admin)
      .send({ newPassword: 'new-password-123' })
      .expect(200);

    expect(mocks.resetAdminUserPassword).toHaveBeenCalledWith(
      expect.objectContaining({ role: Role.admin }),
      '11111111-1111-4111-8111-111111111111',
      'new-password-123',
    );
    expect(response.body.data).toEqual({ userId: '11111111-1111-4111-8111-111111111111' });
    expect(response.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects weak password input before calling the service', async () => {
    await request(buildApp())
      .post('/api/admin/users/11111111-1111-4111-8111-111111111111/reset-password')
      .set('x-test-role', Role.admin)
      .send({ newPassword: 'short' })
      .expect(400);
    expect(mocks.resetAdminUserPassword).not.toHaveBeenCalled();
  });

  it.each([Role.student, Role.data_uploader, Role.city_officer, Role.city_manager, Role.city_committee, Role.manager])(
    'denies %s from resetting account passwords', async (role) => {
      await request(buildApp())
        .post('/api/admin/users/11111111-1111-4111-8111-111111111111/reset-password')
        .set('x-test-role', role)
        .send({ newPassword: 'new-password-123' })
        .expect(403);
      expect(mocks.resetAdminUserPassword).not.toHaveBeenCalled();
    },
  );
});
