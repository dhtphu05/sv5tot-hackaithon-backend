import {
  ApplicationStatus,
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  JobStatus,
  JobType,
  Level,
  NotificationType,
  Prisma,
  ReviewTaskStatus,
  Role,
  type PrismaClient,
} from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { sha256 } from '../../shared/utils/hash';
import { normalizeSchoolYear } from '../../shared/utils/school-year';
import { createApplicationAudit } from '../applications/application.helpers';
import { StudentAssistantService as DashboardAssistantService } from '../applications/student-assistant/student-assistant.service';
import { buildOpenAiSafetyIdentifier } from '../ai/openai-client';
import { CriteriaService, criteriaStatusLabel, scopeLabel } from '../criteria/criteria.service';
import { shouldReanalyseLegacyEvidence } from '../evidences/evidence-reanalysis';
import { buildEvidenceAnalysisJobInput } from '../jobs/evidence-analysis-job-input';
import { runIndexingJob } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildDeterministicAnswer,
  createStudentAssistantAnswerProvider,
  mapStudentAssistantProviderError,
  type StudentAnswerProvider,
} from './student-assistant-answer';
import { StudentAssistantGenerationRegistry } from './student-assistant-generation-registry';
import { createStudentAssistantStreamLifecycle } from './student-assistant-stream';
import { friendlyStudentValue } from './student-assistant-text';
import { selectStudentNavigationAction } from './student-assistant-tools';
import type {
  StudentAssistantAction,
  StudentAssistantAnswer,
  StudentAssistantContext,
  StudentAssistantContextQuery,
  StudentAssistantFact,
  StudentAssistantStreamCallbacks,
  StudentAssistantStreamInput,
} from './student-assistant.types';

const activeProcessingStatuses = new Set<IndexingStatus>([
  IndexingStatus.pending_indexing,
  IndexingStatus.ocr_processing,
  IndexingStatus.extracting,
  IndexingStatus.checking_registry,
]);
const assistantEvidenceInclude = Prisma.validator<Prisma.EvidenceInclude>()({
  application: { include: { student: true } },
  evidenceCard: true,
  event: true,
  evidenceFiles: { include: { file: true }, orderBy: { id: 'asc' } },
});
type AssistantEvidenceRecord = Prisma.EvidenceGetPayload<{
  include: typeof assistantEvidenceInclude;
}>;
const generationRegistry = new StudentAssistantGenerationRegistry<{
  answer: StudentAssistantAnswer & { contextVersion: string; finalText: string };
  model: string;
  totalTokens?: number;
  errorCode?: string;
}>();
const evidenceReanalysisWaitMs = 8000;

