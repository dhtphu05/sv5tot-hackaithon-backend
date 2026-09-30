// Owns individual application draft, submission, timeline, supplement lifecycle.
import {
  ApplicationStatus,
  ApplicationType,
  Criterion,
  EvidenceStatus,
  FinalStatus,
  Level,
  NotificationType,
  Prisma,
  Role,
  ReviewTaskStatus,
  WorkspaceType,
  type Application,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions, editableApplicationStatuses } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { normalizeSchoolYear } from '../../shared/utils/school-year';
import { assertSameWorkspace, workspaceIdForWrite } from '../../shared/utils/workspace-scope';
import { assertReviewWorkspaceAccess } from '../../shared/utils/review-workspace-scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrecheckService, type PreparedPrecheckRun } from '../precheck/precheck.service';
import { ReviewAssignmentService } from '../review/review-assignment.service';
import {
  assertApplicationEditable,
  assertApplicationOwner,
  buildApplicationSummary,
  createApplicationAudit,
} from './application.helpers';
import { findProcessingEvidence, isApplicationPrecheckStale } from './application-freshness';
import { ApplicationsRepository } from './applications.repository';
import { buildEmailDedupeKey, EmailOutboxService } from '../mail/email-outbox.service';
import { CitySubmissionEligibilityService } from './city-submission-eligibility.service';
import { assertStudentApplicationIsCity } from './application-submission.policy';
import {
  assertApplicationNotCancelled,
  lockApplicationAndAssertNotCancelled,
} from './application-lifecycle.policy';
import { CityReviewSeasonsService } from '../manager/city-review-seasons.service';
import type {
  AutosaveDraftInput,
  GetCurrentApplicationQuery,
  ReopenSupplementInput,
  StartApplicationInput,
  SubmitApplicationInput,
  TimelineQuery,
  UpdateTargetLevelInput,
} from './applications.validation';

export { hasActiveEvidenceProcessing } from './application-freshness';

function requiresInitialCityEligibility(
  user: AuthenticatedUser,
  application: Pick<
    Application,
    'applicationType' | 'targetLevel' | 'status' | 'submittedAt'
  >,
): boolean {
  return (
    user.role === Role.student &&
    application.applicationType === ApplicationType.individual &&
    application.targetLevel === Level.city &&
    (application.status !== ApplicationStatus.supplement_required || application.submittedAt === null)
  );
}

function isIndividualCityApplication(
  application: Pick<Application, 'applicationType' | 'targetLevel'>,
): boolean {
  return application.applicationType === ApplicationType.individual && application.targetLevel === Level.city;
}

function appendSupplementHistory(history: Prisma.JsonValue | null, item: Record<string, unknown>) {
  const current = Array.isArray(history) ? history : [];
  return [...current, item] as Prisma.InputJsonValue;
}

type SubmitApplicationContext = Prisma.ApplicationGetPayload<{
  include: {
    student: true;
    evidences: true;
    metrics: true;
    requirementResponses: true;
    reviewTasks: { include: { assignedOfficer: true } };
  };
}>;

export class ApplicationsService {
  constructor(
    private readonly applicationsRepository = new ApplicationsRepository(),
    private readonly notificationsService = new NotificationsService(),
    private readonly reviewAssignmentService = new ReviewAssignmentService(),
    private readonly emailOutboxService = new EmailOutboxService(),
    private readonly precheckService = new PrecheckService(),
    private readonly citySubmissionEligibilityService = new CitySubmissionEligibilityService(),
  ) {}

  async getCurrent(user: AuthenticatedUser, query: GetCurrentApplicationQuery) {
    const schoolYear = normalizeSchoolYear(query.schoolYear);
    const application = await this.applicationsRepository.findCurrent(user.id, schoolYear);

    if (!application) {
      return {
        application: null,
        state: 'not_started',
        schoolYear,
      };
    }

    return {
      application: this.toApplicationDto(application),
      state: application.status,
      schoolYear,
    };
  }

