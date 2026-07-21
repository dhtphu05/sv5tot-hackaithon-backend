import {
  ApplicationStatus,
  Criterion,
  EvidenceStatus,
  IndexingStatus,
  ReviewTaskStatus,
} from '@prisma/client';
import type { CriterionCompletionDto } from '../../criteria-completion/criteria-completion.types';
import type {
  AssistantDestination,
  CriterionAssistantSummary,
  StudentAssistantState,
  StudentNextBestAction,
} from './student-assistant.dto';

type AssistantEvidence = {
  id: string;
  evidenceName?: string | null;
  criterion: Criterion;
  status: EvidenceStatus;
  indexingStatus: IndexingStatus;
  evidenceCard?: {
    confirmationStatus?: string | null;
    requiresHumanConfirmation?: boolean | null;
  } | null;
};

type AssistantReviewTask = {
  id: string;
  criterion: Criterion;
  status: ReviewTaskStatus;
  dueDate?: Date | null;
  supplementRequestJson?: unknown;
};

type LatestPrecheck = {
  createdAt: Date;
  readinessScore: number;
  resultJson?: unknown;
  missingItemsJson?: unknown;
  nextBestAction?: string | null;
};

type VerifiedImportableEvent = {
  id: string;
  eventName: string;
  criterion: Criterion;
};

export type StudentAssistantPriorityInput = {
  application: {
    id: string;
    status: ApplicationStatus;
    targetLevel: string;
    readinessScore: number;
    evidences: AssistantEvidence[];
    reviewTasks: AssistantReviewTask[];
  } | null;
  completion: CriterionCompletionDto[];
  latestPrecheck: LatestPrecheck | null;
  precheckIsStale: boolean;
  verifiedImportableEvents?: VerifiedImportableEvent[];
  now?: Date;
};

