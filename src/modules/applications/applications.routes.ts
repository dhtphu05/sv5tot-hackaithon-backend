import { Role } from '@prisma/client';
import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/require-role.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { asyncHandler } from '../../shared/utils/async-handler';
import {
  autosaveApplicationDraft,
  getApplicationTimeline,
  getCurrentApplication,
  reopenApplicationSupplement,
  startCurrentApplication,
  submitApplication,
  updateApplicationTargetLevel,
} from './applications.controller';
import {
  getCurrentAssistantContext,
  streamCurrentAssistantNarrative,
} from './student-assistant/student-assistant.controller';
import {
  addAcademicAchievement,
  addEthicsAchievement,
  addIntegrationPathResponse,
  addPhysicalPathEvidence,
  addVolunteerActivity,
  addVolunteerPathEvidence,
  confirmAcademicNoFGrade,
  confirmEthicsNoViolation,
  createApplicationRequirementResponse,
  declareAcademicGpa,
  declareEthicsConductScore,
  declarePhysicalCourseResult,
  getApplicationCriteriaCompletion,
  linkEthicsConductScoreMetric,
} from '../criteria-completion/criteria-completion.controller';
import {
  autosaveDraftSchema,
  assistantContextStreamQuerySchema,
  getCurrentApplicationQuerySchema,
  reopenSupplementSchema,
  startApplicationSchema,
  submitApplicationSchema,
  timelineQuerySchema,
  updateTargetLevelSchema,
} from './applications.validation';
import {
  addAcademicAchievementSchema,
  addEthicsAchievementSchema,
  addIntegrationPathResponseSchema,
  addPhysicalPathEvidenceSchema,
  addVolunteerActivitySchema,
  addVolunteerPathEvidenceSchema,
  confirmNoFGradeSchema,
  confirmNoViolationSchema,
  createRequirementResponseSchema,
  declareAcademicGpaSchema,
  declareConductScoreSchema,
  declarePhysicalCourseResultSchema,
  linkConductScoreMetricSchema,
} from '../criteria-completion/criteria-completion.validation';

export const applicationsRouter = Router();

applicationsRouter.get(
  '/current',
  requireAuth,
  requireRole(Role.student),
  validate({ query: getCurrentApplicationQuerySchema }),
  asyncHandler(getCurrentApplication),
);
applicationsRouter.get(
  '/current/assistant-context',
  requireAuth,
  requireRole(Role.student),
  validate({ query: getCurrentApplicationQuerySchema }),
  asyncHandler(getCurrentAssistantContext),
);
applicationsRouter.get(
  '/current/assistant-context/stream',
  requireAuth,
  requireRole(Role.student),
  validate({ query: assistantContextStreamQuerySchema }),
  asyncHandler(streamCurrentAssistantNarrative),
);
applicationsRouter.post(
  '/current/start',
  requireAuth,
  requireRole(Role.student),
  validate({ body: startApplicationSchema }),
  asyncHandler(startCurrentApplication),
);
applicationsRouter.patch(
  '/:id/target-level',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: updateTargetLevelSchema }),
  asyncHandler(updateApplicationTargetLevel),
);
applicationsRouter.patch(
  '/:id/draft',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: autosaveDraftSchema }),
  asyncHandler(autosaveApplicationDraft),
);
applicationsRouter.get(
  '/:id/timeline',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ query: timelineQuerySchema }),
  asyncHandler(getApplicationTimeline),
);
applicationsRouter.get(
  '/:id/criteria-completion',
  requireAuth,
  requireRole(Role.student, Role.officer, Role.manager, Role.committee, Role.admin),
  asyncHandler(getApplicationCriteriaCompletion),
);
applicationsRouter.post(
  '/:id/requirement-responses',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: createRequirementResponseSchema }),
  asyncHandler(createApplicationRequirementResponse),
);
applicationsRouter.post(
  '/:id/ethics/conduct-score/link-metric',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: linkConductScoreMetricSchema }),
  asyncHandler(linkEthicsConductScoreMetric),
);
applicationsRouter.post(
  '/:id/ethics/conduct-score/declare',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: declareConductScoreSchema }),
  asyncHandler(declareEthicsConductScore),
);
applicationsRouter.post(
  '/:id/ethics/no-violation/confirmation',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: confirmNoViolationSchema }),
  asyncHandler(confirmEthicsNoViolation),
);
applicationsRouter.post(
  '/:id/ethics/additional-achievements',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addEthicsAchievementSchema }),
  asyncHandler(addEthicsAchievement),
);
applicationsRouter.post(
  '/:id/academic/gpa/declare',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: declareAcademicGpaSchema }),
  asyncHandler(declareAcademicGpa),
);
applicationsRouter.post(
  '/:id/academic/no-f-grade/confirmation',
  requireAuth,
  requireRole(Role.officer, Role.manager, Role.admin),
  validate({ body: confirmNoFGradeSchema }),
  asyncHandler(confirmAcademicNoFGrade),
);
applicationsRouter.post(
  '/:id/academic/additional-achievements',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addAcademicAchievementSchema }),
  asyncHandler(addAcademicAchievement),
);
applicationsRouter.post(
  '/:id/physical/course-result/declare',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: declarePhysicalCourseResultSchema }),
  asyncHandler(declarePhysicalCourseResult),
);
applicationsRouter.post(
  '/:id/physical/path-evidence',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addPhysicalPathEvidenceSchema }),
  asyncHandler(addPhysicalPathEvidence),
);
applicationsRouter.post(
  '/:id/volunteer/activities',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addVolunteerActivitySchema }),
  asyncHandler(addVolunteerActivity),
);
applicationsRouter.post(
  '/:id/volunteer/path-evidence',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addVolunteerPathEvidenceSchema }),
  asyncHandler(addVolunteerPathEvidence),
);
applicationsRouter.post(
  '/:id/integration/path-responses',
  requireAuth,
  requireRole(Role.student, Role.manager, Role.admin),
  validate({ body: addIntegrationPathResponseSchema }),
  asyncHandler(addIntegrationPathResponse),
);
applicationsRouter.post(
  '/:id/submit',
  requireAuth,
  requireRole(Role.student, Role.admin),
  validate({ body: submitApplicationSchema }),
  asyncHandler(submitApplication),
);
applicationsRouter.post(
  '/:id/reopen-supplement',
  requireAuth,
  requireRole(Role.manager, Role.admin),
  validate({ body: reopenSupplementSchema }),
  asyncHandler(reopenApplicationSupplement),
);
