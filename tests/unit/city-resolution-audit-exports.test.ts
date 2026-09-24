import { Role, WorkspaceType } from '@prisma/client';
import type { NextFunction, Request, Response, Router } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/infrastructure/database/prisma', () => ({
  prisma: {
    resolutionCase: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    reviewTask: { findFirst: vi.fn(), findMany: vi.fn() },
    knowledgeBaseItem: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    application: { findMany: vi.fn() },
    reviewTaskEvidence: { findMany: vi.fn() },
    evidence: { findMany: vi.fn() },
    officerSpecialization: { findFirst: vi.fn(), findMany: vi.fn() },
    precheckResult: { findFirst: vi.fn() },
    cascadeReview: { findFirst: vi.fn() },
    file: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: { ...actual.promises, access: vi.fn().mockResolvedValue(undefined) },
  };
});

import { prisma } from '../../src/infrastructure/database/prisma';
import { auditRouter } from '../../src/modules/audit/audit.routes';
import { AuditService } from '../../src/modules/audit/audit.service';
import { exportsRouter } from '../../src/modules/exports/exports.routes';
import { ExportsService } from '../../src/modules/exports/exports.service';
import { resolutionRouter } from '../../src/modules/resolution/resolution.routes';
import { ResolutionService } from '../../src/modules/resolution/resolution.service';

const cityId = '22222222-2222-4222-8222-222222222222';
const schoolId = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.resolutionCase.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.resolutionCase.count).mockResolvedValue(0 as never);
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.application.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.reviewTask.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.reviewTask.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.reviewTaskEvidence.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.evidence.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.officerSpecialization.findMany).mockResolvedValue([{ criterion: 'volunteer' }] as never);
  vi.mocked(prisma.knowledgeBaseItem.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.precheckResult.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.cascadeReview.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (query: unknown) =>
    Array.isArray(query) ? Promise.all(query) : {}) as never);
});

