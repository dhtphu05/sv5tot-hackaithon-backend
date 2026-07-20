CREATE TYPE "RequirementResponseKind" AS ENUM (
  'metric',
  'evidence',
  'official_event',
  'system_confirmation'
);

CREATE TYPE "RequirementResponseStatus" AS ENUM (
  'declared',
  'processing',
  'needs_verification',
  'verified',
  'rejected',
  'superseded'
);

CREATE TABLE "ApplicationRequirementResponse" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "criterion" "Criterion" NOT NULL,
  "requirementKey" TEXT NOT NULL,
  "responseKind" "RequirementResponseKind" NOT NULL,
  "metricId" UUID,
  "evidenceId" UUID,
  "payloadJson" JSONB,
  "status" "RequirementResponseStatus" NOT NULL DEFAULT 'declared',
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApplicationRequirementResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApplicationRequirementResponse_workspaceId_applicationId_idx"
  ON "ApplicationRequirementResponse"("workspaceId", "applicationId");
CREATE INDEX "ApplicationRequirementResponse_applicationId_criterion_idx"
  ON "ApplicationRequirementResponse"("applicationId", "criterion");
CREATE INDEX "ApplicationRequirementResponse_applicationId_requirementKey_idx"
  ON "ApplicationRequirementResponse"("applicationId", "requirementKey");
CREATE INDEX "ApplicationRequirementResponse_metricId_idx"
  ON "ApplicationRequirementResponse"("metricId");
CREATE INDEX "ApplicationRequirementResponse_evidenceId_idx"
  ON "ApplicationRequirementResponse"("evidenceId");
CREATE INDEX "ApplicationRequirementResponse_createdBy_idx"
  ON "ApplicationRequirementResponse"("createdBy");

ALTER TABLE "ApplicationRequirementResponse"
  ADD CONSTRAINT "ApplicationRequirementResponse_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ApplicationRequirementResponse"
  ADD CONSTRAINT "ApplicationRequirementResponse_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApplicationRequirementResponse"
  ADD CONSTRAINT "ApplicationRequirementResponse_metricId_fkey"
  FOREIGN KEY ("metricId") REFERENCES "ApplicationMetric"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationRequirementResponse"
  ADD CONSTRAINT "ApplicationRequirementResponse_evidenceId_fkey"
  FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApplicationRequirementResponse"
  ADD CONSTRAINT "ApplicationRequirementResponse_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
