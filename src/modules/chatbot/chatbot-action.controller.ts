import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ChatbotActionService } from './chatbot-action.service';

const service = new ChatbotActionService();

export async function confirmChatbotAction(req: Request, res: Response): Promise<void> {
  const data = await service.confirm(req.user!, String(req.params.actionId));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function executeChatbotAction(req: Request, res: Response): Promise<void> {
  const data = await service.execute(req.user!, String(req.params.actionId));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function cancelChatbotAction(req: Request, res: Response): Promise<void> {
  const data = await service.cancel(req.user!, String(req.params.actionId));
  sendSuccess(res, data, { requestId: req.requestId });
}
