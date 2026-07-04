# Backend Audit Current

Date/time: 2026-07-03 22:55 Asia/Ho_Chi_Minh

## 1. Current Project Structure

- Backend package: `sv5tot-backend`.
- Package manager state: both `package-lock.json` and `pnpm-lock.yaml` exist. `package.json` has no `packageManager` field. Existing user prompt and scripts use `npm run ...`; repository instructions also mention pnpm as a preferred workspace command. To avoid lock churn, Prompt 1 implementation should not add dependencies unless necessary.
- Framework: Node.js >= 20, ExpressJS, TypeScript CommonJS.
- Main structure:
  - `src/app.ts` wires middleware, Swagger, and routes.
  - `src/main.ts` starts the server.
  - `src/config/*` contains env, CORS, upload, logger, security, database config.
  - `src/modules/*` contains domain modules.
  - `src/infrastructure/*` contains Prisma, queue, storage, mail, and VNPT placeholder clients.
  - `src/shared/*` contains errors, responses, constants, auth types, utilities.
  - `prisma/schema.prisma` and `prisma/migrations/*` contain ORM schema and migrations.
- Existing scripts:
  - `dev`, `build`, `start`, `lint`, `format`
  - `prisma:generate`, `prisma:migrate`, `prisma:studio`
  - `seed`, `create-admin`, `test`
- TypeScript: `strict: true`, target ES2022, CommonJS, output `dist`.
- ESLint/Prettier: ESLint flat config with TypeScript recommended config; `no-explicit-any` is warning, unused variables are errors. Prettier script exists.

## 2. Current Database

- ORM: Prisma with PostgreSQL datasource.
- Migrations: two non-empty migrations exist:
  - `20260702143000_add_application_finalization_fields`
  - `20260702162000_add_review_task_level_assessment`
- Empty migration directory exists and is a risk:
  - `prisma/migrations/20260702000100_decision_imports_smartreader` has no `migration.sql`.
- Seed files exist: `prisma/seed.ts`, `scripts/seed.ts`, `scripts/seed-person2-demo.ts`, `scripts/reset-dev-db.ts`.
- Existing tables/models include:
  - `User`, `RefreshToken`, `OfficerSpecialization`
  - `Application`, `ApplicationDraftSnapshot`, `ApplicationMetric`
  - `File`, `Evidence`, `EvidenceFile`, `EvidenceCard`
  - `EventRegistry`, `EventFile`, `EventParticipant`
  - `KnowledgeBaseItem`, `CriteriaVersion`, `CriteriaRule`
  - `PrecheckResult`, `CascadeReview`, `ReviewTask`, `ReviewTaskEvidence`
  - `ResolutionCase`, `IndexingJob`, `AuditLog`, `Notification`
  - `CollectiveProfile`, `CollectiveMember`, `CollectiveEvidence`, `CollectivePrecheckResult`
- Existing enums/statuses include:
  - `Role`: student, class_representative, officer, manager, committee, admin
  - `Criterion`, `Level`, `ApplicationType`, `ApplicationStatus`, `FinalStatus`
  - `EvidenceSourceType`: metric_input, event_import, manual_upload, collective_import
  - `IndexingStatus`, `EvidenceStatus`, `ReviewTaskStatus`, `ReviewDecision`
  - `JobStatus`: queued, processing, completed, failed
  - `JobType`: evidence_ocr, event_roster_indexing, evidence_card_generation, smartreader_extract
  - `FileStorageType`: local, s3, r2
- File/evidence/job/audit related tables:
  - Files: `File`, `EvidenceFile`, `EventFile`
  - Evidences: `Evidence`, `EvidenceCard`, `CollectiveEvidence`
  - Jobs: `IndexingJob`
  - Audit: `AuditLog`
- Missing for Prompt 1:
  - No `SmartReaderJob`/`smartreader_jobs` table.
  - `File` lacks `vnptHash`, `vnptFileType`, `vnptUploadedAt`, `vnptUploadRawJson`.
  - `AuditLog` lacks `evidenceId`, `eventId`, `decisionImportId`, `metadataJson`, `requestId`, `ipAddress`, `userAgent`. It also uses existing `targetType`/`targetId` and `beforeStateJson`/`afterStateJson` naming.

