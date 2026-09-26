import { Criterion, MetricType, type Prisma } from '@prisma/client';
import type { CriteriaRuleConfig } from './rules.types';

type GroupOperator = 'all_of' | 'one_of';
type RequirementType = 'metric' | 'evidence' | 'activity_aggregation' | 'system_confirmation';

function requirement(
  key: string,
  title: string,
  type: RequirementType,
  config: Prisma.JsonObject = {},
  extra: Prisma.JsonObject = {},
) {
  return {
    key,
    title,
    type,
    optional: false,
    acceptedSources: ['system_data', 'manual_metric', 'manual_evidence', 'official_event'],
    blocksSubmission: false,
    config,
    ...extra,
  };
}

function group(
  key: string,
  title: string,
  operator: GroupOperator,
  requirements: ReturnType<typeof requirement>[],
) {
  return { key, title, operator, optional: false, requirements };
}

function cityFinding(
  criterion: Criterion,
  ruleKey: string,
  humanReadableText: string,
  requirementGroups: ReturnType<typeof group>[],
): CriteriaRuleConfig {
  return {
    criterion,
    ruleKey,
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: {
      warningCode: 'CITY_CRITERIA_NEEDS_REVIEW',
      requirementGroups,
    },
    humanReadableText,
  };
}

export const cityRules: CriteriaRuleConfig[] = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'city_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 80 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Điểm rèn luyện từ 80/100 trở lên.',
  },
  cityFinding(
    Criterion.ethics,
    'city_ethics_findings',
    'Đạo đức: điểm rèn luyện từ 80/100 hoặc xếp loại tương đương Giỏi; không vi phạm; có ít nhất một thành tích được liệt kê.',
    [
      group('ethics_foundation', 'Không vi phạm', 'all_of', [
        requirement(
          'no_violation',
          'Không vi phạm pháp luật, quy chế nhà trường hoặc quy định tại địa phương/cộng đồng',
          'system_confirmation',
          {},
          {
            responsibility: 'reviewer',
            verificationStage: 'review',
            nextAction: { type: 'reviewer_verification', label: 'Cán bộ kiểm tra' },
          },
        ),
      ]),
      group('ethics_training_score', 'Điểm hoặc xếp loại rèn luyện', 'one_of', [
        requirement('conduct_score', 'Điểm rèn luyện từ 80/100', 'metric', {
          metricType: MetricType.conduct_score,
          operator: '>=',
          threshold: 80,
        }),
        requirement(
          'good_equivalent_classification',
          'Xếp loại rèn luyện tương đương Giỏi theo hệ thống của cơ sở đào tạo',
          'system_confirmation',
          {},
          {
            responsibility: 'reviewer',
            verificationStage: 'review',
            nextAction: { type: 'reviewer_verification', label: 'Cán bộ đối chiếu xếp loại' },
          },
        ),
      ]),
      group('ethics_additional_achievements', 'Ít nhất một thành tích đạo đức', 'one_of', [
        requirement('communist_party_member', 'Là Đảng viên Đảng Cộng sản Việt Nam', 'evidence', {
          criterion: Criterion.ethics,
          evidenceType: 'communist_party_member',
        }),
        requirement(
          'political_theory_competition',
          'Thành viên đội thi lý luận chính trị từ Chi đoàn trở lên',
          'evidence',
          {
            criterion: Criterion.ethics,
            evidenceType: 'political_theory_competition',
          },
        ),
        requirement(
          'ideology_article_or_presentation',
          'Bài viết/tham luận tại diễn đàn tư tưởng phù hợp',
          'evidence',
          {
            criterion: Criterion.ethics,
            evidenceType: 'ideology_article_or_presentation',
          },
        ),
        requirement(
          'exemplary_youth_good_deed_brave_action',
          'Gương thanh niên tiêu biểu, người tốt việc tốt hoặc hành động dũng cảm được ghi nhận',
          'evidence',
          {
            criterion: Criterion.ethics,
            evidenceType: 'exemplary_youth_good_deed_brave_action',
          },
        ),
      ]),
    ],
  ),
  {
    criterion: Criterion.academic,
    ruleKey: 'city_academic_minimum_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3 },
    evidenceRequirementsJson: null,
    humanReadableText: 'GPA từ ngưỡng tối thiểu cao đẳng 3.0/4.0 hoặc 7.5/10 trở lên.',
  },
  cityFinding(
    Criterion.academic,
    'city_academic_findings',
    'Học tập: GPA theo ngưỡng đại học/cao đẳng và ít nhất một thành tích học thuật; hệ đào tạo chưa được xác định cần cán bộ kiểm tra.',
    [
      group('academic_foundation', 'GPA theo hệ đào tạo', 'one_of', [
        requirement('gpa_university', 'Đại học: GPA từ 3.2/4.0 hoặc 8.0/10', 'metric', {
          metricType: MetricType.gpa,
          operator: '>=',
          threshold: 3.2,
        }),
        requirement('gpa_college', 'Cao đẳng: GPA từ 3.0/4.0 hoặc 7.5/10', 'metric', {
          metricType: MetricType.gpa,
          operator: '>=',
          threshold: 3,
        }),
      ]),
      group('academic_program_type', 'Xác định hệ đại học hoặc cao đẳng', 'all_of', [
        requirement(
          'academic_program_type_unknown',
          'Hệ đào tạo chưa có trong hồ sơ; không tự suy đoán ngưỡng áp dụng',
          'system_confirmation',
          {},
          {
            responsibility: 'reviewer',
            verificationStage: 'review',
            nextAction: { type: 'reviewer_verification', label: 'Cán bộ xác định hệ đào tạo' },
          },
        ),
      ]),
      group('academic_additional_achievement', 'Ít nhất một thành tích học thuật', 'one_of', [
        requirement(
          'student_research_faculty',
          'Nghiên cứu khoa học cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.academic,
            evidenceType: 'student_research_faculty',
          },
        ),
        requirement('specialist_journal_article', 'Bài báo trên tạp chí chuyên ngành', 'evidence', {
          criterion: Criterion.academic,
          evidenceType: 'specialist_journal_article',
        }),
        requirement(
          'specialist_conference_paper',
          'Báo cáo hội nghị chuyên ngành cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.academic,
            evidenceType: 'specialist_conference_paper',
          },
        ),
        requirement(
          'creative_product_patent_or_publication',
          'Sản phẩm sáng tạo có bằng/quyền công bố hoặc giải thưởng cấp Đại học trở lên',
          'evidence',
          {
            criterion: Criterion.academic,
            evidenceType: 'creative_product_patent_or_publication',
          },
        ),
        requirement(
          'academic_competition_team',
          'Thành viên đội thi học thuật cấp Đại học trở lên',
          'evidence',
          {
            criterion: Criterion.academic,
            evidenceType: 'academic_competition_team',
          },
        ),
        requirement(
          'innovation_competition_prize',
          'Giải thưởng đổi mới/sáng tạo cấp Đại học trở lên',
          'evidence',
          {
            criterion: Criterion.academic,
            evidenceType: 'innovation_competition_prize',
          },
        ),
      ]),
    ],
  ),
  cityFinding(
    Criterion.physical,
    'city_physical_findings',
    'Thể lực: danh hiệu Thanh niên khỏe cấp Đại học trở lên hoặc tham gia và đạt giải thể thao từ cấp Khoa trở lên.',
    [
      group('physical_path', 'Một nhánh thể lực', 'one_of', [
        requirement(
          'healthy_student_title',
          'Danh hiệu Thanh niên khỏe cấp Đại học trở lên',
          'evidence',
          {
            criterion: Criterion.physical,
            evidenceType: 'healthy_student_title',
            minimumLevel: 'university',
          },
        ),
        requirement(
          'sports_activity_or_award',
          'Tham gia và đạt giải hoạt động thể thao từ cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.physical,
            evidenceType: 'sports_activity_or_award',
          },
        ),
      ]),
    ],
  ),
  {
    criterion: Criterion.volunteer,
    ruleKey: 'city_volunteer_days',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 5 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Gợi ý đối chiếu: tổng số ngày tình nguyện từ 5 ngày trong năm học.',
  },
  cityFinding(
    Criterion.volunteer,
    'city_volunteer_findings',
    'Tình nguyện: cần đồng thời ít nhất 5 ngày tình nguyện và khen thưởng hoạt động tình nguyện từ cấp Khoa trở lên.',
    [
      group('volunteer_path', 'Hai finding tình nguyện cần được đối chiếu', 'all_of', [
        requirement(
          'accumulated_volunteer_days',
          'Ít nhất 5 ngày tình nguyện trong năm học',
          'activity_aggregation',
          {
            metricType: MetricType.volunteer_days,
            operator: '>=',
            threshold: 5,
            requiredValue: 5,
            valueField: 'convertedValue',
            aggregationUnit: 'day',
          },
        ),
        requirement(
          'volunteer_commendation',
          'Khen thưởng hoạt động tình nguyện từ cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.volunteer,
            evidenceType: 'volunteer_commendation',
          },
        ),
      ]),
    ],
  ),
  cityFinding(
    Criterion.integration,
    'city_integration_findings',
    'Hội nhập: một điều kiện nền và đồng thời ít nhất một nhánh ngoại ngữ, giao lưu quốc tế hoặc cuộc thi phù hợp.',
    [
      group('integration_base', 'Điều kiện nền', 'one_of', [
        requirement(
          'social_practice_skill_course',
          'Hoàn thành khóa kỹ năng thực hành xã hội',
          'evidence',
          {
            criterion: Criterion.integration,
            evidenceType: 'social_practice_skill_course',
          },
        ),
        requirement(
          'youth_union_student_association_commendation',
          'Khen thưởng hoạt động Đoàn/Hội từ cấp Khoa trở lên trong năm học',
          'evidence',
          {
            criterion: Criterion.integration,
            evidenceType: 'youth_union_student_association_commendation',
          },
        ),
      ]),
      group('integration_additional', 'Một nhánh hội nhập bổ sung', 'one_of', [
        requirement(
          'foreign_language',
          'Ngoại ngữ: B1/C, TOEIC 405, TOEFL iBT 53, IELTS 4.5, hoặc điểm tích lũy 3.0/4 hay 7.5/10',
          'evidence',
          {
            criterion: Criterion.integration,
            evidenceType: 'foreign_language',
          },
          {
            formSchema: {
              languageThresholds: [
                'B1/C',
                'TOEIC 405',
                'TOEFL iBT 53',
                'IELTS 4.5',
                '3.0/4',
                '7.5/10',
              ],
              foreignLanguageMajorsUse: 'Foreign Language 2',
            },
          },
        ),
        requirement(
          'international_exchange',
          'Tham gia hoạt động giao lưu/hội nhập quốc tế từ cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.integration,
            evidenceType: 'international_exchange',
          },
        ),
        requirement(
          'knowledge_or_language_competition',
          'Đạt giải Ba trở lên cuộc thi kiến thức/ngoại ngữ từ cấp Khoa trở lên',
          'evidence',
          {
            criterion: Criterion.integration,
            evidenceType: 'knowledge_or_language_competition',
          },
        ),
      ]),
    ],
  ),
];
