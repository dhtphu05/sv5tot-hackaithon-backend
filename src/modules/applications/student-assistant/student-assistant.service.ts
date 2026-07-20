import { Criterion, Role } from '@prisma/client';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { sha256 } from '../../../shared/utils/hash';
import { normalizeSchoolYear } from '../../../shared/utils/school-year';
import type { AuthenticatedUser } from '../../../shared/types/auth';
import { AppError } from '../../../shared/errors/app-error';
import { ErrorCodes } from '../../../shared/errors/error-codes';
import { isApplicationPrecheckStale } from '../application-freshness';
import { evaluateCriterionCompletion } from '../../criteria-completion/criteria-completion.evaluator';
import type { CompletionEvidence, CompletionResponse, CriterionCompletionDto } from '../../criteria-completion/criteria-completion.types';
import { buildRequirementGroupsByCriterion } from '../../criteria-completion/criteria-requirement.parser';
import { coreCriteria } from '../../rules/criteria.constants';
import { loadCriteriaRules } from '../../rules/criteria.loader';
import { StudentAssistantContextCache } from './student-assistant-cache';
import type {
  AssistantStreamEventCallbacks,
  StudentAssistantContext,
} from './student-assistant.dto';
import {
  buildCriterionAssistantSummary,
  resolveAssistantState,
  resolveStudentNextBestAction,
} from './student-assistant-priority';
import {
  createAssistantNarrativeProvider,
  validateFinalNarrative,
} from './student-assistant-narrative';
import {
  StudentAssistantRepository,
  type StudentAssistantApplication,
} from './student-assistant.repository';

const assistantCache = new StudentAssistantContextCache(env.ASSISTANT_NARRATIVE_CACHE_TTL_MS);

export class StudentAssistantService {
  constructor(
    private readonly repository = new StudentAssistantRepository(),
    private readonly narrativeProvider = createAssistantNarrativeProvider(),
    private readonly cache = assistantCache,
  ) {}

  async getCurrentContext(user: AuthenticatedUser, schoolYear?: string) {
    assertStudent(user);
    const normalizedSchoolYear = normalizeSchoolYear(schoolYear);
    const application = await this.repository.findCurrentApplication(user.id, normalizedSchoolYear);
    const completion = application ? await this.buildCompletion(application) : [];
    const latestPrecheck = application?.precheckResults[0] ?? null;
    const precheckIsStale = application
      ? isApplicationPrecheckStale(application, latestPrecheck?.createdAt)
      : false;
    const priorityInput = {
      application: application
        ? {
            id: application.id,
            status: application.status,
            targetLevel: application.targetLevel,
            readinessScore: application.readinessScore,
            evidences: application.evidences,
            reviewTasks: application.reviewTasks,
          }
        : null,
      completion,
      latestPrecheck,
      precheckIsStale,
    };
    const nextBestAction = resolveStudentNextBestAction(priorityInput);
    const state = resolveAssistantState(priorityInput);
    const criterionSummary = buildCriterionAssistantSummary(completion, application?.evidences ?? []);
    const fallbackText = buildFallbackNarrative(state, nextBestAction);
    const versionInput = {
      state,
      application: application
        ? {
            id: application.id,
            status: application.status,
            targetLevel: application.targetLevel,
            readinessScore: application.readinessScore,
            latestPrecheckCreatedAt: latestPrecheck?.createdAt?.toISOString() ?? null,
            precheckIsStale,
          }
        : null,
      action: nextBestAction,
      criterionSummary,
      evidenceStates:
        application?.evidences.map((evidence) => ({
          id: evidence.id,
          criterion: evidence.criterion,
          status: evidence.status,
          indexingStatus: evidence.indexingStatus,
          confirmationStatus: evidence.evidenceCard?.confirmationStatus ?? null,
          requiresHumanConfirmation: evidence.evidenceCard?.requiresHumanConfirmation ?? null,
        })) ?? [],
      supplements:
        application?.reviewTasks.map((task) => ({
          id: task.id,
          criterion: task.criterion,
          status: task.status,
          dueDate: task.dueDate?.toISOString() ?? null,
        })) ?? [],
    };
    const contextVersion = sha256(JSON.stringify(stableSort(versionInput))).slice(0, 32);
    const context: StudentAssistantContext = {
      contextVersion,
      generatedAt: new Date().toISOString(),
      state,
      greeting: {
        title: greetingTitle(application?.student.fullName),
        deterministicMessage: greetingMessage(state, application?.targetLevel ?? null),
      },
      application: {
        id: application?.id ?? null,
        status: application?.status ?? 'not_started',
        targetLevel: application?.targetLevel ?? null,
        readinessScore: application?.readinessScore ?? null,
        precheckIsStale,
      },
      criterionSummary,
      nextBestAction,
      secondaryInsights: buildSecondaryInsights(application, nextBestAction?.id),
      narrative: {
        streamingAvailable: env.ASSISTANT_NARRATIVE_PROVIDER !== 'disabled',
        fallbackText,
        streamEndpoint: `/api/applications/current/assistant-context/stream?schoolYear=${normalizedSchoolYear}&contextVersion=${contextVersion}`,
        cacheKey: contextVersion,
      },
    };
    this.cache.setContext(cacheKey(user.id, normalizedSchoolYear, contextVersion), context);
    return context;
  }

