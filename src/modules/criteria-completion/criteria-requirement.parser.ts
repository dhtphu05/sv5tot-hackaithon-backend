import { Criterion, MetricType } from '@prisma/client';
import { coreCriteria } from '../rules/criteria.constants';
import type { CriteriaRuleConfig } from '../rules/rules.types';
import type {
  RequirementDto,
  RequirementGroupDto,
  RequirementGroupOperator,
  RequirementSourceType,
  RequirementType,
} from './criteria-completion.types';

const criterionTitles: Record<Criterion, string> = {
  [Criterion.ethics]: 'Đạo đức tốt',
  [Criterion.academic]: 'Học tập tốt',
  [Criterion.physical]: 'Thể lực tốt',
  [Criterion.volunteer]: 'Tình nguyện tốt',
  [Criterion.integration]: 'Hội nhập tốt',
  [Criterion.priority]: 'Thành tích ưu tiên',
  [Criterion.collective]: 'Tập thể',
};

export function buildRequirementGroupsByCriterion(
  rules: CriteriaRuleConfig[],
): Record<Criterion, RequirementGroupDto[]> {
  const grouped = Object.values(Criterion).reduce(
    (acc, criterion) => ({ ...acc, [criterion]: [] }),
    {} as Record<Criterion, RequirementGroupDto[]>,
  );

  for (const rule of rules) {
    grouped[rule.criterion].push(...parseRuleToGroups(rule));
  }

  grouped[Criterion.ethics] = buildEthicsRequirementGroups(
    rules.filter((rule) => rule.criterion === Criterion.ethics),
    grouped[Criterion.ethics],
  );
  grouped[Criterion.academic] = buildAcademicRequirementGroups(
    rules.filter((rule) => rule.criterion === Criterion.academic),
    grouped[Criterion.academic],
  );
  grouped[Criterion.physical] = buildPhysicalRequirementGroups(
    rules.filter((rule) => rule.criterion === Criterion.physical),
    grouped[Criterion.physical],
  );
  grouped[Criterion.volunteer] = buildVolunteerRequirementGroups(
    rules.filter((rule) => rule.criterion === Criterion.volunteer),
    grouped[Criterion.volunteer],
  );
  grouped[Criterion.integration] = buildIntegrationRequirementGroups(
    rules.filter((rule) => rule.criterion === Criterion.integration),
    grouped[Criterion.integration],
  );

  for (const criterion of coreCriteria) {
    if (grouped[criterion].length === 0) {
      grouped[criterion].push(buildFallbackGroup(criterion));
    }
  }

  return grouped;
}

export function parseRuleToGroups(rule: CriteriaRuleConfig): RequirementGroupDto[] {
  const explicit = parseExplicitGroups(rule);
  if (explicit.length > 0) return explicit;

  const threshold = asRecord(rule.thresholdJson);
  const evidenceConfig = asRecord(rule.evidenceRequirementsJson);
  const optional = evidenceConfig.optional === true;
  const ruleType = normalizeRuleType(rule.ruleType);

  if (ruleType === 'evidence_or_metric') {
    const requirements = [
      buildMetricRequirement(rule, threshold),
      buildEvidenceRequirement(rule, evidenceConfig),
    ].filter((item): item is RequirementDto => Boolean(item));
    return [
      {
        key: `${rule.ruleKey}_one_of`,
        title: rule.humanReadableText,
        operator: 'one_of',
        optional,
        requirements,
      },
    ];
  }

  if (ruleType === 'metric_threshold') {
    const requirement = buildMetricRequirement(rule, threshold);
    return requirement
      ? [buildSingleRequirementGroup(rule, requirement, optional, 'all_of')]
      : [buildFallbackGroup(rule.criterion, rule.ruleKey, rule.humanReadableText, optional)];
  }

  if (ruleType === 'evidence_required' || ruleType === 'event_import_allowed') {
    const requirement = buildEvidenceRequirement(rule, evidenceConfig);
    return requirement
      ? [buildSingleRequirementGroup(rule, requirement, optional, 'all_of')]
      : [buildFallbackGroup(rule.criterion, rule.ruleKey, rule.humanReadableText, optional)];
  }

  if (ruleType === 'human_review_note') {
    return [
      buildSingleRequirementGroup(
        rule,
        {
          key: rule.ruleKey,
          title: rule.humanReadableText,
          type: 'system_confirmation',
          status: 'not_started',
          optional,
          acceptedSources: ['system_data'],
          currentResponses: [],
          nextAction: optional
            ? undefined
            : { type: 'confirm', label: 'Chờ hệ thống/cán bộ xác nhận' },
        },
        optional,
        'all_of',
      ),
    ];
  }

  return [buildFallbackGroup(rule.criterion, rule.ruleKey, rule.humanReadableText, optional)];
}

export function criterionTitle(criterion: Criterion): string {
  return criterionTitles[criterion] ?? criterion;
}

