import {
  ApplicationType,
  Criterion,
  EvidenceSourceType,
  Level,
  type Application,
  type ApplicationMetric,
} from '@prisma/client';
import { evaluateCriteria } from '../rules/rule-evaluator';
import { loadCriteriaRules } from '../rules/criteria.loader';
import type { CriteriaRuleConfig, EvidenceWithCard, RuleContext } from '../rules/rules.types';

const reviewLevels = [Level.school, Level.university, Level.city, Level.central] as const;

type ReviewCriteriaApplication = Application & {
  metrics: ApplicationMetric[];
};

export type ReviewCriteriaTask = {
  criterion: Criterion;
  application: ReviewCriteriaApplication | null;
  evidences: Array<{ evidence: EvidenceWithCard }>;
};

export type ReviewCriteriaRequirement = {
  key: string;
  label: string;
  status: 'passed' | 'failed' | 'missing' | 'needs_review';
  actualValue: string | null;
  requiredValue: string | null;
  source: 'criteria_version';
  reason: string;
  ruleType: string;
  check: {
    metric?: string;
    operator?: string;
    value?: number;
    evidenceCriterion?: Criterion;
    evidenceSourceType?: string;
  };
  grouping: unknown[];
};

export type ReviewCriteriaResolution = {
  authority: {
    source: 'CriteriaVersion';
    applicationWorkspaceId: string;
    schoolYear: string;
    targetLevel: Level;
    levels: Array<{
      level: Level;
      status: 'resolved' | 'blocked';
      criteriaVersionId: string | null;
      versionName: string | null;
      unitScope: string;
      warnings: string[];
    }>;
  };
  levels: Array<{
    level: Level;
    criteriaVersionId: string | null;
    versionName: string | null;
    requirements: ReviewCriteriaRequirement[];
  }>;
};

export async function resolveReviewCriteriaForTask(
  task: ReviewCriteriaTask,
): Promise<ReviewCriteriaResolution | null> {
  const application = task.application;
  if (
    !application ||
    application.applicationType !== ApplicationType.individual ||
    application.targetLevel !== Level.city
  ) {
    return null;
  }

  const evidences = task.evidences.map((item) => item.evidence);
  const contextBase = {
    application,
    metrics: application.metrics,
    evidences,
    evidenceCards: evidences.flatMap((evidence) =>
      evidence.evidenceCard ? [evidence.evidenceCard] : [],
    ),
    eventImports: evidences.filter(
      (evidence) => evidence.sourceType === EvidenceSourceType.event_import,
    ),
    targetLevel: application.targetLevel,
    schoolYear: application.schoolYear,
  } satisfies Omit<RuleContext, 'criteriaRules' | 'targetLevel'> & {
    targetLevel: Level;
  };

  const bundles = await Promise.all(
    reviewLevels.map((level) =>
      loadCriteriaRules({
        workspaceId: application.workspaceId,
        schoolYear: application.schoolYear,
        level,
      }),
    ),
  );

  return {
    authority: {
      source: 'CriteriaVersion',
      applicationWorkspaceId: application.workspaceId,
      schoolYear: application.schoolYear,
      targetLevel: application.targetLevel,
      levels: bundles.map((bundle) => ({
        level: bundle.level,
        status: bundle.isFallback ? 'blocked' : 'resolved',
        criteriaVersionId: bundle.criteriaVersionId,
        versionName: bundle.isFallback ? null : bundle.versionName,
        unitScope: bundle.unitScope,
        warnings: bundle.warnings,
      })),
    },
    levels: bundles.map((bundle) => ({
      level: bundle.level,
      criteriaVersionId: bundle.isFallback ? null : bundle.criteriaVersionId,
      versionName: bundle.isFallback ? null : bundle.versionName,
      requirements: bundle.isFallback
        ? [blockedRequirement(task.criterion, bundle.level, bundle.warnings)]
        : bundle.rules
            .filter((rule) => rule.criterion === task.criterion)
            .map((rule) => evaluateReviewRule(rule, bundle.level, contextBase)),
    })),
  };
}

function evaluateReviewRule(
  rule: CriteriaRuleConfig,
  level: Level,
  contextBase: Omit<RuleContext, 'criteriaRules' | 'targetLevel'> & { targetLevel: Level },
): ReviewCriteriaRequirement {
  const result = evaluateCriteria({
    ...contextBase,
    targetLevel: level,
    criteriaRules: [rule],
  }).find((item) => item.criterion === rule.criterion);
  const threshold = asObject(rule.thresholdJson);
  const evidence = asObject(rule.evidenceRequirementsJson);

  return {
    key: rule.ruleKey,
    label: rule.humanReadableText,
    status: mapStatus(result?.status),
    actualValue: result?.matchedItems.join(', ') || null,
    requiredValue:
      typeof threshold?.operator === 'string' && typeof threshold.value === 'number'
        ? `${threshold.operator} ${threshold.value}`
        : null,
    source: 'criteria_version',
    reason: result?.explanation ?? rule.humanReadableText,
    ruleType: rule.ruleType,
    check: {
      metric: typeof threshold?.metric === 'string' ? threshold.metric : undefined,
      operator: typeof threshold?.operator === 'string' ? threshold.operator : undefined,
      value: typeof threshold?.value === 'number' ? threshold.value : undefined,
      evidenceCriterion: isCriterion(evidence?.criterion) ? evidence.criterion : undefined,
      evidenceSourceType:
        typeof evidence?.sourceType === 'string' ? evidence.sourceType : undefined,
    },
    grouping: Array.isArray(evidence?.requirementGroups) ? evidence.requirementGroups : [],
  };
}

function blockedRequirement(criterion: Criterion, level: Level, warnings: string[]) {
  return {
    key: `criteria-version-missing-${level}-${criterion}`,
    label: 'Chưa xác định được bộ tiêu chí áp dụng; cán bộ cần kiểm tra cấu hình.',
    status: 'needs_review' as const,
    actualValue: null,
    requiredValue: null,
    source: 'criteria_version' as const,
    reason: warnings.length
      ? `Không thể dùng bộ tiêu chí authoritative (${warnings.join(', ')}).`
      : 'Không thể dùng bộ tiêu chí authoritative.',
    ruleType: 'criteria_version_missing',
    check: {},
    grouping: [],
  };
}

function mapStatus(status: string | undefined): ReviewCriteriaRequirement['status'] {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'missing') return 'missing';
  return 'needs_review';
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCriterion(value: unknown): value is Criterion {
  return Object.values(Criterion).includes(value as Criterion);
}