export function resolveStudentNextBestAction(
  input: StudentAssistantPriorityInput,
): StudentNextBestAction | null {
  const application = input.application;
  if (!application) {
    return {
      id: 'start:current',
      type: 'start_application',
      priority: 9,
      title: 'Bắt đầu hồ sơ',
      deterministicDescription: 'Bạn chưa có hồ sơ Sinh viên 5 tốt cho năm học hiện tại.',
      ctaLabel: 'Bắt đầu hồ sơ',
      destination: { route: '/app/overview' },
      applicationId: 'current',
      urgency: 'normal',
      reasonCode: 'no_application',
    };
  }
  const now = input.now ?? new Date();

  const supplement = application.reviewTasks
    .filter((task) => task.status === ReviewTaskStatus.supplement_required)
    .sort((left, right) => compareDates(left.dueDate, right.dueDate))[0];
  if (supplement) {
    return {
      id: `supplement:${supplement.id}`,
      type: 'resolve_supplement',
      priority: 1,
      title: `Bổ sung ${criterionLabel(supplement.criterion)}`,
      deterministicDescription: 'Cán bộ đã gửi yêu cầu bổ sung chính thức cho hồ sơ.',
      ctaLabel: 'Bổ sung hồ sơ',
      destination: {
        route: '/app/application',
        query: {
          criterion: supplement.criterion,
          mode: 'supplement',
          reviewTaskId: supplement.id,
        },
      },
      applicationId: application.id,
      criterion: supplement.criterion,
      reviewTaskId: supplement.id,
      dueAt: supplement.dueDate?.toISOString(),
      urgency: supplementUrgency(supplement.dueDate, now),
      reasonCode: 'active_supplement_request',
    };
  }

  const failed = application.evidences.find(
    (evidence) =>
      evidence.indexingStatus === IndexingStatus.failed ||
      evidence.indexingStatus === IndexingStatus.needs_manual_review ||
      evidence.status === EvidenceStatus.rejected,
  );
  if (failed) {
    return {
      id: `evidence-recovery:${failed.id}`,
      type: 'retry_evidence_analysis',
      priority: 2,
      title: `Kiểm tra minh chứng ${failed.evidenceName ?? criterionLabel(failed.criterion)}`,
      deterministicDescription: 'Có minh chứng chưa được hệ thống đọc thành công.',
      ctaLabel: 'Mở minh chứng',
      destination: {
        route: '/app/application',
        query: { criterion: failed.criterion, evidenceId: failed.id, mode: 'recover' },
      },
      applicationId: application.id,
      criterion: failed.criterion,
      evidenceId: failed.id,
      urgency: 'important',
      reasonCode: 'evidence_analysis_failed',
    };
  }

  const confirmation = application.evidences.find((evidence) => needsConfirmation(evidence));
  if (confirmation) {
    return {
      id: `confirm-evidence:${confirmation.id}`,
      type: 'confirm_evidence',
      priority: 3,
      title: `Kiểm tra thông tin minh chứng ${confirmation.evidenceName ?? criterionLabel(confirmation.criterion)}`,
      deterministicDescription:
        'Minh chứng đã được đọc xong nhưng cần bạn xác nhận trước khi dùng để tiền kiểm.',
      ctaLabel: 'Kiểm tra minh chứng',
      destination: {
        route: '/app/application',
        query: { criterion: confirmation.criterion, evidenceId: confirmation.id, mode: 'confirm' },
      },
      applicationId: application.id,
      criterion: confirmation.criterion,
      evidenceId: confirmation.id,
      urgency: 'important',
      reasonCode: 'evidence_confirmation_required',
    };
  }

  const precheckAction = getPrecheckAction(input.latestPrecheck);
  if (precheckAction && !input.precheckIsStale && isBlockingPrecheckAction(precheckAction.type)) {
    const destination = destinationFromPrecheckAction(precheckAction);
    const label = stringValue(precheckAction.label) ?? 'Xử lý điểm cần chú ý';
    const criterion = criterionValue(precheckAction.criterion);
    const evidenceId = stringValue(precheckAction.evidenceId);
    return {
      id: `precheck:${stringValue(precheckAction.type) ?? 'action'}:${criterion ?? 'application'}:${evidenceId ?? stringValue(precheckAction.requirementKey) ?? 'action'}`,
      type: 'resolve_precheck_issue',
      priority: 4,
      title: label,
      deterministicDescription:
        stringValue(precheckAction.shortReason) ?? 'Kết quả tiền kiểm đang có mục cần xử lý.',
      ctaLabel: label,
      destination,
      applicationId: application.id,
      criterion,
      evidenceId,
      urgency: 'important',
      reasonCode: 'blocking_precheck_issue',
    };
  }

  const importable = firstImportableEvent(input.verifiedImportableEvents ?? [], input.completion);
  if (importable) {
    return {
      id: `import-event:${importable.id}`,
      type: 'import_event',
      priority: 5,
      title: `Thêm minh chứng từ ${importable.eventName}`,
      deterministicDescription:
        'Bạn có trong danh sách chính thức của một hoạt động phù hợp với tiêu chí còn thiếu.',
      ctaLabel: 'Nhập từ sự kiện',
      destination: {
        route: '/app/application',
        query: {
          criterion: importable.criterion,
          eventId: importable.id,
          mode: 'suggested-import',
        },
      },
      applicationId: application.id,
      criterion: importable.criterion,
      eventId: importable.id,
      urgency: 'normal',
      reasonCode: 'verified_event_import_available',
    };
  }

  const missing = input.completion.find((item) =>
    ['not_started', 'in_progress', 'precheck_warning'].includes(item.status),
  );
  if (missing) {
    return {
      id: `missing:${missing.criterion}:${missing.nextAction?.requirementKey ?? 'criterion'}`,
      type: 'add_evidence',
      priority: 5,
      title: missing.nextAction?.label ?? `Bổ sung ${criterionLabel(missing.criterion)}`,
      deterministicDescription:
        missing.nextAction?.label ?? 'Một tiêu chí bắt buộc vẫn cần thêm dữ liệu hoặc minh chứng.',
      ctaLabel: missing.nextAction?.label ?? 'Bổ sung',
      destination: {
        route: '/app/application',
        query: { criterion: missing.criterion },
      },
      applicationId: application.id,
      criterion: missing.criterion,
      urgency: 'normal',
      reasonCode: 'missing_required_criterion',
    };
  }

  if (input.latestPrecheck && input.precheckIsStale) {
    return {
      id: `rerun-precheck:${application.id}`,
      type: 'rerun_precheck',
      priority: 6,
      title: 'Chạy lại tiền kiểm',
      deterministicDescription: 'Hồ sơ đã thay đổi sau lần tiền kiểm gần nhất.',
      ctaLabel: 'Chạy lại tiền kiểm',
      destination: { route: '/app/application', query: { tab: 'precheck' } },
      applicationId: application.id,
      urgency: 'normal',
      reasonCode: 'precheck_stale',
    };
  }

  if (!input.latestPrecheck && application.evidences.length > 0) {
    return {
      id: `run-precheck:${application.id}`,
      type: 'run_precheck',
      priority: 7,
      title: 'Kiểm tra sơ bộ hồ sơ',
      deterministicDescription: 'Chạy tiền kiểm để biết hồ sơ còn thiếu hoặc cần xác minh mục nào.',
      ctaLabel: 'Kiểm tra hồ sơ',
      destination: { route: '/app/application', query: { tab: 'precheck' } },
      applicationId: application.id,
      urgency: 'normal',
      reasonCode: 'precheck_not_run',
    };
  }

  if (application.status === ApplicationStatus.ready_to_submit) {
    return {
      id: `submit:${application.id}`,
      type: 'submit_application',
      priority: 8,
      title: 'Nộp hồ sơ',
      deterministicDescription: 'Các tiêu chí bắt buộc hiện đã sẵn sàng cho bước nộp chính thức.',
      ctaLabel: 'Nộp hồ sơ',
      destination: { route: '/app/application', query: { action: 'submit' } },
      applicationId: application.id,
      urgency: 'normal',
      reasonCode: 'ready_to_submit',
    };
  }

  if (application.status === ApplicationStatus.under_review || application.status === ApplicationStatus.submitted) {
    return {
      id: `review-status:${application.id}`,
      type: 'view_review_status',
      priority: 10,
      title: 'Theo dõi trạng thái xét duyệt',
      deterministicDescription: 'Hồ sơ đã được gửi và đang trong quy trình xét duyệt.',
      ctaLabel: 'Xem trạng thái',
      destination: { route: '/app/application', query: { tab: 'tracking' } },
      applicationId: application.id,
      urgency: 'normal',
      reasonCode: 'application_under_review',
    };
  }

  if (application.status === ApplicationStatus.completed || application.status === ApplicationStatus.rejected) {
    return {
      id: `result:${application.id}`,
      type: 'view_result',
      priority: 11,
      title: 'Xem kết quả hồ sơ',
      deterministicDescription: 'Hồ sơ đã có kết quả chính thức trong hệ thống.',
      ctaLabel: 'Xem kết quả',
      destination: { route: '/app/application', query: { tab: 'tracking' } },
      applicationId: application.id,
      urgency: 'normal',
      reasonCode: 'application_completed',
    };
  }

  return {
    id: `continue:${application.id}`,
    type: 'continue_application',
    priority: 9,
    title: 'Tiếp tục hoàn thiện hồ sơ',
    deterministicDescription: 'Bạn có thể tiếp tục cập nhật thông tin và minh chứng cho hồ sơ.',
    ctaLabel: 'Mở hồ sơ',
    destination: { route: '/app/application' },
    applicationId: application.id,
    urgency: 'normal',
    reasonCode: 'draft_in_progress',
  };
}