function parseExplicitGroups(rule: CriteriaRuleConfig): RequirementGroupDto[] {
  const containers = [asRecord(rule.evidenceRequirementsJson), asRecord(rule.thresholdJson)];
  for (const container of containers) {
    const rawGroups = Array.isArray(container.requirementGroups)
      ? container.requirementGroups
      : Array.isArray(container.groups)
        ? container.groups
        : null;
    if (!rawGroups) continue;
    return rawGroups
      .map((group, index) => normalizeExplicitGroup(rule, group, index))
      .filter((group): group is RequirementGroupDto => Boolean(group));
  }
  return [];
}

function normalizeExplicitGroup(
  rule: CriteriaRuleConfig,
  value: unknown,
  index: number,
): RequirementGroupDto | null {
  const group = asRecord(value);
  const requirements = Array.isArray(group.requirements)
    ? group.requirements
        .map((requirement, requirementIndex) =>
          normalizeExplicitRequirement(rule, requirement, requirementIndex),
        )
        .filter((item): item is RequirementDto => Boolean(item))
    : [];
  if (requirements.length === 0) return null;

  const operator = normalizeOperator(group.operator);
  return {
    key: stringOrDefault(group.key, `${rule.ruleKey}_group_${index + 1}`),
    title: stringOrDefault(group.title, rule.humanReadableText),
    operator,
    requiredCount:
      operator === 'at_least_n' && typeof group.requiredCount === 'number'
        ? group.requiredCount
        : undefined,
    optional: group.optional === true,
    formSchema: group.formSchema,
    requirements,
  };
}

function normalizeExplicitRequirement(
  rule: CriteriaRuleConfig,
  value: unknown,
  index: number,
): RequirementDto | null {
  const requirement = asRecord(value);
  const type = normalizeRequirementType(requirement.type);
  if (!type) return null;
  const config = asRecord(requirement.config);
  return {
    key: stringOrDefault(requirement.key, `${rule.ruleKey}_req_${index + 1}`),
    title: stringOrDefault(requirement.title, rule.humanReadableText),
    description: typeof requirement.description === 'string' ? requirement.description : undefined,
    type,
    status: 'not_started',
    optional: requirement.optional === true,
    acceptedSources: normalizeSources(requirement.acceptedSources, type),
    formSchema: requirement.formSchema,
    currentResponses: [],
    config: {
      metricType: normalizeMetricType(config.metricType ?? requirement.metricType),
      operator: normalizeThresholdOperator(config.operator ?? requirement.operator),
      threshold: numberOrUndefined(config.threshold ?? config.value ?? requirement.threshold),
      criterion: normalizeCriterion(config.criterion ?? requirement.criterion) ?? rule.criterion,
      sourceType: stringOrUndefined(config.sourceType ?? requirement.sourceType),
      evidenceType: stringOrUndefined(config.evidenceType ?? requirement.evidenceType),
      requiredValue: numberOrUndefined(
        config.requiredValue ?? config.threshold ?? requirement.requiredValue,
      ),
      valueField: stringOrUndefined(config.valueField ?? requirement.valueField),
      aggregationUnit: stringOrUndefined(config.aggregationUnit ?? requirement.aggregationUnit),
      studyYearThresholds: normalizeNumberRecord(
        config.studyYearThresholds ?? requirement.studyYearThresholds,
      ),
    },
    nextAction:
      typeof requirement.nextAction === 'object'
        ? (requirement.nextAction as RequirementDto['nextAction'])
        : defaultNextAction(type),
  };
}

