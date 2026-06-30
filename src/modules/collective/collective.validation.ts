// Owns collective 5TOT profiles, members, and collective evidence validation.
import {
  CollectiveStatus,
  EvidenceStatus,
  EvidenceSourceType,
  FinalStatus,
  IndexingStatus,
  Level,
} from '@prisma/client';
import { z } from 'zod';

const schoolYearSchema = z.string().regex(/^\d{4}-\d{4}$/);

export const getCurrentCollectiveQuerySchema = z.object({
  schoolYear: schoolYearSchema.optional(),
  className: z.string().min(1).optional(),
});

export const startCollectiveProfileSchema = z.object({
  schoolYear: schoolYearSchema.optional(),
  className: z.string().min(1).optional(),
  targetLevel: z.nativeEnum(Level).default(Level.school),
});

export const updateCollectiveProfileSchema = z.object({
  targetLevel: z.nativeEnum(Level).optional(),
  className: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
});

export const listCollectiveMembersQuerySchema = z.object({
  q: z.string().min(1).optional(),
  participationStatus: z.string().optional(),
  individualSv5tLevel: z.string().optional(),
  violationStatus: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const upsertCollectiveMemberSchema = z.object({
  studentCode: z.string().min(1),
  studentName: z.string().min(1),
  className: z.string().optional(),
  faculty: z.string().optional(),
  participationStatus: z.string().default('unknown'),
  individualSv5tLevel: z.string().default('unknown'),
  violationStatus: z.string().default('unknown'),
  note: z.string().max(1000).optional(),
});

export const updateCollectiveMemberSchema = upsertCollectiveMemberSchema.partial().extend({
  participationStatus: z.string().optional(),
  individualSv5tLevel: z.string().optional(),
  violationStatus: z.string().optional(),
});

export const listCollectiveEvidencesQuerySchema = z.object({
  collectiveCriterion: z.string().optional(),
  status: z.nativeEnum(EvidenceStatus).optional(),
  indexingStatus: z.nativeEnum(IndexingStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createCollectiveEvidenceSchema = z.object({
  evidenceName: z.string().min(1),
  criterion: z.literal('collective').default('collective'),
  collectiveCriterion: z.string().min(1).default('other'),
  sourceType: z.nativeEnum(EvidenceSourceType).default(EvidenceSourceType.manual_upload),
});

export const collectivePrecheckSchema = z.object({
  level: z.nativeEnum(Level).optional(),
});

export const collectiveSubmitSchema = z.object({
  allowSubmitWithWarnings: z.boolean().default(false),
  note: z.string().max(1000).optional(),
});

export const importCollectiveEventSchema = z.object({
  eventId: z.string().uuid(),
  collectiveCriterion: z.string().default('collective_activity'),
});

export const startCollectiveIndexingSchema = z.object({
  runMode: z.enum(['async', 'sync']).default('async'),
  force: z.boolean().default(false),
});

export const listManagerCollectivesQuerySchema = z.object({
  schoolYear: schoolYearSchema.optional(),
  targetLevel: z.nativeEnum(Level).optional(),
  status: z.nativeEnum(CollectiveStatus).optional(),
  className: z.string().optional(),
  faculty: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const finalizeCollectiveSchema = z.object({
  finalStatus: z.enum([FinalStatus.passed, FinalStatus.failed, FinalStatus.partially_passed]),
  finalLevel: z.nativeEnum(Level).nullable().optional(),
  finalNote: z.string().min(1).max(2000),
  overrideAggregation: z.boolean().default(false),
  notifyRepresentative: z.boolean().default(true),
});

export type GetCurrentCollectiveQuery = z.infer<typeof getCurrentCollectiveQuerySchema>;
export type StartCollectiveProfileInput = z.infer<typeof startCollectiveProfileSchema>;
export type UpdateCollectiveProfileInput = z.infer<typeof updateCollectiveProfileSchema>;
export type ListCollectiveMembersQuery = z.infer<typeof listCollectiveMembersQuerySchema>;
export type UpsertCollectiveMemberInput = z.infer<typeof upsertCollectiveMemberSchema>;
export type UpdateCollectiveMemberInput = z.infer<typeof updateCollectiveMemberSchema>;
export type ListCollectiveEvidencesQuery = z.infer<typeof listCollectiveEvidencesQuerySchema>;
export type CreateCollectiveEvidenceInput = z.infer<typeof createCollectiveEvidenceSchema>;
export type CollectivePrecheckInput = z.infer<typeof collectivePrecheckSchema>;
export type CollectiveSubmitInput = z.infer<typeof collectiveSubmitSchema>;
export type ImportCollectiveEventInput = z.infer<typeof importCollectiveEventSchema>;
export type StartCollectiveIndexingInput = z.infer<typeof startCollectiveIndexingSchema>;
export type ListManagerCollectivesQuery = z.infer<typeof listManagerCollectivesQuerySchema>;
export type FinalizeCollectiveInput = z.infer<typeof finalizeCollectiveSchema>;
