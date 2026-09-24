import {
  ApplicationStatus,
  Criterion,
  EvidenceSourceType,
  IndexingStatus,
  Level,
  MetricType,
  Prisma,
  RequirementResponseStatus,
  Role,
  VerificationStatus,
} from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { auditActions } from '../../shared/constants/application';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import type { AuthenticatedUser } from '../../shared/types/auth';
import { requireUserWorkspace, workspaceFilterFor } from '../../shared/utils/workspace-scope';
import { createApplicationAudit } from '../applications/application.helpers';
import {
  canUseEvidenceCardForPrecheck,
  getTrustedEvidenceCardFields,
  needsEvidenceConfirmation,
} from '../evidences/evidence-card-confirmation';
import type {
  CriteriaEvaluationResult,
  CriteriaGapResult,
  CriteriaRuleNode,
  CriteriaRuleStatus,
  CriteriaSourceRef,
  CriteriaStatus,
  CriterionEvaluationStatus,
  EvaluatedCriteriaRule,
  StudentCriterion,
} from './criteria.types';

const officialCriteria: StudentCriterion[] = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
];

const scopeLabels: Record<Level, string> = {
  [Level.school]: 'Cấp Trường',
  [Level.university]: 'Cấp Đại học Đà Nẵng',
  [Level.city]: 'Cấp Thành phố Đà Nẵng',
  [Level.central]: 'Cấp Trung ương',
};

const metricByThresholdKey: Record<string, MetricType> = {
  gpa: MetricType.gpa,
  conduct_score: MetricType.conduct_score,
  volunteer_days: MetricType.volunteer_days,
  foreign_language_score: MetricType.foreign_language_score,
};

type CriteriaConfigWithRules = Prisma.CriteriaConfigGetPayload<{
  include: { rules: true };
}>;

type ApplicationForCriteria = Prisma.ApplicationGetPayload<{
  include: {
    student: true;
    metrics: true;
    requirementResponses: true;
    evidences: {
      include: {
        evidenceCard: true;
        event: true;
      };
    };
  };
}>;

type NodeEvaluation = {
  status: CriteriaRuleStatus;
  matched: boolean | null;
  matchedEvidenceIds: string[];
  missingItems: string[];
  currentValue?: unknown;
  requiredValue?: unknown;
};

export class CriteriaService {
  constructor(private readonly db = prisma) {}

  async listActiveConfigs(user: AuthenticatedUser, input: { scope?: Level; criterion?: Criterion }) {
    const where: Prisma.CriteriaConfigWhereInput = {
      isActive: true,
      ...(input.scope ? { scope: input.scope } : {}),
      OR:
        user.role === Role.admin
          ? undefined
          : [
              { workspaceId: requireUserWorkspace(user) },
              { workspaceId: null },
            ],
    };
    const configs = await this.db.criteriaConfig.findMany({
      where,
      include: {
        rules: {
          where: {
            isActive: true,
            ...(input.criterion && isStudentCriterion(input.criterion)
              ? { criterion: input.criterion }
              : {}),
          },
          orderBy: [{ criterion: 'asc' }, { sortOrder: 'asc' }, { ruleKey: 'asc' }],
        },
      },
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
    });
    return {
      configs: configs.map((config) => this.toCriteriaConfigDto(config, false)),
    };
  }