function buildEthicsRequirementGroups(
  rules: CriteriaRuleConfig[],
  parsedGroups: RequirementGroupDto[],
): RequirementGroupDto[] {
  if (rules.length === 0) return parsedGroups;
  const explicitFoundation = parsedGroups.find((group) => group.key === 'ethics_foundation');
  const thresholdRule =
    rules.find((rule) => {
      const threshold = asRecord(rule.thresholdJson);
      return normalizeMetricType(threshold.metric) === MetricType.conduct_score;
    }) ?? rules.find((rule) => rule.ruleKey.includes('conduct'));
  const threshold = asRecord(thresholdRule?.thresholdJson);
  const thresholdValue = numberOrUndefined(threshold.value) ?? 82;
  const thresholdOperator = normalizeThresholdOperator(threshold.operator) ?? '>=';

  const foundation: RequirementGroupDto = explicitFoundation ?? {
    key: 'ethics_foundation',
    title: 'Dữ liệu nền về đạo đức',
    operator: 'all_of',
    optional: false,
    requirements: [
      {
        key: 'conduct_score',
        title: 'Điểm rèn luyện',
        type: 'metric',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_metric', 'manual_evidence'],
        formSchema: {
          fields: ['value', 'scale', 'schoolYear', 'sourceType'],
        },
        currentResponses: [],
        config: {
          metricType: MetricType.conduct_score,
          criterion: Criterion.ethics,
          operator: thresholdOperator,
          threshold: thresholdValue,
          requiredValue: thresholdValue,
        },
        nextAction: {
          type: 'enter_or_link_metric',
          label: 'Nhập hoặc liên kết điểm rèn luyện',
        },
      },
      {
        key: 'no_violation',
        title: 'Không vi phạm pháp luật, quy chế và nội quy',
        type: 'system_confirmation',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_evidence'],
        currentResponses: [],
        nextAction: {
          type: 'wait_system_confirmation',
          label: 'Chờ nhà trường xác nhận tình trạng vi phạm',
        },
      },
    ],
  };

  const explicitAdditional = parsedGroups.find(
    (group) => group.key === 'ethics_additional_achievements',
  );
  const additional: RequirementGroupDto = explicitAdditional ?? {
    key: 'ethics_additional_achievements',
    title: 'Thành tích đạo đức bổ sung',
    operator: 'one_of',
    optional: true,
    requirements: [
      'political_theory_competition',
      'exemplary_youth',
      'good_person_good_deed',
      'recognized_courageous_action',
      'other_ethics_achievement',
    ].map((evidenceType) => ({
      key: evidenceType,
      title: ethicsAchievementTitle(evidenceType),
      type: 'evidence',
      status: 'not_started',
      optional: true,
      acceptedSources: ['manual_evidence', 'official_event'],
      currentResponses: [],
      config: {
        criterion: Criterion.ethics,
        evidenceType,
      },
      nextAction: {
        type: 'add_optional_evidence',
        label: 'Thêm thành tích đạo đức',
      },
    })),
  };

  const remaining = parsedGroups.filter(
    (group) => group.key !== foundation.key && group.key !== additional.key,
  );
  const nonEthicsLegacy = remaining.filter(
    (group) =>
      !group.requirements.some((requirement) =>
        ['conduct_score', 'no_violation'].includes(requirement.key),
      ),
  );

  return [foundation, additional, ...nonEthicsLegacy.filter((group) => group.optional)];
}

function ethicsAchievementTitle(evidenceType: string): string {
  const titles: Record<string, string> = {
    political_theory_competition: 'Thi tìm hiểu lý luận chính trị',
    exemplary_youth: 'Thanh niên tiên tiến/làm theo lời Bác',
    good_person_good_deed: 'Gương người tốt việc tốt',
    recognized_courageous_action: 'Hành động dũng cảm được ghi nhận',
    other_ethics_achievement: 'Thành tích đạo đức khác',
  };
  return titles[evidenceType] ?? evidenceType;
}