function firstImportableEvent(
  events: VerifiedImportableEvent[],
  completion: CriterionCompletionDto[],
) {
  const missingCriteria = completion
    .filter((item) => ['not_started', 'in_progress', 'precheck_warning'].includes(item.status))
    .map((item) => item.criterion);
  if (!missingCriteria.length) return events[0] ?? null;
  return events.find((event) => missingCriteria.includes(event.criterion)) ?? null;
}

export function resolveAssistantState(input: StudentAssistantPriorityInput): StudentAssistantState {
  const application = input.application;
  if (!application) return 'new_user';
  if (application.status === ApplicationStatus.supplement_required) return 'supplement_required';
  if (application.status === ApplicationStatus.under_review || application.status === ApplicationStatus.submitted) {
    return 'under_review';
  }
  if (application.status === ApplicationStatus.completed || application.status === ApplicationStatus.rejected) {
    return 'completed';
  }
  if (application.evidences.some((evidence) => isProcessing(evidence))) return 'processing_evidence';
  if (application.evidences.some((evidence) => needsConfirmation(evidence))) {
    return 'evidence_confirmation_required';
  }
  if (application.status === ApplicationStatus.ready_to_submit) return 'ready_to_submit';
  if (input.completion.some((item) => ['needs_verification', 'precheck_warning', 'supplement_required'].includes(item.status))) {
    return 'needs_attention';
  }
  return 'draft_in_progress';
}

