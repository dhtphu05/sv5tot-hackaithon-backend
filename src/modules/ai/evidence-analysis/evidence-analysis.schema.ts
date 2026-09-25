import { Criterion } from '@prisma/client';
import { z } from 'zod';
import type {
  EvidenceAnalysisFieldName,
  EvidenceDocumentAnalysisResult,
  EvidenceAnalysisProviderName,
} from './evidence-analysis.types';

export const evidenceAnalysisFieldNames = [
  'student_name',
  'student_code',
  'class_name',
  'faculty',
  'event_name',
  'organizer',
  'organizer_level',
  'issue_date',
  'activity_date',
  'award_level',
  'volunteer_days',
  'certificate_type',
  'language_score',
  'gpa',
  'conduct_score',
] as const satisfies readonly EvidenceAnalysisFieldName[];

export const evidenceDocumentTypes = [
  'conduct_result',
  'student_healthy_certificate',
  'volunteer_certificate',
  'activity_certificate',
  'award_certificate',
  'language_certificate',
  'academic_result',
  'research_achievement',
  'international_exchange',
  'participant_confirmation',
  'certificate',
  'award',
  'transcript',
  'participant_list',
  'other',
] as const;

const providerSourceSchema = z.enum(['openai', 'smartreader', 'mock', 'event_registry']);
const organizerLevelSchema = z.enum([
  'class',
  'faculty',
  'school',
  'university',
  'city',
  'central',
  'club',
  'external',
  'unknown',
]);
const confidenceSchema = z.number().min(0).max(1);
const fieldConfidenceSchema = confidenceSchema.nullable();
const nullableStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().nullable(),
);

const textFieldSchema = z
  .object({
    value: nullableStringSchema,
    confidence: fieldConfidenceSchema,
    source: providerSourceSchema,
  })
  .strict();

const numberFieldSchema = (min: number, max?: number) =>
  z
    .object({
      value: z.number().min(min).max(max ?? Number.MAX_SAFE_INTEGER).nullable(),
      confidence: fieldConfidenceSchema,
      source: providerSourceSchema,
    })
    .strict();

const organizerLevelFieldSchema = z
  .object({
    value: organizerLevelSchema.nullable(),
    confidence: fieldConfidenceSchema,
    source: providerSourceSchema,
  })
  .strict();

const qualityIssueSchema = z.enum([
  'blurred',
  'cropped',
  'low_resolution',
  'handwriting_unclear',
  'multiple_documents',
  'page_missing',
]);

