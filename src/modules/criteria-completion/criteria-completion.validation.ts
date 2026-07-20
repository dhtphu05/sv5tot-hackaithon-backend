import { Criterion, RequirementResponseKind, RequirementResponseStatus } from '@prisma/client';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

export const createRequirementResponseSchema = z
  .object({
    criterion: z.nativeEnum(Criterion),
    requirementKey: z.string().min(1).max(200),
    responseKind: z.nativeEnum(RequirementResponseKind),
    metricId: uuidSchema.nullable().optional(),
    evidenceId: uuidSchema.nullable().optional(),
    payloadJson: z.unknown().optional(),
    status: z.nativeEnum(RequirementResponseStatus).default(RequirementResponseStatus.declared),
  })
  .superRefine((value, ctx) => {
    if (value.responseKind === RequirementResponseKind.metric && !value.metricId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metricId'],
        message: 'metricId is required for metric responses',
      });
    }
    if (
      (value.responseKind === RequirementResponseKind.evidence ||
        value.responseKind === RequirementResponseKind.official_event) &&
      !value.evidenceId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceId'],
        message: 'evidenceId is required for evidence responses',
      });
    }
  });

export const updateRequirementResponseSchema = z
  .object({
    requirementKey: z.string().min(1).max(200).optional(),
    responseKind: z.nativeEnum(RequirementResponseKind).optional(),
    metricId: uuidSchema.nullable().optional(),
    evidenceId: uuidSchema.nullable().optional(),
    payloadJson: z.unknown().optional(),
    status: z.nativeEnum(RequirementResponseStatus).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const linkConductScoreMetricSchema = z.object({
  metricId: uuidSchema,
});

export const declareConductScoreSchema = z.object({
  value: z.number().min(0).max(100),
  scale: z.number().positive().max(100).default(100),
  schoolYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/)
    .optional(),
  sourceType: z.enum(['manual_metric', 'manual_evidence']).default('manual_metric'),
  evidenceId: uuidSchema.optional(),
});

export const declareAcademicGpaSchema = z
  .object({
    value: z.number().min(0),
    scale: z.union([z.literal(4), z.literal(10)]).default(4),
    schoolYear: z.string().regex(/^\d{4}-\d{4}$/),
    sourceType: z.enum(['manual_metric', 'manual_evidence']).default('manual_metric'),
    evidenceId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.value > value.scale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'GPA cannot be greater than scale',
      });
    }
  });

export const confirmNoViolationSchema = z.object({
  status: z.enum([
    RequirementResponseStatus.needs_verification,
    RequirementResponseStatus.verified,
    RequirementResponseStatus.rejected,
  ]),
  payloadJson: z.record(z.unknown()).optional(),
});

export const confirmNoFGradeSchema = z.object({
  status: z.enum([
    RequirementResponseStatus.needs_verification,
    RequirementResponseStatus.verified,
    RequirementResponseStatus.rejected,
  ]),
  payloadJson: z.record(z.unknown()).optional(),
});

export const addEthicsAchievementSchema = z.object({
  evidenceId: uuidSchema,
  achievementType: z.enum([
    'political_theory_competition',
    'exemplary_youth',
    'good_person_good_deed',
    'recognized_courageous_action',
    'other_ethics_achievement',
  ]),
});

export const addAcademicAchievementSchema = z.object({
  evidenceId: uuidSchema,
  achievementType: z.enum([
    'student_research',
    'academic_competition',
    'journal_article',
    'conference_paper',
    'thesis_or_capstone',
    'innovation_product',
    'academic_team',
    'academic_award',
    'other_academic_achievement',
  ]),
});

export const declarePhysicalCourseResultSchema = z
  .object({
    resultType: z.enum(['score', 'classification']),
    value: z.number().min(0).max(10).optional(),
    classification: z.string().min(1).max(120).optional(),
    schoolYear: z.string().regex(/^\d{4}-\d{4}$/),
    sourceType: z.enum(['manual_metric', 'manual_evidence']).default('manual_metric'),
    evidenceId: uuidSchema.optional(),
    replaceExisting: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.resultType === 'score' && value.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'value is required for score result',
      });
    }
    if (value.resultType === 'classification' && !value.classification) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['classification'],
        message: 'classification is required for classification result',
      });
    }
  });

