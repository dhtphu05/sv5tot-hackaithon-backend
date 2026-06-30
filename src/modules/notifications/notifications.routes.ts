import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import { listNotifications, markNotificationRead } from './notifications.controller';
import { listNotificationsQuerySchema } from './notifications.validation';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth,
  validate({ query: listNotificationsQuerySchema }),
  asyncHandler(listNotifications),
);
notificationsRouter.patch('/:id/read', requireAuth, asyncHandler(markNotificationRead));
