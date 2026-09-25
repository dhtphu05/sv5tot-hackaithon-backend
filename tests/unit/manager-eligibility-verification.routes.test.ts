import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const controllerMocks = vi.hoisted(() => ({
  listManagerApplications: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { items: [] }, error: null, meta: {} }),
  ),
  getEligibilityVerificationDetail: vi.fn((_req: express.Request, res: express.Response) =>
    res
      .status(200)
      .json({ success: true, data: { applicationId: 'application-a' }, error: null, meta: {} }),
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

vi.mock('../../src/modules/manager/manager.controller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/modules/manager/manager.controller')>()),
  listManagerApplications: controllerMocks.listManagerApplications,
  getEligibilityVerificationDetail: controllerMocks.getEligibilityVerificationDetail,
}));

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { managerRouter } from '../../src/modules/manager/manager.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/manager', managerRouter);
  app.use(errorMiddleware);
  return app;
}

describe('City Manager eligibility verification read routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows City Manager to use the pending eligibility filter', async () => {
    await request(buildApp())
      .get('/api/manager/applications?eligibilityVerification=pending')
      .set('x-test-role', Role.city_manager)
      .expect(200);

    expect(controllerMocks.listManagerApplications).toHaveBeenCalledOnce();
  });

  it.each([Role.admin, Role.city_officer, Role.city_committee, Role.data_uploader, Role.student])(
    'denies %s from using the pending eligibility filter before service execution',
    async (role) => {
      await request(buildApp())
        .get('/api/manager/applications?eligibilityVerification=pending')
        .set('x-test-role', role)
        .expect(403);

      expect(controllerMocks.listManagerApplications).not.toHaveBeenCalled();
    },
  );

  it('allows only City Manager to read a verification detail', async () => {
    await request(buildApp())
      .get('/api/manager/applications/application-a/eligibility-verification')
      .set('x-test-role', Role.city_manager)
      .expect(200);

    expect(controllerMocks.getEligibilityVerificationDetail).toHaveBeenCalledOnce();
  });

  it.each([Role.admin, Role.student, Role.city_officer, Role.city_committee, Role.data_uploader])(
    'denies %s from the verification detail route before service execution',
    async (role) => {
      await request(buildApp())
        .get('/api/manager/applications/application-a/eligibility-verification')
        .set('x-test-role', role)
        .expect(403);

      expect(controllerMocks.getEligibilityVerificationDetail).not.toHaveBeenCalled();
    },
  );
});
