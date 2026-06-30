import {
  Criterion,
  EvidenceSourceType,
  IndexingStatus,
  MetricType,
  type ApplicationMetric,
} from '@prisma/client';
import { coreCriteria } from './criteria.constants';
import type {
  CriteriaRuleConfig,
  CriterionResult,
  CriterionStatus,
  EvidenceWithCard,
  MissingItem,
  RuleContext,
  SupportedRuleType,
  ThresholdConfig,
} from './rules.types';

type PartialRuleResult = {
  status: CriterionStatus;
  requiredItems: string[];
  matchedItems: string[];
  missingItems: string[];
  warnings: string[];
  evidenceRefs: string[];
  metricRefs: string[];
};

export function evaluateCriteria(context: RuleContext): CriterionResult[] {
  return [...coreCriteria, Criterion.priority].map((criterion) =>
    evaluateCriterion(
      criterion,
      context.criteriaRules.filter((rule) => rule.criterion === criterion),
      context,
    ),
  );
}

export function buildMissingItems(results: CriterionResult[]): MissingItem[] {
  return results.flatMap((result) =>
    result.missingItems.map((message) => ({
      criterion: result.criterion,
      code: buildMissingCode(result.criterion, message),
      message,
      severity: result.criterion === Criterion.priority ? 'info' : 'blocking',
      suggestedAction: buildSuggestedAction(result.criterion),
    })),
  );
}

function evaluateCriterion(
  criterion: Criterion,
  rules: CriteriaRuleConfig[],
  context: RuleContext,
): CriterionResult {
  if (rules.length === 0) {
    return {
      criterion,
      status: criterion === Criterion.priority ? 'passed' : 'missing',
      score: criterion === Criterion.priority ? 100 : 0,
      requiredItems: [],
      matchedItems: [],
      missingItems:
        criterion === Criterion.priority ? [] : ['Chưa có rule tiền kiểm cho tiêu chí này.'],
      warnings: criterion === Criterion.priority ? [] : ['CRITERIA_RULE_NOT_FOUND'],
      explanation:
        criterion === Criterion.priority
          ? 'Tiêu chí ưu tiên là tùy chọn.'
          : 'Thiếu rule để tiền kiểm.',
      evidenceRefs: [],
      metricRefs: [],
    };
  }

  const parts = rules.map((rule) => evaluateRule(rule, context));
  const blockingParts = parts.filter((part) => !isOptionalRule(part));
  const status = mergeStatuses(blockingParts.length > 0 ? blockingParts : parts);
  const requiredItems = unique(parts.flatMap((part) => part.requiredItems));
  const matchedItems = unique(parts.flatMap((part) => part.matchedItems));
  const missingItems = unique(parts.flatMap((part) => part.missingItems));
  const warnings = unique([
    ...(context.criteriaWarnings ?? []),
    ...parts.flatMap((part) => part.warnings),
  ]);
  const evidenceRefs = unique(parts.flatMap((part) => part.evidenceRefs));
  const metricRefs = unique(parts.flatMap((part) => part.metricRefs));

  return {
    criterion,
    status,
    score: scoreStatus(status),
    requiredItems,
    matchedItems,
    missingItems,
    warnings,
    explanation: buildExplanation(criterion, status, matchedItems, missingItems, warnings),
    evidenceRefs,
    metricRefs,
  };
}

function evaluateRule(rule: CriteriaRuleConfig, context: RuleContext): PartialRuleResult {
  const ruleType = normalizeRuleType(rule.ruleType);
  if (ruleType === 'metric_threshold') {
    return evaluateMetricThreshold(rule, context);
  }
  if (ruleType === 'evidence_required') {
    return evaluateEvidenceRequired(rule, context);
  }
  if (ruleType === 'evidence_or_metric') {
    return mergeAny([
      evaluateMetricThreshold(rule, context),
      evaluateEvidenceRequired(rule, context),
    ]);
  }
  if (ruleType === 'event_import_allowed') {
    return evaluateEventImport(rule, context);
  }
  if (ruleType === 'human_review_note') {
    return evaluateHumanReviewNote(rule);
  }
  if (ruleType === 'composite_all') {
    return evaluateEvidenceRequired(rule, context);
  }
  return mergeAny([
    evaluateMetricThreshold(rule, context),
    evaluateEvidenceRequired(rule, context),
  ]);
}

function normalizeRuleType(ruleType: string): SupportedRuleType {
  if (ruleType === 'threshold') {
    return 'metric_threshold';
  }
  if (
    [
      'metric_threshold',
      'evidence_required',
      'evidence_or_metric',
      'event_import_allowed',
      'human_review_note',
      'composite_all',
      'composite_any',
    ].includes(ruleType)
  ) {
    return ruleType as SupportedRuleType;
  }
  return 'human_review_note';
}

