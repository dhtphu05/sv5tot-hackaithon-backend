import { Criterion, Level } from '@prisma/client';
import type {
  CriteriaRuleNode,
  CriteriaSeedValidationSummary,
  SeedCriteriaConfig,
  SeedCriteriaRule,
} from './criteria.types';

export const officialCriteria = [
  Criterion.ethics,
  Criterion.academic,
  Criterion.physical,
  Criterion.volunteer,
  Criterion.integration,
] as const;

export function all(children: CriteriaRuleNode[]): CriteriaRuleNode {
  return { type: 'ALL', children };
}

export function anyOf(children: CriteriaRuleNode[], minimumMatches = 1): CriteriaRuleNode {
  return { type: 'ANY', minimumMatches, children };
}

export function threshold(
  metric: Extract<
    CriteriaRuleNode,
    { type: 'THRESHOLD' }
  >['metric'],
  value: number,
  options: { scale?: number; label?: string } = {},
): CriteriaRuleNode {
  return { type: 'THRESHOLD', metric, operator: '>=', value, ...options };
}

export function booleanRequirement(key: string, label: string, expected = true): CriteriaRuleNode {
  return { type: 'BOOLEAN', key, label, expected };
}

export function noViolation(label = 'Không vi phạm kỷ luật, pháp luật hoặc quy định liên quan'): CriteriaRuleNode {
  return { type: 'NO_VIOLATION', label };
}

export function evidenceCategory(category: string, label: string, minimumCount = 1): CriteriaRuleNode {
  return { type: 'EVIDENCE_CATEGORY', category, label, minimumCount };
}

export function activity(
  activityType: string,
  label: string,
  options: { minimumCount?: number; minimumDays?: number } = {},
): CriteriaRuleNode {
  return { type: 'ACTIVITY', activityType, label, ...options };
}

export function award(awardType: string, label: string, minimumLevel?: Level): CriteriaRuleNode {
  return { type: 'AWARD', awardType, label, minimumLevel };
}

export function certificate(
  certificateType: string,
  label: string,
  minimumLevel?: Level,
): CriteriaRuleNode {
  return { type: 'CERTIFICATE', certificateType, label, minimumLevel };
}

export function language(
  label: string,
  options: {
    minimumLevel?: 'A2' | 'B1' | 'C1';
    minimumScore?: number;
    scale?: number;
    studentYears?: number[];
  },
): CriteriaRuleNode {
  return { type: 'LANGUAGE', label, ...options };
}

export function prerequisiteTitle(scope: Level, label: string): CriteriaRuleNode {
  return { type: 'PREREQUISITE_TITLE', scope, label };
}

export function officialRecommendation(label = 'Có giới thiệu chính thức từ cấp có thẩm quyền'): CriteriaRuleNode {
  return { type: 'OFFICIAL_RECOMMENDATION', label };
}

export function bloodDonation(label: string, donationsRequired: number, equivalentDays: number): CriteriaRuleNode {
  return { type: 'BLOOD_DONATION_CONVERSION', donationsRequired, equivalentDays, label };
}

export function manualReview(reasonCode: string, label: string, referenceData?: unknown): CriteriaRuleNode {
  return { type: 'MANUAL_REVIEW_REQUIRED', reasonCode, label, referenceData };
}

export function rule(input: SeedCriteriaRule): SeedCriteriaRule {
  return input;
}

export function validateSeedCriteria(configs: SeedCriteriaConfig[]): CriteriaSeedValidationSummary {
  const errors: string[] = [];
  const rulesByScope: Record<string, number> = {};
  const rulesByCriterion: Record<string, number> = {};
  let ruleCount = 0;
  let mandatoryCount = 0;
  let priorityCount = 0;
  let manualReviewCount = 0;

  const seenCodes = new Set<string>();
  for (const config of configs) {
    if (seenCodes.has(config.code)) errors.push(`Duplicate criteria config code: ${config.code}`);
    seenCodes.add(config.code);
    if (/\d{4}-\d{4}/.test(config.code)) errors.push(`Config code must not include year: ${config.code}`);
    if (!config.sourceDocumentName || !config.sourceOrganization || !config.sourceFileName) {
      errors.push(`Missing source metadata for ${config.code}`);
    }
    if (config.sourceFileName.startsWith('/') || /^[A-Za-z]:\\/.test(config.sourceFileName)) {
      errors.push(`Source file must be a filename only for ${config.code}`);
    }

    const keys = new Set<string>();
    const mandatoryCriteria = new Set<Criterion>();
    for (const seedRule of config.rules) {
      ruleCount += 1;
      rulesByScope[config.scope] = (rulesByScope[config.scope] ?? 0) + 1;
      rulesByCriterion[seedRule.criterion] = (rulesByCriterion[seedRule.criterion] ?? 0) + 1;
      if (keys.has(seedRule.ruleKey)) {
        errors.push(`Duplicate rule key ${seedRule.ruleKey} in ${config.code}`);
      }
      keys.add(seedRule.ruleKey);
      if (!officialCriteria.includes(seedRule.criterion)) {
        errors.push(`Unsupported criterion ${seedRule.criterion} in ${seedRule.ruleKey}`);
      }
      if (seedRule.priorityRule && seedRule.mandatory) {
        errors.push(`Priority rule cannot be mandatory: ${config.code}.${seedRule.ruleKey}`);
      }
      if (seedRule.mandatory) {
        mandatoryCount += 1;
        mandatoryCriteria.add(seedRule.criterion);
      }
      if (seedRule.priorityRule) priorityCount += 1;
      if (containsManualReview(seedRule.requirement)) manualReviewCount += 1;
      if (!seedRule.studentFriendlyText.trim()) {
        errors.push(`Missing student-friendly text: ${config.code}.${seedRule.ruleKey}`);
      }
      validateNode(`${config.code}.${seedRule.ruleKey}`, seedRule.requirement, errors);
    }
    for (const criterion of officialCriteria) {
      if (!mandatoryCriteria.has(criterion)) {
        errors.push(`Missing mandatory ${criterion} rule in ${config.code}`);
      }
    }
  }

  return {
    configCount: configs.length,
    ruleCount,
    rulesByScope,
    rulesByCriterion,
    mandatoryCount,
    priorityCount,
    manualReviewCount,
    errors,
  };
}

function validateNode(path: string, node: CriteriaRuleNode, errors: string[]): void {
  if ((node.type === 'ALL' || node.type === 'ANY') && node.children.length === 0) {
    errors.push(`Empty ${node.type} node at ${path}`);
  }
  if (node.type === 'ANY' && (node.minimumMatches < 1 || node.minimumMatches > node.children.length)) {
    errors.push(`Invalid ANY.minimumMatches at ${path}`);
  }
  if (node.type === 'THRESHOLD' && (!Number.isFinite(node.value) || node.value < 0)) {
    errors.push(`Invalid threshold value at ${path}`);
  }
  if (node.type === 'ALL' || node.type === 'ANY') {
    node.children.forEach((child, index) => validateNode(`${path}.${index}`, child, errors));
  }
}

function containsManualReview(node: CriteriaRuleNode): boolean {
  if (node.type === 'MANUAL_REVIEW_REQUIRED') return true;
  if (node.type === 'ALL' || node.type === 'ANY') return node.children.some(containsManualReview);
  return false;
}
