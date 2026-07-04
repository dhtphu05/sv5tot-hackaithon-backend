CREATE TYPE "SmartReaderJobType" AS ENUM (
  'evidence_ocr',
  'decision_metadata',
  'decision_roster_ocr',
  'criteria_doc_ocr',
  'smoke_test'
);

CREATE TYPE "SmartReaderJobStatus" AS ENUM (
  'queued',
  'uploading',
  'processing',
  'polling',
  'completed',
  'failed',
  'cancelled'
);

ALTER TABLE "File"
ADD COLUMN "vnptHash" TEXT,
ADD COLUMN "vnptFileType" TEXT,
ADD COLUMN "vnptUploadedAt" TIMESTAMP(3),
ADD COLUMN "vnptUploadRawJson" JSONB;

ALTER TABLE "AuditLog"
ADD COLUMN "evidenceId" UUID,
ADD COLUMN "eventId" UUID,
ADD COLUMN "decisionImportId" UUID,
ADD COLUMN "before_json" JSONB,
ADD COLUMN "after_json" JSONB,
ADD COLUMN "metadataJson" JSONB,
ADD COLUMN "requestId" TEXT,
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT;

CREATE TABLE "smartreader_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job_type" "SmartReaderJobType" NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'vnpt_smartreader',
  "file_id" UUID,
  "evidence_id" UUID,
  "event_id" UUID,
  "decision_import_id" UUID,
  "vnpt_hash" TEXT,
  "vnpt_file_type" TEXT,
  "endpoint" TEXT,
  "session_id" TEXT,
  "status" "SmartReaderJobStatus" NOT NULL DEFAULT 'queued',
  "progress_processed_pages" INTEGER,
  "progress_remaining_pages" INTEGER,
  "result_link" TEXT,
  "request_payload_json" JSONB,
  "raw_response_json" JSONB,
  "redacted_error_json" JSONB,
  "vnpt_message" TEXT,
  "vnpt_status" TEXT,
  "vnpt_status_code" INTEGER,
  "vnpt_log_id" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMP(3),
  "locked_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "smartreader_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smartreader_jobs_job_type_status_idx"
ON "smartreader_jobs"("job_type", "status");

CREATE INDEX "smartreader_jobs_file_id_idx"
ON "smartreader_jobs"("file_id");

CREATE INDEX "smartreader_jobs_evidence_id_idx"
ON "smartreader_jobs"("evidence_id");

CREATE INDEX "smartreader_jobs_event_id_idx"
ON "smartreader_jobs"("event_id");

CREATE INDEX "smartreader_jobs_decision_import_id_idx"
ON "smartreader_jobs"("decision_import_id");

CREATE INDEX "smartreader_jobs_session_id_idx"
ON "smartreader_jobs"("session_id");

CREATE INDEX "AuditLog_evidenceId_idx"
ON "AuditLog"("evidenceId");

CREATE INDEX "AuditLog_eventId_idx"
ON "AuditLog"("eventId");

CREATE INDEX "AuditLog_decisionImportId_idx"
ON "AuditLog"("decisionImportId");

CREATE INDEX "AuditLog_requestId_idx"
ON "AuditLog"("requestId");
