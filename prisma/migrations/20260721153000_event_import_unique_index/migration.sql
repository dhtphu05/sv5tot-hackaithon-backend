CREATE UNIQUE INDEX IF NOT EXISTS "evidence_event_import_unique"
ON "Evidence" ("applicationId", "eventId")
WHERE "sourceType" = 'event_import'
  AND "applicationId" IS NOT NULL
  AND "eventId" IS NOT NULL;