export class StudentCommunicationAssistantService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly dashboardService = new DashboardAssistantService(),
    private readonly criteriaService = new CriteriaService(db),
    private readonly provider: StudentAnswerProvider = createStudentAssistantAnswerProvider(),
    private readonly notificationsService = new NotificationsService(),
  ) {}

  async getContext(user: AuthenticatedUser, query: StudentAssistantContextQuery) {
    assertStudentOnly(user);
    const context = await this.buildContext(user, query);
    await this.auditContextViewed(user, context);
    return context;
  }

  async streamAnswer(
    user: AuthenticatedUser,
    input: StudentAssistantStreamInput & { signal?: AbortSignal; requestId: string },
    callbacks: StudentAssistantStreamCallbacks,
  ) {
    assertStudentOnly(user);
    const stream = createStudentAssistantStreamLifecycle({
      requestId: input.requestId,
      signal: input.signal,
      callbacks: callbacks as never,
    });
    await stream.meta({
      contextType: input.contextType,
      contextId: input.contextId ?? input.evidenceId ?? input.applicationId ?? input.eventId ?? input.reviewTaskId ?? 'current',
      contextVersion: input.contextVersion,
    });
    await stream.status({
      stage: 'preparing_context',
      message: 'Đang chuẩn bị ngữ cảnh...',
    });

    const context = await this.buildContext(user, input, {
      onStatus: (data) => stream.status(data),
    });
    if (context.contextVersion !== input.contextVersion) {
      await stream.error({
        code: ErrorCodes.STUDENT_ASSISTANT_CONTEXT_STALE,
        recoverable: true,
        message: 'Ngữ cảnh đã thay đổi, hãy tải lại câu trả lời.',
      });
      return;
    }

    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.STUDENT_ASSISTANT_QUESTION_SENT,
      targetType: 'student_assistant',
      targetId: context.contextId,
      applicationId: applicationIdFromContext(context),
      metadataJson: {
        contextType: context.contextType,
        contextVersion: context.contextVersion,
        messageLength: input.message.length,
      },
    });

    await stream.status({ stage: 'preparing_answer', message: 'Đang chuẩn bị câu trả lời...' });

    const startedAt = Date.now();
    const identity = buildGenerationIdentity(user.id, context, input);
    const generation = await generationRegistry.run({
      identity,
      conversationKey: `${user.id}:${context.contextType}:${context.contextId}:${input.clientConversationId ?? 'default'}`,
      turnId: input.clientTurnId ?? input.message,
      signal: input.signal,
      generate: async (signal) => {
        try {
          await createApplicationAudit(this.db, {
            actorId: user.id,
            actorRole: user.role,
            action: auditActions.STUDENT_ASSISTANT_GENERATION_STARTED,
            targetType: 'student_assistant',
            targetId: context.contextId,
            applicationId: applicationIdFromContext(context),
            metadataJson: {
              contextType: context.contextType,
              contextVersion: context.contextVersion,
              provider: env.STUDENT_ASSISTANT_PROVIDER,
            },
          });

          const generated = await this.provider.stream({
            context,
            message: input.message,
            recentMessages: input.recentMessages,
            signal,
            safetyIdentifier: buildOpenAiSafetyIdentifier('student', user.id),
            onDelta: async (delta) => {
              await stream.delta(delta);
            },
          });
          const navigation = selectStudentNavigationAction(context, generated.answer.suggestedActionId);
          return {
            fallback: false,
            value: {
              answer: {
                ...generated.answer,
                finalText: generated.answer.answer,
                navigation: navigation.action,
                contextVersion: context.contextVersion,
              },
              model: generated.model,
              totalTokens: generated.totalTokens,
            },
          };
        } catch (error) {
          const code = mapStudentAssistantProviderError(error);
          const fallback = buildDeterministicAnswer(context, input.message);
          const navigation = selectStudentNavigationAction(context, fallback.suggestedActionId);
          logger.warn({ code, contextType: context.contextType }, 'Student assistant answer fell back');
          return {
            fallback: true,
            value: {
              answer: {
                ...fallback,
                finalText: fallback.answer,
                navigation: navigation.action,
                contextVersion: context.contextVersion,
              },
              model: 'deterministic-fallback',
              errorCode: code,
            },
          };
        }
      },
    });

    const generated = generation.value;
    const navigation = generated.answer.navigation
      ? {
          selectedActionId: generated.answer.navigation.id,
          action: generated.answer.navigation,
        }
      : selectStudentNavigationAction(context, generated.answer.suggestedActionId);
    await stream.sources({ sourceRefs: generated.answer.sourceRefs });
    await stream.action({ suggestedActionId: generated.answer.suggestedActionId ?? null });
    await stream.navigation(navigation);
    await stream.complete({
      ...generated.answer,
      finalText: generated.answer.finalText,
      fallback: generation.fallback,
      navigation: navigation.action,
      contextVersion: context.contextVersion,
    });

    if (generation.fallback) {
      await createApplicationAudit(this.db, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.STUDENT_ASSISTANT_GENERATION_FAILED,
        targetType: 'student_assistant',
        targetId: context.contextId,
        applicationId: applicationIdFromContext(context),
        metadataJson: {
          contextType: context.contextType,
          contextVersion: context.contextVersion,
          errorCode: generated.errorCode,
          latencyMs: Date.now() - startedAt,
        },
      });
    } else {
      await createApplicationAudit(this.db, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.STUDENT_ASSISTANT_GENERATION_COMPLETED,
        targetType: 'student_assistant',
        targetId: context.contextId,
        applicationId: applicationIdFromContext(context),
        metadataJson: {
          contextType: context.contextType,
          contextVersion: context.contextVersion,
          intent: generated.answer.intent,
          actionId: generated.answer.suggestedActionId ?? null,
          model: generated.model,
          totalTokens: generated.totalTokens ?? null,
          latencyMs: Date.now() - startedAt,
        },
      });
    }
  }

  async resubmitSupplement(user: AuthenticatedUser, reviewTaskId: string) {
    assertStudentOnly(user);
    const task = await this.getOwnedSupplementTask(user, reviewTaskId);
    const request = activeSupplementRequest(task);
    if (!request) {
      throw new AppError(
        404,
        ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
        'Active supplement request not found',
      );
    }
    const readiness = evaluateSupplementReadiness(task);
    if (!readiness.canResubmit) {
      throw new AppError(
        409,
        ErrorCodes.SUPPLEMENT_NOT_READY_TO_RESUBMIT,
        readiness.reason ?? 'Supplement is not ready to resubmit',
      );
    }

    const result = await this.db.$transaction(async (tx) => {
      const now = new Date();
      const evidenceLinks = task
        .application!.evidences.filter((evidence) => evidence.criterion === task.criterion)
        .map((evidence) => ({ reviewTaskId: task.id, evidenceId: evidence.id }));
      if (evidenceLinks.length) {
        await tx.reviewTaskEvidence.createMany({ data: evidenceLinks, skipDuplicates: true });
      }

      const durableRequest =
        request.id === 'legacy'
          ? await tx.supplementRequest.create({
              data: {
                workspaceId: task.workspaceId,
                applicationId: task.applicationId!,
                reviewTaskId: task.id,
                criterion: task.criterion,
                status: 'active',
                officialMessage: request.officialMessage,
                requestedFieldsJson: jsonInputOrNull(request.requestedFieldsJson),
                evidenceScopeJson: jsonInputOrNull(request.evidenceScopeJson),
                acceptedEvidenceTypesJson: jsonInputOrNull(request.acceptedEvidenceTypesJson),
                deadline: request.deadline,
                createdByUserId: null,
                historyJson: appendHistory(request.historyJson, {
                  at: now.toISOString(),
                  actorId: user.id,
                  action: 'legacy_request_migrated_for_resubmit',
                }),
              },
            })
          : request;

      const updatedRequest = await tx.supplementRequest.update({
        where: { id: durableRequest.id },
        data: {
          status: 'resubmitted',
          resubmittedAt: now,
          historyJson: appendHistory(durableRequest.historyJson, {
            at: now.toISOString(),
            actorId: user.id,
            action: 'student_resubmitted',
          }),
        },
      });

      await tx.reviewTask.update({
        where: { id: task.id },
        data: {
          status: ReviewTaskStatus.waiting,
          decision: null,
          officerNote: null,
          officerSuggestedLevel: null,
          levelAssessmentJson: Prisma.JsonNull,
          decisionReason: null,
        },
      });
      await tx.application.update({
        where: { id: task.applicationId! },
        data: { status: ApplicationStatus.under_review },
      });
      await tx.evidence.updateMany({
        where: {
          applicationId: task.applicationId!,
          criterion: task.criterion,
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

      if (task.assignedOfficerId) {
        await this.notificationsService.create(
          {
            userId: task.assignedOfficerId,
            workspaceId: task.workspaceId,
            applicationId: task.applicationId,
            reviewTaskId: task.id,
            type: NotificationType.review_updated,
            title: 'Sinh viên đã gửi lại bổ sung',
            message: `Sinh viên đã gửi lại bổ sung cho tiêu chí ${criterionLabel(task.criterion)}.`,
            metadata: { supplementRequestId: durableRequest.id, criterion: task.criterion },
          },
          tx,
        );
      }

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.SUPPLEMENT_RESUBMITTED,
        targetType: 'supplement_request',
        targetId: durableRequest.id,
        applicationId: task.applicationId,
        workspaceId: task.workspaceId,
        afterStateJson: {
          reviewTaskId: task.id,
          criterion: task.criterion,
          status: updatedRequest.status,
          resubmittedAt: now.toISOString(),
          linkedEvidenceCount: evidenceLinks.length,
        },
      });
      return updatedRequest;
    });

    return {
      supplementRequest: {
        id: result.id,
        status: result.status,
        resubmittedAt: result.resubmittedAt?.toISOString() ?? null,
      },
      reviewTask: { id: task.id, status: ReviewTaskStatus.waiting },
      application: { id: task.applicationId, status: ApplicationStatus.under_review },
    };
  }

  private async buildContext(
    user: AuthenticatedUser,
    query: StudentAssistantContextQuery,
    stream?: { onStatus: (data: { stage: 'preparing_context' | 'refreshing_evidence' | 'preparing_answer'; message?: string }) => Promise<unknown> | unknown },
  ): Promise<StudentAssistantContext> {
    if (query.contextType === 'dashboard') return this.buildDashboardContext(user, query);
    if (query.contextType === 'evidence_card') return this.buildEvidenceContext(user, query, stream);
    if (query.contextType === 'precheck') return this.buildPrecheckContext(user, query);
    if (query.contextType === 'criteria') return this.buildCriteriaContext(user, query);
    if (query.contextType === 'event_registry') return this.buildEventContext(user, query);
    return this.buildSupplementContext(user, query);
  }

  private async buildDashboardContext(
    user: AuthenticatedUser,
    query: StudentAssistantContextQuery,
  ) {
    const dashboard = await this.dashboardService.getCurrentContext(user, query.schoolYear);
    const action = dashboard.nextBestAction ? actionFromDashboard(dashboard.nextBestAction) : null;
    const facts: StudentAssistantFact[] = [
      fact('dashboard-state', 'workflow_state', 'Trạng thái hồ sơ', dashboard.state, true),
      fact(
        'dashboard-readiness',
        'precheck_result',
        'Điểm sẵn sàng',
        dashboard.application.readinessScore === null
          ? 'Chưa có điểm sẵn sàng'
          : `${dashboard.application.readinessScore}%`,
        true,
      ),
      ...(dashboard.nextBestAction
        ? [
            fact(
              'dashboard-action',
              'next_action',
              dashboard.nextBestAction.title,
              dashboard.nextBestAction.deterministicDescription,
              true,
              dashboard.nextBestAction.id,
              dashboard.nextBestAction.destination,
            ),
          ]
        : []),
    ];
    return finalizeContext({
      contextType: 'dashboard',
      contextId: dashboard.application.id ?? 'current',
      title: dashboard.greeting.title,
      deterministicSummary: dashboard.narrative.fallbackText,
      facts,
      warnings: dashboard.application.precheckIsStale
        ? [
            {
              code: 'PRECHECK_STALE',
              severity: 'warning',
              message: 'Hồ sơ đã thay đổi sau lần tiền kiểm gần nhất.',
              sourceId: 'dashboard-readiness',
            },
          ]
        : [],
      primaryAction: action,
      allowedActions: action ? [action] : [],
      suggestedQuestions: [
        'Tôi nên làm gì tiếp theo?',
        'Hồ sơ hiện đang ở bước nào?',
        'Tôi có thể nộp hồ sơ chưa?',
      ],
      boundaries: boundaries({ criteria: true, evidence: true, events: true, supplement: true }),
    });
  }

  private async buildEvidenceContext(
    user: AuthenticatedUser,
    query: StudentAssistantContextQuery,
    stream?: { onStatus: (data: { stage: 'preparing_context' | 'refreshing_evidence' | 'preparing_answer'; message?: string }) => Promise<unknown> | unknown },
  ) {
    const evidenceId = query.evidenceId ?? query.contextId;
    if (!evidenceId) throwNotFound();
    let evidence = await this.findOwnedEvidenceForAssistant(user, evidenceId);
    if (!evidence || evidence.application?.studentId !== user.id) throwForbiddenOrNotFound();
    const refresh = await this.refreshLegacyEvidenceIfNeeded(user, evidence, stream);
    if (refresh.refetched) {
      evidence = await this.findOwnedEvidenceForAssistant(user, evidenceId);
      if (!evidence) throwForbiddenOrNotFound();
    }
    const card = evidence.evidenceCard;
    const evidencePrecheck = asRecord(card?.evidencePrecheckJson);
    const fields = flattenRecord(
      (card?.confirmedFieldsJson as Record<string, unknown> | null) ??
        (card?.normalizedFieldsJson as Record<string, unknown> | null) ??
        (card?.extractedFieldsJson as Record<string, unknown> | null),
    );
    const facts: StudentAssistantFact[] = [
      fact(
        'evidence-status',
        'workflow_state',
        'Trạng thái minh chứng',
        friendlyStudentValue(evidence.indexingStatus),
        true,
      ),
      fact(
        'evidence-name',
        'evidence_field',
        'Tên minh chứng',
        evidence.evidenceName,
        true,
        evidence.id,
        {
          route: '/app/application',
          query: { evidenceId: evidence.id },
        },
      ),
      ...evidencePrecheckFacts(evidencePrecheck),
      ...fields
        .slice(0, 8)
        .map(([key, value]) =>
          fact(
            `field:${key}`,
            'evidence_field',
            fieldLabel(key),
            String(value),
            isCardTrusted(card),
          ),
        ),
    ];
    const warningList = Array.isArray(card?.warningsJson) ? card?.warningsJson : [];
    const precheckWarnings = Array.isArray(evidencePrecheck?.warnings)
      ? evidencePrecheck.warnings
      : [];
    const warnings = [...precheckWarnings, ...warningList].slice(0, 5).map((warning, index) => ({
      code: stringFromRecord(warning, 'code') ?? `EVIDENCE_WARNING_${index + 1}`,
      severity: warningSeverity(warning),
      message:
        stringFromRecord(warning, 'friendlyMessage') ??
        stringFromRecord(warning, 'message') ??
        'Có thông tin cần kiểm tra lại.',
      sourceId: 'evidence-status',
    }));
    const canAct = ['draft', 'prechecked', 'ready_to_submit', 'supplement_required'].includes(
      evidence.application!.status,
    );
    const actions: StudentAssistantAction[] = [
      {
        id: `open-evidence:${evidence.id}`,
        type: 'open_evidence',
        label: 'Mở minh chứng',
        destination: { route: '/app/application', query: { evidenceId: evidence.id } },
        allowed: true,
      },
      {
        id: `confirm-evidence:${evidence.id}`,
        type: 'confirm_evidence',
        label: 'Xác nhận minh chứng',
        destination: {
          route: '/app/application',
          query: { evidenceId: evidence.id, mode: 'confirm' },
        },
        allowed: canAct && Boolean(card?.requiresHumanConfirmation),
        disabledReason: card?.requiresHumanConfirmation
          ? undefined
          : 'Minh chứng không cần xác nhận.',
      },
      {
        id: `replace-file:${evidence.id}`,
        type: 'replace_evidence_file',
        label: 'Thay hoặc bổ sung file',
        destination: {
          route: '/app/application',
          query: { evidenceId: evidence.id, mode: 'recover' },
        },
        allowed: canAct,
      },
    ];
    return finalizeContext({
      contextType: 'evidence_card',
      contextId: evidence.id,
      title: `Trợ lý minh chứng: ${evidence.evidenceName}`,
      deterministicSummary: evidenceSummary(evidence.indexingStatus, card?.confirmationStatus),
      facts,
      warnings,
      primaryAction:
        actions.find((action) => action.type === 'confirm_evidence' && action.allowed) ??
        actions[0],
      allowedActions: actions,
      suggestedQuestions: [
        'Đây là minh chứng gì?',
        'Thông tin nào đang thiếu?',
        'Tôi nên sửa hay thay file?',
        'Xác nhận có nghĩa là gì?',
      ],
      boundaries: boundaries({
        evidence: true,
        events: evidence.sourceType === EvidenceSourceType.event_import,
      }),
    });
  }

  private async buildPrecheckContext(user: AuthenticatedUser, query: StudentAssistantContextQuery) {
    const application = await this.getOwnedApplication(user, query);
    const latest = application.precheckResults[0] ?? null;
    const result = asRecord(latest?.resultJson);
    const missing = Array.isArray(latest?.missingItemsJson) ? latest?.missingItemsJson : [];
    const action = asRecord(result?.nextAction);
    const facts: StudentAssistantFact[] = [
      fact(
        'precheck-score',
        'precheck_result',
        'Điểm tiền kiểm',
        latest ? `${latest.readinessScore}%` : 'Chưa chạy tiền kiểm',
        true,
      ),
      ...missing
        .slice(0, 5)
        .map((item, index) =>
          fact(
            `missing:${index}`,
            'precheck_result',
            stringFromRecord(item, 'title') ?? 'Mục cần bổ sung',
            stringFromRecord(item, 'message') ??
              stringFromRecord(item, 'reason') ??
              'Chưa đủ dữ liệu.',
            true,
          ),
        ),
    ];
    const precheckActionQuery: Record<string, string> | undefined = query.criterion
      ? { criterion: query.criterion }
      : undefined;
    const primaryAction = action
      ? ({
          id: `precheck-action:${String(action.type ?? 'resolve')}`,
          type: actionTypeFromPrecheck(action),
          label: stringFromRecord(action, 'label') ?? 'Xử lý kết quả tiền kiểm',
          description: stringFromRecord(action, 'shortReason') ?? undefined,
          destination: {
            route: stringFromRecord(action, 'route') ?? '/app/application',
            query: precheckActionQuery,
          },
          allowed: true,
        } satisfies StudentAssistantAction)
      : ({
          id: `run-precheck:${application.id}`,
          type: latest ? 'rerun_precheck' : 'open_precheck',
          label: latest ? 'Chạy lại tiền kiểm' : 'Chạy tiền kiểm',
          destination: { route: '/app/application', query: { tab: 'precheck' } },
          allowed: application.status !== ApplicationStatus.under_review,
        } satisfies StudentAssistantAction);
    return finalizeContext({
      contextType: 'precheck',
      contextId: application.id,
      title: 'Trợ lý tiền kiểm',
      deterministicSummary: latest
        ? `Kết quả tiền kiểm hiện ghi nhận ${latest.readinessScore}%. Đây chỉ là bước kiểm tra sơ bộ, không phải kết quả chính thức.`
        : 'Hồ sơ chưa có kết quả tiền kiểm. Bạn có thể chạy tiền kiểm sau khi đã thêm dữ liệu hoặc minh chứng phù hợp.',
      facts,
      warnings: latest
        ? []
        : [{ code: 'PRECHECK_NOT_RUN', severity: 'info', message: 'Chưa có kết quả tiền kiểm.' }],
      primaryAction,
      allowedActions: [primaryAction],
      suggestedQuestions: [
        'Tại sao tiêu chí này chưa đủ?',
        'Kết quả này dùng minh chứng nào?',
        'Tôi cần bổ sung gì?',
        'Tiền kiểm có phải kết quả chính thức không?',
      ],
      boundaries: boundaries({ criteria: true, evidence: true }),
    });
  }

  private async buildCriteriaContext(user: AuthenticatedUser, query: StudentAssistantContextQuery) {
    const scope = query.scope ?? scopeFromContextId(query.contextId) ?? Level.school;
    const { evaluation, application } = await this.criteriaService.buildCriteriaAssistantContext(user, {
      applicationId: query.applicationId,
      scope,
      criterion: query.criterion,
    });
    const gap = await this.criteriaService.compareCriteriaLevels(user, application.id, {
      scopes: [Level.school, Level.university, Level.city, Level.central],
      criterion: query.criterion,
    });
    const criterionFacts = evaluation.criteria.flatMap((criterionResult) => {
      const base = fact(
        `criteria:${criterionResult.criterion}:status`,
        'criteria_rule',
        criterionLabel(criterionResult.criterion),
        criteriaStatusLabel(criterionResult.status),
        true,
      );
      const missing = criterionResult.mandatoryRules
        .filter((rule) => rule.status !== 'MATCHED')
        .slice(0, 3)
        .map((rule) =>
          fact(
            `criteria:${criterionResult.criterion}:${rule.ruleKey}`,
            'criteria_gap',
            rule.title,
            `${criteriaStatusLabel(rule.status === 'MANUAL_REVIEW' ? 'NEEDS_MANUAL_REVIEW' : rule.status === 'NEEDS_CONFIRMATION' ? 'NEEDS_CONFIRMATION' : 'INCOMPLETE')}: ${rule.studentFriendlyExplanation}`,
            rule.status === 'MATCHED',
          ),
        );
      return [base, ...missing];
    });
    const sourceFacts = evaluation.sourceRefs.slice(0, 5).map((source, index) =>
      fact(
        `criteria-source:${index}`,
        'criteria_source',
        source.label,
        `${source.documentName}${source.section ? `, ${source.section}` : ''}${source.page ? `, trang ${source.page}` : ''}`,
        true,
      ),
    );
    const gapFacts = gap.levels.map((level) =>
      fact(
        `criteria-gap:${level.scope}`,
        'criteria_gap',
        scopeLabel(level.scope),
        `${criteriaStatusLabel(level.status)}. Thiếu: ${level.missing.slice(0, 2).join('; ') || 'chưa ghi nhận mục thiếu'}.`,
        true,
      ),
    );
    const actions: StudentAssistantAction[] = [
      ...evaluation.allowedActions.map(
        (action) =>
          ({
            id: action.id,
            type: action.type,
            label: action.label,
            destination: action.destination,
            allowed: action.allowed,
          }) satisfies StudentAssistantAction,
      ),
      {
        id: `view-source:${evaluation.criteriaConfig.scope}`,
        type: 'view_source_criteria',
        label: 'Xem nguồn tiêu chí',
        destination: {
          route: '/app/assistant',
          query: {
            contextType: 'criteria',
            scope: evaluation.criteriaConfig.scope,
            applicationId: application.id,
          },
        },
        allowed: true,
      },
    ];
    const primaryAction = actions.find((action) => action.allowed) ?? null;
    return finalizeContext({
      contextType: 'criteria',
      contextId: `${application.id}:${evaluation.criteriaConfig.scope}`,
      title: `Trợ lý tiêu chí ${scopeLabel(evaluation.criteriaConfig.scope)}`,
      deterministicSummary: `Bộ tiêu chí ${scopeLabel(evaluation.criteriaConfig.scope)} đang được đối chiếu ở trạng thái ${criteriaStatusLabel(evaluation.overallStatus).toLowerCase()}. Đây là kết quả hỗ trợ tiền kiểm, không phải kết quả xét chọn chính thức.`,
      facts: [
        fact(
          'criteria-config',
          'criteria_source',
          evaluation.criteriaConfig.title,
          evaluation.criteriaConfig.sourceDocumentName,
          true,
        ),
        fact(
          'criteria-overall',
          'precheck_result',
          'Kết quả đối chiếu',
          criteriaStatusLabel(evaluation.overallStatus),
          true,
        ),
        ...criterionFacts,
        ...gapFacts,
        ...sourceFacts,
      ],
      warnings:
        evaluation.overallStatus === 'NEEDS_MANUAL_REVIEW'
          ? [
              {
                code: 'CRITERIA_MANUAL_REVIEW_REQUIRED',
                severity: 'warning',
                message: 'Một số điều kiện cần cán bộ xem trực tiếp theo nguồn tiêu chí.',
              },
            ]
          : [],
      primaryAction,
      allowedActions: actions,
      suggestedQuestions: [
        `Tiêu chí ${scopeLabel(evaluation.criteriaConfig.scope)} gồm những gì?`,
        'Hồ sơ của tôi còn thiếu gì?',
        'Điều kiện nào cần cán bộ xem trực tiếp?',
        'Nguồn tiêu chí này ở đâu?',
      ],
      boundaries: boundaries({ criteria: true, evidence: true, events: true }),
    });
  }

  private async buildEventContext(user: AuthenticatedUser, query: StudentAssistantContextQuery) {
    const application = await this.getOwnedApplication(user, query);
    const eventId = query.eventId ?? query.contextId;
    if (!eventId) throwNotFound();
    const event = await this.db.eventRegistry.findFirst({
      where: {
        id: eventId,
        workspaceId: application.workspaceId,
        status: 'active',
        rosterIndexed: true,
      },
      include: {
        participants: {
          where: { studentCode: application.student.studentCode ?? '' },
          take: 1,
        },
        evidences: {
          where: { applicationId: application.id, sourceType: EvidenceSourceType.event_import },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!event) throwNotFound();
    const participant = event.participants[0] ?? null;
    const duplicate = event.evidences[0] ?? null;
    const actions: StudentAssistantAction[] = [
      {
        id: `open-event:${event.id}`,
        type: 'open_event',
        label: 'Xem sự kiện',
        destination: {
          route: '/app/application',
          query: { eventId: event.id, mode: 'suggested-import' },
        },
        allowed: true,
      },
      {
        id: `import-event:${event.id}`,
        type: 'import_event',
        label: duplicate ? 'Đã có trong hồ sơ' : 'Import sự kiện',
        destination: {
          route: '/app/application',
          query: { eventId: event.id, criterion: event.criterion, mode: 'suggested-import' },
        },
        allowed: Boolean(participant && !duplicate),
        disabledReason: duplicate
          ? 'Sự kiện này đã được import vào hồ sơ.'
          : participant
            ? undefined
            : 'Chưa tìm thấy bạn trong danh sách đã xác nhận.',
      },
    ];
    return finalizeContext({
      contextType: 'event_registry',
      contextId: event.id,
      title: `Trợ lý sự kiện: ${event.eventName}`,
      deterministicSummary: participant
        ? 'Sự kiện này nằm trong kho chính thức và đã tìm thấy bạn trong danh sách xác nhận. Import sẽ tạo minh chứng tin cậy, không cần tải file để đọc lại.'
        : 'Sự kiện này nằm trong kho chính thức, nhưng hệ thống vẫn cần kiểm tra MSSV trong danh sách xác nhận trước khi import.',
      facts: [
        fact('event-name', 'event_registry', 'Sự kiện', event.eventName, true),
        fact(
          'event-criterion',
          'event_registry',
          'Tiêu chí',
          criterionLabel(event.criterion),
          true,
        ),
        fact(
          'participant-status',
          'participant_status',
          'Danh sách xác nhận',
          participant ? 'Đã tìm thấy sinh viên' : 'Chưa tìm thấy sinh viên',
          Boolean(participant),
        ),
        fact(
          'event-import',
          'event_registry',
          'Trạng thái import',
          duplicate ? 'Đã import' : 'Chưa import',
          true,
        ),
      ],
      warnings: participant
        ? []
        : [
            {
              code: 'EVENT_PARTICIPANT_NOT_FOUND',
              severity: 'warning',
              message: 'Chưa tìm thấy MSSV của bạn trong danh sách xác nhận.',
              sourceId: 'participant-status',
            },
          ],
      primaryAction: actions[1],
      allowedActions: actions,
      suggestedQuestions: [
        'Tại sao sự kiện này được gợi ý?',
        'Import khác gì tải file?',
        'Tại sao chưa tìm thấy MSSV?',
        'Import xong có được tính ngay không?',
      ],
      boundaries: boundaries({ events: true, evidence: true }),
    });
  }

  private async buildSupplementContext(
    user: AuthenticatedUser,
    query: StudentAssistantContextQuery,
  ) {
    const reviewTaskId = query.reviewTaskId ?? query.contextId;
    if (!reviewTaskId) throwNotFound();
    const task = await this.getOwnedSupplementTask(user, reviewTaskId);
    const request = activeSupplementRequest(task);
    if (!request) throwNotFound();
    const readiness = evaluateSupplementReadiness(task);
    const actions: StudentAssistantAction[] = [
      {
        id: `add-evidence:${task.criterion}`,
        type: 'add_evidence',
        label: 'Thêm minh chứng bổ sung',
        destination: {
          route: '/app/application',
          query: { criterion: task.criterion, mode: 'supplement', reviewTaskId: task.id },
        },
        allowed: true,
      },
      {
        id: `resubmit-supplement:${task.id}`,
        type: 'resubmit_supplement',
        label: 'Gửi lại bổ sung',
        destination: {
          route: '/app/application',
          query: { criterion: task.criterion, mode: 'supplement', reviewTaskId: task.id },
        },
        allowed: readiness.canResubmit,
        disabledReason: readiness.reason ?? undefined,
      },
      {
        id: `contact-officer:${task.id}`,
        type: 'contact_officer',
        label: 'Liên hệ cán bộ',
        destination: {
          route: '/app/application',
          query: { criterion: task.criterion, mode: 'supplement', reviewTaskId: task.id },
        },
        allowed: true,
      },
    ];
    return finalizeContext({
      contextType: 'supplement',
      contextId: task.id,
      title: `Trợ lý bổ sung hồ sơ: ${criterionLabel(task.criterion)}`,
      deterministicSummary: supplementSummary(request, readiness),
      facts: [
        fact(
          'supplement-message',
          'officer_request',
          'Yêu cầu từ cán bộ',
          request.officialMessage,
          true,
        ),
        fact(
          'supplement-deadline',
          'deadline',
          'Hạn bổ sung',
          request.deadline ? request.deadline.toISOString() : 'Chưa đặt hạn',
          true,
        ),
        fact(
          'supplement-progress',
          'supplement_progress',
          'Tiến độ',
          readiness.canResubmit ? 'Có thể gửi lại' : (readiness.reason ?? 'Chưa sẵn sàng gửi lại'),
          true,
        ),
      ],
      warnings: readiness.canResubmit
        ? []
        : [
            {
              code: 'SUPPLEMENT_NOT_READY_TO_RESUBMIT',
              severity: 'blocking',
              message: readiness.reason ?? 'Yêu cầu bổ sung chưa sẵn sàng gửi lại.',
              sourceId: 'supplement-progress',
            },
          ],
      primaryAction: actions[1],
      allowedActions: actions,
      suggestedQuestions: [
        'Cán bộ đang yêu cầu tôi bổ sung gì?',
        'Tôi cần sửa file hay thêm minh chứng mới?',
        'Phần nào tôi đã xử lý xong?',
        'Hạn bổ sung còn bao lâu?',
        'Tôi đã có thể gửi lại chưa?',
      ],
      boundaries: boundaries({ supplement: true, evidence: true, criteria: true }),
    });
  }

  private findOwnedEvidenceForAssistant(user: AuthenticatedUser, evidenceId: string) {
    return this.db.evidence.findFirst({
      where: { id: evidenceId, application: { studentId: user.id } },
      include: assistantEvidenceInclude,
    });
  }

  private async refreshLegacyEvidenceIfNeeded(
    user: AuthenticatedUser,
    evidence: AssistantEvidenceRecord,
    stream?: { onStatus: (data: { stage: 'preparing_context' | 'refreshing_evidence' | 'preparing_answer'; message?: string }) => Promise<unknown> | unknown },
  ) {
    const activeFile = resolveNewestAssistantEvidenceFile(evidence.evidenceFiles);
    const activeJobs = await this.db.indexingJob.findMany({
      where: {
        targetId: evidence.id,
        jobType: JobType.evidence_ocr,
        status: { in: [JobStatus.queued, JobStatus.processing] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const decision = shouldReanalyseLegacyEvidence({
      evidence,
      activeFile,
      evidenceCard: evidence.evidenceCard,
      activeJobs,
      providerConfigured: openAiEvidenceAnalysisConfigured(),
      allowConfirmed: true,
    });
    if (!decision.required || !decision.safeToAutoQueue || !activeFile) {
      return { refetched: false };
    }

    await stream?.onStatus({
      stage: 'refreshing_evidence',
      message: 'Mình đang đọc lại minh chứng để trả lời chính xác hơn.',
    });

    const jobInput = buildEvidenceAnalysisJobInput({
      evidenceId: evidence.id,
      evidenceFileId: activeFile.evidenceFileId,
      fileId: activeFile.fileId,
      provider: 'openai',
      trigger: 'student_assistant_reanalysis',
    });
    const matchingActive = activeJobs.find((job) => {
      const input = asRecord(job.inputJson);
      return input?.evidenceFileId === activeFile.evidenceFileId && input?.fileId === activeFile.fileId;
    });
    const job =
      matchingActive ??
      (await this.db.indexingJob.create({
        data: {
          targetId: evidence.id,
          workspaceId: evidence.application!.workspaceId,
          jobType: JobType.evidence_ocr,
          status: JobStatus.queued,
          attempts: 0,
          inputJson: jobInput as Prisma.InputJsonValue,
        },
      }));

    await this.db.evidence.update({
      where: { id: evidence.id },
      data: { status: EvidenceStatus.pending_indexing, indexingStatus: IndexingStatus.pending_indexing },
    });
    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      workspaceId: evidence.application!.workspaceId,
      action: auditActions.EVIDENCE_REANALYSIS_QUEUED,
      targetType: 'indexing_job',
      targetId: job.id,
      applicationId: evidence.applicationId ?? undefined,
      evidenceId: evidence.id,
      metadataJson: {
        trigger: 'student_assistant_reanalysis',
        reasonCodes: decision.reasons,
        evidenceFileId: activeFile.evidenceFileId,
        fileId: activeFile.fileId,
      },
    });

    if (job.status !== JobStatus.queued) return { refetched: false };
    const completed = await withTimeout(runIndexingJob(job.id), evidenceReanalysisWaitMs);
    if (!completed) return { refetched: false };
    if (completed.status === JobStatus.completed) {
      await createApplicationAudit(this.db, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: evidence.application!.workspaceId,
        action: auditActions.EVIDENCE_REANALYSIS_COMPLETED,
        targetType: 'indexing_job',
        targetId: job.id,
        applicationId: evidence.applicationId ?? undefined,
        evidenceId: evidence.id,
        metadataJson: {
          trigger: 'student_assistant_reanalysis',
          reasonCodes: decision.reasons,
        },
      });
      return { refetched: true };
    }
    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      workspaceId: evidence.application!.workspaceId,
      action: auditActions.EVIDENCE_REANALYSIS_FAILED,
      targetType: 'indexing_job',
      targetId: job.id,
      applicationId: evidence.applicationId ?? undefined,
      evidenceId: evidence.id,
      metadataJson: {
        trigger: 'student_assistant_reanalysis',
        reasonCodes: decision.reasons,
        status: completed.status,
      },
    });
    return { refetched: true };
  }

  private async getOwnedApplication(user: AuthenticatedUser, query: StudentAssistantContextQuery) {
    const application = query.applicationId
      ? await this.db.application.findUnique({
          where: { id: query.applicationId },
          include: {
            student: true,
            evidences: { include: { evidenceCard: true, event: true } },
            precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
            reviewTasks: { include: { supplementRequests: true } },
          },
        })
      : await this.db.application.findFirst({
          where: {
            studentId: user.id,
            schoolYear: normalizeSchoolYear(query.schoolYear),
            applicationType: 'individual',
          },
          include: {
            student: true,
            evidences: { include: { evidenceCard: true, event: true } },
            precheckResults: { orderBy: { createdAt: 'desc' }, take: 1 },
            reviewTasks: { include: { supplementRequests: true } },
          },
        });
    if (!application || application.studentId !== user.id) throwForbiddenOrNotFound();
    return application;
  }

  private async getOwnedSupplementTask(user: AuthenticatedUser, reviewTaskId: string) {
    const task = await this.db.reviewTask.findUnique({
      where: { id: reviewTaskId },
      include: {
        supplementRequests: { orderBy: { createdAt: 'desc' } },
        application: {
          include: {
            student: true,
            evidences: {
              include: { evidenceCard: true },
              orderBy: { updatedAt: 'desc' },
            },
          },
        },
      },
    });
    if (!task || !task.application || task.application.studentId !== user.id) {
      throwForbiddenOrNotFound();
    }
    if (task.status !== ReviewTaskStatus.supplement_required) {
      throw new AppError(
        404,
        ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
        'Active supplement request not found',
      );
    }
    return task;
  }

  private async auditContextViewed(user: AuthenticatedUser, context: StudentAssistantContext) {
    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.STUDENT_ASSISTANT_CONTEXT_VIEWED,
      targetType: 'student_assistant',
      targetId: context.contextId,
      applicationId: applicationIdFromContext(context),
      metadataJson: {
        contextType: context.contextType,
        contextVersion: context.contextVersion,
      },
    });
  }
}