  async streamCurrentNarrative(
    user: AuthenticatedUser,
    input: { schoolYear?: string; contextVersion: string; signal?: AbortSignal; requestId: string },
    callbacks: AssistantStreamEventCallbacks,
  ) {
    assertStudent(user);
    const normalizedSchoolYear = normalizeSchoolYear(input.schoolYear);
    const key = cacheKey(user.id, normalizedSchoolYear, input.contextVersion);
    const cached = this.cache.get(key);
    if (!cached) {
      await callbacks.onError({ code: ErrorCodes.ASSISTANT_CONTEXT_STALE, recoverable: true });
      return;
    }
    await callbacks.onMeta({
      contextVersion: cached.context.contextVersion,
      requestId: input.requestId,
      cached: Boolean(cached.narrative),
    });
    await callbacks.onStatus({ stage: 'preparing_explanation' });
    if (cached.narrative) {
      await callbacks.onComplete({ text: cached.narrative, contextVersion: cached.context.contextVersion });
      return;
    }

    const startedAt = Date.now();
    try {
      logger.info(
        {
          applicationId: cached.context.application.id,
          contextVersion: cached.context.contextVersion,
          actionType: cached.context.nextBestAction?.type,
          reasonCode: cached.context.nextBestAction?.reasonCode,
        },
        'Student assistant narrative generation started',
      );
      const generated = await this.narrativeProvider.stream(cached.context, {
        signal: input.signal,
        onDelta: (delta) => callbacks.onDelta(delta),
      });
      const finalText = validateFinalNarrative(generated.text, cached.context.narrative.fallbackText);
      this.cache.setNarrative(key, finalText);
      await callbacks.onComplete({ text: finalText, contextVersion: cached.context.contextVersion });
      logger.info(
        {
          applicationId: cached.context.application.id,
          contextVersion: cached.context.contextVersion,
          actionType: cached.context.nextBestAction?.type,
          reasonCode: cached.context.nextBestAction?.reasonCode,
          model: generated.model,
          totalTokens: generated.totalTokens,
          latencyMs: Date.now() - startedAt,
        },
        'Student assistant narrative generation completed',
      );
    } catch {
      await callbacks.onError({ code: ErrorCodes.ASSISTANT_NARRATIVE_FAILED, recoverable: true });
      logger.warn(
        {
          applicationId: cached.context.application.id,
          contextVersion: cached.context.contextVersion,
          actionType: cached.context.nextBestAction?.type,
          reasonCode: cached.context.nextBestAction?.reasonCode,
          latencyMs: Date.now() - startedAt,
        },
        'Student assistant narrative generation failed',
      );
    }
  }

