import {
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  MetricType,
  VerificationStatus,
} from '@prisma/client';
import {
  getTrustedEvidenceCardFields,
  needsEvidenceConfirmation,
  normalizeConfirmationStatus,
} from '../evidences/evidence-card-confirmation';
import type {
  CompletionEvaluationInput,
  CompletionEvidence,
  CompletionMetric,
  CompletionResponse,
  CriterionCompletionDto,
  CriterionCompletionStatus,
  RequirementAggregationActivityDto,
  RequirementAggregationDto,
  RequirementDto,
  RequirementDtoStatus,
  RequirementGroupDto,
  RequirementResponseDto,
} from './criteria-completion.types';

export function evaluateCriterionCompletion(
  input: CompletionEvaluationInput,
): CriterionCompletionDto {
  const groups = input.groups.map((group) => evaluateGroup(group, input));
  const requiredRequirements = groups.flatMap((group) =>
    group.optional ? [] : group.requirements.filter((requirement) => !requirement.optional),
  );
  const required = requiredRequirements.length;
  const satisfied = requiredRequirements.filter(isRequirementSatisfied).length;
  const requiredGroups = groups.filter((group) => !group.optional);
  const needsVerification = requiredGroups.reduce(
    (total, group) => total + groupNeedsVerification(group),
    0,
  );
  const rejected = requiredGroups.reduce((total, group) => total + groupRejectedCount(group), 0);
  const groupResults = requiredGroups.map(isGroupSatisfied);
  const allGroupsSatisfied = groupResults.length > 0 && groupResults.every(Boolean);
  const hasAnyData = groups.some((group) =>
    group.requirements.some((requirement) =>
      requirement.currentResponses.some((response) => response.status !== 'superseded'),
    ),
  );
  const pendingRequirement = allGroupsSatisfied ? undefined : findPendingRequirement(requiredGroups);

  const status = overlayReviewStatus(
    input.reviewStatus,
    deriveCriterionStatus({
      hasAnyData,
      allGroupsSatisfied,
      needsVerification,
      rejected,
    }),
  );
  const nextAction =
    input.criterion === Criterion.physical && !hasAnyData
      ? {
          type: 'choose_physical_path',
          label: 'Chọn cách chứng minh Thể lực tốt',
          route: '/app/application',
        }
      : input.criterion === Criterion.volunteer
        ? buildVolunteerNextAction(groups, hasAnyData, pendingRequirement)
        : input.criterion === Criterion.integration
          ? buildIntegrationNextAction(groups, hasAnyData, pendingRequirement)
      : pendingRequirement?.nextAction
        ? {
            ...pendingRequirement.nextAction,
            requirementKey: pendingRequirement.key,
            route: '/app/application',
          }
        : null;

  return {
    criterion: input.criterion,
    title: input.title,
    description: input.description,
    status,
    requirementGroups: groups,
    completion: { satisfied, required, needsVerification },
    evidenceCount: input.evidenceCount,
    additionalAchievementRequired: groups.some(
      (group) =>
        (group.key === 'academic_additional_achievement' ||
          group.key === 'ethics_additional_achievements') &&
        !group.optional,
    ),
    nextAction,
  };
}

function buildVolunteerNextAction(
  groups: RequirementGroupDto[],
  hasAnyData: boolean,
  pendingRequirement?: RequirementDto,
): CriterionCompletionDto['nextAction'] {
  if (!hasAnyData) {
    return {
      type: 'add_volunteer_activity',
      label: 'Thêm hoạt động tình nguyện',
      route: '/app/application',
    };
  }
  if (!pendingRequirement) return null;
  const aggregationRequirements = groups.flatMap((group) =>
    group.requirements.filter((requirement) => requirement.type === 'activity_aggregation'),
  );
  for (const requirement of aggregationRequirements) {
    const missingActivity = requirement.aggregation?.activities.find(
      (activity) =>
        activity.status === 'needs_verification' &&
        (activity.exclusionReason === 'missing_converted_value' ||
          activity.exclusionReason === 'missing_activity_period'),
    );
    if (missingActivity?.activityName) {
      return {
        type: 'complete_volunteer_activity_value',
        label: `Bổ sung số ngày cho ${missingActivity.activityName}`,
        requirementKey: requirement.key,
        route: '/app/application',
      };
    }
    const threshold = requirement.aggregation?.threshold;
    if (
      typeof threshold === 'number' &&
      requirement.aggregation &&
      requirement.aggregation.verifiedTotal < threshold
    ) {
      const missing = Math.max(0, threshold - requirement.aggregation.verifiedTotal);
      return {
        type: 'missing_verified_volunteer_total',
        label: `Bạn còn thiếu ${missing} ${requirement.aggregation.unit} đã xác nhận theo dữ liệu hiện tại`,
        requirementKey: requirement.key,
        route: '/app/application',
      };
    }
  }
  if (pendingRequirement?.nextAction) {
    return {
      ...pendingRequirement.nextAction,
      requirementKey: pendingRequirement.key,
      route: '/app/application',
    };
  }
  return {
    type: 'find_verified_volunteer_activity',
    label: 'Tìm hoạt động đã xác nhận',
    route: '/app/event-library',
  };
}

