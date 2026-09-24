import type { CriteriaEvaluationResult } from './criteria.types';

export type CriteriaPrecheckCompatibilityResult = {
  readinessScore: number;
  missingItems: Array<{
    criterion: string;
    code: string;
    message: string;
    severity: 'blocking' | 'warning' | 'info';
    suggestedAction: string;
  }>;
  nextBestAction: {
    type: 'confirm_evidence' | 'add_evidence' | 'contact_officer' | 'none';
    label: string;
    route: string;
  };
};

export function toCriteriaPrecheckCompatibility(
  evaluation: CriteriaEvaluationResult,
): CriteriaPrecheckCompatibilityResult {
  const mandatoryRules = evaluation.criteria.flatMap((criterion) =>
    criterion.mandatoryRules.map((rule) => ({ criterion: criterion.criterion, rule })),
  );
  const matched = mandatoryRules.filter((item) => item.rule.status === 'MATCHED').length;
  const readinessScore = mandatoryRules.length === 0 ? 0 : Math.round((matched / mandatoryRules.length) * 100);
  const missingItems = mandatoryRules
    .filter((item) => item.rule.status !== 'MATCHED')
    .map((item) => ({
      criterion: item.criterion,
      code: item.rule.ruleKey,
      message: item.rule.missingItems[0] ?? item.rule.studentFriendlyExplanation,
      severity:
        item.rule.status === 'MANUAL_REVIEW'
          ? ('warning' as const)
          : item.rule.status === 'NEEDS_CONFIRMATION'
            ? ('info' as const)
            : ('blocking' as const),
      suggestedAction:
        item.rule.status === 'NEEDS_CONFIRMATION'
          ? 'Xác nhận dữ liệu minh chứng liên quan'
          : item.rule.status === 'MANUAL_REVIEW'
            ? 'Liên hệ cán bộ phụ trách'
            : 'Bổ sung dữ liệu hoặc minh chứng',
    }));
  const first = missingItems[0];
  return {
    readinessScore,
    missingItems,
    nextBestAction: first
      ? first.severity === 'info'
        ? { type: 'confirm_evidence', label: 'Xác nhận minh chứng', route: '/app/application' }
        : first.severity === 'warning'
          ? { type: 'contact_officer', label: 'Liên hệ cán bộ', route: '/app/feedback' }
          : { type: 'add_evidence', label: 'Bổ sung minh chứng', route: '/app/application' }
      : { type: 'none', label: 'Không có hành động tiếp theo', route: '/app/application' },
  };
}
