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

const providerSourceSchema = z.enum(['openai', 'smartreader', 'mock', 'event_registry']);
const organizerLevelSchema = z.enum([
  'class',
  'faculty',
  'school',
  'university',
  'city',
  'central',
  'unknown',
]);
const confidenceSchema = z.number().min(0).max(1);
const nullableStringSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().nullable(),
);

const textFieldSchema = z
  .object({
    value: nullableStringSchema,
    confidence: confidenceSchema,
    source: providerSourceSchema,
  })
  .strict();

const numberFieldSchema = (min: number, max?: number) =>
  z
    .object({
      value: z.number().min(min).max(max ?? Number.MAX_SAFE_INTEGER).nullable(),
      confidence: confidenceSchema,
      source: providerSourceSchema,
    })
    .strict();

const organizerLevelFieldSchema = z
  .object({
    value: organizerLevelSchema.nullable(),
    confidence: confidenceSchema,
    source: providerSourceSchema,
  })
  .strict();

export const evidenceAnalysisOutputSchema = z
  .object({
    documentType: z.enum([
      'certificate',
      'award',
      'transcript',
      'language_certificate',
      'participant_list',
      'other',
    ]),
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
    warnings: z
      .array(
        z
          .object({
            code: z.string().trim().min(1),
            severity: z.enum(['info', 'warning', 'blocking']),
            field: z.enum(evidenceAnalysisFieldNames).optional(),
            message: z.string().trim().min(1),
          })
          .strict(),
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
): Record<EvidenceAnalysisFieldName, number> {
  return Object.fromEntries(
    evidenceAnalysisFieldNames.map((field) => [field, fields[field].confidence]),
  ) as Record<EvidenceAnalysisFieldName, number>;
}
