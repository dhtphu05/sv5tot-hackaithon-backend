# Decision Import Real Pipeline Plan

## 1. Existing Event Registry Flow

- `src/modules/event-registry` already owns events, roster files, participants, and event-to-application import.
- Existing event creation is staff-only and writes `EventRegistry`.
- Existing roster indexing is CSV/mock-oriented through `event_roster_indexing`; it is not suitable as the official SmartReader Decision Import pipeline.
- `EventRegistry`, `EventParticipant`, `EventFile`, `Evidence`, and `EvidenceCard` are already the right destination models for confirmed official data.

## 2. Existing Roster Upload/Indexing

- `POST /api/events/:id/roster-files` stores a file and queues `event_roster_indexing`.
- `processEventRosterIndexingJob` currently parses CSV or mock rows.
- `confirmIndex` writes `EventParticipant` after staff confirmation.
- Decision Import should follow the same preview-before-confirm principle, but with its own import session, VNPT admin-doc extraction, async scan-table OCR, and preview row tables.

## 3. SmartReader Real Client Usage

- Use `getSmartReaderAdapter()` only. Runtime must not instantiate mock adapter.
- Upload file to VNPT to get `hash`/`fileType` either during file upload or before start.
- Metadata job uses `extractAdministrativeDocument({ fileHash, fileType, details: true })`.
- Roster OCR job uses `startAdvancedAsync({ fileHash, fileType, details: true, exporter: "json" })`, polls with bounded max polls/timeout, and downloads `resultLink` when present.
- Reuse existing redaction helpers and raw-response storage policy controlled by `VNPT_SAVE_RAW_RESPONSE`.

## 4. Existing Audit Flow

- Use `AuditService.log(...)` for new Decision Import events so `decisionImportId`, `metadataJson`, request info, and redaction are handled consistently.
- Keep audit metadata compact: provider, import id, file id, job ids, counts, document metadata, warning counts, and error codes.
- Do not put tokens, auth headers, full OCR text, or signed result links into audit logs.

## 5. Schema/Models

Already exists:

- `File`, `SmartReaderJob`, `IndexingJob`, `AuditLog`
- `EventRegistry`, `EventFile`, `EventParticipant`
- `Evidence`, `EvidenceCard`

Need additive-only additions:

- `DecisionImportStatus`, `DecisionTableType`, `RosterPreviewValidationStatus`
- `DecisionImport`
- `DecisionDocument`
- `DecisionTable`
- `DecisionRosterPreviewRow`
- Nullable source/official fields on `EventRegistry`
- Nullable source-row fields on `EventParticipant`
- Add `decision_metadata` and `decision_roster_ocr` to `JobType`

## 6. API Additions

Add `src/modules/decision-imports` mounted at `/api/decision-imports`:

- `POST /`
- `GET /`
- `GET /:id`
- `POST /:id/files`
- `POST /:id/start`
- `GET /:id/status`
- `GET /:id/metadata`
- `GET /:id/tables`
- `GET /:id/preview`
- `PATCH /:id/column-mapping`
- `POST /:id/confirm`
- `POST /:id/cancel`
- `GET /:id/audit`

Update `/api/events`:

- `GET /api/events/search`
- `POST /api/events/:id/import-as-evidence`

## 7. UX Status Model

Decision Import response should include `uxStatus` with:

- `step`: `draft`, `uploaded`, `extracting_metadata`, `ocr_processing`, `parsing_roster`, `preview_ready`, `confirmed`, `failed`, `cancelled`
- `label`, `message`, `nextAction`, `severity`, `progressPercent`, `badges`

The frontend should not infer workflow from raw DB enums.

## 8. Real VNPT End-To-End Test

Baseline:

```bash
npx prisma validate
npx prisma generate
npm run build
npm run lint
npm test
```

Real SmartReader:

```bash
npm run smartreader:smoke -- --file ./fixtures/smartreader/decision.pdf --mode admin
npm run smartreader:smoke -- --file ./fixtures/smartreader/roster-multipage.pdf --mode async
```

Real API flow:

1. Login officer/manager.
2. Create decision import.
3. Upload file.
4. Start processing.
5. Run worker ticks until preview is ready.
6. Get preview and summary.
7. Patch mapping if needed.
8. Confirm import.
9. Verify event registry and participants.
10. Login student whose MSSV is in the list.
11. Search events and import own participant as evidence.
12. Verify EvidenceCard and audit timeline.

## 9. Risks And Rollback

- OCR table quality depends on scan quality, table borders, orientation, and result-link lifetime.
- Async result link may expire; if link download fails and no raw tables exist, fail with user-friendly retry/manual-review status.
- Column mapping may need officer correction; do not auto-confirm.
- Migration is additive and nullable, so application rollback can happen before DB rollback.
- Existing Event Registry APIs remain intact.

## 10. Explicit Non-Goals

- No mock runtime.
- No hardcoded token.
- No auto-confirm of OCR rows.
- No frontend work in this prompt.
- No destructive migration, no column rename/drop.
- No student access to raw OCR/admin responses.
