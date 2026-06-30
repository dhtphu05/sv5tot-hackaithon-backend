import { Criterion, MetricType } from '@prisma/client';
import type { CriteriaRuleConfig } from './rules.types';

export const schoolRules: CriteriaRuleConfig[] = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'school_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 82 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp trường: điểm rèn luyện từ 82 trở lên.',
  },
  {
    criterion: Criterion.ethics,
    ruleKey: 'school_ethics_no_violation_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'NO_VIOLATION_NEEDS_REVIEW' },
    humanReadableText: 'Cấp trường: cần cán bộ xác nhận không vi phạm kỷ luật.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'school_academic_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3.0 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp trường: GPA từ 3.0/4.0 trở lên.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'school_academic_no_f_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'NO_F_GRADE_NEEDS_REVIEW' },
    humanReadableText: 'Cấp trường: cần cán bộ xác nhận không có học phần điểm F.',
  },
  {
    criterion: Criterion.physical,
    ruleKey: 'school_physical_evidence_or_score',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.physical_score, operator: '>=', value: 6.5 },
    evidenceRequirementsJson: { criterion: Criterion.physical },
    humanReadableText: 'Cấp trường: có minh chứng thể lực hoặc điểm thể lực từ 6.5.',
  },
  {
    criterion: Criterion.volunteer,
    ruleKey: 'school_volunteer_days_or_evidence',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 2 },
    evidenceRequirementsJson: { criterion: Criterion.volunteer, convertedUnit: 'days' },
    humanReadableText: 'Cấp trường: có ít nhất 2 ngày tình nguyện hoặc minh chứng/sự kiện hợp lệ.',
  },
  {
    criterion: Criterion.integration,
    ruleKey: 'school_integration_evidence_or_language',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 2 },
    evidenceRequirementsJson: { criterion: Criterion.integration },
    humanReadableText: 'Cấp trường: có minh chứng hội nhập hoặc dữ liệu ngoại ngữ tương đương A2.',
  },
  {
    criterion: Criterion.priority,
    ruleKey: 'school_priority_optional',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { optional: true, warningCode: 'PRIORITY_OPTIONAL' },
    humanReadableText: 'Tiêu chí ưu tiên là thông tin bổ sung, không bắt buộc ở MVP.',
  },
];