  async startCurrent(user: AuthenticatedUser, input: StartApplicationInput) {
    const schoolYear = normalizeSchoolYear(input.schoolYear);
    // The current Student individual-application flow is City-only. Ignore stale
    // client target-level fields; historical rows remain readable as stored.
    const targetLevel = Level.city;
    const workspaceId = workspaceIdForWrite(user);

    const application = await prisma.$transaction(async (tx) => {
      const existing = await tx.application.findUnique({
        where: {
          studentId_schoolYear_applicationType: {
            studentId: user.id,
            schoolYear,
            applicationType: ApplicationType.individual,
          },
        },
      });

      if (existing) {
        return existing;
      }

      const created = await tx.application.create({
        data: {
          studentId: user.id,
          workspaceId,
          schoolYear,
          applicationType: ApplicationType.individual,
          targetLevel,
          status: ApplicationStatus.draft,
          readinessScore: 0,
          currentDraftVersion: 1,
          finalStatus: FinalStatus.pending,
        },
      });

      await tx.applicationDraftSnapshot.create({
        data: {
          applicationId: created.id,
          version: 1,
          createdBy: user.id,
          snapshotJson: this.buildInitialSnapshot(user, targetLevel),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_STARTED,
        targetType: 'application',
        targetId: created.id,
        applicationId: created.id,
        afterStateJson: { schoolYear, targetLevel, status: ApplicationStatus.draft },
      });

      return created;
    });

    return this.getApplicationForResponse(application.id);
  }

  async updateTargetLevel(
    user: AuthenticatedUser,
    applicationId: string,
    input: UpdateTargetLevelInput,
  ) {
    const application = await this.getRequiredBareApplication(user, applicationId);
    assertApplicationOwner(application, user);
    assertApplicationNotCancelled(application);
    if (user.role === Role.student) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Students cannot change the application review level',
      );
    }
    assertApplicationEditable(application);

    await prisma.$transaction(async (tx) => {
      await lockApplicationAndAssertNotCancelled(tx, application.id);
      const newVersion = application.currentDraftVersion + 1;

      const updateResult = await tx.application.updateMany({
        where: {
          id: application.id,
          status: { in: [...editableApplicationStatuses] },
          currentDraftVersion: application.currentDraftVersion,
        },
        data: {
          targetLevel: input.targetLevel,
          currentDraftVersion: newVersion,
        },
      });
      assertDraftWriteSucceeded(updateResult.count);

      await tx.applicationDraftSnapshot.create({
        data: {
          applicationId: application.id,
          version: newVersion,
          createdBy: user.id,
          snapshotJson: {
            targetLevel: input.targetLevel,
            previousTargetLevel: application.targetLevel,
          },
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.TARGET_LEVEL_UPDATED,
        targetType: 'application',
        targetId: application.id,
        applicationId: application.id,
        beforeStateJson: { targetLevel: application.targetLevel },
        afterStateJson: { targetLevel: input.targetLevel },
      });
    });

    return this.getApplicationForResponse(application.id);
  }

