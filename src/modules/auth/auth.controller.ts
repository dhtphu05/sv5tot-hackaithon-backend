import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { AuthService } from './auth.service';

const authService = new AuthService();

export async function login(req: Request, res: Response): Promise<void> {
  const data = await authService.login(req.body, {
    userAgent: req.header('user-agent'),
    ipAddress: req.ip,
  });

  sendSuccess(res, data, { requestId: req.requestId });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const data = await authService.refresh(req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.user?.id ?? '', req.body ?? {});
  sendSuccess(res, { loggedOut: true }, { requestId: req.requestId });
}
