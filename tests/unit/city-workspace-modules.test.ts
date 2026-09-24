import { Criterion, EventStatus, Role, WorkspaceType } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    officerSpecialization: { findMany: vi.fn() },
    reviewTask: { findFirst: vi.fn() },
    evidence: { findUnique: vi.fn() },
    knowledgeBaseItem: { findUnique: vi.fn(), update: vi.fn() },
    indexingJob: { findFirst: vi.fn() },
    eventFile: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../src/modules/applications/application.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/applications/application.helpers')>();
  return { ...actual, createApplicationAudit: vi.fn().mockResolvedValue({}) };
});

import { prisma } from '../../src/infrastructure/database/prisma';
import { eventRegistryRouter } from '../../src/modules/event-registry/event-registry.routes';
import { EventRegistryService } from '../../src/modules/event-registry/event-registry.service';
import { EventRegistryRepository } from '../../src/modules/event-registry/event-registry.repository';
import { KnowledgeBaseService } from '../../src/modules/knowledge-base/knowledge-base.service';
import { knowledgeBaseRouter } from '../../src/modules/knowledge-base/knowledge-base.routes';
import { KnowledgeBaseRepository } from '../../src/modules/knowledge-base/knowledge-base.repository';

const schoolId = '11111111-1111-4111-8111-111111111111';
const cityId = '22222222-2222-4222-8222-222222222222';
const evidenceId = '33333333-3333-4333-8333-333333333333';