function buildIntegrationNextAction(
  groups: RequirementGroupDto[],
  hasAnyData: boolean,
  pendingRequirement?: RequirementDto,
): CriterionCompletionDto['nextAction'] {
  if (!hasAnyData) {
    return {
      type: 'choose_integration_path',
      label: 'Chọn hình thức đáp ứng Hội nhập tốt',
      route: '/app/application',
    };
  }
  const requirements = groups.flatMap((group) => group.requirements);
  const foreignLanguage = requirements.find((requirement) => requirement.key === 'foreign_language');
  const languagePayload = asRecord(getFirstActiveResponse(foreignLanguage)?.payloadJson);
  if (
    pendingRequirement?.key === 'foreign_language' &&
    foreignLanguage &&
    getFirstActiveResponse(foreignLanguage) &&
    !stringValue(languagePayload.issuedDate)
  ) {
    return {
      type: 'complete_certificate_issue_date',
      label: 'Bổ sung ngày cấp chứng chỉ',
      requirementKey: foreignLanguage.key,
      route: '/app/application',
    };
  }
  const exchange = requirements.find((requirement) => requirement.key === 'international_exchange');
  const exchangePayload = asRecord(getFirstActiveResponse(exchange)?.payloadJson);
  if (exchange && getFirstActiveResponse(exchange) && !stringValue(exchangePayload.organizerLevel)) {
    return {
      type: 'complete_exchange_organizer_level',
      label: 'Bổ sung cấp tổ chức của hoạt động giao lưu',
      requirementKey: exchange.key,
      route: '/app/application',
    };
  }
  if (pendingRequirement?.nextAction) {
    return {
      ...pendingRequirement.nextAction,
      requirementKey: pendingRequirement.key,
      route: '/app/application',
    };
  }
  return null;
}

function getFirstActiveResponse(requirement?: RequirementDto) {
  return requirement?.currentResponses.find((response) => response.status !== 'superseded');
}

function evaluateGroup(
  group: RequirementGroupDto,
  input: CompletionEvaluationInput,
): RequirementGroupDto {
  return {
    ...group,
    requirements: group.requirements.map((requirement) => evaluateRequirement(requirement, input)),
  };
}

function evaluateRequirement(
  requirement: RequirementDto,
  input: CompletionEvaluationInput,
): RequirementDto {
  const explicit = input.responses
    .filter((response) => response.requirementKey === requirement.key)
    .map((response) => toExplicitResponseDto(response, requirement));
  const legacy = buildLegacyResponses(requirement, input);
  const currentResponses = [...explicit, ...legacy];
  const aggregation =
    requirement.type === 'activity_aggregation'
      ? buildRequirementAggregation(requirement, currentResponses)
      : undefined;
  return {
    ...requirement,
    currentResponses,
    aggregation,
    status: aggregation
      ? deriveAggregationStatus(currentResponses, aggregation, requirement)
      : deriveRequirementStatus(currentResponses, requirement.type),
  };
}

function buildLegacyResponses(
  requirement: RequirementDto,
  input: CompletionEvaluationInput,
): RequirementResponseDto[] {
  if (requirement.type === 'metric') {
    return [
      ...buildLegacyMetricResponses(requirement, input.metrics as CompletionMetric[]),
      ...buildLegacyMetricEvidenceResponses(requirement, input.evidences),
    ];
  }
  if (requirement.key === 'no_f_grade') {
    return buildAcademicNoFGradeResponses(input);
  }
  if (requirement.key === 'academic_period_valid') {
    return buildAcademicPeriodResponses(input);
  }
  if (requirement.type === 'activity_aggregation') {
    return buildLegacyAggregationResponses(requirement, input);
  }
  if (requirement.type === 'evidence') {
    const legacyMetricResponses =
      requirement.config?.metricType === MetricType.foreign_language_score
        ? buildLegacyMetricResponses(requirement, input.metrics as CompletionMetric[])
        : [];
    return [...legacyMetricResponses, ...buildLegacyEvidenceResponses(requirement, input.evidences)];
  }
  return [];
}

