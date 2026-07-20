import type {
  ApplicationMetric,
  Criterion,
  EvidenceStatus,
  IndexingStatus,
  MetricType,
  RequirementResponseKind,
  RequirementResponseStatus,
  VerificationStatus,
} from '@prisma/client';

export type RequirementGroupOperator = 'all_of' | 'one_of' | 'at_least_n';
export type RequirementType =
  'metric' | 'evidence' | 'system_confirmation' | 'activity_aggregation';
export type RequirementSourceType =
  'system_data' | 'official_event' | 'manual_evidence' | 'manual_metric';
export type CriterionCompletionStatus =
  | 'not_started'
  | 'in_progress'
  | 'needs_verification'
  | 'ready_for_precheck'
  | 'precheck_warning'
  | 'supplement_required'
  | 'under_review'
  | 'accepted'
  | 'rejected';

export type RequirementDtoStatus =
  'not_started' | 'declared' | 'needs_verification' | 'verified' | 'rejected';

export interface RequirementResponseDto {
  id: string;
  responseKind: RequirementResponseKind | 'legacy_metric' | 'legacy_evidence' | 'legacy_event';
  status: RequirementResponseStatus | 'declared' | 'needs_verification' | 'verified' | 'rejected';
  metricId?: string | null;
  evidenceId?: string | null;
  payloadJson?: unknown;
  source: 'explicit' | 'legacy';
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface RequirementDto {
  key: string;
  title: string;
  description?: string;
  type: RequirementType;
  status: RequirementDtoStatus;
  optional: boolean;
  acceptedSources: RequirementSourceType[];
  formSchema?: unknown;
  currentResponses: RequirementResponseDto[];
  aggregation?: RequirementAggregationDto;
  nextAction?: {
    type: string;
    label: string;
  };
  config?: RequirementEvaluationConfig;
}

export interface RequirementAggregationDto {
  verifiedTotal: number;
  pendingVerificationTotal: number;
  excludedTotal: number;
  unit: string;
  threshold?: number;
  activities: RequirementAggregationActivityDto[];
}

export interface RequirementAggregationActivityDto {
  id: string;
  applicationId?: string | null;
  requirementKey: string;
  activityType?: string | null;
  activityName?: string | null;
  organizer?: string | null;
  organizerLevel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  declaredValue?: number | null;
  declaredUnit?: string | null;
  convertedValue?: number | null;
  convertedUnit?: string | null;
  conversionSource?: string | null;
  sourceType?: string | null;
  evidenceId?: string | null;
  eventId?: string | null;
  status: string;
  countedValue: number;
  exclusionReason?: string | null;
}

export interface RequirementGroupDto {
  key: string;
  title: string;
  operator: RequirementGroupOperator;
  requiredCount?: number;
  optional: boolean;
  formSchema?: unknown;
  requirements: RequirementDto[];
}

export interface CriterionCompletionDto {
  criterion: Criterion;
  title: string;
  description: string;
  status: CriterionCompletionStatus;
  requirementGroups: RequirementGroupDto[];
  completion: {
    satisfied: number;
    required: number;
    needsVerification: number;
  };
  evidenceCount: number;
  additionalAchievementRequired?: boolean;
  nextAction: {
    type: string;
    label: string;
    requirementKey?: string;
    route?: string;
    evidenceId?: string;
    destination?: string;
  } | null;
}

export interface RequirementEvaluationConfig {
  metricType?: MetricType;
  operator?: '>=' | '>' | '<=' | '<' | '==';
  threshold?: number;
  criterion?: Criterion;
  sourceType?: string;
  requiredValue?: number;
  valueField?: string;
  evidenceType?: string;
  aggregationUnit?: string;
  studyYearThresholds?: Record<string, number>;
}

export interface CompletionMetric {
  id: string;
  metricType: MetricType;
  value: number;
  scale: number | null;
  verificationStatus: VerificationStatus;
  schoolYear?: string | null;
  source?: string | null;
  supportingEvidenceId?: string | null;
}

export interface CompletionEvidence {
  id: string;
  criterion: Criterion;
  sourceType: string;
  status: EvidenceStatus;
  indexingStatus: IndexingStatus;
  confidence: number | null;
  event?: {
    convertedValue: number | null;
    convertedUnit: string | null;
  } | null;
  evidenceCard?: {
    extractedFieldsJson?: unknown;
    normalizedFieldsJson?: unknown;
    confirmedFieldsJson?: unknown;
    confirmationStatus?: string | null;
    requiresHumanConfirmation?: boolean | null;
    warningsJson?: unknown;
    confidence?: number | null;
    provider?: string | null;
  } | null;
}

export interface CompletionResponse {
  id: string;
  criterion: Criterion;
  requirementKey: string;
  responseKind: RequirementResponseKind;
  metricId: string | null;
  evidenceId: string | null;
  payloadJson: unknown;
  status: RequirementResponseStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompletionEvaluationInput {
  criterion: Criterion;
  title: string;
  description: string;
  groups: RequirementGroupDto[];
  metrics: CompletionMetric[] | ApplicationMetric[];
  evidences: CompletionEvidence[];
  responses: CompletionResponse[];
  reviewStatus?: string | null;
  evidenceCount: number;
  schoolYear?: string | null;
}