describe('City staff Event Registry route roles', () => {
  it('maps the existing event read and write allowlists to the corresponding City roles', () => {
    for (const role of [Role.city_officer, Role.city_manager, Role.city_committee]) {
      expectRouteRole(eventRegistryRouter, 'get', '/', role, true);
      expectRouteRole(eventRegistryRouter, 'get', '/:id', role, true);
      expectRouteRole(eventRegistryRouter, 'post', '/', role, role !== Role.city_committee);
    }

    expectRouteRole(eventRegistryRouter, 'post', '/', Role.data_uploader, false);
    expectRouteRole(eventRegistryRouter, 'get', '/', Role.data_uploader, false);
    expectRouteRole(eventRegistryRouter, 'get', '/', Role.manager, true);
  });

  it('lets students list and read active City Registry events', async () => {
    const db = {
      eventRegistry: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockResolvedValue([[], 0]),
    };
    const repository = new EventRegistryRepository(db as never);
    await repository.list(schoolStudent(), { page: 1, limit: 10 } as never);
    expect(db.eventRegistry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: EventStatus.active,
          OR: [
            { workspaceId: schoolId },
            { workspace: { is: { type: WorkspaceType.CITY, isActive: true } } },
          ],
        }),
      }),
    );

    const event = {
      id: 'city-event',
      workspaceId: cityId,
      workspace: { type: WorkspaceType.CITY, isActive: true },
      status: EventStatus.active,
      eventName: 'City event',
      criterion: Criterion.volunteer,
      organizer: 'Đà Nẵng',
      organizerLevel: 'city',
      rosterIndexed: true,
      eventFiles: [],
      sampleCertificateFile: null,
    };
    const service = new EventRegistryService(
      { findById: vi.fn().mockResolvedValue(event) } as never,
      {} as never,
      {} as never,
    );
    await expect(service.getDetail(schoolStudent(), event.id)).resolves.toMatchObject({
      id: event.id,
      eventName: event.eventName,
      status: 'confirmed',
    });
  });

  it('keeps the legacy officer archive restriction for City Officer event creation', async () => {
    vi.clearAllMocks();
    const created = {
      id: 'city-event',
      eventName: 'City event',
      criterion: Criterion.volunteer,
      organizer: 'Đà Nẵng',
      organizerLevel: 'city',
      status: EventStatus.draft,
      workspaceId: cityId,
    };
    const create = vi.fn().mockResolvedValue(created);
    const tx = { eventRegistry: { create } };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => Promise<unknown>) => callback(tx)) as never,
    );
    const repository = {
      findById: vi.fn().mockResolvedValue({
        ...created,
        workspace: { type: WorkspaceType.CITY, isActive: true },
      }),
    };

    await new EventRegistryService(repository as never, {} as never, {} as never).create(
      cityOfficer(),
      {
        eventName: 'City event',
        criterion: Criterion.volunteer,
        organizer: 'Đà Nẵng',
        organizerLevel: 'city',
        status: 'archived',
      } as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EventStatus.draft, workspaceId: cityId }),
      }),
    );
  });

  it('rejects a roster file from a different event before creating jobs or mutating participants', async () => {
    vi.mocked(prisma.$transaction).mockClear();
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 'event-1', workspaceId: cityId }),
      findEventFile: vi.fn().mockResolvedValue({
        id: 'foreign-event-file',
        eventId: 'event-2',
      }),
      findLatestEventFile: vi.fn(),
    };
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    await expect(
      service.startIndexing(cityManager(), 'event-1', { eventFileId: 'foreign-event-file' } as never),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.indexingJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repository.findLatestEventFile).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirm-index file before participant deletion or upsert', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ id: 'event-1', workspaceId: cityId }),
      findEventFile: vi.fn().mockResolvedValue({
        id: 'foreign-event-file',
        eventId: 'event-2',
      }),
    };
    vi.mocked(prisma.$transaction).mockClear();
    const service = new EventRegistryService(repository as never, {} as never, {} as never);

    await expect(
      service.confirmIndex(cityManager(), 'event-1', {
        eventFileId: 'foreign-event-file',
      } as never),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('City staff Knowledge Base scope', () => {
  it('searches City content and active School precedents while retaining same-school legacy scope', async () => {
    const db = {
      knowledgeBaseItem: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockResolvedValue([[], 0]),
    };
    const repository = new KnowledgeBaseRepository(db as never);
    const query = { page: 1, limit: 10 } as never;

    await repository.search(cityManager(), query);
    expect(db.knowledgeBaseItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { workspaceId: cityId },
            { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
          ],
        },
      }),
    );

    await repository.search({ ...cityManager(), role: Role.manager, workspaceId: schoolId }, query);
    expect(db.knowledgeBaseItem.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { workspaceId: schoolId } }),
    );
  });

  it('combines City/School scope with text search instead of replacing either OR clause', async () => {
    const db = {
      knowledgeBaseItem: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      $transaction: vi.fn().mockResolvedValue([[], 0]),
    };
    const repository = new KnowledgeBaseRepository(db as never);

    await repository.search(cityManager(), { page: 1, limit: 10, q: 'volunteer' } as never);

    expect(db.knowledgeBaseItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { workspaceId: cityId },
            { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
          ],
          AND: [
            {
              OR: [
                { evidenceName: { contains: 'volunteer', mode: 'insensitive' } },
                { eventName: { contains: 'volunteer', mode: 'insensitive' } },
                { reason: { contains: 'volunteer', mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('limits City Officer approved evidence names by active criterion specialization', async () => {
    vi.mocked(prisma.officerSpecialization.findMany).mockResolvedValue([
      { criterion: Criterion.volunteer },
    ] as never);
    const repository = { searchApprovedEvidenceNames: vi.fn().mockResolvedValue({ items: [], total: 0 }) };
    const service = new KnowledgeBaseService(repository as never);

    await service.searchApprovedEvidenceNames(
      { ...cityManager(), role: Role.city_officer },
      { page: 1, limit: 10 } as never,
    );

    expect(repository.searchApprovedEvidenceNames).toHaveBeenCalledWith(
      { page: 1, limit: 10 },
      [Criterion.volunteer],
    );
  });

  it('lets City reviewers read City items and active School precedents without exposing workspace metadata', async () => {
    const schoolItem = {
      id: 'school-kb-item',
      workspaceId: schoolId,
      evidenceName: 'Precedent',
      criterion: Criterion.volunteer,
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    };
    vi.mocked(prisma.knowledgeBaseItem.findUnique).mockResolvedValue(schoolItem as never);
    const service = new KnowledgeBaseService({} as never);

    await expect(service.getItem(cityManager(), schoolItem.id)).resolves.toEqual({
      id: schoolItem.id,
      workspaceId: schoolId,
      evidenceName: 'Precedent',
      criterion: Criterion.volunteer,
    });

    vi.mocked(prisma.knowledgeBaseItem.findUnique).mockResolvedValue({
      ...schoolItem,
      workspace: { type: WorkspaceType.SCHOOL, isActive: false },
    } as never);
    await expect(service.getItem(cityManager(), schoolItem.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('keeps active School precedents read-only to City editors', async () => {
    vi.mocked(prisma.knowledgeBaseItem.findUnique).mockResolvedValue(
      {
        id: 'school-kb-item',
        workspaceId: schoolId,
        evidenceName: 'Precedent',
        criterion: Criterion.volunteer,
        decision: 'accepted',
        level: 'school',
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      } as never,
    );
    vi.mocked(prisma.$transaction).mockClear();
    const service = new KnowledgeBaseService({} as never);

    await expect(
      service.updateItem(cityManager(), 'school-kb-item', {} as never),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps student approved names to the safe DTO while staff retain review fields', async () => {
    const resultItem = {
      id: 'approved-item',
      evidenceName: 'Approved evidence',
      eventName: 'Mùa hè xanh',
      criterion: Criterion.volunteer,
      level: 'school',
      usageCount: 4,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const repository = {
      searchApprovedEvidenceNames: vi.fn().mockResolvedValue({ items: [resultItem], total: 1 }),
    };
    const service = new KnowledgeBaseService(repository as never);
    const query = { page: 1, limit: 10 } as never;

    const studentResult = await service.searchApprovedEvidenceNames(
      { ...cityManager(), role: Role.student },
      query,
    );
    expect(studentResult.items[0]).toEqual({
      id: 'approved-item',
      title: 'Approved evidence',
      criterion: Criterion.volunteer,
    });

    const staffResult = await service.searchApprovedEvidenceNames(cityManager(), query);
    expect(staffResult.items[0]).toMatchObject({
      id: 'approved-item',
      title: 'Approved evidence',
      criterion: Criterion.volunteer,
      eventName: 'Mùa hè xanh',
      level: 'school',
      usageCount: 4,
      updatedAt: resultItem.updatedAt,
    });
  });

  it('lets City staff publish School review evidence into the City workspace', async () => {
    const evidence = {
      id: evidenceId,
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      collectiveProfileId: null,
      evidenceName: 'Approved evidence',
      criterion: Criterion.volunteer,
      sourceType: 'manual_upload',
      eventId: null,
      event: null,
      application: {
        workspaceId: schoolId,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
      collectiveProfile: null,
    };
    vi.mocked(prisma.evidence.findUnique).mockResolvedValue(evidence as never);

    const createdItem = { id: 'kb-item', workspaceId: cityId };
    const tx = {
      knowledgeBaseItem: { create: vi.fn().mockResolvedValue(createdItem) },
      application: { findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolId }) },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => Promise<unknown>) => callback(tx)) as never,
    );

    const service = new KnowledgeBaseService({} as never);
    await service.createFromReviewedEvidence(cityManager(), {
      evidenceId,
      decision: 'accepted',
    } as never);

    expect(tx.knowledgeBaseItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: cityId }) }),
    );
  });

  it('does not let a City Officer publish evidence without owning its completed review task', async () => {
    vi.clearAllMocks();
    const evidence = {
      id: evidenceId,
      applicationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      collectiveProfileId: null,
      evidenceName: 'Unreviewed evidence',
      criterion: Criterion.volunteer,
      sourceType: 'manual_upload',
      eventId: null,
      event: null,
      application: {
        workspaceId: schoolId,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
      collectiveProfile: null,
    };
    vi.mocked(prisma.evidence.findUnique).mockResolvedValue(evidence as never);
    vi.mocked(prisma.officerSpecialization.findMany).mockResolvedValue([
      { criterion: Criterion.volunteer },
    ] as never);
    vi.mocked(prisma.reviewTask.findFirst).mockResolvedValue(null as never);
    const create = vi.fn().mockResolvedValue({ id: 'kb-item', workspaceId: cityId });
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          knowledgeBaseItem: { create },
          application: { findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolId }) },
          auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
        })) as never,
    );

    await expect(
      new KnowledgeBaseService({} as never).createFromReviewedEvidence(cityOfficer(), {
        evidenceId,
        decision: 'accepted',
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(prisma.reviewTask.findFirst).toHaveBeenCalledWith({
      where: {
        applicationId: evidence.applicationId,
        criterion: Criterion.volunteer,
        assignedOfficerId: 'city-officer',
        status: { in: ['accepted', 'rejected'] },
        evidences: { some: { evidenceId } },
      },
      select: { id: true },
    });
  });

  it('publishes collective evidence only through its own final assigned review task', async () => {
    vi.clearAllMocks();
    const profileId = '55555555-5555-4555-8555-555555555555';
    const evidence = {
      id: evidenceId,
      applicationId: null,
      collectiveProfileId: profileId,
      evidenceName: 'Collective evidence',
      criterion: Criterion.volunteer,
      sourceType: 'manual_upload',
      eventId: null,
      event: null,
      application: null,
      collectiveProfile: {
        workspaceId: schoolId,
        workspace: { type: WorkspaceType.SCHOOL, isActive: true },
      },
    };
    vi.mocked(prisma.evidence.findUnique).mockResolvedValue(evidence as never);
    vi.mocked(prisma.officerSpecialization.findMany).mockResolvedValue([
      { criterion: Criterion.volunteer },
    ] as never);
    vi.mocked(prisma.reviewTask.findFirst).mockResolvedValue({ id: 'collective-task' } as never);
    const create = vi.fn().mockResolvedValue({
      id: 'city-kb-item',
      workspaceId: cityId,
      criterion: Criterion.volunteer,
    });
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => Promise<unknown>) =>
        callback({ knowledgeBaseItem: { create } })) as never,
    );

    await new KnowledgeBaseService({} as never).createFromReviewedEvidence(cityOfficer(), {
      evidenceId,
      decision: 'accepted',
    } as never);

    expect(prisma.reviewTask.findFirst).toHaveBeenCalledWith({
      where: {
        collectiveProfileId: profileId,
        criterion: Criterion.volunteer,
        assignedOfficerId: 'city-officer',
        status: { in: ['accepted', 'rejected'] },
        evidences: { some: { evidenceId } },
      },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: cityId }) }),
    );
  });

  it('maps the existing Knowledge Base allowlists to City roles and denies data uploaders', () => {
    expectRouteRole(knowledgeBaseRouter, 'get', '/search', Role.city_officer, true);
    expectRouteRole(knowledgeBaseRouter, 'get', '/search', Role.city_manager, true);
    expectRouteRole(knowledgeBaseRouter, 'post', '/from-reviewed-evidence', Role.city_committee, true);
    expectRouteRole(knowledgeBaseRouter, 'patch', '/:id', Role.city_manager, true);
    expectRouteRole(knowledgeBaseRouter, 'patch', '/:id', Role.city_committee, true);
    expectRouteRole(knowledgeBaseRouter, 'patch', '/:id', Role.city_officer, false);
    expectRouteRole(knowledgeBaseRouter, 'get', '/search', Role.data_uploader, false);
  });
});

