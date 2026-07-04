import { Criterion, Level } from '@prisma/client';
import { z } from 'zod';

const optionalTrimmedString = (schema: z.ZodString) =>
  z.preprocess((value) => {
    if (typeof value === 'string' && !value.trim()) return undefined;
    return value;
  }, schema.optional());

const optionalFriendlyDate = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  return trimmed;
}, z.string().datetime().optional());

const optionalNonNegativeNumber = z.preprocess((value) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  return value;
}, z.coerce.number().nonnegative().optional());

export const listDecisionImportsQuerySchema = z.object({
  status: z.string().trim().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createDecisionImportSchema = z.object({
  title: z.string().trim().min(3).max(255),
  criterion: z.nativeEnum(Criterion).optional(),
  eventName: optionalTrimmedString(z.string().trim().min(3).max(255)),
  organizer: optionalTrimmedString(z.string().trim().min(1).max(255)),
  organizerLevel: z.nativeEnum(Level).optional(),
  startDate: optionalFriendlyDate,
  endDate: optionalFriendlyDate,
  convertedValue: optionalNonNegativeNumber,
  convertedUnit: optionalTrimmedString(z.string().trim().max(64)),
  eligibleLevels: z.array(z.nativeEnum(Level)).optional(),
});

export const startDecisionImportSchema = z.object({
  runMode: z.enum(['sync', 'async']).default('async'),
});

export const updateColumnMappingSchema = z.object({
  columnMapping: z.object({
    studentCode: z.string().trim().min(1),
    studentName: z.string().trim().min(1).optional(),
    className: z.string().trim().min(1).optional(),
    faculty: z.string().trim().min(1).optional(),
    criterion: z.string().trim().min(1).optional(),
    convertedValue: z.string().trim().min(1).optional(),
    convertedUnit: z.string().trim().min(1).optional(),
    participationStatus: z.string().trim().min(1).optional(),
  }),
});

export const confirmDecisionImportSchema = z.object({
  eventName: optionalTrimmedString(z.string().trim().min(3).max(255)),
  criterion: z.nativeEnum(Criterion).optional(),
  organizer: optionalTrimmedString(z.string().trim().min(1).max(255)),
  organizerLevel: z.nativeEnum(Level).optional(),
  startDate: optionalFriendlyDate,
  endDate: optionalFriendlyDate,
  convertedValue: optionalNonNegativeNumber,
  convertedUnit: optionalTrimmedString(z.string().trim().max(64)),
  eligibleLevels: z.array(z.nativeEnum(Level)).optional(),
  includeWarningRows: z.boolean().default(false),
  includeInvalidRows: z.boolean().default(false),
  replaceExistingParticipants: z.boolean().default(true),
  note: z.string().trim().max(2000).optional(),
});

export type ListDecisionImportsQuery = z.infer<typeof listDecisionImportsQuerySchema>;
export type CreateDecisionImportInput = z.infer<typeof createDecisionImportSchema>;
export type StartDecisionImportInput = z.infer<typeof startDecisionImportSchema>;
export type UpdateColumnMappingInput = z.infer<typeof updateColumnMappingSchema>;
export type ConfirmDecisionImportInput = z.infer<typeof confirmDecisionImportSchema>;