function buildLegacyMetricResponses(
  requirement: RequirementDto,
  metrics: CompletionMetric[],
): RequirementResponseDto[] {
  const metricType = requirement.config?.metricType;
  if (!metricType) return [];
  return metrics
    .filter((metric) => metric.metricType === metricType)
    .map((metric) => {
      const isLegacyVolunteerSummary =
        requirement.type === 'activity_aggregation' && metric.metricType === MetricType.volunteer_days;
      return {
        id: `legacy-metric-${metric.id}`,
        responseKind: 'legacy_metric',
        status: isLegacyVolunteerSummary
          ? 'needs_verification'
          : requirement.type === 'activity_aggregation' || isMetricValueAccepted(requirement, metric)
            ? metricVerificationStatus(metric.verificationStatus)
            : 'rejected',
        metricId: metric.id,
        source: 'legacy',
        payloadJson: {
          metricType: metric.metricType,
          ...buildMetricPayload(requirement, metric),
          activityType: isLegacyVolunteerSummary ? 'legacy_volunteer_days' : undefined,
          activityName: isLegacyVolunteerSummary ? 'Tổng số ngày tình nguyện đã khai báo' : undefined,
          declaredValue: isLegacyVolunteerSummary ? metric.value : undefined,
          declaredUnit: isLegacyVolunteerSummary ? 'day' : undefined,
          convertedValue: isLegacyVolunteerSummary ? metric.value : undefined,
          convertedUnit: isLegacyVolunteerSummary ? 'day' : undefined,
          conversionSource: isLegacyVolunteerSummary ? 'legacy_metric' : undefined,
          sourceType: isLegacyVolunteerSummary
            ? 'legacy_metric'
            : metric.verificationStatus === VerificationStatus.verified
              ? 'system_data'
              : 'manual_metric',
          source:
            metric.verificationStatus === VerificationStatus.verified && !isLegacyVolunteerSummary
              ? 'system_data'
              : ((metric as CompletionMetric).source ?? 'manual_metric'),
          verificationStatus: metric.verificationStatus,
          schoolYear: (metric as CompletionMetric).schoolYear,
          supportingEvidenceId: (metric as CompletionMetric).supportingEvidenceId,
        },
      };
    });
}

function buildLegacyMetricEvidenceResponses(
  requirement: RequirementDto,
  evidences: CompletionEvidence[],
): RequirementResponseDto[] {
  const metricType = requirement.config?.metricType;
  if (
    metricType !== MetricType.conduct_score &&
    metricType !== MetricType.gpa &&
    metricType !== MetricType.physical_score
  ) {
    return [];
  }
  return evidences
    .filter(
      (evidence) =>
        evidence.criterion === requirement.config?.criterion || !requirement.config?.criterion,
    )
    .map((evidence): RequirementResponseDto | null => {
      if (needsEvidenceConfirmation(evidence)) return evidenceNeedsConfirmationResponse(evidence, requirement);
      const fields = getTrustedEvidenceCardFields(evidence);
      const value =
        metricType === MetricType.gpa
          ? numericValue(fields.gpa ?? fields.GPA ?? fields.academic_gpa ?? fields.academicGpa)
          : metricType === MetricType.physical_score
            ? numericValue(
                fields.physical_score ??
                  fields.physicalScore ??
                  fields.score ??
                  fields.value,
              )
            : numericValue(fields.conduct_score ?? fields.conductScore);
      if (value === undefined) return null;
      const scale =
        metricType === MetricType.gpa
          ? (numericValue(fields.scale ?? fields.gpaScale ?? fields.rawScale) ?? 4)
          : metricType === MetricType.physical_score
            ? (numericValue(fields.scale ?? fields.physicalScale) ?? 10)
            : 100;
      return {
        id: `legacy-metric-evidence-${evidence.id}`,
        responseKind: 'legacy_evidence' as const,
        status: isMetricValueAccepted(requirement, {
          id: evidence.id,
          metricType,
          value,
          scale,
          verificationStatus: VerificationStatus.pending,
        })
          ? 'needs_verification'
          : 'rejected',
        evidenceId: evidence.id,
        source: 'legacy' as const,
        payloadJson: {
          metricType,
          ...buildMetricPayload(requirement, {
            id: evidence.id,
            metricType,
            value,
            scale,
            verificationStatus: VerificationStatus.pending,
          }),
          sourceType: 'manual_evidence',
          source: 'manual_evidence',
          verificationStatus: VerificationStatus.pending,
          schoolYear: stringValue(fields.schoolYear ?? fields.academicYear),
        },
      };
    })
    .filter((response): response is RequirementResponseDto => Boolean(response));
}

function buildAcademicNoFGradeResponses(
  input: CompletionEvaluationInput,
): RequirementResponseDto[] {
  if (input.responses.some((response) => response.requirementKey === 'no_f_grade')) return [];
  if (!hasAcademicGpaData(input)) return [];
  return [
    {
      id: 'derived-no-f-grade',
      responseKind: 'legacy_evidence',
      status: 'needs_verification',
      source: 'legacy',
      payloadJson: {
        sourceType: 'system_data',
        verificationStatus: VerificationStatus.pending,
      },
    },
  ];
}

function evidenceNeedsConfirmationResponse(
  evidence: CompletionEvidence,
  requirement: RequirementDto,
): RequirementResponseDto {
  return {
    id: `evidence-confirmation-${requirement.key}-${evidence.id}`,
    responseKind: 'legacy_evidence' as const,
    status: 'needs_verification',
    evidenceId: evidence.id,
    source: 'legacy' as const,
    payloadJson: {
      sourceType: evidence.sourceType,
      indexingStatus: evidence.indexingStatus,
      evidenceStatus: evidence.status,
      needsEvidenceConfirmation: true,
      evidenceId: evidence.id,
      confirmationStatus: normalizeConfirmationStatus(evidence.evidenceCard?.confirmationStatus),
    },
  };
}