export function buildCriterionAssistantSummary(
  completion: CriterionCompletionDto[],
  evidences: AssistantEvidence[],
): CriterionAssistantSummary[] {
  return coreCriteria().map((criterion) => {
    const item = completion.find((candidate) => candidate.criterion === criterion);
    const criterionEvidence = evidences.filter((evidence) => evidence.criterion === criterion);
    let status: CriterionAssistantSummary['status'] = 'missing';
    if (criterionEvidence.some((evidence) => isProcessing(evidence))) status = 'processing';
    else if (criterionEvidence.some((evidence) => needsConfirmation(evidence))) status = 'needs_confirmation';
    else if (item?.status === 'ready_for_precheck' || item?.status === 'accepted') status = 'ready';
    else if (item?.status === 'under_review') status = 'under_review';
    else if (item?.status === 'needs_verification' || item?.status === 'precheck_warning' || item?.status === 'supplement_required') {
      status = 'needs_attention';
    }
    return { criterion, status, label: criterionLabel(criterion) };
  });
}

export function destinationFromPrecheckAction(action: Record<string, unknown>): AssistantDestination {
  const route = stringValue(action.destination) ?? stringValue(action.route) ?? '/app/application';
  const [baseRoute, queryString] = route.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString ?? ''));
  const criterion = stringValue(action.criterion);
  const evidenceId = stringValue(action.evidenceId);
  if (criterion) query.criterion = criterion;
  if (evidenceId) query.evidenceId = evidenceId;
  return {
    route: baseRoute || '/app/application',
    query: Object.keys(query).length ? query : undefined,
  };
}

function getPrecheckAction(precheck: LatestPrecheck | null): Record<string, unknown> | null {
  if (!precheck) return null;
  const result = asRecord(precheck.resultJson);
  return asRecord(result?.nextAction) ?? null;
}

function isBlockingPrecheckAction(type?: unknown) {
  return !['submit_application', 'rerun_precheck'].includes(String(type ?? ''));
}

function needsConfirmation(evidence: AssistantEvidence) {
  const status = evidence.evidenceCard?.confirmationStatus;
  return (
    evidence.evidenceCard?.requiresHumanConfirmation === true ||
    status === 'pending' ||
    status === 'correction_required'
  );
}

function isProcessing(evidence: AssistantEvidence) {
  return (
    evidence.status === EvidenceStatus.pending_indexing ||
    [
      IndexingStatus.pending_indexing,
      IndexingStatus.ocr_processing,
      IndexingStatus.extracting,
      IndexingStatus.checking_registry,
    ].includes(evidence.indexingStatus as never)
  );
}

function supplementUrgency(dueDate: Date | null | undefined, now: Date) {
  if (!dueDate) return 'normal' as const;
  const hours = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hours <= 24) return 'urgent' as const;
  if (hours <= 72) return 'important' as const;
  return 'normal' as const;
}

function compareDates(left?: Date | null, right?: Date | null) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.getTime() - right.getTime();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function criterionValue(value: unknown): Criterion | undefined {
  return Object.values(Criterion).includes(value as Criterion) ? (value as Criterion) : undefined;
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

function coreCriteria(): Criterion[] {
  return [
    Criterion.ethics,
    Criterion.academic,
    Criterion.physical,
    Criterion.volunteer,
    Criterion.integration,
  ];
}
