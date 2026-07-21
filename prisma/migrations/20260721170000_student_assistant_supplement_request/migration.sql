CREATE TABLE IF NOT EXISTS "SupplementRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "reviewTaskId" UUID NOT NULL,
  "criterion" "Criterion" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "officialMessage" TEXT NOT NULL,
  "requestedFieldsJson" JSONB,
  "evidenceScopeJson" JSONB,
  "acceptedEvidenceTypesJson" JSONB,
  "deadline" TIMESTAMP(3),
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resubmittedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "historyJson" JSONB,

  CONSTRAINT "SupplementRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SupplementRequest"
  ADD CONSTRAINT "SupplementRequest_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplementRequest"
  ADD CONSTRAINT "SupplementRequest_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplementRequest"
  ADD CONSTRAINT "SupplementRequest_reviewTaskId_fkey"
  FOREIGN KEY ("reviewTaskId") REFERENCES "ReviewTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplementRequest"
  ADD CONSTRAINT "SupplementRequest_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SupplementRequest_applicationId_status_idx"
  ON "SupplementRequest"("applicationId", "status");

CREATE INDEX IF NOT EXISTS "SupplementRequest_reviewTaskId_status_idx"
  ON "SupplementRequest"("reviewTaskId", "status");

CREATE INDEX IF NOT EXISTS "SupplementRequest_workspaceId_status_idx"
  ON "SupplementRequest"("workspaceId", "status");

CREATE INDEX IF NOT EXISTS "SupplementRequest_criterion_idx"
  ON "SupplementRequest"("criterion");