function buildAcademicRequirementGroups(
  rules: CriteriaRuleConfig[],
  parsedGroups: RequirementGroupDto[],
): RequirementGroupDto[] {
  if (rules.length === 0) return parsedGroups;
  const explicitFoundation = parsedGroups.find((group) => group.key === 'academic_foundation');
  const thresholdRule =
    rules.find((rule) => {
      const threshold = asRecord(rule.thresholdJson);
      return normalizeMetricType(threshold.metric) === MetricType.gpa;
    }) ?? rules.find((rule) => rule.ruleKey.includes('gpa'));
  const threshold = asRecord(thresholdRule?.thresholdJson);
  const thresholdValue = numberOrUndefined(threshold.value) ?? 3.0;
  const thresholdOperator = normalizeThresholdOperator(threshold.operator) ?? '>=';

  const foundation: RequirementGroupDto = explicitFoundation ?? {
    key: 'academic_foundation',
    title: 'Káº¿t quáº£ há»c táº­p',
    operator: 'all_of',
    optional: false,
    requirements: [
      {
        key: 'academic_gpa',
        title: 'GPA/ÄTB',
        type: 'metric',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_metric', 'manual_evidence'],
        formSchema: {
          fields: ['value', 'scale', 'schoolYear', 'sourceType'],
          supportedScales: [4, 10],
        },
        currentResponses: [],
        config: {
          metricType: MetricType.gpa,
          criterion: Criterion.academic,
          operator: thresholdOperator,
          threshold: thresholdValue,
          requiredValue: thresholdValue,
        },
        nextAction: {
          type: 'enter_gpa',
          label: 'Nháº­p GPA vÃ  chá»n thang Ä‘iá»ƒm',
        },
      },
      {
        key: 'no_f_grade',
        title: 'KhÃ´ng cÃ³ há»c pháº§n Ä‘iá»ƒm F',
        type: 'system_confirmation',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_evidence'],
        currentResponses: [],
        nextAction: {
          type: 'confirm_no_f_grade',
          label: 'XÃ¡c nháº­n tÃ¬nh tráº¡ng Ä‘iá»ƒm F',
        },
      },
      {
        key: 'academic_period_valid',
        title: 'Dá»¯ liá»‡u thuá»™c Ä‘Ãºng nÄƒm há»c xÃ©t',
        type: 'system_confirmation',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_evidence'],
        currentResponses: [],
        nextAction: {
          type: 'upload_transcript_for_period',
          label: 'Táº£i báº£ng Ä‘iá»ƒm Ä‘á»ƒ xÃ¡c minh GPA',
        },
      },
    ],
  };

  const explicitAdditional = parsedGroups.find(
    (group) => group.key === 'academic_additional_achievement',
  );
  const additionalOptional =
    explicitAdditional?.optional ??
    !rules.some(
      (rule) => asRecord(rule.evidenceRequirementsJson).academicAdditionalRequired === true,
    );
  const academicAchievementTypes = [
    'student_research',
    'academic_competition',
    'journal_article',
    'conference_paper',
    'thesis_or_capstone',
    'innovation_product',
    'academic_team',
    'academic_award',
    'other_academic_achievement',
  ];
  const additional: RequirementGroupDto = explicitAdditional ?? {
    key: 'academic_additional_achievement',
    title: 'ThÃ nh tÃ­ch há»c thuáº­t bá»• sung',
    operator: 'one_of',
    optional: additionalOptional,
    formSchema: {
      evidenceTypes: academicAchievementTypes,
      additionalAchievementRequired: !additionalOptional,
    },
    requirements: academicAchievementTypes.map((evidenceType) => ({
      key: evidenceType,
      title: academicAchievementTitle(evidenceType),
      type: 'evidence',
      status: 'not_started',
      optional: additionalOptional,
      acceptedSources: ['manual_evidence', 'official_event'],
      currentResponses: [],
      config: {
        criterion: Criterion.academic,
        evidenceType,
      },
      nextAction: {
        type: 'add_academic_achievement',
        label: 'Bá»• sung thÃ nh tÃ­ch há»c thuáº­t theo yÃªu cáº§u cáº¥p Ä‘Äƒng kÃ½',
      },
    })),
  };

  const remaining = parsedGroups.filter(
    (group) => group.key !== foundation.key && group.key !== additional.key,
  );
  const nonAcademicLegacy = remaining.filter(
    (group) =>
      !group.requirements.some((requirement) =>
        ['academic_gpa', 'no_f_grade', 'academic_period_valid'].includes(requirement.key),
      ),
  );

  return [foundation, additional, ...nonAcademicLegacy.filter((group) => group.optional)];
}

function academicAchievementTitle(evidenceType: string): string {
  const titles: Record<string, string> = {
    student_research: 'NghiÃªn cá»©u khoa há»c sinh viÃªn',
    academic_competition: 'Cuá»™c thi há»c thuáº­t',
    journal_article: 'BÃ i bÃ¡o táº¡p chÃ­',
    conference_paper: 'BÃ¡o cÃ¡o há»™i tháº£o',
    thesis_or_capstone: 'KhÃ³a luáº­n/Ä‘á»“ Ã¡n tá»‘t nghiá»‡p',
    innovation_product: 'Sáº£n pháº©m sÃ¡ng táº¡o há»c thuáº­t',
    academic_team: 'Äá»™i nhÃ³m há»c thuáº­t',
    academic_award: 'Giáº£i thÆ°á»Ÿng há»c thuáº­t',
    other_academic_achievement: 'ThÃ nh tÃ­ch há»c thuáº­t khÃ¡c',
  };
  return titles[evidenceType] ?? evidenceType;
}