describe('City resolution authorization', () => {
  it('scopes City resolution lists to active School workspaces and retains legacy same-workspace scope', async () => {
    const service = new ResolutionService();
    await service.listCases(cityUser(Role.city_manager), { page: 1, limit: 10 } as never);
    expect(prisma.resolutionCase.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
          ]),
        }),
      }),
    );

    await service.listCases(legacyUser(Role.manager), { page: 1, limit: 10 } as never);
    expect(prisma.resolutionCase.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { AND: [{ workspaceId: schoolId }] } }),
    );
  });

  it('lets a City Officer list their escalated cases across active Schools', async () => {
    await new ResolutionService().listMyEscalatedCases(
      cityUser(Role.city_officer),
      { page: 1, limit: 10 } as never,
    );

    expect(prisma.resolutionCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: expect.arrayContaining([
            {
              AND: expect.arrayContaining([
                { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
              ]),
            },
          ]),
        },
      }),
    );
  });

  it('lets a specialized City Officer view an assigned resolution case from an active School', async () => {
    const caseRecord = resolutionCase(WorkspaceType.SCHOOL, true);
    caseRecord.evidence = {
      id: 'evidence-1',
      evidenceName: 'Volunteer work',
      criterion: 'volunteer',
      sourceType: 'manual_upload',
      status: 'under_review',
      indexingStatus: 'completed',
      confidence: null,
      evidenceFiles: [],
      evidenceCard: null,
    };
    caseRecord.application = {
      id: 'application-1',
      workspaceId: schoolId,
      targetLevel: 'city',
      status: 'resolution_needed',
      student: {
        fullName: 'Student Example',
        studentCode: '1001',
        className: 'Class 1',
        faculty: 'Faculty',
      },
    };
    vi.mocked(prisma.resolutionCase.findUnique).mockResolvedValue(caseRecord as never);
    vi.mocked(prisma.officerSpecialization.findFirst).mockResolvedValue({ id: 'spec-1' } as never);

    const result = await new ResolutionService().getCaseDetail(
      cityUser(Role.city_officer),
      'case-1',
    );

    expect(result.resolutionCase.id).toBe('case-1');
    expect(prisma.knowledgeBaseItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { workspaceId: cityId },
                { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
              ],
            },
            expect.objectContaining({ criterion: 'volunteer', OR: expect.any(Array) }),
          ],
        },
      }),
    );
  });

  it('lets City Manager and Committee resolve active School cases, but rejects inactive Schools before writes', async () => {
    const service = new ResolutionService();
    const decision = { decision: 'closed_no_action', note: 'Reviewed', evidenceDecisions: [] } as never;
    vi.mocked(prisma.resolutionCase.findUnique).mockResolvedValue(
      resolutionCase(WorkspaceType.SCHOOL, true) as never,
    );

    await service.resolveCase(cityUser(Role.city_manager), 'case-1', decision);
    await service.resolveCase(cityUser(Role.city_committee), 'case-1', decision);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    vi.mocked(prisma.resolutionCase.findUnique).mockResolvedValue(
      resolutionCase(WorkspaceType.SCHOOL, false) as never,
    );
    await expect(service.resolveCase(cityUser(Role.city_committee), 'case-1', decision)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores Knowledge Base content created during City resolution in the City workspace', async () => {
    const caseRecord = {
      ...resolutionCase(WorkspaceType.SCHOOL, true),
      evidenceId: 'evidence-1',
      evidence: {
        id: 'evidence-1',
        criterion: 'volunteer',
        evidenceName: 'Volunteer evidence',
        eventId: null,
      },
      application: {
        ...(resolutionCase(WorkspaceType.SCHOOL, true).application as Record<string, unknown>),
        studentId: 'student-1',
      },
    };
    vi.mocked(prisma.resolutionCase.findUnique).mockResolvedValue(caseRecord as never);
    const createKnowledgeItem = vi.fn().mockResolvedValue({
      id: 'city-kb-item',
      decision: 'reference_only',
      criterion: 'volunteer',
    });
    const tx = {
      resolutionCase: {
        update: vi.fn().mockResolvedValue(caseRecord),
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(caseRecord),
      },
      auditLog: {
        findFirst: vi.fn().mockResolvedValue({ id: 'opened-audit' }),
        create: vi.fn().mockResolvedValue({ id: 'audit' }),
      },
      application: {
        findUnique: vi.fn().mockResolvedValue({ workspaceId: schoolId }),
        update: vi.fn().mockResolvedValue({}),
      },
      reviewTask: { findMany: vi.fn().mockResolvedValue([]) },
      knowledgeBaseItem: { create: createKnowledgeItem },
      notification: {
        create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...data, id: 'notification', createdAt: new Date(), readAt: null }),
        ),
      },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      ((callback: (transaction: unknown) => Promise<unknown>) => callback(tx)) as never,
    );

    await new ResolutionService().resolveCase(cityUser(Role.city_manager), 'case-1', {
      decision: 'closed_no_action',
      note: 'Reviewed',
      evidenceDecisions: [],
      updateKnowledgeBase: true,
    } as never);

    expect(createKnowledgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ workspaceId: cityId }) }),
    );
  });

  it('keeps reopen and resolver route role allowlists bounded', () => {
    expectAllowed(resolutionRouter, 'post', '/cases/:id/resolve', Role.city_manager, true);
    expectAllowed(resolutionRouter, 'post', '/cases/:id/resolve', Role.city_committee, true);
    expectAllowed(resolutionRouter, 'post', '/cases/:id/reopen', Role.city_committee, true);
    expectAllowed(resolutionRouter, 'post', '/cases/:id/reopen', Role.city_manager, false);
    expectAllowed(resolutionRouter, 'get', '/my-escalated-cases', Role.city_officer, true);
  });
});