const documentPrecheckSchema = z
  .object({
    identifiedAs: z
      .object({
        documentLabel: z.string().trim().min(1),
        shortDescription: z.string().trim().min(1),
      })
      .strict(),
    completeness: z
      .object({
        score: confidenceSchema,
        availableFields: z.array(z.enum(evidenceAnalysisFieldNames)).default([]),
        missingImportantFields: z.array(z.enum(evidenceAnalysisFieldNames)).default([]),
      })
      .strict(),
    quality: z
      .object({
        level: z.enum(['clear', 'needs_check', 'poor']),
        issues: z.array(qualityIssueSchema).default([]),
      })
      .strict(),
    relevance: z
      .array(
        z
          .object({
            criterion: z.nativeEnum(Criterion),
            level: z.enum(['strong', 'possible', 'unclear']),
            explanation: z.string().trim().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const documentFactsSchema = z
  .object({
    documentTitle: nullableStringSchema,
    identity: z
      .object({
        studentName: nullableStringSchema,
        studentCode: nullableStringSchema,
        schoolName: nullableStringSchema,
      })
      .strict()
      .default({ studentName: null, studentCode: null, schoolName: null }),
    activity: z
      .object({
        eventName: nullableStringSchema,
        programName: nullableStringSchema,
        location: nullableStringSchema,
        activityDate: nullableStringSchema,
      })
      .strict()
      .default({ eventName: null, programName: null, location: null, activityDate: null }),
    organization: z
      .object({
        issuerName: nullableStringSchema,
        issuerLevel: nullableStringSchema,
      })
      .strict()
      .default({ issuerName: null, issuerLevel: null }),
    conductEntries: z.array(
      z
        .object({
          semester: nullableStringSchema,
          schoolYear: nullableStringSchema,
          score: z.number().min(0).max(100).nullable(),
          classification: nullableStringSchema,
        })
        .strict(),
    ),
    fitness: z
      .object({
        title: nullableStringSchema,
        resultLevel: nullableStringSchema,
        sportName: nullableStringSchema,
      })
      .strict(),
    language: z
      .object({
        certificateType: nullableStringSchema,
        score: z.number().min(0).nullable(),
        frameworkLevel: nullableStringSchema,
      })
      .strict(),
    award: z
      .object({
        title: nullableStringSchema,
        rank: nullableStringSchema,
        level: nullableStringSchema,
      })
      .strict(),
    academic: z
      .object({
        gpa: z.number().min(0).max(4).nullable(),
        gpaScale: z.number().min(0).nullable(),
        hasFGrade: z.boolean().nullable(),
      })
      .strict(),
  })
  .strict();

export const evidenceAnalysisOutputSchema = z
  .object({
    documentType: z.enum(evidenceDocumentTypes),
    documentFacts: documentFactsSchema,
    fields: z
      .object({
        student_name: textFieldSchema,
        student_code: textFieldSchema,
        class_name: textFieldSchema,
        faculty: textFieldSchema,
        event_name: textFieldSchema,
        organizer: textFieldSchema,
        organizer_level: organizerLevelFieldSchema,
        issue_date: textFieldSchema,
        activity_date: textFieldSchema,
        award_level: textFieldSchema,
        volunteer_days: numberFieldSchema(0),
        certificate_type: textFieldSchema,
        language_score: numberFieldSchema(0),
        gpa: numberFieldSchema(0, 4),
        conduct_score: numberFieldSchema(0, 100),
      })
      .strict(),
    suggestedCriteria: z
      .array(
        z
          .object({
            criterion: z.nativeEnum(Criterion),
            confidence: confidenceSchema,
            reason: z.string().trim().min(1),
          })
          .strict(),
      )
      .default([]),
    documentPrecheck: documentPrecheckSchema,
    warnings: z
      .array(
        z
          .object({
            code: z.string().trim().min(1),
            severity: z.enum(['info', 'warning', 'blocking']),
            field: z.enum(evidenceAnalysisFieldNames).nullable().optional(),
            message: z.string().trim().min(1),
          })
          .strict()
          .transform((warning) => ({
            code: warning.code,
            severity: warning.severity,
            ...(warning.field ? { field: warning.field } : {}),
            message: warning.message,
          })),
      )
      .default([]),
    summary: z.string().trim().min(1),
    overallConfidence: confidenceSchema,
    requiresHumanConfirmation: z.boolean(),
  })
  .strict();

export function validateEvidenceAnalysisOutput(
  value: unknown,
  provider: EvidenceAnalysisProviderName,
  providerModel?: string,
  promptVersion?: string,
): EvidenceDocumentAnalysisResult {
  const parsed = evidenceAnalysisOutputSchema.parse(value);
  return {
    ...parsed,
    provider,
    providerModel,
    promptVersion,
  };
}

export function toFlatExtractedFields(
  fields: EvidenceDocumentAnalysisResult['fields'],
): Record<EvidenceAnalysisFieldName, string | number | null> {
  return Object.fromEntries(
    evidenceAnalysisFieldNames.map((field) => [field, fields[field].value]),
  ) as Record<EvidenceAnalysisFieldName, string | number | null>;
}

export function toFieldConfidenceMap(
  fields: EvidenceDocumentAnalysisResult['fields'],
): Record<EvidenceAnalysisFieldName, number | null> {
  return Object.fromEntries(
    evidenceAnalysisFieldNames.map((field) => [field, fields[field].confidence]),
  ) as Record<EvidenceAnalysisFieldName, number | null>;
}
