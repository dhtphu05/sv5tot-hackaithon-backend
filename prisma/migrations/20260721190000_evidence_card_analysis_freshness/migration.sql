ALTER TABLE "EvidenceCard"
  ADD COLUMN IF NOT EXISTS "source_evidence_file_id" UUID,
  ADD COLUMN IF NOT EXISTS "source_file_id" UUID,
  ADD COLUMN IF NOT EXISTS "analysis_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "analysed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "EvidenceCard_source_evidence_file_id_idx"
  ON "EvidenceCard" ("source_evidence_file_id");

CREATE INDEX IF NOT EXISTS "EvidenceCard_source_file_id_idx"
  ON "EvidenceCard" ("source_file_id");
