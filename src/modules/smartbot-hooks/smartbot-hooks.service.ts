import { randomUUID } from 'crypto';
import { Criterion } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import type {
  ApplicationToolInput,
  EventSearchToolInput,
  EvidenceToolInput,
  HandoffToolInput,
  ReviewerDraftToolInput,
} from './smartbot-hooks.validation';

export type SmartbotHookResponse = {
  success: true;
  set_variables: Record<string, string>;
};

export class SmartbotHooksService {
  async applicationStatus(input: ApplicationToolInput): Promise<SmartbotHookResponse> {
    const applicationId = input.applicationId ?? input.application_id;
    const app = applicationId
      ? await prisma.application.findUnique({
          where: { id: applicationId },
          select: {
            id: true,
            status: true,
            targetLevel: true,
            schoolYear: true,
            readinessScore: true,
            evidences: { select: { id: true }, take: 20 },
          },
        })
      : null;

    if (!app) {
      return setVariables({
        found: 'false',
        status_text: 'Không tìm thấy hồ sơ trong ngữ cảnh an toàn.',
      });
    }

    return setVariables({
      found: 'true',
      application_id: app.id,
      application_status: app.status,
      target_level: app.targetLevel,
      school_year: app.schoolYear,
      readiness_score: String(Math.round(app.readinessScore)),
      evidence_count: String(app.evidences.length),
      status_text: `Hồ sơ ${app.status}, aim ${app.targetLevel}, năm học ${app.schoolYear}.`,
    });
  }

  async precheckSummary(input: ApplicationToolInput): Promise<SmartbotHookResponse> {
    const applicationId = input.applicationId ?? input.application_id;
    const precheck = applicationId
      ? await prisma.precheckResult.findFirst({
          where: { applicationId },
          orderBy: { createdAt: 'desc' },
          select: {
            readinessScore: true,
            missingItemsJson: true,
            nextBestAction: true,
          },
        })
      : null;
    const missingCount = Array.isArray(precheck?.missingItemsJson) ? precheck.missingItemsJson.length : 0;

    return setVariables({
      found: precheck ? 'true' : 'false',
      readiness_score: precheck ? String(Math.round(precheck.readinessScore)) : '',
      missing_count: String(missingCount),
      next_best_action: precheck?.nextBestAction ?? '',
      summary_text: precheck
        ? `Tiền kiểm gần nhất ghi nhận ${missingCount} mục cần kiểm tra hoặc bổ sung.`
        : 'Chưa có kết quả tiền kiểm gần nhất.',
    });
  }

  async cascadeSummary(input: ApplicationToolInput): Promise<SmartbotHookResponse> {
    const applicationId = input.applicationId ?? input.application_id;
    const cascade = applicationId
      ? await prisma.cascadeReview.findFirst({
          where: { applicationId },
          orderBy: { createdAt: 'desc' },
          select: {
            targetLevel: true,
            suggestedLevel: true,
            humanConfirmationRequired: true,
          },
        })
      : null;

    return setVariables({
      found: cascade ? 'true' : 'false',
      target_level: cascade?.targetLevel ?? '',
      suggested_level: cascade?.suggestedLevel ?? '',
      human_confirmation_required: cascade ? String(cascade.humanConfirmationRequired) : '',
      summary_text: cascade
        ? 'Có cascade review để tham khảo. Kết quả chính thức vẫn cần cán bộ/Hội đồng xác nhận.'
        : 'Chưa có cascade review gần nhất.',
    });
  }

  async evidenceCardSummary(input: EvidenceToolInput): Promise<SmartbotHookResponse> {
    const evidenceId = input.evidenceId ?? input.evidence_id;
    const evidence = evidenceId
      ? await prisma.evidence.findUnique({
          where: { id: evidenceId },
          select: {
            id: true,
            evidenceName: true,
            criterion: true,
            status: true,
            indexingStatus: true,
            confidence: true,
            evidenceCard: {
              select: {
                aiSummary: true,
                warningsJson: true,
              },
            },
          },
        })
      : null;
    const warningCount = Array.isArray(evidence?.evidenceCard?.warningsJson)
      ? evidence.evidenceCard.warningsJson.length
      : 0;

    return setVariables({
      found: evidence ? 'true' : 'false',
      evidence_id: evidence?.id ?? '',
      criterion: evidence?.criterion ?? '',
      evidence_status: evidence?.status ?? '',
      indexing_status: evidence?.indexingStatus ?? '',
      warning_count: String(warningCount),
      confidence: evidence?.confidence === null || evidence?.confidence === undefined ? '' : String(evidence.confidence),
      summary_text: evidence
        ? evidence.evidenceCard?.aiSummary?.slice(0, 500) ??
          `${evidence.evidenceName}: ${evidence.indexingStatus}, ${warningCount} cảnh báo.`
        : 'Không tìm thấy minh chứng.',
    });
  }

