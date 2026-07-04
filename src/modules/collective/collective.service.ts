import {
  CollectiveStatus,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  FileStorageType,
  FinalStatus,
  IndexingStatus,
  JobType,
  NotificationType,
  ReviewTaskStatus,
  Role,
  type CollectiveProfile,
  type Prisma,
} from '@prisma/client';
import { readSheet } from 'read-excel-file/node';
import { prisma } from '../../infrastructure/database/prisma';
import { LocalStorageService } from '../../infrastructure/storage/local-storage.service';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { normalizeSchoolYear } from '../../shared/utils/school-year';
import { createApplicationAudit } from '../applications/application.helpers';
import { JobsService, runIndexingJob } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewAssignmentService } from '../review/review-assignment.service';
import { buildCollectiveMemberSummary } from './collective-member-summary';
import { runCollectivePrecheck } from './collective-precheck.service';
import type {
  CollectivePrecheckInput,
  CollectiveSubmitInput,
  CreateCollectiveEvidenceInput,
  FinalizeCollectiveInput,
  GetCurrentCollectiveQuery,
  ImportCollectiveEventInput,
  ListCollectiveEvidencesQuery,
  ListCollectiveMembersQuery,
  ListManagerCollectivesQuery,
  StartCollectiveIndexingInput,
  StartCollectiveProfileInput,
  UpdateCollectiveMemberInput,
  UpdateCollectiveProfileInput,
  UpsertCollectiveMemberInput,
} from './collective.validation';

type UploadedFile = Express.Multer.File;
type RosterInvalidRow = {
  row: number;
  reason: string;
  data?: Record<string, string>;
};

type RosterParseResult = {
  rows: UpsertCollectiveMemberInput[];
  totalRows: number;
  invalidRows: RosterInvalidRow[];
};

const editableStatuses = new Set<CollectiveStatus>([
  CollectiveStatus.draft,
  CollectiveStatus.prechecked,
  CollectiveStatus.ready_to_submit,
  CollectiveStatus.supplement_required,
]);

const collectiveFinalizeBlockingStatuses = new Set<ReviewTaskStatus>([
  ReviewTaskStatus.waiting,
  ReviewTaskStatus.reviewing,
  ReviewTaskStatus.supplement_required,
  ReviewTaskStatus.resolution_needed,
]);

function isCollectiveFinalizeBlocker(status: ReviewTaskStatus): boolean {
  return collectiveFinalizeBlockingStatuses.has(status);
}

function buildCollectiveFinalizeReadiness(statuses: ReviewTaskStatus[]) {
  if (statuses.length === 0) {
    return {
      canFinalize: false,
      blockingReasons: ['Chua co task xet duyet tap the.'],
    };
  }

  const counts = statuses.reduce(
    (acc, status) => {
      if (isCollectiveFinalizeBlocker(status)) {
        acc[status] = (acc[status] ?? 0) + 1;
      }
      return acc;
    },
    {} as Partial<Record<ReviewTaskStatus, number>>,
  );
  const blockingReasons = Object.entries(counts).map(([status, count]) =>
    collectiveBlockingReason(status as ReviewTaskStatus, count),
  );

  return {
    canFinalize: blockingReasons.length === 0,
    blockingReasons,
  };
}

function collectiveBlockingReason(status: ReviewTaskStatus, count: number): string {
  const suffix = count > 1 ? `${count} task` : '1 task';
  if (status === ReviewTaskStatus.waiting) return `Con ${suffix} dang cho phan cong/xet duyet.`;
  if (status === ReviewTaskStatus.reviewing) return `Con ${suffix} dang duoc xet duyet.`;
  if (status === ReviewTaskStatus.supplement_required) return `Con ${suffix} yeu cau bo sung minh chung.`;
  if (status === ReviewTaskStatus.resolution_needed) return `Con ${suffix} can hoi dong xu ly.`;
  return `Con ${suffix} chua hoan tat.`;
}

export class CollectiveService {
  constructor(
    private readonly storageService = new LocalStorageService(),
    private readonly jobsService = new JobsService(),
    private readonly assignmentService = new ReviewAssignmentService(),
    private readonly notificationsService = new NotificationsService(),
  ) {}

