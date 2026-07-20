// Owns AI-assisted precheck orchestration results for applications.
import {
  ApplicationStatus,
  Criterion,
  EvidenceStatus,
  EvidenceSourceType,
  IndexingStatus,
  Role,
  ReviewTaskStatus,
  type Application,
  type User,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { facultyMatches } from '../../shared/utils/faculty';
import { createApplicationAudit } from '../applications/application.helpers';
import { evaluateCriterionCompletion } from '../criteria-completion/criteria-completion.evaluator';
import type {
  CompletionEvidence,
  CompletionResponse,
  CriterionCompletionDto,
  CriterionCompletionStatus,
  RequirementDto,
} from '../criteria-completion/criteria-completion.types';
import {
  buildRequirementGroupsByCriterion,
  criterionTitle,
} from '../criteria-completion/criteria-requirement.parser';
import { coreCriteria } from '../rules/criteria.constants';
import { loadCriteriaRules, toJsonValue } from '../rules/criteria.loader';
import type { RuleContext } from '../rules/rules.types';
import type {
  PrecheckCriterionResultDto,
  PrecheckMissingRequirementDto,
  PrecheckNextActionDto,
  PrecheckResponseDto,
} from './precheck.dto';
import { PrecheckRepository } from './precheck.repository';
import type { RunPrecheckInput } from './precheck.validation';

export class PrecheckService {
  constructor(private readonly precheckRepository = new PrecheckRepository()) {}

  async run(user: AuthenticatedUser, applicationId: string, input: RunPrecheckInput) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, false);
    const level = input.level ?? application.targetLevel;
    const criteria = await loadCriteriaRules({
      workspaceId: application.workspaceId,
      schoolYear: application.schoolYear,
      level,
    });
    const completion = buildCompletionSnapshot(application, criteria.rules);
    const result = buildPrecheckFromCompletion({
      application,
      level,
      completion,
      criteriaWarnings: criteria.warnings,
    });

    const created = await prisma.$transaction(async (tx) => {
      const saved = await tx.precheckResult.create({
        data: {
          applicationId: application.id,
          readinessScore: result.readinessScore,
          missingItemsJson: toJsonValue(result.missingItems),
          nextBestAction: result.nextBestAction,
          resultJson: toJsonValue({
            ...result,
            criteriaVersion: criteria,
            completion,
            note: 'Kết quả là gợi ý tiền kiểm, không phải quyết định xét duyệt cuối cùng.',
          }),
        },
      });

      const nextStatus = getNextPrecheckStatus(application.status, result.readyToSubmit);
      await tx.application.update({
        where: { id: application.id },
        data: {
          readinessScore: result.readinessScore,
          ...(nextStatus ? { status: nextStatus } : {}),
        },
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.PRECHECK_COMPLETED,
        targetType: 'precheck_result',
        targetId: saved.id,
        applicationId: application.id,
        afterStateJson: {
          level,
          readinessScore: result.readinessScore,
          missingCount: result.missingItems.length,
          readyToSubmit: result.readyToSubmit,
          criteriaVersionId: criteria.criteriaVersionId,
          status: nextStatus ?? application.status,
        },
        note: `Precheck ${level}: readinessScore=${result.readinessScore}, missing=${result.missingItems.length}`,
      });

      await createApplicationAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        workspaceId: application.workspaceId,
        action: auditActions.APPLICATION_READINESS_UPDATED,
        targetType: 'application',
        targetId: application.id,
        applicationId: application.id,
        beforeStateJson: { readinessScore: application.readinessScore, status: application.status },
        afterStateJson: {
          readinessScore: result.readinessScore,
          status: nextStatus ?? application.status,
        },
      });

      return saved;
    });

    return {
      applicationId: application.id,
      level,
      readinessScore: result.readinessScore,
      readyToSubmit: result.readyToSubmit,
      criteriaResults: result.criteriaResults,
      missingItems: result.missingItems,
      warnings: result.warnings,
      nextBestAction: result.nextBestAction,
      nextAction: result.nextAction,
      humanConfirmationRequired: true,
      createdAt: created.createdAt,
    };
  }

  async getLatest(user: AuthenticatedUser, applicationId: string) {
    const application = await this.getApplication(applicationId);
    assertPrecheckAccess(application, user, true);
    const latest = await this.precheckRepository.findLatest(application.id);
    if (!latest) return null;

    const result = latest.resultJson as Partial<PrecheckResponseDto>;
    const missingItems = Array.isArray(result.missingItems)
      ? result.missingItems
      : Array.isArray(latest.missingItemsJson)
        ? latest.missingItemsJson
        : [];
    return {
      applicationId: application.id,
      level: result.level ?? application.targetLevel,
      readinessScore: result.readinessScore ?? latest.readinessScore,
      readyToSubmit: Boolean(result.readyToSubmit),
      criteriaResults: Array.isArray(result.criteriaResults) ? result.criteriaResults : [],
      missingItems,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      nextBestAction: result.nextBestAction ?? latest.nextBestAction ?? '',
      nextAction: result.nextAction ?? null,
      humanConfirmationRequired: true,
      createdAt: latest.createdAt,
    };
  }

  private async getApplication(applicationId: string) {
    const application = await this.precheckRepository.findApplicationContext(applicationId);
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }
}