function buildPhysicalRequirementGroups(
  rules: CriteriaRuleConfig[],
  parsedGroups: RequirementGroupDto[],
): RequirementGroupDto[] {
  if (rules.length === 0) return parsedGroups;
  const explicitPath = parsedGroups.find((group) => group.key === 'physical_path');
  const thresholdRule =
    rules.find((rule) => {
      const threshold = asRecord(rule.thresholdJson);
      return normalizeMetricType(threshold.metric) === MetricType.physical_score;
    }) ?? rules.find((rule) => rule.ruleKey.includes('physical'));
  const threshold = asRecord(thresholdRule?.thresholdJson);
  const thresholdValue = numberOrUndefined(threshold.value) ?? 6.5;
  const thresholdOperator = normalizeThresholdOperator(threshold.operator) ?? '>=';

  const physicalPaths = [
    'physical_course_result',
    'healthy_student_title',
    'sports_activity_or_award',
    'sports_team_member',
    'regular_sports_training',
  ];
  const pathGroup: RequirementGroupDto = explicitPath ?? {
    key: 'physical_path',
    title: 'Cách chứng minh Thể lực tốt',
    operator: 'one_of',
    optional: false,
    formSchema: {
      chooseFirst: true,
      paths: physicalPaths,
      sources: ['official_data', 'manual_evidence'],
    },
    requirements: [
      {
        key: 'physical_course_result',
        title: 'Điểm hoặc xếp loại Giáo dục thể chất',
        type: 'metric',
        status: 'not_started',
        optional: false,
        acceptedSources: ['system_data', 'manual_metric', 'manual_evidence'],
        formSchema: {
          fields: ['resultType', 'value', 'classification', 'schoolYear', 'source'],
          resultTypes: ['score', 'classification'],
        },
        currentResponses: [],
        config: {
          metricType: MetricType.physical_score,
          criterion: Criterion.physical,
          operator: thresholdOperator,
          threshold: thresholdValue,
          requiredValue: thresholdValue,
        },
        nextAction: {
          type: 'wait_physical_course_verification',
          label: 'Chờ xác minh điểm Giáo dục thể chất',
        },
      },
      ...[
        'healthy_student_title',
        'sports_activity_or_award',
        'sports_team_member',
        'regular_sports_training',
      ].map((evidenceType) => ({
        key: evidenceType,
        title: physicalPathTitle(evidenceType),
        type: 'evidence' as const,
        status: 'not_started' as const,
        optional: false,
        acceptedSources: ['manual_evidence', 'official_event'] as RequirementSourceType[],
        formSchema: physicalPathFormSchema(evidenceType),
        currentResponses: [],
        config: {
          criterion: Criterion.physical,
          evidenceType,
        },
        nextAction: physicalPathNextAction(evidenceType),
      })),
    ],
  };

  const remaining = parsedGroups.filter((group) => group.key !== pathGroup.key);
  const nonPhysicalLegacy = remaining.filter(
    (group) =>
      !group.requirements.some((requirement) =>
        [
          'physical_course_result',
          'healthy_student_title',
          'sports_activity_or_award',
          'sports_team_member',
          'regular_sports_training',
        ].includes(requirement.key),
      ),
  );

  return [pathGroup, ...nonPhysicalLegacy.filter((group) => group.optional)];
}

function physicalPathTitle(evidenceType: string): string {
  const titles: Record<string, string> = {
    healthy_student_title: 'Danh hiệu Sinh viên khỏe hoặc Thanh niên khỏe',
    sports_activity_or_award: 'Hoạt động hoặc giải thưởng thể thao',
    sports_team_member: 'Thành viên đội tuyển/đội thể thao',
    regular_sports_training: 'Tập luyện thể thao thường xuyên',
  };
  return titles[evidenceType] ?? evidenceType;
}

function physicalPathFormSchema(evidenceType: string) {
  const fields: Record<string, string[]> = {
    healthy_student_title: ['titleName', 'organizer', 'organizerLevel', 'issuedDate', 'schoolYear'],
    sports_activity_or_award: [
      'eventName',
      'organizer',
      'organizerLevel',
      'participationRole',
      'achievement',
      'startDate',
      'endDate',
    ],
    sports_team_member: [
      'teamName',
      'unit',
      'competitionLevel',
      'participationPeriod',
      'achievement',
    ],
    regular_sports_training: [
      'clubOrTeamName',
      'managingUnit',
      'startDate',
      'endDate',
      'confirmationType',
    ],
  };
  return { fields: fields[evidenceType] ?? [] };
}

function physicalPathNextAction(evidenceType: string) {
  if (evidenceType === 'sports_activity_or_award') {
    return {
      type: 'complete_sports_event_period',
      label: 'Bổ sung thời gian tham gia giải thể thao',
    };
  }
  if (evidenceType === 'regular_sports_training') {
    return { type: 'upload_sports_club_confirmation', label: 'Tải giấy xác nhận CLB' };
  }
  return { type: 'add_physical_path_evidence', label: 'Chọn cách chứng minh Thể lực tốt' };
}

