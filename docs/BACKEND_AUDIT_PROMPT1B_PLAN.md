# Backend Audit Prompt 1B Plan

Date/time: 2026-07-03 23:20 Asia/Ho_Chi_Minh

## 1. Existing Backend Surface Reused

- Core models already exist and remain the source of truth for the current app flow:
  - `Evidence`, `EvidenceCard`
  - `EventRegistry`, `EventParticipant`
  - `IndexingJob`
  - `AuditLog`
  - `File`
- Existing upload routes remain unchanged:
  - `POST /api/evidences/:id/files`
  - `POST /api/events/:id/roster-files`
  - collective evidence/roster upload routes
- Existing auth/RBAC remains unchanged:
  - JWT auth in `requireAuth`
  - role checks in `requireRole`
  - service-level ownership/specialization checks
- Existing mock-only `src/infrastructure/vnpt/vnpt-smartreader.client.ts` remains untouched for current Evidence OCR placeholder compatibility.

## 2. Prompt 1B Gaps Addressed

- Add VNPT SmartReader env validation and `.env.example` placeholders.
- Add SmartReader module under `src/modules/smartreader`.
- Add real VNPT client using Node 20 native `fetch`, `FormData`, and `Blob`.
- Add mock fallback when `VNPT_ENABLED=false`.
- Add timeout and retry for network/timeout/5xx only.
- Add token/header/raw-payload redaction.
- Add reusable `AuditService.log(...)` with optional transaction support.
- Add internal SmartReader test routes guarded by admin JWT or `INTERNAL_WORKER_TOKEN`.
- Add smoke CLI for upload/basic/advanced/admin/async.
- Add integration docs and fixture directory placeholder.

## 3. Migration Additions

Migration: `prisma/migrations/20260703230000_smartreader_foundation/migration.sql`

Adds:

- `SmartReaderJobType` enum.
- `SmartReaderJobStatus` enum.
- Nullable VNPT metadata on `File`:
  - `vnptHash`
  - `vnptFileType`
  - `vnptUploadedAt`
  - `vnptUploadRawJson`
- Nullable SmartReader/audit metadata on `AuditLog`:
  - `evidenceId`
  - `eventId`
  - `decisionImportId`
  - `before_json`
  - `after_json`
  - `metadataJson`
  - `requestId`
  - `ipAddress`
  - `userAgent`
- New `smartreader_jobs` table for future pipeline and smoke-test tracking.

The migration is additive only. It does not rename, drop, or backfill existing production data.

## 4. Files Added Or Modified

Added:

- `src/modules/smartreader/*`
- `scripts/smoke-smartreader.ts`
- `docs/SMARTREADER_INTEGRATION.md`
- `docs/BACKEND_AUDIT_PROMPT1B_PLAN.md`
- `prisma/migrations/20260703230000_smartreader_foundation/migration.sql`
- `fixtures/smartreader/.gitkeep`
- `src/modules/audit/audit.types.ts`

Modified:

- `.env.example`
- `.gitignore`
- `package.json`
- `prisma/schema.prisma`
- `src/app.ts`
- `src/config/env.ts`
- `src/config/logger.ts`
- `src/modules/audit/*`
- `src/shared/constants/application.ts`
- `src/shared/errors/error-codes.ts`

Removed:

- Empty migration directory `prisma/migrations/20260702000100_decision_imports_smartreader`.

## 5. Rollback Plan If Migration Fails

Development rollback:

1. Fix the migration SQL or schema mismatch.
2. Re-run `npx prisma validate`.
3. Re-run `npx prisma generate`.
4. If using a local disposable database, reset with the repo's normal dev reset flow.

Production rollback approach:

- Do not edit a migration that has already been deployed.
- Create a new forward migration to drop `smartreader_jobs`, remove indexes, and remove nullable VNPT/audit columns if rollback is truly required.
- Because this migration is additive and nullable, application rollback can usually happen first without database rollback.

## 6. Real VNPT Test Procedure

1. Put real credentials in local `.env` only.
2. Keep `VNPT_ENABLED=true`.
3. Place local test files under `fixtures/smartreader/`; do not commit files containing personal data.
4. Run:

```bash
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode upload
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode advanced
```

Optional modes:

```bash
npm run smartreader:smoke -- --file ./fixtures/smartreader/sample.pdf --mode basic
npm run smartreader:smoke -- --file ./fixtures/smartreader/decision.pdf --mode admin
npm run smartreader:smoke -- --file ./fixtures/smartreader/roster-multipage.pdf --mode async
```

Outputs are redacted under `tmp/smartreader-smoke/`.

## 7. Security Risks And Mitigations

- Tokens are read from env only and never committed.
- Logger redacts `Authorization`, `Token-id`, `Token-key`, `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, `VNPT_TOKEN_KEY`, `access_token`, `tokenId`, `tokenKey`, `dataBase64`, and `dataSign`.
- Audit service redacts `before`, `after`, and `metadata` before saving.
- Smoke script prints only hash/fileType and aggregate counts.
- Raw OCR is not returned by internal routes unless `?debug=true` and the caller is admin.
- `VNPT_LOG_RAW_RESPONSE=false` is the safe default.
- `tmp/` is ignored by git.

