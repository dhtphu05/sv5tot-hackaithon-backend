import { Criterion, MetricType } from '@prisma/client';
import type { CriteriaRuleConfig } from './rules.types';

export const cityRules: CriteriaRuleConfig[] = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'city_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 80 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Thành phố: điểm rèn luyện từ 80 trở lên.',
  },
  {
    criterion: Criterion.ethics,
    ruleKey: 'city_ethics_foundation_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'FOUNDATION_LEVEL_NEEDS_REVIEW' },
    humanReadableText: 'Cấp Thành phố: cần cán bộ xác nhận điều kiện nền cấp trường.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'city_academic_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3.2 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Thành phố: GPA từ 3.2/4.0 trở lên.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'city_academic_evidence',
    ruleType: 'evidence_required',
    thresholdJson: null,
    evidenceRequirementsJson: { criterion: Criterion.academic },
    humanReadableText: 'Cấp Thành phố: cần thêm ít nhất 1 minh chứng học thuật.',
  },
  {
    criterion: Criterion.physical,
    ruleKey: 'city_physical_evidence',
    ruleType: 'evidence_required',
    thresholdJson: null,
    evidenceRequirementsJson: { criterion: Criterion.physical },
    humanReadableText: 'Cấp Thành phố: cần minh chứng thể lực hoặc danh hiệu sinh viên khỏe.',
  },
  {
    criterion: Criterion.volunteer,
    ruleKey: 'city_volunteer_days',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 5 },
    evidenceRequirementsJson: { criterion: Criterion.volunteer, convertedUnit: 'days' },
    humanReadableText:
      'Cấp Thành phố: có ít nhất 5 ngày tình nguyện hoặc minh chứng quy đổi tương đương.',
  },
  {
    criterion: Criterion.integration,
    ruleKey: 'city_integration_evidence_or_language',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 3 },
    evidenceRequirementsJson: { criterion: Criterion.integration },
    humanReadableText: 'Cấp Thành phố: có ngoại ngữ B1/TOEIC/IELTS hoặc minh chứng hội nhập.',
  },
  {
    criterion: Criterion.priority,
    ruleKey: 'city_priority_optional',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { optional: true, warningCode: 'PRIORITY_OPTIONAL' },
    humanReadableText: 'Tiêu chí ưu tiên là thông tin bổ sung, không bắt buộc ở MVP.',
  },
];
