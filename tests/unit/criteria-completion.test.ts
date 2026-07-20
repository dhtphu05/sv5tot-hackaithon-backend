import {
  Criterion,
  EvidenceSourceType,
  EvidenceStatus,
  IndexingStatus,
  MetricType,
  RequirementResponseKind,
  RequirementResponseStatus,
  VerificationStatus,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { evaluateCriterionCompletion } from '../../src/modules/criteria-completion/criteria-completion.evaluator';
import { buildRequirementGroupsByCriterion } from '../../src/modules/criteria-completion/criteria-requirement.parser';
import {
  assertNoDuplicateVolunteerEvent,
  assertRequirementStatusMutationAllowed,
} from '../../src/modules/criteria-completion/criteria-completion.service';
import type {
  CompletionEvaluationInput,
  CompletionEvidence,
  CompletionMetric,
  CompletionResponse,
  RequirementGroupDto,
} from '../../src/modules/criteria-completion/criteria-completion.types';
import { assertSameWorkspace } from '../../src/shared/utils/workspace-scope';

const schoolEthicsRules = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'school_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 82 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Conduct score >= 82',
  },
  {
    criterion: Criterion.ethics,
    ruleKey: 'school_ethics_no_violation_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'NO_VIOLATION_NEEDS_REVIEW' },
    humanReadableText: 'No violation confirmation',
  },
] as const;

const schoolAcademicRules = [
  {
    criterion: Criterion.academic,
    ruleKey: 'school_academic_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3 },
    evidenceRequirementsJson: null,
    humanReadableText: 'GPA >= 3.0',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'school_academic_no_f_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'NO_F_GRADE_NEEDS_REVIEW' },
    humanReadableText: 'No F grade confirmation',
  },
] as const;

const schoolPhysicalRules = [
  {
    criterion: Criterion.physical,
    ruleKey: 'school_physical_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.physical_score, operator: '>=', value: 6.5 },
    evidenceRequirementsJson: { criterion: Criterion.physical },
    humanReadableText: 'Physical score >= 6.5',
  },
] as const;

const schoolVolunteerRules = [
  {
    criterion: Criterion.volunteer,
    ruleKey: 'school_volunteer_days_or_evidence',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 2 },
    evidenceRequirementsJson: { criterion: Criterion.volunteer, convertedUnit: 'days' },
    humanReadableText: 'Volunteer days >= 2',
  },
] as const;

const schoolIntegrationRules = [
  {
    criterion: Criterion.integration,
    ruleKey: 'school_integration_evidence_or_language',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 2 },
    evidenceRequirementsJson: {
      criterion: Criterion.integration,
      studyYearThresholds: { '1': 2, '2': 2, '3': 3, '4': 3, '5': 3 },
    },
    humanReadableText: 'Integration path',
  },
] as const;

