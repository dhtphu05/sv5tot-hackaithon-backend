import { Role, WorkspaceType } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { reviewRouter } from '../../src/modules/review/review.routes';
import {
  assertReviewWorkspaceAccess,
  reviewKnowledgeWorkspaceFilterFor,
  reviewWorkspaceFilterFor,
} from '../../src/shared/utils/review-workspace-scope';

const cityOfficer = {
  id: 'city-officer',
  workspaceId: 'city',
  role: Role.city_officer,
  workspace: { id: 'city', code: 'DANANG_CITY', type: WorkspaceType.CITY },
} as never;

describe('review workspace scope', () => {
  it('limits City review to active School resources across the City', () => {
    expect(reviewWorkspaceFilterFor(cityOfficer)).toEqual({
      workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } },
    });
  });

  it('allows City staff to read City knowledge and active School precedent', () => {
    expect(reviewKnowledgeWorkspaceFilterFor(cityOfficer)).toEqual({
      OR: [
        { workspaceId: 'city' },
        { workspace: { is: { type: WorkspaceType.SCHOOL, isActive: true } } },
      ],
    });
  });

  it('allows only active School review resources for City staff', () => {
    expect(
      assertReviewWorkspaceAccess(cityOfficer, {
        workspaceId: 'school-a',
        workspaceType: WorkspaceType.SCHOOL,
        workspaceIsActive: true,
      }),
    ).toBeUndefined();
    expect(() =>
      assertReviewWorkspaceAccess(cityOfficer, {
        workspaceId: 'school-inactive',
        workspaceType: WorkspaceType.SCHOOL,
        workspaceIsActive: false,
      }),
    ).toThrow();
  });

  it('does not grant cross-school access to legacy school staff', () => {
    const legacyOfficer = {
      id: 'legacy-officer',
      workspaceId: 'school-a',
      role: Role.officer,
      workspace: { id: 'school-a', code: 'DUT', type: WorkspaceType.SCHOOL },
    } as never;
    expect(() =>
      assertReviewWorkspaceAccess(legacyOfficer, {
        workspaceId: 'school-b',
        workspaceType: WorkspaceType.SCHOOL,
        workspaceIsActive: true,
      }),
    ).toThrow();
  });

  it('keeps the Admin workspace bypass global', () => {
    expect(
      assertReviewWorkspaceAccess(
        { id: 'admin', role: Role.admin } as never,
        {
          workspaceId: 'inactive-other-workspace',
          workspaceType: WorkspaceType.UNIVERSITY_SYSTEM,
          workspaceIsActive: false,
        },
      ),
    ).toBeUndefined();
  });

  it('denies data uploaders every review route action', () => {
    const routes = (reviewRouter as unknown as { stack: RouteLayer[] }).stack;
    let checkedRoutes = 0;

    for (const layer of routes) {
      const route = layer.route;
      if (!route) continue;

      const roleGate = route.stack?.[1]?.handle;
      if (!roleGate) continue;

      const next = vi.fn();
      roleGate(
        { user: { role: Role.data_uploader } } as never,
        {} as Response,
        next as NextFunction,
      );
      expect(next.mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
      checkedRoutes += 1;
    }

    expect(checkedRoutes).toBeGreaterThan(0);
  });
});

type RouteLayer = {
  route?: {
    stack?: Array<{
      handle: (req: Request, res: Response, next: NextFunction) => void;
    }>;
  };
};
