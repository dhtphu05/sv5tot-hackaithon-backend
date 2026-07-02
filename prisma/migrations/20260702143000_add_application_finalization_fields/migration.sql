ALTER TABLE "Application"
ADD COLUMN "finalNote" TEXT,
ADD COLUMN "finalizedAt" TIMESTAMP(3),
ADD COLUMN "finalizedById" UUID;

ALTER TABLE "Application"
ADD CONSTRAINT "Application_finalizedById_fkey"
FOREIGN KEY ("finalizedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Application_finalStatus_finalLevel_idx"
ON "Application"("finalStatus", "finalLevel");

CREATE INDEX "Application_finalizedById_idx"
ON "Application"("finalizedById");
