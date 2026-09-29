-- Reconcile additive objects omitted from earlier migration history.
-- Existing workspaces may already have these objects, so keep this idempotent.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'supplement_requested';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'resolution_updated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'application_updated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'export_ready';

CREATE INDEX IF NOT EXISTS "Application_targetLevel_idx" ON "Application"("targetLevel");
CREATE INDEX IF NOT EXISTS "Application_studentId_idx" ON "Application"("studentId");
CREATE INDEX IF NOT EXISTS "CityReviewSeason_schoolYear_version_idx" ON "CityReviewSeason"("schoolYear", "version");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "ReviewTask_status_idx" ON "ReviewTask"("status");
CREATE INDEX IF NOT EXISTS "ReviewTask_criterion_idx" ON "ReviewTask"("criterion");
CREATE INDEX IF NOT EXISTS "ReviewTask_applicationId_idx" ON "ReviewTask"("applicationId");
