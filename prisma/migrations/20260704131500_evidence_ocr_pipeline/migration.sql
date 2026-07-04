ALTER TABLE "EvidenceCard"
ADD COLUMN "ocr_lines_json" JSONB,
ADD COLUMN "ocr_paragraphs_json" JSONB,
ADD COLUMN "ocr_tables_json" JSONB,
ADD COLUMN "normalized_fields_json" JSONB,
ADD COLUMN "matched_participant_id" UUID,
ADD COLUMN "source_endpoint" TEXT,
ADD COLUMN "smartreader_job_id" UUID,
ADD COLUMN "raw_response_json" JSONB;

CREATE INDEX "EvidenceCard_matched_participant_id_idx"
ON "EvidenceCard"("matched_participant_id");

CREATE INDEX "EvidenceCard_smartreader_job_id_idx"
ON "EvidenceCard"("smartreader_job_id");
