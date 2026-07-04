# Evidence OCR Real Pipeline

Pipeline minh chứng runtime dùng VNPT SmartReader thật. Không dùng mock adapter trong worker, API nội bộ, hoặc luồng upload/job/card.

## Runtime Contract

- `VNPT_ENABLED=true` là default runtime.
- `VNPT_REQUIRE_REAL_IN_PIPELINE=true` là default.
- `VNPT_ALLOW_MOCK_RUNTIME=false` là default.
- Thiếu `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, hoặc `VNPT_TOKEN_KEY` khi VNPT enabled sẽ fail startup/config thay vì fallback mock.
- `MockSmartReaderAdapterForTests` chỉ được dùng trong test cô lập khi set rõ `VNPT_REQUIRE_REAL_IN_PIPELINE=false` và `VNPT_ALLOW_MOCK_RUNTIME=true`.

## Main Flow

1. `POST /api/applications/:applicationId/evidences` tạo Evidence.
2. `POST /api/evidences/:id/files` lưu file, tạo `File`, `EvidenceFile`, queue `IndexingJob(evidence_ocr)`, trả `uxStatus`.
3. Worker chạy `runIndexingJob`:
   - set job `processing`
   - ghi `OCR_JOB_PROCESSING`
   - tạo `SmartReaderJob`
   - reuse VNPT hash nếu file đã upload trước đó, hoặc lấy file từ local/R2 storage rồi upload file thật lên VNPT
   - chạy OCR advanced scan-table mặc định
   - async scan-table chỉ dùng cho PDF lớn
   - normalize OCR text/lines/paragraphs/tables
   - extract + normalize fields
   - match Event Registry/participant nếu có dữ liệu
   - score confidence
   - upsert `EvidenceCard`
   - set evidence `indexed` hoặc `needs_manual_review`
4. `GET /api/evidences/:id/card` trả evidence, card, job, `uxStatus`, và audit summary.
5. `GET /api/jobs/:id` trả job kèm provider/progress/`uxStatus`.
6. `POST /api/jobs/:id/retry` chỉ retry job đã failed và ghi `EVIDENCE_INDEXING_RETRIED`.

## UX Status

Responses evidence/card/job dùng `uxStatus`:

- `queued`
- `uploading_to_smartreader`
- `ocr_processing`
- `extracting_fields`
- `matching_registry`
- `indexed`
- `needs_manual_review`
- `failed`

Mỗi status có `label`, `message`, `nextAction`, `severity`, `progressPercent`, và `badges` để frontend render mà không cần tự hiểu enum backend.

## Audit Timeline

Pipeline ghi các mốc chính:

- `FILE_UPLOADED`
- `OCR_JOB_CREATED`
- `OCR_JOB_PROCESSING`
- `SMARTREADER_FILE_UPLOAD_STARTED`
- `SMARTREADER_FILE_UPLOADED`
- `SMARTREADER_FILE_REUSED`
- `SMARTREADER_OCR_STARTED`
- `SMARTREADER_OCR_COMPLETED`
- `SMARTREADER_OCR_FAILED`
- `EVIDENCE_CARD_GENERATED`
- `EVIDENCE_NEEDS_MANUAL_REVIEW`
- `EVIDENCE_INDEXING_COMPLETED`
- `EVIDENCE_INDEXING_FAILED`
- `EVIDENCE_INDEXING_RETRIED`

Audit metadata phải compact và đã redacted: không log token, không log full raw OCR text, không copy signed result link vào docs.

## Error Mapping

Worker map lỗi VNPT thành code rõ ràng:

- `VNPT_CONFIG_MISSING`: thiếu cấu hình/token hoặc runtime bị disable trong real pipeline.
- `VNPT_AUTH_FAILED`: VNPT trả 401/403.
- `VNPT_UPLOAD_FAILED`: lỗi upload file lên VNPT.
- `VNPT_OCR_FAILED`: OCR thất bại không thuộc nhóm cụ thể hơn.
- `VNPT_TIMEOUT`: request/async poll quá thời gian hoặc quá max poll.
- `OCR_EMPTY_TEXT`: OCR thành công kỹ thuật nhưng không có text usable.

Các lỗi retryable có thể retry qua `POST /api/jobs/:id/retry`. `OCR_EMPTY_TEXT` đưa evidence về `needs_manual_review`.

## Verification

```bash
npx prisma validate
npx prisma generate
npm run build
npm run lint
npm test -- evidence-ocr-pipeline smartreader
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode upload
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode advanced
npm run worker:tick
```

Negative config check:

```bash
VNPT_ENABLED=true VNPT_TOKEN_KEY= npx tsx -e "import './src/config/env'"
```

Expected: config fails. It must not instantiate `MockSmartReaderAdapterForTests`.