  async evaluateApplicationAgainstCriteria(
    user: AuthenticatedUser,
    applicationId: string,
    input: { scope: Level; criterion?: Criterion },
  ): Promise<CriteriaEvaluationResult> {
    const application = await this.loadApplicationForUser(user, applicationId);
    const config = await this.loadActiveConfig(input.scope, application.workspaceId);
    const result = this.evaluateConfig(application, config, input.criterion);
    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.CRITERIA_EVALUATION_EXECUTED,
      targetType: 'criteria_config',
      targetId: config.id,
      applicationId: application.id,
      workspaceId: application.workspaceId,
      afterStateJson: {
        scope: config.scope,
        criterion: input.criterion ?? null,
        overallStatus: result.overallStatus,
        matchedRuleCount: result.criteria.flatMap((criterion) => criterion.mandatoryRules).filter((rule) => rule.matched).length,
        missingRuleCount: result.criteria.flatMap((criterion) => criterion.mandatoryRules).filter((rule) => rule.status === 'MISSING').length,
      },
    });
    return result;
  }

  async compareCriteriaLevels(
    user: AuthenticatedUser,
    applicationId: string,
    input: { scopes: Level[]; criterion?: Criterion },
  ): Promise<CriteriaGapResult> {
    const application = await this.loadApplicationForUser(user, applicationId);
    const scopes = input.scopes.length > 0 ? input.scopes : [Level.school, Level.university, Level.city, Level.central];
    const levels = [];
    for (const scope of scopes) {
      const config = await this.loadActiveConfig(scope, application.workspaceId);
      const evaluation = this.evaluateConfig(application, config, input.criterion);
      const rules = evaluation.criteria.flatMap((criterion) => criterion.mandatoryRules);
      levels.push({
        scope,
        status: evaluation.overallStatus,
        matchedCount: rules.filter((rule) => rule.status === 'MATCHED').length,
        missing: rules.filter((rule) => rule.status === 'MISSING').flatMap((rule) => rule.missingItems),
        needsConfirmation: rules
          .filter((rule) => rule.status === 'NEEDS_CONFIRMATION')
          .map((rule) => rule.studentFriendlyExplanation),
        manualReview: rules
          .filter((rule) => rule.status === 'MANUAL_REVIEW')
          .map((rule) => rule.studentFriendlyExplanation),
        sourceRefs: evaluation.sourceRefs,
      });
    }
    await createApplicationAudit(this.db, {
      actorId: user.id,
      actorRole: user.role,
      action: auditActions.CRITERIA_COMPARISON_EXECUTED,
      targetType: 'application',
      targetId: application.id,
      applicationId: application.id,
      workspaceId: application.workspaceId,
      afterStateJson: {
        scopes,
        criterion: input.criterion ?? null,
        levelCount: levels.length,
      },
    });
    return {
      applicationId: application.id,
      criterion: input.criterion && isStudentCriterion(input.criterion) ? input.criterion : null,
      levels,
    };
  }

  async buildCriteriaAssistantContext(
    user: AuthenticatedUser,
    input: { applicationId?: string; scope?: Level; criterion?: Criterion },
  ) {
    const scope = input.scope ?? Level.school;
    const application = input.applicationId
      ? await this.loadApplicationForUser(user, input.applicationId)
      : await this.loadCurrentApplicationForUser(user);
    const config = await this.loadActiveConfig(scope, application.workspaceId);
    const evaluation = this.evaluateConfig(application, config, input.criterion);
    return { config, evaluation, application };
  }

  private async loadApplicationForUser(
    user: AuthenticatedUser,
    applicationId: string,
  ): Promise<ApplicationForCriteria> {
    const application = await this.db.application.findFirst({
      where: {
        id: applicationId,
        ...workspaceFilterFor(user),
        ...(user.role === Role.student || user.role === Role.class_representative
          ? { studentId: user.id }
          : {}),
      },
      include: criteriaApplicationInclude,
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private async loadCurrentApplicationForUser(user: AuthenticatedUser): Promise<ApplicationForCriteria> {
    const application = await this.db.application.findFirst({
      where: {
        studentId: user.id,
        applicationType: 'individual',
        ...workspaceFilterFor(user),
      },
      include: criteriaApplicationInclude,
      orderBy: { updatedAt: 'desc' },
    });
    if (!application) {
      throw new AppError(404, ErrorCodes.APPLICATION_NOT_FOUND, 'Application not found');
    }
    return application;
  }

  private async loadActiveConfig(scope: Level, applicationWorkspaceId: string): Promise<CriteriaConfigWithRules> {
    const workspaceScoped = scope === Level.school || scope === Level.university;
    const config = await this.db.criteriaConfig.findFirst({
      where: {
        scope,
        isActive: true,
        workspaceId: workspaceScoped ? applicationWorkspaceId : null,
      },
      include: {
        rules: {
          where: { isActive: true },
          orderBy: [{ criterion: 'asc' }, { sortOrder: 'asc' }, { ruleKey: 'asc' }],
        },
      },
    });
    if (!config) {
      throw new AppError(404, ErrorCodes.CRITERIA_CONFIG_NOT_FOUND, 'Active criteria config not found');
    }
    return config;
  }

  private evaluateConfig(
    application: ApplicationForCriteria,
    config: CriteriaConfigWithRules,
    criterion?: Criterion,
  ): CriteriaEvaluationResult {
    const selectedCriteria = officialCriteria.filter((candidate) => !criterion || candidate === criterion);
    const criteria = selectedCriteria.map((candidate) => {
      const rules = config.rules.filter((rule) => rule.criterion === candidate);
      const mandatoryRules = rules
        .filter((rule) => rule.mandatory && !rule.priorityRule)
        .map((rule) => this.evaluateRule(application, config, rule));
      const priorityAchievements = rules
        .filter((rule) => rule.priorityRule)
        .map((rule) => {
          const evaluated = this.evaluateNode(application, parseRequirement(rule.requirementJson));
          return {
            ruleKey: rule.ruleKey,
            matched: evaluated.matched,
            explanation: rule.studentFriendlyText,
            source: sourceRef(config, rule),
          };
        });
      return {
        criterion: candidate,
        status: resolveCriterionStatus(mandatoryRules),
        mandatoryRules,
        priorityAchievements,
      };
    });
    const overallStatus = resolveOverallStatus(criteria.map((item) => item.status));
    const sourceRefs = criteria.flatMap((item) => [
      ...item.mandatoryRules.map((rule) => ({
        criteriaConfigId: config.id,
        ruleKey: rule.ruleKey,
        label: rule.title,
        documentName: rule.source.documentName,
        page: rule.source.page,
        section: rule.source.section,
      })),
      ...item.priorityAchievements.map((priority) => priority.source),
    ]);
    return {
      criteriaConfig: {
        id: config.id,
        scope: config.scope,
        title: config.title,
        sourceDocumentName: config.sourceDocumentName,
        sourceDocumentNumber: config.sourceDocumentNumber,
        sourceIssuedAt: config.sourceIssuedAt?.toISOString() ?? null,
      },
      overallStatus,
      criteria,
      sourceRefs,
      allowedActions: buildAllowedActions(application, criterion),
    };
  }

  private evaluateRule(
    application: ApplicationForCriteria,
    config: CriteriaConfigWithRules,
    rule: CriteriaConfigWithRules['rules'][number],
  ): EvaluatedCriteriaRule {
    const evaluated = this.evaluateNode(application, parseRequirement(rule.requirementJson));
    return {
      ruleKey: rule.ruleKey,
      title: rule.title,
      matched: evaluated.matched,
      status: evaluated.status,
      currentValue: evaluated.currentValue,
      requiredValue: evaluated.requiredValue,
      matchedEvidenceIds: evaluated.matchedEvidenceIds,
      missingItems: evaluated.missingItems.length ? evaluated.missingItems : defaultMissingItems(rule, evaluated.status),
      studentFriendlyExplanation: rule.studentFriendlyText,
      source: {
        documentName: config.sourceDocumentName,
        page: rule.sourcePage,
        section: rule.sourceSection,
      },
    };
  }

  private evaluateNode(application: ApplicationForCriteria, node: CriteriaRuleNode): NodeEvaluation {
    if (node.type === 'ALL') {
      return combineAll(node.children.map((child) => this.evaluateNode(application, child)));
    }
    if (node.type === 'ANY') {
      return combineAny(node.children.map((child) => this.evaluateNode(application, child)), node.minimumMatches);
    }
    if (node.type === 'THRESHOLD') return evaluateThreshold(application, node);
    if (node.type === 'BOOLEAN') return evaluateBoolean(application, node.key, node.expected, node.label);
    if (node.type === 'NO_VIOLATION') return evaluateBoolean(application, 'ethics.no_violation', true, node.label);
    if (node.type === 'EVIDENCE_CATEGORY') {
      return evaluateEvidenceText(application, node.category, node.label, node.minimumCount ?? 1);
    }
    if (node.type === 'ACTIVITY') {
      return evaluateActivity(application, node.activityType, node.label, node.minimumCount ?? 1, node.minimumDays);
    }
    if (node.type === 'AWARD') return evaluateEvidenceText(application, node.awardType, node.label, 1);
    if (node.type === 'CERTIFICATE') return evaluateEvidenceText(application, node.certificateType, node.label, 1);
    if (node.type === 'LANGUAGE') return evaluateLanguage(application, node);
    if (node.type === 'PREREQUISITE_TITLE') return evaluateBoolean(application, `title.${node.scope}`, true, node.label);
    if (node.type === 'OFFICIAL_RECOMMENDATION') {
      return evaluateBoolean(application, 'official_recommendation', true, node.label);
    }
    if (node.type === 'BLOOD_DONATION_CONVERSION') {
      return evaluateEvidenceText(application, 'blood_donation', node.label, node.donationsRequired);
    }
    if (node.type === 'DATE_WINDOW') return { status: 'UNKNOWN', matched: null, matchedEvidenceIds: [], missingItems: [node.label] };
    return { status: 'MANUAL_REVIEW', matched: null, matchedEvidenceIds: [], missingItems: [node.label], requiredValue: node.reasonCode };
  }

  private toCriteriaConfigDto(config: CriteriaConfigWithRules, includeRuleShape: boolean) {
    return {
      id: config.id,
      scope: config.scope,
      code: config.code,
      title: config.title,
      description: config.description,
      sourceDocumentName: config.sourceDocumentName,
      sourceDocumentNumber: config.sourceDocumentNumber,
      sourceIssuedAt: config.sourceIssuedAt?.toISOString() ?? null,
      sourcePeriodLabel: config.sourcePeriodLabel,
      sourceOrganization: config.sourceOrganization,
      sourceFileName: config.sourceFileName,
      sourceNote: config.sourceNote,
      rules: config.rules.map((rule) => ({
        criterion: rule.criterion,
        ruleKey: rule.ruleKey,
        title: rule.title,
        mandatory: rule.mandatory,
        priorityRule: rule.priorityRule,
        studentFriendlyText: rule.studentFriendlyText,
        acceptedEvidenceHints: asStringArray(rule.acceptedEvidenceHintsJson),
        missingActionHints: asStringArray(rule.missingActionHintsJson),
        source: {
          documentName: config.sourceDocumentName,
          page: rule.sourcePage,
          section: rule.sourceSection,
        },
        ...(includeRuleShape ? { requirement: rule.requirementJson } : {}),
      })),
    };
  }
}

const criteriaApplicationInclude = {
  student: true,
  metrics: true,
  requirementResponses: true,
  evidences: {
    where: { status: { not: 'rejected' } },
    include: {
      evidenceCard: true,
      event: true,
    },
  },
} satisfies Prisma.ApplicationInclude;

function parseRequirement(value: Prisma.JsonValue): CriteriaRuleNode {
  return value as unknown as CriteriaRuleNode;
}

function evaluateThreshold(
  application: ApplicationForCriteria,
  node: Extract<CriteriaRuleNode, { type: 'THRESHOLD' }>,
): NodeEvaluation {
  const metricType = metricByThresholdKey[node.metric];
  const verifiedMetrics = metricType
    ? application.metrics.filter(
        (metric) =>
          metric.metricType === metricType &&
          metric.verificationStatus === VerificationStatus.verified &&
          scaleMatches(metric.scale, node.scale),
      )
    : [];
  const unverifiedMetrics = metricType
    ? application.metrics.filter(
        (metric) =>
          metric.metricType === metricType &&
          metric.verificationStatus !== VerificationStatus.verified &&
          scaleMatches(metric.scale, node.scale),
      )
    : [];
  const metricValue = verifiedMetrics[0]?.value;
  if (metricValue !== undefined) {
    return numericResult(metricValue, node.value, node.operator, node.label ?? node.metric);
  }

  const trustedField = trustedNumericField(application, fieldNameForMetric(node.metric));
  if (trustedField) {
    return {
      ...numericResult(trustedField.value, node.value, node.operator, node.label ?? node.metric),
      matchedEvidenceIds: [trustedField.evidenceId],
    };
  }

  if (unverifiedMetrics.length > 0 || hasPendingEvidence(application)) {
    return {
      status: 'NEEDS_CONFIRMATION',
      matched: null,
      matchedEvidenceIds: [],
      missingItems: [`Cần xác nhận dữ liệu cho ${node.label ?? node.metric}`],
      requiredValue: node.value,
    };
  }
  return {
    status: 'MISSING',
    matched: false,
    matchedEvidenceIds: [],
    missingItems: [`Thiếu dữ liệu ${node.label ?? node.metric}`],
    requiredValue: node.value,
  };
}

function evaluateBoolean(
  application: ApplicationForCriteria,
  key: string,
  expected: boolean,
  label: string,
): NodeEvaluation {
  const response = application.requirementResponses.find((candidate) => candidate.requirementKey === key);
  if (response && response.status === RequirementResponseStatus.verified) {
    return {
      status: 'MATCHED',
      matched: true,
      matchedEvidenceIds: response.evidenceId ? [response.evidenceId] : [],
      missingItems: [],
      currentValue: expected,
      requiredValue: expected,
    };
  }
  if (response && response.status !== RequirementResponseStatus.rejected) {
    return {
      status: 'NEEDS_CONFIRMATION',
      matched: null,
      matchedEvidenceIds: response.evidenceId ? [response.evidenceId] : [],
      missingItems: [`Cần xác nhận: ${label}`],
      requiredValue: expected,
    };
  }
  return {
    status: 'MISSING',
    matched: false,
    matchedEvidenceIds: [],
    missingItems: [label],
    requiredValue: expected,
  };
}

function evaluateEvidenceText(
  application: ApplicationForCriteria,
  key: string,
  label: string,
  minimumCount: number,
): NodeEvaluation {
  const normalizedKey = normalize(key);
  const matches = trustedEvidence(application).filter((item) => item.text.includes(normalizedKey));
  if (matches.length >= minimumCount) {
    return {
      status: 'MATCHED',
      matched: true,
      matchedEvidenceIds: matches.map((match) => match.evidenceId),
      missingItems: [],
      currentValue: matches.length,
      requiredValue: minimumCount,
    };
  }
  if (hasPendingEvidence(application)) {
    return {
      status: 'NEEDS_CONFIRMATION',
      matched: null,
      matchedEvidenceIds: [],
      missingItems: [`Cần xác nhận minh chứng: ${label}`],
      requiredValue: minimumCount,
    };
  }
  return {
    status: 'MISSING',
    matched: false,
    matchedEvidenceIds: [],
    missingItems: [label],
    currentValue: matches.length,
    requiredValue: minimumCount,
  };
}

function evaluateActivity(
  application: ApplicationForCriteria,
  activityType: string,
  label: string,
  minimumCount: number,
  minimumDays?: number,
): NodeEvaluation {
  if (minimumDays) {
    const fromMetric = application.metrics.find(
      (metric) =>
        metric.metricType === MetricType.volunteer_days &&
        metric.verificationStatus === VerificationStatus.verified,
    )?.value;
    const fromEvents = application.evidences
      .filter((evidence) => evidence.sourceType === EvidenceSourceType.event_import && evidence.event?.convertedUnit === 'days')
      .reduce((sum, evidence) => sum + (evidence.event?.convertedValue ?? 0), 0);
    const fromCards = trustedEvidence(application).reduce((sum, evidence) => sum + (evidence.volunteerDays ?? 0), 0);
    const value = Math.max(fromMetric ?? 0, fromEvents, fromCards);
    if (value >= minimumDays) {
      return {
        status: 'MATCHED',
        matched: true,
        matchedEvidenceIds: trustedEvidence(application).map((evidence) => evidence.evidenceId),
        missingItems: [],
        currentValue: value,
        requiredValue: minimumDays,
      };
    }
    if (hasPendingEvidence(application)) {
      return {
        status: 'NEEDS_CONFIRMATION',
        matched: null,
        matchedEvidenceIds: [],
        missingItems: [`Cần xác nhận số ngày cho: ${label}`],
        currentValue: value,
        requiredValue: minimumDays,
      };
    }
    return {
      status: 'MISSING',
      matched: false,
      matchedEvidenceIds: [],
      missingItems: [label],
      currentValue: value,
      requiredValue: minimumDays,
    };
  }
  return evaluateEvidenceText(application, activityType, label, minimumCount);
}

function evaluateLanguage(
  application: ApplicationForCriteria,
  node: Extract<CriteriaRuleNode, { type: 'LANGUAGE' }>,
): NodeEvaluation {
  if (node.minimumScore !== undefined) {
    const scoreNode = {
      type: 'THRESHOLD',
      metric: 'foreign_language_score',
      operator: '>=',
      value: node.minimumScore,
      scale: node.scale,
      label: node.label,
    } satisfies Extract<CriteriaRuleNode, { type: 'THRESHOLD' }>;
    return evaluateThreshold(application, scoreNode);
  }
  return evaluateEvidenceText(application, normalize(node.minimumLevel ?? 'language_certificate'), node.label, 1);
}

function numericResult(
  current: number,
  required: number,
  operator: Extract<CriteriaRuleNode, { type: 'THRESHOLD' }>['operator'],
  label: string,
): NodeEvaluation {
  const matched =
    operator === '>='
      ? current >= required
      : operator === '>'
        ? current > required
        : operator === '<='
          ? current <= required
          : operator === '<'
            ? current < required
            : current === required;
  return {
    status: matched ? 'MATCHED' : 'MISSING',
    matched,
    matchedEvidenceIds: [],
    missingItems: matched ? [] : [`${label}: cần ${operator} ${required}, hiện có ${current}`],
    currentValue: current,
    requiredValue: required,
  };
}

function combineAll(results: NodeEvaluation[]): NodeEvaluation {
  const status = highestStatus(results);
  const matched = status === 'MATCHED' ? true : status === 'MISSING' ? false : null;
  return {
    status,
    matched,
    matchedEvidenceIds: unique(results.flatMap((result) => result.matchedEvidenceIds)),
    missingItems: results.flatMap((result) => result.missingItems),
    currentValue: results.map((result) => result.currentValue).filter((value) => value !== undefined),
    requiredValue: results.map((result) => result.requiredValue).filter((value) => value !== undefined),
  };
}

function combineAny(results: NodeEvaluation[], minimumMatches: number): NodeEvaluation {
  const matchedCount = results.filter((result) => result.status === 'MATCHED').length;
  if (matchedCount >= minimumMatches) {
    const matched = results.filter((result) => result.status === 'MATCHED');
    return {
      status: 'MATCHED',
      matched: true,
      matchedEvidenceIds: unique(matched.flatMap((result) => result.matchedEvidenceIds)),
      missingItems: [],
      currentValue: matchedCount,
      requiredValue: minimumMatches,
    };
  }
  const pendingStatus = highestStatus(results.filter((result) => result.status !== 'MISSING'));
  return {
    status: pendingStatus === 'MATCHED' ? 'MISSING' : pendingStatus,
    matched: pendingStatus === 'MISSING' ? false : null,
    matchedEvidenceIds: unique(results.flatMap((result) => result.matchedEvidenceIds)),
    missingItems: results.flatMap((result) => result.missingItems),
    currentValue: matchedCount,
    requiredValue: minimumMatches,
  };
}

function highestStatus(results: NodeEvaluation[]): CriteriaRuleStatus {
  if (results.length === 0) return 'UNKNOWN';
  if (results.some((result) => result.status === 'MISSING')) return 'MISSING';
  if (results.some((result) => result.status === 'NEEDS_CONFIRMATION')) return 'NEEDS_CONFIRMATION';
  if (results.some((result) => result.status === 'MANUAL_REVIEW')) return 'MANUAL_REVIEW';
  if (results.some((result) => result.status === 'UNKNOWN')) return 'UNKNOWN';
  return 'MATCHED';
}

function resolveCriterionStatus(rules: EvaluatedCriteriaRule[]): CriterionEvaluationStatus {
  if (rules.length === 0) return 'MISSING';
  if (rules.every((rule) => rule.status === 'MATCHED')) return 'READY';
  if (rules.some((rule) => rule.status === 'NEEDS_CONFIRMATION')) return 'NEEDS_CONFIRMATION';
  if (rules.some((rule) => rule.status === 'MANUAL_REVIEW')) return 'NEEDS_MANUAL_REVIEW';
  if (rules.some((rule) => rule.status === 'MATCHED')) return 'PARTIAL';
  return 'MISSING';
}

function resolveOverallStatus(statuses: CriterionEvaluationStatus[]): CriteriaStatus {
  if (statuses.every((status) => status === 'READY')) return 'READY';
  if (statuses.some((status) => status === 'NEEDS_CONFIRMATION')) return 'NEEDS_CONFIRMATION';
  if (statuses.some((status) => status === 'NEEDS_MANUAL_REVIEW')) return 'NEEDS_MANUAL_REVIEW';
  return 'INCOMPLETE';
}

function sourceRef(
  config: CriteriaConfigWithRules,
  rule: CriteriaConfigWithRules['rules'][number],
): CriteriaSourceRef {
  return {
    criteriaConfigId: config.id,
    ruleKey: rule.ruleKey,
    label: rule.title,
    documentName: config.sourceDocumentName,
    page: rule.sourcePage,
    section: rule.sourceSection,
  };
}

function defaultMissingItems(
  rule: CriteriaConfigWithRules['rules'][number],
  status: CriteriaRuleStatus,
): string[] {
  if (status === 'MATCHED') return [];
  if (status === 'NEEDS_CONFIRMATION') return [`Cần xác nhận dữ liệu cho: ${rule.title}`];
  if (status === 'MANUAL_REVIEW') return [`Cần cán bộ xem trực tiếp: ${rule.title}`];
  return [`Thiếu điều kiện: ${rule.title}`];
}

function buildAllowedActions(application: ApplicationForCriteria, criterion?: Criterion) {
  const editable = new Set<ApplicationStatus>([
    ApplicationStatus.draft,
    ApplicationStatus.prechecked,
    ApplicationStatus.ready_to_submit,
    ApplicationStatus.supplement_required,
  ]).has(application.status);
  const query: Record<string, string> = {};
  if (criterion && isStudentCriterion(criterion)) query.criterion = criterion;
  const addEvidenceQuery: Record<string, string> = { ...query, mode: 'add-evidence' };
  return [
    {
      id: `open-criterion:${criterion ?? 'all'}`,
      type: 'open_criterion' as const,
      label: criterion ? `Mở tiêu chí ${criterion}` : 'Mở hồ sơ',
      destination: { route: '/app/application', query },
      allowed: true,
    },
    {
      id: `add-evidence:${criterion ?? 'all'}`,
      type: 'add_evidence' as const,
      label: 'Bổ sung minh chứng',
      destination: { route: '/app/application', query: addEvidenceQuery },
      allowed: editable,
    },
    {
      id: `run-precheck:${application.id}`,
      type: 'run_precheck' as const,
      label: 'Chạy tiền kiểm',
      destination: { route: '/app/application', query: { tab: 'precheck' } },
      allowed: editable,
    },
    {
      id: 'contact-officer',
      type: 'contact_officer' as const,
      label: 'Liên hệ cán bộ phụ trách',
      destination: { route: '/app/feedback' },
      allowed: true,
    },
  ];
}

function trustedEvidence(application: ApplicationForCriteria) {
  return application.evidences
    .filter((evidence) => {
      if (evidence.sourceType === EvidenceSourceType.event_import) return true;
      return canUseEvidenceCardForPrecheck(evidence);
    })
    .map((evidence) => {
      const fields = getTrustedEvidenceCardFields(evidence);
      return {
        evidenceId: evidence.id,
        text: normalize([
          evidence.evidenceName,
          evidence.criterion,
          evidence.event?.eventName,
          evidence.event?.organizer,
          fields.event_name,
          fields.organizer,
          fields.organizer_level,
          fields.award_level,
          fields.certificate_type,
        ].join(' ')),
        volunteerDays: numericValue(fields.volunteer_days) ?? evidence.event?.convertedValue ?? null,
        fields,
      };
    });
}

function trustedNumericField(application: ApplicationForCriteria, fieldName: string) {
  for (const evidence of application.evidences) {
    const fields = getTrustedEvidenceCardFields(evidence);
    const value = numericValue(fields[fieldName]);
    if (value !== null) return { evidenceId: evidence.id, value };
  }
  return null;
}

function hasPendingEvidence(application: ApplicationForCriteria): boolean {
  return application.evidences.some((evidence) => {
    if (
      evidence.indexingStatus === IndexingStatus.pending_indexing ||
      evidence.indexingStatus === IndexingStatus.ocr_processing ||
      evidence.indexingStatus === IndexingStatus.extracting ||
      evidence.indexingStatus === IndexingStatus.checking_registry
    ) {
      return true;
    }
    return needsEvidenceConfirmation(evidence);
  });
}

function fieldNameForMetric(metric: string): string {
  if (metric === 'foreign_language_score') return 'language_score';
  return metric;
}

function scaleMatches(metricScale: number | null, requiredScale?: number): boolean {
  if (!requiredScale) return true;
  if (metricScale === null) return requiredScale === 4;
  return Math.abs(metricScale - requiredScale) < 0.001;
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isStudentCriterion(value: Criterion): value is StudentCriterion {
  return officialCriteria.includes(value as StudentCriterion);
}

export function criteriaStatusLabel(status: CriteriaStatus | CriterionEvaluationStatus): string {
  if (status === 'READY') return 'Đủ dữ liệu để tiền kiểm';
  if (status === 'NEEDS_CONFIRMATION') return 'Cần xác nhận dữ liệu';
  if (status === 'NEEDS_MANUAL_REVIEW') return 'Cần cán bộ xem trực tiếp';
  if (status === 'PARTIAL') return 'Đã có một phần dữ liệu';
  if (status === 'MISSING') return 'Còn thiếu dữ liệu';
  return 'Chưa đủ dữ liệu';
}

export function scopeLabel(scope: Level): string {
  return scopeLabels[scope];
}