function finalizeContext(input: Omit<StudentAssistantContext, 'contextVersion' | 'generatedAt'>) {
  const versionInput = {
    contextType: input.contextType,
    contextId: input.contextId,
    title: input.title,
    deterministicSummary: input.deterministicSummary,
    facts: input.facts,
    warnings: input.warnings,
    primaryAction: input.primaryAction,
    allowedActions: input.allowedActions,
    suggestedQuestions: input.suggestedQuestions,
    boundaries: input.boundaries,
  };
  return {
    ...input,
    contextVersion: sha256(JSON.stringify(stableSort(versionInput))).slice(0, 32),
    generatedAt: new Date().toISOString(),
  };
}

function activeSupplementRequest(task: {
  supplementRequests?: Array<{
    id: string;
    status: string;
    officialMessage: string;
    requestedFieldsJson: Prisma.JsonValue | null;
    evidenceScopeJson: Prisma.JsonValue | null;
    acceptedEvidenceTypesJson: Prisma.JsonValue | null;
    deadline: Date | null;
    historyJson: Prisma.JsonValue | null;
  }>;
  supplementRequestJson?: Prisma.JsonValue | null;
  officerNote?: string | null;
  dueDate?: Date | null;
}) {
  const active = task.supplementRequests?.find((request) => request.status === 'active');
  if (active) return active;
  const legacy = asRecord(task.supplementRequestJson);
  const reason =
    stringFromRecord(legacy, 'reason') ?? stringFromRecord(legacy, 'note') ?? task.officerNote;
  if (!reason) return null;
  return {
    id: 'legacy',
    status: 'active',
    officialMessage: reason,
    requestedFieldsJson: legacy?.requestedFields ?? [],
    evidenceScopeJson: { evidenceIds: legacy?.evidenceIds ?? [] },
    acceptedEvidenceTypesJson: null,
    deadline: parseDate(stringFromRecord(legacy, 'deadline')) ?? task.dueDate ?? null,
    historyJson: [],
  };
}