  async getCurrent(user: AuthenticatedUser, query: GetCurrentCollectiveQuery) {
    const schoolYear = normalizeSchoolYear(query.schoolYear);
    const className = this.resolveClassName(user, query.className);
    const profile = await prisma.collectiveProfile.findUnique({
      where: {
        representativeId_schoolYear_className: {
          representativeId: user.id,
          schoolYear,
          className,
        },
      },
    });

    if (!profile) {
      return { profile: null, state: 'not_started', schoolYear, className };
    }
    const detail = await this.getDetail(user, profile.id);
    return { profile: detail, state: profile.status, schoolYear, className };
  }

  async start(user: AuthenticatedUser, input: StartCollectiveProfileInput) {
    const schoolYear = normalizeSchoolYear(input.schoolYear);
    const className = this.resolveClassName(user, input.className);
    const existing = await prisma.collectiveProfile.findUnique({
      where: {
        representativeId_schoolYear_className: {
          representativeId: user.id,
          schoolYear,
          className,
        },
      },
    });

    if (existing) return this.getDetail(user, existing.id);

    const profile = await prisma.$transaction(async (tx) => {
      const created = await tx.collectiveProfile.create({
        data: {
          representativeId: user.id,
          className,
          schoolYear,
          targetLevel: input.targetLevel,
        },
      });
      await this.audit(tx, user, created.id, auditActions.COLLECTIVE_PROFILE_STARTED, {
        className,
        schoolYear,
        targetLevel: input.targetLevel,
      });
      return created;
    });

    return this.getDetail(user, profile.id);
  }

