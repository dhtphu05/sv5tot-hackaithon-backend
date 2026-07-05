import { Criterion } from '@prisma/client';
import { z } from 'zod';

export const chatbotMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  sessionId: z.string().trim().min(1).max(120).optional(),
  applicationId: z.string().uuid().optional(),
  contextScope: z
    .enum(['student_helpdesk', 'reviewer_copilot', 'manager_assistant', 'committee_assistant'])
    .optional(),
  pageContext: z
    .object({
      page: z
        .enum([
          'dashboard',
          'evidence',
          'precheck',
          'matching_hub',
          'chatbot',
          'cascade',
          'review_task',
          'manager_dashboard',
          'resolution_hub',
        ])
        .optional(),
      criterion: z.nativeEnum(Criterion).optional(),
      evidenceId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
      resolutionCaseId: z.string().uuid().optional(),
    })
    .strict()
    .optional(),
});

export type ChatbotMessageInput = z.infer<typeof chatbotMessageSchema>;
