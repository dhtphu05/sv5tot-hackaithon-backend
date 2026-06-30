import type {
  Application,
  ApplicationMetric,
  CriteriaRule,
  CriteriaVersion,
  Criterion,
  Evidence,
  EvidenceCard,
  EventRegistry,
  Level,
  MetricType,
} from '@prisma/client';

export type CriterionStatus = 'passed' | 'failed' | 'missing' | 'human_review_required';
export type LevelReviewStatus =
  'likely_passed' | 'likely_failed' | 'missing' | 'human_review_required';
export type MissingItemSeverity = 'blocking' | 'warning' | 'info';
export type SupportedRuleType =
  | 'metric_threshold'
  | 'evidence_required'
  | 'evidence_or_metric'
  | 'event_import_allowed'
  | 'human_review_note'
  | 'composite_all'
  | 'composite_any';

export type MissingItem = {
  criterion: Criterion;
  code: string;
  message: string;
  severity: MissingItemSeverity;
  suggestedAction: string;
};

export type CriterionResult = {
  criterion: Criterion;
  status: CriterionStatus;
  score: number;
  requiredItems: string[];
  matchedItems: string[];
  missingItems: string[];
  warnings: string[];
  explanation: string;
  evidenceRefs: string[];
  metricRefs: string[];
};

export type LevelReviewResult = {
  level: Level;
  status: LevelReviewStatus;
  readinessScore: number;
  criteriaResults: CriterionResult[];
  missingItems: MissingItem[];
  warnings: string[];
  confidence: number;
  explanation: string;
};

export type CriteriaRuleConfig = Pick<
  CriteriaRule,
  | 'criterion'
  | 'ruleKey'
  | 'ruleType'
  | 'thresholdJson'
  | 'evidenceRequirementsJson'
  | 'humanReadableText'
>;

export type CriteriaRuleBundle = {
  criteriaVersionId: string | null;
  versionName: string;
  schoolYear: string;
  unitScope: string;
  level: Level;
  isFallback: boolean;
  warnings: string[];
  rules: CriteriaRuleConfig[];
};

export type EvidenceWithCard = Evidence & {
  evidenceCard: EvidenceCard | null;
  event: EventRegistry | null;
};

export type RuleContext = {
  application: Application;
  metrics: ApplicationMetric[];
  evidences: EvidenceWithCard[];
  evidenceCards: EvidenceCard[];
  eventImports: EvidenceWithCard[];
  criteriaRules: CriteriaRuleConfig[];
  targetLevel: Level;
  schoolYear: string;
  criteriaVersion?: Pick<CriteriaVersion, 'id' | 'versionName'> | null;
  criteriaWarnings?: string[];
};

export type ThresholdConfig = {
  metric?: MetricType;
  operator?: '>=' | '>' | '<=' | '<' | '==';
  value?: number;
};