  async getDetail(user: AuthenticatedUser, profileId: string) {
    const profile = await prisma.collectiveProfile.findUnique({
      where: { id: profileId },
      include: {
        representative: true,
        members: { orderBy: { studentCode: 'asc' } },
        evidences: {
          include: {
            evidence: {
              include: { evidenceFiles: { include: { file: true } }, evidenceCard: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviewTasks: { include: { assignedOfficer: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!profile) this.notFound();
    this.assertCanView(user, profile);
    return this.toProfileDto(profile);
  }

  async update(user: AuthenticatedUser, profileId: string, input: UpdateCollectiveProfileInput) {
    const profile = await this.getRequiredProfile(profileId);
    if (user.role === Role.manager || user.role === Role.admin) {
      this.assertCanView(user, profile);
      this.assertNotFinal(profile);
    } else {
      this.assertOwner(user, profile);
      this.assertEditable(profile);
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.collectiveProfile.update({
        where: { id: profile.id },
        data: {
          ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
          ...(input.className ? { className: input.className } : {}),
        },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_PROFILE_UPDATED, {
        targetLevel: updated.targetLevel,
        className: updated.className,
        note: input.note,
      });
    });
    return this.getDetail(user, profile.id);
  }

  async listMembers(user: AuthenticatedUser, profileId: string, query: ListCollectiveMembersQuery) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertCanView(user, profile);
    const where: Prisma.CollectiveMemberWhereInput = {
      collectiveProfileId: profile.id,
      ...(query.q
        ? {
            OR: [
              { studentCode: { contains: query.q, mode: 'insensitive' } },
              { studentName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.participationStatus ? { participationStatus: query.participationStatus } : {}),
      ...(query.individualSv5tLevel ? { individualSv5tLevel: query.individualSv5tLevel } : {}),
      ...(query.violationStatus ? { violationStatus: query.violationStatus } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total, allMembers] = await prisma.$transaction([
      prisma.collectiveMember.findMany({
        where,
        orderBy: { studentCode: 'asc' },
        skip,
        take: query.limit,
      }),
      prisma.collectiveMember.count({ where }),
      prisma.collectiveMember.findMany({ where: { collectiveProfileId: profile.id } }),
    ]);
    return {
      items,
      memberSummary: buildCollectiveMemberSummary(allMembers),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async upsertMember(
    user: AuthenticatedUser,
    profileId: string,
    input: UpsertCollectiveMemberInput,
  ) {
    const profile = await this.getRequiredEditableOwnedProfile(user, profileId);
    return prisma.$transaction(async (tx) => {
      const member = await tx.collectiveMember.upsert({
        where: {
          collectiveProfileId_studentCode: {
            collectiveProfileId: profile.id,
            studentCode: input.studentCode.trim(),
          },
        },
        update: input,
        create: { collectiveProfileId: profile.id, ...input },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_MEMBER_UPSERTED, {
        memberId: member.id,
        studentCode: member.studentCode,
      });
      return member;
    });
  }

  async updateMember(
    user: AuthenticatedUser,
    profileId: string,
    memberId: string,
    input: UpdateCollectiveMemberInput,
  ) {
    const profile = await this.getRequiredProfile(profileId);
    if (user.role === Role.manager || user.role === Role.admin) {
      this.assertCanView(user, profile);
      this.assertNotFinal(profile);
    } else {
      this.assertOwner(user, profile);
      this.assertEditable(profile);
    }
    const member = await prisma.collectiveMember.findFirst({
      where: { id: memberId, collectiveProfileId: profile.id },
    });
    if (!member) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_MEMBER_NOT_FOUND,
        'Collective member not found',
      );
    }
    return prisma.$transaction(async (tx) => {
      const updated = await tx.collectiveMember.update({ where: { id: member.id }, data: input });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_MEMBER_UPDATED, {
        memberId: updated.id,
        studentCode: updated.studentCode,
      });
      return updated;
    });
  }

  async deleteMember(user: AuthenticatedUser, profileId: string, memberId: string) {
    const profile = await this.getRequiredEditableOwnedProfile(user, profileId);
    const member = await prisma.collectiveMember.findFirst({
      where: { id: memberId, collectiveProfileId: profile.id },
    });
    if (!member) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_MEMBER_NOT_FOUND,
        'Collective member not found',
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.collectiveMember.delete({ where: { id: member.id } });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_MEMBER_DELETED, {
        memberId: member.id,
        studentCode: member.studentCode,
      });
    });
    return { deleted: true };
  }

  async importRoster(user: AuthenticatedUser, profileId: string, file?: UploadedFile) {
    const profile = await this.getRequiredProfile(profileId);
    if (user.role === Role.manager || user.role === Role.admin) {
      this.assertCanView(user, profile);
      this.assertNotFinal(profile);
    } else {
      this.assertOwner(user, profile);
      this.assertEditable(profile);
    }
    if (!file) {
      throw new AppError(400, ErrorCodes.COLLECTIVE_ROSTER_INVALID, 'Roster file is required');
    }
    const { rows, totalRows, invalidRows } = await parseRosterFile(file);
    if (rows.length === 0) {
      return {
        totalRows,
        inserted: 0,
        updated: 0,
        skipped: invalidRows.length,
        invalidRows,
      };
    }
    const storedRoster = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      directory: `collective-rosters/${profile.id}`,
    });

    const existingCodes = new Set(
      (
        await prisma.collectiveMember.findMany({
          where: {
            collectiveProfileId: profile.id,
            studentCode: { in: rows.map((row) => row.studentCode) },
          },
          select: { studentCode: true },
        })
      ).map((item) => item.studentCode),
    );
    await prisma.$transaction(async (tx) => {
      const sourceFile = await tx.file.create({
        data: {
          ownerId: user.id,
          storageType: FileStorageType.local,
          filePath: storedRoster.filePath,
          publicUrl: storedRoster.publicUrl,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: user.id,
        },
      });
      for (const row of rows) {
        await tx.collectiveMember.upsert({
          where: {
            collectiveProfileId_studentCode: {
              collectiveProfileId: profile.id,
              studentCode: row.studentCode,
            },
          },
          update: row,
          create: { collectiveProfileId: profile.id, ...row },
        });
      }
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_ROSTER_IMPORTED, {
        importedCount: rows.length,
        fileName: file.originalname,
        sourceFileId: sourceFile.id,
      });
    });
    const updated = rows.filter((row) => existingCodes.has(row.studentCode)).length;
    return {
      totalRows,
      inserted: rows.length - updated,
      updated,
      skipped: invalidRows.length,
      invalidRows,
    };
  }

  async listEvidences(
    user: AuthenticatedUser,
    profileId: string,
    query: ListCollectiveEvidencesQuery,
  ) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertCanView(user, profile);
    const where: Prisma.CollectiveEvidenceWhereInput = {
      collectiveProfileId: profile.id,
      ...(query.collectiveCriterion ? { collectiveCriterion: query.collectiveCriterion } : {}),
      evidence: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.indexingStatus ? { indexingStatus: query.indexingStatus } : {}),
      },
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await prisma.$transaction([
      prisma.collectiveEvidence.findMany({
        where,
        include: {
          evidence: {
            include: { evidenceFiles: { include: { file: true } }, evidenceCard: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.collectiveEvidence.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async createEvidence(
    user: AuthenticatedUser,
    profileId: string,
    input: CreateCollectiveEvidenceInput,
  ) {
    const profile = await this.getRequiredEditableOwnedProfile(user, profileId);
    return prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.create({
        data: {
          collectiveProfileId: profile.id,
          evidenceName: input.evidenceName,
          criterion: Criterion.collective,
          sourceType: input.sourceType,
          status: EvidenceStatus.draft,
          indexingStatus: IndexingStatus.not_started,
        },
      });
      const link = await tx.collectiveEvidence.create({
        data: {
          collectiveProfileId: profile.id,
          evidenceId: evidence.id,
          collectiveCriterion: input.collectiveCriterion,
        },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_EVIDENCE_CREATED, {
        evidenceId: evidence.id,
        collectiveCriterion: link.collectiveCriterion,
      });
      return { ...link, evidence };
    });
  }

  async uploadEvidenceFile(user: AuthenticatedUser, evidenceId: string, file?: UploadedFile) {
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence?.collectiveProfileId) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_EVIDENCE_NOT_FOUND,
        'Collective evidence not found',
      );
    }
    const profile = await this.getRequiredEditableOwnedProfile(user, evidence.collectiveProfileId);
    if (!file) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence file is required');
    }
    const link = await this.getRequiredEvidenceLink(profile.id, evidenceId);
    const stored = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      directory: `collective-evidences/${profile.id}/${evidenceId}`,
    });
    return prisma.$transaction(async (tx) => {
      const fileRecord = await tx.file.create({
        data: {
          ownerId: user.id,
          storageType: FileStorageType.local,
          filePath: stored.filePath,
          publicUrl: stored.publicUrl,
          originalName: file.originalname,
          mimeType: file.mimetype,
          fileSize: file.size,
          uploadedBy: user.id,
        },
      });
      const fileRole = link.evidence.evidenceFiles.length === 0 ? 'primary' : 'supporting';
      await tx.evidenceFile.create({
        data: { evidenceId, fileId: fileRecord.id, fileRole },
      });
      await tx.evidence.update({
        where: { id: evidenceId },
        data: {
          indexingStatus: IndexingStatus.uploaded,
          status: EvidenceStatus.pending_indexing,
        },
      });
      const job = await tx.indexingJob.create({
        data: { jobType: JobType.evidence_ocr, targetId: evidenceId },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_EVIDENCE_FILE_UPLOADED, {
        evidenceId,
        fileId: fileRecord.id,
        jobId: job.id,
      });
      return { file: fileRecord, job };
    });
  }

  async startEvidenceIndexing(
    user: AuthenticatedUser,
    evidenceId: string,
    input: StartCollectiveIndexingInput,
  ) {
    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!evidence?.collectiveProfileId) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_EVIDENCE_NOT_FOUND,
        'Collective evidence not found',
      );
    }
    const profile = await this.getRequiredProfile(evidence.collectiveProfileId);
    this.assertCanView(user, profile);
    const link = await this.getRequiredEvidenceLink(profile.id, evidenceId);
    if (link.evidence.evidenceFiles.length === 0) {
      throw new AppError(400, ErrorCodes.EVIDENCE_FILE_REQUIRED, 'Evidence has no files');
    }
    if (link.evidence.indexingStatus === IndexingStatus.indexed && !input.force) {
      return { job: null, evidence: link.evidence };
    }
    const job = (await this.jobsService.enqueueIndexingJob(evidenceId, JobType.evidence_ocr)).job;
    await prisma.evidence.update({
      where: { id: evidenceId },
      data: { indexingStatus: IndexingStatus.pending_indexing },
    });
    if (input.runMode === 'sync') {
      return { job: await runIndexingJob(job.id) };
    }
    return { job };
  }

  async importEvent(user: AuthenticatedUser, profileId: string, input: ImportCollectiveEventInput) {
    const profile = await this.getRequiredEditableOwnedProfile(user, profileId);
    const event = await prisma.eventRegistry.findUnique({ where: { id: input.eventId } });
    if (!event) throw new AppError(404, ErrorCodes.EVENT_NOT_FOUND, 'Event not found');
    if (event.status !== 'active') {
      throw new AppError(409, ErrorCodes.EVENT_NOT_ACTIVE, 'Event is not active');
    }
    const existing = await prisma.evidence.findFirst({
      where: { collectiveProfileId: profile.id, eventId: event.id },
    });
    if (existing) {
      throw new AppError(409, ErrorCodes.EVENT_ALREADY_IMPORTED, 'Event already imported');
    }
    return prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.create({
        data: {
          collectiveProfileId: profile.id,
          evidenceName: event.eventName,
          criterion: Criterion.collective,
          sourceType: EvidenceSourceType.collective_import,
          eventId: event.id,
          status: EvidenceStatus.indexed,
          indexingStatus: IndexingStatus.indexed,
          confidence: 1,
        },
      });
      await tx.collectiveEvidence.create({
        data: {
          collectiveProfileId: profile.id,
          evidenceId: evidence.id,
          collectiveCriterion: input.collectiveCriterion,
        },
      });
      await tx.evidenceCard.create({
        data: {
          evidenceId: evidence.id,
          matchedEventId: event.id,
          confidence: 1,
          aiSummary: `Collective event evidence imported from ${event.eventName}`,
          extractedFieldsJson: {
            eventName: event.eventName,
            organizer: event.organizer,
            participantCount: event.participantCount,
          },
        },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_EVENT_IMPORTED, {
        evidenceId: evidence.id,
        eventId: event.id,
      });
      return evidence;
    });
  }

  async precheck(user: AuthenticatedUser, profileId: string, input: CollectivePrecheckInput) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertCanView(user, profile);
    if (profile.representativeId === user.id) {
      this.assertEditable(profile);
    } else {
      this.assertNotFinal(profile);
    }
    const [members, evidences] = await Promise.all([
      prisma.collectiveMember.findMany({ where: { collectiveProfileId: profile.id } }),
      prisma.evidence.findMany({ where: { collectiveProfileId: profile.id } }),
    ]);
    const { memberSummary, evidenceSummary, evaluation, nextActions } = runCollectivePrecheck({
      level: input.level ?? profile.targetLevel,
      members,
      evidences,
    });
    const status = evaluation.passed
      ? CollectiveStatus.ready_to_submit
      : CollectiveStatus.prechecked;

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.collectivePrecheckResult.create({
        data: {
          collectiveProfileId: profile.id,
          resultJson: {
            evaluation,
            memberSummary,
            evidenceSummary,
          },
          readinessScore: evaluation.score,
          missingItemsJson: evaluation.rules.filter((rule) => !rule.passed),
          nextBestAction: nextActions[0],
        },
      });
      await tx.collectiveProfile.update({
        where: { id: profile.id },
        data: { readinessScore: evaluation.score, status },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_PRECHECK_COMPLETED, {
        precheckResultId: created.id,
        score: evaluation.score,
        status,
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_READINESS_UPDATED, {
        score: evaluation.score,
        status,
      });
      return created;
    });
    const missingItems = evaluation.rules.filter((rule) => !rule.passed);
    return {
      collectiveProfileId: profile.id,
      level: evaluation.level,
      readinessScore: evaluation.score,
      readyToSubmit: evaluation.passed && evaluation.score >= 70,
      criteriaResults: evaluation.rules,
      missingItems,
      warnings: [
        'Kết quả tiền kiểm chỉ là gợi ý; cán bộ và Hội đồng cần xác nhận kết quả cuối cùng.',
      ],
      nextBestAction: nextActions[0] ?? 'Hồ sơ tập thể đã đủ dữ liệu cơ bản để nộp xét duyệt.',
      memberSummary,
      evidenceSummary,
      result,
      status,
    };
  }

