// Owns file metadata and storage integration boundaries.
import { Role, WorkspaceType } from '@prisma/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { requireUserWorkspace } from '../../shared/utils/workspace-scope';
import { FilesRepository } from './files.repository';
import { StorageService } from '../storage/storage.service';
import { ReviewService, type ReviewTaskVisibilityContext } from '../review/review.service';

type CityOfficerFile = NonNullable<Awaited<ReturnType<FilesRepository['findByIdForCityOfficer']>>>;
type CityOfficerEvidence = CityOfficerFile['evidenceFiles'][number]['evidence'];
type CityOfficerReviewSource =
  | NonNullable<CityOfficerEvidence['application']>
  | NonNullable<CityOfficerEvidence['collectiveProfile']>;
type CityOfficerReviewTask = CityOfficerReviewSource['reviewTasks'][number];

export class FilesService {
  constructor(
    private readonly filesRepository = new FilesRepository(),
    private readonly storageService = new StorageService(),
    private readonly reviewService = new ReviewService(),
  ) {}

  async getMetadata(user: AuthenticatedUser, fileId: string) {
    if (user.role === Role.student || user.role === Role.class_representative) {
      const ownedFile = await this.filesRepository.findOwnedById(fileId, user.id);
      if (!ownedFile) {
        throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
      }

      return {
        id: ownedFile.id,
        originalName: ownedFile.originalName,
        mimeType: ownedFile.mimeType,
        fileSize: ownedFile.fileSize,
        publicUrl: ownedFile.publicUrl,
        createdAt: ownedFile.createdAt,
      };
    }

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
    const canViewAsOwner =
      user.role !== Role.data_uploader && file.ownerId === user.id && !isCityOfficerEvidenceFile;

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
    if (user.role === Role.city_officer) {
      const [file, specializations] = await Promise.all([
        this.filesRepository.findByIdForCityOfficer(fileId),
        this.filesRepository.findActiveCityOfficerCriteria(user.id),
      ]);
      if (!file) {
        throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
      }

      const permissionCache = new Map<string, Promise<boolean>>();
      for (const criterion of new Set(file.evidenceFiles.map((link) => link.evidence.criterion))) {
        permissionCache.set(
          `${user.id}:${criterion}`,
          Promise.resolve(specializations.some((item) => item.criterion === criterion)),
        );
      }
      const isEvidenceFile = file.evidenceFiles.length > 0;
      const canOfficerView = isEvidenceFile
        ? await this.canOfficerAccessEvidenceFile(user, file, permissionCache)
        : this.canOfficerAccessEventSourceFile(user, file) ||
          (await this.canOfficerAccessEvidenceFile(user, file, permissionCache));
      const canViewAsOwner = file.ownerId === user.id && !isEvidenceFile;

      if (!canViewAsOwner && !canOfficerView) {
        throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
      }

      return this.storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
    }

    if (user.role === Role.student || user.role === Role.class_representative) {
      const ownedFile = await this.filesRepository.findOwnedById(fileId, user.id);
      if (!ownedFile) {
        throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
      }

      return this.storageService.getSignedReadUrl(
        ownedFile.filePath,
        300,
        ownedFile.storageType,
      );
    }

    const file = await this.filesRepository.findById(fileId);
    if (!file) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    const canViewAll = this.canViewWorkspaceFile(user, file);
    const canOfficerView =
      user.role === Role.officer
        ? this.canOfficerAccessEventSourceFile(user, file) ||
          (await this.canOfficerAccessEvidenceFile(user, file))
        : false;
    const canViewAsOwner = user.role !== Role.data_uploader && file.ownerId === user.id;

    if (!canViewAsOwner && !canViewAll && !canOfficerView) {
      throw new AppError(404, ErrorCodes.FILE_NOT_FOUND, 'File not found');
    }

    return this.storageService.getSignedReadUrl(file.filePath, 300, file.storageType);
  }

  private async canOfficerAccessEvidenceFile(
    user: AuthenticatedUser,
    file: Pick<CityOfficerFile, 'evidenceFiles'>,
    permissionCache?: Map<string, Promise<boolean>>,
  ) {
    const evidenceLinks = file.evidenceFiles ?? [];
    if (!evidenceLinks.length) return false;

    for (const link of evidenceLinks) {
      const evidence = link.evidence;
      const reviewSource = evidence.application ?? evidence.collectiveProfile;
      if (!reviewSource) continue;
      const tasks = reviewSource?.reviewTasks ?? [];
      for (const task of tasks) {
        if (task.criterion !== evidence.criterion) continue;
        if (!task.evidences?.some((link) => link.evidenceId === evidence.id)) continue;

        const taskContext = this.buildTaskVisibilityContext(evidence, reviewSource, task);
        if (await this.reviewService.canViewTask(user, taskContext, permissionCache)) return true;
      }
    }

    return false;
  }

  private buildTaskVisibilityContext(
    evidence: CityOfficerEvidence,
    reviewSource: CityOfficerReviewSource,
    task: CityOfficerReviewTask,
  ): ReviewTaskVisibilityContext {
    const application = evidence.application
      ? {
          applicationType: evidence.application.applicationType,
          targetLevel: evidence.application.targetLevel,
          student: { faculty: evidence.application.student?.faculty ?? null },
        }
      : null;
    const collectiveProfile = evidence.collectiveProfile
      ? {
          targetLevel: evidence.collectiveProfile.targetLevel,
          representative: {
            faculty: evidence.collectiveProfile.representative?.faculty ?? null,
          },
        }
      : null;

    return {
      workspaceId: reviewSource!.workspaceId,
      workspace: reviewSource!.workspace,
      assignedOfficerId: task.assignedOfficerId,
      status: task.status,
      criterion: task.criterion,
      application,
      collectiveProfile,
    };
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
    if (user.role === Role.data_uploader) {
      const awardDecisionFiles = [
        ...(file.awardDecisionsAsDecisionFile ?? []),
        ...(file.awardDecisionsAsRosterFile ?? []),
      ];
      return (
        this.sameWorkspace(user, file.workspaceId) &&
        awardDecisionFiles.some(({ issuerWorkspaceId }) => issuerWorkspaceId === user.workspaceId)
      );
    }
    if (user.role !== Role.manager && user.role !== Role.committee) return false;
    return this.sameWorkspace(user, resolveFileWorkspaceId(file));
  }

  private canOfficerAccessEventSourceFile(
    user: AuthenticatedUser,
    file: Pick<NonNullable<Awaited<ReturnType<FilesRepository['findById']>>>, 'eventFiles' | 'decisionImports' | 'sampleCertificateEvents'> | Pick<CityOfficerFile, 'eventFiles' | 'decisionImports' | 'sampleCertificateEvents'>,
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
