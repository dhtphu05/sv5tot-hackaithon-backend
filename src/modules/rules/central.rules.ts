import { Criterion, MetricType } from '@prisma/client';
import type { CriteriaRuleConfig } from './rules.types';

export const centralRules: CriteriaRuleConfig[] = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'central_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 90 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Trung ương: điểm rèn luyện từ 90 trở lên.',
  },
  {
    criterion: Criterion.ethics,
    ruleKey: 'central_ethics_foundation_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'CENTRAL_FOUNDATION_NEEDS_REVIEW' },
    humanReadableText:
      'Cấp Trung ương: cần cán bộ xác nhận điều kiện nền cấp tỉnh/trường tùy đơn vị.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'central_academic_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3.4 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Trung ương: GPA từ 3.4/4.0 trở lên.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'central_academic_strong_evidence_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'STRONG_ACADEMIC_EVIDENCE_NEEDS_REVIEW' },
    humanReadableText: 'Cấp Trung ương: cần cán bộ kiểm tra thành tích học thuật mạnh.',
  },
  {
    criterion: Criterion.physical,
    ruleKey: 'central_physical_evidence',
    ruleType: 'evidence_required',
    thresholdJson: null,
    evidenceRequirementsJson: { criterion: Criterion.physical },
    humanReadableText:
      'Cấp Trung ương: cần minh chứng thể lực cấp tỉnh/trung ương hoặc thể thao cấp trường trở lên.',
  },
  {
    criterion: Criterion.volunteer,
    ruleKey: 'central_volunteer_days',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 5 },
    evidenceRequirementsJson: { criterion: Criterion.volunteer, convertedUnit: 'days' },
    humanReadableText: 'Cấp Trung ương: có ít nhất 5 ngày tình nguyện và minh chứng phù hợp.',
  },
  {
    criterion: Criterion.volunteer,
    ruleKey: 'central_volunteer_award_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'VOLUNTEER_AWARD_NEEDS_REVIEW' },
    humanReadableText:
      'Cấp Trung ương: cần cán bộ kiểm tra khen thưởng hoặc hoạt động tình nguyện phù hợp.',
  },
  {
    criterion: Criterion.integration,
    ruleKey: 'central_integration_evidence_or_language',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 3 },
    evidenceRequirementsJson: { criterion: Criterion.integration },
    humanReadableText: 'Cấp Trung ương: có ngoại ngữ B1 hoặc tương đương và hoạt động hội nhập.',
  },
  {
    criterion: Criterion.priority,
    ruleKey: 'central_priority_optional',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { optional: true, warningCode: 'PRIORITY_OPTIONAL' },
    humanReadableText: 'Tiêu chí ưu tiên là thông tin bổ sung, không bắt buộc ở MVP.',
  },
];