function buildVolunteerRequirementGroups(
  rules: CriteriaRuleConfig[],
  parsedGroups: RequirementGroupDto[],
): RequirementGroupDto[] {
  if (rules.length === 0) return parsedGroups;
  const explicitPath = parsedGroups.find((group) => group.key === 'volunteer_path');
  const thresholdRule =
    rules.find((rule) => {
      const threshold = asRecord(rule.thresholdJson);
      return normalizeMetricType(threshold.metric) === MetricType.volunteer_days;
    }) ?? rules.find((rule) => rule.ruleKey.includes('volunteer'));
  const threshold = asRecord(thresholdRule?.thresholdJson);
  const daysThreshold = numberOrUndefined(threshold.value) ?? 2;
  const activityCountThreshold =
    rules
      .map((rule) => asRecord(rule.evidenceRequirementsJson))
      .map((config) => numberOrUndefined(config.activityCountRequired))
      .find((value): value is number => typeof value === 'number') ?? 3;
  const operator = normalizeThresholdOperator(threshold.operator) ?? '>=';
  const volunteerPaths = [
    'recognized_campaign',
    'accumulated_volunteer_days',
    'volunteer_award',
    'activity_count',
  ];

  const pathGroup: RequirementGroupDto = explicitPath ?? {
    key: 'volunteer_path',
    title: 'Sổ hoạt động tình nguyện',
    operator: 'one_of',
    optional: false,
    formSchema: {
      paths: volunteerPaths,
      sources: ['official_event', 'manual_evidence'],
    },
    requirements: [
      {
        key: 'recognized_campaign',
        title: 'Chiến dịch/chương trình tình nguyện được công nhận',
        type: 'evidence',
        status: 'not_started',
        optional: false,
        acceptedSources: ['manual_evidence', 'official_event'],
        formSchema: {
          fields: [
            'activityName',
            'campaignType',
            'organizer',
            'organizerLevel',
            'startDate',
            'endDate',
            'role',
          ],
        },
        currentResponses: [],
        config: {
          criterion: Criterion.volunteer,
          evidenceType: 'recognized_campaign',
        },
        nextAction: { type: 'add_volunteer_activity', label: 'Thêm hoạt động tình nguyện' },
      },
      {
        key: 'accumulated_volunteer_days',
        title: 'Tổng ngày tình nguyện đã xác minh',
        type: 'activity_aggregation',
        status: 'not_started',
        optional: false,
        acceptedSources: ['official_event', 'manual_evidence'],
        formSchema: {
          fields: [
            'activityType',
            'activityName',
            'organizer',
            'organizerLevel',
            'startDate',
            'endDate',
            'declaredValue',
            'declaredUnit',
            'evidenceId',
          ],
          unit: 'day',
        },
        currentResponses: [],
        config: {
          metricType: MetricType.volunteer_days,
          criterion: Criterion.volunteer,
          operator,
          threshold: daysThreshold,
          requiredValue: daysThreshold,
          valueField: 'convertedValue',
          aggregationUnit: 'day',
        },
        nextAction: { type: 'add_volunteer_activity', label: 'Thêm hoạt động tình nguyện' },
      },
      {
        key: 'volunteer_award',
        title: 'Giấy khen/khen thưởng hoạt động tình nguyện',
        type: 'evidence',
        status: 'not_started',
        optional: false,
        acceptedSources: ['manual_evidence', 'official_event'],
        formSchema: {
          fields: ['awardName', 'issuingUnit', 'issuingLevel', 'issuedDate'],
        },
        currentResponses: [],
        config: {
          criterion: Criterion.volunteer,
          evidenceType: 'volunteer_award',
        },
        nextAction: {
          type: 'upload_volunteer_award',
          label: 'Tải giấy xác nhận của đơn vị tổ chức',
        },
      },
      {
        key: 'activity_count',
        title: 'Số hoạt động Đoàn/Hội đã xác minh',
        type: 'activity_aggregation',
        status: 'not_started',
        optional: false,
        acceptedSources: ['official_event', 'manual_evidence'],
        formSchema: {
          fields: ['activityType', 'activityName', 'organizer', 'startDate', 'endDate', 'evidenceId'],
          unit: 'event',
        },
        currentResponses: [],
        config: {
          criterion: Criterion.volunteer,
          operator,
          threshold: activityCountThreshold,
          requiredValue: activityCountThreshold,
          valueField: 'activityCount',
          aggregationUnit: 'event',
        },
        nextAction: { type: 'add_volunteer_activity', label: 'Thêm hoạt động tình nguyện' },
      },
    ],
  };

  const remaining = parsedGroups.filter((group) => group.key !== pathGroup.key);
  const nonVolunteerLegacy = remaining.filter(
    (group) =>
      !group.requirements.some((requirement) =>
        volunteerPaths.includes(requirement.key) ||
        requirement.config?.metricType === MetricType.volunteer_days,
      ),
  );

  return [pathGroup, ...nonVolunteerLegacy.filter((group) => group.optional)];
}