function evaluateSupplementReadiness(task: {
  criterion: Criterion;
  dueDate?: Date | null;
  application?: {
    status: ApplicationStatus;
    evidences: Array<{
      criterion: Criterion;
      status: EvidenceStatus;
      indexingStatus: IndexingStatus;
      evidenceCard?: {
        requiresHumanConfirmation: boolean;
        confirmationStatus: string;
      } | null;
    }>;
  } | null;
}) {
  if (!task.application || task.application.status !== ApplicationStatus.supplement_required) {
    return { canResubmit: false, reason: 'Hồ sơ không ở trạng thái cần bổ sung.' };
  }
  const evidences = task.application.evidences.filter(
    (evidence) => evidence.criterion === task.criterion,
  );
  if (evidences.length === 0)
    return { canResubmit: false, reason: 'Bạn chưa có minh chứng cho tiêu chí này.' };
  if (evidences.some((evidence) => activeProcessingStatuses.has(evidence.indexingStatus))) {
    return { canResubmit: false, reason: 'Có minh chứng đang được xử lý, cần chờ hoàn tất.' };
  }
  if (
    evidences.some(
      (evidence) =>
        evidence.evidenceCard?.requiresHumanConfirmation ||
        evidence.evidenceCard?.confirmationStatus === 'pending' ||
        evidence.evidenceCard?.confirmationStatus === 'correction_required',
    )
  ) {
    return { canResubmit: false, reason: 'Có minh chứng cần bạn xác nhận thông tin trước.' };
  }
  if (
    !evidences.some(
      (evidence) =>
        evidence.status === EvidenceStatus.indexed ||
        evidence.status === EvidenceStatus.needs_supplement ||
        evidence.status === EvidenceStatus.under_review,
    )
  ) {
    return { canResubmit: false, reason: 'Chưa có minh chứng đã sẵn sàng cho yêu cầu bổ sung.' };
  }
  if (task.dueDate && task.dueDate.getTime() < Date.now()) {
    return { canResubmit: false, reason: 'Yêu cầu bổ sung đã quá hạn, bạn cần liên hệ cán bộ.' };
  }
  return { canResubmit: true, reason: null };
}

