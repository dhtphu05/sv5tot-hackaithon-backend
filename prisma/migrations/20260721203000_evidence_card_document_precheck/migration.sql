ALTER TABLE "EvidenceCard"
  ADD COLUMN IF NOT EXISTS "document_type" TEXT,
  ADD COLUMN IF NOT EXISTS "suggested_criteria_json" JSONB,
  ADD COLUMN IF NOT EXISTS "evidence_precheck_json" JSONB,
  ADD COLUMN IF NOT EXISTS "evidence_prechecked_at" TIMESTAMP(3);