function buildAcademicPeriodResponses(input: CompletionEvaluationInput): RequirementResponseDto[] {
  const schoolYear = input.schoolYear;
  const candidates = academicGpaSchoolYears(input);
  if (!candidates.length && !hasAcademicGpaData(input)) return [];
  const hasMatchingYear = Boolean(
    schoolYear && candidates.some((candidate) => candidate === schoolYear),
  );
  return [
    {
      id: 'derived-academic-period',
      responseKind: 'legacy_evidence',
      status: hasMatchingYear ? 'verified' : 'needs_verification',
      source: 'legacy',
      payloadJson: {
        schoolYear: candidates[0] ?? null,
        expectedSchoolYear: schoolYear ?? null,
        verificationStatus: hasMatchingYear
          ? VerificationStatus.verified
          : VerificationStatus.pending,
      },
    },
  ];
}

function buildLegacyAggregationResponses(
  requirement: RequirementDto,
  input: CompletionEvaluationInput,
): RequirementResponseDto[] {
  const metricResponses = buildLegacyMetricResponses(
    requirement,
    input.metrics as CompletionMetric[],
  );
  const evidenceResponses = buildLegacyEvidenceResponses(
    {
      ...requirement,
      type: 'evidence',
      config: {
        ...requirement.config,
        criterion: requirement.config?.criterion ?? input.criterion,
      },
    },
    input.evidences,
  ).map((response) => ({
    ...response,
    payloadJson: {
      ...asRecord(response.payloadJson),
      activityType:
        response.responseKind === 'legacy_event' ? 'official_event' : 'manual_volunteer_evidence',
      activityName: 'Hoạt động tình nguyện',
      convertedValue: extractEvidenceAggregationValue(
        input.evidences.find((evidence) => evidence.id === response.evidenceId),
        requirement.config?.valueField,
      ),
      convertedUnit: requirement.config?.aggregationUnit ?? 'day',
      conversionSource:
        response.responseKind === 'legacy_event' ? 'event_registry' : 'criteria_rule',
    },
  }));
  const confirmationResponses = input.evidences
    .filter((evidence) => {
      if (requirement.config?.criterion && evidence.criterion !== requirement.config.criterion) return false;
      return needsEvidenceConfirmation(evidence);
    })
    .map((evidence) => evidenceNeedsConfirmationResponse(evidence, requirement));

  return [...metricResponses, ...evidenceResponses, ...confirmationResponses].filter((response) => {
    const payload = asRecord(response.payloadJson);
    return (
      payload.needsEvidenceConfirmation === true ||
      typeof payload.value === 'number' ||
      typeof payload.convertedValue === 'number' ||
      response.metricId
    );
  });
}

function buildLegacyEvidenceResponses(
  requirement: RequirementDto,
  evidences: CompletionEvidence[],
): RequirementResponseDto[] {
  const criterion = requirement.config?.criterion;
  const sourceType = requirement.config?.sourceType;
  const evidenceType = requirement.config?.evidenceType;
  return evidences
    .filter((evidence) => {
      if (criterion && evidence.criterion !== criterion) return false;
      if (sourceType && evidence.sourceType !== sourceType) return false;
      if (evidenceType && !matchesEvidenceType(evidence, evidenceType)) return false;
      return true;
    })
    .map((evidence) => ({
      id: `legacy-evidence-${evidence.id}`,
      responseKind:
        evidence.sourceType === EvidenceSourceType.event_import
          ? 'legacy_event'
          : 'legacy_evidence',
      status: evidenceStatusToRequirementStatus(evidence),
      evidenceId: evidence.id,
      source: 'legacy',
      payloadJson: {
        sourceType: evidence.sourceType,
        indexingStatus: evidence.indexingStatus,
        evidenceStatus: evidence.status,
        value: extractEvidenceAggregationValue(evidence, requirement.config?.valueField),
        startDate: trustedEvidenceField(evidence, 'activity_date', 'activityDate', 'startDate'),
        endDate: trustedEvidenceField(evidence, 'activity_date', 'activityDate', 'endDate'),
        ...(needsEvidenceConfirmation(evidence)
          ? {
              needsEvidenceConfirmation: true,
              evidenceId: evidence.id,
              confirmationStatus: normalizeConfirmationStatus(evidence.evidenceCard?.confirmationStatus),
            }
          : {}),
      },
    }));
}

function buildRequirementAggregation(
  requirement: RequirementDto,
  responses: RequirementResponseDto[],
): RequirementAggregationDto {
  const unit = requirement.config?.aggregationUnit ?? 'day';
  const threshold = requirement.config?.threshold ?? requirement.config?.requiredValue;
  const activities = responses
    .filter((response) => response.status !== 'superseded')
    .map((response) => toAggregationActivity(response, requirement, unit));
  return {
    verifiedTotal: sumActivities(activities, 'verified'),
    pendingVerificationTotal: sumActivities(activities, 'pending'),
    excludedTotal: sumActivities(activities, 'excluded'),
    unit,
    threshold,
    activities,
  };
}