  private async buildCompletion(application: StudentAssistantApplication): Promise<CriterionCompletionDto[]> {
    const criteria = await loadCriteriaRules({
      workspaceId: application.workspaceId,
      schoolYear: application.schoolYear,
      level: application.targetLevel,
    });
    const groupsByCriterion = buildRequirementGroupsByCriterion(criteria.rules);
    const responses = application.requirementResponses as CompletionResponse[];
    return coreCriteria.map((criterion) =>
      evaluateCriterionCompletion({
        criterion,
        title: criterionTitle(criterion),
        description: `Điều kiện hoàn thiện cho tiêu chí ${criterionTitle(criterion)}.`,
        groups: groupsByCriterion[criterion] ?? [],
        metrics: application.metrics,
        evidences: application.evidences as CompletionEvidence[],
        responses: responses.filter((response) => response.criterion === criterion),
        reviewStatus: application.reviewTasks.find((task) => task.criterion === criterion)?.status,
        evidenceCount: application.evidences.filter((evidence) => evidence.criterion === criterion)
          .length,
        schoolYear: application.schoolYear,
      }),
    );
  }
}

function assertStudent(user: AuthenticatedUser) {
  if (user.role !== Role.student) {
    throw new AppError(403, ErrorCodes.FORBIDDEN, 'Student assistant context is restricted to students');
  }
}

function buildFallbackNarrative(
  state: StudentAssistantContext['state'],
  action: StudentAssistantContext['nextBestAction'],
) {
  if (!action) return 'Hiện chưa có việc cần xử lý ngay. Bạn có thể quay lại khi hồ sơ có cập nhật mới.';
  if (action.type === 'confirm_evidence') {
    return 'Minh chứng đã được đọc xong nhưng vẫn cần bạn kiểm tra thông tin. Xác nhận dữ liệu này để lần tiền kiểm tiếp theo phản ánh đúng hồ sơ hiện tại.';
  }
  if (action.type === 'resolve_supplement') {
    return 'Hồ sơ đang có yêu cầu bổ sung chính thức. Hãy xử lý mục này trước để cán bộ có đủ thông tin tiếp tục xét duyệt.';
  }
  if (action.type === 'submit_application') {
    return 'Các tiêu chí bắt buộc hiện đã sẵn sàng. Bạn có thể xem lại hồ sơ một lần cuối trước khi nộp cho cán bộ xét duyệt.';
  }
  if (state === 'under_review') {
    return 'Hồ sơ đã được gửi và đang trong quy trình xét duyệt. Bạn có thể theo dõi trạng thái hoặc phản hồi khi có yêu cầu mới.';
  }
  return action.deterministicDescription;
}

function greetingTitle(fullName?: string | null) {
  const first = String(fullName ?? '').trim().split(/\s+/).slice(-1)[0];
  return first ? `Xin chào, ${first}` : 'Xin chào';
}

function greetingMessage(state: StudentAssistantContext['state'], level: string | null) {
  const levelCopy = level ? `Hồ sơ ${levelLabel(level)}` : 'Hồ sơ Sinh viên 5 tốt';
  if (state === 'new_user') return 'Bắt đầu hồ sơ để hệ thống hướng dẫn từng bước cần hoàn thiện.';
  return `${levelCopy} đang được theo dõi theo trạng thái mới nhất trong hệ thống.`;
}

function buildSecondaryInsights(
  application: StudentAssistantApplication | null,
  primaryActionId?: string,
): StudentAssistantContext['secondaryInsights'] {
  if (!application) return [];
  return application.evidences
    .filter((evidence) =>
      ['pending_indexing', 'ocr_processing', 'extracting', 'checking_registry'].includes(
        evidence.indexingStatus,
      ),
    )
    .map((evidence) => ({
      id: `processing:${evidence.id}`,
      type: 'processing_evidence',
      title: `Đang đọc minh chứng ${evidence.evidenceName ?? criterionTitle(evidence.criterion)}`,
      destination: {
        route: '/app/application',
        query: { criterion: evidence.criterion, evidenceId: evidence.id },
      },
    }))
    .filter((item) => item.id !== primaryActionId)
    .slice(0, 3);
}

function cacheKey(userId: string, schoolYear: string, contextVersion: string) {
  return `${userId}:${schoolYear}:${contextVersion}`;
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableSort(item)]),
  );
}

function criterionTitle(criterion: Criterion) {
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

function levelLabel(level: string) {
  const labels: Record<string, string> = {
    school: 'cấp Trường',
    university: 'cấp ĐHĐN',
    city: 'cấp Thành phố',
    central: 'cấp Trung ương',
  };
  return labels[level] ?? level;
}