function supplementSummary(
  request: { officialMessage: string; deadline: Date | null },
  readiness: { canResubmit: boolean; reason: string | null },
) {
  const deadline = request.deadline
    ? ` Hạn bổ sung là ${request.deadline.toISOString().slice(0, 10)}.`
    : '';
  const state = readiness.canResubmit
    ? 'Bạn đã có thể gửi lại yêu cầu bổ sung để cán bộ xem tiếp.'
    : `Hiện chưa thể gửi lại: ${readiness.reason}`;
  return `Cán bộ đang yêu cầu bổ sung: ${request.officialMessage}.${deadline} ${state}`;
}

function evidenceSummary(indexingStatus: IndexingStatus, confirmationStatus?: string | null) {
  if (activeProcessingStatuses.has(indexingStatus)) {
    return 'Minh chứng đang được hệ thống xử lý. Bạn có thể tiếp tục thao tác khác và quay lại khi hoàn tất.';
  }
  if (
    indexingStatus === IndexingStatus.failed ||
    indexingStatus === IndexingStatus.needs_manual_review
  ) {
    return 'Minh chứng chưa được đọc thành công. Bạn có thể thử xử lý lại hoặc thay file rõ hơn.';
  }
  if (confirmationStatus === 'pending' || confirmationStatus === 'correction_required') {
    return 'Minh chứng đã được đọc xong nhưng cần bạn kiểm tra thông tin trước khi dùng để tiền kiểm.';
  }
  if (confirmationStatus === 'confirmed') {
    return 'Thông tin minh chứng đã được bạn xác nhận và có thể dùng cho lần tiền kiểm tiếp theo.';
  }
  return 'Minh chứng đang có thông tin tóm tắt để bạn đối chiếu. Kết quả chính thức vẫn do cán bộ xác nhận.';
}

