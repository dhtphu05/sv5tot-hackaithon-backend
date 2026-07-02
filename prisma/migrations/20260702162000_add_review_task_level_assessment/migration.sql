ALTER TABLE "ReviewTask"
ADD COLUMN "officerSuggestedLevel" "Level",
ADD COLUMN "levelAssessmentJson" JSONB,
ADD COLUMN "decisionReason" TEXT,
ADD COLUMN "supplementRequestJson" JSONB;

CREATE INDEX "ReviewTask_officerSuggestedLevel_idx"
ON "ReviewTask"("officerSuggestedLevel");
