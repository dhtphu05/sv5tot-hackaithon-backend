import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  processRoster: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
}));

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
      workspace: {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'DUT',
        type: 'SCHOOL',
        name: 'DUT',
        shortName: 'DUT',
      },
    };
    next();
  },
}));

vi.mock('../../src/modules/award-decisions/award-decisions.service', () => ({
  AwardDecisionsService: vi.fn(function AwardDecisionsService() {
    return mocks;
  }),
}));

vi.mock('../../src/modules/award-decisions/award-roster.service', () => ({
  AwardRosterService: vi.fn(function AwardRosterService() {
    return mocks;
  }),
}));


import { errorMiddleware } from '../../src/middlewares/error.middleware';
import { decisionImportsRouter } from '../../src/modules/decision-imports/decision-imports.routes';
import { awardDecisionsRouter } from '../../src/modules/award-decisions/award-decisions.routes';
import { eventRegistryRouter } from '../../src/modules/event-registry/event-registry.routes';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/award-decisions', awardDecisionsRouter);
  app.use('/api/decision-imports', decisionImportsRouter);
  app.use('/api/events', eventRegistryRouter);
  app.use(errorMiddleware);
  return app;
}

describe('Award Decision and legacy import route roles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('allows data uploader to enter Award Decision routes', async () => {
    mocks.list.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });

    const response = await request(buildApp())
      .get('/api/award-decisions')
      .set('x-test-role', Role.data_uploader)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(mocks.list).toHaveBeenCalledOnce();
  });

  it.each([Role.data_uploader, Role.admin])('allows %s to archive and unarchive through the existing registry scope', async (role) => {
    mocks.archive.mockResolvedValue({ id: 'decision-1', status: 'ARCHIVED' });
    mocks.unarchive.mockResolvedValue({ id: 'decision-1', status: 'CONFIRMED' });
    const app = buildApp();

    const archived = await request(app)
      .post('/api/award-decisions/decision-1/archive')
      .set('x-test-role', role)
      .expect(200);
    const unarchived = await request(app)
      .post('/api/award-decisions/decision-1/unarchive')
      .set('x-test-role', role)
      .expect(200);

    expect(archived.body.data.status).toBe('ARCHIVED');
    expect(unarchived.body.data.status).toBe('CONFIRMED');
    expect(mocks.archive).toHaveBeenCalledWith(expect.anything(), 'decision-1');
    expect(mocks.unarchive).toHaveBeenCalledWith(expect.anything(), 'decision-1');
  });

  it('allows data uploader to start processing through the Award API without opening the generic jobs API', async () => {
    mocks.processRoster.mockResolvedValue({ status: 'processing' });

    const response = await request(buildApp())
      .post('/api/award-decisions/decision-1/process-roster')
      .set('x-test-role', Role.data_uploader)
      .expect(202);

    expect(response.body.data).toEqual({ status: 'processing' });
    expect(JSON.stringify(response.body)).not.toContain('jobId');
    expect(mocks.processRoster).toHaveBeenCalledOnce();
  });

  it.each([
    Role.student,
    Role.class_representative,
    Role.officer,
    Role.manager,
    Role.committee,
    Role.city_officer,
    Role.city_manager,
    Role.city_committee,
  ])(
    'denies %s access to Award Decision routes',
    async (role) => {
      const response = await request(buildApp())
        .get('/api/award-decisions')
        .set('x-test-role', role)
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it('denies City roles before calling Award roster processing actions', async () => {
    await request(buildApp())
      .post('/api/award-decisions/decision-1/process-roster')
      .set('x-test-role', Role.city_officer)
      .expect(403);

    expect(mocks.processRoster).not.toHaveBeenCalled();
  });

  it('denies other roles before archive or unarchive service calls', async () => {
    await request(buildApp())
      .post('/api/award-decisions/decision-1/archive')
      .set('x-test-role', Role.city_manager)
      .expect(403);
    await request(buildApp())
      .post('/api/award-decisions/decision-1/unarchive')
      .set('x-test-role', Role.student)
      .expect(403);

    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.unarchive).not.toHaveBeenCalled();
  });

  it('keeps data uploader out of Event Registry and DecisionImport routes', async () => {
    const app = buildApp();

    await request(app).get('/api/events').set('x-test-role', Role.data_uploader).expect(403);
    await request(app).get('/api/decision-imports').set('x-test-role', Role.data_uploader).expect(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

});