  async eventSearch(input: EventSearchToolInput): Promise<SmartbotHookResponse> {
    const criterion = parseCriterion(input.criterion);
    const events = await prisma.eventRegistry.findMany({
      where: {
        ...(criterion ? { criterion } : {}),
        ...(input.query ? { eventName: { contains: input.query, mode: 'insensitive' } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        eventName: true,
        criterion: true,
        convertedValue: true,
        convertedUnit: true,
      },
    });

    return setVariables({
      found: events.length ? 'true' : 'false',
      result_count: String(events.length),
      event_ids: events.map((event) => event.id).join(','),
      summary_text: events.length
        ? events
            .map((event) =>
              `${event.eventName} (${event.criterion}, ${event.convertedValue ?? ''} ${event.convertedUnit ?? ''})`.trim(),
            )
            .join(' | ')
            .slice(0, 1000)
        : 'Chưa tìm thấy sự kiện phù hợp.',
    });
  }

  async reviewerDraftResponse(input: ReviewerDraftToolInput): Promise<SmartbotHookResponse> {
    const taskId = input.taskId ?? input.task_id;
    const task = taskId
      ? await prisma.reviewTask.findUnique({
          where: { id: taskId },
          select: { id: true, criterion: true, status: true },
        })
      : null;

    return setVariables({
      found: task ? 'true' : 'false',
      task_id: task?.id ?? '',
      criterion: task?.criterion ?? '',
      task_status: task?.status ?? '',
      draft_text: task
        ? [
            'Sinh viên vui lòng bổ sung hoặc làm rõ minh chứng cho tiêu chí',
            task.criterion,
            input.reason ? `Lý do tham khảo: ${input.reason}` : '',
            'Cán bộ cần kiểm tra/chỉnh sửa trước khi gửi.',
          ]
            .filter(Boolean)
            .join(' ')
        : 'Chưa có review task trong ngữ cảnh an toàn để soạn yêu cầu.',
    });
  }

  async createHandoffTicket(input: HandoffToolInput): Promise<SmartbotHookResponse> {
    const userId = input.userId ?? input.user_id ?? extractUserId(input.sender_id);
    if (!userId) {
      return setVariables({
        created: 'false',
        status: 'missing_user_context',
        message: 'Thiếu userId an toàn để tạo handoff.',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) {
      return setVariables({
        created: 'false',
        status: 'user_not_found',
        message: 'Không tìm thấy người dùng cho handoff.',
      });
    }

    const sessionId = input.sessionId ?? input.session_id ?? randomUUID();
    await prisma.chatSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        userId: user.id,
        role: user.role,
        applicationId: input.applicationId ?? input.application_id,
        reviewTaskId: input.reviewTaskId ?? input.review_task_id,
        resolutionCaseId: input.resolutionCaseId ?? input.resolution_case_id,
        providerSessionId: sessionId,
        contextScope: 'smartbot_handoff',
      },
      update: { status: 'active' },
    });
    const handoff = await prisma.chatbotHandoff.create({
      data: {
        sessionId,
        userId: user.id,
        applicationId: input.applicationId ?? input.application_id,
        reviewTaskId: input.reviewTaskId ?? input.review_task_id,
        resolutionCaseId: input.resolutionCaseId ?? input.resolution_case_id,
        reason: input.reason ?? 'Smartbot requested human handoff',
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: auditActions.CHATBOT_HANDOFF_CREATED,
        targetType: 'chatbot_handoff',
        targetId: handoff.id,
        applicationId: input.applicationId ?? input.application_id,
        afterStateJson: { status: handoff.status },
        note: 'Created from Smartbot webhook tool',
      },
    });

    return setVariables({
      created: 'true',
      handoff_id: handoff.id,
      handoff_status: handoff.status,
      message: 'Đã tạo ticket/handoff cho cán bộ hỗ trợ.',
    });
  }
}

function setVariables(setVariablesInput: Record<string, unknown>): SmartbotHookResponse {
  return {
    success: true,
    set_variables: Object.fromEntries(
      Object.entries(setVariablesInput).map(([key, value]) => [
        key,
        value === undefined || value === null ? '' : String(value),
      ]),
    ),
  };
}

function parseCriterion(value?: string): Criterion | undefined {
  if (!value) return undefined;
  return Object.values(Criterion).includes(value as Criterion) ? (value as Criterion) : undefined;
}

function extractUserId(senderId?: string): string | undefined {
  const value = senderId?.startsWith('fivetot_') ? senderId.slice('fivetot_'.length) : undefined;
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}