function buildIntegrationRequirementGroups(
  rules: CriteriaRuleConfig[],
  parsedGroups: RequirementGroupDto[],
): RequirementGroupDto[] {
  if (rules.length === 0) return parsedGroups;
  const hasExplicitConfig = rules.some((rule) => {
    const evidenceConfig = asRecord(rule.evidenceRequirementsJson);
    const thresholdConfig = asRecord(rule.thresholdJson);
    return (
      Array.isArray(evidenceConfig.requirementGroups) ||
      Array.isArray(evidenceConfig.groups) ||
      Array.isArray(thresholdConfig.requirementGroups) ||
      Array.isArray(thresholdConfig.groups)
    );
  });
  if (hasExplicitConfig) return parsedGroups;

  const integrationPaths = [
    'foreign_language',
    'skills_or_union_training',
    'international_exchange',
    'foreign_language_or_integration_competition',
    'student_union_achievement',
  ];
  const hasExplicitIntegrationTree = parsedGroups.some(
    (group) =>
      group.key === 'integration_path' ||
      group.requirements.some((requirement) => integrationPaths.includes(requirement.key)),
  );
  if (hasExplicitIntegrationTree) {
    return parsedGroups;
  }

  const thresholdRule =
    rules.find((rule) => {
      const threshold = asRecord(rule.thresholdJson);
      return normalizeMetricType(threshold.metric) === MetricType.foreign_language_score;
    }) ?? rules.find((rule) => rule.ruleKey.includes('integration'));
  const threshold = asRecord(thresholdRule?.thresholdJson);
  const evidenceConfig = asRecord(thresholdRule?.evidenceRequirementsJson);
  const thresholdValue = numberOrUndefined(threshold.value) ?? 2;
  const paths = [
    'foreign_language',
    'skills_or_union_training',
    'international_exchange',
    'foreign_language_or_integration_competition',
    ...(evidenceConfig.allowStudentUnionAchievement === true ? ['student_union_achievement'] : []),
  ];

  const pathGroup: RequirementGroupDto = {
    key: 'integration_path',
    title: 'Hình thức đáp ứng Hội nhập tốt',
    operator: 'one_of',
    optional: false,
    formSchema: {
      paths,
      sources: ['official_event', 'manual_evidence'],
    },
    requirements: paths.map((path) => buildIntegrationPathRequirement(path, thresholdValue, evidenceConfig)),
  };

  const remaining = parsedGroups.filter((group) => group.key !== pathGroup.key);
  const nonIntegrationLegacy = remaining.filter(
    (group) =>
      !group.requirements.some((requirement) =>
        paths.includes(requirement.key) ||
        requirement.config?.metricType === MetricType.foreign_language_score,
      ),
  );
  return [pathGroup, ...nonIntegrationLegacy.filter((group) => group.optional)];
}

function buildIntegrationPathRequirement(
  path: string,
  threshold: number,
  evidenceConfig: Record<string, unknown>,
): RequirementDto {
  const base = {
    key: path,
    title: integrationPathTitle(path),
    type: 'evidence' as const,
    status: 'not_started' as const,
    optional: false,
    acceptedSources: ['manual_evidence', 'official_event'] as RequirementSourceType[],
    formSchema: integrationPathFormSchema(path),
    currentResponses: [],
    config: {
      criterion: Criterion.integration,
      evidenceType: path,
      threshold,
      requiredValue: threshold,
      studyYearThresholds: normalizeNumberRecord(evidenceConfig.studyYearThresholds),
    },
    nextAction: integrationPathNextAction(path),
  };
  if (path === 'foreign_language') {
    return {
      ...base,
      config: {
        ...base.config,
        metricType: MetricType.foreign_language_score,
      },
    };
  }
  return base;
}

function integrationPathTitle(path: string): string {
  const titles: Record<string, string> = {
    foreign_language: 'Ngoại ngữ',
    skills_or_union_training: 'Khóa kỹ năng / tập huấn',
    international_exchange: 'Giao lưu hoặc hội nhập quốc tế',
    foreign_language_or_integration_competition: 'Cuộc thi ngoại ngữ hoặc hội nhập',
    student_union_achievement: 'Thành tích Đoàn - Hội',
  };
  return titles[path] ?? path;
}

function integrationPathFormSchema(path: string) {
  const fields: Record<string, string[]> = {
    foreign_language: [
      'language',
      'resultForm',
      'certificateType',
      'score',
      'level',
      'equivalentLevel',
      'issuedDate',
      'expiryDate',
      'schoolYear',
      'validityPeriod',
      'source',
    ],
    skills_or_union_training: [
      'programName',
      'trainingType',
      'skillCategory',
      'organizer',
      'organizerLevel',
      'startDate',
      'endDate',
      'completionStatus',
      'evidence',
    ],
    international_exchange: [
      'activityName',
      'activityType',
      'organizer',
      'organizerLevel',
      'domesticOrInternational',
      'startDate',
      'endDate',
      'participationRole',
      'evidence',
    ],
    foreign_language_or_integration_competition: [
      'competitionName',
      'competitionType',
      'languageUsed',
      'organizer',
      'organizerLevel',
      'achievement',
      'startDate',
      'endDate',
      'evidence',
    ],
    student_union_achievement: ['achievementName', 'issuingUnit', 'issuingLevel', 'issuedDate', 'evidence'],
  };
  return { fields: fields[path] ?? [] };
}

function integrationPathNextAction(path: string) {
  if (path === 'foreign_language') {
    return { type: 'add_foreign_language', label: 'Thêm chứng chỉ hoặc kết quả ngoại ngữ' };
  }
  if (path === 'skills_or_union_training') {
    return { type: 'upload_training_confirmation', label: 'Tải giấy xác nhận khóa tập huấn' };
  }
  if (path === 'international_exchange') {
    return { type: 'complete_exchange_organizer_level', label: 'Bổ sung cấp tổ chức của hoạt động giao lưu' };
  }
  return { type: 'choose_integration_path', label: 'Chọn hình thức đáp ứng Hội nhập tốt' };
}