  async autosaveDraft(user: AuthenticatedUser, applicationId: string, input: AutosaveDraftInput) {
    const application = await this.getRequiredBareApplication(user, applicationId);
    assertApplicationOwner(application, user);
    assertApplicationNotCancelled(application);
    if (user.role === Role.student && input.targetLevel !== undefined) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Students cannot change the application review level',
      );
    }
    assertApplicationEditable(application);

    const newVersion = application.currentDraftVersion + 1;
    const savedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await lockApplicationAndAssertNotCancelled(tx, application.id);
      const updateResult = await tx.application.updateMany({
        where: {
          id: application.id,
          status: { in: [...editableApplicationStatuses] },
          currentDraftVersion: application.currentDraftVersion,
        },
        data: {
          ...(input.targetLevel ? { targetLevel: input.targetLevel } : {}),
          currentDraftVersion: newVersion,
        },
      });
      assertDraftWriteSucceeded(updateResult.count);

      await tx.applicationDraftSnapshot.create({
        data: {
          applicationId: application.id,
          version: newVersion,
          createdBy: user.id,
          snapshotJson: input as Prisma.InputJsonObject,
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.DRAFT_AUTOSAVED,
        targetType: 'application',
        targetId: application.id,
        applicationId: application.id,
        afterStateJson: {
          version: newVersion,
          targetLevel: input.targetLevel ?? application.targetLevel,
        },
        note: input.notes,
      });
    });

    return {
      applicationId: application.id,
      currentDraftVersion: newVersion,
      savedAt: savedAt.toISOString(),
    };
  }

  async getTimeline(user: AuthenticatedUser, applicationId: string, query: TimelineQuery) {
    const application = await this.getRequiredBareApplication(user, applicationId);

    if (application.studentId !== user.id && user.role !== Role.admin) {
      throw new AppError(403, ErrorCodes.APPLICATION_OWNER_REQUIRED, 'Timeline is restricted');
    }

    const [items, total] = await this.applicationsRepository.getTimeline(applicationId, query);

    return {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        actor: item.actor
          ? {
              id: item.actor.id,
              fullName: item.actor.fullName,
              role: item.actor.role,
            }
          : null,
        note: item.note,
        createdAt: item.createdAt,
        beforeStateJson: item.beforeStateJson,
        afterStateJson: item.afterStateJson,
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async submit(
    user: AuthenticatedUser,
    applicationId: string,
    input: SubmitApplicationInput = { allowSubmitWithWarnings: false },
  ) {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        student: true,
        evidences: true,
        metrics: true,
        requirementResponses: true,
        reviewTasks: { include: { assignedOfficer: true } },
      },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    assertApplicationOwner(application, user);
    assertApplicationNotCancelled(application);

    if (
      application.status !== ApplicationStatus.draft &&
      application.status !== ApplicationStatus.prechecked &&
      application.status !== ApplicationStatus.ready_to_submit &&
      application.status !== ApplicationStatus.supplement_required
    ) {
      throw new AppError(
        409,
        application.reviewTasks.length > 0
          ? ErrorCodes.SUBMIT_ALREADY_PROCESSED
          : ErrorCodes.APPLICATION_NOT_SUBMITTABLE,
        `Application cannot be submitted while status is ${application.status}`,
        { reviewTasks: application.reviewTasks.map(toSubmitTaskDto) },
      );
    }

    assertStudentApplicationIsCity(user, application);

    const isInitialCitySubmission = requiresInitialCityEligibility(user, application);
    if (isInitialCitySubmission) {
      await this.assertCitySubmissionEligible(user, application.id);
    }

    const isCitySubmissionWindowed = isIndividualCityApplication(application);
    const isInitialCityWindowSubmission =
      isCitySubmissionWindowed &&
      (application.status !== ApplicationStatus.supplement_required || application.submittedAt === null);
    const isCitySupplementResubmit =
      isCitySubmissionWindowed &&
      application.status === ApplicationStatus.supplement_required &&
      application.submittedAt !== null;
    if (isInitialCityWindowSubmission) {
      await prisma.$transaction((tx) =>
        CityReviewSeasonsService.assertInitialSubmissionWindowOpen(tx, application),
      );
    } else if (isCitySupplementResubmit) {
      await prisma.$transaction((tx) =>
        CityReviewSeasonsService.assertSupplementResubmissionBeforeDeadline(tx, application),
      );
    }

    // A saved source file remains valid evidence for City review while OCR is running.
    const processingEvidence = isInitialCitySubmission ? undefined : findProcessingEvidence(application);
    if (processingEvidence) {
      throw new AppError(
        409,
        ErrorCodes.APPLICATION_NOT_READY,
        'Evidence upload or OCR is still processing',
        {
          evidenceId: processingEvidence.id,
          criterion: processingEvidence.criterion,
          status: processingEvidence.status,
          indexingStatus: processingEvidence.indexingStatus,
        },
      );
    }

    let latestPrecheck = await prisma.precheckResult.findFirst({
      where: { applicationId: application.id },
      orderBy: { createdAt: 'desc' },
    });
    let preparedPrecheck: PreparedPrecheckRun | null = null;
    if (isApplicationPrecheckStale(application, latestPrecheck?.createdAt)) {
      if (isInitialCitySubmission) {
        preparedPrecheck = await this.precheckService.prepareForSubmission(user, application.id, {
          level: application.targetLevel,
        });
      } else {
        await this.precheckService.run(user, application.id, { level: application.targetLevel });
        latestPrecheck = await prisma.precheckResult.findFirst({
          where: { applicationId: application.id },
          orderBy: { createdAt: 'desc' },
        });
      }
    }
    const precheckResultJson = preparedPrecheck
      ? (preparedPrecheck.result as unknown as Prisma.JsonValue)
      : latestPrecheck?.resultJson;
    const missingItems = preparedPrecheck
      ? (preparedPrecheck.result.missingItems as unknown as Prisma.JsonValue)
      : (latestPrecheck?.missingItemsJson ?? null);
    const submitWarnings = buildSubmitWarningsFromPrecheck(precheckResultJson, missingItems);

    if (
      submitWarnings.length > 0 &&
      !input.allowSubmitWithWarnings &&
      !isInitialCitySubmission
    ) {
      throw new AppError(
        409,
        ErrorCodes.APPLICATION_NOT_READY,
        'Application has precheck warnings. Pass allowSubmitWithWarnings=true to submit anyway.',
        {
          readinessScore: application.readinessScore,
          latestPrecheck,
          missingItems,
          warnings: submitWarnings,
        },
      );
    }

    const submissionState = await prisma.application.findUnique({
      where: { id: application.id },
      select: {
        applicationType: true,
        targetLevel: true,
        status: true,
        submittedAt: true,
        currentDraftVersion: true,
        updatedAt: true,
      },
    });
    if (
      !submissionState ||
      submissionState.applicationType !== application.applicationType ||
      submissionState.targetLevel !== application.targetLevel ||
      submissionState.currentDraftVersion !== application.currentDraftVersion ||
      submissionState.submittedAt?.getTime() !== application.submittedAt?.getTime() ||
      (isInitialCityWindowSubmission &&
        submissionState.updatedAt.getTime() !== application.updatedAt.getTime()) ||
      !editableApplicationStatuses.includes(submissionState.status as never)
    ) {
      throw new AppError(
        409,
        ErrorCodes.APPLICATION_LOCKED,
        'Application changed while submission was being prepared. Refresh and try again.',
      );
    }

    const existingTasks = application.reviewTasks;
    const isSupplementResubmit =
      submissionState.status === ApplicationStatus.supplement_required &&
      submissionState.submittedAt !== null;
    const supplementTasks = existingTasks.filter(
      (task) => task.status === ReviewTaskStatus.supplement_required,
    );
    const supplementCriteria = Array.from(new Set(supplementTasks.map((task) => task.criterion)));
    const result = await prisma.$transaction(
      async (tx) => {
        await lockApplicationAndAssertNotCancelled(tx, application.id);
        let effectiveSubmissionState = submissionState;
        let effectivePrecheckResultJson = precheckResultJson;
        let persistedPrecheck: Awaited<ReturnType<PrecheckService['persistPreparedInTransaction']>> | null = null;

        if (isCitySubmissionWindowed) {
          const lockedApplication = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Application"
            WHERE "id" = ${application.id}::uuid
              AND "studentId" = ${application.studentId}::uuid
              AND "workspaceId" = ${application.workspaceId}::uuid
              AND "schoolYear" = ${application.schoolYear}
              AND "applicationType" = ${submissionState.applicationType}::"ApplicationType"
              AND "targetLevel" = ${submissionState.targetLevel}::"Level"
              AND "status" = ${submissionState.status}::"ApplicationStatus"
              AND "submittedAt" IS NOT DISTINCT FROM ${submissionState.submittedAt}
              AND "currentDraftVersion" = ${submissionState.currentDraftVersion}
              AND "updatedAt" = ${submissionState.updatedAt}
            FOR UPDATE
          `;
          if (lockedApplication.length !== 1) {
            throw new AppError(
              409,
              ErrorCodes.APPLICATION_LOCKED,
              'Application changed while submission was being prepared. Refresh and try again.',
            );
          }

          const lockedStudent = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "User"
            WHERE "id" = ${application.studentId}::uuid
              AND "workspaceId" = ${application.workspaceId}::uuid
            FOR NO KEY UPDATE
          `;
          if (lockedStudent.length !== 1) {
            throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
          }

          if (isInitialCitySubmission) {
            const eligibility = await this.citySubmissionEligibilityService.getEligibilityForSubmission(
              tx,
              user,
              application.id,
            );
            this.assertCityEligibilityResultEligible(eligibility);
          }

          if (isInitialCityWindowSubmission) {
            await CityReviewSeasonsService.assertInitialSubmissionWindowOpen(tx, application);
          } else if (isSupplementResubmit) {
            await CityReviewSeasonsService.assertSupplementResubmissionBeforeDeadline(
              tx,
              application,
            );
          }

          if (preparedPrecheck) {
            persistedPrecheck = await this.precheckService.persistPreparedInTransaction(
              tx,
              user,
              preparedPrecheck,
            );
            effectiveSubmissionState = {
              ...effectiveSubmissionState,
              status: persistedPrecheck.application.status,
              updatedAt: persistedPrecheck.application.updatedAt,
            };
            effectivePrecheckResultJson = persistedPrecheck.precheckResult.resultJson;
          }

          if (submitWarnings.length > 0 && !input.allowSubmitWithWarnings) {
            return {
              reviewTasks: [],
              blockedByWarnings: true,
              readinessScore:
                persistedPrecheck?.application.readinessScore ?? application.readinessScore,
              latestPrecheck: persistedPrecheck?.precheckResult ?? latestPrecheck,
            };
          }
        }

        const submittedAt = new Date();
        const newVersion = application.currentDraftVersion + 1;

        const updateResult = await tx.application.updateMany({
          where: {
            id: application.id,
            status: effectiveSubmissionState.status,
            targetLevel: effectiveSubmissionState.targetLevel,
            currentDraftVersion: effectiveSubmissionState.currentDraftVersion,
            submittedAt: effectiveSubmissionState.submittedAt,
            updatedAt: effectiveSubmissionState.updatedAt,
          },
          data: {
            status: ApplicationStatus.under_review,
            submittedAt: application.submittedAt ?? submittedAt,
            currentDraftVersion: newVersion,
          },
        });
        assertDraftWriteSucceeded(updateResult.count);

        if (isSupplementResubmit && supplementTasks.length > 0) {
          const taskEvidenceLinks = supplementTasks.flatMap((task) =>
            application.evidences
              .filter((evidence) => evidence.criterion === task.criterion)
              .map((evidence) => ({
                reviewTaskId: task.id,
                evidenceId: evidence.id,
              })),
          );
          if (taskEvidenceLinks.length > 0) {
            await tx.reviewTaskEvidence.createMany({
              data: taskEvidenceLinks,
              skipDuplicates: true,
            });
          }

          await tx.reviewTask.updateMany({
            where: {
              applicationId: application.id,
              status: ReviewTaskStatus.supplement_required,
            },
            data: {
              status: ReviewTaskStatus.waiting,
              decision: null,
              officerNote: null,
              officerSuggestedLevel: null,
              levelAssessmentJson: Prisma.JsonNull,
              decisionReason: null,
            },
          });
          const activeSupplementRequests = await tx.supplementRequest.findMany({
            where: {
              applicationId: application.id,
              reviewTaskId: { in: supplementTasks.map((task) => task.id) },
              status: 'active',
            },
            select: { id: true, historyJson: true },
          });
          for (const supplementRequest of activeSupplementRequests) {
            await tx.supplementRequest.update({
              where: { id: supplementRequest.id },
              data: {
                status: 'resubmitted',
                resubmittedAt: submittedAt,
                historyJson: appendSupplementHistory(supplementRequest.historyJson, {
                  at: submittedAt.toISOString(),
                  actorId: user.id,
                  action: 'student_resubmitted',
                }),
              },
            });
          }
          await tx.evidence.updateMany({
            where: {
              applicationId: application.id,
              criterion: { in: supplementCriteria },
              status: {
                in: [
                  EvidenceStatus.draft,
                  EvidenceStatus.pending_indexing,
                  EvidenceStatus.indexed,
                  EvidenceStatus.needs_supplement,
                ],
              },
            },
            data: { status: EvidenceStatus.under_review },
          });
        }

        await tx.applicationDraftSnapshot.create({
          data: {
            applicationId: application.id,
            version: newVersion,
            createdBy: user.id,
            snapshotJson: {
              submittedAt: submittedAt.toISOString(),
              targetLevel: application.targetLevel,
              status: ApplicationStatus.under_review,
              submitWarnings,
              studentNote: input.studentNote,
            },
          },
        });

        const reviewTasks =
          existingTasks.length > 0
            ? await tx.reviewTask.findMany({
                where: { applicationId: application.id },
                include: { assignedOfficer: true },
                orderBy: { criterion: 'asc' },
              })
            : await this.createReviewTasksForSubmit(tx, application, effectivePrecheckResultJson);

        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: isSupplementResubmit
            ? auditActions.APPLICATION_RESUBMITTED_AFTER_SUPPLEMENT
            : auditActions.APPLICATION_SUBMITTED,
          targetType: 'application',
          targetId: application.id,
          applicationId: application.id,
          beforeStateJson: { status: effectiveSubmissionState.status },
          afterStateJson: {
            status: ApplicationStatus.under_review,
            submittedAt: submittedAt.toISOString(),
            readinessScore: application.readinessScore,
            allowSubmitWithWarnings: input.allowSubmitWithWarnings,
            warningCount: submitWarnings.length,
            reviewTaskCount: reviewTasks.length,
          },
          note: submitWarnings.length > 0 ? 'Submitted with precheck warnings.' : input.studentNote,
        });
        await createApplicationAudit(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: auditActions.APPLICATION_LOCKED,
          targetType: 'application',
          targetId: application.id,
          applicationId: application.id,
          beforeStateJson: { status: effectiveSubmissionState.status },
          afterStateJson: { status: ApplicationStatus.under_review },
        });

      const notification = await this.notificationsService.create(
        {
          userId: application.studentId,
          applicationId: application.id,
          type: NotificationType.system,
            title: isSupplementResubmit ? 'Hồ sơ đã được nộp lại' : 'Hồ sơ đã được nộp',
            message: 'Hồ sơ Sinh viên 5 tốt của bạn đã chuyển sang trạng thái đang xét duyệt.',
        },
        tx,
      );
      const templateKey = isSupplementResubmit
        ? 'application_resubmitted'
        : 'application_submitted';
      await this.emailOutboxService.enqueue(
        {
          recipientEmail: application.student.email,
          recipientName: application.student.fullName,
          relatedUserId: application.studentId,
          applicationId: application.id,
          notificationId: notification.id,
          templateKey,
          payload: {
            studentName: application.student.fullName,
            recipientName: application.student.fullName,
            applicationCode: application.id,
            applicationId: application.id,
            schoolYear: application.schoolYear,
            targetLevel: application.targetLevel,
            criterionName: isSupplementResubmit ? supplementCriteria.join(', ') : undefined,
            status: ApplicationStatus.under_review,
          },
          dedupeKey: buildEmailDedupeKey(templateKey, {
            applicationId: application.id,
            version: newVersion,
            status: ApplicationStatus.under_review,
          }),
          actorId: user.id,
          actorRole: user.role,
        },
        tx,
      );

      return {
        reviewTasks,
        blockedByWarnings: false,
        readinessScore:
          persistedPrecheck?.application.readinessScore ?? application.readinessScore,
        latestPrecheck: persistedPrecheck?.precheckResult ?? latestPrecheck,
      };
      },
      {
        maxWait: 10_000,
        timeout: 30_000,
        ...(isInitialCitySubmission
          ? { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
          : {}),
      },
    );

    if (result.blockedByWarnings) {
      throw new AppError(
        409,
        ErrorCodes.APPLICATION_NOT_READY,
        'Application has precheck warnings. Pass allowSubmitWithWarnings=true to submit anyway.',
        {
          readinessScore: result.readinessScore,
          latestPrecheck: result.latestPrecheck,
          missingItems,
          warnings: submitWarnings,
        },
      );
    }

    return {
      application: {
        id: application.id,
        status: ApplicationStatus.under_review,
        submittedAt: application.submittedAt ?? new Date(),
      },
      reviewTasks: result.reviewTasks.map(toSubmitTaskDto),
      warnings: submitWarnings,
      message: 'Hồ sơ đã được nộp và chuyển sang trạng thái đang xét duyệt.',
    };
  }

  async reopenSupplement(
    user: AuthenticatedUser,
    applicationId: string,
    input: ReopenSupplementInput,
  ) {
    if (
      user.role !== Role.manager &&
      user.role !== Role.city_manager &&
      user.role !== Role.admin
    ) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only manager or admin can reopen supplement');
    }

    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { workspace: { select: { type: true, isActive: true } } },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    assertReviewWorkspaceAccess(
      user,
      {
        workspaceId: application.workspaceId,
        workspaceType: application.workspace.type as WorkspaceType,
        workspaceIsActive: application.workspace.isActive,
      },
      'Application not found',
    );
    if (
      application.applicationType === ApplicationType.individual &&
      application.targetLevel === Level.city &&
      user.role !== Role.city_manager &&
      user.role !== Role.admin
    ) {
      throw new AppError(
        403,
        ErrorCodes.FORBIDDEN,
        'Only City Managers or admins may reopen supplements for City applications',
      );
    }
    assertApplicationNotCancelled(application);

    await prisma.$transaction(async (tx) => {
      await lockApplicationAndAssertNotCancelled(tx, application.id);
      await tx.application.update({
        where: { id: application.id },
        data: { status: ApplicationStatus.supplement_required },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.APPLICATION_REOPENED_FOR_SUPPLEMENT,
        targetType: 'application',
        targetId: application.id,
        applicationId: application.id,
        beforeStateJson: { status: application.status },
        afterStateJson: {
          status: ApplicationStatus.supplement_required,
          allowedCriteria: input.allowedCriteria,
          deadline: input.deadline,
        },
        note: input.reason,
      });

      const notification = await this.notificationsService.create(
        {
          userId: application.studentId,
          applicationId: application.id,
          metadata: {
            criterion: input.allowedCriteria?.length === 1 ? input.allowedCriteria[0] : null,
            allowedCriteria: input.allowedCriteria ?? [],
            deadline: input.deadline ?? null,
          },
          type: NotificationType.supplement_required,
          title: 'Cần bổ sung hồ sơ',
          message: input.reason,
        },
        tx,
      );
      const student = await tx.user.findUniqueOrThrow({ where: { id: application.studentId } });
      await this.emailOutboxService.enqueue(
        {
          recipientEmail: student.email,
          recipientName: student.fullName,
          relatedUserId: student.id,
          applicationId: application.id,
          notificationId: notification.id,
          templateKey: 'supplement_requested',
          payload: {
            studentName: student.fullName,
            recipientName: student.fullName,
            applicationCode: application.id,
            applicationId: application.id,
            schoolYear: application.schoolYear,
            targetLevel: application.targetLevel,
            criterion: input.allowedCriteria?.join(', '),
            criterionName: input.allowedCriteria?.join(', '),
            deadline: input.deadline,
            reason: input.reason,
            supplementSummary: input.reason,
            contextType: 'reopened_by_manager',
          },
          dedupeKey: buildEmailDedupeKey('supplement_requested', {
            applicationId: application.id,
            reason: input.reason,
            allowedCriteria: input.allowedCriteria ?? [],
            deadline: input.deadline ?? null,
          }),
          actorId: user.id,
          actorRole: user.role,
        },
        tx,
      );
    });

    return this.getApplicationForResponse(application.id);
  }

  private async createReviewTasksForSubmit(
    tx: Prisma.TransactionClient,
    application: SubmitApplicationContext,
    latestPrecheckResultJson?: Prisma.JsonValue,
  ) {
    const cityIndividual =
      application.applicationType === ApplicationType.individual &&
      application.targetLevel === Level.city;
    const criteria = buildSubmitCriteria(
      application.evidences,
      latestPrecheckResultJson,
      !cityIndividual,
    );
    const tasks = [];

    for (const criterion of criteria) {
      const officer = await this.reviewAssignmentService.assignOfficerForCriterion(
        {
          criterion,
          faculty: application.student.faculty,
          workspaceId: application.workspaceId,
        },
        tx,
      );
      const task = await tx.reviewTask.create({
        data: {
          applicationId: application.id,
          workspaceId: application.workspaceId,
          criterion,
          assignedOfficerId: officer?.id,
          status: ReviewTaskStatus.waiting,
        },
        include: { assignedOfficer: true },
      });

      const evidenceIds = application.evidences
        .filter((evidence) => evidence.criterion === criterion)
        .map((evidence) => evidence.id);
      if (evidenceIds.length > 0) {
        await tx.reviewTaskEvidence.createMany({
          data: evidenceIds.map((evidenceId) => ({ reviewTaskId: task.id, evidenceId })),
          skipDuplicates: true,
        });
      }

      await createApplicationAudit(tx, {
        action: auditActions.REVIEW_TASK_CREATED,
        targetType: 'review_task',
        targetId: task.id,
        applicationId: application.id,
        afterStateJson: { criterion, assignedOfficerId: officer?.id ?? null },
      });

      if (officer) {
        await createApplicationAudit(tx, {
          action: auditActions.REVIEW_TASK_ASSIGNED,
          targetType: 'review_task',
          targetId: task.id,
          applicationId: application.id,
          afterStateJson: { criterion, assignedOfficerId: officer.id },
        });
        await this.notificationsService.create(
          {
              userId: officer.id,
              workspaceId: application.workspaceId,
              applicationId: application.id,
            type: NotificationType.review_updated,
            title: 'Có hồ sơ cần xét duyệt',
            message: `Bạn được giao xét tiêu chí ${criterion}.`,
          },
          tx,
        );
      } else {
        await notifyManagersAboutUnassignedTask(tx, application.id, application.workspaceId, criterion);
      }

      tasks.push(task);
    }

    return tasks;
  }

  private async getRequiredBareApplication(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<Application> {
    const application = await this.applicationsRepository.findBareById(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    assertSameWorkspace(user, application, 'Application not found');

    return application;
  }

  private async assertCitySubmissionEligible(user: AuthenticatedUser, applicationId: string) {
    const eligibility = await this.citySubmissionEligibilityService.getEligibility(
      user,
      applicationId,
    );
    this.assertCityEligibilityResultEligible(eligibility);
  }

  private assertCityEligibilityResultEligible(
    eligibility: Awaited<ReturnType<CitySubmissionEligibilityService['getEligibility']>>,
  ) {
    if (eligibility.status === 'NOT_ELIGIBLE') {
      throw new AppError(
        409,
        ErrorCodes.CITY_SUBMISSION_NOT_ELIGIBLE,
        'Hồ sơ chưa đáp ứng điều kiện tiên quyết để nộp xét cấp Thành phố.',
        { route: eligibility.route, reasons: eligibility.reasons },
      );
    }
    if (eligibility.status === 'NEEDS_VERIFICATION') {
      throw new AppError(
        409,
        ErrorCodes.CITY_SUBMISSION_NEEDS_VERIFICATION,
        'Hệ thống chưa thể tự động xác minh thông tin của bạn với danh sách công nhận. Hồ sơ cần được kiểm tra lại.',
        { route: eligibility.route, reasons: eligibility.reasons },
      );
    }
  }

  private async getApplicationForResponse(applicationId: string) {
    const application = await this.applicationsRepository.findById(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }

    return this.toApplicationDto(application);
  }

  private toApplicationDto(application: Awaited<ReturnType<ApplicationsRepository['findById']>>) {
    if (!application) {
      return null;
    }

    const latestDraftSnapshot = application.draftSnapshots[0] ?? null;
    const latestPrecheckResult = application.precheckResults[0] ?? null;
    const latestCascadeReview = application.cascadeReviews[0] ?? null;

    return {
      id: application.id,
      schoolYear: application.schoolYear,
      applicationType: application.applicationType,
      targetLevel: application.targetLevel,
      status: application.status,
      readinessScore: application.readinessScore,
      currentDraftVersion: application.currentDraftVersion,
      submittedAt: application.submittedAt,
      finalLevel: application.finalLevel,
      finalStatus: application.finalStatus,
      finalNote: application.finalNote,
      finalizedAt: application.finalizedAt,
      finalizedBy: application.finalizedBy
        ? { id: application.finalizedBy.id, fullName: application.finalizedBy.fullName }
        : null,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      metrics: application.metrics,
      summary: buildApplicationSummary(application),
      reviewTasks: application.reviewTasks.map((task) => ({
        id: task.id,
        criterion: task.criterion,
        status: task.status,
        decision: task.decision,
        officerNote: task.officerNote,
        decisionReason: task.decisionReason,
        supplementRequestJson: task.supplementRequestJson,
        dueDate: task.dueDate,
        updatedAt: task.updatedAt,
      })),
      latestDraftSnapshot: latestDraftSnapshot
        ? {
            id: latestDraftSnapshot.id,
            version: latestDraftSnapshot.version,
            createdAt: latestDraftSnapshot.createdAt,
          }
        : null,
      latestPrecheckResult,
      latestCascadeReview,
    };
  }

  private buildInitialSnapshot(
    user: AuthenticatedUser,
    targetLevel: Level,
  ): Prisma.InputJsonObject {
    return {
      targetLevel,
      basicInfo: {
        fullName: user.fullName,
        studentCode: user.studentCode,
        className: user.className,
        faculty: user.faculty,
      },
      metrics: {},
      evidences: [],
    };
  }
}

function assertDraftWriteSucceeded(updateCount: number): void {
  if (updateCount === 1) return;

  throw new AppError(
    409,
    ErrorCodes.APPLICATION_LOCKED,
    'Application changed before this operation completed. Refresh and try again.',
  );
}

function buildSubmitCriteria(
  evidences: Array<{ criterion: Criterion }>,
  latestPrecheckResultJson?: Prisma.JsonValue,
  includePriority = true,
): Criterion[] {
  const criteria: Criterion[] = [
    Criterion.ethics,
    Criterion.academic,
    Criterion.physical,
    Criterion.volunteer,
    Criterion.integration,
  ];
  if (
    includePriority &&
    (evidences.some((evidence) => evidence.criterion === Criterion.priority) ||
      hasPriorityPrecheckResult(latestPrecheckResultJson))
  ) {
    criteria.push(Criterion.priority);
  }
  return criteria;
}

function hasPriorityPrecheckResult(value?: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const criteriaResults = (value as { criteriaResults?: unknown }).criteriaResults;
  if (!Array.isArray(criteriaResults)) {
    return false;
  }
  return criteriaResults.some((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const result = item as { criterion?: unknown; evidenceRefs?: unknown };
    return (
      result.criterion === Criterion.priority &&
      Array.isArray(result.evidenceRefs) &&
      result.evidenceRefs.length > 0
    );
  });
}

function buildSubmitWarningsFromPrecheck(
  resultJson?: Prisma.JsonValue | null,
  missingItemsJson?: Prisma.JsonValue | null,
) {
  const result = toRecord(resultJson);
  const missingItems = Array.isArray(result.missingItems)
    ? result.missingItems
    : Array.isArray(missingItemsJson)
      ? missingItemsJson
      : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return [
    ...missingItems.map((item) => {
      const record = toRecord(item);
      return (
        stringValue(record.shortReason) ??
        stringValue(record.reason) ??
        stringValue(record.message) ??
        'Cần bổ sung'
      );
    }),
    ...warnings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
  ];
}

function _buildSubmitWarnings(readinessScore: number, missingItems: Prisma.JsonValue | null) {
  const warnings = [];
  if (readinessScore < 60) {
    warnings.push({
      code: ErrorCodes.HUMAN_CONFIRMATION_REQUIRED,
      message:
        'Hồ sơ đã được nộp với cảnh báo tiền kiểm. Kết quả cuối cùng vẫn cần cán bộ xác nhận.',
      readinessScore,
      missingItems,
    });
  }
  return warnings;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function toSubmitTaskDto(task: {
  id: string;
  criterion: Criterion;
  status: ReviewTaskStatus;
  assignedOfficer?: { id: string; fullName: string } | null;
}) {
  return {
    id: task.id,
    criterion: task.criterion,
    status: task.status,
    assignedOfficer: task.assignedOfficer
      ? { id: task.assignedOfficer.id, fullName: task.assignedOfficer.fullName }
      : null,
  };
}

async function notifyManagersAboutUnassignedTask(
  tx: Prisma.TransactionClient,
  applicationId: string,
  workspaceId: string,
  criterion: Criterion,
) {
  const managers = await tx.user.findMany({
    where: {
      role: { in: [Role.manager, Role.admin] },
      isActive: true,
      OR: [{ role: Role.admin }, { workspaceId }],
    },
    select: { id: true },
  });

  if (managers.length === 0) return;

  await tx.notification.createMany({
    data: managers.map((manager) => ({
      userId: manager.id,
      workspaceId,
      applicationId,
      type: NotificationType.review_updated,
      title: 'Có review task chưa được phân công',
      message: `Chưa có cán bộ phù hợp cho tiêu chí ${criterion}.`,
    })),
  });
}
