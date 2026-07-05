ALTER TABLE "ResolutionCase"
ADD COLUMN "reviewTaskId" UUID;

ALTER TABLE "ResolutionCase"
ADD CONSTRAINT "ResolutionCase_reviewTaskId_fkey"
FOREIGN KEY ("reviewTaskId") REFERENCES "ReviewTask"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ResolutionCase_reviewTaskId_idx" ON "ResolutionCase"("reviewTaskId");
