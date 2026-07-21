ALTER TABLE "EvidenceCard"
  ADD COLUMN "confirmation_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "confirmed_fields_json" JSONB,
  ADD COLUMN "confirmed_by_user_id" UUID,
  ADD COLUMN "confirmed_at" TIMESTAMP(3),
  ADD COLUMN "last_corrected_at" TIMESTAMP(3);

UPDATE "EvidenceCard" AS card
SET
  "confirmation_status" = 'not_required',
  "requires_human_confirmation" = false,
  "confirmed_fields_json" = COALESCE(card."normalized_fields_json", card."extractedFieldsJson")
FROM "Evidence" AS evidence
WHERE card."evidenceId" = evidence.id
  AND evidence."sourceType" = 'event_import';

CREATE INDEX "EvidenceCard_confirmation_status_idx" ON "EvidenceCard"("confirmation_status");