function actionFromDashboard(action: {
  id: string;
  type: string;
  ctaLabel: string;
  deterministicDescription: string;
  destination: { route: string; query?: Record<string, string> };
}) {
  return {
    id: action.id,
    type: dashboardActionType(action.type),
    label: action.ctaLabel,
    description: action.deterministicDescription,
    destination: action.destination,
    allowed: true,
  } satisfies StudentAssistantAction;
}

function dashboardActionType(type: string): StudentAssistantAction['type'] {
  if (type === 'start_application') return 'start_application';
  if (type === 'continue_application') return 'open_application';
  if (type === 'confirm_evidence') return 'confirm_evidence';
  if (type === 'retry_evidence_analysis') return 'retry_evidence_analysis';
  if (type === 'replace_evidence_file') return 'replace_evidence_file';
  if (type === 'import_event') return 'import_event';
  if (type === 'run_precheck') return 'run_precheck';
  if (type === 'rerun_precheck') return 'rerun_precheck';
  if (type === 'resolve_supplement') return 'open_supplement';
  if (type === 'submit_application') return 'submit_application';
  if (type === 'resolve_precheck_issue') return 'resolve_precheck_issue';
  return 'add_evidence';
}

function scopeFromContextId(contextId?: string): Level | null {
  if (contextId === Level.school) return Level.school;
  if (contextId === Level.university) return Level.university;
  if (contextId === Level.city) return Level.city;
  if (contextId === Level.central) return Level.central;
  return null;
}