function cityManager() {
  return {
    id: 'city-manager',
    email: 'city-manager@example.com',
    role: Role.city_manager,
    fullName: 'City Manager',
    studentCode: null,
    className: null,
    faculty: null,
    avatarUrl: null,
    workspaceId: cityId,
    workspace: {
      id: cityId,
      code: 'DANANG_CITY',
      type: WorkspaceType.CITY,
      name: 'Đà Nẵng',
      shortName: 'Đà Nẵng',
    },
  };
}

function cityOfficer() {
  return { ...cityManager(), id: 'city-officer', role: Role.city_officer };
}

function schoolStudent() {
  return {
    ...cityManager(),
    id: 'school-student',
    role: Role.student,
    workspaceId: schoolId,
    workspace: {
      id: schoolId,
      code: 'DUT',
      type: WorkspaceType.SCHOOL,
      name: 'DUT',
      shortName: 'DUT',
    },
  };
}

function expectRouteRole(
  router: typeof eventRegistryRouter,
  method: string,
  path: string,
  role: Role,
  allowed: boolean,
) {
  type RouteLayer = {
    route?: {
      path?: string;
      methods?: Record<string, boolean>;
      stack: Array<{
        handle: (
          req: Request & { user?: { role: Role } },
          res: Response,
          next: NextFunction,
        ) => void;
      }>;
    };
  };
  const route = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method],
  );
  expect(route, `${method.toUpperCase()} ${path} route`).toBeDefined();
  const roleGate = route!.route!.stack[1].handle;
  const next = vi.fn();
  roleGate({ user: { role } } as Request & { user: { role: Role } }, {} as Response, next);

  if (allowed) {
    expect(next).toHaveBeenCalledWith();
  } else {
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  }
}
