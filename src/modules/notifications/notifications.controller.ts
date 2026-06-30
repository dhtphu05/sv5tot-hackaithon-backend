// Owns user notifications and read state.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { NotificationsService } from './notifications.service';

const notificationsService = new NotificationsService();

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const data = await notificationsService.listForUser(req.user?.id ?? '', req.query as never);

  sendSuccess(res, data.notifications, {
    requestId: req.requestId,
    pagination: data.pagination,
  });
}

export async function markNotificationRead(req: Request, res: Response): Promise<void> {
  const data = await notificationsService.markRead(req.user?.id ?? '', String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}
