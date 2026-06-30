// Owns application metric capture and verification state.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { MetricsService } from './metrics.service';

const metricsService = new MetricsService();

export async function upsertApplicationMetric(req: Request, res: Response): Promise<void> {
  const data = await metricsService.upsertMetric(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function updateApplicationMetric(req: Request, res: Response): Promise<void> {
  const data = await metricsService.updateMetric(req.user!, String(req.params.metricId), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}