  async latestPrecheck(user: AuthenticatedUser, profileId: string) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertCanView(user, profile);
    return prisma.collectivePrecheckResult.findFirst({
      where: { collectiveProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submit(user: AuthenticatedUser, profileId: string, input: CollectiveSubmitInput) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertOwner(user, profile);
    this.assertEditable(profile);
    const latest = await prisma.collectivePrecheckResult.findFirst({
      where: { collectiveProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) {
      throw new AppError(409, ErrorCodes.COLLECTIVE_PRECHECK_FAILED, 'Run precheck before submit');
    }
    const memberCount = await prisma.collectiveMember.count({
      where: { collectiveProfileId: profile.id },
    });
    if (memberCount === 0) {
      throw new AppError(409, ErrorCodes.COLLECTIVE_NOT_READY, 'Collective roster is empty');
    }
    if (profile.readinessScore < 40 && !input.allowSubmitWithWarnings) {
      throw new AppError(
        409,
        ErrorCodes.COLLECTIVE_NOT_READY,
        'Collective profile is not ready for submission',
      );
    }
    const officer = await this.assignmentService.assignOfficerForCriterion({
      criterion: Criterion.collective,
      faculty: user.faculty,
    });

    const reviewTask = await prisma.$transaction(async (tx) => {
      const existing = await tx.reviewTask.findFirst({
        where: {
          collectiveProfileId: profile.id,
          criterion: Criterion.collective,
          status: { in: [ReviewTaskStatus.waiting, ReviewTaskStatus.reviewing] },
        },
      });
      const task =
        existing ??
        (await tx.reviewTask.create({
          data: {
            collectiveProfileId: profile.id,
            criterion: Criterion.collective,
            assignedOfficerId: officer?.id,
          },
        }));
      const evidences = await tx.evidence.findMany({
        where: { collectiveProfileId: profile.id },
        select: { id: true },
      });
      if (evidences.length > 0) {
        await tx.reviewTaskEvidence.createMany({
          data: evidences.map((evidence) => ({
            reviewTaskId: task.id,
            evidenceId: evidence.id,
          })),
          skipDuplicates: true,
        });
      }
      await tx.collectiveProfile.update({
        where: { id: profile.id },
        data: {
          status: CollectiveStatus.under_review,
          submittedAt: new Date(),
        },
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_PROFILE_SUBMITTED, {
        reviewTaskId: task.id,
        assignedOfficerId: officer?.id,
        note: input.note,
      });
      await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_REVIEW_TASK_CREATED, {
        reviewTaskId: task.id,
      });
      if (officer) {
        await this.audit(tx, user, profile.id, auditActions.COLLECTIVE_REVIEW_TASK_ASSIGNED, {
          reviewTaskId: task.id,
          assignedOfficerId: officer.id,
        });
        await this.notificationsService.create(
          {
            userId: officer.id,
            collectiveProfileId: profile.id,
            type: NotificationType.review_updated,
            title: 'Collective review task assigned',
            message: `Review collective profile for class ${profile.className}`,
          },
          tx,
        );
      }
      return task;
    });
    return { profile: await this.getDetail(user, profile.id), reviewTask };
  }

  async listForManager(query: ListManagerCollectivesQuery) {
    const where: Prisma.CollectiveProfileWhereInput = {
      ...(query.schoolYear ? { schoolYear: query.schoolYear } : {}),
      ...(query.targetLevel ? { targetLevel: query.targetLevel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.className ? { className: { contains: query.className, mode: 'insensitive' } } : {}),
      ...(query.faculty
        ? { representative: { faculty: { contains: query.faculty, mode: 'insensitive' } } }
        : {}),
      ...(query.q
        ? {
            OR: [
              { className: { contains: query.q, mode: 'insensitive' } },
              { representative: { fullName: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await prisma.$transaction([
      prisma.collectiveProfile.findMany({
        where,
        include: {
          representative: true,
          members: true,
          reviewTasks: { select: { status: true } },
          _count: { select: { members: true, evidences: true, reviewTasks: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: query.limit,
      }),
      prisma.collectiveProfile.count({ where }),
    ]);
    return {
      items: items.map((item) => {
        const readiness = buildCollectiveFinalizeReadiness(
          item.reviewTasks.map((task) => task.status),
        );
        return {
          ...item,
          memberSummary: buildCollectiveMemberSummary(item.members),
          canFinalize: readiness.canFinalize,
          blockingReasons: readiness.blockingReasons,
        };
      }),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async aggregation(profileId: string) {
    const profile = await prisma.collectiveProfile.findUnique({
      where: { id: profileId },
      include: {
        representative: true,
        members: true,
        evidenceRecords: true,
        precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviewTasks: { include: { assignedOfficer: true } },
      },
    });
    if (!profile) this.notFound();
    const memberSummary = buildCollectiveMemberSummary(profile.members);
    const evidenceSummary = {
      total: profile.evidenceRecords.length,
      indexed: profile.evidenceRecords.filter(
        (item) => item.indexingStatus === IndexingStatus.indexed,
      ).length,
      needsReview: profile.evidenceRecords.filter(
        (item) => item.indexingStatus === IndexingStatus.needs_manual_review,
      ).length,
    };
    const readiness = buildCollectiveFinalizeReadiness(
      profile.reviewTasks.map((task) => task.status),
    );
    return {
      profile,
      memberSummary,
      evidenceSummary,
      latestPrecheck: profile.precheckResults[0] ?? null,
      reviewTasks: profile.reviewTasks,
      canFinalize: readiness.canFinalize,
      blockingReasons: readiness.blockingReasons,
      blockers: profile.reviewTasks.filter((task) => isCollectiveFinalizeBlocker(task.status)).map((task) => ({
        reviewTaskId: task.id,
        status: task.status,
        message: collectiveBlockingReason(task.status, 1),
      })),
    };
  }

  async finalize(user: AuthenticatedUser, profileId: string, input: FinalizeCollectiveInput) {
    const aggregation = await this.aggregation(profileId);
    if (input.overrideAggregation && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only admin can override finalize blockers');
    }
    if (!aggregation.canFinalize && !input.overrideAggregation) {
      throw new AppError(
        409,
        ErrorCodes.COLLECTIVE_FINALIZE_BLOCKED,
        'Collective review tasks are not completed',
      );
    }
    if (input.finalStatus !== FinalStatus.failed && !input.finalLevel) {
      throw new AppError(
        400,
        ErrorCodes.FINAL_LEVEL_REQUIRED,
        'Final level is required for a passing result',
      );
    }
    const status =
      input.finalStatus === FinalStatus.failed
        ? CollectiveStatus.rejected
        : CollectiveStatus.completed;
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.collectiveProfile.update({
        where: { id: profileId },
        data: {
          finalStatus: input.finalStatus,
          finalLevel: input.finalLevel ?? null,
          finalNote: input.finalNote,
          status,
          completedAt: new Date(),
        },
      });
      await this.audit(tx, user, profileId, auditActions.COLLECTIVE_FINALIZED, {
        finalStatus: saved.finalStatus,
        finalLevel: saved.finalLevel,
        overrideAggregation: input.overrideAggregation,
      });
      if (input.notifyRepresentative) {
        await this.notificationsService.create(
          {
            userId: aggregation.profile.representativeId,
            collectiveProfileId: profileId,
            type: NotificationType.result_available,
            title: 'Collective result available',
            message: `Final result for ${aggregation.profile.className}: ${saved.finalStatus}`,
          },
          tx,
        );
      }
      return saved;
    });
    return updated;
  }

  private async getRequiredProfile(profileId: string) {
    const profile = await prisma.collectiveProfile.findUnique({ where: { id: profileId } });
    if (!profile) this.notFound();
    return profile;
  }

  private async getRequiredEditableOwnedProfile(user: AuthenticatedUser, profileId: string) {
    const profile = await this.getRequiredProfile(profileId);
    this.assertOwner(user, profile);
    this.assertEditable(profile);
    return profile;
  }

  private async getRequiredEvidenceLink(profileId: string, evidenceId: string) {
    const link = await prisma.collectiveEvidence.findFirst({
      where: { collectiveProfileId: profileId, evidenceId },
      include: {
        evidence: {
          include: { evidenceFiles: { include: { file: true } }, evidenceCard: true },
        },
      },
    });
    if (!link) {
      throw new AppError(
        404,
        ErrorCodes.COLLECTIVE_EVIDENCE_NOT_FOUND,
        'Collective evidence not found',
      );
    }
    return link;
  }

  private resolveClassName(user: AuthenticatedUser, input?: string): string {
    const className = input?.trim() || user.className?.trim();
    if (!className) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Class name is required');
    }
    return className;
  }

  private assertCanView(user: AuthenticatedUser, profile: CollectiveProfile): void {
    if (profile.representativeId === user.id) return;
    const privilegedRoles: Role[] = [Role.manager, Role.committee, Role.admin, Role.officer];
    if (privilegedRoles.includes(user.role)) return;
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Cannot view collective profile');
  }

  private assertOwner(user: AuthenticatedUser, profile: CollectiveProfile): void {
    if (profile.representativeId === user.id || user.role === Role.admin) return;
    throw new AppError(
      403,
      ErrorCodes.COLLECTIVE_OWNER_REQUIRED,
      'Collective profile can only be changed by its representative',
    );
  }

  private assertEditable(profile: CollectiveProfile): void {
    if (editableStatuses.has(profile.status)) return;
    throw new AppError(
      409,
      ErrorCodes.COLLECTIVE_PROFILE_LOCKED,
      `Collective profile cannot be edited while status is ${profile.status}`,
    );
  }

  private assertNotFinal(profile: CollectiveProfile): void {
    if (
      profile.status !== CollectiveStatus.completed &&
      profile.status !== CollectiveStatus.rejected
    ) {
      return;
    }
    throw new AppError(
      409,
      ErrorCodes.COLLECTIVE_PROFILE_LOCKED,
      `Collective profile cannot be changed while status is ${profile.status}`,
    );
  }

  private notFound(): never {
    throw new AppError(
      404,
      ErrorCodes.COLLECTIVE_PROFILE_NOT_FOUND,
      'Collective profile not found',
    );
  }

  private audit(
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    profileId: string,
    action: string,
    state?: Prisma.InputJsonObject,
  ) {
    return createApplicationAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action,
      targetType: 'collective_profile',
      targetId: profileId,
      collectiveProfileId: profileId,
      afterStateJson: state,
    });
  }

  private toProfileDto(profile: {
    members: Array<Parameters<typeof buildCollectiveMemberSummary>[0][number]>;
    evidences: unknown[];
    [key: string]: unknown;
  }) {
    return {
      ...profile,
      memberSummary: buildCollectiveMemberSummary(profile.members),
      evidenceCount: profile.evidences.length,
    };
  }
}

async function parseRosterFile(file: UploadedFile): Promise<RosterParseResult> {
  const isXlsx =
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.originalname.toLowerCase().endsWith('.xlsx');
  const matrix: string[][] = isXlsx
    ? (await readSheet(file.buffer)).map((row) => row.map((cell) => String(cell ?? '').trim()))
    : file.buffer
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map(parseCsvLine);
  if (matrix.length < 2) return { rows: [], totalRows: 0, invalidRows: [] };
  const headers = matrix[0].map((value) => canonicalHeader(normalizeHeader(value)));
  const rows: UpsertCollectiveMemberInput[] = [];
  const invalidRows: RosterInvalidRow[] = [];
  const seenCodes = new Map<string, number>();

  matrix.slice(1).forEach((values, index) => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
    const studentCode = row.studentCode?.trim();
    const studentName = row.studentName?.trim();
    const reasons: string[] = [];

    if (!studentCode) reasons.push('Thiếu MSSV');
    if (!studentName) reasons.push('Thiếu Họ và tên');
    if (studentCode && seenCodes.has(studentCode)) {
      reasons.push(`Trùng MSSV với dòng ${seenCodes.get(studentCode)}`);
    }

    if (reasons.length > 0 || !studentCode || !studentName) {
      invalidRows.push({
        row: rowNumber,
        reason: reasons.join('; '),
        data: row,
      });
      return;
    }

    seenCodes.set(studentCode, rowNumber);
    rows.push({
      studentCode,
      studentName,
      className: row.className || undefined,
      faculty: row.faculty || undefined,
      participationStatus: normalizeParticipation(row.participationStatus),
      individualSv5tLevel: normalizeLevel(row.individualSv5tLevel),
      violationStatus: normalizeViolation(row.violationStatus),
      note: row.note || undefined,
    });
  });

  return {
    rows,
    totalRows: matrix.length - 1,
    invalidRows,
  };
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function canonicalHeader(value: string): string {
  const aliases: Record<string, string> = {
    mssv: 'studentCode',
    studentcode: 'studentCode',
    masv: 'studentCode',
    masinhvien: 'studentCode',
    studentname: 'studentName',
    fullname: 'studentName',
    hoten: 'studentName',
    hovaten: 'studentName',
    classname: 'className',
    lop: 'className',
    faculty: 'faculty',
    khoa: 'faculty',
    participationstatus: 'participationStatus',
    thamgiaphongtrao: 'participationStatus',
    individualsv5tlevel: 'individualSv5tLevel',
    capsv5tcanhan: 'individualSv5tLevel',
    violationstatus: 'violationStatus',
    vipham: 'violationStatus',
    note: 'note',
    ghichu: 'note',
  };
  return aliases[value] ?? value;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeParticipation(value?: string): string {
  const normalized = value?.trim().toLowerCase();
  if (['participated', 'yes', 'co', 'có', 'tham gia'].includes(normalized ?? '')) {
    return 'participated';
  }
  if (['not_participated', 'no', 'khong', 'không'].includes(normalized ?? '')) {
    return 'not_participated';
  }
  return 'unknown';
}

function normalizeViolation(value?: string): string {
  const normalized = value?.trim().toLowerCase();
  if (['violated', 'yes', 'co', 'có', 'vi pham', 'vi phạm'].includes(normalized ?? '')) {
    return 'violated';
  }
  if (['none', 'no', 'khong', 'không'].includes(normalized ?? '')) return 'none';
  return 'unknown';
}

function normalizeLevel(value?: string): string {
  const normalized = value?.trim().toLowerCase();
  const mapping: Record<string, string> = {
    school: 'school',
    truong: 'school',
    trường: 'school',
    university: 'university',
    dai_hoc: 'university',
    'đại học': 'university',
    city: 'city',
    thanh_pho: 'city',
    'thành phố': 'city',
    central: 'central',
    trung_uong: 'central',
    'trung ương': 'central',
    none: 'none',
  };
  return mapping[normalized ?? ''] ?? 'unknown';
}