export const addPhysicalPathEvidenceSchema = z.object({
  requirementKey: z.enum([
    'healthy_student_title',
    'sports_activity_or_award',
    'sports_team_member',
    'regular_sports_training',
  ]),
  evidenceId: uuidSchema,
  sourceType: z.enum(['manual_evidence', 'official_event']).default('manual_evidence'),
  payloadJson: z.record(z.unknown()).optional(),
  replaceExisting: z.boolean().default(false),
});

export const addVolunteerActivitySchema = z
  .object({
    requirementKey: z.enum(['accumulated_volunteer_days', 'activity_count']),
    activityType: z.string().min(1).max(120),
    activityName: z.string().min(1).max(200),
    organizer: z.string().max(200).optional(),
    organizerLevel: z.string().max(120).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    declaredValue: z.number().nonnegative().optional(),
    declaredUnit: z.enum(['day', 'session', 'event', 'donation']).default('day'),
    convertedValue: z.number().nonnegative().optional(),
    convertedUnit: z.string().max(40).optional(),
    conversionSource: z.enum(['criteria_rule', 'event_registry', 'officer']).optional(),
    sourceType: z.enum(['manual_evidence', 'official_event']).default('manual_evidence'),
    evidenceId: uuidSchema.optional(),
    eventId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'official_event' && !value.eventId && !value.evidenceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eventId'],
        message: 'eventId or evidenceId is required for official volunteer activities',
      });
    }
  });

export const addVolunteerPathEvidenceSchema = z.object({
  requirementKey: z.enum(['recognized_campaign', 'volunteer_award']),
  evidenceId: uuidSchema,
  sourceType: z.enum(['manual_evidence', 'official_event']).default('manual_evidence'),
  payloadJson: z.record(z.unknown()).optional(),
});

export const addIntegrationPathResponseSchema = z.object({
  requirementKey: z.enum([
    'foreign_language',
    'skills_or_union_training',
    'international_exchange',
    'foreign_language_or_integration_competition',
    'student_union_achievement',
  ]),
  evidenceId: uuidSchema.optional(),
  sourceType: z.enum(['manual_evidence', 'official_event']).default('manual_evidence'),
  payloadJson: z.record(z.unknown()).default({}),
});

export type CreateRequirementResponseInput = z.infer<typeof createRequirementResponseSchema>;
export type UpdateRequirementResponseInput = z.infer<typeof updateRequirementResponseSchema>;
export type LinkConductScoreMetricInput = z.infer<typeof linkConductScoreMetricSchema>;
export type DeclareConductScoreInput = z.infer<typeof declareConductScoreSchema>;
export type DeclareAcademicGpaInput = z.infer<typeof declareAcademicGpaSchema>;
export type ConfirmNoViolationInput = z.infer<typeof confirmNoViolationSchema>;
export type ConfirmNoFGradeInput = z.infer<typeof confirmNoFGradeSchema>;
export type AddEthicsAchievementInput = z.infer<typeof addEthicsAchievementSchema>;
export type AddAcademicAchievementInput = z.infer<typeof addAcademicAchievementSchema>;
export type DeclarePhysicalCourseResultInput = z.infer<typeof declarePhysicalCourseResultSchema>;
export type AddPhysicalPathEvidenceInput = z.infer<typeof addPhysicalPathEvidenceSchema>;
export type AddVolunteerActivityInput = z.infer<typeof addVolunteerActivitySchema>;
export type AddVolunteerPathEvidenceInput = z.infer<typeof addVolunteerPathEvidenceSchema>;
export type AddIntegrationPathResponseInput = z.infer<typeof addIntegrationPathResponseSchema>;