function toAggregationActivity(
  response: RequirementResponseDto,
  requirement: RequirementDto,
  unit: string,
): RequirementAggregationActivityDto {
  const payload = asRecord(response.payloadJson);
  const convertedValue =
    unit === 'event'
      ? (numericValue(payload.activityCount ?? payload.convertedValue ?? payload.value) ?? 1)
      : numericValue(payload.convertedValue ?? payload.value ?? payload.declaredValue);
  const hasMissingPeriod = hasActivityPeriod(payload) === false;
  const exclusionReason =
    response.status === 'rejected'
      ? 'rejected'
      : convertedValue === undefined
        ? 'missing_converted_value'
        : hasMissingPeriod
          ? 'missing_activity_period'
          : null;
  const countedValue = exclusionReason ? 0 : (convertedValue ?? 0);
  return {
    id: stringValue(payload.id) ?? response.id,
    applicationId: stringValue(payload.applicationId),
    requirementKey: requirement.key,
    activityType: stringValue(payload.activityType),
    activityName: stringValue(payload.activityName ?? payload.eventName ?? payload.name),
    organizer: stringValue(payload.organizer),
    organizerLevel: stringValue(payload.organizerLevel),
    startDate: stringValue(payload.startDate),
    endDate: stringValue(payload.endDate),
    declaredValue: numericValue(payload.declaredValue),
    declaredUnit: stringValue(payload.declaredUnit),
    convertedValue: convertedValue ?? null,
    convertedUnit: stringValue(payload.convertedUnit) ?? unit,
    conversionSource: stringValue(payload.conversionSource),
    sourceType: stringValue(payload.sourceType),
    evidenceId: response.evidenceId ?? stringValue(payload.evidenceId),
    eventId: stringValue(payload.eventId),
    status: response.status,
    countedValue,
    exclusionReason,
  };
}

function hasActivityPeriod(payload: Record<string, unknown>): boolean | undefined {
  const sourceType = stringValue(payload.sourceType);
  if (sourceType === 'event_import' || sourceType === 'official_event') return true;
  if (payload.activityType === 'legacy_volunteer_days') return true;
  const hasStart = Boolean(stringValue(payload.startDate));
  const hasEnd = Boolean(stringValue(payload.endDate));
  if (!hasStart && !hasEnd) return undefined;
  return hasStart && hasEnd;
}

function sumActivities(
  activities: RequirementAggregationActivityDto[],
  bucket: 'verified' | 'pending' | 'excluded',
): number {
  return activities.reduce((total, activity) => {
    if (bucket === 'excluded') {
      return total + (activity.exclusionReason ? activity.convertedValue ?? 0 : 0);
    }
    if (activity.exclusionReason) return total;
    if (bucket === 'verified') {
      return activity.status === 'verified' ? total + activity.countedValue : total;
    }
    return activity.status === 'declared' || activity.status === 'needs_verification'
      ? total + activity.countedValue
      : total;
  }, 0);
}

function deriveAggregationStatus(
  responses: RequirementResponseDto[],
  aggregation: RequirementAggregationDto,
  requirement: RequirementDto,
): RequirementDtoStatus {
  const active = responses.filter((response) => response.status !== 'superseded');
  if (active.length === 0) return 'not_started';
  const threshold = requirement.config?.requiredValue ?? requirement.config?.threshold;
  if (
    typeof threshold === 'number' &&
    compare(aggregation.verifiedTotal, requirement.config?.operator ?? '>=', threshold)
  ) {
    return 'verified';
  }
  if (
    active.some(
      (response) => response.status === 'declared' || response.status === 'needs_verification',
    ) ||
    aggregation.pendingVerificationTotal > 0
  ) {
    return 'needs_verification';
  }
  if (active.some((response) => response.status === 'verified')) return 'rejected';
  return 'rejected';
}

function deriveRequirementStatus(
  responses: RequirementResponseDto[],
  type?: RequirementDto['type'],
): RequirementDtoStatus {
  const active = responses.filter((response) => response.status !== 'superseded');
  if (active.length === 0) return 'not_started';
  if (
    type === 'activity_aggregation' &&
    active.some(
      (response) =>
        response.status === 'declared' ||
        response.status === 'processing' ||
        response.status === 'needs_verification',
    )
  ) {
    return 'needs_verification';
  }
  if (active.some((response) => response.status === 'verified')) return 'verified';
  if (active.some((response) => response.status === 'declared')) return 'declared';
  if (
    active.some(
      (response) => response.status === 'processing' || response.status === 'needs_verification',
    )
  ) {
    return 'needs_verification';
  }
  return 'rejected';
}

function isGroupSatisfied(group: RequirementGroupDto): boolean {
  const requirements = group.requirements.filter((requirement) => !requirement.optional);
  if (requirements.length === 0) return true;
  if (group.operator === 'one_of') return requirements.some(isRequirementSatisfied);
  if (group.operator === 'at_least_n') {
    return requirements.filter(isRequirementSatisfied).length >= (group.requiredCount ?? 1);
  }
  return requirements.every(isRequirementSatisfied);
}

