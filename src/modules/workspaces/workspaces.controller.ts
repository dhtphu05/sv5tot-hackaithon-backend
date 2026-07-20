import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { WorkspacesService } from './workspaces.service';
import type {
  CreateAdminWorkspaceBody,
  ListAdminWorkspacesQuery,
  ListAdminWorkspaceUsersQuery,
  ListWorkspacesQuery,
  UpdateAdminWorkspaceBody,
  UpdateAdminWorkspaceStatusBody,
} from './workspaces.validation';

const workspacesService = new WorkspacesService();

export async function listWorkspaces(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.list(req.query as unknown as ListWorkspacesQuery);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listAdminWorkspaces(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.listAdmin(req.query as unknown as ListAdminWorkspacesQuery);
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function getAdminWorkspace(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.getAdmin(String(req.params.workspaceId));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function createAdminWorkspace(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.createAdmin(
    req.user!,
    req.body as CreateAdminWorkspaceBody,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateAdminWorkspace(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.updateAdmin(
    req.user!,
    String(req.params.workspaceId),
    req.body as UpdateAdminWorkspaceBody,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateAdminWorkspaceStatus(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.updateStatusAdmin(
    req.user!,
    String(req.params.workspaceId),
    req.body as UpdateAdminWorkspaceStatusBody,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listAdminWorkspaceUsers(req: Request, res: Response): Promise<void> {
  const data = await workspacesService.listAdminWorkspaceUsers(
    String(req.params.workspaceId),
    req.query as unknown as ListAdminWorkspaceUsersQuery,
  );
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}
