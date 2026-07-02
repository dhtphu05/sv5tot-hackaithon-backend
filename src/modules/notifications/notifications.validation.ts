import { z } from 'zod';
import { NotificationType } from '@prisma/client';

export const listNotificationsQuerySchema = z.object({
  isRead: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  type: z.nativeEnum(NotificationType).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