const metricBase = {
  applicationId: 'app-1',
  evidenceFileId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function metric(
  metricType: MetricType,
  value: number,
  verificationStatus: VerificationStatus = VerificationStatus.verified,
  scale?: number | null,
  schoolYear?: string | null,
): CompletionMetric {
  return {
    ...metricBase,
    id: `metric-${metricType}`,
    metricType,
    value,
    scale: scale ?? (metricType === MetricType.gpa ? 4 : null),
    verificationStatus,
    schoolYear,
  };
}

function evidence(input: Partial<CompletionEvidence> & { id: string }): CompletionEvidence {
  return {
    id: input.id,
    criterion: input.criterion ?? Criterion.volunteer,
    sourceType: input.sourceType ?? EvidenceSourceType.manual_upload,
    status: input.status ?? EvidenceStatus.indexed,
    indexingStatus: input.indexingStatus ?? IndexingStatus.indexed,
    confidence: input.confidence ?? 0.9,
    event: input.event ?? null,
    evidenceCard: input.evidenceCard ?? null,
  };
}

function explicitResponse(
  requirementKey: string,
  status: RequirementResponseStatus = RequirementResponseStatus.verified,
  criterion: Criterion = Criterion.ethics,
): CompletionResponse {
  return {
    id: `response-${requirementKey}`,
    criterion,
    requirementKey,
    responseKind: RequirementResponseKind.system_confirmation,
    metricId: null,
    evidenceId: null,
    payloadJson: null,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function explicitMetricResponse(
  requirementKey: string,
  value: number,
  status: RequirementResponseStatus = RequirementResponseStatus.declared,
  criterion: Criterion = Criterion.ethics,
  scale = 100,
  schoolYear?: string,
): CompletionResponse {
  return {
    id: `response-${requirementKey}-metric`,
    criterion,
    requirementKey,
    responseKind: RequirementResponseKind.metric,
    metricId: `metric-${requirementKey}`,
    evidenceId: null,
    payloadJson: { value, scale, schoolYear, sourceType: 'manual_metric' },
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function explicitPathResponse(
  requirementKey: string,
  status: RequirementResponseStatus = RequirementResponseStatus.verified,
  payloadJson: Record<string, unknown> = {},
): CompletionResponse {
  return {
    id: `response-${requirementKey}-path`,
    criterion: Criterion.physical,
    requirementKey,
    responseKind: RequirementResponseKind.evidence,
    metricId: null,
    evidenceId: `evidence-${requirementKey}`,
    payloadJson,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function explicitVolunteerActivity(
  requirementKey: 'accumulated_volunteer_days' | 'activity_count',
  input: {
    id: string;
    status?: RequirementResponseStatus;
    activityName: string;
    convertedValue?: number | null;
    convertedUnit?: string;
    activityType?: string;
    startDate?: string | null;
    endDate?: string | null;
    sourceType?: string;
    eventId?: string | null;
  },
): CompletionResponse {
  return {
    id: input.id,
    criterion: Criterion.volunteer,
    requirementKey,
    responseKind:
      input.sourceType === 'official_event'
        ? RequirementResponseKind.official_event
        : RequirementResponseKind.evidence,
    metricId: null,
    evidenceId: `evidence-${input.id}`,
    payloadJson: {
      id: input.id,
      requirementKey,
      activityType: input.activityType ?? 'volunteer_activity',
      activityName: input.activityName,
      organizer: 'HSV',
      organizerLevel: 'school',
      startDate: input.startDate === undefined ? '2025-07-01' : input.startDate,
      endDate: input.endDate === undefined ? '2025-07-02' : input.endDate,
      declaredValue: input.convertedValue ?? null,
      declaredUnit: input.convertedUnit ?? 'day',
      convertedValue: input.convertedValue ?? null,
      convertedUnit: input.convertedUnit ?? 'day',
      conversionSource: input.sourceType === 'official_event' ? 'event_registry' : 'criteria_rule',
      sourceType: input.sourceType ?? 'manual_evidence',
      eventId: input.eventId ?? null,
    },
    status: input.status ?? RequirementResponseStatus.verified,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function explicitIntegrationPathResponse(
  requirementKey: string,
  payloadJson: Record<string, unknown>,
  status: RequirementResponseStatus = RequirementResponseStatus.verified,
): CompletionResponse {
  return {
    id: `response-${requirementKey}-integration`,
    criterion: Criterion.integration,
    requirementKey,
    responseKind: RequirementResponseKind.evidence,
    metricId: null,
    evidenceId: `evidence-${requirementKey}`,
    payloadJson: {
      evidenceType: requirementKey,
      integrationPath: requirementKey,
      sourceType: 'manual_evidence',
      ...payloadJson,
    },
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function ethicsGroups() {
  return buildRequirementGroupsByCriterion([...schoolEthicsRules])[Criterion.ethics];
}

function academicGroups() {
  return buildRequirementGroupsByCriterion([...schoolAcademicRules])[Criterion.academic];
}

function physicalGroups() {
  return buildRequirementGroupsByCriterion([...schoolPhysicalRules])[Criterion.physical];
}

function volunteerGroups() {
  return buildRequirementGroupsByCriterion([...schoolVolunteerRules])[Criterion.volunteer];
}

function integrationGroups() {
  return buildRequirementGroupsByCriterion([...schoolIntegrationRules])[Criterion.integration];
}

function evaluate(overrides: Partial<CompletionEvaluationInput>) {
  const input: CompletionEvaluationInput = {
    criterion: Criterion.ethics,
    title: 'Đạo đức tốt',
    description: 'Test criterion',
    groups: [],
    metrics: [],
    evidences: [],
    responses: [],
    evidenceCount: 0,
    schoolYear: '2025-2026',
    ...overrides,
  };
  return evaluateCriterionCompletion(input);
}

function findRequirementInResult(
  result: ReturnType<typeof evaluateCriterionCompletion>,
  requirementKey: string,
) {
  return result.requirementGroups
    .flatMap((group) => group.requirements)
    .find((requirement) => requirement.key === requirementKey);
}

describe('criteria completion evaluator', () => {
  it('marks school ethics ready when conduct score is verified and no_violation is verified', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      metrics: [metric(MetricType.conduct_score, 85, VerificationStatus.verified)],
      responses: [explicitResponse('no_violation', RequirementResponseStatus.verified)],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 2, required: 2, needsVerification: 0 });
  });

  it('marks school ethics ready for precheck when manual conduct score is present', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      metrics: [metric(MetricType.conduct_score, 85, VerificationStatus.unverified)],
      responses: [explicitResponse('no_violation', RequirementResponseStatus.verified)],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 2, required: 2, needsVerification: 1 });
  });

  it('returns precheck_warning when conduct score is below threshold', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      metrics: [metric(MetricType.conduct_score, 70, VerificationStatus.verified)],
      responses: [explicitResponse('no_violation', RequirementResponseStatus.verified)],
    });

    expect(result.status).toBe('precheck_warning');
  });

  it('returns precheck_warning when declared conduct score is below threshold', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      responses: [
        explicitMetricResponse('conduct_score', 70),
        explicitResponse('no_violation', RequirementResponseStatus.verified),
      ],
    });

    expect(result.status).toBe('precheck_warning');
  });

  it('keeps reviewer-owned no_violation pending without blocking school ethics submission readiness', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      metrics: [metric(MetricType.conduct_score, 85, VerificationStatus.verified)],
    });
    const noViolation = findRequirementInResult(result, 'no_violation');

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 2, required: 2, needsVerification: 0 });
    expect(result.nextAction).toBeNull();
    expect(noViolation).toMatchObject({
      status: 'not_started',
      responsibility: 'reviewer',
      blocksSubmission: false,
      verificationStage: 'review',
    });
  });

  it('does not let students verify no_violation', () => {
    expect(() =>
      assertRequirementStatusMutationAllowed(
        { role: 'student' as never },
        'no_violation',
        RequirementResponseStatus.verified,
        RequirementResponseKind.system_confirmation,
      ),
    ).toThrow('Students cannot confirm no_violation');
  });

  it('does not block school ethics when optional achievements are missing', () => {
    const result = evaluate({
      criterion: Criterion.ethics,
      groups: ethicsGroups(),
      metrics: [metric(MetricType.conduct_score, 85, VerificationStatus.verified)],
      responses: [explicitResponse('no_violation', RequirementResponseStatus.verified)],
    });

    const optionalGroup = result.requirementGroups.find(
      (group) => group.key === 'ethics_additional_achievements',
    );
    expect(optionalGroup?.optional).toBe(true);
    expect(result.status).toBe('ready_for_precheck');
  });

  it('marks school academic ready when GPA is verified, in period, and no_f_grade is verified', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 3.2, VerificationStatus.verified, 4, '2025-2026')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 3, required: 3, needsVerification: 0 });
  });

  it('normalizes GPA from scale 10 before evaluating academic threshold', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 8, VerificationStatus.verified, 10, '2025-2026')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
    });

    const gpa = result.requirementGroups[0].requirements.find(
      (requirement) => requirement.key === 'academic_gpa',
    );
    expect(result.status).toBe('ready_for_precheck');
    expect(gpa?.currentResponses[0].payloadJson).toMatchObject({
      rawValue: 8,
      rawScale: 10,
      normalizedValue: 3.2,
      threshold: 3,
      thresholdScale: 4,
    });
  });

  it('keeps academic ready for precheck when only reviewer no_f_grade confirmation remains', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 3.2, VerificationStatus.verified, 4, '2025-2026')],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.nextAction).toBeNull();
  });

  it('keeps academic ready for precheck when GPA exists but school year needs review', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 3.2, VerificationStatus.verified, 4, '2024-2025')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
      schoolYear: '2025-2026',
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.nextAction).toBeNull();
  });

  it('returns precheck_warning when academic GPA is below threshold', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 2.7, VerificationStatus.verified, 4, '2025-2026')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
    });

    expect(result.status).toBe('precheck_warning');
  });

  it('does not block school academic when optional achievements are missing', () => {
    const result = evaluate({
      criterion: Criterion.academic,
      groups: academicGroups(),
      metrics: [metric(MetricType.gpa, 3.2, VerificationStatus.verified, 4, '2025-2026')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
    });

    const optionalGroup = result.requirementGroups.find(
      (group) => group.key === 'academic_additional_achievement',
    );
    expect(optionalGroup?.optional).toBe(true);
    expect(result.status).toBe('ready_for_precheck');
  });

  it('re-evaluates academic additional achievements when target level requires them', () => {
    const groups = academicGroups().map((group) =>
      group.key === 'academic_additional_achievement'
        ? {
            ...group,
            optional: false,
            requirements: group.requirements.map((requirement) => ({
              ...requirement,
              optional: false,
            })),
          }
        : group,
    );
    const result = evaluate({
      criterion: Criterion.academic,
      groups,
      metrics: [metric(MetricType.gpa, 3.2, VerificationStatus.verified, 4, '2025-2026')],
      responses: [
        explicitResponse('no_f_grade', RequirementResponseStatus.verified, Criterion.academic),
      ],
    });

    expect(result.status).toBe('in_progress');
    expect(result.nextAction?.label).toContain('Bá»• sung');
  });

  it('does not let students verify no_f_grade', () => {
    expect(() =>
      assertRequirementStatusMutationAllowed(
        { role: 'student' as never },
        'no_f_grade',
        RequirementResponseStatus.verified,
        RequirementResponseKind.system_confirmation,
      ),
    ).toThrow('Students cannot verify no_f_grade');
  });

  it('requires every required item in all_of groups', () => {
    const groups: RequirementGroupDto[] = [
      {
        key: 'all',
        title: 'All requirements',
        operator: 'all_of',
        optional: false,
        requirements: [
          {
            key: 'gpa',
            title: 'GPA',
            type: 'metric',
            status: 'not_started',
            optional: false,
            acceptedSources: ['system_data'],
            currentResponses: [],
            config: { metricType: MetricType.gpa, threshold: 3, operator: '>=' },
          },
          {
            key: 'conduct',
            title: 'Conduct',
            type: 'metric',
            status: 'not_started',
            optional: false,
            acceptedSources: ['system_data'],
            currentResponses: [],
            config: { metricType: MetricType.conduct_score, threshold: 80, operator: '>=' },
          },
        ],
      },
    ];

    const result = evaluate({ groups, metrics: [metric(MetricType.gpa, 3.2)] });

    expect(result.status).toBe('in_progress');
    expect(result.completion).toMatchObject({ satisfied: 1, required: 2 });
  });

  it('marks physical ready when physical course score is verified and satisfies rule', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      metrics: [metric(MetricType.physical_score, 7)],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.requirementGroups[0].key).toBe('physical_path');
    expect(result.requirementGroups[0].requirements[0].key).toBe('physical_course_result');
  });

  it('marks physical ready when healthy student title is verified', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      responses: [explicitPathResponse('healthy_student_title')],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 1, required: 5, needsVerification: 0 });
  });

  it('marks physical ready for precheck when sports award evidence is waiting review', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      responses: [
        explicitPathResponse(
          'sports_activity_or_award',
          RequirementResponseStatus.needs_verification,
        ),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.nextAction).toBeNull();
  });

  it('asks for club confirmation when regular sports training is incomplete', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      responses: [
        explicitPathResponse('regular_sports_training', RequirementResponseStatus.needs_verification, {
          clubOrTeamName: 'Running Club',
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.nextAction).toBeNull();
  });

  it('satisfies physical one_of when one of multiple paths is verified', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      responses: [
        explicitPathResponse('sports_activity_or_award', RequirementResponseStatus.rejected),
        explicitPathResponse('sports_team_member', RequirementResponseStatus.verified),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
    const team = result.requirementGroups[0].requirements.find(
      (requirement) => requirement.key === 'sports_team_member',
    );
    expect(team?.status).toBe('verified');
  });

  it('ignores superseded physical responses when evaluating one_of', () => {
    const result = evaluate({
      criterion: Criterion.physical,
      groups: physicalGroups(),
      responses: [
        explicitPathResponse('sports_team_member', RequirementResponseStatus.superseded),
      ],
    });

    expect(result.status).toBe('not_started');
    expect(result.nextAction?.label).toBe('Chọn cách chứng minh Thể lực tốt');
  });

  it('does not expose physical as a hardcoded single metric group', () => {
    const groups = physicalGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'physical_path', operator: 'one_of' });
    expect(groups[0].requirements.map((requirement) => requirement.key)).toEqual([
      'physical_course_result',
      'healthy_student_title',
      'sports_activity_or_award',
      'sports_team_member',
      'regular_sports_training',
    ]);
  });

  it('supports at_least_n explicit groups', () => {
    const groups = buildRequirementGroupsByCriterion([
      {
        criterion: Criterion.integration,
        ruleKey: 'integration_options',
        ruleType: 'composite_any',
        thresholdJson: null,
        evidenceRequirementsJson: {
          requirementGroups: [
            {
              key: 'integration_any_two',
              operator: 'at_least_n',
              requiredCount: 2,
              requirements: [
                { key: 'r1', title: 'One', type: 'system_confirmation' },
                { key: 'r2', title: 'Two', type: 'system_confirmation' },
                { key: 'r3', title: 'Three', type: 'system_confirmation' },
              ],
            },
          ],
        },
        humanReadableText: 'Any two',
      },
    ])[Criterion.integration];

    const result = evaluate({
      criterion: Criterion.integration,
      groups,
      responses: [explicitResponse('r1'), explicitResponse('r2')],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion).toMatchObject({ satisfied: 2, required: 3 });
  });

  it('aggregates multiple verified volunteer activities into verifiedTotal', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      responses: [
        explicitVolunteerActivity('accumulated_volunteer_days', {
          id: 'green-summer',
          activityName: 'Mùa hè xanh',
          convertedValue: 2,
        }),
        explicitVolunteerActivity('accumulated_volunteer_days', {
          id: 'blood-donation',
          activityName: 'Hiến máu',
          activityType: 'blood_donation',
          convertedValue: 1,
        }),
      ],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('ready_for_precheck');
    expect(days?.aggregation).toMatchObject({
      verifiedTotal: 3,
      pendingVerificationTotal: 0,
      threshold: 2,
      unit: 'day',
    });
  });

  it('does not count pending volunteer activity toward verifiedTotal but allows precheck submission', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      responses: [
        explicitVolunteerActivity('accumulated_volunteer_days', {
          id: 'green-sunday',
          activityName: 'Chủ nhật xanh',
          convertedValue: 2,
          status: RequirementResponseStatus.needs_verification,
        }),
      ],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('ready_for_precheck');
    expect(days?.aggregation).toMatchObject({
      verifiedTotal: 0,
      pendingVerificationTotal: 2,
    });
  });

  it('keeps legacy volunteer_days metric as pending summary while allowing precheck submission', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      metrics: [metric(MetricType.volunteer_days, 3, VerificationStatus.verified)],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('ready_for_precheck');
    expect(days?.aggregation).toMatchObject({
      verifiedTotal: 0,
      pendingVerificationTotal: 3,
    });
    expect(days?.currentResponses[0].status).toBe('needs_verification');
  });

  it('imports official volunteer event as verified activity', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      evidences: [
        evidence({
          id: 'event-1',
          sourceType: EvidenceSourceType.event_import,
          event: { convertedValue: 2, convertedUnit: 'days' },
        }),
      ],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('ready_for_precheck');
    expect(days?.aggregation?.verifiedTotal).toBe(2);
  });

  it('excludes volunteer activity missing converted time', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      responses: [
        explicitVolunteerActivity('accumulated_volunteer_days', {
          id: 'green-sunday',
          activityName: 'Chủ nhật xanh',
          convertedValue: null,
          status: RequirementResponseStatus.needs_verification,
        }),
      ],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('needs_verification');
    expect(days?.aggregation?.verifiedTotal).toBe(0);
    expect(days?.aggregation?.activities[0]).toMatchObject({
      exclusionReason: 'missing_converted_value',
    });
    expect(result.nextAction?.label).toBe('Bổ sung số ngày cho Chủ nhật xanh');
  });

  it('excludes volunteer activity missing activity period', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      responses: [
        explicitVolunteerActivity('accumulated_volunteer_days', {
          id: 'no-period',
          activityName: 'Tiếp sức mùa thi',
          convertedValue: 2,
          status: RequirementResponseStatus.verified,
          startDate: '2025-07-01',
          endDate: null,
        }),
      ],
    });

    const days = findRequirementInResult(result, 'accumulated_volunteer_days');
    expect(result.status).toBe('precheck_warning');
    expect(days?.aggregation?.verifiedTotal).toBe(0);
    expect(days?.aggregation?.activities[0]).toMatchObject({
      exclusionReason: 'missing_activity_period',
    });
  });

  it('satisfies volunteer one_of with recognized campaign certificate', () => {
    const result = evaluate({
      criterion: Criterion.volunteer,
      groups: volunteerGroups(),
      responses: [
        {
          ...explicitResponse(
            'recognized_campaign',
            RequirementResponseStatus.verified,
            Criterion.volunteer,
          ),
          responseKind: RequirementResponseKind.evidence,
          evidenceId: 'evidence-campaign',
          payloadJson: { volunteerPath: 'recognized_campaign', activityName: 'Mùa hè xanh' },
        },
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
  });

  it('blocks duplicate volunteer event import by eventId', () => {
    expect(() =>
      assertNoDuplicateVolunteerEvent(
        [
          {
            criterion: Criterion.volunteer,
            requirementKey: 'accumulated_volunteer_days',
            payloadJson: { eventId: '11111111-1111-4111-8111-111111111111' },
          },
        ],
        '11111111-1111-4111-8111-111111111111',
      ),
    ).toThrow('Volunteer event has already been imported');
  });

  it('marks precheck ready when response data exists but is not verified', () => {
    const groups: RequirementGroupDto[] = [
      {
        key: 'manual',
        title: 'Manual',
        operator: 'all_of',
        optional: false,
        requirements: [
          {
            key: 'confirm',
            title: 'Confirm',
            type: 'system_confirmation',
            status: 'not_started',
            optional: false,
            acceptedSources: ['system_data'],
            currentResponses: [],
          },
        ],
      },
    ];

    const result = evaluate({
      groups,
      responses: [explicitResponse('confirm', RequirementResponseStatus.needs_verification)],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.completion.needsVerification).toBe(1);
  });

  it('does not count optional requirements as blocking', () => {
    const groups: RequirementGroupDto[] = [
      {
        key: 'optional',
        title: 'Optional',
        operator: 'all_of',
        optional: false,
        requirements: [
          {
            key: 'optional_req',
            title: 'Optional',
            type: 'evidence',
            status: 'not_started',
            optional: true,
            acceptedSources: ['manual_evidence'],
            currentResponses: [],
          },
        ],
      },
    ];

    const result = evaluate({ groups });

    expect(result.status).toBe('not_started');
    expect(result.completion).toMatchObject({ satisfied: 0, required: 0 });
  });

  it('maps legacy GPA and language metrics without assuming IELTS', () => {
    const groups = buildRequirementGroupsByCriterion([
      {
        criterion: Criterion.integration,
        ruleKey: 'language_metric',
        ruleType: 'metric_threshold',
        thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 2 },
        evidenceRequirementsJson: null,
        humanReadableText: 'Language score',
      },
    ])[Criterion.integration];

    const result = evaluate({
      criterion: Criterion.integration,
      groups,
      metrics: [metric(MetricType.foreign_language_score, 2)],
    });

    const response = result.requirementGroups[0].requirements[0].currentResponses[0];
    expect(response.payloadJson).toMatchObject({ metricType: MetricType.foreign_language_score });
    expect(JSON.stringify(response.payloadJson).toLowerCase()).not.toContain('ielts');
  });

  it('marks integration ready for a valid IELTS foreign language path', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'english',
          resultForm: 'certificate',
          certificateType: 'IELTS',
          score: 4.5,
          issuedDate: '2026-01-01',
          studyYear: 3,
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
  });

  it('stores JLPT, TOPIK, and HSK language metadata without forcing English', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'japanese',
          resultForm: 'certificate',
          certificateType: 'JLPT',
          level: 'N3',
          issuedDate: '2026-01-01',
        }),
        explicitIntegrationPathResponse('foreign_language', {
          language: 'korean',
          resultForm: 'certificate',
          certificateType: 'TOPIK',
          level: '3',
          issuedDate: '2026-01-01',
        }),
        explicitIntegrationPathResponse('foreign_language', {
          language: 'chinese',
          resultForm: 'certificate',
          certificateType: 'HSK',
          level: '3',
          issuedDate: '2026-01-01',
        }),
      ],
    });

    const responses = findRequirementInResult(result, 'foreign_language')?.currentResponses ?? [];
    expect(result.status).toBe('ready_for_precheck');
    expect(responses.map((response) => response.payloadJson)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: 'japanese', certificateType: 'JLPT' }),
        expect.objectContaining({ language: 'korean', certificateType: 'TOPIK' }),
        expect.objectContaining({ language: 'chinese', certificateType: 'HSK' }),
      ]),
    );
  });

  it('keeps unmapped foreign language certificate data for review instead of blocking precheck', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'other',
          resultForm: 'certificate',
          certificateType: 'other',
          issuedDate: '2026-01-01',
        }),
      ],
    });

    const response = findRequirementInResult(result, 'foreign_language')?.currentResponses[0];
    expect(result.status).toBe('ready_for_precheck');
    expect(response?.status).toBe('needs_verification');
  });

  it('allows verified skills or union training to satisfy integration without language data', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('skills_or_union_training', {
          programName: 'Tập huấn cán bộ Đoàn - Hội',
          trainingType: 'union_training',
          skillCategory: 'social_practice',
          organizer: 'Đoàn trường',
          organizerLevel: 'school',
          startDate: '2026-02-01',
          endDate: '2026-02-02',
          completionStatus: 'completed',
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
  });

  it('allows verified international exchange to satisfy integration', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('international_exchange', {
          activityName: 'ASEAN Student Exchange',
          activityType: 'exchange',
          organizer: 'DUT',
          organizerLevel: 'international',
          domesticOrInternational: 'international',
          startDate: '2026-03-01',
          endDate: '2026-03-03',
          participationRole: 'participant',
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
  });

  it('does not require English for integration competitions', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language_or_integration_competition', {
          competitionName: 'Cuộc thi hội nhập sinh viên',
          competitionType: 'integration',
          languageUsed: null,
          organizer: 'HSV',
          organizerLevel: 'school',
          achievement: 'participant',
          startDate: '2026-04-01',
          endDate: '2026-04-01',
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
  });

  it('asks for issue date when a foreign language certificate is missing issuedDate', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'english',
          resultForm: 'certificate',
          certificateType: 'IELTS',
          score: 6.5,
        }),
      ],
    });

    expect(result.status).toBe('ready_for_precheck');
    expect(result.nextAction).toBeNull();
  });

  it('evaluates foreign language thresholds by studyYear when configured', () => {
    const result = evaluate({
      criterion: Criterion.integration,
      groups: integrationGroups(),
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'english',
          resultForm: 'certificate',
          certificateType: 'IELTS',
          score: 4.0,
          issuedDate: '2026-01-01',
          studyYear: 3,
        }),
      ],
    });

    expect(result.status).toBe('precheck_warning');
  });

  it('keeps explicit higher-level integration trees when target level rules change', () => {
    const groups = buildRequirementGroupsByCriterion([
      {
        criterion: Criterion.integration,
        ruleKey: 'higher_integration_tree',
        ruleType: 'composite_all',
        thresholdJson: null,
        evidenceRequirementsJson: {
          requirementGroups: [
            {
              key: 'integration_foundation',
              operator: 'all_of',
              requirements: [
                { key: 'foreign_language', title: 'Ngoại ngữ', type: 'evidence' },
              ],
            },
            {
              key: 'integration_additional',
              operator: 'one_of',
              requirements: [
                {
                  key: 'international_exchange',
                  title: 'Giao lưu quốc tế',
                  type: 'evidence',
                },
              ],
            },
          ],
        },
        humanReadableText: 'Higher integration',
      },
    ])[Criterion.integration];

    const result = evaluate({
      criterion: Criterion.integration,
      groups,
      responses: [
        explicitIntegrationPathResponse('foreign_language', {
          language: 'japanese',
          resultForm: 'certificate',
          certificateType: 'JLPT',
          level: 'N3',
          issuedDate: '2026-01-01',
        }),
      ],
    });

    expect(groups.map((group) => group.key)).toEqual([
      'integration_foundation',
      'integration_additional',
    ]);
    expect(result.status).toBe('in_progress');
  });

  it('preserves workspace isolation helper behavior for non-admin users', () => {
    expect(() =>
      assertSameWorkspace(
        {
          id: 'user-1',
          email: 'student@example.com',
          fullName: 'Student',
          role: 'student' as never,
          workspaceId: 'workspace-a',
          studentCode: null,
          className: null,
          faculty: null,
          avatarUrl: null,
          workspace: null,
        },
        { workspaceId: 'workspace-b' },
      ),
    ).toThrow();
  });
});
