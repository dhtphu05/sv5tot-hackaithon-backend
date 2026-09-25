import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const mocks = vi.hoisted(() => ({ getEligibility: vi.fn() }));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.student) as Role;
    req.user = {
      id: `${role}-user`,
      workspaceId: 'school-a',
      email: `${role}@example.test`,
      role,
      fullName: role,
      studentCode: '000123',
      className: null,
      faculty: null,
      avatarUrl: null,
      workspace: { id: 'school-a', code: 'SCHOOL_A', type: 'SCHOOL', name: 'School A', shortName: 'A' },
    };
    next();
  },
}));

vi.mock('../../src/modules/applications/city-submission-eligibility.service', () => ({
  CitySubmissionEligibilityService: vi.fn(function CitySubmissionEligibilityService() {
    return mocks;
  }),
}));

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { applicationsRouter } from '../../src/modules/applications/applications.routes';

function buildApp() {
  const app = express();
  app.use('/api/applications', applicationsRouter);
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/applications/:id/eligibility access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows a student to request application eligibility', async () => {
    mocks.getEligibility.mockResolvedValue({
      applicationId: 'application-a',
      status: 'ELIGIBLE',
      route: 'DIRECT_CITY',
      reasons: [],
    });

    const response = await request(buildApp())
      .get('/api/applications/application-a/eligibility')
      .set('x-test-role', Role.student)
      .expect(200);

    expect(response.body.data).toEqual({
      applicationId: 'application-a',
      status: 'ELIGIBLE',
      route: 'DIRECT_CITY',
      reasons: [],
    });
    expect(mocks.getEligibility).toHaveBeenCalledOnce();
  });

  it.each([
    Role.admin,
    Role.city_officer,
    Role.city_manager,
    Role.city_committee,
    Role.data_uploader,
    Role.officer,
    Role.manager,
    Role.committee,
  ])('denies %s before invoking eligibility service', async (role) => {
    await request(buildApp())
      .get('/api/applications/application-a/eligibility')
      .set('x-test-role', role)
      .expect(403);

    expect(mocks.getEligibility).not.toHaveBeenCalled();
  });
});
