# Evidence OCR Real Pipeline Plan

## 1. Existing Upload Evidence Flow

- `POST /api/applications/:id/evidences` creates an `Evidence` row and writes `EVIDENCE_CREATED`.
- `POST /api/evidences/:id/files` stores the upload via `StorageService`, creates `File` and `EvidenceFile`, sets evidence to `pending_indexing`, creates an `IndexingJob(evidence_ocr)`, and writes `FILE_UPLOADED` plus `OCR_JOB_CREATED`.
- Existing response returns evidence/file/job, but UX state needs a richer `uxStatus` object for frontend polling.

## 2. Existing Job/Worker Flow

- `POST /api/jobs/worker/tick` takes the oldest queued `IndexingJob`.
- `runIndexingJob` marks it processing, calls `processEvidenceOcrJob`, then marks completed or failed.
- The OCR processor already creates `SmartReaderJob`, uploads to SmartReader if file metadata is missing, OCRs, extracts fields, scores confidence, and upserts `EvidenceCard`.
- Current gaps: runtime can still choose mock adapter, job response is raw DB shape, retry API is missing, and UX status/progress is not mapped.

## 3. Existing Audit Service

- `AuditService.log(...)` is reusable and redacts SmartReader secrets before writing `beforeJson`, `afterJson`, and `metadataJson`.
- Some legacy flows still call `createApplicationAudit(...)`, but Evidence OCR processor uses `AuditService`.
- Audit metadata should remain compact: IDs, provider, confidence, warning counts, page counts, status transitions, and redacted errors only.

## 4. Required Changes For Real SmartReader Runtime

- Add env flags:
  - `VNPT_REQUIRE_REAL_IN_PIPELINE=true`
  - `VNPT_ALLOW_MOCK_RUNTIME=false`
- Runtime SmartReader factory must not silently return mock when mock runtime is disabled.
- Missing VNPT credentials must fail loudly with SmartReader config error.
- Rename mock adapter to make test-only intent explicit.
- Worker should keep using `SmartReaderClient` through the adapter factory and never use mock in dev/runtime when real-only is required.
- Add VNPT error mapping with user-safe messages and technical messages only in job/admin/debug contexts.

## 5. No Mock Runtime Policy

- `MockSmartReaderAdapterForTests` may remain for isolated unit tests.
- `createSmartReaderAdapter()` must return mock only when both:
  - `VNPT_ALLOW_MOCK_RUNTIME=true`
  - `VNPT_REQUIRE_REAL_IN_PIPELINE=false`
- Default runtime should require real VNPT credentials.

## 6. UX Status Model

Evidence/job/card responses should include:

- `step`
- `label`
- `message`
- `nextAction`
- `severity`
- `progressPercent`
- `badges`

Steps: `queued`, `uploading_to_smartreader`, `ocr_processing`, `extracting_fields`, `matching_registry`, `indexed`, `needs_manual_review`, `failed`.

## 7. Audit Events

- `EVIDENCE_CREATED`
- `FILE_UPLOADED`
- `OCR_JOB_CREATED`
- `OCR_JOB_PROCESSING`
- `SMARTREADER_FILE_UPLOAD_STARTED`
- `SMARTREADER_FILE_UPLOADED`
- `SMARTREADER_OCR_STARTED`
- `SMARTREADER_OCR_COMPLETED`
- `SMARTREADER_OCR_FAILED`
- `EVIDENCE_CARD_GENERATED`
- `EVIDENCE_NEEDS_MANUAL_REVIEW`
- `EVIDENCE_INDEXING_FAILED`
- `EVIDENCE_INDEXING_RETRIED`

## 8. Migration

The previous Evidence OCR migration already added nullable EvidenceCard fields needed for OCR JSON, normalized fields, source endpoint, matched participant, and SmartReader job ID.

No destructive migration is needed. Prefer deriving UX status from existing `Evidence.indexingStatus`, `IndexingJob.status`, `SmartReaderJob.status`, progress fields, and card confidence.

## 9. Real VNPT End-To-End Test

1. Validate/build:
   - `npx prisma validate`
   - `npx prisma generate`
   - `npm run build`
2. SmartReader smoke:
   - `npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode upload`
   - `npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode advanced`
3. Evidence flow:
   - Login student.
   - Create evidence.
   - Upload file.
   - Verify queued job and UX `queued`.
   - Run `POST /api/jobs/worker/tick` or `npm run worker:tick`.
   - Verify `File.vnptHash`, `File.vnptFileType`.
   - Verify `EvidenceCard`, audit timeline, and student card response without raw OCR.
4. Negative config:
   - unset `VNPT_TOKEN_KEY`
   - worker/app should fail with config/auth error and no mock fallback.

## 10. Risks And Rollback

- VNPT can time out or reject credentials; job should fail with user-safe message and retry metadata.
- OCR quality depends on scanned file quality; low confidence routes to manual review.
- Extractor is deterministic and intentionally conservative.
- Event Registry matching improves after Decision Import Center.
- Rollback is application-level first. Database changes are additive and nullable, so older code can ignore new columns.
