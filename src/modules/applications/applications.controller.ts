// Owns individual application draft, submission, timeline, supplement lifecycle.
import type { Request, Response } from 'express';
import { sendSuccess } from '../../shared/responses/api-response';
import { ApplicationSubmissionModeService } from './application-submission-mode.service';
import { ApplicationsService } from './applications.service';
import { CitySubmissionEligibilityService } from './city-submission-eligibility.service';
import { CityReviewSeasonsService } from '../manager/city-review-seasons.service';

const applicationsService = new ApplicationsService();
const applicationSubmissionModeService = new ApplicationSubmissionModeService();
const citySubmissionEligibilityService = new CitySubmissionEligibilityService();
const cityReviewSeasonsService = new CityReviewSeasonsService();

export async function getApplicationSubmissionDeadline(req: Request, res: Response): Promise<void> {
  const data = await cityReviewSeasonsService.getStudentDeadline(req.user!, String(req.params.id));
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationEligibility(req: Request, res: Response): Promise<void> {
  const data = await citySubmissionEligibilityService.getEligibility(
    req.user!,
    String(req.params.id),
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function verifyApplicationEligibility(req: Request, res: Response): Promise<void> {
  const data = await citySubmissionEligibilityService.verifyEligibility(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getCurrentApplication(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.getCurrent(req.user!, req.query as never);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function startCurrentApplication(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.startCurrent(req.user!, req.body);
  sendSuccess(res, data, { requestId: req.requestId }, 201);
}

export async function updateApplicationTargetLevel(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.updateTargetLevel(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function autosaveApplicationDraft(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.autosaveDraft(req.user!, String(req.params.id), req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function getApplicationTimeline(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.getTimeline(
    req.user!,
    String(req.params.id),
    req.query as never,
  );
  sendSuccess(res, data.items, { requestId: req.requestId, pagination: data.pagination });
}

export async function submitApplication(req: Request, res: Response): Promise<void> {
  const applicationId = String(req.params.id);
  await applicationSubmissionModeService.assertGenericSubmitAllowed(req.user!, applicationId);
  const data = await applicationsService.submit(req.user!, applicationId, req.body);
  sendSuccess(res, data, { requestId: req.requestId });
}

export async function reopenApplicationSupplement(req: Request, res: Response): Promise<void> {
  const data = await applicationsService.reopenSupplement(
    req.user!,
    String(req.params.id),
    req.body,
  );
  sendSuccess(res, data, { requestId: req.requestId });
}
