import type { Criterion } from '@prisma/client';

export type EvidenceAnalysisProviderName = 'openai' | 'smartreader' | 'mock';

export type EvidenceDocumentType =
  | 'certificate'
  | 'award'
  | 'transcript'
  | 'language_certificate'
  | 'participant_list'
  | 'other';

export type EvidenceAnalysisFieldName =
  | 'student_name'
  | 'student_code'
  | 'class_name'
  | 'faculty'
  | 'event_name'
  | 'organizer'
  | 'organizer_level'
  | 'issue_date'
  | 'activity_date'
  | 'award_level'
  | 'volunteer_days'
  | 'certificate_type'
  | 'language_score'
  | 'gpa'
  | 'conduct_score';

export type ExtractedFieldValue = string | number | null;

export type ExtractedField<T extends ExtractedFieldValue = ExtractedFieldValue> = {
  value: T;
  confidence: number;
  source: EvidenceAnalysisProviderName | 'event_registry';
};

export type EvidenceAnalysisFields = Record<EvidenceAnalysisFieldName, ExtractedField>;

export type EvidenceAnalysisWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  field?: EvidenceAnalysisFieldName;
  message: string;
};

export type EvidenceDocumentAnalysisInput = {
  evidenceId: string;
  evidenceFileId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  fileBuffer: Buffer;
  evidenceName: string;
  selectedCriterion: Criterion;
  studentContext?: {
    fullName?: string | null;
    studentCode?: string | null;
  };
};

export type EvidenceDocumentAnalysisResult = {
  provider: EvidenceAnalysisProviderName;
  providerModel?: string;
  promptVersion?: string;
  requestId?: string;
  latencyMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  documentType: EvidenceDocumentType;
  fields: EvidenceAnalysisFields;
  suggestedCriteria: Array<{
    criterion: Criterion;
    confidence: number;
    reason: string;
  }>;
  warnings: EvidenceAnalysisWarning[];
  summary: string;
  overallConfidence: number;
  requiresHumanConfirmation: boolean;
};

export interface EvidenceAnalysisProvider {
  readonly provider: EvidenceAnalysisProviderName;
  analyze(input: EvidenceDocumentAnalysisInput): Promise<EvidenceDocumentAnalysisResult>;
}

export type EvidenceAnalysisRuntimeConfig = {
  provider?: EvidenceAnalysisProviderName;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiTimeoutMs?: number;
  openaiMaxRetries?: number;
  openaiStoreResponses?: boolean;
  openaiPromptVersion?: string;
};