function actionTypeFromPrecheck(action: Record<string, unknown>): StudentAssistantAction['type'] {
  const type = String(action.type ?? '');
  if (type.includes('confirm')) return 'confirm_evidence';
  if (type.includes('precheck')) return 'open_precheck';
  if (type.includes('supplement')) return 'open_supplement';
  if (type.includes('submit')) return 'submit_application';
  return 'resolve_precheck_issue';
}

function fact(
  id: string,
  type: StudentAssistantFact['type'],
  label: string,
  value: string,
  verified: boolean,
  sourceId?: string,
  destination?: StudentAssistantFact['destination'],
): StudentAssistantFact {
  return { id, type, label, value, verified, sourceId, destination };
}

function boundaries(input: {
  criteria?: boolean;
  evidence?: boolean;
  events?: boolean;
  supplement?: boolean;
}) {
  return {
    canAnswerAboutCriteria: Boolean(input.criteria),
    canAnswerAboutEvidence: Boolean(input.evidence),
    canAnswerAboutEvents: Boolean(input.events),
    canAnswerAboutSupplement: Boolean(input.supplement),
    requiresOfficerForOfficialDecision: true,
  };
}

function flattenRecord(value: Record<string, unknown> | null | undefined) {
  if (!value) return [];
  return Object.entries(value).filter(
    ([, fieldValue]) =>
      fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim(),
  );
}

