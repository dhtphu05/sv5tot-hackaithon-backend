-- Additive support for provider-neutral manual evidence analysis.
ALTER TABLE "IndexingJob"
ADD COLUMN "input_json" JSONB;

ALTER TABLE "EvidenceCard"
ADD COLUMN "provider" TEXT,
ADD COLUMN "provider_model" TEXT,
ADD COLUMN "prompt_version" TEXT,
ADD COLUMN "field_confidence_json" JSONB,
ADD COLUMN "requires_human_confirmation" BOOLEAN NOT NULL DEFAULT false;