## 3. Current Auth/RBAC

- Auth routes exist:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`
  - `GET /api/me`
  - `PATCH /api/me`
- JWT and bcrypt are implemented through `TokenService`, `AuthService`, and `PasswordService`.
- RBAC middleware exists:
  - `requireAuth`
  - `requireRole`
  - `require-active-user.middleware.ts`
- Route-level roles are used broadly. No dedicated owner/specialization middleware exists, but ownership and officer-specialization checks appear inside services such as files/review/evidences.

## 4. Current File Upload

- Upload uses Multer memory storage via `src/middlewares/upload.middleware.ts`.
- File size is controlled by `MAX_FILE_SIZE_MB`.
- Allowed MIME types:
  - `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
  - Excel xlsx/xls and `text/csv`
- Storage abstraction exists:
  - module-level `src/modules/storage/*`
  - infrastructure-level local and S3/R2 storage services
- Local storage defaults to `UPLOAD_DIR`.
- R2 config exists but `.env.example` currently has duplicate `STORAGE_DRIVER` entries.
- Existing upload routes:
  - `POST /api/evidences/:id/files`
  - `POST /api/events/:id/roster-files`
  - collective upload routes under `/api/collective`
- Files are persisted in `File`; evidence links are persisted in `EvidenceFile`.

## 5. Evidence/Event/Audit Current State

- `Evidence`, `EvidenceCard`, `EventRegistry`, `EventParticipant`, and `IndexingJob` exist.
- `audit_logs` equivalent exists as Prisma `AuditLog`, and services create audit rows directly in several modules.
- `src/modules/audit/*` exists but is a placeholder:
  - `GET /api/audit/logs` throws `NOT_IMPLEMENTED`.
  - No reusable `audit.log(...)` service exists yet.
- No `smartreader_jobs` table exists.
- The existing evidence OCR processor uses `VnptSmartReaderClient`, but that client is mock-only and does not call VNPT.

## 6. Current API Surface

Mounted route groups in `src/app.ts`:

- `/health`
- `/api/version`
- `/api/auth`
- `/api/me`
- `/api/users`
- `/api/applications`
- `/api` for metrics, evidences, files, precheck, cascade, AI
- `/api/events`
- `/api/knowledge-base`
- `/api/review`
- `/api/manager`
- `/api/collective`
- `/api/resolution`
- `/api/notifications`
- `/api/audit`
- `/api/jobs`
- `/api/smartux`
- `/api/exports`

Notable frontend-facing routes are documented under `docs/frontend-api/*` and include auth, current application, evidences/files, event registry, review, manager, collective, notifications, exports, and audit. Placeholder/mock surfaces:

- `/api/audit/logs` is a placeholder and returns `NOT_IMPLEMENTED`.
- `/api/chatbot/message` is a placeholder.
- `/api/smartux/events` and `/api/smartux/dashboard` are placeholders.
- Existing SmartReader in `src/infrastructure/vnpt/vnpt-smartreader.client.ts` is mock-only.

## 7. VNPT SmartReader Readiness Audit

- Existing env:
  - `.env.example` has `VNPT_MODE`, `VNPT_BASE_URL`, `VNPT_API_KEY`.
  - `src/config/env.ts` validates `VNPT_MODE`, `VNPT_BASE_URL`, `VNPT_API_KEY`.
- Required Prompt 1 env is missing:
  - `VNPT_ENABLED`
  - `VNPT_ACCESS_TOKEN`, `VNPT_TOKEN_ID`, `VNPT_TOKEN_KEY`
  - `VNPT_MAC_ADDRESS`, `VNPT_CLIENT_SESSION`, `VNPT_DEFAULT_TOKEN`
  - endpoint path envs for upload/basic/advanced/async/admin-doc
  - timeout/retry/raw-response flags
