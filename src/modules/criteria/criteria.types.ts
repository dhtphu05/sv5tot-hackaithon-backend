import type { Criterion, Level } from '@prisma/client';

export type CriteriaScope = Level;
export type StudentCriterion = Exclude<Criterion, 'priority' | 'collective'>;

export type CriteriaRuleNode =
  | { type: 'ALL'; children: CriteriaRuleNode[] }
  | { type: 'ANY'; minimumMatches: number; children: CriteriaRuleNode[] }
  | {
      type: 'THRESHOLD';
      metric: 'gpa' | 'conduct_score' | 'volunteer_days' | 'foreign_language_score' | string;
      operator: '>=' | '>' | '<=' | '<' | '==';
      value: number;
      scale?: number;
      label?: string;
    }
  | { type: 'BOOLEAN'; key: string; expected: boolean; label: string }
  | { type: 'NO_VIOLATION'; label: string }
  | { type: 'EVIDENCE_CATEGORY'; category: string; minimumCount?: number; label: string }
  | { type: 'ACTIVITY'; activityType: string; minimumCount?: number; minimumDays?: number; label: string }
  | { type: 'AWARD'; awardType: string; minimumLevel?: Level; label: string }
  | { type: 'CERTIFICATE'; certificateType: string; minimumLevel?: Level; label: string }
  | {
      type: 'LANGUAGE';
      minimumLevel?: 'A2' | 'B1' | 'C1';
      minimumScore?: number;
      scale?: number;
      studentYears?: number[];
      label: string;
    }
  | { type: 'PREREQUISITE_TITLE'; scope: Level; label: string }
  | { type: 'OFFICIAL_RECOMMENDATION'; label: string }
  | { type: 'BLOOD_DONATION_CONVERSION'; donationsRequired: number; equivalentDays: number; label: string }
  | { type: 'DATE_WINDOW'; label: string }
  | { type: 'MANUAL_REVIEW_REQUIRED'; reasonCode: string; label: string; referenceData?: unknown };

export type CriteriaRuleStatus =
  | 'MATCHED'
  | 'MISSING'
  | 'UNKNOWN'
  | 'NEEDS_CONFIRMATION'
  | 'MANUAL_REVIEW';

export type CriteriaStatus = 'READY' | 'INCOMPLETE' | 'NEEDS_CONFIRMATION' | 'NEEDS_MANUAL_REVIEW';

export type CriterionEvaluationStatus =
  | 'READY'
  | 'MISSING'
  | 'PARTIAL'
  | 'NEEDS_CONFIRMATION'
  | 'NEEDS_MANUAL_REVIEW';

export type CriteriaSourceRef = {
  criteriaConfigId: string;
  ruleKey?: string;
  label: string;
  documentName: string;
  page: number | null;
  section: string | null;
};

export type EvaluatedCriteriaRule = {
  ruleKey: string;
  title: string;
  matched: boolean | null;
  status: CriteriaRuleStatus;
  currentValue?: unknown;
  requiredValue?: unknown;
  matchedEvidenceIds: string[];
  missingItems: string[];
  studentFriendlyExplanation: string;
  source: {
    documentName: string;
    page: number | null;
    section: string | null;
  };
};

export type CriteriaEvaluationResult = {
  criteriaConfig: {
    id: string;
    scope: CriteriaScope;
    title: string;
    sourceDocumentName: string;
    sourceDocumentNumber: string | null;
    sourceIssuedAt: string | null;
  };
  overallStatus: CriteriaStatus;
  criteria: Array<{
    criterion: StudentCriterion;
    status: CriterionEvaluationStatus;
    mandatoryRules: EvaluatedCriteriaRule[];
    priorityAchievements: Array<{
      ruleKey: string;
      matched: boolean | null;
      explanation: string;
      source: CriteriaSourceRef;
    }>;
  }>;
  sourceRefs: CriteriaSourceRef[];
  allowedActions: Array<{
    id: string;
    type: 'open_criterion' | 'add_evidence' | 'confirm_evidence' | 'run_precheck' | 'contact_officer';
    label: string;
    destination: {
      route: string;
      query?: Record<string, string>;
    };
    allowed: boolean;
  }>;
};

export type CriteriaGapResult = {
  applicationId: string;
  criterion: StudentCriterion | null;
  levels: Array<{
    scope: CriteriaScope;
    status: CriteriaStatus;
    matchedCount: number;
    missing: string[];
    needsConfirmation: string[];
    manualReview: string[];
    sourceRefs: CriteriaSourceRef[];
  }>;
};
