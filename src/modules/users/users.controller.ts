import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { UsersService } from './users.service';

const usersService = new UsersService();

export async function getMe(req: Request, res: Response): Promise<void> {
  const data = await usersService.getMe(req.user?.id ?? '');
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const data = await usersService.updateMe(req.user?.id ?? '', req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  const data = await usersService.uploadAvatar(req.user?.id ?? '', req.file);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const data = await usersService.listUsers(req.user!, req.query as never);
  sendSuccess(res, data.users, {
    requestId: req.requestId,
    pagination: data.pagination,
  });
}
