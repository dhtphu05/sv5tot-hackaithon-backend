import { Criterion, Level } from '@prisma/client';
import { z } from 'zod';

export const listEventsQuerySchema = z.object({
  q: z.string().trim().optional(),
  criterion: z.nativeEnum(Criterion).optional(),
  organizerLevel: z.nativeEnum(Level).optional(),
  status: z.enum(['draft', 'confirmed', 'archived']).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createEventSchema = z.object({
  eventName: z.string().trim().min(3).max(255),
  organizer: z.string().trim().min(1),
  organizerLevel: z.nativeEnum(Level),
  criterion: z.nativeEnum(Criterion),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  location: z.string().trim().optional(),
  description: z.string().trim().optional(),
  status: z.enum(['draft', 'confirmed', 'archived']).default('draft'),
});

export const updateEventSchema = createEventSchema.partial();

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

export const importParticipantsJsonSchema = z.object({
  participants: z.array(
    z.object({
      studentCode: z.string().trim().min(1),
      fullName: z.string().trim().min(1),
      className: z.string().trim().optional(),
      faculty: z.string().trim().optional(),
      email: z.string().trim().email().optional(),
      role: z.string().trim().optional(),
      attendanceStatus: z.string().trim().optional(),
      convertedValue: z.number().nonnegative().optional(),
    }),
  ),
  mode: z.enum(['upsert', 'replace']).default('upsert'),
});

export const checkParticipantSchema = z.object({
  studentCode: z.string().trim().optional(),
  applicationId: z.string().uuid().optional(),
});

export const importToApplicationSchema = z.object({
  applicationId: z.string().uuid(),
  evidenceName: z.string().trim().min(3).max(255).optional(),
  note: z.string().trim().optional(),
});

export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type StartRosterIndexingInput = z.infer<typeof startRosterIndexingSchema>;
export type ParticipantsQuery = z.infer<typeof participantsQuerySchema>;
export type ConfirmIndexInput = z.infer<typeof confirmIndexSchema>;
export type ApplicationIdBody = z.infer<typeof applicationIdBodySchema>;
export type ImportParticipantsJsonInput = z.infer<typeof importParticipantsJsonSchema>;
export type CheckParticipantInput = z.infer<typeof checkParticipantSchema>;
export type ImportToApplicationInput = z.infer<typeof importToApplicationSchema>;
