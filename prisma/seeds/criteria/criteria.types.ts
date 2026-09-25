import type { Criterion, Level } from '@prisma/client';

export type CriteriaRuleNode =
  | { type: 'ALL'; children: CriteriaRuleNode[] }
  | { type: 'ANY'; minimumMatches: number; children: CriteriaRuleNode[] }
  | {
      type: 'THRESHOLD';
      metric: 'gpa' | 'conduct_score' | 'volunteer_days' | 'foreign_language_score';
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

export type SeedCriteriaRule = {
  criterion: Exclude<Criterion, 'priority' | 'collective'>;
  ruleKey: string;
  title: string;
  requirement: CriteriaRuleNode;
  mandatory: boolean;
  priorityRule?: boolean;
  studentFriendlyText: string;
  officerFriendlyText?: string;
  acceptedEvidenceHints?: string[];
  missingActionHints?: string[];
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceQuote?: string | null;
  sortOrder: number;
};

export type SeedCriteriaConfig = {
  code: string;
  scope: Level;
  workspaceCode: string | null;
  title: string;
  description?: string | null;
  sourceDocumentName: string;
  sourceDocumentNumber?: string | null;
  sourceIssuedAt?: string | null;
  sourcePeriodLabel?: string | null;
  sourceOrganization: string;
  sourceFileName: string;
  sourceNote?: string | null;
  rules: SeedCriteriaRule[];
};

export type CriteriaSeedValidationSummary = {
  configCount: number;
  ruleCount: number;
  rulesByScope: Record<string, number>;
  rulesByCriterion: Record<string, number>;
  mandatoryCount: number;
  priorityCount: number;
  manualReviewCount: number;
  errors: string[];
};
