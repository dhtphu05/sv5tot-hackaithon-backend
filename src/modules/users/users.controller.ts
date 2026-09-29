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

export async function listAdminUsers(req: Request, res: Response): Promise<void> {
  const data = await usersService.listAdminUsers(req.query as never);
  sendSuccess(res, data.users, { requestId: req.requestId, pagination: data.pagination });
}

export async function getAdminUser(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await usersService.getAdminUser(String(req.params.userId)), { requestId: req.requestId });
}

export async function createAdminUser(req: Request, res: Response): Promise<void> {
  const data = await usersService.createAdminUser(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateAdminUser(req: Request, res: Response): Promise<void> {
  const data = await usersService.updateAdminUser(req.user!, String(req.params.userId), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateAdminUserStatus(req: Request, res: Response): Promise<void> {
  const data = await usersService.setAdminUserActive(req.user!, String(req.params.userId), req.body.isActive);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function resetAdminUserPassword(req: Request, res: Response): Promise<void> {
  const data = await usersService.resetAdminUserPassword(
    req.user!, String(req.params.userId), req.body.newPassword,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateCityOfficerSpecializations(req: Request, res: Response): Promise<void> {
  const data = await usersService.setOfficerSpecializations(
    req.user!, String(req.params.userId), req.body.criteria,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}