type PrecheckApplication = Awaited<ReturnType<PrecheckRepository['findApplicationContext']>> & {};

function buildCompletionSnapshot(
  application: NonNullable<PrecheckApplication>,
  criteriaRules: RuleContext['criteriaRules'],
): CriterionCompletionDto[] {
  const groupsByCriterion = buildRequirementGroupsByCriterion(criteriaRules);
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

export function buildPrecheckFromCompletion(input: {
  application: NonNullable<PrecheckApplication>;
  level: NonNullable<PrecheckApplication>['targetLevel'];
  completion: CriterionCompletionDto[];
  criteriaWarnings: string[];
}): Omit<PrecheckResponseDto, 'createdAt'> {
  const failedEvidenceAction = buildFailedEvidenceAction(input.application);
  const supplementAction = buildSupplementAction(input.application);
  const criteriaResults = input.completion.map(buildCriterionPrecheckResult);
  const missingItems = criteriaResults.flatMap((item) => item.missingRequirements);
  const needsVerificationItems = criteriaResults.flatMap((item) => item.needsVerification);
  const warnings = [
    ...input.criteriaWarnings,
    ...criteriaResults.flatMap((item) => item.warnings),
    ...(failedEvidenceAction ? [failedEvidenceAction.shortReason] : []),
  ];
  const completionAction = criteriaResults
    .flatMap((item) => (item.nextAction ? [item.nextAction] : []))
    .sort((left, right) => left.priority - right.priority)[0];
  const nextAction =
    supplementAction ?? completionAction ?? failedEvidenceAction ?? buildSubmitOrPrecheckAction(input.completion);
  const readinessScore = scoreCompletion(input.completion);
  const hasBlockingGaps = missingItems.length > 0 || warnings.length > 0;
  const hasPendingVerification = needsVerificationItems.length > 0;
  const readyToSubmit = !hasBlockingGaps && !hasPendingVerification;

  return {
    applicationId: input.application.id,
    level: input.level,
    readinessScore,
    readyToSubmit,
    criteriaResults,
    missingItems,
    warnings,
    nextBestAction: nextAction?.label ?? 'Chạy tiền kiểm lại sau khi cập nhật hồ sơ.',
    nextAction,
    humanConfirmationRequired: true,
  };
}

function buildCriterionPrecheckResult(item: CriterionCompletionDto): PrecheckCriterionResultDto {
  const requirements = item.requirementGroups.flatMap((group) => group.requirements);
  const satisfiedRequirements = requirements
    .filter((requirement) =>
      ['declared', 'needs_verification', 'verified'].includes(requirement.status),
    )
    .map((requirement) => requirement.key);
  const missingRequirements = item.requirementGroups.flatMap((group) =>
    buildGroupMissingRequirements(item.criterion, group),
  );
  const needsVerification = item.requirementGroups.flatMap((group) =>
    buildGroupNeedsVerification(item.criterion, group),
  );
  const oneOfAction = buildOneOfPathAction(item);
  const nextAction =
    missingRequirements[0]?.action ??
    needsVerification[0]?.action ??
    oneOfAction ??
    (item.nextAction ? normalizeCompletionAction(item, 2, 'Cần bổ sung') : null);

  return {
    criterion: item.criterion,
    status: item.status,
    label: precheckStatusLabel(item.status),
    requirementGroups: item.requirementGroups,
    satisfiedRequirements,
    missingRequirements,
    needsVerification,
    warnings: buildCriterionWarnings(item),
    nextAction,
    humanConfirmationRequired: true,
  };
}

function buildGroupMissingRequirements(
  criterion: Criterion,
  group: CriterionCompletionDto['requirementGroups'][number],
): PrecheckMissingRequirementDto[] {
  if (group.optional) return [];
  const requirements = group.requirements.filter((requirement) => !requirement.optional);
  if (group.operator === 'one_of') {
    const active = requirements.filter((requirement) => requirement.status !== 'not_started');
    if (active.length === 0) return [];
    return active
      .filter((requirement) => requirement.status === 'rejected')
      .map((requirement) => buildMissingRequirement(criterion, requirement));
  }
  return requirements
    .filter((requirement) => requirement.status === 'not_started' || requirement.status === 'rejected')
    .map((requirement) => buildMissingRequirement(criterion, requirement));
}

function buildGroupNeedsVerification(
  criterion: Criterion,
  group: CriterionCompletionDto['requirementGroups'][number],
): PrecheckMissingRequirementDto[] {
  if (group.optional) return [];
  const requirements = group.requirements.filter((requirement) => !requirement.optional);
  const pending = requirements.filter(
    (requirement) => requirement.status === 'needs_verification' || requirement.status === 'declared',
  );
  if (group.operator === 'one_of') {
    if (requirements.some((requirement) => requirement.status === 'verified')) return [];
    return pending.map((requirement) => buildMissingRequirement(criterion, requirement, true));
  }
  return pending.map((requirement) => buildMissingRequirement(criterion, requirement, true));
}

function buildMissingRequirement(
  criterion: Criterion,
  requirement: RequirementDto,
  needsVerification = false,
): PrecheckMissingRequirementDto {
  const reason = needsVerification
    ? 'Cần xác minh'
    : requirement.status === 'rejected'
      ? 'Cần bổ sung'
      : 'Chưa có dữ liệu';
  return {
    criterion,
    requirementKey: requirement.key,
    title: requirement.title,
    status: requirement.status,
    reason,
    action: {
      type: requirement.nextAction?.type ?? (needsVerification ? 'verify_requirement' : 'complete_requirement'),
      label: needsVerification
        ? (verificationActionLabel(requirement) ?? requirement.nextAction?.label ?? reason)
        : (requirement.nextAction?.label ?? reason),
      shortReason: `${requirement.title}: ${reason}`,
      criterion,
      requirementKey: requirement.key,
      route: '/app/application',
      priority: needsVerification ? 3 : 2,
    },
  };
}

function verificationActionLabel(requirement: RequirementDto): string | null {
  const labels: Record<string, string> = {
    conduct_score: 'Tải bảng điểm rèn luyện để xác minh',
    academic_gpa: 'Tải bảng điểm để xác minh GPA',
    physical_course_result: 'Chờ xác minh điểm Giáo dục thể chất',
    accumulated_volunteer_days: 'Tải giấy xác nhận của đơn vị tổ chức',
    activity_count: 'Tải giấy xác nhận của đơn vị tổ chức',
    skills_or_union_training: 'Tải giấy xác nhận khóa tập huấn',
    international_exchange: 'Bổ sung cấp tổ chức của hoạt động giao lưu',
    foreign_language: 'Bổ sung ngày cấp chứng chỉ',
  };
  return labels[requirement.key] ?? null;
}

function normalizeCompletionAction(
  item: CriterionCompletionDto,
  priority: number,
  shortReason: string,
): PrecheckNextActionDto | null {
  if (!item.nextAction) return null;
  return {
    type: item.nextAction.type,
    label: item.nextAction.label,
    shortReason,
    criterion: item.criterion,
    requirementKey: item.nextAction.requirementKey,
    route: item.nextAction.route ?? '/app/application',
    priority,
  };
}

function buildOneOfPathAction(item: CriterionCompletionDto): PrecheckNextActionDto | null {
  const group = item.requirementGroups.find(
    (candidate) =>
      candidate.operator === 'one_of' &&
      !candidate.optional &&
      candidate.requirements.every((requirement) => requirement.status === 'not_started'),
  );
  if (!group) return null;
  const requirement = group.requirements[0];
  return {
    type: item.nextAction?.type ?? 'choose_requirement_path',
    label: item.nextAction?.label ?? requirement?.nextAction?.label ?? 'Chọn hình thức đáp ứng',
    shortReason: 'Chưa chọn path trong nhóm thay thế',
    criterion: item.criterion,
    requirementKey: group.key,
    route: '/app/application',
    priority: 4,
  };
}

function buildCriterionWarnings(item: CriterionCompletionDto): string[] {
  const warnings: string[] = [];
  if (item.status === 'precheck_warning') {
    warnings.push('Chưa đáp ứng ngưỡng dữ liệu hiện tại');
  }
  if (item.status === 'supplement_required') {
    warnings.push('Có yêu cầu bổ sung chính thức');
  }
  return warnings;
}

function buildSupplementAction(
  application: NonNullable<PrecheckApplication>,
): PrecheckNextActionDto | null {
  const task = application.reviewTasks.find(
    (item) => item.status === ReviewTaskStatus.supplement_required,
  );
  if (!task) return null;
  const metadata = parseRecord(task.supplementRequestJson);
  const requirementKey =
    stringValue(metadata.requirementKey) ??
    stringValue(metadata.requirement_key) ??
    stringValue(metadata.requirement);
  return {
    type: 'resolve_supplement_request',
    label: requirementKey
      ? `Bổ sung theo yêu cầu cán bộ cho ${requirementKey}`
      : `Bổ sung theo yêu cầu cán bộ cho ${criterionTitle(task.criterion)}`,
    shortReason: 'Có yêu cầu bổ sung chính thức',
    criterion: task.criterion,
    requirementKey,
    route: '/app/application',
    priority: 1,
  };
}

function buildFailedEvidenceAction(
  application: NonNullable<PrecheckApplication>,
): PrecheckNextActionDto | null {
  const failed = application.evidences.find(
    (evidence) =>
      evidence.status === EvidenceStatus.rejected || evidence.indexingStatus === IndexingStatus.failed,
  );
  if (!failed) return null;
  return {
    type: 'fix_failed_evidence',
    label: 'Kiểm tra minh chứng đang lỗi',
    shortReason: 'Có minh chứng hoặc job xử lý lỗi',
    criterion: failed.criterion,
    route: '/app/evidence',
    priority: 5,
  };
}

function buildSubmitOrPrecheckAction(completion: CriterionCompletionDto[]): PrecheckNextActionDto {
  const allReady = completion.every((item) =>
    ['ready_for_precheck', 'accepted'].includes(item.status),
  );
  return allReady
    ? {
        type: 'submit_application',
        label: 'Nộp hồ sơ để cán bộ xét duyệt',
        shortReason: 'Đủ điều kiện tối thiểu để nộp',
        route: '/app/application',
        priority: 7,
      }
    : {
        type: 'rerun_precheck',
        label: 'Chạy tiền kiểm lại',
        shortReason: 'Cập nhật lại trạng thái hồ sơ',
        route: '/app/application',
        priority: 6,
      };
}

function scoreCompletion(completion: CriterionCompletionDto[]) {
  const scores: Record<CriterionCompletionStatus, number> = {
    not_started: 0,
    in_progress: 40,
    needs_verification: 70,
    ready_for_precheck: 90,
    precheck_warning: 45,
    supplement_required: 35,
    under_review: 75,
    accepted: 100,
    rejected: 20,
  };
  if (completion.length === 0) return 0;
  return Math.round(
    completion.reduce((total, item) => total + scores[item.status], 0) / completion.length,
  );
}

function precheckStatusLabel(status: CriterionCompletionStatus) {
  if (status === 'ready_for_precheck' || status === 'accepted') return 'Đáp ứng ngưỡng sơ bộ';
  if (status === 'needs_verification' || status === 'under_review') return 'Cần xác minh';
  if (status === 'not_started') return 'Chưa có dữ liệu';
  return 'Cần bổ sung';
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildRuleContext(
  application: NonNullable<PrecheckApplication>,
  criteriaRules: RuleContext['criteriaRules'],
): Omit<RuleContext, 'targetLevel' | 'criteriaVersion' | 'criteriaWarnings'> {
  const evidenceCards = application.evidences
    .map((evidence) => evidence.evidenceCard)
    .filter((card): card is NonNullable<typeof card> => Boolean(card));
  const eventImports = application.evidences.filter(
    (evidence) => evidence.sourceType === EvidenceSourceType.event_import,
  );

  return {
    application,
    metrics: application.metrics,
    evidences: application.evidences,
    evidenceCards,
    eventImports,
    criteriaRules,
    schoolYear: application.schoolYear,
  };
}

export function assertPrecheckAccess(
  application: Application & { student: User },
  user: AuthenticatedUser,
  viewOnly: boolean,
): void {
  if (user.role !== Role.admin && application.workspaceId !== user.workspaceId) {
    throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
  }
  if (application.studentId === user.id || user.role === Role.admin || user.role === Role.manager) {
    return;
  }
  if (viewOnly && user.role === Role.committee) {
    return;
  }
  if (user.role === Role.officer || user.role === Role.committee) {
    if (
      user.faculty &&
      application.student.faculty &&
      facultyMatches(user.faculty, application.student.faculty)
    ) {
      return;
    }
  }

  throw new AppError(403, ErrorCodes.FORBIDDEN, 'You do not have access to this application');
}

function getNextPrecheckStatus(
  status: ApplicationStatus,
  readyToSubmit: boolean,
): ApplicationStatus | null {
  if (
    status !== ApplicationStatus.draft &&
    status !== ApplicationStatus.prechecked &&
    status !== ApplicationStatus.ready_to_submit
  ) {
    return null;
  }
  return readyToSubmit ? ApplicationStatus.ready_to_submit : ApplicationStatus.prechecked;
}
