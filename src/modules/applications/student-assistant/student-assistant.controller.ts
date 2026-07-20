import type { Request, Response } from 'express';
import { sendSuccess } from '../../../shared/responses/api-response';
import { StudentAssistantService } from './student-assistant.service';

const service = new StudentAssistantService();

export async function getCurrentAssistantContext(req: Request, res: Response): Promise<void> {
  const data = await service.getCurrentContext(req.user!, String(req.query.schoolYear ?? ''));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function streamCurrentAssistantNarrative(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    await service.streamCurrentNarrative(
      req.user!,
      {
        schoolYear: String(req.query.schoolYear ?? ''),
        contextVersion: String(req.query.contextVersion ?? ''),
        signal: abortController.signal,
        requestId: req.requestId ?? 'unknown',
      },
      {
        onMeta: (data) => writeSse(res, 'meta', data),
        onStatus: (data) => writeSse(res, 'status', data),
        onDelta: (data) => writeSse(res, 'delta', data),
        onComplete: (data) => writeSse(res, 'complete', data),
        onError: (data) => writeSse(res, 'error', data),
      },
    );
  } finally {
    res.end();
  }
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  const flushable = res as unknown as { flush?: () => void };
  if (typeof flushable.flush === 'function') {
    flushable.flush();
  }
}
