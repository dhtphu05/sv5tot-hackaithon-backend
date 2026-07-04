# VNPT SmartReader Integration

## 1. Required Env

Do not commit real secrets. Use `.env.example` placeholders only.

```bash
VNPT_ENABLED=true
VNPT_BASE_URL=https://api.idg.vnpt.vn
VNPT_ACCESS_TOKEN=
VNPT_TOKEN_ID=
VNPT_TOKEN_KEY=
VNPT_MAC_ADDRESS=EGOV-DIGDOC-WEB-API
VNPT_CLIENT_SESSION=00-14-22-01-23-45-1548211589291
VNPT_DEFAULT_TOKEN=5tot-backend
VNPT_TIMEOUT_MS=120000
VNPT_RETRY_MAX=2

VNPT_UPLOAD_PATH=/file-service/v1/addFile
VNPT_OCR_BASIC_PATH=/rpa-service/aidigdoc/v1/ocr/scan
VNPT_OCR_ADVANCED_PATH=/rpa-service/aidigdoc/v1/ocr/scan-table
VNPT_OCR_ASYNC_START_PATH=/rpa-service/aidigdoc/v1/integration/ocr/scan-table
VNPT_OCR_ASYNC_RESULT_PATH=/rpa-service/aidigdoc/v1/integration/ocr/scan-table/result
VNPT_OCR_ASYNC_CANCEL_PATH=/rpa-service/aidigdoc/v1/integration/ocr/scan-table/cancel
VNPT_ADMIN_DOC_PATH=/rpa-service/aidigdoc/v1/vlm/van-ban-hanh-chinh-vnportal

VNPT_UPLOAD_FORCE_JSON_CONTENT_TYPE=false
VNPT_SAVE_RAW_RESPONSE=true
VNPT_LOG_RAW_RESPONSE=false
SMARTREADER_SMOKE_AUDIT_ENABLED=false
SMARTREADER_ASYNC_MAX_POLLS=60
```

## 2. Mock vs Real

