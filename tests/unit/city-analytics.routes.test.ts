import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const controllerMocks = vi.hoisted(() => ({
  getCityAnalytics: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { applications: {} }, error: null, meta: {} }),
  ),
  listCityAnalyticsApplications: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({
      success: true,
      data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      error: null,
      meta: {},
    }),
  ),
}));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.city_manager) as Role;
    req.user = {
      id: `${role}-user`,
      workspaceId: 'city-workspace',
      email: `${role}@example.test`,
      role,
      fullName: role,
      studentCode: null,
      className: null,
      faculty: null,
      avatarUrl: null,
      workspace: {
        id: 'city-workspace',
        code: 'DANANG_CITY',
        type: 'CITY',
        name: 'Da Nang',
        shortName: 'Da Nang',
      },
    };
    next();
  },
}));

vi.mock('../../src/modules/analytics/city-analytics.controller', () => controllerMocks);

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { analyticsRouter } from '../../src/modules/analytics/city-analytics.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  app.use(errorMiddleware);
  return app;
}

describe('City analytics routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([Role.city_manager, Role.city_committee, Role.admin])('allows %s to read the City dashboard', async (role) => {
    await request(buildApp())
      .get('/api/analytics/city')
      .set('x-test-role', role)
      .expect(200);

    expect(controllerMocks.getCityAnalytics).toHaveBeenCalledOnce();
  });

  it.each([
    Role.student,
    Role.city_officer,
    Role.data_uploader,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.class_representative,
  ])('denies %s before City dashboard service execution', async (role) => {
    const response = await request(buildApp())
      .get('/api/analytics/city')
      .set('x-test-role', role)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(controllerMocks.getCityAnalytics).not.toHaveBeenCalled();
  });

  it.each([Role.city_manager, Role.city_committee, Role.admin])(
    'allows %s to use the paginated City drill-down endpoint',
    async (role) => {
      await request(buildApp())
        .get('/api/analytics/city/applications?page=2&limit=10')
        .set('x-test-role', role)
        .expect(200);

      expect(controllerMocks.listCityAnalyticsApplications).toHaveBeenCalledOnce();
    },
  );

  it('denies City Officers from both City analytics endpoints', async () => {
    await request(buildApp())
      .get('/api/analytics/city/applications')
      .set('x-test-role', Role.city_officer)
      .expect(403);

    expect(controllerMocks.listCityAnalyticsApplications).not.toHaveBeenCalled();
  });

  it('accepts explicit boolean filters for supplement and resolution drill-downs', async () => {
    await request(buildApp())
      .get('/api/analytics/city/applications?supplementRequired=false&resolutionBlocked=true')
      .set('x-test-role', Role.city_manager)
      .expect(200);

    expect(controllerMocks.listCityAnalyticsApplications).toHaveBeenCalledOnce();
  });

  it('accepts submitted and in-review KPI filters on the paginated drill-down', async () => {
    await request(buildApp())
      .get('/api/analytics/city/applications?submitted=true&inReview=true')
      .set('x-test-role', Role.city_manager)
      .expect(200);

    expect(controllerMocks.listCityAnalyticsApplications).toHaveBeenCalledOnce();
    expect(controllerMocks.listCityAnalyticsApplications.mock.calls[0][0].query).toMatchObject({
      inReview: true,
      submitted: true,
    });
  });

  it('rejects invalid filter values before controller execution', async () => {
    await request(buildApp())
      .get('/api/analytics/city/applications?criterion=collective')
      .set('x-test-role', Role.city_manager)
      .expect(400);

    expect(controllerMocks.listCityAnalyticsApplications).not.toHaveBeenCalled();
  });
});