- No hardcoded real token was found in tracked source during audit. Existing docs contain example `Authorization: Bearer $TOKEN` command placeholders only.
- No real SmartReader adapter/client module exists under `src/modules/smartreader`; that directory is empty.
- Existing `src/infrastructure/vnpt/vnpt-smartreader.client.ts` returns mock results even when `VNPT_MODE !== 'mock'`.
- No SmartReader smoke script exists.
- No raw OCR response persistence for SmartReader exists.
- Logger currently redacts `req.headers.authorization`, `password`, and `passwordHash`, but not `Token-id`, `Token-key`, `VNPT_ACCESS_TOKEN`, or raw VNPT headers outside request logs.
- No VNPT timeout/retry logic exists.
- No SmartReader-specific audit actions exist.
- No `VNPT_ENABLED=false` adapter fallback exists yet.

## 8. Security Risks

- Env config is incomplete for real VNPT and could encourage ad hoc local token handling if not fixed.
- `.env.example` duplicates `STORAGE_DRIVER` and includes R2 placeholders after local defaults; this can confuse local setup.
- Logger redaction does not yet cover VNPT headers or payload keys.
- `GET /api/files/download?token=...` is unauthenticated by design and relies on JWT token validation; it must remain short-lived.
- Internal SmartReader test routes do not exist; when added, they must be admin/internal-token guarded.
- Existing `AuditLog` service placeholder means important actions are not centrally logged.
- Empty Prisma migration directory may break migration assumptions or confuse deploy reviews.
- Raw OCR output can contain personal data. Prompt 1 should avoid returning full OCR responses by default and should only store raw responses when `VNPT_SAVE_RAW_RESPONSE=true`.
- No destructive migration should be introduced; add nullable columns/tables only.

## 9. Safe Implementation Plan

Assumptions:

- Work is scoped to `sv5tot-backend`.
- Use Node 20 native `fetch`, `FormData`, and `Blob` to avoid dependency/lockfile churn.
- Keep existing mock-only infrastructure client for current evidence pipeline compatibility; add the requested SmartReader module separately.
- Do not implement full evidence pipeline or Decision Import in Prompt 1.
- Do not run real VNPT smoke unless credentials and fixture files are present in the local environment.

Files to add:

- `src/modules/smartreader/smartreader.config.ts`
- `src/modules/smartreader/smartreader.types.ts`
- `src/modules/smartreader/smartreader.client.ts`
- `src/modules/smartreader/smartreader.adapter.ts`
- `src/modules/smartreader/smartreader.mock.ts`
- `src/modules/smartreader/smartreader.mapper.ts`
- `src/modules/smartreader/smartreader.errors.ts`
- `src/modules/smartreader/smartreader.redactor.ts`
- `src/modules/smartreader/smartreader.routes.ts`
- `src/modules/smartreader/smartreader.controller.ts`
- `src/modules/smartreader/smartreader.validation.ts`
- `src/modules/smartreader/index.ts`
- `scripts/smoke-smartreader.ts`
- `docs/SMARTREADER_INTEGRATION.md`
- New Prisma migration for SmartReader jobs and nullable File/AuditLog additions.

Files to modify:

- `src/config/env.ts` for Zod env validation.
- `.env.example` for placeholder-only VNPT env.
- `src/config/logger.ts` for VNPT redaction.
- `src/shared/errors/error-codes.ts` for SmartReader error codes.
- `src/modules/audit/audit.service.ts` and possibly route/controller files for a real audit service.
- `src/app.ts` to mount internal SmartReader routes.
- `package.json` to add `smartreader:smoke`.
- `prisma/schema.prisma` for models/columns/enums.

Migration plan:

- Add nullable VNPT columns to `File`.
- Add nullable metadata columns to `AuditLog`.
- Add `SmartReaderJob` model/table with required status/type fields and JSON fields.
- Add only indexes that support job lookup/status and related entity lookups.

Verification plan:

- `npx prisma generate`
- `npm run build` as typecheck equivalent unless a dedicated typecheck script is added.
- `npm run lint`
- `npm test`
- `npm run smartreader:smoke -- --file <fixture> --mode upload`
- `npm run smartreader:smoke -- --file <fixture> --mode advanced`

Items requiring care:

- Real VNPT smoke tests require local credentials and a fixture file; no token should appear in output or committed files.
- The empty migration directory should not be reused silently unless it is intentionally populated with this Prompt 1 migration.
- Internal dev routes must not leak raw OCR response except `?debug=true` and admin role.

