import { Criterion, Level } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toCriteriaPrecheckCompatibility } from '../../src/modules/criteria/criteria-precheck-adapter';

describe('criteria precheck compatibility adapter', () => {
  it('converts normalized statuses into readiness without official pass/fail language', () => {
    const result = toCriteriaPrecheckCompatibility({
      criteriaConfig: {
        id: 'config-id',
        scope: Level.school,
        title: 'Bộ tiêu chí cấp Trường',
        sourceDocumentName: 'Quy định cấp Trường',
        sourceDocumentNumber: null,
        sourceIssuedAt: null,
      },
      overallStatus: 'INCOMPLETE',
      criteria: [
        {
          criterion: Criterion.ethics,
          status: 'READY',
          mandatoryRules: [
            rule('ethics.ready', 'MATCHED'),
          ],
          priorityAchievements: [
            {
              ruleKey: 'priority.ethics',
              matched: false,
              explanation: 'Ưu tiên không bắt buộc.',
              source: source('priority.ethics'),
            },
          ],
        },
        {
          criterion: Criterion.academic,
          status: 'NEEDS_CONFIRMATION',
          mandatoryRules: [
            rule('academic.confirm', 'NEEDS_CONFIRMATION'),
          ],
          priorityAchievements: [],
        },
      ],
      sourceRefs: [source('ethics.ready'), source('academic.confirm')],
      allowedActions: [],
    });

    expect(result.readinessScore).toBe(50);
    expect(result.missingItems).toHaveLength(1);
    expect(result.nextBestAction.type).toBe('confirm_evidence');
    expect(JSON.stringify(result).toLowerCase()).not.toContain('pass');
    expect(JSON.stringify(result).toLowerCase()).not.toContain('fail');
  });
});

function rule(ruleKey: string, status: 'MATCHED' | 'NEEDS_CONFIRMATION') {
  return {
    ruleKey,
    title: ruleKey,
    matched: status === 'MATCHED' ? true : null,
    status,
    matchedEvidenceIds: [],
    missingItems: status === 'MATCHED' ? [] : ['Cần xác nhận minh chứng'],
    studentFriendlyExplanation: 'Giải thích',
    source: {
      documentName: 'Quy định',
      page: null,
      section: 'Mục',
    },
  };
}

function source(ruleKey: string) {
  return {
    criteriaConfigId: 'config-id',
    ruleKey,
    label: ruleKey,
    documentName: 'Quy định',
    page: null,
    section: 'Mục',
  };
}