function evaluateMetricThreshold(
  rule: CriteriaRuleConfig,
  context: RuleContext,
): PartialRuleResult {
  const config = parseObject<ThresholdConfig>(rule.thresholdJson);
  const metricType = config.metric;
  const threshold = Number(config.value);

  if (!metricType || !Number.isFinite(threshold)) {
    return missing(rule, 'Cấu hình ngưỡng metric không hợp lệ.', ['INVALID_RULE_CONFIG']);
  }

  const aggregate =
    metricType === MetricType.volunteer_days
      ? buildVolunteerDaysMetric(context)
      : getMetricValue(context.metrics, metricType);

  if (!aggregate) {
    return missing(rule, missingMetricMessage(metricType), []);
  }

  const passed = compare(aggregate.value, config.operator ?? '>=', threshold);
  if (passed) {
    return {
      status: aggregate.warnings.length > 0 ? 'human_review_required' : 'passed',
      requiredItems: [rule.humanReadableText],
      matchedItems: [`${metricType}: ${aggregate.value}`],
      missingItems: [],
      warnings: aggregate.warnings,
      evidenceRefs: aggregate.evidenceRefs,
      metricRefs: aggregate.metricRefs,
    };
  }

  return {
    status: 'failed',
    requiredItems: [rule.humanReadableText],
    matchedItems: [`${metricType}: ${aggregate.value}`],
    missingItems: [failedMetricMessage(metricType, threshold)],
    warnings: aggregate.warnings,
    evidenceRefs: aggregate.evidenceRefs,
    metricRefs: aggregate.metricRefs,
  };
}

function evaluateEvidenceRequired(
  rule: CriteriaRuleConfig,
  context: RuleContext,
): PartialRuleResult {
  const requirement = parseObject<{
    criterion?: Criterion;
    sourceType?: EvidenceSourceType | string;
  }>(rule.evidenceRequirementsJson);
  const criterion = requirement.criterion ?? rule.criterion;
  const sourceType = requirement.sourceType;
  const evidences = context.evidences.filter((evidence) => {
    if (evidence.criterion !== criterion) {
      return false;
    }
    if (sourceType && evidence.sourceType !== sourceType) {
      return false;
    }
    return true;
  });

  if (evidences.length === 0) {
    return missing(rule, missingEvidenceMessage(criterion), []);
  }

  const reviewed = evidences.map(reviewEvidence);
  const passed = reviewed.filter((item) => item.status === 'passed');
  const needsReview = reviewed.filter((item) => item.status === 'human_review_required');

  if (passed.length > 0 && needsReview.length === 0) {
    return {
      status: 'passed',
      requiredItems: [rule.humanReadableText],
      matchedItems: passed.map((item) => item.label),
      missingItems: [],
      warnings: [],
      evidenceRefs: passed.map((item) => item.id),
      metricRefs: [],
    };
  }

  return {
    status: needsReview.length > 0 ? 'human_review_required' : 'missing',
    requiredItems: [rule.humanReadableText],
    matchedItems: reviewed.map((item) => item.label),
    missingItems: needsReview.length > 0 ? [] : [missingEvidenceMessage(criterion)],
    warnings: unique(reviewed.flatMap((item) => item.warnings)),
    evidenceRefs: reviewed.map((item) => item.id),
    metricRefs: [],
  };
}

function evaluateEventImport(rule: CriteriaRuleConfig, context: RuleContext): PartialRuleResult {
  const imported = context.eventImports.filter((evidence) => evidence.criterion === rule.criterion);
  if (imported.length === 0) {
    return missing(rule, 'Chưa có minh chứng import từ Kho sự kiện hợp lệ.', []);
  }

  return {
    status: 'passed',
    requiredItems: [rule.humanReadableText],
    matchedItems: imported.map((evidence) => evidence.evidenceName),
    missingItems: [],
    warnings: [],
    evidenceRefs: imported.map((evidence) => evidence.id),
    metricRefs: [],
  };
}

function evaluateHumanReviewNote(rule: CriteriaRuleConfig): PartialRuleResult {
  const config = parseObject<{ optional?: boolean; warningCode?: string }>(
    rule.evidenceRequirementsJson,
  );
  return {
    status: config.optional ? 'passed' : 'human_review_required',
    requiredItems: config.optional ? [] : [rule.humanReadableText],
    matchedItems: config.optional ? ['Tiêu chí tùy chọn.'] : [],
    missingItems: [],
    warnings: config.optional ? [] : [config.warningCode ?? 'HUMAN_CONFIRMATION_REQUIRED'],
    evidenceRefs: [],
    metricRefs: [],
  };
}

