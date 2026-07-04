# Decision Import Real Pipeline

Decision Import Center imports official decision documents through the real VNPT SmartReader pipeline. It does not use mock OCR at runtime and does not auto-confirm OCR rows.

## Backend Flow

1. Staff creates a draft with `POST /api/decision-imports`.
2. Staff uploads a PDF/image with `POST /api/decision-imports/:id/files`.
   - File bytes are stored via the configured `StorageService`.
   - The same bytes are uploaded to VNPT SmartReader immediately.
   - VNPT `hash` and `fileType` are persisted on `File` and `DecisionImport`.
3. Staff starts processing with `POST /api/decision-imports/:id/start`.
   - `decision_metadata` extracts administrative-document metadata.
   - `decision_roster_ocr` runs VNPT async scan-table OCR.
4. Worker persists `DecisionDocument`, `DecisionTable`, and `DecisionRosterPreviewRow` records.
5. Staff reviews `GET /api/decision-imports/:id/preview`.
6. Staff may update mapping with `PATCH /api/decision-imports/:id/column-mapping`.
7. Staff confirms with `POST /api/decision-imports/:id/confirm`.
   - Creates or updates an active `EventRegistry`.
   - Creates confirmed `EventParticipant` rows only from selected preview rows.
   - Links official decision metadata and source file to the event.

## APIs

- `GET /api/decision-imports`
- `POST /api/decision-imports`
- `GET /api/decision-imports/:id`
- `POST /api/decision-imports/:id/files`
- `POST /api/decision-imports/:id/start`
- `GET /api/decision-imports/:id/status`
- `GET /api/decision-imports/:id/metadata`
- `GET /api/decision-imports/:id/tables`
- `GET /api/decision-imports/:id/preview`
- `PATCH /api/decision-imports/:id/column-mapping`
- `POST /api/decision-imports/:id/confirm`
- `POST /api/decision-imports/:id/cancel`
- `GET /api/decision-imports/:id/audit`
- `GET /api/events/search?studentCode=&criterion=&q=`
- `POST /api/events/:id/import-as-evidence`

## Safety Rules

- No mock SmartReader adapter is allowed when `VNPT_REQUIRE_REAL_IN_PIPELINE=true`.
- OCR preview rows are never auto-confirmed.
- Rows with missing student code, duplicates, or invalid state are excluded by default.
- Warning rows require `includeWarningRows=true`.
- Invalid rows require `includeInvalidRows=true` and manager/admin role.
- VNPT async OCR has a hard max poll count from `SMARTREADER_ASYNC_MAX_POLLS`.

## Audit Actions

- `DECISION_IMPORT_CREATED`
- `DECISION_IMPORT_FILE_UPLOADED`
- `DECISION_IMPORT_STARTED`
- `SMARTREADER_ADMIN_DOC_EXTRACTED`
- `SMARTREADER_OCR_STARTED`
- `SMARTREADER_OCR_POLLING_SUMMARY`
- `SMARTREADER_OCR_COMPLETED`
- `SMARTREADER_OCR_FAILED`
- `DECISION_ROSTER_PARSED`
- `DECISION_COLUMN_MAPPING_UPDATED`
- `DECISION_IMPORT_CONFIRMED`
- `DECISION_IMPORT_CANCELLED`
- `EVENT_REGISTRY_CREATED`
- `EVENT_REGISTRY_UPDATED`
- `EVENT_ROSTER_CONFIRMED`
- `EVENT_EVIDENCE_IMPORTED_BY_STUDENT`

## Known Limitations

- Table detection is conservative and may require manual column mapping for unusual decision layouts.
- Result-link downloads fail closed with `VNPT_RESULT_LINK_DOWNLOAD_FAILED`.
- The frontend Decision Import Center and Evidence Card UX still need to be built on top of these APIs.