function evidencePrecheckFacts(precheck: Record<string, unknown> | null): StudentAssistantFact[] {
  if (!precheck) return [];
  const identifiedAs = asRecord(precheck.identifiedAs);
  const completeness = asRecord(precheck.completeness);
  const quality = asRecord(precheck.quality);
  const facts: StudentAssistantFact[] = [];
  const documentLabel = stringFromRecord(identifiedAs, 'documentLabel');
  const shortDescription = stringFromRecord(identifiedAs, 'shortDescription');
  if (documentLabel || shortDescription) {
    facts.push(
      fact(
        'evidence-precheck-identity',
        'evidence_precheck',
        'AI nhận diện minh chứng',
        [documentLabel, shortDescription].filter(Boolean).join(' - '),
        true,
      ),
    );
  }
  if (typeof completeness?.score === 'number') {
    facts.push(
      fact(
        'evidence-precheck-completeness',
        'evidence_precheck',
        'Mức đầy đủ thông tin',
        `${Math.round(completeness.score * 100)}%`,
        true,
      ),
    );
  }
  const qualityLevel = stringFromRecord(quality, 'level');
  if (qualityLevel) {
    facts.push(
      fact(
        'evidence-precheck-quality',
        'evidence_precheck',
        'Chất lượng tài liệu',
        friendlyStudentValue(qualityLevel),
        true,
      ),
    );
  }
  const recommendedAction = stringFromRecord(precheck, 'recommendedAction');
  if (recommendedAction) {
    facts.push(
      fact(
        'evidence-precheck-action',
        'next_action',
        'Bước nên làm',
        friendlyStudentValue(recommendedAction),
        true,
      ),
    );
  }
  return facts;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    student_name: 'Họ tên',
    student_code: 'MSSV',
    class_name: 'Lớp',
    faculty: 'Khoa',
    event_name: 'Tên hoạt động',
    organizer: 'Đơn vị tổ chức',
    organizer_level: 'Cấp tổ chức',
    issue_date: 'Ngày cấp',
    activity_date: 'Ngày hoạt động',
    award_level: 'Cấp khen thưởng',
    volunteer_days: 'Số ngày tình nguyện',
    certificate_type: 'Loại chứng nhận',
    language_score: 'Điểm ngoại ngữ',
    gpa: 'GPA',
    conduct_score: 'Điểm rèn luyện',
  };
  return labels[key] ?? key;
}

function warningSeverity(value: unknown): 'info' | 'warning' | 'blocking' {
  const severity = stringFromRecord(value, 'severity');
  if (severity === 'info' || severity === 'warning' || severity === 'blocking') return severity;
  return 'warning';
}

function isCardTrusted(
  card: { confirmationStatus?: string | null; provider?: string | null } | null | undefined,
) {
  return (
    card?.confirmationStatus === 'confirmed' ||
    card?.confirmationStatus === 'not_required' ||
    card?.provider === 'event_registry'
  );
}

function stringFromRecord(value: unknown, key: string) {
  const record = asRecord(value);
  const result = record?.[key];
  return typeof result === 'string' && result.trim() ? result : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function appendHistory(history: Prisma.JsonValue | null, item: Record<string, unknown>) {
  const current = Array.isArray(history) ? history : [];
  return [...current, item] as Prisma.InputJsonValue;
}

function jsonInputOrNull(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function applicationIdFromContext(context: StudentAssistantContext) {
  const actionApplicationId = context.allowedActions
    .map((action) => action.destination.query?.applicationId)
    .find(Boolean);
  if (actionApplicationId) return actionApplicationId;
  return context.contextType === 'dashboard' || context.contextType === 'precheck'
    ? context.contextId
    : undefined;
}

function buildGenerationIdentity(
  userId: string,
  context: StudentAssistantContext,
  input: StudentAssistantStreamInput,
) {
  return sha256(
    JSON.stringify(
      stableSort({
        userId,
        contextType: context.contextType,
        contextId: context.contextId,
        contextVersion: context.contextVersion,
        message: String(input.message).replace(/\s+/g, ' ').trim().toLowerCase(),
        turnId: input.clientTurnId ?? null,
      }),
    ),
  );
}

function openAiEvidenceAnalysisConfigured() {
  return Boolean(env.OPENAI_API_KEY && env.OPENAI_EVIDENCE_MODEL);
}

function resolveNewestAssistantEvidenceFile(
  evidenceFiles: Array<{ id: string; fileId: string; file: { createdAt: Date; id: string } }>,
) {
  const newest = [...evidenceFiles].sort((left, right) => {
    const createdDiff = right.file.createdAt.getTime() - left.file.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    const fileIdDiff = right.file.id.localeCompare(left.file.id);
    if (fileIdDiff !== 0) return fileIdDiff;
    return right.id.localeCompare(left.id);
  })[0];
  return newest
    ? {
        evidenceFileId: newest.id,
        fileId: newest.fileId,
        createdAt: newest.file.createdAt,
      }
    : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableSort(child)]),
  );
}

function criterionLabel(criterion: Criterion) {
  const labels: Record<Criterion, string> = {
    ethics: 'Đạo đức tốt',
    academic: 'Học tập tốt',
    physical: 'Thể lực tốt',
    volunteer: 'Tình nguyện tốt',
    integration: 'Hội nhập tốt',
    priority: 'Thành tích ưu tiên',
    collective: 'Tập thể',
  };
  return labels[criterion];
}

function assertStudentOnly(user: AuthenticatedUser) {
  if (user.role !== Role.student) {
    throw new AppError(
      403,
      ErrorCodes.STUDENT_ASSISTANT_CONTEXT_FORBIDDEN,
      'Student assistant is restricted to student accounts',
    );
  }
}

function throwNotFound(): never {
  throw new AppError(
    404,
    ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
    'Student assistant context not found',
  );
}

function throwForbiddenOrNotFound(): never {
  throw new AppError(
    404,
    ErrorCodes.STUDENT_ASSISTANT_CONTEXT_NOT_FOUND,
    'Student assistant context not found',
  );
}