function mergeAny(parts: PartialRuleResult[]): PartialRuleResult {
  const pass = parts.find((part) => part.status === 'passed');
  if (pass) {
    return {
      ...pass,
      requiredItems: unique(parts.flatMap((part) => part.requiredItems)),
      warnings: unique(parts.flatMap((part) => part.warnings)),
    };
  }
  const review = parts.find((part) => part.status === 'human_review_required');
  if (review) {
    return {
      ...review,
      requiredItems: unique(parts.flatMap((part) => part.requiredItems)),
      missingItems: unique(parts.flatMap((part) => part.missingItems)),
      warnings: unique(parts.flatMap((part) => part.warnings)),
    };
  }
  return {
    status: parts.some((part) => part.status === 'failed') ? 'failed' : 'missing',
    requiredItems: unique(parts.flatMap((part) => part.requiredItems)),
    matchedItems: unique(parts.flatMap((part) => part.matchedItems)),
    missingItems: unique(parts.flatMap((part) => part.missingItems)),
    warnings: unique(parts.flatMap((part) => part.warnings)),
    evidenceRefs: unique(parts.flatMap((part) => part.evidenceRefs)),
    metricRefs: unique(parts.flatMap((part) => part.metricRefs)),
  };
}

function mergeStatuses(parts: PartialRuleResult[]): CriterionStatus {
  if (parts.some((part) => part.status === 'failed')) {
    return 'failed';
  }
  if (parts.some((part) => part.status === 'missing')) {
    return 'missing';
  }
  if (parts.some((part) => part.status === 'human_review_required')) {
    return 'human_review_required';
  }
  return 'passed';
}

function reviewEvidence(evidence: EvidenceWithCard) {
  const card = evidence.evidenceCard;
  const confidence = evidence.confidence ?? card?.confidence ?? 0;
  const fields = parseObject<{ criterionHint?: Criterion }>(card?.extractedFieldsJson);
  const warnings = [
    ...parseWarnings(card?.warningsJson),
    ...(evidence.indexingStatus === IndexingStatus.needs_manual_review
      ? ['NEEDS_MANUAL_REVIEW']
      : []),
  ];

  if (fields.criterionHint && fields.criterionHint !== evidence.criterion) {
    return {
      id: evidence.id,
      label: evidence.evidenceName,
      status: 'human_review_required' as CriterionStatus,
      warnings: unique([...warnings, 'CRITERION_MISMATCH']),
    };
  }

  if (
    evidence.indexingStatus === IndexingStatus.indexed &&
    (confidence >= 0.75 || evidence.sourceType === EvidenceSourceType.event_import)
  ) {
    return {
      id: evidence.id,
      label: evidence.evidenceName,
      status: 'passed' as CriterionStatus,
      warnings,
    };
  }

  if (evidence.indexingStatus === IndexingStatus.indexed && confidence >= 0.6) {
    return {
      id: evidence.id,
      label: evidence.evidenceName,
      status: 'human_review_required' as CriterionStatus,
      warnings: unique([...warnings, 'LOW_CONFIDENCE']),
    };
  }

  return {
    id: evidence.id,
    label: evidence.evidenceName,
    status: 'human_review_required' as CriterionStatus,
    warnings: unique([...warnings, 'LOW_CONFIDENCE']),
  };
}

function buildVolunteerDaysMetric(context: RuleContext) {
  const metric = getMetricValue(context.metrics, MetricType.volunteer_days);
  let total = metric?.value ?? 0;
  const metricRefs = metric?.metricRefs ?? [];
  const evidenceRefs: string[] = [];
  const warnings: string[] = [];

  for (const evidence of context.eventImports.filter(
    (item) => item.criterion === Criterion.volunteer,
  )) {
    if (evidence.event?.convertedUnit === 'days' && evidence.event.convertedValue) {
      total += evidence.event.convertedValue;
      evidenceRefs.push(evidence.id);
    }
  }

  for (const evidence of context.evidences.filter(
    (item) => item.criterion === Criterion.volunteer,
  )) {
    const fields = parseObject<{ volunteerDays?: number }>(
      evidence.evidenceCard?.extractedFieldsJson,
    );
    const confidence = evidence.confidence ?? evidence.evidenceCard?.confidence ?? 0;
    if (typeof fields.volunteerDays === 'number' && confidence >= 0.75) {
      total += fields.volunteerDays;
      evidenceRefs.push(evidence.id);
    } else if (typeof fields.volunteerDays === 'number' && confidence >= 0.6) {
      warnings.push('VOLUNTEER_DAYS_NEED_MANUAL_REVIEW');
      evidenceRefs.push(evidence.id);
    }
  }

  if (total === 0 && metricRefs.length === 0 && evidenceRefs.length === 0) {
    return null;
  }

  return { value: total, metricRefs, evidenceRefs, warnings: unique(warnings) };
}

