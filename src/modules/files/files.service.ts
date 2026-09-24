// Owns file metadata and storage integration boundaries.
import { ReviewTaskStatus, Role } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { prisma } from '../../infrastructure/database/prisma';
import { requireUserWorkspace } from '../../shared/utils/workspace-scope';
import { WorkspaceType } from '@prisma/client';
import { FilesRepository } from './files.repository';
import { StorageService } from '../storage/storage.service';

export class FilesService {
  constructor(
    private readonly filesRepository = new FilesRepository(),
    private readonly storageService = new StorageService(),
  ) {}

  async getMetadata(user: AuthenticatedUser, fileId: string) {
    const file = await this.filesRepository.findById(fileId);
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    const canViewAll = this.canViewWorkspaceFile(user, file);
    const isCityOfficerEvidenceFile =
      user.role === Role.city_officer && Boolean(file.evidenceFiles?.length);
    const canOfficerView =
      user.role === Role.officer || user.role === Role.city_officer
        ? isCityOfficerEvidenceFile
          ? await this.canOfficerAccessEvidenceFile(user, file)
          : this.canOfficerAccessEventSourceFile(user, file) ||
            (await this.canOfficerAccessEvidenceFile(user, file))
        : false;
    const canViewAsOwner = file.ownerId === user.id && !isCityOfficerEvidenceFile;

    if (!canViewAsOwner && !canViewAll && !canOfficerView) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      publicUrl: file.publicUrl,
      createdAt: file.createdAt,
    };
  }

  async getSignedUrl(user: AuthenticatedUser, fileId: string): Promise<string> {
    const file = await this.filesRepository.findById(fileId);
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    const canViewAll = this.canViewWorkspaceFile(user, file);
    const isCityOfficerEvidenceFile =
      user.role === Role.city_officer && Boolean(file.evidenceFiles?.length);
    const canOfficerView =
      user.role === Role.officer || user.role === Role.city_officer
        ? isCityOfficerEvidenceFile
          ? await this.canOfficerAccessEvidenceFile(user, file)
          : this.canOfficerAccessEventSourceFile(user, file) ||
            (await this.canOfficerAccessEvidenceFile(user, file))
        : false;
    const canViewAsOwner = file.ownerId === user.id && !isCityOfficerEvidenceFile;

    if (!canViewAsOwner && !canViewAll && !canOfficerView) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    return this.storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  }

  private async canOfficerAccessEvidenceFile(
    user: AuthenticatedUser,
    file: NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>,
  ) {
    const evidenceLinks = file.evidenceFiles ?? [];
    if (!evidenceLinks.length) return false;

    for (const link of evidenceLinks) {
      const evidence = link.evidence;
      const applicationWorkspaceId = evidence.application?.workspaceId ?? file.workspaceId ?? null;
      const cityReviewer = user.role === Role.city_officer;
      const reviewSource = evidence.application ?? evidence.collectiveProfile;
      const inScope = cityReviewer
        ? user.workspace?.type === WorkspaceType.CITY &&
          user.workspaceId === user.workspace.id &&
          reviewSource?.workspace?.type === WorkspaceType.SCHOOL &&
          reviewSource.workspace.isActive
        : this.sameWorkspace(user, applicationWorkspaceId);
      if (!inScope) {
        continue;
      }
      const tasks = reviewSource?.reviewTasks ?? [];
      if (cityReviewer) {
        const hasFinalLinkedTask = tasks.some(
          (task) =>
            task.assignedOfficerId === user.id &&
            task.criterion === evidence.criterion &&
            (task.status === ReviewTaskStatus.accepted ||
              task.status === ReviewTaskStatus.rejected) &&
            task.evidences?.some((link) => link.evidenceId === evidence.id),
        );
        if (!hasFinalLinkedTask) {
          continue;
        }
        const specialization = await prisma.officerSpecialization.findFirst({
          where: {
            officerId: user.id,
            criterion: evidence.criterion,
            isActive: true,
            officer: {
              role: Role.city_officer,
              isActive: true,
              workspaceId: user.workspaceId,
            },
          },
        });
        if (specialization) return true;
        continue;
      }
      if (evidence.assignedOfficerId === user.id) return true;
      if (
        tasks.some(
          (task) => task.assignedOfficerId === user.id && task.criterion === evidence.criterion,
        )
      ) {
        return true;
      }
      const spec = await prisma.officerSpecialization.findFirst({
        where: {
          officerId: user.id,
          criterion: evidence.criterion,
          isActive: true,
          officer: {
            role: Role.officer,
            isActive: true,
            workspaceId: user.workspaceId,
          },
        },
      });
      if (spec) return true;
    }

    return false;
  }

  private canViewWorkspaceFile(
    user: AuthenticatedUser,
    file: NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>,
  ) {
    if (user.role === Role.admin) return true;
    if (
      (user.role === Role.city_manager || user.role === Role.city_committee) &&
      user.workspace?.type === WorkspaceType.CITY &&
      user.workspaceId === user.workspace.id
    ) {
      const schoolEvidence = file.evidenceFiles?.some(
        ({ evidence }) =>
          evidence.application?.workspace?.type === WorkspaceType.SCHOOL &&
          evidence.application.workspace.isActive,
      );
      const cityEventFile = file.eventFiles?.some(
        ({ event }) =>
          event.workspaceId === user.workspaceId &&
          event.workspace?.type === WorkspaceType.CITY &&
          event.workspace.isActive,
      );
      const cityExport =
        file.workspaceId === user.workspaceId && file.filePath.replace(/\\/g, '/').startsWith('exports/');
      return Boolean(schoolEvidence || cityEventFile || cityExport);
    }
    if (user.role !== Role.manager && user.role !== Role.committee) return false;
    return this.sameWorkspace(user, resolveFileWorkspaceId(file));
  }

  private canOfficerAccessEventSourceFile(
    user: AuthenticatedUser,
    file: NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>,
  ) {
    return (
      file.eventFiles?.some((link) => this.sameWorkspace(user, link.event.workspaceId)) ||
      file.decisionImports?.some((decisionImport) =>
        this.sameWorkspace(user, decisionImport.workspaceId),
      ) ||
      file.sampleCertificateEvents?.some((event) => this.sameWorkspace(user, event.workspaceId)) ||
      false
    );
  }

  private sameWorkspace(user: AuthenticatedUser, workspaceId: string | null | undefined) {
    return Boolean(workspaceId && workspaceId === requireUserWorkspace(user));
  }
}

function resolveFileWorkspaceId(
  file: NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>,
) {
  return (
    file.workspaceId ??
    file.evidenceFiles?.find((link) => link.evidence.application?.workspaceId)?.evidence.application
      ?.workspaceId ??
    file.evidenceFiles?.find((link) => link.evidence.collectiveProfile?.workspaceId)?.evidence
      .collectiveProfile?.workspaceId ??
    file.eventFiles?.find((link) => link.event.workspaceId)?.event.workspaceId ??
    file.decisionImports?.find((decisionImport) => decisionImport.workspaceId)?.workspaceId ??
    file.sampleCertificateEvents?.find((event) => event.workspaceId)?.workspaceId ??
    null
  );
}
