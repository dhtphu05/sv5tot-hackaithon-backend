-- Phase 9 collective profile support.
ALTER TYPE "CollectiveStatus" ADD VALUE IF NOT EXISTS 'prechecked';
ALTER TYPE "CollectiveStatus" ADD VALUE IF NOT EXISTS 'ready_to_submit';
ALTER TYPE "CollectiveStatus" ADD VALUE IF NOT EXISTS 'supplement_required';
ALTER TYPE "CollectiveStatus" ADD VALUE IF NOT EXISTS 'resolution_needed';

ALTER TABLE "Evidence" ADD COLUMN IF NOT EXISTS "collectiveProfileId" UUID;
ALTER TABLE "Evidence" ALTER COLUMN "applicationId" DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Evidence_collectiveProfileId_fkey') THEN
    ALTER TABLE "Evidence"
      ADD CONSTRAINT "Evidence_collectiveProfileId_fkey"
      FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Evidence_collectiveProfileId_criterion_idx" ON "Evidence"("collectiveProfileId", "criterion");

ALTER TABLE "ReviewTask" ADD COLUMN IF NOT EXISTS "collectiveProfileId" UUID;
ALTER TABLE "ReviewTask" ALTER COLUMN "applicationId" DROP NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReviewTask_collectiveProfileId_fkey') THEN
    ALTER TABLE "ReviewTask"
      ADD CONSTRAINT "ReviewTask_collectiveProfileId_fkey"
      FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ReviewTask_collectiveProfileId_criterion_idx" ON "ReviewTask"("collectiveProfileId", "criterion");

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "collectiveProfileId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_collectiveProfileId_fkey') THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_collectiveProfileId_fkey"
      FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "AuditLog_collectiveProfileId_idx" ON "AuditLog"("collectiveProfileId");

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "collectiveProfileId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_collectiveProfileId_fkey') THEN
    ALTER TABLE "Notification"
      ADD CONSTRAINT "Notification_collectiveProfileId_fkey"
      FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Notification_collectiveProfileId_idx" ON "Notification"("collectiveProfileId");

ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "finalLevel" "Level";
ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "finalStatus" "FinalStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "finalNote" TEXT;
ALTER TABLE "CollectiveProfile" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "CollectiveMember" ADD COLUMN IF NOT EXISTS "faculty" TEXT;
ALTER TABLE "CollectiveMember" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "CollectiveMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CollectiveMember" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CollectiveMember" ALTER COLUMN "individualSv5tLevel" TYPE TEXT USING "individualSv5tLevel"::TEXT;

ALTER TABLE "CollectiveEvidence" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CollectiveEvidence" ALTER COLUMN "collectiveCriterion" TYPE TEXT USING "collectiveCriterion"::TEXT;

CREATE TABLE IF NOT EXISTS "CollectivePrecheckResult" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "collectiveProfileId" UUID NOT NULL,
  "resultJson" JSONB NOT NULL,
  "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "missingItemsJson" JSONB,
  "nextBestAction" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollectivePrecheckResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CollectivePrecheckResult_collectiveProfileId_fkey"
    FOREIGN KEY ("collectiveProfileId") REFERENCES "CollectiveProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CollectivePrecheckResult_collectiveProfileId_createdAt_idx"
  ON "CollectivePrecheckResult"("collectiveProfileId", "createdAt");
