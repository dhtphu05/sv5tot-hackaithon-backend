# Evidence OCR Pipeline

## Scope

This pipeline supports student/officer manual evidence uploads. It creates an OCR job, generates an Evidence Card, and records warnings/confidence for human review.

It does not decide pass/fail. Officers and review committees remain the final decision makers.

## Flow

1. Create evidence:
   `POST /api/applications/:id/evidences`

   Body accepts `evidence_name` or `evidenceName`, `criterion`, `source_type` or `sourceType`, and optional `description`.

   Only `manual_upload` is accepted by this endpoint. Students can create evidence only in their own editable application. Officers/managers/admins can create evidence for editable applications.

2. Upload file:
   `POST /api/evidences/:id/files`

   The endpoint validates MIME type and size, stores `File` + `EvidenceFile`, sets:

   - `Evidence.status = pending_indexing`
   - `Evidence.indexing_status = pending_indexing`
   - `IndexingJob.job_type = evidence_ocr`

   Audit actions: `FILE_UPLOADED`, `OCR_JOB_CREATED`.

3. Worker tick:
   `POST /api/jobs/worker/tick` or `npm run worker:tick`

   The worker takes one queued `IndexingJob` and runs SmartReader OCR. Use `x-internal-worker-token` when `INTERNAL_WORKER_TOKEN` is configured; otherwise manager/admin auth can call the endpoint in development.

4. Evidence Card:
   `GET /api/evidences/:id/card`

   Students see normalized OCR/card fields only. Privileged staff can see `rawResponseJson` for debugging.

## Why Not Template OCR by Default

SV5T certificates are usually graphic-heavy, with many fonts, layouts, logos, seals, and scanned backgrounds. Template OCR is too brittle as a default for manual uploads.

The default path uses VNPT SmartReader advanced scan-table OCR with `details=true` and `exporter=json`. PDF files use the async scan-table flow because multipage decisions/certificates often contain tables or rosters.

## Worker Details

For each evidence OCR job:

1. Load the primary evidence file.
2. Upload to SmartReader if `File.vnptHash` / `File.vnptFileType` are missing.
3. Create/update `SmartReaderJob`.
4. For PDF: start async OCR, poll until completed/failed/max polls, and download JSON result link when available.
5. For image: call advanced scan-table OCR.
6. Normalize OCR into:
   - `ocr_text`
   - `ocr_lines_json`
   - `ocr_paragraphs_json`
   - `ocr_tables_json`
   - `warnings_json`
7. Extract deterministic fields.
8. Match Event Registry/participant when possible.
9. Score confidence and upsert `EvidenceCard`.

Raw VNPT responses are stored only when `VNPT_SAVE_RAW_RESPONSE=true`, and secrets/signed URLs are redacted.

## Extracted Fields

The deterministic extractor looks for:

- `student_name`
- `student_code`
- `class_name`
- `faculty`
- `document_type`
- `event_name`
- `organizer`
- `organizer_level`
- `issue_date`
- `activity_date`
- `award_level`
- `volunteer_days`
- `certificate_type`
- `language_score`
- `gpa`
- `conduct_score`

Vietnamese heuristics include MSSV/Mã SV, Họ và tên/Cấp cho/Chứng nhận, Hội Sinh viên/Đoàn Thanh niên/Trường/Khoa/CLB/Ban tổ chức, Vietnamese long dates, IELTS/TOEIC/TOEFL/A2/B1/B2, GPA, and conduct score.

## Confidence

Scoring is deterministic:

- OCR success: `+0.35`
- Student name or student code: `+0.15`
- Clear event/evidence name: `+0.10`
- Issue/activity date: `+0.10`
- Organizer: `+0.10`
- Event Registry match: `+0.20`

Penalties:

- Missing important field: `-0.10` each category
- Blurry/skewed/corner issue: `-0.10`
- Possible wrong student: `-0.30`
- OCR failed: `0`

If confidence is below `0.6`, `indexing_status=needs_manual_review`.

## Security And Privacy

- Do not log VNPT tokens.
- Do not log full OCR text.
- Do not return `rawResponseJson` to students.
- Do not commit PDFs containing student personal data.
- Signed VNPT result links may expire and contain signatures; only redacted links should be stored in debug output.

## Debugging

Check queued jobs:

```bash
npm run worker:tick
```

For API-driven worker ticks:

```bash
curl -X POST http://localhost:8080/api/jobs/worker/tick \
  -H "x-internal-worker-token: $INTERNAL_WORKER_TOKEN"
```

Mock mode:

```bash
VNPT_ENABLED=false npm run worker:tick
```

Live VNPT mode requires `VNPT_ENABLED=true` and valid `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, `VNPT_TOKEN_KEY`.

If async OCR stalls, inspect `SmartReaderJob.status`, `progress_processed_pages`, `progress_remaining_pages`, and `redacted_error_json`. `SMARTREADER_ASYNC_MAX_POLLS` bounds the worker loop.
