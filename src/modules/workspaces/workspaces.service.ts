import { ApplicationStatus, Role, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { normalizePagination } from '../../shared/utils/pagination';
import { toWorkspaceSummaryDto } from './workspaces.dto';
import { WorkspacesRepository } from './workspaces.repository';
import type {
  CreateAdminWorkspaceBody,
  ListAdminWorkspacesQuery,
  ListAdminWorkspaceUsersQuery,
  ListWorkspacesQuery,
  UpdateAdminWorkspaceBody,
  UpdateAdminWorkspaceStatusBody,
} from './workspaces.validation';

const workspaceCodePattern = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

const workspaceAuditActions = {
  created: 'WORKSPACE_CREATED',
  updated: 'WORKSPACE_UPDATED',
  activated: 'WORKSPACE_ACTIVATED',
  deactivated: 'WORKSPACE_DEACTIVATED',
  registrationOpened: 'WORKSPACE_REGISTRATION_OPENED',
  registrationClosed: 'WORKSPACE_REGISTRATION_CLOSED',
} as const;

export class WorkspacesService {
  constructor(
    private readonly workspacesRepository = new WorkspacesRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  async list(query: ListWorkspacesQuery) {
    const where: Prisma.WorkspaceWhereInput = query.registration
      ? { isActive: true, registrationEnabled: true }
      : {};

    const workspaces = await this.workspacesRepository.list(where);
    return workspaces.map(toWorkspaceSummaryDto);
  }

  async listAdmin(query: ListAdminWorkspacesQuery) {
    const { page, limit, offset } = normalizePagination(query);
    const where = buildWorkspaceListWhere(query);
    const { items, total } = await this.workspacesRepository.listAdmin({
      where,
      skip: offset,
      take: limit,
    });

    return {
      items: items.map((workspace) => ({
        id: workspace.id,
        code: workspace.code,
        name: workspace.name,
        shortName: workspace.shortName,
        isActive: workspace.isActive,
        registrationEnabled: workspace.registrationEnabled,
        userCount: workspace._count.users,
        applicationCount: workspace._count.applications,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdmin(workspaceId: string) {
    const workspace = await this.getWorkspaceOrThrow(workspaceId);
    const [usersByRoleRows, applicationsByStatusRows, activeCriteria, readiness] =
      await Promise.all([
        this.workspacesRepository.countUsersByRole(workspaceId),
        this.workspacesRepository.countApplicationsByStatus(workspaceId),
        this.workspacesRepository.findLatestActiveCriteria(workspaceId),
        this.getReadiness(workspaceId, {
          isActive: workspace.isActive,
          registrationEnabled: workspace.registrationEnabled,
        }),
      ]);

    return {
      id: workspace.id,
      code: workspace.code,
      name: workspace.name,
      shortName: workspace.shortName,
      isActive: workspace.isActive,
      registrationEnabled: workspace.registrationEnabled,
      totalUsers: workspace._count.users,
      usersByRole: toRoleCountMap(usersByRoleRows),
      totalApplications: workspace._count.applications,
      applicationsByStatus: toApplicationStatusCountMap(applicationsByStatusRows),
      activeCriteriaVersion: activeCriteria,
      readiness,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  async createAdmin(user: AuthenticatedUser, input: CreateAdminWorkspaceBody) {
    const code = input.code.trim().toUpperCase();
    if (!workspaceCodePattern.test(code)) {
      throw new AppError(
        400,
        ErrorCodes.WORKSPACE_CODE_INVALID,
        'Workspace code must be uppercase alphanumeric segments separated by hyphens',
      );
    }

    const isActive = input.isActive ?? true;
    const registrationEnabled = input.registrationEnabled ?? false;
    if (registrationEnabled && !isActive) {
      throw new AppError(
        400,
        ErrorCodes.WORKSPACE_STATUS_INVALID,
        'Registration cannot be enabled for an inactive workspace',
      );
    }

    const existing = await this.workspacesRepository.findByCode(code);
    if (existing) {
      throw new AppError(
        409,
        ErrorCodes.WORKSPACE_CODE_ALREADY_EXISTS,
        'Workspace code already exists',
      );
    }

    const workspace = await this.workspacesRepository.create({
      code,
      name: input.name.trim(),
      shortName: normalizeNullableString(input.shortName),
      isActive,
      registrationEnabled,
    });

    await this.logWorkspaceMutation(user, workspace.id, workspaceAuditActions.created, null, workspace);
    return toAdminWorkspaceDto(workspace);
  }

  async updateAdmin(
    user: AuthenticatedUser,
    workspaceId: string,
    input: UpdateAdminWorkspaceBody,
  ) {
    const before = await this.getWorkspaceOrThrow(workspaceId);
    const data: Prisma.WorkspaceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.shortName !== undefined) data.shortName = normalizeNullableString(input.shortName);

    const after = await this.workspacesRepository.update(workspaceId, data);
    await this.logWorkspaceMutation(
      user,
      workspaceId,
      workspaceAuditActions.updated,
      before,
      after,
    );
    return toAdminWorkspaceDto(after);
  }

  async updateStatusAdmin(
    user: AuthenticatedUser,
    workspaceId: string,
    input: UpdateAdminWorkspaceStatusBody,
  ) {
    const before = await this.getWorkspaceOrThrow(workspaceId);
    const nextIsActive = input.isActive ?? before.isActive;
    let nextRegistrationEnabled = input.registrationEnabled ?? before.registrationEnabled;

    if (!nextIsActive) {
      if (input.registrationEnabled === true) {
        throw new AppError(
          400,
          ErrorCodes.WORKSPACE_STATUS_INVALID,
          'Registration cannot be enabled for an inactive workspace',
        );
      }
      nextRegistrationEnabled = false;
    }

    if (nextRegistrationEnabled && !nextIsActive) {
      throw new AppError(
        400,
        ErrorCodes.WORKSPACE_STATUS_INVALID,
        'Registration cannot be enabled for an inactive workspace',
      );
    }

    if (nextRegistrationEnabled && !before.registrationEnabled) {
      const readiness = await this.getReadiness(workspaceId, {
        isActive: nextIsActive,
        registrationEnabled: nextRegistrationEnabled,
      });
      if (!readiness.readyForRegistration) {
        throw new AppError(
          409,
          ErrorCodes.WORKSPACE_NOT_READY_FOR_REGISTRATION,
          'Workspace is not ready to open registration',
          readiness,
        );
      }
    }

    const after = await this.workspacesRepository.update(workspaceId, {
      isActive: nextIsActive,
      registrationEnabled: nextRegistrationEnabled,
    });

    await this.logStatusAudits(user, before, after);
    return {
      ...toAdminWorkspaceDto(after),
      readiness: await this.getReadiness(workspaceId, {
        isActive: after.isActive,
        registrationEnabled: after.registrationEnabled,
      }),
    };
  }

  async listAdminWorkspaceUsers(workspaceId: string, query: ListAdminWorkspaceUsersQuery) {
    await this.getWorkspaceOrThrow(workspaceId);
    const { page, limit, offset } = normalizePagination(query);
    const { items, total } = await this.workspacesRepository.listWorkspaceUsers({
      workspaceId,
      where: buildWorkspaceUserListWhere(query),
      skip: offset,
      take: limit,
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getWorkspaceOrThrow(workspaceId: string) {
    const workspace = await this.workspacesRepository.findById(workspaceId);
    if (!workspace) {
      throw new AppError(404, ErrorCodes.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }
    return workspace;
  }

  private async getReadiness(
    workspaceId: string,
    workspace: { isActive: boolean; registrationEnabled: boolean },
  ) {
    const [activeCriteriaCount, managerCount, officerCount, committeeCount] = await Promise.all([
      this.workspacesRepository.countActiveCriteria(workspaceId),
      this.workspacesRepository.countRole(workspaceId, Role.manager),
      this.workspacesRepository.countRole(workspaceId, Role.officer),
      this.workspacesRepository.countRole(workspaceId, Role.committee),
    ]);

    const checks = {
      workspaceActive: workspace.isActive,
      hasActiveCriteria: activeCriteriaCount > 0,
      hasManager: managerCount > 0,
      hasOfficer: officerCount > 0,
      hasCommittee: committeeCount > 0,
      registrationOpen: workspace.registrationEnabled,
    };
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!checks.workspaceActive) blockers.push(ErrorCodes.WORKSPACE_INACTIVE);
    if (!checks.hasActiveCriteria) blockers.push(ErrorCodes.CRITERIA_VERSION_NOT_FOUND);
    if (!checks.hasManager) warnings.push('WORKSPACE_MANAGER_MISSING');
    if (!checks.hasOfficer) warnings.push('WORKSPACE_OFFICER_MISSING');
    if (!checks.hasCommittee) warnings.push('WORKSPACE_COMMITTEE_MISSING');

    return {
      readyForRegistration: blockers.length === 0,
      checks,
      warnings,
      blockers,
    };
  }

  private async logWorkspaceMutation(
    user: AuthenticatedUser,
    workspaceId: string,
    action: string,
    before: unknown,
    after: unknown,
    note?: string,
  ) {
    await this.auditService.log({
      actorId: user.id,
      actorRole: user.role,
      workspaceId,
      action,
      entityType: 'workspace',
      entityId: workspaceId,
      before,
      after,
      note,
    });
  }

  private async logStatusAudits(
    user: AuthenticatedUser,
    before: Awaited<ReturnType<WorkspacesService['getWorkspaceOrThrow']>>,
    after: Awaited<ReturnType<WorkspacesRepository['update']>>,
  ) {
    const logs: Array<{ action: string; note?: string }> = [];

    if (!before.isActive && after.isActive) logs.push({ action: workspaceAuditActions.activated });
    if (before.isActive && !after.isActive) {
      logs.push({
        action: workspaceAuditActions.deactivated,
        note: before.registrationEnabled ? 'Registration automatically closed on deactivation' : undefined,
      });
    }
    if (!before.registrationEnabled && after.registrationEnabled) {
      logs.push({ action: workspaceAuditActions.registrationOpened });
    }
    if (before.registrationEnabled && !after.registrationEnabled) {
      logs.push({
        action: workspaceAuditActions.registrationClosed,
        note: before.isActive && !after.isActive ? 'Closed because workspace was deactivated' : undefined,
      });
    }

    await Promise.all(
      logs.map((log) =>
        this.logWorkspaceMutation(user, before.id, log.action, before, after, log.note),
      ),
    );
  }
}

function buildWorkspaceListWhere(query: ListAdminWorkspacesQuery): Prisma.WorkspaceWhereInput {
  return {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.registrationEnabled === undefined
      ? {}
      : { registrationEnabled: query.registrationEnabled }),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { name: { contains: query.search, mode: 'insensitive' } },
            { shortName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

function buildWorkspaceUserListWhere(
  query: ListAdminWorkspaceUsersQuery,
): Prisma.UserWhereInput {
  return {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { studentCode: { contains: query.search, mode: 'insensitive' } },
            { faculty: { contains: query.search, mode: 'insensitive' } },
            { className: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

function toRoleCountMap(rows: Array<{ role: Role; _count: { _all: number } }>) {
  const result = Object.fromEntries(Object.values(Role).map((role) => [role, 0])) as Record<
    Role,
    number
  >;
  for (const row of rows) result[row.role] = row._count._all;
  return result;
}

function toApplicationStatusCountMap(
  rows: Array<{ status: ApplicationStatus; _count: { _all: number } }>,
) {
  const result = Object.fromEntries(
    Object.values(ApplicationStatus).map((status) => [status, 0]),
  ) as Record<ApplicationStatus, number>;
  for (const row of rows) result[row.status] = row._count._all;
  return result;
}

function toAdminWorkspaceDto(
  workspace: Awaited<ReturnType<WorkspacesRepository['findById']>> & object,
) {
  const typedWorkspace = workspace as NonNullable<
    Awaited<ReturnType<WorkspacesRepository['findById']>>
  >;
  return {
    id: typedWorkspace.id,
    code: typedWorkspace.code,
    name: typedWorkspace.name,
    shortName: typedWorkspace.shortName,
    isActive: typedWorkspace.isActive,
    registrationEnabled: typedWorkspace.registrationEnabled,
    userCount: typedWorkspace._count.users,
    applicationCount: typedWorkspace._count.applications,
    createdAt: typedWorkspace.createdAt,
    updatedAt: typedWorkspace.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