function getMetricValue(metrics: ApplicationMetric[], metricType: MetricType) {
  const metric = metrics.find((item) => item.metricType === metricType);
  if (!metric) {
    return null;
  }
  const value =
    metricType === MetricType.gpa && metric.scale === 10 ? metric.value / 2.5 : metric.value;
  return { value, metricRefs: [metric.id], evidenceRefs: [], warnings: [] };
}

function compare(actual: number, operator: string, threshold: number): boolean {
  if (operator === '>') return actual > threshold;
  if (operator === '<=') return actual <= threshold;
  if (operator === '<') return actual < threshold;
  if (operator === '==') return actual === threshold;
  return actual >= threshold;
}

function missing(rule: CriteriaRuleConfig, message: string, warnings: string[]): PartialRuleResult {
  return {
    status: 'missing',
    requiredItems: [rule.humanReadableText],
    matchedItems: [],
    missingItems: [message],
    warnings,
    evidenceRefs: [],
    metricRefs: [],
  };
}

function isOptionalRule(part: PartialRuleResult): boolean {
  return part.requiredItems.length === 0 && part.status === 'passed';
}

function scoreStatus(status: CriterionStatus): number {
  if (status === 'passed') return 100;
  if (status === 'human_review_required') return 60;
  return 0;
}

function buildExplanation(
  criterion: Criterion,
  status: CriterionStatus,
  matchedItems: string[],
  missingItems: string[],
  warnings: string[],
): string {
  if (status === 'passed') {
    return `Tiêu chí ${criterion} có dữ liệu phù hợp ở mức tiền kiểm.`;
  }
  if (status === 'human_review_required') {
    return `Tiêu chí ${criterion} có dữ liệu nhưng cần cán bộ xác nhận: ${warnings.join(', ')}.`;
  }
  if (status === 'failed') {
    return `Tiêu chí ${criterion} chưa đạt theo dữ liệu hiện có: ${missingItems.join(' ')}`;
  }
  return `Tiêu chí ${criterion} còn thiếu dữ liệu: ${missingItems.join(' ') || matchedItems.join(' ')}`;
}

function missingMetricMessage(metricType: MetricType): string {
  if (metricType === MetricType.gpa) {
    return 'Bạn cần nhập điểm trung bình học tập hoặc tải lên bảng điểm.';
  }
  if (metricType === MetricType.conduct_score) {
    return 'Bạn cần bổ sung điểm rèn luyện hoặc minh chứng xác nhận.';
  }
  if (metricType === MetricType.volunteer_days) {
    return 'Bạn cần bổ sung số ngày tình nguyện hoặc import từ Kho sự kiện.';
  }
  return `Bạn cần bổ sung dữ liệu ${metricType}.`;
}

function failedMetricMessage(metricType: MetricType, threshold: number): string {
  if (metricType === MetricType.volunteer_days) {
    return `Số ngày tình nguyện hiện chưa đạt ngưỡng ${threshold} ngày.`;
  }
  return `${metricType} hiện chưa đạt ngưỡng ${threshold}.`;
}

function missingEvidenceMessage(criterion: Criterion): string {
  if (criterion === Criterion.volunteer) {
    return 'Bạn cần bổ sung minh chứng tình nguyện hợp lệ.';
  }
  if (criterion === Criterion.physical) {
    return 'Bạn cần bổ sung minh chứng thể lực hợp lệ.';
  }
  if (criterion === Criterion.integration) {
    return 'Bạn cần bổ sung minh chứng hội nhập hợp lệ.';
  }
  if (criterion === Criterion.academic) {
    return 'Bạn cần bổ sung minh chứng học thuật hợp lệ.';
  }
  return 'Bạn cần bổ sung minh chứng hợp lệ.';
}

function buildMissingCode(criterion: Criterion, message: string): string {
  if (message.includes('GPA') || message.includes('trung bình')) return 'MISSING_GPA';
  if (message.includes('rèn luyện')) return 'MISSING_CONDUCT_SCORE';
  if (message.includes('tình nguyện') || message.includes('ngày')) return 'MISSING_VOLUNTEER_DAYS';
  return `MISSING_${criterion.toUpperCase()}`;
}

function buildSuggestedAction(criterion: Criterion): string {
  if (criterion === Criterion.academic) {
    return 'Nhập GPA hoặc tải bảng điểm.';
  }
  if (criterion === Criterion.ethics) {
    return 'Bổ sung điểm rèn luyện hoặc xác nhận đạo đức.';
  }
  if (criterion === Criterion.volunteer) {
    return 'Bổ sung minh chứng tình nguyện hoặc import sự kiện hợp lệ.';
  }
  return 'Bổ sung minh chứng phù hợp cho tiêu chí.';
}

function parseObject<T extends Record<string, unknown>>(value: unknown): Partial<T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<T>) : {};
}

function parseWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'code' in item) return String(item.code);
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