function findPendingRequirement(groups: RequirementGroupDto[]): RequirementDto | undefined {
  for (const group of groups) {
    const requirements = group.requirements.filter((requirement) => !requirement.optional);
    const studentRequirements = requirements.filter(isStudentActionableRequirement);
    if (group.operator === 'one_of') {
      const pending =
        studentRequirements.find((requirement) => requirement.status === 'needs_verification') ??
        studentRequirements.find((requirement) => requirement.status === 'declared');
      if (pending) return pending;
      if (requirements.some(isRequirementSatisfied)) continue;
      const missing = studentRequirements.find((requirement) => !isRequirementSatisfied(requirement));
      if (missing) return missing;
      continue;
    }
    const missing = studentRequirements.find((requirement) => !isRequirementSatisfied(requirement));
    if (missing) return missing;
    const pending =
      studentRequirements.find((requirement) => requirement.status === 'needs_verification') ??
      studentRequirements.find((requirement) => requirement.status === 'declared');
    if (pending) return pending;
  }
  return undefined;
}

function groupNeedsVerification(group: RequirementGroupDto): number {
  const requirements = group.requirements.filter((requirement) => !requirement.optional);
  const studentRequirements = requirements.filter(isStudentActionableRequirement);
  if (group.operator === 'one_of') {
    if (requirements.some((requirement) => requirement.status === 'verified')) return 0;
    return studentRequirements.some(
      (requirement) =>
        requirement.status === 'declared' || requirement.status === 'needs_verification',
    )
      ? 1
      : 0;
  }
  if (group.operator === 'at_least_n' && isGroupSatisfied(group)) return 0;
  return studentRequirements.filter(
    (requirement) =>
      requirement.status === 'declared' || requirement.status === 'needs_verification',
  ).length;
}

function groupRejectedCount(group: RequirementGroupDto): number {
  const requirements = group.requirements.filter((requirement) => !requirement.optional);
  if (group.operator === 'one_of') {
    if (requirements.some(isRequirementSatisfied)) return 0;
    return requirements.some((requirement) => requirement.status === 'rejected') ? 1 : 0;
  }
  if (group.operator === 'at_least_n' && isGroupSatisfied(group)) return 0;
  return requirements.filter((requirement) => requirement.status === 'rejected').length;
}

function isRequirementSatisfied(requirement: RequirementDto): boolean {
  if (requirement.optional) return true;
  if (isNonBlockingReviewerVerification(requirement)) {
    return requirement.status !== 'rejected';
  }
  if (requirement.type === 'activity_aggregation') {
    const requiredValue = requirement.config?.requiredValue ?? requirement.config?.threshold;
    if (typeof requiredValue !== 'number') return requirement.currentResponses.length > 0;
    const aggregateTotal =
      (requirement.aggregation?.verifiedTotal ?? aggregateResponseValue(requirement)) +
      (requirement.aggregation?.pendingVerificationTotal ?? 0);
    return compare(
      aggregateTotal,
      requirement.config?.operator ?? '>=',
      requiredValue,
    );
  }
  return (
    requirement.status === 'verified' ||
    requirement.status === 'declared' ||
    requirement.status === 'needs_verification'
  );
}

function isStudentActionableRequirement(requirement: RequirementDto): boolean {
  return !isNonBlockingReviewerVerification(requirement);
}

function isNonBlockingReviewerVerification(requirement: RequirementDto): boolean {
  return (
    requirement.blocksSubmission === false &&
    (requirement.responsibility === 'reviewer' || requirement.responsibility === 'committee')
  );
}

function aggregateResponseValue(requirement: RequirementDto): number {
  return requirement.currentResponses.reduce((total, response) => {
    if (response.status === 'rejected' || response.status === 'superseded') return total;
    const payload = asRecord(response.payloadJson);
    if (response.status !== 'verified') return total;
    const value = numericValue(payload.convertedValue ?? payload.value) ?? 0;
    return total + value;
  }, 0);
}

function deriveCriterionStatus(input: {
  hasAnyData: boolean;
  allGroupsSatisfied: boolean;
  needsVerification: number;
  rejected: number;
}): CriterionCompletionStatus {
  if (input.rejected > 0) return 'precheck_warning';
  if (!input.hasAnyData) return 'not_started';
  if (input.allGroupsSatisfied) return 'ready_for_precheck';
  if (input.needsVerification > 0) return 'needs_verification';
  return 'in_progress';
}

function overlayReviewStatus(
  reviewStatus: string | null | undefined,
  fallback: CriterionCompletionStatus,
): CriterionCompletionStatus {
  if (reviewStatus === 'accepted') return 'accepted';
  if (reviewStatus === 'rejected') return 'rejected';
  if (reviewStatus === 'supplement_required') return 'supplement_required';
  if (reviewStatus === 'reviewing' || reviewStatus === 'waiting') return 'under_review';
  return fallback;
}