function buildSingleRequirementGroup(
  rule: CriteriaRuleConfig,
  requirement: RequirementDto,
  optional: boolean,
  operator: RequirementGroupOperator,
): RequirementGroupDto {
  return {
    key: `${rule.ruleKey}_group`,
    title: rule.humanReadableText,
    operator,
    optional,
    requirements: [requirement],
  };
}

function buildMetricRequirement(
  rule: CriteriaRuleConfig,
  threshold: Record<string, unknown>,
): RequirementDto | null {
  const metricType = normalizeMetricType(threshold.metric);
  if (!metricType) return null;
  return {
    key: rule.ruleKey,
    title: rule.humanReadableText,
    type: metricType === MetricType.volunteer_days ? 'activity_aggregation' : 'metric',
    status: 'not_started',
    optional: false,
    acceptedSources: ['system_data', 'manual_metric'],
    currentResponses: [],
    config: {
      metricType,
      operator: normalizeThresholdOperator(threshold.operator) ?? '>=',
      threshold: numberOrUndefined(threshold.value),
      requiredValue: numberOrUndefined(threshold.value),
      valueField: metricType === MetricType.volunteer_days ? 'value' : undefined,
    },
    nextAction: { type: 'enter_metric', label: 'Nhập chỉ số' },
  };
}

function buildEvidenceRequirement(
  rule: CriteriaRuleConfig,
  evidenceConfig: Record<string, unknown>,
): RequirementDto {
  const sourceType = stringOrUndefined(evidenceConfig.sourceType);
  return {
    key: `${rule.ruleKey}_evidence`,
    title: rule.humanReadableText,
    type: 'evidence',
    status: 'not_started',
    optional: evidenceConfig.optional === true,
    acceptedSources:
      sourceType === 'event_import' ? ['official_event'] : ['manual_evidence', 'official_event'],
    currentResponses: [],
    config: {
      criterion: normalizeCriterion(evidenceConfig.criterion) ?? rule.criterion,
      sourceType,
    },
    nextAction: { type: 'add_evidence', label: 'Thêm minh chứng' },
  };
}

function buildFallbackGroup(
  criterion: Criterion,
  key = `${criterion}_manual_confirmation`,
  title = `Cần cấu hình điều kiện cho ${criterionTitle(criterion)}.`,
  optional = false,
): RequirementGroupDto {
  return {
    key: `${key}_group`,
    title,
    operator: 'all_of',
    optional,
    requirements: [
      {
        key,
        title,
        type: 'system_confirmation',
        status: 'not_started',
        optional,
        acceptedSources: ['system_data'],
        currentResponses: [],
        nextAction: optional
          ? undefined
          : { type: 'confirm', label: 'Chờ cấu hình/xác nhận điều kiện' },
      },
    ],
  };
}

function normalizeRuleType(value: string): string {
  return value === 'threshold' ? 'metric_threshold' : value;
}

function normalizeOperator(value: unknown): RequirementGroupOperator {
  if (value === 'one_of') return 'one_of';
  if (value === 'at_least_n') return 'at_least_n';
  return 'all_of';
}

function normalizeRequirementType(value: unknown): RequirementDto['type'] | null {
  if (
    value === 'metric' ||
    value === 'evidence' ||
    value === 'system_confirmation' ||
    value === 'activity_aggregation'
  ) {
    return value;
  }
  return null;
}

function normalizeMetricType(value: unknown): MetricType | undefined {
  return Object.values(MetricType).includes(value as MetricType)
    ? (value as MetricType)
    : undefined;
}

function normalizeCriterion(value: unknown): Criterion | undefined {
  return Object.values(Criterion).includes(value as Criterion) ? (value as Criterion) : undefined;
}

function normalizeThresholdOperator(value: unknown) {
  return value === '>=' || value === '>' || value === '<=' || value === '<' || value === '=='
    ? value
    : undefined;
}

function normalizeSources(value: unknown, type: RequirementType): RequirementSourceType[] {
  const values = Array.isArray(value) ? value : [];
  const valid = values.filter((item): item is RequirementSourceType =>
    ['system_data', 'official_event', 'manual_evidence', 'manual_metric'].includes(String(item)),
  );
  if (valid.length > 0) return valid;
  if (type === 'metric' || type === 'activity_aggregation') return ['system_data', 'manual_metric'];
  if (type === 'system_confirmation') return ['system_data'];
  return ['manual_evidence', 'official_event'];
}

function defaultNextAction(type: RequirementType) {
  if (type === 'metric' || type === 'activity_aggregation') {
    return { type: 'enter_metric', label: 'Nhập chỉ số' };
  }
  if (type === 'evidence') {
    return { type: 'add_evidence', label: 'Thêm minh chứng' };
  }
  return { type: 'confirm', label: 'Chờ xác nhận' };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  const entries = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}
