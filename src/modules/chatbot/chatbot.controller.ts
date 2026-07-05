import type { Request, Response } from 'express';
import { smartbotFallbackText } from '../../infrastructure/vnpt/vnpt-smartbot.diagnostics';
import { sendSuccess } from '../../shared/responses/api-response';
import { ChatbotService } from './chatbot.service';

const service = new ChatbotService();

export async function sendChatbotMessage(req: Request, res: Response): Promise<void> {
  const data = await service.sendMessage(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function streamChatbotMessage(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    await service.streamMessage(req.user!, req.body, {
      onMeta: (data) => writeSse(res, 'meta', data),
      onDelta: (data) => writeSse(res, 'delta', data),
      onCard: (data) => writeSse(res, 'card', data),
      onFinal: (data) => writeSse(res, 'final', data),
    });
  } catch {
    writeSse(res, 'error', {
      message: smartbotFallbackText,
    });
  } finally {
    res.end();
  }
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
