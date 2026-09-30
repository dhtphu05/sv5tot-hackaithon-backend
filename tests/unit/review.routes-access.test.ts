import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const controllerMocks = vi.hoisted(() => ({
  decideReviewTask: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { ok: true }, error: null, meta: {} }),
  ),
  requestReviewTaskSupplement: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { ok: true }, error: null, meta: {} }),
  ),
  escalateReviewTaskResolution: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { ok: true }, error: null, meta: {} }),
  ),
  listReviewTasks: vi.fn((_req: express.Request, res: express.Response) =>
    res.status(200).json({ success: true, data: { items: [] }, error: null, meta: {} }),
  ),
}));

vi.mock('../../src/middlewares/auth.middleware', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = (req.header('x-test-role') ?? Role.student) as Role;
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

vi.mock('../../src/middlewares/validate.middleware', () => ({
  validate: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next(),
}));

vi.mock('../../src/modules/review/review.controller', () => ({
  decideReviewTask: controllerMocks.decideReviewTask,
  requestReviewTaskSupplement: controllerMocks.requestReviewTaskSupplement,
  escalateReviewTaskResolution: controllerMocks.escalateReviewTaskResolution,
  listReviewTasks: controllerMocks.listReviewTasks,
  getReviewDashboard: controllerMocks.listReviewTasks,
  getReviewTaskDetail: controllerMocks.listReviewTasks,
  getReviewTaskTimeline: controllerMocks.listReviewTasks,
  getCriterionLevelAssessment: controllerMocks.listReviewTasks,
  claimReviewTask: controllerMocks.listReviewTasks,
  checkReviewTaskPrecedents: controllerMocks.listReviewTasks,
  ensureReviewTasks: controllerMocks.listReviewTasks,
}));

import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { reviewRouter } from '../../src/modules/review/review.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/review', reviewRouter);
  app.use(errorMiddleware);
  return app;
}

describe('Review mutation route authority', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    '/api/review/tasks/task-1/decision',
    '/api/review/tasks/task-1/request-supplement',
    '/api/review/tasks/task-1/escalate-resolution',
  ])('denies City Committee from normal ReviewTask mutation %s', async (path) => {
    await request(buildApp()).post(path).set('x-test-role', Role.city_committee).expect(403);
    expect(controllerMocks.decideReviewTask).not.toHaveBeenCalled();
    expect(controllerMocks.requestReviewTaskSupplement).not.toHaveBeenCalled();
    expect(controllerMocks.escalateReviewTaskResolution).not.toHaveBeenCalled();
  });

  it.each([Role.city_manager, Role.admin])(
    'keeps %s on the approved ReviewTask mutation routes',
    async (role) => {
      await request(buildApp())
        .post('/api/review/tasks/task-1/decision')
        .set('x-test-role', role)
        .expect(200);
      expect(controllerMocks.decideReviewTask).toHaveBeenCalledOnce();
    },
  );

  it('keeps City Committee task context read access at the route level', async () => {
    await request(buildApp())
      .get('/api/review/tasks')
      .set('x-test-role', Role.city_committee)
      .expect(200);
    expect(controllerMocks.listReviewTasks).toHaveBeenCalledOnce();
  });
});
