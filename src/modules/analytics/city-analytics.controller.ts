import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { CityAnalyticsService } from './city-analytics.service';

const service = new CityAnalyticsService();

export async function getCityAnalytics(req: Request, res: Response): Promise<void> {
  const data = await service.getSummary(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function listCityAnalyticsApplications(req: Request, res: Response): Promise<void> {
  const data = await service.listApplications(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}
