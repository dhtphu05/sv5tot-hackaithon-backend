import type { Criterion } from '@prisma/client';

export type EvidenceAnalysisProviderName = 'openai' | 'smartreader' | 'mock';

export type EvidenceDocumentType =
  | 'conduct_result'
  | 'student_healthy_certificate'
  | 'volunteer_certificate'
  | 'activity_certificate'
  | 'award_certificate'
  | 'language_certificate'
  | 'academic_result'
  | 'research_achievement'
  | 'international_exchange'
  | 'participant_confirmation'
  | 'certificate'
  | 'award'
  | 'transcript'
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
  confidence: number | null;
  source: EvidenceAnalysisProviderName | 'event_registry';
};

export type EvidenceAnalysisFields = Record<EvidenceAnalysisFieldName, ExtractedField>;

export type EvidenceAnalysisWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  field?: EvidenceAnalysisFieldName;
  message: string;
};

export type EvidenceDocumentPrecheckInput = {
  identifiedAs: {
    documentLabel: string;
    shortDescription: string;
  };
  completeness: {
    score: number;
    availableFields: EvidenceAnalysisFieldName[];
    missingImportantFields: EvidenceAnalysisFieldName[];
  };
  quality: {
    level: 'clear' | 'needs_check' | 'poor';
    issues: Array<
      | 'blurred'
      | 'cropped'
      | 'low_resolution'
      | 'handwriting_unclear'
      | 'multiple_documents'
      | 'page_missing'
    >;
  };
  relevance: Array<{
    criterion: Criterion;
    level: 'strong' | 'possible' | 'unclear';
    explanation: string;
  }>;
};

export type EvidenceDocumentFacts = {
  documentTitle: string | null;
  identity: {
    studentName: string | null;
    studentCode: string | null;
    schoolName: string | null;
  };
  activity: {
    eventName: string | null;
    programName: string | null;
    location: string | null;
    activityDate: string | null;
  };
  organization: {
    issuerName: string | null;
    issuerLevel: string | null;
  };
  conductEntries: Array<{
    semester: string | null;
    schoolYear: string | null;
    score: number | null;
    classification: string | null;
  }>;
  fitness: {
    title: string | null;
    resultLevel: string | null;
    sportName: string | null;
  };
  language: {
    certificateType: string | null;
    score: number | null;
    frameworkLevel: string | null;
  };
  award: {
    title: string | null;
    rank: string | null;
    level: string | null;
  };
  academic: {
    gpa: number | null;
    gpaScale: number | null;
    hasFGrade: boolean | null;
  };
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
  documentFacts: EvidenceDocumentFacts;
  fields: EvidenceAnalysisFields;
  suggestedCriteria: Array<{
    criterion: Criterion;
    confidence: number;
    reason: string;
  }>;
  documentPrecheck: EvidenceDocumentPrecheckInput;
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
