import { Criterion, EventStatus, Level } from '@prisma/client';
import { z } from 'zod';

export const listEventsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  organizerLevel: z.nativeEnum(Level).optional(),
  level: z.nativeEnum(Level).optional(),
  status: z.nativeEnum(EventStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createEventSchema = z.object({
  eventName: z.string().trim().min(3).max(255),
  criterion: z.nativeEnum(Criterion),
  organizer: z.string().trim().min(3).max(255),
  organizerLevel: z.nativeEnum(Level),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  convertedValue: z.number().nonnegative().nullable().optional(),
  convertedUnit: z.string().trim().min(1).max(50).optional(),
  eligibleLevels: z.array(z.nativeEnum(Level)).optional(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  status: z.nativeEnum(EventStatus).optional(),
});

export const startRosterIndexingSchema = z.object({
  eventFileId: z.string().uuid().optional(),
  runMode: z.enum(['sync', 'async']).default('async'),
});

export const participantsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  studentCode: z.string().min(1).optional(),
  className: z.string().min(1).optional(),
  faculty: z.string().min(1).optional(),
  preview: z.coerce.boolean().default(false),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const confirmIndexSchema = z.object({
  eventFileId: z.string().uuid().optional(),
  columnMapping: z.object({
    studentCode: z.string().min(1),
    studentName: z.string().min(1).optional(),
    className: z.string().min(1).optional(),
    faculty: z.string().min(1).optional(),
    participationStatus: z.string().min(1).optional(),
    convertedValue: z.string().min(1).optional(),
  }),
  replaceExisting: z.boolean().default(true),
});

export const applicationIdBodySchema = z.object({
  applicationId: z.string().uuid(),
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type StartRosterIndexingInput = z.infer<typeof startRosterIndexingSchema>;
export type ParticipantsQuery = z.infer<typeof participantsQuerySchema>;
export type ConfirmIndexInput = z.infer<typeof confirmIndexSchema>;
export type ApplicationIdBody = z.infer<typeof applicationIdBodySchema>;
