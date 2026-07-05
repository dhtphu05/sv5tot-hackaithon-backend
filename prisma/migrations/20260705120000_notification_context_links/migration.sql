ALTER TABLE "Notification"
ADD COLUMN "evidenceId" UUID,
ADD COLUMN "reviewTaskId" UUID,
ADD COLUMN "resolutionCaseId" UUID,
ADD COLUMN "metadata" JSONB;

CREATE INDEX "Notification_evidenceId_idx" ON "Notification"("evidenceId");
CREATE INDEX "Notification_reviewTaskId_idx" ON "Notification"("reviewTaskId");
CREATE INDEX "Notification_resolutionCaseId_idx" ON "Notification"("resolutionCaseId");
