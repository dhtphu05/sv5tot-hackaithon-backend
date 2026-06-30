import { Level } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCodes } from '../../shared/errors/error-codes';
import { assertValidSchoolYear } from '../../shared/utils/school-year';

const schoolYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/)
  .superRefine((value, ctx) => {
    try {
      assertValidSchoolYear(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid school year range' });
    }
  });

const draftPayloadSchema = z
  .object({
    targetLevel: z.nativeEnum(Level).optional(),
    basicInfo: z
      .object({
        fullName: z.string().min(1).optional(),
        studentCode: z.string().min(1).nullable().optional(),
        className: z.string().min(1).nullable().optional(),
        faculty: z.string().min(1).nullable().optional(),
        phone: z.string().min(3).nullable().optional(),
      })
      .passthrough()
      .optional(),
    notes: z.string().max(2000).optional(),
    draftData: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .superRefine((value) => {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > 128 * 1024) {
      throw new AppError(400, ErrorCodes.DRAFT_TOO_LARGE, 'Draft payload is too large');
    }
  });

export const getCurrentApplicationQuerySchema = z.object({
  schoolYear: schoolYearSchema.optional(),
});

export const startApplicationSchema = z.object({
  schoolYear: schoolYearSchema.optional(),
  targetLevel: z.nativeEnum(Level).default(Level.school),
});

export const updateTargetLevelSchema = z.object({
  targetLevel: z.nativeEnum(Level),
});

export const autosaveDraftSchema = draftPayloadSchema;

export const timelineQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const reopenSupplementSchema = z.object({
  reason: z.string().min(1).max(1000),
  allowedCriteria: z.array(z.string()).optional(),
  deadline: z.string().datetime().optional(),
});

export const submitApplicationSchema = z.object({
  allowSubmitWithWarnings: z.boolean().default(false),
  studentNote: z.string().max(1000).optional(),
});

export type GetCurrentApplicationQuery = z.infer<typeof getCurrentApplicationQuerySchema>;
export type StartApplicationInput = z.infer<typeof startApplicationSchema>;
export type UpdateTargetLevelInput = z.infer<typeof updateTargetLevelSchema>;
export type AutosaveDraftInput = z.infer<typeof autosaveDraftSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type ReopenSupplementInput = z.infer<typeof reopenSupplementSchema>;
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;
