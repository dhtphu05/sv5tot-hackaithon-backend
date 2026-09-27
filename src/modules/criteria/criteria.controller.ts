import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { CriteriaService } from './criteria.service';
import type {
  ActiveCriteriaQuery,
  CriteriaEvaluationQuery,
  CriteriaGapQuery,
} from './criteria.validation';

const criteriaService = new CriteriaService();

export async function getActiveCriteriaConfigs(req: Request, res: Response): Promise<void> {
  const data = await criteriaService.listActiveConfigs(req.user!, req.query as ActiveCriteriaQuery);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function evaluateApplicationCriteria(req: Request, res: Response): Promise<void> {
  const data = await criteriaService.evaluateApplicationAgainstCriteria(
    req.user!,
    String(req.params.id),
    req.query as CriteriaEvaluationQuery,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationCriteriaGap(req: Request, res: Response): Promise<void> {
  const query = req.query as CriteriaGapQuery;
  const data = await criteriaService.compareCriteriaLevels(req.user!, String(req.params.id), {
    scopes: query.scopes ?? [],
    criterion: query.criterion,
  });
  sendSuccess(res, data, { requestId: req.requestId });
}
