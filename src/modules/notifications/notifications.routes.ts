import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './notifications.controller';
import { listNotificationsQuerySchema } from './notifications.validation';

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requireAuth,
  validate({ query: listNotificationsQuerySchema }),
  asyncHandler(listNotifications),
);
notificationsRouter.patch('/read-all', requireAuth, asyncHandler(markAllNotificationsRead));
notificationsRouter.patch('/:id/read', requireAuth, asyncHandler(markNotificationRead));