- `VNPT_ENABLED=false`: backend uses `MockSmartReaderAdapter`.
- `VNPT_ENABLED=true`: backend uses the real VNPT SmartReader client and requires `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, and `VNPT_TOKEN_KEY`.
- Existing `VNPT_MODE=mock|live` remains accepted for backward compatibility, but new SmartReader code switches on `VNPT_ENABLED`.

## 3. VNPT Headers

Every real VNPT request sends:

```http
Authorization: Bearer ${VNPT_ACCESS_TOKEN}
Token-id: ${VNPT_TOKEN_ID}
Token-key: ${VNPT_TOKEN_KEY}
mac-address: ${VNPT_MAC_ADDRESS}
```

Logger and SmartReader error/output redaction remove these values. Do not add these headers to logs manually.

## 4. Upload Flow

1. Send multipart/form-data to `VNPT_UPLOAD_PATH`.
2. Fields:
   - `file`
   - `title`
   - `description`
3. Do not set multipart boundary manually. The native `FormData` implementation sets it.
4. VNPT returns `hash` and `fileType`.
5. OCR calls must use that `hash` and `fileType`.

## 5. OCR Basic

Endpoint: `VNPT_OCR_BASIC_PATH`

Payload:

```json
{
  "file_hash": "<upload hash>",
  "file_type": "<upload fileType>",
  "details": true,
  "token": "5tot-backend",
  "client_session": "00-14-22-01-23-45-1548211589291"
}
```

## 6. OCR Advanced scan-table

Endpoint: `VNPT_OCR_ADVANCED_PATH`

Payload adds:

```json
{
  "exporter": "json"
}
```

Use this for table extraction smoke tests.

## 7. Async Flow

1. Start: `VNPT_OCR_ASYNC_START_PATH`
2. Read `session_id` from the response.
3. Poll: `VNPT_OCR_ASYNC_RESULT_PATH`
4. Cancel when needed: `VNPT_OCR_ASYNC_CANCEL_PATH`

VNPT async completion does not depend on `object.status`. The mapper uses:

- Started: `object.session_id` exists.
- Completed: `object.link` exists. The link is usually a signed JSON export URL and can expire.
- Processing: `object.warning` or `object.warnings` contains `request_dang_trong_qua_trinh_xu_ly`, or `object.warning_messages` contains the Vietnamese processing message.
- Progress: `object.num_of_processed_page` and `object.num_of_remaining_pages`.
- Unknown OK: response status is OK/200 but the object shape has no known async marker; inspect the saved tmp poll file.

Some VNPT docs mention `scan_table`, while Postman examples use `scan-table`. This backend keeps all async paths configurable by env and does not hardcode either variant outside defaults. If async start/result/cancel returns 404, try switching the relevant env path from `/scan-table` to `/scan_table`, or the reverse.

## 8. Administrative Document Extraction

Endpoint: `VNPT_ADMIN_DOC_PATH`

Expected useful fields include:

- `co_quan_ban_hanh`
- `so_ky_hieu`
- `loai_van_ban`
- `trich_yeu`
- `ngay_ban_hanh`
- `nguoi_ky`

## 9. Smoke Test

Commands:

```bash
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode upload
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode basic
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode advanced
npm run smartreader:smoke -- --file ./fixtures/smartreader/decision.pdf --mode admin
npm run smartreader:smoke -- --file ./fixtures/smartreader/roster-multipage.pdf --mode async
```

Modes:

- `upload`: verifies upload and returned `hash`/`fileType`.
- `advanced`: synchronous scan-table smoke; useful for small files.
- `admin`: extracts decision/administrative-document metadata such as document number, issue date, type, summary, and signer. It is not for extracting student roster tables.
- `async`: OCR scan-table for multipage files or roster/list extraction. It polls until completed/failed/timeout/max polls.

Outputs are redacted and written to:

- `tmp/smartreader-smoke/latest-upload.json`
- `tmp/smartreader-smoke/latest-ocr.json`
- `tmp/smartreader-smoke/latest-admin.json`
- `tmp/smartreader-smoke/latest-async.json`
- `tmp/smartreader-smoke/latest-async-start.json`
- `tmp/smartreader-smoke/latest-async-poll-<n>.json`
- `tmp/smartreader-smoke/latest-async-final.json`
- `tmp/smartreader-smoke/latest-async-result.json`

`tmp/` is ignored by git.

## 10. Internal Dev Routes

Mounted routes:

- `POST /api/internal/smartreader/upload-test`
- `POST /api/internal/smartreader/ocr-test`
- `POST /api/internal/smartreader/admin-doc-test`
- `POST /api/internal/smartreader/async-test`

Protection:

- Admin bearer token, or
- `x-internal-worker-token: ${INTERNAL_WORKER_TOKEN}`

`upload-test` accepts multipart `file` or body `filePath`.

`ocr-test`, `admin-doc-test`, and `async-test` accept:

- multipart `file`
- body `filePath`
- body `fileId`
- body `hash` or `fileHash` plus `fileType`

Responses return only:

- `hash`
- `fileType`
- `status`
- `warnings`
- `warningMessages`
- `sampleText` first 1000 characters
- `tableCount`
- `numOfPages`
- `sessionId` for async

Full raw response is only returned with `?debug=true` and admin role.

## 11. Redaction And Privacy

- Tokens and VNPT auth headers are redacted from logger output, smoke output, saved smoke JSON, and audit metadata.
- `dataBase64` and `dataSign` are redacted when they are large.
- Full OCR text is not logged when `VNPT_LOG_RAW_RESPONSE=false`.
- Internal route `sampleText` is capped at the first 1000 characters.
- Do not commit real PDFs/images containing personal data under `fixtures/smartreader`.

## 12. Raw Response Storage Policy

- Smoke script output is always redacted and written under ignored `tmp/smartreader-smoke/`.
- `VNPT_SAVE_RAW_RESPONSE=true` allows storing raw provider response in DB fields designed for future pipeline use.
- Keep `VNPT_LOG_RAW_RESPONSE=false` unless debugging in a secure local environment.
- Any raw OCR data can contain personal data and must not be exposed in frontend responses by default.

## 13. Common Errors

- `401`: access token is wrong or expired.
- Missing `Token-id` or `Token-key`: VNPT auth fails even when bearer token is valid.
- Multipart upload fails: check that the field name is `file` and do not set a manual boundary.
- `scan_table` vs `scan-table`: override the async endpoint env paths.
- Timeout on many-page files: increase `VNPT_TIMEOUT_MS` or use async mode.
- Endpoint path is wrong: check the env path for `scan_table` vs `scan-table`.
- OCR response pending: keep polling async result until completed/failed/timeout. The smoke script stops at `VNPT_TIMEOUT_MS` or `--max-polls`.
- Async result has `object.link`: treat the job as completed and use `resultLink`.
- Async result has `object.num_of_processed_page` and `object.num_of_remaining_pages` but no status: treat it as processing and keep polling.
- Async result has warning/message like request is being processed: treat it as polling, not unknown.
- Old `status=unknown` smoke output means the mapper did not understand the response shape. Open `tmp/smartreader-smoke/latest-async*.json` and inspect `object` keys before concluding VNPT failed.
- `unknown_ok_response` means VNPT returned OK/200 but without `link` or processing markers. The smoke script keeps polling until max polls or timeout.
- OCR does not detect tables: use advanced scan-table with `exporter=json`; verify source PDF quality.
- Signed result links may expire and contain signatures. Do not copy full links into docs, reports, or committed files.

Async smoke tuning:

```bash
npm run smartreader:smoke -- --file ./fixtures/smartreader/roster-multipage.pdf --mode async --max-polls 60 --poll-interval-ms 5000
```

Smoke audit is disabled by default to avoid inserting an audit row on every diagnostic run. Set `SMARTREADER_SMOKE_AUDIT_ENABLED=true` only when you explicitly need start/completed/failed smoke audit records.

## 14. Smoke Test Result Log

Real VNPT smoke was not executed during this implementation because credentials and fixture files are environment-specific. Fill this section after running with local secrets:

- Date/time:
- File:
- Mode:
- Endpoint:
- Status:
- Hash returned:
- FileType:
- Num pages:
- Warnings:
- Redacted response path:
- Notes:
