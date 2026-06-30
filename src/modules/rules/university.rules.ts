import { Criterion, MetricType } from '@prisma/client';
import type { CriteriaRuleConfig } from './rules.types';

export const universityRules: CriteriaRuleConfig[] = [
  {
    criterion: Criterion.ethics,
    ruleKey: 'university_ethics_conduct_score',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.conduct_score, operator: '>=', value: 80 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Đại học: điểm rèn luyện từ 80 trở lên.',
  },
  {
    criterion: Criterion.ethics,
    ruleKey: 'university_ethics_foundation_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'FOUNDATION_LEVEL_NEEDS_REVIEW' },
    humanReadableText: 'Cấp Đại học: cần cán bộ xác nhận điều kiện nền cấp trường.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'university_academic_gpa',
    ruleType: 'metric_threshold',
    thresholdJson: { metric: MetricType.gpa, operator: '>=', value: 3.2 },
    evidenceRequirementsJson: null,
    humanReadableText: 'Cấp Đại học: GPA từ 3.2/4.0 trở lên.',
  },
  {
    criterion: Criterion.academic,
    ruleKey: 'university_academic_evidence_review',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { warningCode: 'ACADEMIC_EVIDENCE_NEEDS_REVIEW' },
    humanReadableText: 'Cấp Đại học: cần minh chứng học thuật hoặc cán bộ xác nhận.',
  },
  {
    criterion: Criterion.physical,
    ruleKey: 'university_physical_evidence',
    ruleType: 'evidence_required',
    thresholdJson: null,
    evidenceRequirementsJson: { criterion: Criterion.physical },
    humanReadableText: 'Cấp Đại học: cần minh chứng thể lực.',
  },
  {
    criterion: Criterion.volunteer,
    ruleKey: 'university_volunteer_days_or_event',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.volunteer_days, operator: '>=', value: 3 },
    evidenceRequirementsJson: { criterion: Criterion.volunteer, sourceType: 'event_import' },
    humanReadableText: 'Cấp Đại học: có ít nhất 3 ngày tình nguyện hoặc import từ Kho sự kiện.',
  },
  {
    criterion: Criterion.integration,
    ruleKey: 'university_integration_evidence_or_language',
    ruleType: 'evidence_or_metric',
    thresholdJson: { metric: MetricType.foreign_language_score, operator: '>=', value: 3 },
    evidenceRequirementsJson: { criterion: Criterion.integration },
    humanReadableText:
      'Cấp Đại học: có hoạt động hội nhập và ngoại ngữ tương đương B1 hoặc minh chứng hội nhập.',
  },
  {
    criterion: Criterion.priority,
    ruleKey: 'university_priority_optional',
    ruleType: 'human_review_note',
    thresholdJson: null,
    evidenceRequirementsJson: { optional: true, warningCode: 'PRIORITY_OPTIONAL' },
    humanReadableText: 'Tiêu chí ưu tiên là thông tin bổ sung, không bắt buộc ở MVP.',
  },
];
