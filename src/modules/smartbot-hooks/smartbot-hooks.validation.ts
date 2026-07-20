import { z } from 'zod';

export const safeIdSchema = z.string().uuid().optional();
const webhookUserContextSchema = {
  userId: safeIdSchema,
  user_id: safeIdSchema,
  sender_id: z.string().trim().max(120).optional(),
};

export const applicationToolSchema = z
  .object({
    ...webhookUserContextSchema,
    applicationId: safeIdSchema,
    application_id: safeIdSchema,
  })
  .strict();

export const evidenceToolSchema = z
  .object({
    ...webhookUserContextSchema,
    evidenceId: safeIdSchema,
    evidence_id: safeIdSchema,
  })
  .strict();

export const eventSearchToolSchema = z
  .object({
    ...webhookUserContextSchema,
    query: z.string().trim().max(200).optional(),
    criterion: z.string().trim().max(40).optional(),
  })
  .strict();

export const reviewerDraftToolSchema = z
  .object({
    ...webhookUserContextSchema,
    taskId: safeIdSchema,
    task_id: safeIdSchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const handoffToolSchema = z
  .object({
    sessionId: safeIdSchema,
    session_id: safeIdSchema,
    userId: safeIdSchema,
    user_id: safeIdSchema,
    sender_id: z.string().trim().max(120).optional(),
    applicationId: safeIdSchema,
    application_id: safeIdSchema,
    reviewTaskId: safeIdSchema,
    review_task_id: safeIdSchema,
    resolutionCaseId: safeIdSchema,
    resolution_case_id: safeIdSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type ApplicationToolInput = z.infer<typeof applicationToolSchema>;
export type EvidenceToolInput = z.infer<typeof evidenceToolSchema>;
export type EventSearchToolInput = z.infer<typeof eventSearchToolSchema>;
export type ReviewerDraftToolInput = z.infer<typeof reviewerDraftToolSchema>;
export type HandoffToolInput = z.infer<typeof handoffToolSchema>;