describe('City audit and export scope', () => {
  it('limits City audit queries and exports to active School data, while legacy managers stay local', async () => {
    const audit = new AuditService();
    await audit.listLogs({ user: cityUser(Role.city_manager), limit: 10, offset: 0 });
    const auditWhere = vi.mocked(prisma.auditLog.findMany).mock.calls.at(-1)?.[0]?.where as never;
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { workspaceId: cityId },
            { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
          ]),
          action: expect.objectContaining({ in: expect.arrayContaining(['REVIEW_TASK_DECIDED']) }),
        }),
      }),
    );
    expect((auditWhere as { action: { in: string[] } }).action.in).not.toContain('WORKSPACE_UPDATED');

    await new ExportsService().exportApplicationsJson(cityUser(Role.city_committee), {} as never);
    expect(prisma.application.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
      }),
    );

    await new ExportsService().exportReviewResults(cityUser(Role.city_manager), { format: 'json' } as never);
    expect(prisma.application.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
      }),
    );

    await new ExportsService().exportReviewTasksCsv(cityUser(Role.city_committee), {} as never);
    expect(prisma.reviewTask.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
          application: {},
        },
      }),
    );

    await audit.listLogs({ user: legacyUser(Role.manager), limit: 10, offset: 0 });
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { workspaceId: schoolId } }),
    );
  });

  it('denies City Officers audit/export routes and grants City Manager/Committee the existing staff allowlists', () => {
    expectAllowed(auditRouter, 'get', '/logs', Role.city_manager, true);
    expectAllowed(auditRouter, 'get', '/logs', Role.city_committee, true);
    expectAllowed(auditRouter, 'get', '/logs', Role.city_officer, false);
    expectAllowed(exportsRouter, 'get', '/applications.json', Role.city_manager, true);
    expectAllowed(exportsRouter, 'get', '/applications.json', Role.city_committee, true);
    expectAllowed(exportsRouter, 'get', '/applications.json', Role.city_officer, false);
    expectAllowed(exportsRouter, 'get', '/:fileId/download', Role.data_uploader, false);
  });

  it('permits only City-owned or active-School export files for City staff', async () => {
    const service = new ExportsService({} as never);
    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      id: 'export-1',
      workspaceId: schoolId,
      filePath: 'exports/review-results.csv',
      originalName: 'review-results.csv',
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    } as never);
    const downloaded = await service.getDownloadFile(cityUser(Role.city_manager), 'export-1');
    expect(downloaded.file).not.toHaveProperty('workspace');
    expect(prisma.file.findUnique).toHaveBeenCalledOnce();

    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      id: 'export-1',
      workspaceId: schoolId,
      filePath: 'evidence/private.csv',
      originalName: 'private.csv',
      workspace: { type: WorkspaceType.SCHOOL, isActive: true },
    } as never);
    await expect(
      service.getDownloadFile(cityUser(Role.city_manager), 'export-1'),
    ).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      id: 'inactive-export',
      workspaceId: schoolId,
      filePath: 'exports/inactive-results.csv',
      originalName: 'inactive-results.csv',
      workspace: { type: WorkspaceType.SCHOOL, isActive: false },
    } as never);
    await expect(
      service.getDownloadFile(cityUser(Role.city_manager), 'inactive-export'),
    ).rejects.toMatchObject({ statusCode: 404 });

    vi.mocked(prisma.file.findUnique).mockResolvedValue({
      id: 'city-export',
      workspaceId: cityId,
      filePath: 'exports/city-results.csv',
      originalName: 'city-results.csv',
      workspace: { type: WorkspaceType.CITY, isActive: true },
    } as never);
    await expect(service.getDownloadFile(cityUser(Role.city_manager), 'city-export')).resolves.toMatchObject({
      file: { id: 'city-export' },
    });
  });
});

function cityUser(role: Role) {
  return {
    id: 'city-staff',
    email: 'city@example.com',
    role,
    fullName: 'City Staff',
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

function legacyUser(role: Role) {
  return {
    ...cityUser(role),
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

function resolutionCase(
  type: WorkspaceType,
  isActive: boolean,
): { application: unknown; evidence: unknown; [key: string]: unknown } {
  return {
    id: 'case-1',
    workspaceId: schoolId,
    workspace: { type, isActive },
    applicationId: 'application-1',
    evidenceId: null,
    reviewTaskId: null,
    reason: 'Review requested',
    status: 'open',
    committeeDecision: null,
    createdBy: 'student-1',
    closedBy: null,
    createdAt: new Date(),
    closedAt: null,
    application: {
      id: 'application-1',
      workspaceId: schoolId,
      targetLevel: 'city',
      status: 'resolution_needed',
      student: {
        fullName: 'Student Example',
        studentCode: '1001',
        className: 'Class 1',
        faculty: 'Faculty',
      },
    },
    evidence: null,
  };
}

function expectAllowed(
  router: Router,
  method: string,
  path: string,
  role: Role,
  allowed: boolean,
) {
  const route = (router as unknown as { stack: RouteLayer[] }).stack.find(
    (layer) => layer.route?.path === path && layer.route.methods?.[method],
  );
  expect(route, `${method.toUpperCase()} ${path} route`).toBeDefined();
  const roleGate = route?.route?.stack[1]?.handle as (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;
  const next = vi.fn();
  roleGate({ user: { role } } as never, {} as never, next);
  if (allowed) expect(next).toHaveBeenCalledTimes(1);
  else expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
}

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};
