ALTER TABLE "ApplicationMetric"
  ADD COLUMN "schoolYear" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "supportingEvidenceId" UUID;

CREATE INDEX "ApplicationMetric_supportingEvidenceId_idx"
  ON "ApplicationMetric"("supportingEvidenceId");
