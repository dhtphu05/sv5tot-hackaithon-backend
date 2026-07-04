# Backend Evidence Reader Audit

## 1. Existing Evidence/EvidenceCard Schema

- `Evidence` stores `applicationId`, `collectiveProfileId`, `evidenceName`, `criterion`, `sourceType`, `eventId`, `status`, `indexingStatus`, and internal `confidence`.
- `EvidenceCard` stores OCR and extracted data:
  - `ocrText`
  - `ocrLinesJson`
  - `ocrParagraphsJson`
  - `ocrTablesJson`
  - `extractedFieldsJson`
  - `normalizedFieldsJson`
  - `warningsJson`
  - `matchedEventId`
  - `matchedParticipantId`
  - `matchedKnowledgeItemIds`
  - internal `confidence`
  - `sourceEndpoint`
  - `smartreaderJobId`
  - `aiSummary`
  - `rawAiResponse`
  - `rawResponseJson`

No additive migration is required for the requested student contract because `readableSummary`, `missingFields`, `matchingStatus`, and `studentStatus` can be computed from the existing fields on response.

## 2. Existing File/EvidenceFile Upload Flow

- `POST /api/evidences/:id/files` is implemented by `EvidencesService.uploadFile`.
- It validates required file, owner/editability, MIME type, and file size.
- It saves a `File`, creates an `EvidenceFile`, creates/reuses an `IndexingJob` with `jobType=evidence_ocr`, and updates manual-upload evidence to `pending_indexing`.
- It audits `FILE_STORED`, `FILE_UPLOADED`, and `OCR_JOB_CREATED`.

## 3. Existing IndexingJob/SmartReaderJob Flow

- `POST /api/jobs/worker/tick` calls `JobsService.runWorkerTick`.
- `runIndexingJob` moves queued jobs to `processing`, increments attempts, dispatches by job type, and marks completed/failed.
- `processEvidenceOcrJob` creates a `SmartReaderJob`, uploads the file to VNPT if needed, runs OCR, normalizes OCR, extracts fields, matches registry, creates/updates `EvidenceCard`, and updates evidence status.

## 4. Existing SmartReader Real Client

- SmartReader adapter is configured in `src/modules/smartreader`.
- `createSmartReaderAdapter` returns the real `SmartReaderClient` when VNPT is enabled.
- If VNPT is disabled while the evidence pipeline requires real VNPT, it throws `SmartReaderConfigError`.
- The runtime does not silently fall back to mock for the real evidence OCR pipeline.
- VNPT tokens are read from environment configuration; no token should be hardcoded.

## 5. Existing AuditService

- `AuditService.log` writes immutable audit rows with actor, role, action, target, application/evidence/event IDs, before/after state, metadata, request ID, IP, and user agent.
- It redacts SmartReader secrets before writing JSON payloads.

## 6. Current APIs

- `POST /api/applications/:id/evidences`
  - Creates manual-upload evidence.
  - Accepts snake_case compatibility for `evidence_name` and `source_type`.
  - Requires `sourceType=manual_upload`.
  - Audits `EVIDENCE_CREATED`.
- `POST /api/evidences/:id/files`
  - Uploads a file, stores it, links it, creates OCR job, audits upload/job creation.
- `GET /api/evidences/:id/card`
  - Returns evidence card, audit summary, latest job, and student-facing status/card fields.
- `POST /api/jobs/worker/tick`
  - Claims the next queued job and runs the registered processor.

## 7. APIs Currently Returning Confidence to Student

The previous implementation returned `confidence` in evidence/card DTOs. This has been refactored so student/class representative responses omit confidence and privileged responses use `internalConfidence`.

Internal confidence is still stored for review/routing.

## 8. EvidenceCard Fields Needed

No required schema fields are missing:

- `readableSummary`: computed from extracted/normalized fields.
- `missingFields`: computed from criterion and extracted/normalized fields.
- `studentStatus`: computed on response.
- `matchingStatus`: computed from matched event/participant fields and warning codes.

If persistence becomes necessary later, add nullable JSON fields only; do not drop or rename existing fields.

## 9. Backward Compatibility For FE

Keep existing routes and core envelope shape:

- evidence create/upload paths stay the same.
- `GET /api/evidences/:id/card` keeps `evidence`, `card`, `job`, `indexingStatus`, `uxStatus`, and `auditSummary`.
- New student fields are additive.
- Confidence/raw debug fields are role-gated rather than removed from officer/admin review workflows.
