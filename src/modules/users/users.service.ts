import { Criterion, FileStorageType, Role, WorkspaceType } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { pickSafeUser } from '../../shared/utils/pick-safe-user';
import { sanitizeFileName } from '../storage/storage.types';
import { StorageService } from '../storage/storage.service';
import { UsersRepository } from './users.repository';
import type { ListAdminUsersQuery, ListUsersQuery, UpdateAdminUserInput, CreateAdminUserInput, UpdateMeInput } from './users.validation';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';

export class UsersService {
  constructor(
    private readonly usersRepository = new UsersRepository(),
    private readonly storageService = new StorageService(),
    private readonly passwordService = new PasswordService(),
    private readonly auditService = new AuditService(),
  ) {}

  async getMe(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'User not found');
    }

    return {
      ...pickSafeUser(user),
      officerSpecializations: user.officerSpecializations ?? [],
    };
  }

  async updateMe(userId: string, input: UpdateMeInput) {
    const user = await this.usersRepository.updateById(userId, input);
    return pickSafeUser(user);
  }

  async uploadAvatar(userId: string, file?: Express.Multer.File) {
    if (!file) {
      throw new AppError(400, ErrorCodes.FILE_UPLOAD_FAILED, 'Avatar file is required');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new AppError(400, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 'Avatar must be an image file');
    }

    const maxAvatarSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxAvatarSizeBytes) {
      throw new AppError(400, ErrorCodes.FILE_TOO_LARGE, 'Avatar image must be 5MB or smaller');
    }

    const timestamp = Date.now();
    const safeOriginalName = sanitizeFileName(file.originalname);
    const objectKey = `users/${userId}/avatar/${timestamp}-${safeOriginalName}`;

    await this.storageService.uploadObject({
      key: objectKey,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    const user = await this.usersRepository.createAvatarFileAndUpdateUser({
      userId,
      storageType: env.STORAGE_DRIVER === 'r2' ? FileStorageType.r2 : FileStorageType.local,
      filePath: objectKey,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
    });

    return pickSafeUser(user);
  }

  async listUsers(user: AuthenticatedUser, query: ListUsersQuery) {
    const result = await this.usersRepository.list(user, query);
    const totalPages = Math.ceil(result.total / query.limit);

    return {
      users: result.users.map(pickSafeUser),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages,
      },
    };
  }

  async listAdminUsers(query: ListAdminUsersQuery) {
    const result = await this.usersRepository.listAdmin(query);
    return {
      users: result.users.map((user) => ({
        ...pickSafeUser(user),
        officerSpecializations: user.officerSpecializations,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async getAdminUser(userId: string) {
    const user = await this.requireAdminUser(userId);
    return { ...pickSafeUser(user), officerSpecializations: user.officerSpecializations };
  }

  async createAdminUser(actor: AuthenticatedUser, input: CreateAdminUserInput) {
    const email = input.email.trim().toLowerCase();
    if (await this.usersRepository.findAdminByEmail(email)) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Email is already registered');
    }
    await this.assertAdminRoleWorkspace(input.role, input.workspaceId ?? null, input.studentCode);
    const created = await this.usersRepository.createAdminUser({
      fullName: input.fullName.trim(),
      email,
      passwordHash: await this.passwordService.hashPassword(input.password),
      role: input.role,
      workspaceId: input.workspaceId ?? null,
      studentCode: normalizeAdminString(input.studentCode)?.toUpperCase() ?? null,
      className: normalizeAdminString(input.className),
      faculty: normalizeAdminString(input.faculty),
      phone: normalizeAdminString(input.phone),
    });
    await this.auditService.log({
      actorId: actor.id, actorRole: actor.role, workspaceId: created.workspaceId,
      action: 'USER_CREATED', entityType: 'user', entityId: created.id,
      after: { role: created.role, workspaceId: created.workspaceId, isActive: created.isActive },
    });
    return { ...pickSafeUser(created), officerSpecializations: created.officerSpecializations };
  }

  async updateAdminUser(actor: AuthenticatedUser, userId: string, input: UpdateAdminUserInput) {
    const before = await this.requireAdminUser(userId);
    const role = input.role ?? before.role;
    const workspaceId = input.workspaceId === undefined ? before.workspaceId : input.workspaceId;
    const studentCode = input.studentCode === undefined ? before.studentCode ?? undefined : input.studentCode ?? undefined;
    await this.assertAdminRoleWorkspace(role, workspaceId, studentCode);
    const assignmentChanged = role !== before.role || workspaceId !== before.workspaceId;
    if (assignmentChanged && await this.usersRepository.hasWorkflowReferences(userId)) {
      throw new AppError(
        409,
        ErrorCodes.USER_WORKFLOW_REASSIGNMENT_BLOCKED,
        'Tài khoản đã tham gia quy trình và không thể đổi vai trò hoặc đơn vị. Hãy ngừng kích hoạt tài khoản nếu cần.',
      );
    }
    if (input.email && await this.usersRepository.findAdminByEmail(input.email, userId)) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Email is already registered');
    }
    const updated = await this.usersRepository.updateAdminUser(userId, {
      ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.role !== undefined ? { role } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId } : {}),
      ...(input.studentCode !== undefined ? { studentCode: input.studentCode?.toUpperCase() ?? null } : {}),
      ...(input.className !== undefined ? { className: input.className } : {}),
      ...(input.faculty !== undefined ? { faculty: input.faculty } : {}),
    });
    await this.auditService.log({
      actorId: actor.id, actorRole: actor.role, workspaceId: updated.workspaceId,
      action: assignmentChanged ? 'USER_ROLE_WORKSPACE_UPDATED' : 'USER_PROFILE_UPDATED',
      entityType: 'user', entityId: userId,
      before: { role: before.role, workspaceId: before.workspaceId, fullName: before.fullName, email: before.email },
      after: { role: updated.role, workspaceId: updated.workspaceId, fullName: updated.fullName, email: updated.email },
    });
    return { ...pickSafeUser(updated), officerSpecializations: updated.officerSpecializations };
  }

  async setAdminUserActive(actor: AuthenticatedUser, userId: string, isActive: boolean) {
    const before = await this.requireAdminUser(userId);
    if (!isActive && actor.id === userId) {
      throw new AppError(409, ErrorCodes.CONFLICT, 'Admin cannot deactivate their own account');
    }
    await this.assertAdminRoleWorkspace(before.role, before.workspaceId, before.studentCode ?? undefined);
    const updated = await this.usersRepository.setAdminUserActive(userId, isActive);
    if (!isActive) await this.usersRepository.revokeRefreshTokensForUser(userId);
    await this.auditService.log({
      actorId: actor.id, actorRole: actor.role, workspaceId: updated.workspaceId,
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', entityType: 'user', entityId: userId,
      before: { isActive: before.isActive }, after: { isActive: updated.isActive },
    });
    return { ...pickSafeUser(updated), officerSpecializations: updated.officerSpecializations };
  }

  async setOfficerSpecializations(actor: AuthenticatedUser, userId: string, criteria: Criterion[]) {
    const officer = await this.requireAdminUser(userId);
    if (officer.role !== Role.city_officer || !officer.workspace || officer.workspaceId === null) {
      throw new AppError(400, ErrorCodes.USER_WORKSPACE_ROLE_INVALID, 'Specializations require an officer in a CITY workspace');
    }
    const workspace = await this.usersRepository.findWorkspaceAdmin(officer.workspaceId);
    if (!workspace || workspace.type !== WorkspaceType.CITY) {
      throw new AppError(400, ErrorCodes.USER_WORKSPACE_ROLE_INVALID, 'Specializations require an officer in a CITY workspace');
    }
    const current = await this.usersRepository.listOfficerSpecializations(userId);
    const removed = Array.from(new Set(current.filter((item) => item.isActive && !criteria.includes(item.criterion)).map((item) => item.criterion)));
    if (await this.usersRepository.countActiveAssignmentsForCriteria(userId, removed)) {
      throw new AppError(409, ErrorCodes.USER_SPECIALIZATION_ASSIGNMENT_BLOCKED, 'Hãy phân công lại các hồ sơ đang mở trước khi gỡ chuyên môn này.');
    }
    const updated = await this.usersRepository.replaceOfficerSpecializations(userId, criteria);
    await this.auditService.log({
      actorId: actor.id, actorRole: actor.role, workspaceId: officer.workspaceId,
      action: 'CITY_OFFICER_SPECIALIZATIONS_UPDATED', entityType: 'user', entityId: userId,
      before: current.filter((item) => item.isActive).map((item) => ({ criterion: item.criterion, facultyScope: item.facultyScope })),
      after: updated.map((item) => ({ criterion: item.criterion, facultyScope: item.facultyScope })),
    });
    return updated;
  }

  private async requireAdminUser(userId: string) {
    const user = await this.usersRepository.findAdminById(userId);
    if (!user) throw new AppError(404, ErrorCodes.NOT_FOUND, 'User not found');
    return user;
  }

  private async assertAdminRoleWorkspace(role: Role, workspaceId: string | null, studentCode?: string) {
    if (role === Role.student && !studentCode) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Student code is required');
    }
    if (role === Role.admin && !workspaceId) return;
    if (!workspaceId) throw new AppError(400, ErrorCodes.USER_WORKSPACE_REQUIRED, 'Workspace is required for this role');
    const workspace = await this.usersRepository.findWorkspaceAdmin(workspaceId);
    if (!workspace) throw new AppError(404, ErrorCodes.WORKSPACE_NOT_FOUND, 'Workspace not found');
    if (!workspace.isActive) throw new AppError(400, ErrorCodes.WORKSPACE_INACTIVE, 'Workspace is inactive');
    const valid = role === Role.student
      ? workspace.type === WorkspaceType.SCHOOL
      : role === Role.data_uploader
        ? workspace.type === WorkspaceType.SCHOOL || workspace.type === WorkspaceType.UNIVERSITY_SYSTEM
        : role === Role.city_officer || role === Role.city_manager || role === Role.city_committee
          ? workspace.type === WorkspaceType.CITY
          : role === Role.class_representative || role === Role.officer || role === Role.manager || role === Role.committee
            ? workspace.type === WorkspaceType.SCHOOL
          : true;
    if (!valid) throw new AppError(400, ErrorCodes.USER_WORKSPACE_ROLE_INVALID, 'Role and workspace types do not match');
  }
}

function normalizeAdminString(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
