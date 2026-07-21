import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { StudentCommunicationAssistantService } from './student-assistant.service';

const service = new StudentCommunicationAssistantService();

export async function getStudentAssistantContext(req: Request, res: Response): Promise<void> {
  const data = await service.getContext(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function streamStudentAssistantAnswer(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const body = req.body as Record<string, unknown>;
    await service.streamAnswer(
      req.user!,
      {
        ...body,
        signal: abortController.signal,
        requestId: req.requestId ?? 'unknown',
      } as never,
      {
        onMeta: (data) => writeSse(res, 'meta', data),
        onStatus: (data) => writeSse(res, 'status', data),
        onDelta: (data) => writeSse(res, 'delta', data),
        onSources: (data) => writeSse(res, 'sources', data),
        onAction: (data) => writeSse(res, 'action', data),
        onComplete: (data) => writeSse(res, 'complete', data),
        onError: (data) => writeSse(res, 'error', data),
      },
    );
  } finally {
    res.end();
  }
}

export async function resubmitSupplement(req: Request, res: Response): Promise<void> {
  const data = await service.resubmitSupplement(req.user!, String(req.params.reviewTaskId));
  sendSuccess(res, data, { requestId: req.requestId });
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  const flushable = res as unknown as { flush?: () => void };
  if (typeof flushable.flush === 'function') flushable.flush();
}