function toExplicitResponseDto(
  response: CompletionResponse,
  requirement: RequirementDto,
): RequirementResponseDto {
  const status =
    requirement.key === 'foreign_language'
      ? deriveForeignLanguageResponseStatus(requirement, response)
      : isIntegrationResponse(requirement)
        ? deriveIntegrationResponseStatus(requirement, response)
        : response.responseKind === 'metric' && isMetricPayloadRejected(requirement, response.payloadJson)
          ? 'rejected'
          : response.status;
  return {
    id: response.id,
    responseKind: response.responseKind,
    status,
    metricId: response.metricId,
    evidenceId: response.evidenceId,
    payloadJson:
      response.responseKind === 'metric'
        ? enrichMetricPayload(requirement, response.payloadJson, status)
        : response.payloadJson,
    source: 'explicit',
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
}

function isIntegrationResponse(requirement: RequirementDto) {
  return requirement.config?.criterion === Criterion.integration;
}

function deriveIntegrationResponseStatus(
  requirement: RequirementDto,
  response: CompletionResponse,
): RequirementResponseDto['status'] {
  if (response.status === 'superseded' || response.status === 'rejected') return response.status;
  const payload = asRecord(response.payloadJson);
  if (requirement.key === 'international_exchange' && !stringValue(payload.organizerLevel)) {
    return 'needs_verification';
  }
  if (requirement.key === 'skills_or_union_training' && !stringValue(payload.endDate)) {
    return 'needs_verification';
  }
  return response.status;
}

function deriveForeignLanguageResponseStatus(
  requirement: RequirementDto,
  response: CompletionResponse,
): RequirementResponseDto['status'] {
  if (response.status === 'superseded' || response.status === 'rejected') return response.status;
  const payload = asRecord(response.payloadJson);
  if (!stringValue(payload.issuedDate)) return 'needs_verification';
  const expiryDate = stringValue(payload.expiryDate);
  if (expiryDate && new Date(expiryDate).getTime() < Date.now()) return 'rejected';
  const rank = foreignLanguageRank(payload);
  if (rank === undefined) return 'needs_verification';
  const threshold = thresholdForStudyYear(requirement, payload) ?? requirement.config?.threshold;
  if (typeof threshold !== 'number') return response.status;
  return compare(rank, requirement.config?.operator ?? '>=', threshold)
    ? response.status === 'verified'
      ? 'verified'
      : response.status
    : 'rejected';
}

function thresholdForStudyYear(
  requirement: RequirementDto,
  payload: Record<string, unknown>,
): number | undefined {
  const studyYear = numericValue(payload.studyYear);
  if (studyYear === undefined || !requirement.config?.studyYearThresholds) return undefined;
  return requirement.config.studyYearThresholds[String(studyYear)];
}

function foreignLanguageRank(payload: Record<string, unknown>): number | undefined {
  const equivalent = stringValue(payload.equivalentLevel ?? payload.level)?.toUpperCase();
  const cefrRanks: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  if (equivalent && cefrRanks[equivalent] !== undefined) return cefrRanks[equivalent];

  const certificateType = stringValue(payload.certificateType)?.toUpperCase();
  const level = stringValue(payload.level)?.toUpperCase();
  const score = numericValue(payload.score);
  if (certificateType === 'IELTS' && score !== undefined) {
    if (score >= 6.5) return 4;
    if (score >= 4.5) return 3;
    if (score >= 4.0) return 2;
    return 1;
  }
  if (certificateType === 'TOEIC' && score !== undefined) {
    if (score >= 785) return 4;
    if (score >= 550) return 3;
    if (score >= 225) return 2;
    return 1;
  }
  if (certificateType === 'JLPT' && level) {
    const ranks: Record<string, number> = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
    return ranks[level];
  }
  if (certificateType === 'TOPIK' && level) {
    const value = Number(level.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(value)) return undefined;
    return Math.min(6, Math.max(1, value));
  }
  if (certificateType === 'HSK' && level) {
    const value = Number(level.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(value)) return undefined;
    return Math.min(6, Math.max(1, value));
  }
  return undefined;
}

function enrichMetricPayload(
  requirement: RequirementDto,
  payloadJson: unknown,
  status: RequirementResponseDto['status'],
) {
  const metricType = requirement.config?.metricType;
  if (!metricType) return payloadJson;
  const payload = asRecord(payloadJson);
  const value = numericValue(payload.value ?? payload.rawValue);
  if (value === undefined) return payloadJson;
  const scale = numericValue(payload.scale ?? payload.rawScale) ?? null;
  return {
    ...payload,
    metricType,
    ...buildMetricPayload(requirement, {
      id: 'explicit-metric',
      metricType,
      value,
      scale,
      verificationStatus:
        status === 'verified' ? VerificationStatus.verified : VerificationStatus.pending,
    }),
    source: payload.source ?? payload.sourceType,
    verificationStatus: status,
  };
}

function isMetricPayloadRejected(requirement: RequirementDto, payloadJson: unknown): boolean {
  const metricType = requirement.config?.metricType;
  if (!metricType) return false;
  const payload = asRecord(payloadJson);
  const value = numericValue(payload.value);
  if (value === undefined) return false;
  const scale = typeof payload.scale === 'number' ? payload.scale : null;
  return !isMetricValueAccepted(requirement, {
    id: 'explicit-metric',
    metricType,
    value,
    scale,
    verificationStatus: VerificationStatus.pending,
  });
}

function buildMetricPayload(requirement: RequirementDto, metric: CompletionMetric) {
  if (metric.metricType === MetricType.gpa) {
    const rawScale = metric.scale ?? 4;
    const normalizedValue = normalizeMetricValue(metric);
    const threshold = requirement.config?.threshold;
    return {
      value: metric.value,
      scale: rawScale,
      rawValue: metric.value,
      rawScale,
      normalizedValue,
      threshold,
      thresholdScale: 4,
    };
  }
  return {
    value: metric.value,
    scale: metric.scale,
  };
}

function normalizeMetricValue(metric: Pick<CompletionMetric, 'metricType' | 'value' | 'scale'>) {
  return metric.metricType === MetricType.gpa && metric.scale === 10
    ? metric.value / 2.5
    : metric.value;
}

function isMetricValueAccepted(requirement: RequirementDto, metric: CompletionMetric): boolean {
  const threshold = requirement.config?.threshold;
  if (typeof threshold !== 'number') return true;
  const value = normalizeMetricValue(metric);
  return compare(value, requirement.config?.operator ?? '>=', threshold);
}

function metricVerificationStatus(status: VerificationStatus): RequirementResponseDto['status'] {
  if (status === VerificationStatus.verified) return 'verified';
  if (status === VerificationStatus.rejected) return 'rejected';
  if (status === VerificationStatus.pending) return 'needs_verification';
  return 'declared';
}

function evidenceStatusToRequirementStatus(
  evidence: CompletionEvidence,
): RequirementResponseDto['status'] {
  if (evidence.status === EvidenceStatus.accepted) return 'verified';
  if (evidence.status === EvidenceStatus.rejected) return 'rejected';
  if (
    evidence.indexingStatus === IndexingStatus.pending_indexing ||
    evidence.indexingStatus === IndexingStatus.ocr_processing ||
    evidence.indexingStatus === IndexingStatus.extracting ||
    evidence.indexingStatus === IndexingStatus.checking_registry
  ) {
    return 'needs_verification';
  }
  if (evidence.indexingStatus === IndexingStatus.failed) return 'rejected';
  return evidence.sourceType === EvidenceSourceType.event_import
    ? 'verified'
    : 'needs_verification';
}

function extractEvidenceAggregationValue(
  evidence: CompletionEvidence | undefined,
  valueField?: string,
): number | undefined {
  if (!evidence) return undefined;
  if (
    evidence.event?.convertedUnit === 'days' &&
    typeof evidence.event.convertedValue === 'number'
  ) {
    return evidence.event.convertedValue;
  }
  const fields = asRecord(
    getTrustedEvidenceCardFields(evidence),
  );
  const configured = valueField ? fields[valueField] : undefined;
  if (typeof configured === 'number') return configured;
  if (typeof fields.volunteer_days === 'number') return fields.volunteer_days;
  if (typeof fields.volunteerDays === 'number') return fields.volunteerDays;
  return undefined;
}

function matchesEvidenceType(evidence: CompletionEvidence, evidenceType: string): boolean {
  const fields = getTrustedEvidenceCardFields(evidence);
  return (
    fields.evidenceType === evidenceType ||
    fields.ethicsAchievementType === evidenceType ||
    fields.achievementType === evidenceType ||
    fields.physicalPath === evidenceType ||
    fields.physicalEvidenceType === evidenceType ||
    fields.volunteerPath === evidenceType ||
    fields.volunteerEvidenceType === evidenceType ||
    fields.integrationPath === evidenceType ||
    fields.integrationEvidenceType === evidenceType ||
    fields.certificateType === evidenceType ||
    fields.resultForm === evidenceType ||
    fields.activityType === evidenceType ||
    fields.pathType === evidenceType
  );
}

function trustedEvidenceField(evidence: CompletionEvidence, ...keys: string[]): unknown {
  const fields = getTrustedEvidenceCardFields(evidence);
  return keys.map((key) => fields[key]).find((value) => value !== undefined && value !== null);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function hasAcademicGpaData(input: CompletionEvaluationInput): boolean {
  return (
    input.metrics.some((metric) => metric.metricType === MetricType.gpa) ||
    input.responses.some((response) => response.requirementKey === 'academic_gpa') ||
    input.evidences.some((evidence) => evidence.criterion === Criterion.academic)
  );
}

function academicGpaSchoolYears(input: CompletionEvaluationInput): string[] {
  const values = [
    ...input.responses
      .filter((response) => response.requirementKey === 'academic_gpa')
      .map((response) => stringValue(asRecord(response.payloadJson).schoolYear)),
    ...(input.metrics as CompletionMetric[])
      .filter((metric) => metric.metricType === MetricType.gpa)
      .map((metric) => metric.schoolYear),
    ...input.evidences
      .filter((evidence) => evidence.criterion === Criterion.academic)
      .map((evidence) => {
        const fields = getTrustedEvidenceCardFields(evidence);
        return stringValue(fields.schoolYear ?? fields.academicYear);
      }),
  ];
  return values.filter((value): value is string => Boolean(value));
}

function compare(actual: number, operator: string, threshold: number): boolean {
  if (operator === '>') return actual > threshold;
  if (operator === '<=') return actual <= threshold;
  if (operator === '<') return actual < threshold;
  if (operator === '==') return actual === threshold;
  return actual >= threshold;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
