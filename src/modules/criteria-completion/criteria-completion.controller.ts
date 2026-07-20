import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { CriteriaCompletionService } from './criteria-completion.service';

const criteriaCompletionService = new CriteriaCompletionService();

export async function getApplicationCriteriaCompletion(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.getCompletion(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function createApplicationRequirementResponse(
  req: Request,
  res: Response,
): Promise<void> {
  const data = await criteriaCompletionService.createResponse(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateRequirementResponse(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.updateResponse(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function deleteRequirementResponse(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.deleteResponse(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function linkEthicsConductScoreMetric(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.linkEthicsConductScoreMetric(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function declareEthicsConductScore(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.declareEthicsConductScore(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function confirmEthicsNoViolation(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.confirmEthicsNoViolation(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addEthicsAchievement(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addEthicsAchievement(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function declareAcademicGpa(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.declareAcademicGpa(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function confirmAcademicNoFGrade(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.confirmAcademicNoFGrade(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addAcademicAchievement(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addAcademicAchievement(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function declarePhysicalCourseResult(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.declarePhysicalCourseResult(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addPhysicalPathEvidence(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addPhysicalPathEvidence(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addVolunteerActivity(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addVolunteerActivity(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addVolunteerPathEvidence(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addVolunteerPathEvidence(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function addIntegrationPathResponse(req: Request, res: Response): Promise<void> {
  const data = await criteriaCompletionService.addIntegrationPathResponse(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}
