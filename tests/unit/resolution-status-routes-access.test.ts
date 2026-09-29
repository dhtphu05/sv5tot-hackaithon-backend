import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const mocks = vi.hoisted(() => ({ updateCaseStatus: vi.fn() }));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.student) as Role;
    req.user = {
      id: `${role}-user`,
      workspaceId: '11111111-1111-4111-8111-111111111111',
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

vi.mock('../../src/modules/resolution/resolution.service', () => ({
  ResolutionService: vi.fn(function ResolutionService() {
    return mocks;
  }),
}));

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { resolutionRouter } from '../../src/modules/resolution/resolution.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/resolution', resolutionRouter);
  app.use(errorMiddleware);
  return app;
}

describe('legacy Resolution status route access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateCaseStatus.mockResolvedValue({ resolutionCase: { id: 'case-1' } });
  });

  it.each([Role.city_manager, Role.city_committee])('denies target role %s from case-only status changes', async (role) => {
    await request(buildApp())
      .patch('/api/resolution/cases/case-1/status')
      .set('x-test-role', role)
      .send({ status: 'closed', note: 'Legacy route check' })
      .expect(403);

    expect(mocks.updateCaseStatus).not.toHaveBeenCalled();
  });

  it.each([Role.manager, Role.committee, Role.admin])('preserves legacy %s compatibility', async (role) => {
    await request(buildApp())
      .patch('/api/resolution/cases/case-1/status')
      .set('x-test-role', role)
      .send({ status: 'closed', note: 'Legacy route check' })
      .expect(200);

    expect(mocks.updateCaseStatus).toHaveBeenCalledOnce();
  });
});
