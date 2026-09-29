# Backend Codebase Context

This file is the current source of truth for ChatGPT planning and Codex implementation work in the backend repo. Update this file in place after meaningful implementation work.

## Project

- App: 5TOT backend API.
- Repo path: `D:\02_PROJECTS\5TOT\sv5tot-hackaithon-backend`
- Runtime: Node.js >= 20, TypeScript, CommonJS, Express.
- Database: PostgreSQL through Prisma.
- Prisma schema: `prisma/schema.prisma`.
- Prisma config: `prisma.config.ts`.
- API docs: Swagger setup in `src/docs/swagger`.

## Commands

- Dev: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Prisma validate: `npx prisma validate`
- Prisma generate: `npx prisma generate`
- Migration status: `npx prisma migrate status`
- Migration dev: `npm run prisma:migrate`
- Seed: `npm run seed`
- Worker tick: `npm run worker:tick`

## App Bootstrap

- `src/main.ts` starts the Express server and job worker loop.
- `src/app.ts` creates the Express app and mounts all middleware and routers.
- Global middleware includes:
  - `helmet`
  - `cors`
  - request id
  - JSON/urlencoded body limits
  - pino HTTP logging
  - performance logging
  - rate limiting
  - not-found middleware
  - error middleware

## Route Pattern

Most modules use:

- `<module>.validation.ts`
- `<module>.routes.ts`
- `<module>.controller.ts`
- `<module>.service.ts`
- `<module>.repository.ts`
- `<module>.dto.ts`

Routes are mounted in `src/app.ts`. Use `asyncHandler` for async controllers and `validate` for request validation.

## Auth And Authorization

- Auth middleware: `src/middlewares/auth.middleware.ts`
- `requireAuth` reads Bearer tokens, verifies access tokens, loads the user through Prisma, checks `isActive`, and attaches `req.user`.
- Role guard: `src/middlewares/require-role.middleware.ts`.
- Shared auth type: `src/shared/types/auth.ts`.

## Database

- Prisma singleton: `src/infrastructure/database/prisma.ts`.
- In development, Prisma logs query/info/warn/error; otherwise warn/error.
- Main models include users, applications, evidences, evidence cards, event registry, decision imports, jobs, notifications, mail outbox, collective profiles, chatbot sessions/actions/handoffs, and audit logs.
- Current Prisma checks have passed with:
  - schema valid
  - backend build successful
  - remote database migration status up to date with 11 migrations

## Important Modules

- `auth`: login, refresh, password/token services.
- `users`: user and `me` APIs.
- `applications`: individual application lifecycle.
- `metrics`: application metrics.
- `evidences`: evidence upload/status/card behavior.
- `event-registry`: official events and participant matching.
- `decision-imports`: decision document import, OCR, roster parsing.
- `jobs`: indexing jobs, worker tick, SmartReader-backed processors.
- `notifications`: user notifications.
- `review`: officer review tasks and decisions.
- `manager`: assignment, analytics, finalization/result flows.
- `committee`: committee-facing routes.
- `collective`: collective profile and class representative workflows.
- `resolution`: resolution cases.
- `mail`: outbox and email worker.
- `chatbot`: Smartbot/Gemini/local tool orchestration.
- `smartreader`: VNPT SmartReader client/adapter.
- `smartbot-hooks`: VNPT Smartbot hooks.
- `smartux`: SmartUX integration.
- `exports`: export generation.

## Jobs And Long-Running Work

- Jobs live in `src/modules/jobs`.
- `JobsService` enqueues, runs, retries, and exposes job status.
- Worker loop starts from `src/main.ts` through `startJobWorkerLoop`.
- Current job processors include evidence OCR, event roster indexing, decision metadata, and decision roster OCR.
- Job visibility is role/ownership checked in `JobsService`.

## Notifications

- Notification routes are mounted at `/api/notifications`.
- Routes require auth and support list/read/read-all behavior.
- This is a likely integration point for future realtime/SSE publishing.

## Testing Notes

- Vitest setup file: `tests/setup-env.ts`.
- Default test database URL is `postgresql://postgres:postgres@localhost:5432/sv5tot_test`.
- Integration tests need a local PostgreSQL test DB unless `DATABASE_URL` is overridden.
- Recent broad test run had non-Prisma unit assertion failures and a local DB connection failure for integration tests.

## Environment Notes

- `.env` currently contains duplicated keys and a stray non-key line. Clean it before relying on it as a stable environment source.
- Do not print or copy secrets from `.env` into docs, prompts, logs, or final answers.

## Working Rules

- Before API work, inspect the route, controller, service, repository, DTO, validation, and tests for the closest existing module.
- Before Prisma work, inspect `prisma/schema.prisma` and existing migrations.
- After a meaningful change, update this file in place.
- Do not create `CODEBASE_CONTEXT_NEW.md`, timestamped context files, or duplicate context snapshots.

## University Workspace Context

This section reflects the completed university workspace implementation on 2026-07-16. Workspace means the operating university/school unit. There is no separate `University` model, no `WorkspaceMembership`, no workspace switcher, no `workspaceId` in JWT, and no `X-Workspace-Id` request header.

### Final Workspace Data Model

- `Workspace` is the canonical university/workspace table with `id`, unique `code`, `name`, nullable `shortName`, `isActive`, `registrationEnabled`, `createdAt`, and `updatedAt`.
- `User.workspaceId` is nullable. All non-admin users are expected to have a workspace; global admins may have `workspaceId = null`.
- `User.studentCode` uniqueness is scoped by `(workspaceId, studentCode)`.
- Required tenant roots now carry `workspaceId`: `Application`, `CollectiveProfile`, `EventRegistry`, `DecisionImport`, `KnowledgeBaseItem`, `CriteriaVersion`, `ReviewTask`, and `ResolutionCase`.
- Secondary/log/job records carry nullable workspace anchors for propagation and auditability: `File`, `IndexingJob`, `SmartReaderJob`, `AuditLog`, `Notification`, `ChatSession`, `ChatbotAction`, and `ChatbotHandoff`.
- `CriteriaVersion.unitScope` remains a source/display label. Workspace ownership is represented by `CriteriaVersion.workspaceId`.
- Shared helpers in `src/shared/utils/workspace-scope.ts` are the standard way to write scoped code: `workspaceIdForWrite`, `workspaceFilterFor`, and `assertSameWorkspace`.

### Registration API Behavior

- Public registration is student-only through `POST /api/auth/register`.
- Register input requires `workspaceId` UUID and no longer accepts free-text `school`.
- `AuthService.register` loads the workspace before user creation.
- Missing, inactive, or registration-closed workspaces are rejected with `WORKSPACE_NOT_FOUND`, `WORKSPACE_INACTIVE`, or `WORKSPACE_REGISTRATION_CLOSED`.
- Email remains globally unique.
- New students are created under the selected workspace.
- Register/login responses include `SafeUser.workspaceId` and `SafeUser.workspace`.
- Public registration workspace choices come from `GET /api/workspaces?registration=true`; it returns only active workspaces with registration enabled.

### Admin Workspace Management API

This section reflects the admin-only workspace management API added on 2026-07-17.

- Admin routes are mounted at `/api/admin/workspaces` from `src/modules/workspaces/workspaces.routes.ts`.
- Every admin workspace route requires `requireAuth` and `requireRole(Role.admin)`. Manager, officer, committee, student, and class representative roles are denied before service execution.
- Public `GET /api/workspaces?registration=true` remains unchanged and still returns only active workspaces with `registrationEnabled = true`.
- Supported endpoints:
  - `GET /api/admin/workspaces` with `search`, `isActive`, `registrationEnabled`, `page`, and `limit`; searches `code`, `name`, and `shortName`; returns `userCount` and `applicationCount` in the existing paginated response format.
  - `GET /api/admin/workspaces/:workspaceId` returns workspace metadata, total users, users by role, total applications, applications by status, latest active criteria version, readiness, and timestamps.
  - `POST /api/admin/workspaces` creates workspace metadata only. It trims/uppercases `code`, requires code pattern `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`, requires non-empty `name`, defaults `isActive=true` and `registrationEnabled=false`, blocks duplicate codes, and does not auto-create criteria, users, memberships, or demo data.
  - `PATCH /api/admin/workspaces/:workspaceId` updates only `name` and `shortName`; workspace code updates are not supported.
  - `PATCH /api/admin/workspaces/:workspaceId/status` updates `isActive` and/or `registrationEnabled`; inactive + registration-open is invalid; deactivation automatically closes registration without deleting data.
  - `GET /api/admin/workspaces/:workspaceId/users` lists safe users only from the target workspace with `search`, `role`, `isActive`, `page`, and `limit`.
- Opening registration requires the workspace to be active and have at least one active `CriteriaVersion`; otherwise the service returns `WORKSPACE_NOT_READY_FOR_REGISTRATION`.
- Readiness shape is local to the workspace module: `readyForRegistration`, `checks`, `warnings`, and `blockers`. Blockers are inactive workspace and no active criteria. Missing manager/officer/committee are warnings only.
- Audit actions written through `AuditService.log`: `WORKSPACE_CREATED`, `WORKSPACE_UPDATED`, `WORKSPACE_ACTIVATED`, `WORKSPACE_DEACTIVATED`, `WORKSPACE_REGISTRATION_OPENED`, and `WORKSPACE_REGISTRATION_CLOSED`.
- `AuditLogInput` now supports optional `note`, and admin workspace status changes use it for notes such as registration auto-close on deactivation.
- Hardening verified in unit/route tests: managers, officers, and committee users are denied; delete route is not exposed; update validation rejects code-only payloads before service execution; service update ignores code even if an extra property reaches it; registration cannot be opened while inactive or without active criteria; deactivation closes registration; reactivation does not reopen registration; status/update audit logs include before/after state.
- Added/reused workspace error codes: `WORKSPACE_NOT_FOUND`, `WORKSPACE_CODE_ALREADY_EXISTS`, `WORKSPACE_CODE_INVALID`, `WORKSPACE_STATUS_INVALID`, `WORKSPACE_NOT_READY_FOR_REGISTRATION`, and `WORKSPACE_INACTIVE`.
- Swagger/OpenAPI documents all six admin-only endpoint groups under tag `Admin Workspaces`.
- No Prisma schema change and no migration were added for this API.

### `/api/me` Behavior

- `/api/me` returns the safe user shape with `workspaceId` and `workspace: { id, code, name, shortName } | null`.
- `requireAuth` reloads the workspace from the database user instead of trusting the token.
- Non-admin authenticated users without a workspace are rejected with `USER_WORKSPACE_REQUIRED`.
- Users whose workspace is inactive are rejected with `WORKSPACE_INACTIVE`.
- Admin users with `workspaceId = null` are allowed and keep global visibility where services intentionally permit it.
- `UsersService.updateMe` still only updates profile fields such as `fullName`, `phone`, and `avatarUrl`; users cannot change workspace through profile update.

### Workspace Scoping Status

- New applications, collective profiles, events, decision imports, knowledge-base items, review tasks, resolution cases, notifications, files, jobs, SmartReader jobs, audit logs, chat sessions, chatbot actions, and chatbot handoffs now write or inherit workspace where relevant.
- Application update/timeline/reopen helper paths assert same workspace for non-admin users.
- Review task list/detail paths scope by task workspace and restrict matched event/knowledge-base lookup by workspace.
- Manager dashboard/list/results/committee inbox/workload/detail/action entrypoints receive `req.user` and use `workspaceFilterFor` or `assertSameWorkspace`; admin remains global.
- Event registry, decision imports, knowledge base, collective, and resolution flows are scoped by workspace for non-admin users.
- Decision-import event-to-evidence linking prevents cross-workspace event/application usage.
- Evidence upload/list/detail/card paths assert the parent application workspace for non-admin users; evidence-created files, OCR jobs, and OCR audit logs inherit the application/collective workspace.
- File metadata and signed URL access no longer treat manager/committee as global; non-admin staff must match the file or parent evidence workspace, and cross-workspace details return not found.
- Job detail/run/retry no longer treats manager/officer/committee as global; non-admin staff must match `IndexingJob.workspaceId` or the resolved target workspace.
- Event registry matching during OCR and Evidence Matching Hub searches are workspace-scoped.
- Criteria loading for precheck/cascade now includes `CriteriaVersion.workspaceId`, not only `schoolYear + level + unitScope`.
- Exports scope application/review rows by `workspaceFilterFor(user)` and export files inherit the requesting user's workspace for non-admin users.
- Audit log list is workspace-scoped for manager/committee; `createApplicationAudit` and `AuditService.log` resolve workspace from application, collective profile, evidence, event, decision import, file, or job parents when the caller does not pass one.
- Notification creation derives the recipient user's workspace when the caller does not pass `workspaceId`.
- Chatbot local tools, Smartbot webhook tools, chat sessions/actions/handoffs, and chatbot action audit logs are workspace-scoped. Smartbot webhook read tools require user context (`userId`, `user_id`, or `sender_id`) to resolve workspace; without it they return empty/not-found rather than querying globally.
- Users list is workspace-scoped for manager/committee; admin remains global.
- Isolation is implemented in application code, not PostgreSQL RLS.

### Migration And Backfill Status

- Workspace foundation migration: `20260716123000_workspace_foundation`.
- Tenant anchor migration: `20260716150000_workspace_tenant_anchors`.
- Remote Supabase migration status is up to date with 11 local migrations.
- Foundation migration creates `Workspace`, seeds `DHBK-DHDN`, adds `User.workspaceId`, backfills non-admin users, and replaces global student-code uniqueness with workspace-scoped uniqueness.
- Tenant-anchor migration adds workspace columns, backfills from owner/parent entities where possible, falls back to default workspace `DHBK-DHDN`, then sets required root columns `NOT NULL`.
- SQL backfill was adjusted for PostgreSQL compatibility by avoiding references to the target update alias inside `JOIN ... ON`.
- `SET statement_timeout = '10min'` is included in the tenant-anchor migration for remote Supabase deploys.
- `npm run seed` upserts the seven configured University of Danang workspaces and aligns seeded criteria/demo rows with workspace ownership.
- Seeded workspaces:
  - `DHBK-DHDN`: `Trường Đại học Bách khoa - Đại học Đà Nẵng`, active, registration enabled, default workspace for legacy/demo data.
  - `DHKTE-DHDN`: `Trường Đại học Kinh tế - Đại học Đà Nẵng`, active, registration enabled.
  - `DHSP-DHDN`, `DHNN-DHDN`, `DHSPKT-DHDN`, `VKU-DHDN`, and `TYD-DHDN`: active, registration disabled.
- `DHKTE-DHDN` seed includes a minimal demo account set: one student, one officer, one manager, and one committee user. The Kinh tế officer has active officer specializations scoped to the seeded economics faculty.
- `DHKTE-DHDN` also has a school-level trial `CriteriaVersion` named `Bộ tiêu chí thử nghiệm - không sử dụng cho xét duyệt chính thức`; it is for precheck/cascade testing only and is not an official Kinh tế criteria set.
- Read-only verification script: `npx tsx scripts/verify-workspace-backfill.ts`.
- The verification script checks missing workspace anchors and parent/workspace mismatches for non-admin users, files, indexing jobs, SmartReader jobs, audit logs, notifications, chat records, application/student, collective/representative, review tasks, resolution cases, event/decision-import, criteria versions, knowledge base, evidence files, decision-import files, event files, and job parents.

### Verification Results

- `npx prisma migrate status`: database schema is up to date.
- `npx prisma validate`: passed.
- `npm run build`: passed.
- `npm run lint`: passed with warnings only; warnings are existing `no-explicit-any` warnings in seed/knowledge-base/notification DTO/review-task-detail tests.
- `npx tsx scripts/verify-workspace-backfill.ts`: passed; every reported mismatch/missing-workspace count was `0`.
- Latest blocker verification pass on 2026-07-16:
  - `npm run build`: passed.
  - `npx tsx scripts/verify-workspace-backfill.ts`: passed; all missing-anchor and parent/workspace mismatch counts were `0`.
  - `npx vitest run tests/unit/auth-register.test.ts tests/unit/auth-middleware-workspace.test.ts tests/unit/review-task-detail.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/chatbot-action-service.test.ts tests/unit/chatbot-tool-registry.test.ts tests/unit/smartbot-hooks.test.ts tests/unit/manager-aggregation.test.ts`: passed with 9 files and 34 tests.
  - Automated HTTP A/B workspace isolation checks were not completed because there is no ready A/B integration fixture and the local PostgreSQL test database at `localhost:5432` was unavailable (`TcpTestSucceeded False`; `npx prisma migrate status` against `sv5tot_test` failed before schema inspection).
- Focused workspace/auth/chatbot/evidence tests passed:
  - `npx vitest run tests/unit/auth-register.test.ts tests/unit/auth-middleware-workspace.test.ts tests/unit/chatbot-action-service.test.ts tests/unit/chatbot-tool-registry.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/manager-aggregation.test.ts`
  - `npx vitest run tests/unit/evidence-matching.service.test.ts tests/unit/email-outbox.service.test.ts tests/unit/official-import-name-match.test.ts tests/unit/smartbot-hooks.test.ts tests/unit/evidence-ocr-pipeline.test.ts -t "does not return raw OCR response to students|EvidenceMatchingService|EmailOutboxService|importEventAsEvidence|SmartbotHooksService"`
- Full `npm test` was run and still failed for known/pre-existing issues unrelated to workspace scoping:
  - local PostgreSQL test DB unavailable at `localhost:5432` for `tests/integration/non-ai-application-flow.test.ts`
  - chatbot demo text/stream expectation drift
  - OCR transcript faculty extraction expectation drift
  - evidence warning label expectation drift
- Workspace A/B integration implementation pass on 2026-07-16:
  - Added `tests/integration/workspace-isolation-flow.test.ts`.
  - The suite seeds two active registration-enabled workspaces with real users, criteria, applications, metrics, evidences, files, indexing jobs, events, participants, review tasks, resolution cases, decision imports, preview rows, knowledge-base items, audit logs, export files, chat sessions, and chatbot actions.
  - Tokens are created through real `POST /api/auth/login`; the suite does not mock `req.user`, repositories, or auth middleware.
  - Coverage includes application/manager, evidence/file, review/resolution, event registry, decision imports, knowledge base, evidence matching, criteria/precheck/cascade, jobs, audit, chatbot, smartbot hook, exports, and admin control.
  - Updated `tests/integration/non-ai-application-flow.test.ts` so its seeded non-admin users belong to a test workspace.
  - Fixed two leaks found during implementation review: `ChatbotActionService` now checks workspace before user ownership for cross-workspace actions, and `JobsService` rejects jobs whose `workspaceId` does not match the target evidence/decision-import workspace before view/run/retry.
  - `npx prisma validate`: passed.
  - `npm run build`: passed.
  - `npm run lint`: passed with the existing 18 `no-explicit-any` warnings only.
  - `npx vitest run tests/unit/chatbot-action-service.test.ts tests/unit/auth-middleware-workspace.test.ts`: passed with 2 files and 5 tests.
  - `npx prisma generate`: failed with `EPERM` while renaming `node_modules/.prisma/client/query_engine-windows.dll.node`, indicating a local file lock/permission issue.
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sv5tot_test npx prisma migrate status`: failed because no PostgreSQL server is reachable at `localhost:5432`.
  - `npx vitest run tests/integration/workspace-isolation-flow.test.ts`: failed in `beforeAll` while creating Workspace A because the local PostgreSQL test DB is unreachable; 8 A/B tests were skipped after fixture setup failed.
  - `npx vitest run tests/integration/non-ai-application-flow.test.ts`: failed in `beforeAll` while upserting the test workspace because the local PostgreSQL test DB is unreachable.
  - `npm test`: failed for the same two local DB integration failures plus the known chatbot/OCR/evidence-status assertion drift listed above.
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sv5tot_test npx tsx scripts/verify-workspace-backfill.ts`: failed because the local PostgreSQL test DB is unreachable. Remote/Supabase databases were not used for this verification.
- UDN workspace seed verification on 2026-07-17:
  - `npx prisma validate`: passed.
  - `npm run build`: passed.
  - `npm run seed`: passed twice; second run completed without duplicate/upsert errors.
  - `GET /api/workspaces?registration=true`: returned exactly `DHBK-DHDN` and `DHKTE-DHDN`.
  - `POST /api/auth/register`: accepted the same generated `studentCode` in both `DHBK-DHDN` and `DHKTE-DHDN`, confirming workspace-scoped student-code registration.
  - `GET /api/me` for the seeded Kinh tế student returned `workspace.code = DHKTE-DHDN`, `studentCode = 102220001`, `faculty = Khoa Kinh tế`, and `className = 48K01.1`.
- Admin workspace API verification on 2026-07-17:
  - `npx prisma validate`: passed.
  - `npm run build`: passed.
  - `npm run lint`: passed with the existing 18 `no-explicit-any` warnings only.
  - `npx vitest run tests/unit/admin-workspaces.service.test.ts tests/unit/admin-workspaces.routes.test.ts`: passed with 2 files and 21 tests.
  - Automated HTTP A/B integration tests were not run in this pass because the disposable local PostgreSQL test database is still unavailable and the suite should not be pointed at Supabase/remote data.
- Admin browser/API verification on 2026-07-18:
  - Local backend `127.0.0.1:8080` and frontend `127.0.0.1:8081` were exercised through the in-app Browser as a global admin user.
  - `POST /api/auth/login` worked for the admin account; `/api/me` returned `role=admin` with `workspaceId=null`.
  - `GET /api/admin/workspaces` returned 9 existing workspaces in the configured dev database, including the seven UDN seed workspaces plus historical `E2E-NON-AI` and `PILOT-5TOT` rows.
  - `GET /api/admin/workspaces/:workspaceId` and `GET /api/admin/workspaces/:workspaceId/users` worked for `DHKTE-DHDN`; readiness was `readyForRegistration=true` and users total was `5`.
  - Historical test workspace `E2E-NON-AI` was closed for registration through `PATCH /api/admin/workspaces/:workspaceId/status` with `registrationEnabled=false`; the row was not deleted.
  - After that data fix, `GET /api/workspaces?registration=true` returned exactly `DHBK-DHDN,DHKTE-DHDN`.
  - Verification commands passed: `npm run build` and `npx vitest run tests/unit/admin-workspaces.service.test.ts tests/unit/admin-workspaces.routes.test.ts` (2 files, 21 tests).

### Automated Workspace A/B Integration Suite

- Test file: `tests/integration/workspace-isolation-flow.test.ts`.
- Required DB: `postgresql://postgres:postgres@localhost:5432/sv5tot_test` or another explicitly configured disposable test PostgreSQL database.
- Do not run this suite against Supabase/remote production data.
- Before running locally, start PostgreSQL, create `sv5tot_test` if missing, set `DATABASE_URL` to the test database, and apply migrations with `npx prisma migrate deploy`.
- Main command: `npx vitest run tests/integration/workspace-isolation-flow.test.ts`.
- Also run `npx vitest run tests/integration/non-ai-application-flow.test.ts` because that older integration flow now depends on workspace-owned users.
- Current environment blocker: this machine has a historical PostgreSQL 15 data directory at `C:\Program Files\PostgreSQL\15\data`, but no `postgres.exe`, `pg_ctl.exe`, or `psql.exe` was found in PATH, `C:\Program Files\PostgreSQL`, Chocolatey paths, or `D:\04_DEV_TOOLS`; no Windows PostgreSQL service is registered; port `localhost:5432` is closed.
- Attempted local PostgreSQL install with `choco install postgresql -y --no-progress`, but it failed without elevation/permissions on `C:\ProgramData\chocolatey`.

### Known Limitations

- There is no workspace switcher or membership model; users belong to one workspace, except global admins.
- Admin remains globally scoped by design.
- PostgreSQL RLS is not enabled; new backend query roots must explicitly use workspace helpers.
- Secondary records still keep nullable `workspaceId` in Prisma for migration compatibility, but current write paths should populate them. The read-only verification script should stay part of release checks until those columns can safely become required.
- Old global uniqueness constraints on `Application` and `CollectiveProfile` remain alongside workspace-aware indexes; this is conservative but may be too restrictive for future cross-workspace user scenarios.
- File storage paths do not include workspace; database authorization remains the isolation boundary.
- `faculty`, `className`, and `schoolYear` remain free-text/domain fields, not workspace-owned reference data.
- Seed is idempotent for the configured UDN workspaces but does not delete or automatically disable unknown historical workspaces. Current dev data still contains closed-registration historical rows such as `E2E-NON-AI` and `PILOT-5TOT`; they remain visible to global admin but not public signup choices.
- Smartbot webhook read tools now require user context to resolve workspace. Existing external Smartbot flows must pass `userId`, `user_id`, or `sender_id` for non-empty scoped results.
- Full A/B integration verification still requires a running local PostgreSQL test database. The fixture and HTTP suite now exist, but they have not executed assertions on this machine because `localhost:5432` is unavailable.
- Direct `/api/files/download?token=...` is a signed-token download endpoint and does not authenticate a workspace user on the download request itself. Workspace isolation is enforced at file metadata/signed-URL/export-download issuance.
- `npx prisma generate` is currently blocked by a local query-engine file lock/permission issue in `node_modules/.prisma/client`.

### Next Recommended Work

- Start or reinstall local PostgreSQL with a disposable `sv5tot_test` database, apply migrations, then run `tests/integration/workspace-isolation-flow.test.ts` to completion before opening a second real workspace.
- Clear the local Prisma query-engine file lock and rerun `npx prisma generate`.
- Make `scripts/verify-workspace-backfill.ts` part of staging/release verification.
- Add frontend/browser smoke coverage for the admin workspace detail route, status confirmation dialogs, readiness blocker display, and read-only user list against a stable local fixture.
- Add an explicit cleanup policy for historical/test workspaces in shared dev databases so public registration choices cannot be polluted by integration fixtures.
- Decide whether global admin should remain global or become workspace-selectable.
- Decide whether to remove old global uniqueness constraints after confirming workspace-scoped behavior in staging.
- Consider PostgreSQL RLS for defense in depth if multi-tenant production risk increases.
- Normalize `faculty` and `className` into workspace-owned reference data if signup/profile data quality becomes an issue.

## Criteria Completion Foundation

This section reflects the requirement-tree completion foundation added on 2026-07-17.

- Prisma migration `20260717110000_requirement_completion` adds `RequirementResponseKind`, `RequirementResponseStatus`, and `ApplicationRequirementResponse`.
- Prisma migration `20260717123000_metric_metadata` adds nullable metric metadata fields `schoolYear`, `source`, and `supportingEvidenceId` for GPA/conduct-source traceability.
- `ApplicationRequirementResponse` stores explicit student/staff responses per `applicationId + criterion + requirementKey`, with workspace isolation through `workspaceId` and optional links to `ApplicationMetric` or `Evidence`.
- New backend module: `src/modules/criteria-completion`.
  - `criteria-completion.types.ts` defines the canonical DTO contracts.
  - `criteria-requirement.parser.ts` converts existing `CriteriaRule` JSON/legacy rule types into requirement groups.
  - `criteria-completion.evaluator.ts` evaluates `all_of`, `one_of`, `at_least_n`, optional requirements, activity aggregation, explicit responses, and legacy metric/evidence mapping.
  - `criteria-completion.service.ts` loads the application context, criteria version, metrics, evidences, review state, and responses, then returns completion DTOs without writing official pass/fail decisions.
- School-level `ethics` now has an explicit business requirement tree instead of a single conduct-score input:
  - `ethics_foundation` is required `all_of` with `conduct_score` and `no_violation`.
  - `conduct_score` accepts `system_data`, `manual_metric`, and `manual_evidence`; manual declarations are `declared` or `needs_verification`, not `verified`.
  - `no_violation` is a `system_confirmation` that only officer/manager/admin or authorized system paths may confirm; student-created `verified`/`rejected` confirmations are blocked.
  - `ethics_additional_achievements` is optional `one_of` for political-theory competition, exemplary youth, good-person-good-deed, recognized courageous action, and other ethics achievements; missing optional achievements do not block school-level completion.
- Criteria completion status semantics for ethics:
  - verified conduct score above threshold plus verified `no_violation` returns `ready_for_precheck`;
  - manual/unverified conduct score above threshold plus verified `no_violation` returns `needs_verification`;
  - below-threshold conduct score returns `precheck_warning`;
  - missing `no_violation` remains incomplete with next action `Chờ nhà trường xác nhận tình trạng vi phạm`.
- School-level `academic` now has an explicit business requirement tree instead of treating GPA as the whole criterion:
  - `academic_foundation` is required `all_of` with `academic_gpa`, `no_f_grade`, and `academic_period_valid`.
  - GPA supports raw scale 4 and 10, normalizes to scale 4 for evaluation, and keeps raw value/scale in completion payload.
  - `no_f_grade` is staff/system-confirmed; students may declare preliminarily but cannot set `verified` or `rejected`.
  - `academic_period_valid` is derived from GPA/evidence school-year metadata; missing or wrong year returns `needs_verification`.
  - `academic_additional_achievement` is optional for school-level criteria unless the active criteria config marks it required; target-level changes reload/evaluate the active tree.
- Academic completion response includes GPA payload fields `rawValue`, `rawScale`, `normalizedValue`, `threshold`, `thresholdScale`, `source`, and `verificationStatus`, plus item-level `additionalAchievementRequired`.
- School-level `physical` now uses an explicit `physical_path` `one_of` tree instead of a default physical-score metric input:
  - `physical_course_result` accepts system/manual metric or evidence for Physical Education score/classification.
  - `healthy_student_title`, `sports_activity_or_award`, `sports_team_member`, and `regular_sports_training` are evidence paths.
  - One verified path satisfies the group; one pending path makes the criterion `needs_verification`; superseded responses are ignored; rejected-only paths produce a warning/incomplete state under existing semantics.
  - Students can replace a submitted path by superseding prior active physical-path responses without deleting audit history.
- School-level `volunteer` now uses `volunteer_path` `one_of` instead of a manual total-days metric:
  - `recognized_campaign` and `volunteer_award` are evidence paths.
  - `accumulated_volunteer_days` and `activity_count` are `activity_aggregation` paths backed by activity ledger responses in `ApplicationRequirementResponse.payloadJson`.
  - Aggregation returns `verifiedTotal`, `pendingVerificationTotal`, `excludedTotal`, `unit`, `threshold`, and `activities`; only `verifiedTotal` satisfies thresholds.
  - Legacy `volunteer_days` metrics are mapped as `needs_verification` summaries, not verified activity.
  - Event imports and official-event responses can contribute verified converted values; duplicate volunteer event imports are blocked by `eventId`.
- School-level `integration` now uses the active CriteriaVersion tree instead of assuming IELTS/TOEIC or a single foreign-language metric:
  - Legacy school rules build `integration_path` as `one_of` with `foreign_language`, `skills_or_union_training`, `international_exchange`, `foreign_language_or_integration_competition`, and optional `student_union_achievement` when configured.
  - Explicit CriteriaVersion `requirementGroups` are preserved as-is, so higher target levels can evaluate `ALL_OF` foundation groups plus `ONE_OF` additional groups.
  - `foreign_language` stores language/result form/certificate metadata, issue/expiry dates, school year, and source. It evaluates only configured/evaluable mappings and keeps unmapped certificates as `needs_verification` rather than rejecting them.
  - Study-year thresholds can be configured through `studyYearThresholds`; absent reliable study-year data is treated as data needing verification.
  - Skills/training, international exchange, and competition paths are evidence/official-event responses and do not create fake metrics.
- API contract:
  - `GET /api/applications/:id/criteria-completion`
  - `POST /api/applications/:id/requirement-responses`
  - `PATCH /api/requirement-responses/:id`
  - `DELETE /api/requirement-responses/:id`
  - `POST /api/applications/:id/ethics/conduct-score/link-metric`
  - `POST /api/applications/:id/ethics/conduct-score/declare`
  - `POST /api/applications/:id/ethics/no-violation/confirmation`
  - `POST /api/applications/:id/ethics/additional-achievements`
  - `POST /api/applications/:id/academic/gpa/declare`
  - `POST /api/applications/:id/academic/no-f-grade/confirmation`
  - `POST /api/applications/:id/academic/additional-achievements`
  - `POST /api/applications/:id/physical/course-result/declare`
  - `POST /api/applications/:id/physical/path-evidence`
  - `POST /api/applications/:id/volunteer/activities`
  - `POST /api/applications/:id/volunteer/path-evidence`
  - `POST /api/applications/:id/integration/path-responses`
- Mutations validate application access, workspace, requirement key membership in the active criteria tree, linked metric/evidence ownership, and write audit actions `REQUIREMENT_RESPONSE_CREATED`, `REQUIREMENT_RESPONSE_UPDATED`, and `REQUIREMENT_RESPONSE_DELETED`.
- Legacy compatibility:
  - Existing GPA, conduct score, physical score, volunteer days, and foreign-language score metrics are mapped into matching requirements.
  - Volunteer/activity aggregation sums metric/event/evidence-derived values before comparing the aggregate threshold.
  - Evidence without explicit requirement responses remains available through legacy evidence mapping and existing evidence UI; no old evidence is deleted or rewritten.
- Precheck/submit integration pass on 2026-07-17:
  - Application precheck no longer calls the old fixed metric/evidence-count rules engine for individual applications. It builds the same requirement completion snapshot used by `CriteriaCompletionService` and persists it in `PrecheckResult.resultJson`.
  - Precheck criterion output includes requirement groups, satisfied requirements, missing requirements, needs-verification items, warnings, a structured next action, and `humanConfirmationRequired: true`.
  - Precheck wording uses requirement statuses such as `Đáp ứng ngưỡng sơ bộ`, `Cần xác minh`, `Chưa có dữ liệu`, and `Cần bổ sung`; it does not return confidence as a student-facing conclusion or update final result.
  - Submit now blocks while evidence upload/OCR is still processing, auto-runs precheck when the latest snapshot is stale after metric/evidence/requirement-response updates, and requires `allowSubmitWithWarnings=true` when completion-derived warnings/missing items remain.
  - Submit no longer requires all criteria to be AI/rules-confirmed as passed and does not update final result.
- Verification on 2026-07-17:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: blocked by a local Windows file lock while renaming `node_modules/.prisma/client/query_engine-windows.dll.node`.
  - `npm run build`: passed.
  - `npm run lint`: passed with the existing 18 `no-explicit-any` warnings only.
  - `npx vitest run tests/unit/criteria-completion.test.ts tests/unit/rules-engine.test.ts`: passed with 2 files and 48 tests after adding integration path coverage.

## Proactive Recommendations / Gemini UX Planning Context

### Current Next-Action And Recommendation Sources

- Individual precheck: `src/modules/rules/precheck.engine.ts` runs deterministic criteria evaluation, readiness scoring, warning aggregation, and `generateNextBestAction` from `src/modules/rules/next-action.generator.ts`.
- `PrecheckService.run` stores `readinessScore`, `missingItemsJson`, and `nextBestAction` in `PrecheckResult`, updates `Application.readinessScore/status`, and writes audit entries.
- `PrecheckService.getLatest` returns the latest `nextBestAction`, missing items, warnings, and `humanConfirmationRequired: true` for frontend use.
- Application DTOs from `ApplicationsService.toApplicationDto` include `latestPrecheckResult`, `latestCascadeReview`, summary counts, review tasks, status, target level, and readiness score.
- Evidence UX status is deterministic in `src/modules/evidences/evidence-ux-status.mapper.ts`, including step, message, severity, progress, badges, and `nextAction`.
- Collective precheck has separate deterministic next actions via `src/modules/collective/collective-next-action.generator.ts`.
- Notifications are durable workflow recommendations in practice: supplement requests, review assignments, result/resolution updates, and deadlines are created through `NotificationsService.create` and returned as `NotificationSummary` with metadata.

### Current Chatbot, Gemini, Smartbot, And SmartUX Architecture

- Chatbot routes are mounted at `/api/chatbot`: `POST /message`, `POST /stream`, and action confirm/execute/cancel endpoints. Routes require auth, role guards, validation, and chatbot rate limiting.
- `ChatbotService.prepareMessage` builds safe user/application/page context, optionally builds dynamic Smartbot prompts, classifies intent through Gemini when enabled, dispatches deterministic local tools, or forwards to VNPT Smartbot.
- `buildSafeChatbotContext` only selects safe summaries: role, context scope, page, target level, application status, criterion, missing summary, deadline summary, next action, and review task summary. It enforces application owner/workspace access.
- Local chatbot tools in `src/modules/chatbot/tools/*` expose read-safe application, gap, checklist, deadline, evidence-card, matching-hub, officer, manager, committee, and handoff behavior. Tool permission checks are workspace-aware.
- Gemini is infrastructure-level through `src/infrastructure/gemini/gemini.client.ts`. It supports text, JSON, and SSE streaming against `GEMINI_MODEL` with timeout and auth/request/parse error handling.
- `GeminiIntentService` classifies user requests into safe chatbot tool intents; `GeminiResponseService` polishes or streams Vietnamese answers while preserving backend facts and official-result guardrails.
- Smartbot webhook tools are mounted at `/api/smartbot/tools/*` and require `SMARTBOT_WEBHOOK_TOKEN`; read tools need user context to resolve workspace.
- SmartUX routes are mounted at `/api/smartux`, but `SmartUxService` is currently a placeholder that throws `501 NOT_IMPLEMENTED`. Frontend SmartUX SDK tracking is currently the working integration.

### Candidate Backend Integration Points

- Minimal deterministic endpoint: compose current application, evidence count/status, latest precheck, notifications, and review/supplement data into structured recommendations without Gemini.
- Chatbot reuse: call the existing chatbot flow for user-initiated explanations and rich cards; avoid using chat sessions for every passive dashboard render unless product wants conversation history.
- New recommendation module: add `modules/recommendations` with route/controller/service/repository/dto/validation if proactive recommendations become a first-class API.
- Precheck hooks: after `PrecheckService.run`, recommendation data can be derived from the saved result without another LLM call.
- Evidence/job hooks: after upload/indexing job state changes, use deterministic `EvidenceUxStatus.nextAction` for short recommendations.
- Notification hooks: create notifications only for durable workflow events such as supplement deadlines or staff requests, not for transient hints that should disappear after a refetch.
- SmartUX integration: use it for behavior analytics and acceptance/dismissal telemetry only after the placeholder service is implemented or through frontend SDK events.

### Data Privacy Constraints

- Do not send raw OCR text, raw evidence text, file names, signed URLs, identity numbers, email, phone, or student codes to Gemini, Smartbot metadata, SmartUX, logs, or docs.
- Keep recommendation generation server-side and based on IDs plus safe summaries. Existing `llm-safety` helpers and `buildSafeChatbotContext` are the model for LLM inputs.
- Preserve workspace isolation: every recommendation query for non-admin users must use `req.user.workspaceId`, `workspaceFilterFor`, `assertSameWorkspace`, or an existing owner/access helper.
- Recommendations must not create official review decisions, final statuses, or pass/fail conclusions. Continue to include human-confirmation caveats where result/readiness language appears.
- Avoid storing full Gemini/Smartbot raw responses unless explicitly needed and redacted; raw provider logging flags should remain off in normal environments.

### Latency And Cost Risks

- `GEMINI_ENABLED` defaults false; `GEMINI_API_KEY` is required when true, and `GEMINI_TIMEOUT_MS` defaults to 30000 ms. Recommendation APIs must degrade when Gemini is disabled or times out.
- Dashboard/application pages are hot paths. Passive recommendation fetches should be deterministic/cached first and should not trigger Gemini on every page load.
- Chatbot routes are rate-limited and already have streaming/fallback behavior. Reusing them for proactive cards could increase session writes and provider spend.
- Precheck can be sync and frontend may auto-run it after edits; do not chain extra LLM work from every precheck unless explicitly throttled or queued.
- If recommendations become persisted, add idempotency/dedupe keys to avoid repeated records after refetch, upload polling, or job retry.

### Likely API Contract Options

- Deterministic read API:
  `GET /api/recommendations/contextual?surface=overview|application|feedback&applicationId=...`
  returns `{ items, generatedAt, sources }`, where each item has `id`, `priority`, `title`, `description`, `reasonCode`, `source`, `action`, and optional `expiresAt`.
- Chat-compatible API:
  reuse `ChatbotMessageResponseDto` so frontend can render through `SmartbotCardRenderer`; best for user-initiated explanation, less ideal for passive caching.
- Notification-backed API:
  extend notification metadata with safe recommendation CTA data for durable supplement/deadline/result items.
- Hybrid API:
  return deterministic recommendations first, then support `POST /api/recommendations/:id/explain` to call Gemini only when the user asks for explanation.
- Tracking API:
  if backend SmartUX is implemented, use a small event contract such as `{ eventName, surface, recommendationId, action, resultType, durationMs }`; keep content out of payload.

### Verification Commands

- `npm run build`
- `npm run lint`
- `npx prisma validate`
- Focused tests for likely touchpoints:
  `npx vitest run tests/unit/chatbot-action-service.test.ts tests/unit/chatbot-tool-registry.test.ts tests/unit/chatbot-service.test.ts tests/unit/chatbot-stream-service.test.ts tests/unit/rules-engine.test.ts tests/unit/evidence-ocr-pipeline.test.ts`
- Workspace isolation if adding recommendation reads:
  `npx vitest run tests/integration/workspace-isolation-flow.test.ts` after a disposable local PostgreSQL test DB is available.
- Source inspection:
  `rg -n "nextBestAction|buildSafeChatbotContext|Gemini|SmartUxService|NotificationType|EvidenceUxStatus" src`

### Open Questions

- Should proactive recommendations be a new backend module or composed in existing application/precheck/chatbot endpoints?
- Should Gemini produce only optional explanations, or should it rank/rewrite visible recommendation cards?
- What recommendation events are durable enough to persist versus transient enough to compute per request?
- What API freshness is required after upload, precheck, notification read, supplement request, and job completion?
- Should SmartUX analytics be ingested by backend `/api/smartux`, frontend SDK only, or both?
- Do manager/officer/committee proactive recommendations belong in this phase, or is MVP student-only?

## Final Requirement-Flow Stabilization On 2026-07-17

- Audit classification:
  - Keep for compatibility: Prisma `readinessScore`/`nextBestAction` columns, export/manager/collective/cascade views, smartbot hooks, legacy rules-engine tests, and OCR field extraction names such as `volunteerDays`, `conductScore`, and `languageScore`.
  - Completion-engine callers: individual `PrecheckService`, submit gate, student overview/action workspace, and structured `getNextActions`.
  - Legacy logic only: old rules-engine `src/modules/rules/precheck.engine.ts`, legacy `volunteerDays` OCR summaries, `foreign_language_score` metrics, and static/mock text. These are not the student completion source of truth.
- Individual precheck now builds from `CriteriaCompletionService` semantics through `buildPrecheckFromCompletion`: requirement groups, satisfied/missing/needs-verification requirements, criterion warnings, structured next action, and `humanConfirmationRequired: true`.
- Precheck next-action priority was corrected: official supplement request, required missing/rejected requirement, needs-verification requirement, untouched required ONE_OF path, failed evidence/job, rerun precheck, then submit.
- Submit gate now blocks processing upload/OCR, auto-runs stale precheck, returns warning summaries, allows explicit warning confirmation, and does not write final result.
- Backfill script added: `npm run backfill:requirements -- -- --dry-run --workspace-code DHBK-DHDN` or direct `npx tsx scripts/backfill-requirement-responses.ts --dry-run --workspace-code DHBK-DHDN`.
  - It links legacy GPA/conduct/physical/language metrics and evidence/event imports into `ApplicationRequirementResponse`, keeps legacy volunteer totals as `needs_verification`, uses `legacy_unclassified` for uncertain evidence, fixes response/file workspace IDs, and avoids logging PII/raw OCR/file URLs.
  - The npm command needs the extra `--` before script args because npm treats `--dry-run` specially.
- OpenAPI precheck docs now show requirement-based criterion result, missing requirement, and structured next action schemas.
- Verification this pass:
  - `npx prisma validate`: passed.
  - `npm run build`: passed.
  - `npm run lint`: passed with 18 existing warnings.
  - Focused tests passed: `npx vitest run tests/unit/criteria-completion.test.ts tests/unit/precheck-completion.test.ts tests/unit/rules-engine.test.ts` (51 tests).
  - `npx prisma generate`: blocked by Windows EPERM rename on `node_modules/.prisma/client/query_engine-windows.dll.node`.
  - Backfill dry-run was attempted but local DB did not respond before timeout; no production/remote DB was targeted intentionally.

## Context Refresh On 2026-07-18

- Current source of truth for individual student flow is the Requirement Tree + Criteria Completion Engine + requirement-based Precheck integration, not legacy readiness/evidence-count scoring.
- Backend implementation entry points:
  - Requirement completion: `src/modules/criteria-completion/*`.
  - Precheck integration: `src/modules/precheck/precheck.service.ts`, especially `buildPrecheckFromCompletion`.
  - Submit gate: `src/modules/applications/applications.service.ts`.
  - Backfill: `scripts/backfill-requirement-responses.ts`.
- Compatibility that must remain until a separate cleanup pass: Prisma readiness fields, legacy metrics routes, old rules/cascade/collective scoring, export/manager readiness display, smartbot hooks, OCR field aliases.
- Before starting UI refactor, still recommended:
  - Run backfill dry-run against a responsive local PostgreSQL instance.
  - Resolve or retry `npx prisma generate` after releasing Windows file locks.
  - Run browser smoke on `/app/application` desktop/mobile after starting the dev server.

## Endpoint/E2E Verification On 2026-07-18

- Non-AI individual application end-to-end flow was revalidated successfully:
  `vitest run tests/integration/non-ai-application-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`.
  It covers start/draft, evidence create/upload/list, submit blocked while upload/OCR is processing, submit with warnings, manager application/workload views, officer review decisions for all five criteria, aggregation, finalization, notification, and timeline.
- Workspace isolation was revalidated successfully:
  `vitest run tests/integration/workspace-isolation-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`.
  It covers application/manager views, evidence/file access, review/resolution flows, event registry/decision imports, knowledge base/evidence matching/criteria selection, jobs, audit/chatbot/export boundaries, and explicit global admin behavior.
- Real fixes from this verification:
  - `AuditService` now creates audit logs with `workspace: { connect: ... }` instead of the rejected checked-input scalar `workspaceId`, preventing Prisma runtime errors during upload/submit/audit paths.
  - `ResolutionService.resolveCase` now calls `assertCanViewCase` before closing a resolution case, blocking manager/committee users from deciding cases in another workspace.
- Integration test contracts were updated for current API shape:
  - `POST /api/applications/current/start`, precheck, and cascade-review return `201`.
  - paginated/enveloped endpoints use `data.items` where applicable.
  - review acceptance requires `officerSuggestedLevel`.
  - submit gate correctly returns `APPLICATION_NOT_READY` while evidence upload/OCR is still processing.
- Verification after the fixes:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: passed after stopping backend dev watch that held the Prisma engine DLL.
  - `npm run build`: passed.
  - `npm run lint`: passed with 18 existing warnings.
  - Focused unit tests passed: `criteria-completion`, `precheck-completion`, `admin-workspaces.routes`, and `admin-workspaces.service` (69 tests).

## Criteria Completion Post-Implementation Audit On 2026-07-18

- Full audit note added at `docs/criteria-completion-post-implementation-audit.md`.
- Backend API smoke against `http://127.0.0.1:8080` passed for auth login, current application, criteria completion, timeline, and student role-blocking on ethics no-violation confirmation (`403`).
- Latest focused backend unit suite passed: 11 files, 92 tests, including criteria completion, precheck completion, metric helpers, evidence student status, review/manager/rules, auth workspace, and admin workspace tests.
- Current configured database migration status is up to date, but it points to a remote Supabase pooler. No non-dry-run backfill was executed during this audit.
- Fixed during audit: `official_match_not_found` warning label compatibility in `src/shared/dto/evidence-student-status.ts`.
- Open release blockers are not in backend completion core: frontend Nitro/Vercel packaging still fails on `@vercel/nft`/`nf3`, and authenticated browser smoke was not completed because in-app browser login did not transition after submit.

## Criteria Completion Business Flow Acceptance On 2026-07-18

- Contract freeze added at `docs/criteria-completion-contract-freeze.md`.
- Acceptance report added at `docs/criteria-completion-business-flow-acceptance.md`.
- Static/source contract check confirms completion/precheck is the business source of truth, while `readinessScore` and `nextBestAction` remain compatibility fields.
- Verification in this pass:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: passed after stopping backend dev watch that held the Prisma engine DLL; first attempt hit Windows `EPERM` rename.
  - `npm run build`: passed.
  - `npm run lint`: passed with 18 warnings.
  - Focused unit suite passed: 6 files, 76 tests, plus `auth-middleware-workspace` 1 file and 3 tests.
- Local fixture/integration/browser acceptance is blocked in this pass because `127.0.0.1:5432` is not listening and Docker is not installed. No remote production/Supabase DB was used.
- Backend dev server was restored on `127.0.0.1:8080` after verification.

## Browser/API End-To-End Pass On 2026-07-18

- Test account used: `vanngocnhuy30032006+test12@gmail.com`; application id `4117b60b-d6ac-4a3c-9a70-4941bab06751`.
- Signup, current application lookup, criteria-completion, precheck, submit with warnings, officer confirmation, review tasks, supplement, resolution, aggregation, finalization, notification, and mail outbox were exercised against the configured Supabase dev database through local backend `127.0.0.1:8080`.
- Flow result:
  - Student application was created and submitted.
  - Student cannot self-verify ethics `no_violation` (`403` as expected).
  - Officer/system confirmations for ethics `no_violation` and academic `no_f_grade` work.
  - Five review tasks were created. Auto-assignment routed ethics/academic/volunteer to the generic multi-specialized `officer@dut.udn.vn`, physical to `officer.physical@dut.udn.vn`, and integration to `officer.integration@dut.udn.vn`.
  - Physical supplement request worked; student added physical evidence on the same application and resubmitted without creating a new application.
  - Volunteer resolution case was created, resolved by committee, and the task became `accepted`.
  - After all five tasks were accepted, manager aggregation and finalization completed; student sees `status=completed`, `finalStatus=passed`, `finalLevel=school`.
- Mail check: 4 `EmailOutbox` rows for this application were `sent` with provider message ids and no last error: `application_submitted`, `supplement_requested`, `application_resubmitted`, and `application_result_announced`.
- Fixes from this pass:
  - Added faculty normalization in `src/shared/utils/faculty.ts` and used it in precheck/review assignment/manager specialization checks so free-text student faculty values such as `Công nghệ thông tin` match seeded scopes like `Khoa Công nghệ Thông tin`.
  - Precheck one-of groups no longer mark unselected alternatives missing once a valid path has data.
  - Precheck needs-verification next actions now use requirement-specific labels such as `Tải bảng điểm rèn luyện để xác minh`.
  - Completion pending requirement selection now prioritizes `needs_verification` before `declared`.
  - Manager finalize no longer treats aggregation-only `completed` with `finalStatus=pending` and `finalizedAt=null` as already finalized.
  - Finalization records legacy cascade mismatch audit but allows finalization when all review tasks are human-accepted and no resolution case remains open.
- Verification after fixes:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: passed after stopping backend dev watch that held the Windows Prisma engine DLL.
  - `npm run build`: passed.
  - `npm run lint`: passed with 18 existing warnings.
  - Focused unit tests passed: `npx vitest run tests/unit/faculty-utils.test.ts tests/unit/criteria-completion.test.ts tests/unit/precheck-completion.test.ts` (51 tests).
  - `tests/integration/non-ai-application-flow.test.ts` was invoked in the current shell but failed because local PostgreSQL at `localhost:5432` was unreachable.
- Browser smoke:
  - Student signup/login/application page rendered without route crash.
  - Final student page showed `Đã có kết quả` and `5/5 tiêu chí sẵn sàng kiểm tra`, with no AI confidence text and no document-level horizontal overflow in the in-app Browser viewport.
  - Officer/committee browser role switching could not be completed in the same in-app Browser session because the session remained authenticated as the student; role flows were verified by API instead.
- UX notes for the upcoming UI refactor:
  - Overview/application content is still card-heavy and dense.
  - Student application page can show `Đã xác nhận` while also showing completion metadata such as `1 mục cần xác minh`, which is confusing after human review has accepted a task.
  - Volunteer can show `0/4 điều kiện có dữ liệu` even after human/committee acceptance because that count is raw requirement data, not final review status.
  - Login/role switching is awkward during testing once a session is active; the mobile shell snapshot did not expose logout in the visible application workspace.
  - External SmartUX/Statsig console noise appears in the in-app Browser but did not crash the app.

## Evidence Repository Planning Context

This section captures planning context for "Kho minh chứng" / Evidence Repository work as of 2026-07-18. No implementation has been done in this pass.

### Current Evidence Data Model And File Storage Model

- Prisma models involved: `Evidence`, `EvidenceCard`, `EvidenceFile`, `File`, `Application`, `ApplicationRequirementResponse`, `EventRegistry`, `EventParticipant`, `EventFile`, `DecisionImport`, `KnowledgeBaseItem`, `IndexingJob`, `SmartReaderJob`, and collective evidence/profile models.
- `Evidence` is not currently a standalone repository object. It is linked to one `Application` or one `CollectiveProfile` through nullable parent IDs and has `evidenceName`, `criterion`, `sourceType`, optional `eventId`, `status`, `indexingStatus`, optional `confidence`, and optional `assignedOfficerId`.
- `EvidenceSourceType` values are `metric_input`, `event_import`, `manual_upload`, and `collective_import`; there is no repository/library source type today.
- `EvidenceCard` is one-to-one with `Evidence` and stores OCR text/detail JSON, extracted and normalized fields, warnings, matched event/participant IDs, matched knowledge item IDs, confidence, SmartReader metadata, AI summary, and optional raw provider response.
- `EvidenceFile` connects evidence rows to `File` records with `fileRole`. There is no repository file/link table.
- `File` stores nullable `workspaceId`, owner/uploader IDs, storage type, object key, optional public URL, original name, MIME type, size, and VNPT upload hash/type metadata.
- Manual application uploads use object keys shaped like `applications/{applicationId}/evidences/{evidenceId}/{timestamp}-{safeName}`. Decision-import files use `decision-imports/{decisionImportId}/...`; event roster files use `event-rosters/{eventId}` in the local storage path.
- `ApplicationRequirementResponse` can point to `evidenceId` and `metricId`, but current validation requires evidence to belong to the target application.
- `EventRegistry` plus `EventParticipant` is the current official/reusable roster source. `DecisionImport.confirm` creates or updates active event registry records and participants from approved decision documents.
- `KnowledgeBaseItem` is a separate reviewed-evidence reference store. It is workspace-scoped and searchable, but it does not provide application attach/reuse of source evidence files.

### Current Upload, Indexing, And Card Pipeline

- Evidence routes are in `src/modules/evidences/evidences.routes.ts` and cover application evidence list/create, file upload, indexing start, evidence detail, card, audit, update, and delete.
- `EvidencesService.create` requires `sourceType=manual_upload`, creates an application evidence row in draft/not_started state, optionally creates a manual `EvidenceCard` for metadata/description, and writes application audit logs.
- `EvidencesService.uploadFile` validates role/workflow editability, MIME type, and size; stores the object through `StorageService`; creates `File` and `EvidenceFile`; marks manual evidence as `pending_indexing`; creates or reuses an `IndexingJob` for `evidence_ocr`; and writes file/OCR audit entries.
- `EvidencesService.startIndexing` enqueues an evidence OCR job through `JobsService` and moves evidence to `pending_indexing`.
- `processEvidenceOcrJob` loads the evidence, primary file, parent application/collective workspace, creates `SmartReaderJob`, uploads/reuses VNPT file hash, runs OCR, normalizes OCR output, extracts fields, normalizes fields, matches event registry entries in the same workspace, scores confidence, upserts `EvidenceCard`, updates `Evidence` status/indexing status, and audits SmartReader/card/matching/missing-info/manual-review outcomes.
- `EvidencesService.getCard` returns student-safe card fields by default and only exposes raw OCR/provider/internal confidence details to privileged roles.
- File signed URLs are handled by `FilesService.getSignedUrl` and `StorageService.getSignedReadUrl`, with owner/workspace/officer access checks.

### Current Approved Evidence And Event Library Behavior

- `EventRegistryService.search` delegates to `EvidenceMatchingService.search`.
- `EvidenceMatchingService.search` is workspace-scoped via `workspaceFilterFor(user)`, only considers active roster-indexed events, resolves the target student from user/query/application, blocks students from searching another student's name/code, ranks candidates, and returns participant match, student/matching statuses, `importable`, and `alreadyImported`.
- `EventRegistryService.importAsEvidence` and the evidence-matching import route call `importEventAsEvidence` from `src/modules/decision-imports/decision-imports.service.ts`.
- `importEventAsEvidence` loads the target application, asserts same workspace, checks student ownership/editability for student callers, loads an active same-workspace event, resolves participant by ID/name/code, requires confirmed participation, prevents duplicate event imports per application, then creates a new application-owned evidence/card from official roster data.
- Official imports currently produce `Evidence.sourceType=event_import`, `status=under_review`, `indexingStatus=indexed`, `confidence=0.96`, no attached files, and an `EvidenceCard` with extracted official matching fields.
- Decision imports become reusable only through event registry confirmation. `DecisionImportsService.confirm` creates/updates `EventRegistry`, links the source file via `EventFile`, and creates `EventParticipant` rows from accepted preview rows.
- Knowledge-base reviewed evidence is separate: `KnowledgeBaseService.createFromReviewedEvidence` can create anonymized workspace-scoped reference cases from reviewed evidence, and `search/use` provide reference lookup/usage count only.

### How Evidence Is Linked To Application, User, And Workspace

- Applications have required `workspaceId` and `studentId`; evidence links to applications through `Evidence.applicationId`.
- Files created from evidence upload inherit the parent application workspace and uploader/owner IDs.
- Indexing jobs and SmartReader jobs inherit the resolved parent workspace.
- Requirement responses link an application requirement to an evidence/metric and carry their own `workspaceId`.
- Review task evidence links (`ReviewTaskEvidence`) connect task decisions to application evidence. Submit creates tasks and links evidence by criterion.
- Current workspace security is application-code enforced. Evidence list/detail/card paths assert parent application workspace for non-admin users; file signed URL access is owner, staff-workspace, or assigned-officer/specialization scoped.
- Frontend must not send `X-Workspace-Id`; backend derives workspace from authenticated user.

### Current Search, Filter, And Reuse Capabilities

- Evidence list supports `criterion`, `status`, `indexingStatus`, `page`, and `limit` for one application.
- Evidence matching search supports query, criterion, student name/code, application-derived target identity, page, limit, and optional audit tracking.
- Event registry list/search and participant check support official event lookup but are not a general uploaded-evidence repository.
- Knowledge base search supports query, criterion, level, decision, sourceType filtering, pagination, and student anonymization.
- File preview/download is signed-URL based per file; no repository browse/download API exists.
- Current reuse semantics are limited to creating a new application evidence from a matched official event participant. Uploaded manual evidence is not reusable across applications.

### Gaps For A Reusable Evidence Repository

- No standalone repository model, repository item lifecycle, repository-file link table, attach/detach table, or repository visibility policy exists.
- `Evidence` lacks direct `workspaceId`, repository owner/visibility fields, validity period, school-year scope, tags, revocation state, dedupe hash, canonical file hash, or immutable snapshot metadata.
- Storage keys are application-centric, which makes copy-vs-reference semantics a core design decision.
- Requirement response validation currently rejects evidence not linked to the same application; reusable evidence would need either application-owned snapshots or new repository attachment validation.
- Review decisions currently belong to application review tasks, not globally accepted repository evidence.
- Event imports are duplicate-protected by application/event, but no generalized dedupe/attach behavior exists for manual uploads or knowledge-base cases.
- Knowledge base references are anonymized and text-oriented; they do not expose source file preview or create application evidence.
- OCR/indexing jobs target a single evidence ID. If a repository artifact is reused, card generation and job retry semantics must define whether OCR/card data is shared or copied.
- Auditing does not yet distinguish repository item creation, reuse/attach, detach, revocation, copy, or snapshot events.

### Likely Backend Modules And Files Affected

- `prisma/schema.prisma` and migrations for any new repository/link/snapshot fields.
- `src/modules/evidences/*` for repository list/detail/create/upload/attach/reuse APIs and DTOs.
- `src/modules/files/*` and `src/modules/storage/*` for repository-file signed URL and object ownership semantics.
- `src/modules/jobs/*` and `src/modules/jobs/processors/evidence-ocr.processor.ts` for repository-indexed evidence or shared card reuse.
- `src/modules/event-registry/*`, `src/modules/evidence-matching/*`, and `src/modules/decision-imports/*` if approved rosters become first-class repository items.
- `src/modules/criteria-completion/*` because requirement responses currently require application-owned evidence.
- `src/modules/applications/*` for submit gate, task creation, supplement resubmission, and application DTOs if repository attachments appear in application state.
- `src/modules/review/*`, `src/modules/manager/*`, and `src/modules/resolution/*` for review decisions and reused evidence status semantics.
- `src/modules/knowledge-base/*` if reviewed cases and repository evidence are merged or cross-linked.
- `src/shared/utils/workspace-scope.ts`, audit service paths, Swagger docs, and tests around workspace isolation/evidence matching/files.

### Likely Frontend Modules And Files Affected

- Frontend repo: `D:\02_PROJECTS\5TOT\namtot`.
- Evidence API/hooks/types: `src/features/evidence/api/evidence.ts`, `src/features/evidence/hooks/useEvidence.ts`, `src/types/evidence.ts`, and likely new repository-specific query keys/types.
- Evidence UI: `AddEvidenceDrawer`, `StudentEvidenceCard`, `EvidenceDetailModal`, `EvidenceCardPanel`, `EvidenceFilePreview`, `EvidenceWorkspace`, and `EvidenceSearch`.
- Student application surface: `src/features/application/components/StudentApplicationActionWorkspace.tsx`, because it is now the primary student workspace and embeds add/search/view evidence behavior.
- Approved/event UI: `ApprovedEvidencePage`, `ApprovedEvidenceFilters`, `ApprovedEvidenceCard`, `ImportEvidenceModal`, `EventLibrary`, and event API/hooks.
- Decision import UI if confirmed rosters become repository sources: `src/features/decision-import/*`.
- Routes/navigation: `/app/application`, `/app/event-library`, `/app/evidence-search`, legacy `/app/upload`, and current `/app/evidence` redirect.
- Reusable list/filter patterns: review task table/filters, decision import list, workspace table, and approved evidence filters.

### Workspace And Security Risks

- Repository browse and signed URL access must not expose another student's private files or OCR text. Workspace scope alone is insufficient for private student evidence.
- If repository evidence can be staff/workspace-visible, define explicit visibility transitions and who may approve/publish/revoke.
- If a repository item references an official event participant, attach must re-check that the target application student is the matched participant.
- Cross-year reuse risks stale/expired evidence. Validity windows, school year, issue date, criteria version, and target level need explicit semantics.
- Shared evidence review state can create accidental global pass/fail implications. Human decisions should remain application/task-scoped unless product explicitly defines global verified repository status.
- File object keys, original file names, OCR text, and provider raw responses may contain PII and should not be exposed through public repository views, SmartUX, Gemini, Smartbot metadata, or logs.
- Manager/officer/committee roles should remain workspace-limited; admin global access should remain explicit and tested.
- Cache invalidation must account for application, evidence list, criteria completion, precheck, repository search, and file/card queries after attach/detach/revoke.

### UI Constraints From UI_GUIDE.md

- Keep repository screens quiet, dense, operational, and workflow-focused. Avoid marketing heroes, decorative gradients/orbs, oversized panels, heavy borders, or a new visual language.
- Reuse existing frontend shell/layout, `Button`, shadcn/Radix primitives, `ui-kit`, `StatusBadge`, `InlineAlert`, `SectionCard`, `UxStatusCard`, and lucide-react icons.
- Use compact filters/search/selects/tabs and dense table/list patterns for repository browsing. Keep tables horizontally scrollable on mobile.
- Cards should be compact repeated items, not page wrappers. Avoid nested cards.
- Use Vietnamese operational copy with short mobile-safe action labels.
- Do not present SmartReader/AI confidence or model/provider diagnostics as official decisions.
- Verify desktop/mobile overflow, clipped text, overlapping controls, and image/PDF preview containment.

### Verification Commands

- Backend:
  - `npm run build`
  - `npm run lint`
  - `npx prisma validate`
  - `npx prisma generate` after Prisma schema/client changes
  - Focused evidence/matching tests: `npx vitest run tests/unit/evidence-ocr-pipeline.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/evidence-student-status.test.ts`
  - Workspace isolation after repository read/attach changes: `npx vitest run tests/integration/workspace-isolation-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`
  - Application flow after attach/reuse changes: `npx vitest run tests/integration/non-ai-application-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`
- Frontend:
  - `npm run lint`
  - `npm run build`
  - Focused inspection: `rg -n "AddEvidenceDrawer|EvidenceDetailModal|StudentEvidenceCard|ApprovedEvidence|useApprovedEvidenceSearch|useEvidences|getSignedFileUrl" src`

### Open Questions

- Is "Kho minh chứng" a private student repository, workspace-approved official evidence repository, staff-reviewed case library, or a unified surface over all of these?
- Should attaching from the repository create a copied application evidence snapshot, link the original repository item by reference, or support both?
- What visibility levels are required: private owner, target application reviewers, workspace students, workspace staff, committee, admin, or public official references?
- Does a prior accepted review decision carry forward, or must every application/review task independently verify reused evidence?
- How should validity/expiry be represented by school year, issue date, criteria version, target level, and organizer level?
- Should decision-import confirmed rosters automatically publish repository items, or continue to create application evidence only when a student imports an event?
- Should Knowledge Base remain text/anonymized guidance or become linked to repository evidence/files?
- What dedupe policy should be used: storage hash, VNPT hash, event/participant key, normalized OCR fields, or staff merge?
- What audit trail is required for repository create, publish, attach, detach, copy, revoke, and source correction?
- Which frontend MVP surface should come first: attach-from-repository inside `/app/application`, standalone `/app/evidence-search`, staff repository management, or expanding `/app/event-library`?

## Evidence Repository Backend Implementation Update

This section reflects the additive backend implementation for the MVP "Kho minh chứng / Kho sự kiện chính thức" official-event library.

### Student Official Event Library

- New endpoint: `GET /api/evidence-matching/library`.
- Route is student-only through `requireAuth` and `requireRole(Role.student)`.
- Query contract:
  - `applicationId` required UUID.
  - `search` optional trimmed string.
  - `criterion` optional `Criterion`.
  - `page` default `1`.
  - `limit` default `20`, max `50`.
- Response data shape:
  - `items[]` with `eventId`, `title`, `organizer`, `organizerLevel`, `criterion`, and `state`.
  - `state` is `available` or `already_imported`.
  - Top-level pagination fields are `page`, `limit`, `total`, and `totalPages`.
- Student DTO intentionally omits participant IDs/lists, student identity, file IDs, signed URLs, original file names, `EventFile`, Decision Import preview, OCR, extracted fields, confidence, raw provider response, internal diagnostics, and staff identity.
- Implementation lives in `src/modules/evidence-matching/evidence-matching.service.ts`, DTO mapping in `src/modules/evidence-matching/evidence-matching.dto.ts`, validation in `src/modules/evidence-matching/evidence-matching.validation.ts`, controller/route wiring in the same module.
- The service loads the application once, enforces same workspace and application owner, queries only active roster-indexed events in that application workspace, applies title/organizer search and criterion filter in Prisma, paginates in the database, and derives `already_imported` with a single `Evidence` query over returned event IDs.
- The endpoint does not participant-match each listed event and does not create evidence in `GET`.
- Existing `/api/evidence-matching/search` and import endpoints remain unchanged.

### Staff Event Workspace Read API

- New endpoint: `GET /api/events/:eventId/staff-workspace`.
- Route allows `officer`, `manager`, `committee`, and `admin`; students and class representatives are forbidden.
- Implementation lives in `EventRegistryService.getStaffWorkspace`, with read-model mapping in `src/modules/event-registry/event-registry.dto.ts` and repository include in `src/modules/event-registry/event-registry.repository.ts`.
- The service asserts same workspace for non-admin staff through existing `assertSameWorkspace`; admin keeps existing global behavior.
- Response includes:
  - event summary: id, name, organizer, organizer level, criterion, status, rosterIndexed, participantCount, converted value/unit, updatedAt.
  - file metadata only: id, originalName, mimeType, size, role.
  - source summary: decisionImportId and decisionNumber.
  - index summary: status and row counts derived from the latest completed roster indexing preview when available.
- The staff DTO does not embed signed URLs, raw OCR, raw provider response, full participant list, applicant evidence, file path, public URL, or unrelated identities.
- Participants continue to be fetched through the existing paginated `GET /api/events/:id/participants` endpoint.
- Signed URLs continue to be requested only through the existing FilesService endpoint; no file guard was loosened.

### Unchanged Areas

- No Prisma schema or migration changes.
- No global auth/workspace architecture changes.
- No workspace header/query support was added.
- No upload/storage adapter changes.
- No OCR, SmartReader, indexing worker, or Decision Import confirm behavior changes.
- No application submit/review/resolution/finalization changes.
- Existing official event import continues to reuse `importEventAsEvidence`, creating application-owned `Evidence` with `sourceType=event_import` and idempotent duplicate handling by application/event.

### Swagger And Tests

- Swagger in `src/docs/openapi.ts` documents:
  - `GET /api/evidence-matching/library`.
  - `GET /api/events/{eventId}/staff-workspace`.
  - Student compact item/response schemas.
  - Staff event workspace response schema.
- Added focused tests:
  - `tests/unit/evidence-matching.service.test.ts` now covers compact library filtering, already-imported state, no sensitive DTO fields, application ownership, and student-only access.
  - `tests/unit/event-registry.service.test.ts` covers staff workspace DTO privacy, student denial, and cross-workspace denial.

### Verification Results

- `npx prisma validate`: passed.
- `npm run build`: passed.
- `npm run lint`: passed with 18 existing warnings in unrelated files (`seed-person2-demo`, knowledge-base, notifications DTO, review task detail tests).
- `npx vitest run tests/unit/evidence-matching.service.test.ts tests/unit/event-registry.service.test.ts tests/unit/official-import-name-match.test.ts tests/unit/evidence-registry-matcher.test.ts`: passed, 4 files and 19 tests.
- `npx vitest run tests/integration/workspace-isolation-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`: blocked by local PostgreSQL unavailable at `localhost:5432`; the suite failed during fixture seeding before assertions.

## Evidence Repository Hardening And Acceptance Update

This section reflects the hardening pass for "Kho minh chứng / Kho sự kiện chính thức" on 2026-07-18.

- Prisma schema was not changed and no migration/backfill was added.
- OCR/upload/indexing behavior was not changed.
- Decision Import confirm/import behavior was not changed.
- Application submit, review tasks, supplement/resubmit, resolution, and finalization behavior were not changed.
- Auth/workspace architecture was not changed. The frontend/backend still do not use `X-Workspace-Id` or protected workspace query parameters.
- Security review confirmed the student compact endpoint `GET /api/evidence-matching/library`:
  - is student-only through route guard;
  - requires `applicationId`;
  - loads the application server-side;
  - enforces same workspace and application ownership;
  - uses only active roster-indexed events in the application workspace;
  - returns only `eventId`, title, organizer, organizer level, criterion, and `available` / `already_imported` state;
  - does not return file IDs, signed URLs, participant rows, student identity, OCR/provider/internal data, or staff identities.
- Security review confirmed official event import still goes through existing `importEventAsEvidence`, preserving authenticated identity, application ownership, same-workspace event/application checks, participation checks, and duplicate protection.
- Security review confirmed staff workspace `GET /api/events/:eventId/staff-workspace`:
  - allows officer/manager/committee/admin read access through route guard;
  - denies student/class representative access;
  - asserts same workspace for non-admin users;
  - returns staff-safe file metadata only, not signed URLs, raw OCR/provider data, file paths, embedded participant rows, or unrelated identities.
- Hardening fix added for staff source-file preview:
  - `FilesRepository.findById` now includes event source-file relations needed for authorization checks: `eventFiles.event.workspaceId`, `decisionImports.workspaceId`, and `sampleCertificateEvents.workspaceId`.
  - `FilesService.getSignedUrl` now lets an officer open a signed URL only when the target file is an official event source/decision/sample-certificate file in that officer's workspace.
  - Student access and cross-workspace officer access still return not-found.
  - This is a shared `FilesService` change, but the permission expansion is constrained to event-source file relations and covered by `tests/unit/files.service.test.ts`.
- Verification on 2026-07-18:
  - `npx prisma validate`: passed.
  - `npm run build`: passed after hardening fix.
  - `npm run lint`: passed with the same 18 pre-existing warnings in unrelated files.
  - `npx eslint src/modules/files/files.repository.ts src/modules/files/files.service.ts tests/unit/files.service.test.ts`: passed.
  - `npx vitest run tests/unit/files.service.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/event-registry.service.test.ts tests/unit/official-import-name-match.test.ts tests/unit/evidence-registry-matcher.test.ts`: passed, 5 files and 22 tests.
  - Required focused batch `npx vitest run tests/unit/evidence-ocr-pipeline.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/evidence-student-status.test.ts tests/unit/event-registry.service.test.ts`: failed only in the pre-existing OCR transcript faculty extraction assertion in `tests/unit/evidence-ocr-pipeline.test.ts`; the other files passed.
  - `npx vitest run tests/integration/workspace-isolation-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`: blocked by local PostgreSQL unavailable at `localhost:5432`; seeding failed before assertions.
  - `npx vitest run tests/integration/non-ai-application-flow.test.ts --maxWorkers=1 --testTimeout 300000 --hookTimeout 60000`: blocked by local PostgreSQL unavailable at `localhost:5432`; setup failed before assertions.
- Browser/API acceptance was not claimed in this pass because clean authenticated student/staff sessions and an available integration database fixture were not available locally.

## Student Evidence Knowledge Search Foundation Patch On 2026-07-19

- `GET /api/evidence-matching/library` remains the existing student-only endpoint in `src/modules/evidence-matching/evidence-matching.routes.ts`; no new route, schema, migration, or duplicate event domain was added.
- `src/modules/evidence-matching/evidence-matching.validation.ts` adds an optional `projection` query value. The default `full` projection preserves the existing response shape; `reference` returns the strict student reference DTO.
- `src/modules/evidence-matching/evidence-matching.dto.ts` adds `StudentReferenceEventLibraryItemDto`, limited to `{ eventId, title }`.
- `src/modules/evidence-matching/evidence-matching.service.ts` keeps the existing application ownership, workspace isolation, active roster-indexed event source, and student-only route guard. When `search` is present, it ranks scoped `EventRegistry` candidates in memory with Vietnamese Unicode normalization, lowercase/no-accent keys, punctuation/whitespace cleanup, verified abbreviations and aliases (`MHX`, `CD MHX`, `NCKH`, `hien mau`), acronym matching, token/organizer/year scoring, and bounded typo tolerance.
- Student `projection=reference` results are deduplicated by normalized canonical event title within criterion, so aliases resolve to one displayed reference event and do not create duplicate event records.
- Evidence status behavior is unchanged: this endpoint still reads the official active roster-indexed Event Registry library and the application's existing evidence state only to compute the legacy full projection's import state; rejected, supplement, pending, and failed evidence are not indexed into a separate approved-evidence store by this patch.
- Verification on 2026-07-19:
  - `npx vitest run tests/unit/evidence-matching.service.test.ts`: passed, 11/11 tests.
  - The focused test covers `Mùa hè xanh 2025`, `mua he xanh 2025`, `MHX 2025`, `CD MHX`, and `mua he xnah` resolving to one reference event while the serialized student projection excludes organizer, criterion, state, files, OCR, reviewer, confidence, and accepted-count fields.
  - `npm run build`: passed.
  - `npm run lint`: passed with 18 pre-existing warnings in unrelated files.

## Officer Approved Evidence Knowledge Backend On 2026-07-19

- Added additive Evidence Knowledge V2 persistence without duplicating the Event Registry or Evidence domains:
  - `EventRegistryAlias` stores verified aliases/acronyms/abbreviations linked to existing `EventRegistry`.
  - `WorkspaceAbbreviation` stores workspace-local abbreviation expansions.
  - `ApprovedEvidencePrecedent` stores approved-only evidence precedents linked to `Workspace`, `EventRegistry`, `Evidence`, optional `EvidenceCard`, optional `ReviewTask`, optional `ResolutionCase`, optional preview `File`, and optional `CriteriaVersion`.
  - New enums: `ApprovedEvidenceApprovalSource`, `ApprovedEvidencePrecedentStatus`, `EventRegistryAliasType`, and `EventRegistryAliasVerificationSource`.
  - Migration: `prisma/migrations/20260719170000_evidence_knowledge_v2/migration.sql`, including `pgcrypto`, `unaccent`, `pg_trgm`, uniqueness on `sourceEvidenceId`, and search indexes.
- New backend module: `src/modules/evidence-knowledge`.
  - `GET /api/evidence-knowledge/officer/search` returns grouped canonical-event results for officer/manager/committee/admin roles.
  - `GET /api/evidence-knowledge/officer/events/:eventId` returns accepted-only event detail, aliases, approval sources, protected preview file metadata, OCR metadata summary, criteria version, and concise audit summary.
  - Student roles are not allowed on officer endpoints by route guard.
  - Officer access is restricted to active `OfficerSpecialization` criteria within the officer workspace; manager/committee/admin follow existing workspace/admin semantics.
- Search behavior:
  - Uses one normalized search core with Vietnamese Unicode normalization, lowercase/no-accent keys, punctuation/whitespace cleanup, verified aliases/acronyms, workspace abbreviations, organizer/year/criterion terms, OCR search keys, and typo-tolerant matching.
  - Results are grouped by `EventRegistry.id`, never individual files.
  - Match reasons are concise business codes such as `canonical_title`, `verified_alias`, `acronym`, `organizer`, `year`, `ocr`, and `typo`; no confidence percentage is returned.
- Approved indexing:
  - `ReviewService.decideTask` publishes only evidence that is actually set to `EvidenceStatus.accepted` after an explicit officer accepted decision.
  - `ResolutionService.resolveCase` publishes only evidence accepted by Resolution decisions; rejected, supplement-required, and closed-no-action outcomes are not published.
  - Publishing upserts one active `ApprovedEvidencePrecedent` per `sourceEvidenceId`, links or creates a canonical `EventRegistry` only through the existing Event Registry domain, creates verified aliases, stores normalized search keys, and does not copy physical files.
  - Officer accepted evidence without a resolvable existing event link is not auto-promoted to a new canonical event; Resolution accepted evidence may create the canonical event because that is an authorized committee outcome.
- Review precedent operations:
  - `GET /api/review/tasks/:id/precedents/check` reuses `ReviewService` task access guards and returns compact strong precedent matches.
  - `POST /api/review/tasks/:id/decision` accepts optional `precedentId`, `precedentEventId`, and `precedentEvidenceId`; existing response shape is unchanged.
  - Accept-with-precedent remains an explicit accepted decision and writes `REVIEW_ACCEPTED_WITH_PRECEDENT` audit metadata.
  - `POST /api/review/tasks/:id/escalate-resolution` accepts optional `precedentGuardViewed`, `precedentGuardReason`, and `precedentId`; if a viewed precedent id is sent, a concise reason is required.
- Verification on 2026-07-19:
  - `npx prisma validate`: passed.
  - `npx prisma generate --no-engine`: passed; plain `prisma generate` is blocked locally while a running dev server holds the Windows query-engine DLL.
  - `npm run build`: passed.
  - Scoped ESLint for changed files: passed.
  - Full `npm run lint`: passed with the same 18 pre-existing warnings in unrelated files.
  - Targeted tests passed: `npx vitest run tests/unit/evidence-knowledge.service.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/review-task-detail.test.ts tests/unit/review-progress.test.ts`, 6 files and 26 tests.
  - `npx prisma migrate status`: reports the new local migration `20260719170000_evidence_knowledge_v2` is not applied and the connected remote database has historical migration `20260630000100_phase9_collective` missing locally; migration was not applied from this implementation pass.

## Evidence Knowledge Migration Reconciliation On 2026-07-20

- Reconciliation report added at `docs/evidence-knowledge/evidence-knowledge-migration-reconciliation.md`.
- The previously missing local migration `prisma/migrations/20260630000100_phase9_collective/migration.sql` was restored from exact repository history, not reconstructed approximately:
  - added in commit `e46f1ac36c931bb40116dea0dccb8a9c66195126`;
  - deleted in commit `643c497a3ef0fc36cb44e950e306acfa8e2fc5b6`;
  - restored local content was compared against the historical SQL and matched exactly.
- Read-only `npx prisma migrate status --schema prisma/schema.prisma` after restore no longer reports database migration `20260630000100_phase9_collective` as missing locally.
- Current migration status after restore:
  - 15 local migrations;
  - only `20260719170000_evidence_knowledge_v2` remains pending;
  - no migration was applied to the configured Supabase database.
- Evidence Knowledge V2 migration review:
  - additive tables/enums only: `EventRegistryAlias`, `WorkspaceAbbreviation`, `ApprovedEvidencePrecedent`, and related enums;
  - uses existing `Workspace`, `EventRegistry`, `Evidence`, `EvidenceCard`, `ReviewTask`, `ResolutionCase`, `File`, and `CriteriaVersion` domains;
  - no `UPDATE`, `DELETE`, destructive backfill, file copy, or cross-workspace merge SQL;
  - extensions `pgcrypto`, `unaccent`, and `pg_trgm` are guarded with `CREATE EXTENSION IF NOT EXISTS`;
  - normal Prisma single-application sequence is expected, but manually precreated/partially applied enum types need inspection before retry.
- Verification completed:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: passed.
  - `npm run build`: passed.
  - `npm run lint`: passed with the same 18 existing warnings and 0 errors.
  - Focused tests passed: `npx vitest run tests/unit/evidence-knowledge.service.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/review-task-detail.test.ts tests/unit/review-progress.test.ts`, 6 files and 26 tests.
- Deployment readiness remains blocked:
  - applying all migrations from zero on a disposable PostgreSQL database was not completed because local `127.0.0.1:5432` is not listening and neither Docker nor `psql` is installed in this environment.
  - Do not run `prisma migrate dev` or `prisma migrate deploy` against Supabase/shared data until the full local migration chain is verified from zero on disposable PostgreSQL.
- Current status: `MIGRATION_READY_TO_APPLY: NO`.

## Evidence Knowledge Real Browser/API Acceptance Attempt On 2026-07-20

- Real browser/API acceptance was attempted against backend `http://127.0.0.1:8080` after restarting stale repo-specific dev processes.
- No Evidence Knowledge migration was applied during this acceptance pass.
- `npx prisma migrate status --schema prisma/schema.prisma` against the configured Supabase database reported 15 local migrations and one pending migration: `20260719170000_evidence_knowledge_v2`.
- Seeded authentication through the real API succeeded for:
  - `student@dut.udn.vn` as role `student` in workspace `DDK`;
  - `officer.academic@dut.udn.vn` as role `officer` in workspace `DDK`.
- Student reference API verification used application `8d9d6c66-7999-456e-a28c-12d879275030` and `GET /api/evidence-matching/library?projection=reference`.
- Student reference results:
  - `Mùa hè xanh 2025` returned HTTP 200 with one title, `Chương trình Tình nguyện Hè 2025`;
  - `mua he xanh 2025` returned HTTP 200 with the same single title;
  - `MHX 2025` returned HTTP 200 with the same single title;
  - each populated reference result exposed only `eventId` and `title`;
  - `mua he xnah` returned HTTP 200 with zero results, so typo-tolerant matching is not accepted in the live configured database/API state.
- Officer knowledge API verification:
  - `GET /api/evidence-knowledge/officer/search?q=Mùa%20hè%20xanh%202025&limit=10` returned HTTP 500.
  - The error was Prisma P2021 from `src/modules/evidence-knowledge/evidence-knowledge.repository.ts:50` at `this.db.approvedEvidencePrecedent.findMany()`.
  - Root cause in the configured database: table `public.ApprovedEvidencePrecedent` does not exist because `20260719170000_evidence_knowledge_v2` is still pending and was not safely applied.
- Because officer search is unavailable, real acceptance could not complete officer event detail, accepted preview rendering, review precedent panel, accept-with-precedent audit write, pre-resolution guard, Resolution feedback, or full regression flows.
- Only normal login-side effects were created by this pass (`lastLoginAt` updates and refresh tokens). No review decision, Resolution decision, finalization, evidence upload, or supplement mutation was intentionally performed.
- Final module acceptance for this real pass: `FINAL_MODULE_ACCEPTANCE: FAIL`.

## Evidence Knowledge Browser/API Regression Recheck On 2026-07-20

- Re-ran read-only API verification against backend `http://127.0.0.1:8080`; no migration, review decision, Resolution decision, finalization, evidence upload, or supplement mutation was intentionally performed.
- Backend `npm run build` passed before the browser/API pass.
- `npx prisma migrate status --schema prisma/schema.prisma` against the configured Supabase database still reported pending migration `20260719170000_evidence_knowledge_v2`; migration was not applied because the configured database is shared/remote.
- Real seeded login succeeded for:
  - `student@dut.udn.vn`, role `student`, workspace `DDK`;
  - `officer.academic@dut.udn.vn`, role `officer`, workspace `DDK`.
- Student reference API remained safe for application `8d9d6c66-7999-456e-a28c-12d879275030`:
  - `Mùa hè xanh 2025`, `mua he xanh 2025`, and `MHX 2025` returned HTTP 200 with one title, `Chương trình Tình nguyện Hè 2025`;
  - populated reference result fields were only `eventId` and `title`;
  - `mua he xnah` returned HTTP 200 with zero results, so live typo matching is still not accepted.
- Backend authorization remains correct for student access to officer knowledge:
  - student token calling `GET /api/evidence-knowledge/officer/search?q=MHX&limit=5` returned HTTP 403 `FORBIDDEN`.
- Officer knowledge remains blocked:
  - officer token calling `GET /api/evidence-knowledge/officer/search?q=MHX&limit=5` returned HTTP 500 `INTERNAL_SERVER_ERROR`;
  - stack points to `src/modules/evidence-knowledge/evidence-knowledge.repository.ts:50` at `this.db.approvedEvidencePrecedent.findMany()`;
  - root cause remains missing table `public.ApprovedEvidencePrecedent` because `20260719170000_evidence_knowledge_v2` is pending.
- Full Evidence Knowledge E2E, including officer search, accepted preview, review precedent panel, accept-with-precedent audit, pre-resolution guard, Resolution feedback loop, and data-integrity link checks, remains blocked.

## Evidence Knowledge Pending-Migration Fallback On 2026-07-20

- Runtime symptom fixed: `GET /api/evidence-knowledge/officer/search` no longer returns HTTP 500 when the configured database has not applied `20260719170000_evidence_knowledge_v2`.
- `src/modules/evidence-knowledge/evidence-knowledge.repository.ts` now treats Prisma `P2021` for the new Evidence Knowledge tables (`ApprovedEvidencePrecedent`, `WorkspaceAbbreviation`, `EventRegistryAlias`) as pending-schema read fallback:
  - search/detail list reads return `[]`;
  - precedent reference lookup returns `null`;
  - unrelated database errors are still rethrown.
- `src/modules/evidence-knowledge/evidence-knowledge.service.ts` now routes event/evidence precedent reference lookup through the repository instead of directly querying `approvedEvidencePrecedent`, so review precedent checks and accept-with-precedent validation share the same pending-schema behavior.
- No migration was applied and no business data was mutated during this fix.
- Verification:
  - `npx vitest run tests/unit/evidence-knowledge.service.test.ts`: passed, 1 file and 6 tests.
  - `npx prettier --check src/modules/evidence-knowledge/evidence-knowledge.repository.ts src/modules/evidence-knowledge/evidence-knowledge.service.ts tests/unit/evidence-knowledge.service.test.ts`: passed.
  - `npm run build`: passed.
  - Real local API after restarting backend from the patched repo: officer login succeeded and `GET /api/evidence-knowledge/officer/search?q=MHX&limit=5` returned HTTP 200 with `{ items: [], pagination: { page: 1, limit: 5, total: 0, totalPages: 0 } }` instead of HTTP 500.
- Full officer knowledge functionality is still data-blocked until the Evidence Knowledge migration is safely applied; this fallback only prevents a broken UI/error state in environments where the migration is pending.

## Evidence Knowledge Historical Backfill Script On 2026-07-20

- Added `scripts/backfill-approved-evidence-precedents.ts` and npm script `backfill:evidence-knowledge`.
- The script is idempotent and dry-run by default:
  - scans only `Evidence.status = accepted` with an individual `Application`;
  - skips evidence that already has `ApprovedEvidencePrecedent`;
  - classifies Resolution-accepted evidence from resolved `ResolutionCase.committeeDecision`;
  - otherwise classifies officer-accepted evidence from accepted `ReviewTask`;
  - uses the existing `EvidenceKnowledgePublisher` inside transactions for real writes, so canonical event resolution, alias creation, audit logging, preview file linking, OCR metadata and uniqueness behavior stay centralized.
- The script does not index rejected, supplement-required, pending, failed, draft, under-review, or unresolved evidence.
- CLI usage:
  - dry-run all workspaces: `npx tsx scripts/backfill-approved-evidence-precedents.ts`;
  - dry-run one workspace by `Workspace.code`: `npx tsx scripts/backfill-approved-evidence-precedents.ts --code=DHBK-DHDN`;
  - apply one workspace: `npx tsx scripts/backfill-approved-evidence-precedents.ts --code=DHBK-DHDN --apply`.
- Verification:
  - `npx prettier --write package.json scripts/backfill-approved-evidence-precedents.ts`: passed.
  - `npm run build`: passed.
  - Dry-run for `--code=DDK` returned zero because `DDK` is `Workspace.shortName`, not `Workspace.code`.
  - Workspace code lookup showed the DDK school workspace code is `DHBK-DHDN`.
  - Dry-run for `--code=DHBK-DHDN` scanned 91 accepted evidence rows, found 91 candidates, 0 existing precedents, 0 missing approval source, 0 missing actor, and wrote 0 rows because `--apply` was not used.

## Ethics Violation Reviewer-Owned Verification On 2026-07-20

- Business decision implemented: `ethics.no_violation` remains in the requirement tree but is now reviewer-owned, not school-owned or student-owned.
- No Prisma schema or migration was required. The canonical requirement DTO now supports additive optional metadata:
  - `responsibility?: "student" | "system" | "reviewer" | "committee"`;
  - `blocksSubmission?: boolean`;
  - `verificationStage?: "draft" | "precheck" | "review" | "resolution"`.
- Requirement parsing preserves this metadata from explicit criteria config when present. Existing Ethics criteria versions without ownership metadata are normalized so:
  - `conduct_score` is student-owned, `blocksSubmission=true`, `verificationStage="draft"`;
  - `no_violation` is reviewer-owned, `blocksSubmission=false`, `verificationStage="review"`;
  - old/dead-end `wait_system_confirmation` next actions are replaced with reviewer verification wording.
- Completion logic no longer treats unresolved non-blocking reviewer/committee requirements as missing student work or pending student verification. A verified conduct score can make Ethics `ready_for_precheck` while `no_violation` remains `not_started` for review-stage human verification.
- Precheck now filters non-blocking reviewer/committee requirements out of `missingRequirements`, `needsVerification`, global `missingItems`, and student next action generation. Submit gate behavior follows from precheck and no longer blocks on missing `no_violation`.
- A reviewer/officer decision can still verify or reject `no_violation` through the existing staff-only requirement response flow. Student self-verification remains forbidden.
- No roles, workspaces, auth models, route names, school APIs, upload/OCR/event/supplement/resolution/finalization behavior, or workspace isolation rules were changed.
- Verification:
  - `npx prisma validate`: passed.
  - `npx prisma generate`: initially failed with Windows `EPERM` because running backend `tsx watch` processes held Prisma's query engine DLL; after stopping backend watcher processes, passed.
  - `npm run build`: passed.
  - `npm run lint`: passed with pre-existing warnings outside this change (`any` in seed/knowledge-base/review-task-detail files).
  - `npx vitest run tests/unit/criteria-completion.test.ts tests/unit/precheck-completion.test.ts`: passed, 2 files and 50 tests.

## Evidence Knowledge UI Refactor Lock Audit On 2026-07-20

- Documentation-only UI refactor lock was added at `D:\02_PROJECTS\5TOT\docs\evidence-knowledge\EVIDENCE_KNOWLEDGE_UI_REFACTOR_LOCK.md`; no runtime API, service, schema, migration, route, or component code was changed in this audit.
- The root design contract file `D:\02_PROJECTS\5TOT\docs\ui-v2\MANDATORY_DESIGN_SYSTEM_AND_LAYOUT_CONTRACT.md` still contains only the earlier blocking placeholder rather than the complete upstream mandatory design contract.
- Current student reference API facts verified from source:
  - `GET /api/evidence-matching/library` is implemented in `src/modules/evidence-matching/evidence-matching.routes.ts`, `evidence-matching.controller.ts`, `evidence-matching.service.ts`, `evidence-matching.validation.ts`, and `evidence-matching.dto.ts`.
  - The endpoint requires auth, student role, `applicationId`, same workspace, and application ownership.
  - It reads `EventRegistry` rows with `status = active` and `rosterIndexed = true`; it does not read `ApprovedEvidencePrecedent` rows for the student reference projection.
  - `projection=reference` currently returns `StudentReferenceEventLibraryItemDto` with only `eventId` and `title`.
  - Full official-library projection returns `eventId`, `title`, `organizer`, `organizerLevel`, `criterion`, and `state`.
  - Library ranking already has normalized text, abbreviation expansion, acronym scoring, token overlap, fuzzy scoring, and dedupe by normalized title.
- Current officer knowledge API facts verified from source:
  - `src/app.ts` mounts `src/modules/evidence-knowledge/evidence-knowledge.routes.ts` at `/api/evidence-knowledge`.
  - `GET /api/evidence-knowledge/officer/search` and `GET /api/evidence-knowledge/officer/events/:eventId` require role `officer`, `manager`, `committee`, or `admin`.
  - `src/modules/evidence-knowledge/evidence-knowledge.permissions.ts` enforces same-workspace access for non-admin users and active officer specialization for officers.
  - `src/modules/evidence-knowledge/evidence-knowledge.service.ts` groups search results by `eventId` and currently sets `acceptedCount` to `records.length`, which is raw approved-precedent row count rather than distinct approved applications/students.
  - `src/modules/evidence-knowledge/evidence-knowledge.dto.ts` currently exposes officer search fields `eventId`, `canonicalTitle`, `aliases`, `criterion`, `organizer`, `year`, `applicableLevel`, `acceptedCount`, `approvalSources`, `hasResolutionPrecedent`, and `matchReasons`.
  - Officer detail currently exposes canonical metadata, aliases, resolution precedent metadata, accepted evidence, preview file metadata, OCR metadata, criteria version, approval source, audit summary, and created date, but no explicit canonical-vs-extracted conflict list.
- Current review/Resolution precedent API facts verified from source:
  - `src/modules/review/review.validation.ts` accepts optional `precedentEventId`, `precedentEvidenceId`, and `precedentId` on decision; escalation accepts `precedentGuardViewed`, `precedentGuardReason`, and `precedentId`.
  - `src/modules/review/review.service.ts` validates precedent usability, audits accept-with-precedent metadata, publishes officer-accepted evidence through `EvidenceKnowledgePublisher`, and audits Resolution guard metadata.
  - `src/modules/resolution/resolution.service.ts` publishes Resolution-accepted evidence through `EvidenceKnowledgePublisher`.
- UI refactor is locked as not ready because the current backend contract lacks student-safe `criterion` plus distinct `approvedUsageCount`, Add Evidence autocomplete suggestion DTOs, and explicit canonical-vs-extracted conflict DTOs.

## Evidence Knowledge UX Support Implementation On 2026-07-20

- Student reference library support was extended additively in `src/modules/evidence-matching`:
  - `StudentReferenceEventLibraryItemDto` now returns safe fields `eventId`, `title`, `criterion`, and `approvedUsageCount`.
  - `projection=reference` still requires student role, `applicationId`, same workspace, and application ownership.
  - `approvedUsageCount` counts distinct approved applications/students from active `ApprovedEvidencePrecedent` rows and falls back to 0 if the Evidence Knowledge schema is unavailable.
  - No evidence file, OCR, reviewer, audit, Resolution, confidence, or approval-source fields are exposed to the student projection.
- Student Smart Search ranking was strengthened without creating a duplicate event domain:
  - existing Event Registry rows remain the source;
  - normalized no-accent matching now also searches safe title variants such as `tình nguyện hè` <-> `mùa hè xanh` / `chiến dịch mùa hè xanh`;
  - existing alias/acronym/fuzzy helpers now resolve `Mùa hè xanh 2025`, `mua he xanh 2025`, `MHX 2025`, `CD MHX`, and typo `mua he xnah` to the same reference event in the configured data.
- Officer Evidence Knowledge counts were aligned with the UI contract:
  - `src/modules/evidence-knowledge/evidence-knowledge.repository.ts` includes source application/student identifiers for accepted precedents.
  - `src/modules/evidence-knowledge/evidence-knowledge.service.ts` reports `acceptedCount` as distinct approved application/student usage, with fallback row count for older mocks.
- Real API verification against `http://127.0.0.1:8080`:
  - student `GET /api/evidence-matching/library?projection=reference&applicationId=<current>&search=MHX%202025&limit=5` returned fields `approvedUsageCount,criterion,eventId,title` only.
  - student internal-field scan over returned field names was false for OCR/file/reviewer/Resolution/confidence/approval internals.
  - all five required student queries resolved to `Chương trình Tình nguyện Hè 2025`.
  - officer physical search/detail with existing seed returned one accepted precedent and detail fields including protected preview metadata, OCR metadata, approval source, criteria version, and audit summary.
- Verification:
  - `npx prisma validate`: passed.
  - `npx vitest run tests/unit/evidence-knowledge.service.test.ts tests/unit/evidence-matching.service.test.ts`: passed, 2 files and 17 tests.
  - `npx vitest run tests/unit/evidence-matching.service.test.ts`: passed after the search-variant fix, 11 tests.
  - Scoped backend ESLint for touched Evidence Matching/Knowledge files and tests: passed.
  - `npm run build`: passed.
- No Prisma schema, migration, existing submission/review/supplement/Resolution/finalization rule, or existing API response shape was destructively changed. Additive fields were added only to the student reference projection needed by the UI refactor.
- Remaining verification limit:
  - Full accept-with-precedent and pre-resolution mutation E2E was not run against the configured database because it would mutate real review data and no disposable matching fixture was available.

## Phase 1 Security Baseline On 2026-09-23

- `EvidencesService.uploadFile` checks the parent application's workspace before object storage, file/job creation, or upload audit side effects. Student and class-representative uploads still require application ownership; admins retain the shared workspace-helper bypass.
- `ReviewService.ensureReviewTasks` checks application workspace before reading evidence or creating/linking tasks. The officer/manager/admin route allowlist is unchanged.
- `ReviewService.claimTask` checks task workspace before permission evaluation. Claimability remains an unassigned task with an active matching criterion specialization and a non-final status; the atomic `updateMany` compare-and-set remains in place.
- Both automatic review-assignment paths (application submission and `ensureReviewTasks`) filter active specialization candidates to the application workspace before applying the existing faculty preference and workload ordering.
- `facultyScope` remains an automatic/manual assignment preference; criterion specialization governs officer claim/view eligibility. It does not grant or restrict those permissions.
- Resolution status updates and reopen operations reuse the existing `assertCanViewCase` workspace/visibility guard before any transaction or early return.
- Event roster confirmation verifies that the selected `EventFile.eventId` matches the scoped event before loading its indexing job or mutating participants. A mismatch returns the existing `EVENT_FILE_NOT_FOUND` response.
- `ENABLE_DEMO_REVIEW_BYPASS` is parsed as a boolean, defaults to `false`, and gates the legacy demo-officer permission exception. Set it to `true` only for environments that need the tested demo behavior.
- F06 inspection of `KnowledgeBaseService.searchApprovedEvidenceNames`: student/class-representative items contain `id`, `title`, and `criterion`; staff items additionally contain `eventName`, `level`, `usageCount`, and `updatedAt`. The selected fields do not include a person identifier, reviewer identity, file, or OCR content. Titles and event names are free text. The repository query currently has no workspace predicate, so its approved names are global; this was reported without code changes because no direct personal-data field is selected.
- No role, Prisma schema, migration, frontend, route allowlist, or review-engine boundary changed in this baseline.
- Regression coverage was added to `tests/unit/security-baseline-scope.test.ts`, `tests/unit/review-task-detail.test.ts`, `tests/unit/smartbot-env.test.ts`, and `tests/integration/workspace-isolation-flow.test.ts`.
- Verification in the isolated `phase1-security-baseline` worktree: focused unit tests passed (3 files, 20 tests), `npm run build` passed, and `npm run lint` passed with 27 `no-explicit-any` warnings. The workspace-isolation integration suite could not seed its fixture because the configured PostgreSQL credentials are invalid; no integration assertions ran.
- Committed-HEAD baseline: build passed; 4 unit tests passed, while both requested integration suites were blocked during PostgreSQL setup by the same invalid credentials. `npm ci` also failed because the committed lockfile does not resolve the declared `openai@6.49.0` package.

## Login Dashboard Readiness Patch On 2026-07-21

- `src/modules/precheck/precheck.routes.ts` now exposes `GET /api/applications/current/precheck/latest` before the dynamic `/api/applications/:id/precheck/latest` route, so Express no longer treats the literal `current` segment as a UUID application id.
- `PrecheckService.getLatestCurrent` uses a minimal current-application lookup for the authenticated student and returns the latest precheck snapshot without loading evidence/evidence-card relations. This keeps the student dashboard current-precheck request from depending on evidence-card columns that may be pending migration.
- Verification:
  - Backend `npm run build` passed.
  - `GET /api/applications/current/precheck/latest` with `student@dut.udn.vn` returned HTTP 200 after the route/query fix.
  - `npx prisma migrate deploy` applied `20260720120000_openai_evidence_analysis` and `20260721120000_evidence_card_confirmation` to the configured Supabase database.
  - `npx prisma migrate status` now reports `Database schema is up to date!`.
  - Student dashboard API checks returned HTTP 200 for `/api/me`, `/api/applications/current`, `/api/applications/current/precheck/latest`, `/api/applications/:id/precheck/latest`, `/api/applications/:id/criteria-completion`, and `/api/applications/:id/evidences?limit=100`.

## Phase 1 Part 2 — Đà Nẵng City Workspace and Backend Authorization

- Implementation branch: `phase1-danang-rbac-backend`, based on the Part 1 commit `14bce14` in the isolated `/private/tmp/phase1-security-baseline` worktree. The original `feat/AI-ux` checkout remains separate and retains its pre-existing dirty work.
- Additive migration `20260924100000_workspace_hierarchy_roles` adds `WorkspaceType` (`CITY`, `UNIVERSITY_SYSTEM`, `SCHOOL`), defaults existing and new workspaces to `SCHOOL`, adds the nullable indexed parent relation, and adds `data_uploader`, `city_officer`, `city_manager`, and `city_committee` without removing legacy `Role` values used by audit records.
- Seed upserts `DANANG_CITY`, `UDN`, and the current seeded schools. DUT and DUE are children of UDN; UDN is a child of Đà Nẵng City. Seeded City staff have separate accounts; legacy school users are not converted. Parent-child data is descriptive/routing context and does not itself authorize access.
- Shared `workspaceFilterFor()` and same-workspace behavior remain unchanged. Review-specific scope helpers limit City roles to active `SCHOOL` review resources; they do not grant access to users, school configuration, or unrelated workspace data. Applications and ReviewTasks remain school-owned.
- City Officer review access uses active criterion specialization and existing task assignment/state checks; `facultyScope` remains a routing preference. City Manager can coordinate/assign across active schools to active City Officers with matching specialization. `ensureReviewTasks` is restricted to City Manager/Admin. Committee remains limited to resolution/finalization and assigned reporting capabilities; it has no assignment or workload access. Admin behavior remains global where it was already global.
- City staff Event Registry access retains route allowlists and City-owned writes. Students can read and import active City Registry events through list/detail, official matching, suggestions, and the official library; school reference-precedent projection stays scoped to the student's School. Knowledge Base review reads City content and active School precedents; City-authored Knowledge Base content is City-owned. Evidence-derived approved precedents remain owned by the source School to preserve evidence provenance. Student approved-name output remains `id`, `title`, and `criterion`. Data uploader has no inherited review or DecisionImport access.
- Criteria-completion read/confirmation paths now use active-School City scope for City Manager/Committee read and City Manager confirmation; City Officers continue through task-specific review endpoints rather than application-level completion endpoints. The response DTO and JWT format are unchanged.
- Verification on 2026-09-24 in the isolated worktree: `prisma validate`, `prisma generate`, `npm run build`, and `npm run lint` passed. The final `npm test` run reported 64 files passing (367 tests), with 12 skipped; three integration suites failed before assertions because PostgreSQL at `localhost:5432` rejected the configured `postgres` credentials. The dedicated workspace-isolation suite likewise ran no assertions for this reason. No migration was applied to that database. ESLint reports 33 `no-explicit-any` warnings and zero errors.
- Phase 1 Part 1 status in this branch: F01 evidence upload workspace/owner checks, F02 task-creation scope, F03 claim scope and claimability, F04 resolution visibility, F05 event/file integrity, F07 workspace-filtered automatic assignment, F08 `facultyScope` routing-only semantics, and F09 opt-in demo bypass have regression coverage. F06 remains an inspection-only finding: student name projections expose `id`, `title`, and `criterion`; staff projections additionally expose `eventName`, `level`, `usageCount`, and `updatedAt`. No direct student or reviewer identifier is selected; title/event text is free text.
- No hierarchy CRUD API, new role framework, frontend change, upload feature, DecisionImport permission, JWT change, or review-engine algorithm change was added. The Part 2 migration remains unapplied until a database with valid test credentials is configured.

## Phase 2 Part 1 — Award Decision Registry Backend (2026-09-24)

- Implementation is isolated in worktree `/private/tmp/phase2-award-registry-backend`, branch `phase2-award-registry-backend`, starting from `feat/AI-ux` commit `e23eb0d4`. The original checkout and Phase 1 worktree were left unchanged; this branch is not merged or pushed.
- Additive migration `20260924110000_award_decision_registry` adds `AwardLevel`, `AwardDecisionStatus`, and `AwardRecipientMatchStatus`, plus `AwardDecision` and `AwardRecipient`. Recipients may remain unmatched and duplicate roster rows are allowed. `sourceImportId` is nullable for the later DecisionImport connection; no client API can set it in Part 2.1.
- `src/modules/award-decisions` provides authenticated list/create/detail/update and direct decision-file/roster-file upload routes. Data Uploader can manage drafts only in its own `SCHOOL` or `UNIVERSITY_SYSTEM` workspace; award level is derived from workspace type. Admin is global for listing and must select a `SCHOOL` or `UNIVERSITY_SYSTEM` issuer when creating. Students, City roles, legacy review roles, and City Data Uploaders have no registry access. Metadata updates and file associations are limited to `DRAFT`; there is no confirm, hard-delete, recipient API, parser, OCR, preview, mapping, indexing, or background job in this part.
- Registry files are saved as existing `File` records in the issuer workspace and audit events are written. Data Uploader file metadata/signed-URL access requires a linked Award Decision file in the same workspace; ownership of an unrelated file does not grant an exception. Event Registry, DecisionImport, OCR, student submissions, and review engine behavior remain separate and unchanged.
- Part 2.2 should reuse the existing parser, OCR, preview, mapping, validation, and job infrastructure. Do not create a second import engine or merge Event Registry with Award Decision Registry.
- Baseline before edits: worktree was clean at `e23eb0d`; `npm run build`, `npm run lint`, `npx prisma validate`, and 16 focused DecisionImport/Event Registry/File unit tests passed. `npm ci --ignore-scripts` could not resolve the declared `openai@6.49.0` from the committed lockfile, so dependencies were installed without changing the lockfile. Baseline full tests had 70 files/403 tests passing, 12 skipped, and three integration suites blocked before assertions by invalid local PostgreSQL credentials.
- Verification after implementation: `npx prisma validate`, `npx prisma generate`, build, lint, focused registry/File/DecisionImport/Event Registry tests (7 files, 38 tests), and all unit tests (72 files, 419 tests) passed. The SQL migration exactly matches Prisma's schema diff. Full `npm test` had 74 files and 425 tests passing, 18 skipped, and four integration suites unable to seed because `localhost:5432` rejected the configured `postgres` credentials; this includes the new registry integration suite. `prisma migrate status` could not be completed for the same database authentication failure, and no migration was applied. Lint reports the same 33 existing `no-explicit-any` warnings as baseline.

## Phase 2 Part 2 — Award Roster Ingestion Backend (2026-09-24)

- Part 2.1 was committed as `8279c35 feat: add award decision registry` on `phase2-award-registry-backend`. Part 2.2 is isolated in `/private/tmp/phase2-award-roster-ingestion`, branch `phase2-award-roster-ingestion`, based on that commit. The original `feat/AI-ux` checkout and Phase 1 worktree remain untouched; this work is not pushed or merged.
- The Award API adds scoped process, processing-status, paginated-preview, mapping, confirm, and paginated-recipient endpoints under `/api/award-decisions/:id`. The actor must be a Data Uploader for the issuer workspace or an Admin. City roles remain outside the registry. Generic job detail/run/retry APIs reject Award jobs, and worker-tick responses expose only Award job type/status rather than the internal job id, target, or result.
- Award processing stores its current roster file id, input columns/raw rows, mapping, preview rows, and validation summary in the existing `IndexingJob` JSON fields. `20260924120000_award_roster_ingestion` adds only the additive `JobType.award_roster_ingestion` enum value; no staging model or modification to the Part 2.1 migration was added.
- `readRosterTable` is a small shared extraction of Collective's existing CSV/XLSX reader. Collective still opts into its prior blank-row behavior; Award drops wholly blank rows and preserves XLSX cell types so numeric/date student-code cells are invalid while text values retain leading zeroes. Date cells use a tagged JSON value so serialization cannot turn them into accepted text. Award reuses DecisionImport's deterministic header normalization/mapping helpers but owns Award-specific institution resolution, recipient validation, persistence, and confirmation.
- PDF rosters use the existing SmartReader adapter, async polling/result downloader, and DecisionImport SmartReader table normalizer. Async polling/result-link handling was extracted to `runSmartReaderAsyncTableOcr` and is used by both Award and the existing DecisionImport roster OCR processor. Decision PDFs remain unprocessed. `DecisionImport`, Event Registry, EventParticipant, and student Event import are not used to persist Award data.
- Matching is deterministic and workspace-scoped. SCHOOL records default to the issuer, or must resolve any mapped school value to that exact issuer. UNIVERSITY_SYSTEM records resolve by exact normalized workspace code/name/short name/active alias among active SCHOOL children. Student account matching uses student code only inside the resolved School; unmatched students remain valid with `UNMATCHED`; unresolved or ambiguous school context is `CONFLICT`. Duplicate keys are institution workspace plus student code, so equal codes at different UDN member schools are allowed.
- Confirm rechecks DRAFT, issuer/file workspace, current roster file and the completed job for that file; it rebuilds validation inside a transaction, conditionally transitions only a still-DRAFT decision, creates every recipient, and writes a count-only audit record. Mapping updates and confirmation lock the draft decision before reading/writing the preview so a concurrent remap cannot land after confirmation. Invalid, duplicate, conflict, or empty batches are rejected. Any transaction error rolls back the state transition and all recipient/audit writes; a second confirm is rejected.
- The Part 2.2 verification pass: Prisma validate/generate and backend build passed; lint passed with the existing 33 `no-explicit-any` warnings. All DB-independent tests passed (`79` files, `463` tests); this includes spreadsheet type/leading-zero validation, Award PDF SmartReader success/failure and arbitrary-file/workspace guards, recipient matching, duplicate/invalid blocking, transaction rollback, concurrent mapping/confirm guards, double confirmation, and generic-job privacy. The Award roster integration fixture could not seed because PostgreSQL rejected the configured `postgres` credentials; its 4 integration tests were skipped and are BLOCKED BY ENV. No migration was applied to a database.
- No frontend, eligibility logic, DecisionImport permissions, generic import/workflow framework, duplicate parser/OCR engine, Event/Award domain merge, or review-engine change was introduced.

## Award Decision Registry archive operations (2026-09-28)

- `POST /api/award-decisions/:id/archive` transitions only `DRAFT` or `CONFIRMED` to `ARCHIVED`; `POST /api/award-decisions/:id/unarchive` restores `CONFIRMED` when `confirmedAt` is present and otherwise restores `DRAFT`. Conditional status updates make repeated or concurrent transitions return HTTP 409. File relations, recipients, mappings, processing jobs, and confirmation metadata are retained; no migration or new status enum is needed.
- The routes reuse the Award Registry allowlist and issuer-workspace check: `data_uploader` is limited to its own issuer workspace and `admin` retains the existing global access. Other roles and cross-workspace uploaders are denied. Successful transitions reuse `AuditService` with `AWARD_DECISION_ARCHIVED` or `AWARD_DECISION_UNARCHIVED`.
- `GET /api/award-decisions` accepts `archive=exclude|only|all`; the effective default excludes archived decisions. Legacy `status=ARCHIVED` without `archive` continues to work. Explicit contradictory `status` and `archive` filters return HTTP 400. Eligibility continues to query only `CONFIRMED` UDN Awards, so archive/unarchive controls future eligibility reads without changing submitted applications.
- The operational frontend archive controls and visibility filter are documented in the frontend context. No application lifecycle, City review, recipient-matching, analytics, or production-database behavior changed.
- Draft roster previews now support row correction and correction reversion through `PATCH /api/award-decisions/:id/roster-preview/:sourceRow` and `DELETE /api/award-decisions/:id/roster-preview/:sourceRow/correction`. Only Data Uploaders in the issuer workspace and Admin can use them; the decision must still be `DRAFT`. The source OCR/table rows remain unchanged in `IndexingJob.resultJson.sourceRows`; canonical overrides are stored separately in `rowCorrections` and applied when previewing, mapping, and confirming. Each mutation locks the decision and rechecks the current roster job/file, so confirmation and edits serialize. A new roster-processing job starts without old corrections. Audit records identify the row and changed fields with the before/after effective row values; no full roster is included in confirm audit metadata. No schema or migration was added.

## Phase 3 Part 1 — City Submission Eligibility Backend (2026-09-25)

- Implementation is isolated in `/private/tmp/phase3-city-eligibility`, branch `phase3-city-eligibility`, based on Phase 2 Part 2 commit `f43cd42`. Original test and implementation checkpoints are `68c7eba` and `143f1e2`; correction test and implementation checkpoints are `0ca8ef2` and `029f54b`. No push or merge was performed.
- `GET /api/applications/:id/eligibility` is available only to students. The service applies the existing same-workspace and application-owner guards before workspace classification or Award queries. Admin, City roles, Data Uploader, and legacy staff roles cannot call this endpoint.
- Eligibility is derived on request from the authenticated student's current workspace, identity, the application's persisted `schoolYear`, and canonical Award Registry data. A SCHOOL with no parent follows `DIRECT_CITY` and is eligible without Award lookup. A SCHOOL whose immediate parent is `UNIVERSITY_SYSTEM` follows `UDN_PREREQUISITE` and requires only a confirmed UDN Award for that school and exact school year; a separate School Award is not required.
- The UDN lookup is scoped to the immediate parent issuer, `UNIVERSITY_SYSTEM` level, confirmed status, application school year, and the student's School as recipient institution. Student and recipient codes are trimmed and uppercased while preserving leading zeros. Exact code match is sufficient regardless of `matchedUserId` or duplicate exact-code rows. If code matching does not establish eligibility, exact normalized `fullName` + `className` can only produce `NEEDS_VERIFICATION`; it cannot grant eligibility. Ambiguous name/class signals also require verification. Without an exact code match or identity signal, the result is `NOT_ELIGIBLE`. Draft/Archived decisions, old school years, other institutions, preview rows, and global code matches do not count.
- The DTO returns `applicationId`, `schoolYear`, `route`, `status` (`ELIGIBLE`, `NOT_ELIGIBLE`, or `NEEDS_VERIFICATION`), and stable `reasons`; it has no eligibility boolean or School Award requirement. Missing identity context and absent qualifying UDN Awards have distinct reason codes. Unsupported workspace configuration returns a conflict error rather than inferring a route.
- Part 3.1 added no schema or migration, frontend, submit gate, target-level behavior, precheck/rules, review engine, or Award Registry mutation. Phase 3 Part 2 applies the existing eligibility calculation at initial City submission and adds only the manual verification record described below.
- Verification for the correction patch: focused Award and eligibility tests passed (11 files, 84 tests); full `npm test` ran 89 files with 84 passing, 496 tests passing, and 22 skipped. Five integration suites were blocked before assertions because PostgreSQL rejected the configured `postgres` credentials: approved evidence names, Award Decision registry, Award roster ingestion, non-AI application flow, and workspace isolation. `npx prisma validate` and `npx prisma generate` passed without schema changes; `npm run build` passed; `npm run lint` passed with 33 existing `no-explicit-any` warnings. No migration was applied.

## Phase 3 Part 2 — City Submission Gate and Manual Eligibility Verification (2026-09-25)

- `POST /api/applications/:id/submit` reuses `CitySubmissionEligibilityService.getEligibility()` as its eligibility source. The gate applies to an initial submission by a student for an individual application with `targetLevel=city`; it runs after existing owner/status checks and before precheck refresh, transaction writes, review tasks, audit, notifications, or email outbox work. The first transactional write conditionally matches the observed status, target level, draft version, submission timestamp, and `updatedAt`, so stale draft or manual-verification state cannot submit while a request is running. Target-level changes and autosaves use the same editable-state/version guard so they cannot write over a completed submit. Existing school-level, collective, and admin-utility paths keep their prior behavior. A City application marked `supplement_required` skips the initial gate only when `submittedAt` proves a prior submission; a never-submitted application cannot bypass eligibility by being marked as a supplement.
- `ELIGIBLE` continues the existing submission flow. `NOT_ELIGIBLE` returns HTTP 409 `CITY_SUBMISSION_NOT_ELIGIBLE`. `NEEDS_VERIFICATION` returns HTTP 409 `CITY_SUBMISSION_NEEDS_VERIFICATION` with a distinct student-facing message, and cannot enter review until verified. A blocked submit leaves the application status and `submittedAt` unchanged and creates no review-task or notification side effects.
- `POST /api/applications/:id/eligibility-verification` is restricted to `city_manager`. The City Manager must belong to a City workspace and may act on an active School's individual City application only while it remains in a pre-submit state. Officers, Committee, Data Uploader, Students, legacy staff, and Admin are denied; Manager authorization is explicit and does not use an admin bypass.
- `ApplicationEligibilityVerification` stores one current `APPROVED` or `REJECTED` decision per application, the required plain-text reason, actor, and decision timestamp. Each decision and its minimal AuditLog entry are written in one transaction after locking and rechecking that the application is still an initial pre-submit City application; the write also advances the application `updatedAt` marker used by the submit guard. Audit metadata contains application id and decision only; the student-facing eligibility response does not expose the manager reason.
- Automatic eligibility is recalculated on every GET and submit. The stored decision is consulted only when automatic status is `NEEDS_VERIFICATION`; approval changes the effective status to `ELIGIBLE`, rejection changes it to `NOT_ELIGIBLE`, and either stored decision is ignored when automatic status is definitive. Manual verification cannot edit Award Registry data or reopen submitted/final applications.
- Part 3.2 verification: focused submit-gate, draft-concurrency, eligibility, verification repository/access, and supplement tests passed (6 files, 63 tests). The full `pnpm test --reporter=dot` run passed 87 files / 534 tests with 22 skipped; five integration suites failed before assertions because the configured local PostgreSQL `postgres` credentials were rejected, so DB integration is `BLOCKED BY ENV`. `pnpm build`, `pnpm lint` (33 existing `no-explicit-any` warnings), `npx prisma validate`, and `npx prisma generate` passed. Prisma schema diff from the Part 3.1 baseline exactly matches the additive verification migration; no migration was applied.
- Part 3.2 hardening started at `690508a` after review found stale manual approvals and a non-atomic submit gate. The existing verification row now stores a SHA-256 basis hash derived from the normalized application/school/year/parent context, current student code/name/class, and the sorted confirmed UDN recipient identity rows used by the automatic matcher. Manual state applies only while automatic eligibility is `NEEDS_VERIFICATION` and this hash still matches; stale rows remain historical and definitive automatic results still take precedence. The Finding A migration adds only this nullable hash column to the existing verification model.
- Initial City submit now keeps the early eligibility check before precheck reads/calculation, but prepares a stale precheck without writes. Its protected transaction uses PostgreSQL `READ COMMITTED`, locks the exact Application state with `FOR UPDATE`, then locks the current User identity row and School workspace hierarchy row with `FOR NO KEY UPDATE`. Those locks block identity/hierarchy updates while remaining compatible with recipient foreign-key checks during concurrent roster confirmation. It then locks the immediate UDN issuer workspace and that issuer's UDN AwardDecision rows for the application's school year plus all still-mutable DRAFT decisions that could be moved into that year with `FOR UPDATE`. It re-reads effective eligibility while those locks are held, then persists any prepared precheck and continues through the existing CAS, ReviewTask, audit, notification, and email transaction. The issuer workspace lock also serializes new AwardDecision inserts that reference that issuer while the short submit transaction is open; it protects the empty-result case where no decision row exists yet. Precheck refreshes outside initial City submission continue to use `run()` with the same response and transaction behavior.
- A late eligibility rejection therefore occurs before any submit-triggered precheck write, Application readiness/status write, submit CAS, snapshot, ReviewTask, audit, notification, or email-outbox write. Supplemental resubmission after a previous submission still skips the initial City gate. No Finding B schema/migration, frontend, Award rule, role, review-engine, or generic concurrency/workflow framework change was added.
- Hardening verification: the RED checkpoint reproduced two Finding B failures (2 failing / 14 passing in the submit-gate file). After the fix, focused eligibility, stale-verification, submit-concurrency/side-effect, precheck, and supplement tests passed (7 files / 67 tests). The latest full `pnpm test --reporter=dot` run had 87 files pass and 5 integration suites fail during setup (544 tests passed, 22 skipped); the blocked suites (approved evidence names, Award registry, Award roster ingestion, non-AI application flow, workspace isolation) all failed because PostgreSQL rejected the configured `postgres` credentials before assertions, so DB integration remains `BLOCKED BY ENV`. `pnpm build`, `pnpm lint` (33 existing `no-explicit-any` warnings), `prisma validate`, and the earlier `prisma generate` passed; no schema change or migration was made for the deadlock fix.

## Phase 3 Part 3 — Eligibility UX and City Manager Read Context (2026-09-25)

- Backend read-contract work is isolated in `/private/tmp/phase3-eligibility-manager-read`, branch `phase3-eligibility-manager-read`, based on hardened Part 3.2 commit `d100826`. It does not alter the student-only `GET /api/applications/:id/eligibility` or the existing `POST /api/applications/:id/eligibility-verification` contract.
- `GET /api/manager/applications?eligibilityVerification=pending` is restricted to `city_manager` at the route and service layers. It scopes to active School workspaces and selects only individual, initial City applications with no `submittedAt`; the service recalculates both automatic and effective eligibility and includes a row only when both remain `NEEDS_VERIFICATION`. Eligibility filtering happens before pagination. Existing manager application-list behavior is unchanged when this filter is absent.
- Pending-list candidates are evaluated in batches of at most 20 and scanned by immutable application ID with a keyset cursor, so a concurrent `updatedAt` change cannot move a row across offset pages. Only known invalid/mismatched application context and unsupported hierarchy errors exclude an individual candidate; unexpected failures still propagate.
- `GET /api/manager/applications/:id/eligibility-verification` is a separate City Manager-only read path. It uses the existing explicit City Manager-to-active-School scope, including cross-school records, and checks application type/status and the student/application workspace match before any Award lookup. It returns only the student identity needed for verification, school identity, automatic/effective status and reason codes, a prior decision and timestamp without its internal reason, and candidate rows that exactly match normalized student full name and class in confirmed UDN Awards scoped to the immediate parent issuer, school, and school year. It returns no roster IDs, matched account IDs, OCR data, verification basis hash, internal reason, or unrelated recipients.
- No schema, migration, persistence, Award Registry write, Event Registry, generic workflow/task, admin bypass, or review-engine change was introduced. The manager panel belongs in existing `/app/analytics`; no route or navigation entry is added for it.
- Part 3 baseline in the new worktree: dependencies were absent. `npm ci` could not be used because the existing `package-lock.json` is out of sync with `package.json` (`openai@6.49.0` missing); dependencies were installed with `pnpm install --frozen-lockfile` without changing a lockfile. Baseline `pnpm build` and Prisma validation passed after generating the local Prisma Client. Baseline lint passed with 33 existing `no-explicit-any` warnings. The first baseline integration attempt used a local placeholder database URL and was rejected; the actual Supabase URL is only present in the original checkout's `.env`, which was not copied into the isolated worktree.
- Part 3 backend final verification: all 87 unit test files passed (561 tests); the full suite completed 89 files successfully (567 tests passed, 22 skipped), while 5 DB integration suites failed during setup before assertions because the configured Supabase database does not contain `Workspace.type` (`BLOCKED BY ENV / schema drift`). A read-only connection check succeeded. The suite ran with `NODE_ENV=test` and only the configured database URL; no migration was applied. `pnpm build`, `prisma validate`, and `prisma generate` passed. `pnpm lint` exited successfully with the same 33 pre-existing `no-explicit-any` warnings. A security review found no remaining Critical or Important issue in the backend diff.

## Normalized Criteria Advisor Foundation On 2026-07-21

- Added additive current-criteria persistence separate from legacy `CriteriaVersion`:
  - `CriteriaConfig` stores one current config by `scope + workspaceId/null`, stable `code`, display metadata, and official source metadata.
  - `NormalizedCriteriaRule` stores active logical rule trees, mandatory/priority separation, student-facing copy, hints, and source refs.
  - Legacy `CriteriaVersion` and `CriteriaRule` remain for backward compatibility, but the normalized criteria advisor/evaluator does not select by `schoolYear`, version name, effective dates, or historical snapshot.
- Added seed modules under `prisma/seeds/criteria`:
  - Stable configs: `DUT_SCHOOL_CURRENT`, `UDN_UNIVERSITY_CURRENT`, `DANANG_CITY_CURRENT`, and `CENTRAL_CURRENT`.
  - Seed data is explicit TypeScript, does not parse PDFs, stores source filenames only, and validates duplicate keys, official five-criterion coverage, empty logical groups, priority/mandatory separation, manual-review nodes, and source metadata.
  - `prisma/seed.ts` still runs the legacy criteria seed for existing registration/readiness behavior, then runs the normalized criteria seed additively.
- Added `src/modules/criteria`:
  - `GET /api/criteria/configs/active`
  - `GET /api/applications/:id/criteria-evaluation`
  - `GET /api/applications/:id/criteria-gap`
  - Evaluation is deterministic, never calls OpenAI, does not update final status, and only trusts verified metrics, confirmed/corrected Evidence Cards, and trusted Event Registry imports.
  - Status language is `READY`, `INCOMPLETE`, `NEEDS_CONFIRMATION`, and `NEEDS_MANUAL_REVIEW`; no official pass/fail is returned.
- Extended common Student Assistant additively:
  - New `criteria` context type, criteria facts/source refs, and allowlisted tools `get_active_criteria`, `evaluate_my_application`, and `compare_criteria_levels`.
  - Criteria questions without criteria facts fall back instead of being answered from model memory.
  - Criteria model answers are rejected when they reference unknown facts/actions or introduce numeric values not present in backend facts.
- Verification:
  - `pnpm exec prisma validate`: passed.
  - `pnpm prisma:generate`: passed.
  - `pnpm build`: passed.
  - Bounded ESLint over criteria, student-assistant, app/routes/constants/errors, seed, and touched tests: passed.
  - `pnpm exec vitest run tests/unit/normalized-criteria-seed.test.ts tests/unit/criteria-precheck-adapter.test.ts tests/unit/student-communication-assistant-answer.test.ts`: passed, 3 files and 15 tests.
  - Pure seed validation reported 4 configs, 27 rules, 23 mandatory rules, 4 priority rules, 4 manual-review rules, and 0 validation errors.
  - Running `pnpm test -- ...` invoked the repo integration suite and failed on local PostgreSQL authentication for pre-existing integration fixtures; targeted unit tests were rerun directly with `pnpm exec vitest run ...` and passed.

## Phase 4 Part 1 — City Criteria and Soft Advisory Precheck (2026-09-27)

- Isolated backend work in `/private/tmp/phase4-city-criteria-backend`, branch `phase4-city-criteria-backend`, starting from `ef07f0b168105f3d1e157ff249fec02af7a66ca5`. The original checkout is unchanged; no Phase 2/3 eligibility or Award Registry work was edited.
- City criteria use the selected 2021–2022 source document for rehearsal year `2025–2026`. Runtime fallback rules and normalized seed content represent all five criteria: ethics, academic, physical, volunteering, and integration. The fallback evaluates objective conduct, minimum GPA, and volunteer-day thresholds; volunteer days and commendation remain separate AND findings. Unknown degree type and missing City information are routed to human review; the system does not infer a college/university threshold.
- Clear evidence dates outside the application school year add `OUTSIDE_SCHOOL_YEAR` advice to the criterion and precheck. Date detection only accepts valid ISO or `DD/MM/YYYY` values found in extracted, normalized, or confirmed evidence fields. The current school-year boundary assumption is September 1 through August 31; missing or malformed dates produce no outside-year finding. Evidence and source files are never removed.
- The existing initial individual City submit flow still checks Phase 3 eligibility and lifecycle/ownership/concurrency before side effects. A saved file may accompany the first City submission while OCR/indexing is pending. Warnings still require the explicit `allowSubmitWithWarnings` confirmation sent by the existing submit dialog. The regression confirms that low readiness, missing achievement evidence, and pending OCR can proceed after confirmation and create exactly five `waiting` ReviewTasks with `decision: null`. Supplement resubmission and non-City submission checks are unchanged.
- No schema, migration, new policy framework, Award logic, review-engine decision logic, task status automation, or analytics change was added. Unit coverage includes five-criteria seed coverage, objective threshold findings, volunteer AND structure, missing-data review handling, ambiguous GPA, valid versus invalid/out-of-year dates, submit gating, OCR and supplement regressions. Focused tests passed (5 files, 46 tests); the full unit suite passed (88 files, 574 tests). Prisma validation/generation and backend build passed; lint passed with 33 existing warnings and no errors.
- A read-only connectivity query to the configured Supabase project succeeded. The workspace-isolation, Award Registry, and Award roster integration suites were then attempted with random, scoped fixtures, but setup failed because the live database lacks the `Workspace.type` column required by the checked-in Prisma schema. No fixtures were created, no migration or seed was applied, and integration assertions remain `BLOCKED BY ENV` due to schema drift.

## Phase 4 Part 2 — City Review End-to-End (2026-09-27)

- Individual City applications use exactly five criterion tasks (ethics, academic, physical, volunteer, integration) on initial submit and in `ReviewService.ensureReviewTasks`; priority evidence remains application context and cannot add a sixth City task. Repeated ensure calls do not create duplicate tasks. Non-City applications retain the legacy behavior of ensuring additional evidence criteria.
- Only active City Officers can claim and decide City criterion tasks, subject to the existing specialization, assignment, status, and workspace rules. City Managers can coordinate and read across their City scope but cannot decide criterion tasks. City Committees can read the final-resolution view but do not assign or decide criteria. Legacy school officer/manager/committee roles do not gain City review permissions; existing admin bypass semantics remain.
- City human review decisions are authoritative over advisory precheck/OCR signals. Completing all five tasks never automatically finalizes a City application, including when one or more criteria are rejected. City Manager, City Committee, and existing admin permissions control explicit finalization. Resolution handling likewise leaves City applications under review until a final decision is submitted.
- City task decisions use a conditional state update so concurrent requests cannot overwrite a prior decision or emit duplicate decision audits. City supplement reopen access is limited to City Manager/admin and preserves the existing affected-task reset behavior.
- No schema, migration, Award, Eligibility, analytics, or review-engine framework changes were added. Regression coverage includes role boundaries, the five-task set, advisory disagreement, OCR-failed evidence, human finalization, and concurrent decision attempts; test and environment results are recorded with the Phase 4 Part 2 change report.

## Phase 4 Part 3A — City Analytics Dashboard (2026-09-27)

- Added `GET /api/analytics/city` and paginated `GET /api/analytics/city/applications`. Both endpoints allow only `city_manager` and `admin`; City Managers must have a matching CITY workspace. Their dataset is explicitly restricted to individual City-level applications whose owning SCHOOL workspace is active. Admin receives that same City dataset, while `/api/manager/dashboard-summary` and its existing workspace scope remain unchanged for legacy manager/committee roles.
- Summary filters use school year, school workspace, and exact application workflow status. The default school year is the newest present in City-level application data; an empty dataset returns a null year and zero metrics. Summary DTOs omit student identity. Drill-down is database-paginated and returns only the student name/code, owning school, application state, finalStatus, and five-criterion human review progress needed to navigate to the existing result detail. Explicit submitted/in-review, supplement, and resolution filters keep KPI drill-downs aligned with their summary predicates without conflating those predicates with the exact `Application.status` filter.
- The dashboard separates created, not-submitted, and submitted applications; counts supplement-needed applications once while exposing supplement task count separately; progress counts one unique accepted/rejected human task per official criterion; missing criterion slots and extra/duplicate/non-City task rows are reported separately. Official final outcomes come only from `Application.finalStatus`, with `partially_passed` separate from review completion. Resolution and workload use the same filtered individual City applications; officer workload includes only active City Officers and does not rank reviewers. Rules, OCR, AI, Award data, and legacy tasks are not used to determine official results.
- No schema, migration, snapshot, cache, job, frontend, or review-engine changes were introduced. The existing manager dashboard API and legacy workspace-scoped behavior remain in place.
- Verification from baseline `416913a`: baseline unit tests passed (88 files/594 tests), baseline build passed, and baseline lint had 33 warnings. The Part 3A worktree passes all unit tests (90 files/627 tests), build, Prisma validate/generate, and lint with the same 33 warnings and no errors. The workspace-isolation, Award Decision Registry, and Award roster-ingestion Supabase integration suites passed; `prisma migrate status` reports all 27 migrations up to date, and no migration was run. Read-only City Manager smoke requests returned 200 for summary and paginated drill-down; summary contained no student identity.

## Phase 4 Part 3B — City submission seasons and deadlines (2026-09-27)

- The backend had no season-wide configuration model: `Application.schoolYear` is free text, while `ReviewTask.dueDate` and `SupplementRequest.deadline` are per-item values. Added the minimal additive `CityReviewSeason` and application-scoped `CitySubmissionWindowException` models and migration `20260927120000_city_review_seasons_and_submission_exceptions`; no migration was deployed. Existing task/request deadlines remain unchanged.
- City Managers in an active CITY workspace and admins can read/manage season configuration. Season updates use `expectedVersion` and transactionally audit creation and each changed timing field with actor, before/after values, reason, and timestamp. City Manager/admin exception grant and revoke are restricted to pre-submit individual City applications and are transactionally audited. City Manager reads can cross active SCHOOL workspaces; student deadline reads remain student-only and owner/workspace scoped; admins follow the existing global admin convention.
- Added `GET/POST/PATCH /api/manager/city-review-seasons/:schoolYear`, student `GET /api/applications/:id/submission-deadline`, manager/admin `GET /api/manager/applications/:id/submission-deadline`, and manager/admin `PUT/DELETE /api/manager/applications/:id/submission-deadline-exception`. Student DTOs omit exception reason and grantor; manager DTOs include exception detail.
- Initial individual City submission fails closed when season opening/closing is not configured and otherwise accepts the inclusive `[opensAt, closesAt]` interval. A live application exception extends only the close boundary, never the opening boundary. Eligibility remains checked before the window; the transaction rechecks eligibility and locks the season/exception before precheck persistence, application mutation, review tasks, audit, or notifications. Supplement resubmission bypasses the initial window and checks only a configured supplement deadline. Review/finalization deadlines are read-only `ON_TRACK`/`OVERDUE` signals; no scheduler or automatic decision/finalization was added.
- Verification: Prisma validate/generate and backend build passed; lint passed with 33 existing warnings. The unit-only suite passed 92 files/651 tests, and the submit-gate file passed 22/22. The full default `npm test` ran 99 files: 94 passed, five database suites failed at fixture setup, with 657 tests passed and 23 skipped. `tests/setup-env.ts` had supplied its default localhost test URL because Vitest was not given a `DATABASE_URL`; those failed suites did not test Supabase. After the explicit database request, `prisma migrate deploy` applied the additive season/exception migration; read-only status reports 28/28 and an information-schema query confirms both new tables exist. The Part 3B fixture suite was not rerun against production.
- The unit role matrix denies City Officer, City Committee, uploader, legacy school manager/committee, and student, and allows City Manager in CITY and admin. Database-backed route verification remains blocked until a non-production database has the pending migration and valid test credentials. Deadline regressions cover configured close exact/+1ms, active exception close, after-close no-side-effects, application-specific scope, rejection of expired grants, and unsubmitted `supplement_required` applications while continuing to reject submitted ones.
- The integration `.env` points to Supabase project `gvoccbqxackccacwhnoiz`; the supplied dashboard identifies its `main` branch as `PRODUCTION`. The user explicitly requested applying this migration to that project. Do not run integration fixtures that create synthetic workspaces/users/applications on production. Complete DB-backed Part 3B and regression verification against a confirmed non-production Supabase environment before PR push.
- A stale-precheck City supplement resubmission refreshes precheck before capturing the transaction snapshot. The `updatedAt` comparison therefore applies to initial City submissions only; the resubmit still locks and validates the refreshed state transactionally. Regression: `applications-city-submission-gate.test.ts`.
- Deferred Part 3B minor findings: (1) timestamp validation can accept impossible calendar dates normalized by `Date.parse`; (2) deadline PATCH requires the full field set; (3) a no-op season update can increment `version` without a changed-field audit. Revisit separately; none blocked the current code checks. The frontend deadline exception panel uses the server-computed `submission.exceptionActive` so browser clock skew cannot hide an active exception.

## Phase 4 Part 3C — City application lifecycle management (2026-09-28)

- City individual applications now use nullable cancellation and archive overlays plus immutable `ApplicationFinalDecisionHistory` snapshots. Migration `20260928120000_application_lifecycle_overlays_and_final_history` is additive; it does not change application/review status enums or delete historical records.
- City Manager and admin lifecycle routes cancel, reopen a canceled application, archive, and unarchive within the existing City individual/active School scope. Cancellation requires a reason, retains the application and five review tasks, snapshots and clears a current final decision, audits the transition, and notifies the student. Reopen never restores the prior final; another explicit finalization is required. Archive changes manager-list visibility only.
- `lockApplicationAndAssertNotCancelled` is the shared Application-first row-lock guard for application-bound writes. Reads remain available; adjudication, evidence, student-content, eligibility-verification, and Part 3B exception writes reject canceled applications with HTTP 409 `APPLICATION_CANCELLED`. Existing OCR completion may still update advisory extraction metadata without restarting review work.
- Canceled application tasks remain stored but are excluded from active review queues and reviewer workload. Current City analytics and official result exports exclude canceled applications; `cancelledCount` is separate. Archived, non-canceled finals remain official. Manager application/result lists default to active and non-archived, with explicit lifecycle/archive filters and final-decision history in detail.
- Reopening preserves the exact existing five criterion task IDs and decisions. Part 3B seasons, submission windows, exception rules, and supplement deadlines continue using their existing APIs and models; deadline-exception grant/revoke is stopped after cancellation.
- Dashboard summaries, committee inbox, and resolution counts now exclude canceled applications. Official result exports read completion time and note from the current Application final fields rather than historical audit entries; reopening a final records `FINAL_DECISION_SUPERSEDED` in the same transaction as the immutable history snapshot.
- Verification: Task 13 PostgreSQL row-lock races passed 6/6 on Supabase project `gvoccbqxackccacwhnoiz`; fixtures used unique IDs and verified cleanup. The configured branch is marked `PRODUCTION`, and `SUPABASE_TEST_DATABASE_URL` is unset, so the expanded Task 14 synthetic City-flow fixture is not run against it. The expanded lifecycle/resolution rehearsal is present in `tests/integration/non-ai-application-flow.test.ts` but remains unverified until a non-production Supabase URL is available. Final local checks: Prisma validate/generate, backend build, 101 unit files/716 tests, integration-test-file ESLint, and repository lint with the existing 33 warnings and no errors.

## Deferred backlog — Award Registry rehearsal data

- Award Registry management UI and archive/unarchive operations are available. End-to-end rehearsal with real UDN decision data remains dependent on authorized non-production data; no production dataset is used by this feature's tests.

## Phase 4 Part 3D — Final rehearsal and hardening (2026-09-29)

- Rehearsal ran from backend `main` at `4a5df42a0742737d3b6a9b91b3923054ab120db8` using a disposable local PostgreSQL 16 container. The current direct City flow, UDN Award roster path, eligibility, exactly-five review tasks, supplement/resubmit, Resolution, finalization, cancellation/reopen/archive, analytics/export, role boundaries, and lifecycle races passed their targeted existing regressions.
- The end-to-end flow exposed stale `SupplementRequest.status='active'` metadata after a City supplement was resubmitted through the application submit route. The same transaction now marks matching active requests `resubmitted`, records `resubmittedAt`, and appends `student_resubmitted` history. This prevents a later canceled-application reopen from incorrectly returning `supplement_required`; task IDs and decisions remain governed by the existing workflow. Regression: `applications-city-submission-gate.test.ts` and `non-ai-application-flow.test.ts`.
- The same rehearsal exposed fixture cleanup omitting Event Registry rows created by accepted evidence. Cleanup now deletes only registries discovered in that test's exact fixture workspaces before deleting those workspaces; no wildcard cleanup was added.
- Verification on the disposable database used `prisma db push` to construct the checked-in schema, then all 8 integration files passed (35 tests), including the complete non-AI City lifecycle flow and six lifecycle concurrency cases. All 102 unit files/739 tests passed. Prisma validate/generate and backend build passed. Backend lint passed with the existing 33 warnings and no errors.
- A fresh-database `prisma migrate deploy` check remains blocked by the pre-existing migration chain: the first migration (`20260630000100_phase9_collective`) expects enum type `CollectiveStatus` before that type exists. No production or Supabase database was used, and no migration was applied. This is a database bootstrap/deployment follow-up, not a change made during 3D.
- The frontend had no source changes in this rehearsal. Focused mocked Playwright coverage passed 97/97; frontend build and lint passed (11 existing warnings). `tsc --noEmit` reported the established 193 diagnostics, unchanged from baseline. The broader 137-test run had 114 pass, 22 fail, and 1 skip: failures were limited to a presentation suite requiring an unavailable backend and pre-existing student UI fixture/assertion issues. The evidence-upload deep-link test also remains a P2 usability issue; the normal upload action remains available.
- Production was not contacted or mutated. The rehearsal supports development feature freeze, not production readiness; deployment and migration-chain validation remain separate work.

## Admin Operations Completion + Migration Bootstrap Hardening (2026-09-29)

- City Review Seasons now have an admin/City Manager list view and a safe delete endpoint. Deletion is allowed only while no Application references the school year; a used season returns `409 CITY_REVIEW_SEASON_IN_USE` and remains intact. The list reports application count and whether deletion is allowed.
- Admin workspace operations support `SCHOOL`, `UNIVERSITY_SYSTEM`, and `CITY`, safe parent configuration, activation/deactivation, and paginated filtering. Only `SCHOOL` may have an active `UNIVERSITY_SYSTEM` parent. Parent changes are blocked after applications exist because eligibility reads current workspace hierarchy and applications do not snapshot it. Workspace deletion is not exposed.
- Admin user operations provide paginated list/search/filter, account create/update/activation, safe role/workspace pairing, and City Officer specialization replacement using exactly the five canonical criteria. `POST /api/admin/users/:userId/reset-password` is admin-only, validates the existing 8–128 character password policy, and transactionally changes the password hash, revokes refresh tokens, and writes a secret-free audit event. The API returns only the target user id; stateless access tokens can remain valid until expiry. Unsafe reassignment/deactivation with workflow or audit references is rejected or limited to deactivation.
- Bootstrap audit: `20260630000100_phase9_collective` was the first checked-in migration to alter `CollectiveStatus`; it did not create the enum. The checked-in pre-migration schema at `e46f1ac` already defines it. The repository does not establish how earlier live databases obtained that schema, so the former chain depended on schema state outside its migration history.
- Added `20260629000100_initial_schema_baseline` as the first migration, generated from that historical schema, plus `migration_lock.toml`. The additive `20260929100000_reconcile_migration_history_gaps` migration adds four missing notification enum values and seven missing query indexes using `IF NOT EXISTS`. No applied historical migration was edited or removed. `schema.prisma` now represents existing database UUID/timestamp defaults and custom GIN/trigram indexes; `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code` reports no difference on a fresh migrated database.
- For an empty database, use `prisma migrate deploy`. For a known existing database whose old history/schema is already present, verify first, then mark the one-time baseline as applied with `prisma migrate resolve --applied 20260629000100_initial_schema_baseline` before deploying pending migrations. Do not use this adoption step on an unknown/schema-only database. The operational guide is [admin-operations.md](operations/admin-operations.md).
- Migration verification used only a disposable local PostgreSQL 16 container: 31 migrations applied to a fresh database; second deploy was a no-op; schema diff reported no difference. A simulated existing history marked the baseline applied and ran the additive reconciliation; status was up to date and the existing workspace row count stayed `1` before/after. No Supabase/production connection or mutation was used for this phase.

## Final UI Polish and OCR Human Review (2026-09-29)

- Admin password reset is available at `POST /api/admin/users/:userId/reset-password`; only `admin` is allowed. Password hashing, refresh-token revocation, and audit logging run in one transaction. Audit metadata contains no plaintext password or hash. Existing access tokens remain stateless and may work until expiry.
- Award roster preview editing is limited to the current `DRAFT` decision and the existing Data Uploader issuer-workspace/Admin scope. `PATCH /api/award-decisions/:id/roster-preview/:sourceRow` accepts only canonical student identity fields (`studentCode`, `fullName`, `className`, `institutionText`); `DELETE /api/award-decisions/:id/roster-preview/:sourceRow/correction` reverts the overlay. Server-side preview recomputes institution resolution, account matching, validation, and duplicates from immutable raw rows, current mapping, and corrections. Mapping changes retain overlays; a replacement roster file has no inherited corrections. Confirm uses the same effective-row computation while holding the decision lock.
- Corrections are stored under `IndexingJob.resultJson.rowCorrections`; OCR/parser source rows remain in `sourceRows`. The preview returns source and effective canonical values plus correction state. Audit records include the row number, changed field names, and necessary before/after row values; confirmation audit remains count-only. Confirmed and archived decisions cannot be edited.
- Password reset, roster correction/revert, and authorization behavior have focused unit regressions. No Prisma schema or migration changed. The related DecisionImport, Event Registry, and Evidence OCR pipelines were inspected and left unchanged; no shared OCR editing framework was added. No production database was accessed or modified for this work.


## Phase 1.5 Contract Security Closure (2026-09-29)

- `GET /api/decision-imports/:id/audit` verifies the import's workspace and filters audit rows by both import ID and the row's own workspace. Admin retains global access; missing and cross-workspace imports both return not found.
- Resolution `PATCH /cases/:id/status` remains a deprecated case-only legacy mutation. It is denied to City Manager/Committee; City workflows use the transactional resolve endpoint.
- Initial submit and configured supplement-season cutoffs are enforced. Per-request due dates and review/final milestones remain informational.
- Criteria config exposes no write API; editing remains blocked. The read DTO is not the complete runtime criteria source. Award roster corrections and admin password reset are committed capabilities; Award-specific uploader history is still unavailable.

## AI/OCR consolidation audit (2026-09-29)

The following is the runtime-path audit baseline for the OpenAI extraction migration. It describes the code at the start of `backend/ai-ocr-audit`, with the Event Registry fake-row fallback corrected by this audit commit. CSV/XLSX remain deterministic local parsing paths; extracted document content is advisory until an explicit human confirmation endpoint is called.

| Flow and trigger | Current provider/format and timeout/retry | Persistence and consumer | Human gate / audit finding |
| --- | --- | --- | --- |
| Evidence OCR: evidence upload queues `evidence_ocr`; `JobsService` worker calls `processEvidenceOcrJob` | OpenAI Responses structured output for PDF/image; model `OPENAI_EVIDENCE_MODEL`; 30s timeout, SDK retry default configured as 1 | Evidence extraction/card fields and indexing result; student, evidence workspace, precheck read advisory values | `EvidenceCard` confirmation is separate and required before fields become trusted; human card confirmation remains the only trust gate. Existing OpenAI schema validator and safe error codes are reusable. Historical SmartReader adapter/types and old audit action names remain compatibility surfaces. |
| Award roster: Data Uploader starts `award_roster_ingestion` for current draft roster file | CSV/XLSX use the local roster parser; PDF currently uses SmartReader async table OCR (upload then polling, bounded by SmartReader timeout/poll settings); no Award OpenAI model yet | Raw `sourceRows`, mapping, preview, and `rowCorrections` are stored in `IndexingJob.resultJson`; Award repository recomputes effective rows | Mapping/correction/preview precede explicit `POST /:id/confirm`; confirmed recipient records are written only by human confirmation. Existing correction overlay must be preserved when replacing PDF provider. |
| DecisionImport upload: user uploads a decision PDF/image, then the service creates separate metadata and roster jobs | Upload currently calls VNPT SmartReader upload; metadata processor calls administrative-document extraction; roster processor calls asynchronous table OCR. PDF/image; SmartReader timeout/poll/retry configuration applies. No Decision-specific OpenAI models yet. | `DecisionDocument`, raw `DecisionTable`, `DecisionRosterPreviewRow`, `SmartReaderJob`, and `IndexingJob` persist extracted/preview data | Import preview, mapping, explicit confirm, and cancel are separate. Confirm can create Event Registry and participants. Raw tables/rows must stay immutable; the audit found no edit/revert API before this task. Corrections must be a separate overlay and confirm must use recomputed effective rows. |
| Event Registry roster: `POST /api/events/:id/.../start-indexing` creates `event_roster_indexing` | Existing contract is PDF/CSV/XLSX, not images. CSV parser is local. Before this audit fix, CSV read errors and every other format returned two filename-derived fake rows; no provider timeout existed. | Preview and suggested mapping are stored in `IndexingJob.resultJson`; `EventParticipant` is only changed by `confirm-index` | `confirm-index` is a human action, but fabricated rows could pass its normalizer and become official participants. Audit P1 fixed in this branch: processor errors now fail the job/file, audit only event-file ID and error code, and no preview is persisted; fake rows were deleted. PDF/XLSX extraction support is completed in the later Event roster branch. |
| Dashboard assistant narrative and student assistant: dashboard narrative endpoint and student assistant context/stream endpoints | OpenAI Responses streaming; models `OPENAI_ASSISTANT_MODEL` and `OPENAI_STUDENT_ASSISTANT_MODEL`; timeout/retry use configured OpenAI assistant values. Tests use explicit mocks. | Safe server-composed summaries and deterministic priority/status fields; response streams to existing assistant consumers | OpenAI writes only narrative text. Application facts, eligibility, priority, criteria status, and actions are computed by backend code; no model decision changes eligibility, task decisions, or final status. |
| Reviewer/student chatbot: authenticated `/api/chatbot/message`, `/stream`, and action routes; frontend `SmartbotPanel` consumes these contracts | Runtime currently combines local deterministic tools, Gemini intent/response, VNPT Smartbot, and VNPT Smartbot streaming. Smartbot timeout is configured; Gemini/provider calls use their own service configuration. No OpenAI chatbot model is wired yet. | Workspace-safe context, chat sessions/actions/handoffs, normalized cards; local tool/action APIs remain authoritative | Provider response guardrails/fallback are in place, but chat response migration must retain role/context access checks and API DTOs. Any write action still requires existing explicit action confirm/execute path. |
| Legacy AI/SmartUX routes | `/api/ai/chatbot/message` and `/api/smartux/*` point to placeholder services returning 501; no frontend request to these backend routes was found. Frontend still includes its separate VNPT SmartUX SDK integration. | No application data persisted by placeholder route | Keep or remove the backend placeholders only after consumer search remains clear; do not confuse the separate frontend analytics SDK with the backend placeholder API. |
| Worker runtime: `src/main.ts` starts `startJobWorkerLoop` | Polls one queued `IndexingJob` at a time; atomicity is single-job compare-and-set, but there is no bounded multi-job concurrency, automatic retry/backoff, stale-processing recovery, job timeout, or drain-before-idle behavior. | `IndexingJob` stores status, attempts, error, input, and result; no new schema is required for a JSON telemetry envelope or correction overlays | Existing Evidence/Award freshness guards are partial; DecisionImport/Event need current-file checks before result writes. Worker hardening must serialize cancellation-sensitive writes and never let stale file/job output replace current output. |

### Audit baseline and checks

- Active SmartReader extraction calls were found in Award PDF, DecisionImport metadata, and DecisionImport roster processors. Event Registry previously made no provider call and its fake-row fallback is removed by the audit change. Evidence already uses the OpenAI Responses API.
- `IndexingJob.resultJson` is sufficient for Event and DecisionImport correction overlays and extraction telemetry if overlays remain scoped by current file/job; no Prisma persistence change is justified by this audit.
- Shared document extraction now lives in `src/modules/ai/openai-document-extraction.ts`. It uses Responses strict JSON Schema, server-side validation, `store=false` by default, request-scoped IDs, timeout and measured bounded retries, usage counts, and normalized provider errors. Provider metadata omits entity IDs; OpenAI receives only a keyed pseudonymous safety identifier. Evidence extraction now calls this core with its existing schema and retains its existing `OPENAI_STORE_RESPONSES` setting; Award, DecisionImport, and Event will provide separate schemas/prompts on their domain branches.
- `OPENAI_EVIDENCE_MODEL`, `OPENAI_AWARD_ROSTER_MODEL`, `OPENAI_DECISION_MODEL`, `OPENAI_EVENT_ROSTER_MODEL`, `OPENAI_ASSISTANT_MODEL`, and `OPENAI_STUDENT_ASSISTANT_MODEL` default to `gpt-6-luna`. Document extraction uses the bounded shared `OPENAI_DOCUMENT_EXTRACTION_TIMEOUT_MS` and `OPENAI_DOCUMENT_EXTRACTION_MAX_RETRIES` values; prompt versions are separate by document use case.
- Award PDF roster extraction now uses the shared OpenAI core with a dedicated columns/rows schema and server-side row-width validation. The output becomes immutable preview `sourceRows` and still flows through the existing mapping, corrections, preview, and explicit confirm path. CSV and XLSX continue through `readRosterTable`; no roster format sends spreadsheet bytes to OpenAI.
- Baseline before Event fallback fix: `npm run build` passed; focused Award, Event Registry service, DecisionImport validation/audit, and Evidence OCR checks passed 9 files/72 tests; `npm run lint` completed with 33 existing warnings and no errors. The new Event Registry fallback regression was RED (2/2 failures) before the fix and GREEN afterward.
- No production database was accessed, no migration was added, and no official participant/recipient/application data was written by these tests.

### DecisionImport OpenAI migration progress (2026-09-29)

- New DecisionImport document extraction reads the stored source file directly. PDF is sent as Responses `input_file`; JPEG/PNG/WebP is sent as `input_image`. The provider receives generic filenames and no VNPT upload call is made. Existing CSV/XLSX local-parser behavior in Event/Award domains remains separate; DecisionImport upload continues to accept only PDF/images.
- Metadata and roster extraction use `OPENAI_DECISION_MODEL`, `OPENAI_DECISION_PROMPT_VERSION`, strict per-use-case JSON Schema, shared timeout/retry behavior, server-side Zod validation, and safe request/token/attempt telemetry. Roster rows are saved as immutable `DecisionTable.rawTableJson` and preview rows before confirmation. Neither processor creates a new `SmartReaderJob`; historical SmartReader/VNPT rows and nullable hash columns remain for compatibility reads.
- `POST /api/decision-imports/:id/files` replaces the current source inside a DB transaction after object upload, resets current job pointers/mapping, and clears only unconfirmed extraction tables, preview rows, and metadata. `POST /:id/start` no longer requires VNPT hashes. Processor results must still match the import's current file, workspace, and job pointer before persistence; stale results fail closed.
- DecisionImport roster corrections are available at `PATCH /api/decision-imports/:id/preview-rows/:rowId` and `DELETE /api/decision-imports/:id/preview-rows/:rowId/correction`. Existing officer/manager/admin route allowlist and workspace checks remain. Only canonical roster fields are accepted, and only before confirmation/cancellation. Corrections are keyed by source coordinates in the current roster `IndexingJob.resultJson.rowCorrections`; raw tables and raw preview row JSON are not changed. Mapping recomputation reuses corrections; a newly uploaded file gets a new job pointer and does not inherit them.
- Correction, mapping, replacement, cancellation, and confirmation serialize through a row lock on `DecisionImport`. Confirmation selects persisted effective preview rows only after obtaining that lock, so it cannot confirm a stale row set during a correction. Corrections/reverts recompute required-field warnings and duplicates server-side; audit metadata contains source coordinates and changed field names, not student values.
- DecisionImport processing labels and user-facing failure text are provider-neutral. Corrections wait until the current roster job reaches `completed`, preventing the worker's final telemetry write from overwriting a new correction overlay. Failure telemetry from the shared extraction core is retained in the existing job JSON with provider, use case, model, pseudonymous entity reference, request ID, latency, usage, attempts, retry count, and safe error code. Failed stale jobs cannot update the current import state.
- Focused migration checks on 2026-09-29: 8 files / 27 tests passed; `npm run build` passed; `npm run lint` had zero errors and the existing 33 `no-explicit-any` warnings. No schema or migration changed, and no production database was accessed. Event Registry PDF/XLSX extraction, Event row correction, worker concurrency/recovery, chatbot migration, evaluation fixtures/metrics, and legacy placeholder retirement are still pending in later branches.
- Event Registry migration on `backend/openai-event-registry`: PDF rosters now use the shared OpenAI Responses extractor with the strict `event_roster_table` schema and generic filename; CSV/XLSX remain on the shared local table reader. Upload and processor accept only matching PDF/CSV/XLSX extensions and MIME types; legacy `.xls` and images are rejected, and extraction failures never persist preview rows. `IndexingJob.resultJson.sourceRows` remains the immutable extraction snapshot; canonical row edits live separately in `rowCorrections`, rebuild the effective preview and quality, and are scoped to a specific event/file before confirmation. Confirmation locks EventRegistry then EventFile and consumes the current effective overlay. Audit events contain row number/field names or safe quality counts, not roster values. Added no schema or migration. Focused Event/roster regressions pass 8 files / 33 tests and backend build passes; lint retains the existing 33 warnings. No database or production service was contacted.
- Worker hardening on `backend/job-worker-hardening`: `JobsRepository` claims up to `JOB_WORKER_CONCURRENCY` (default 3, validated maximum 10) in one PostgreSQL `UPDATE ... FOR UPDATE SKIP LOCKED` statement. Retryable errors requeue only before `JOB_WORKER_MAX_ATTEMPTS` (default 4), with exponential backoff capped by configuration; stale processing leases are recovered and permanently failed at the attempt limit. Signed object downloads have a 30-second default timeout, and shutdown drains the active job/mail tick before disconnecting Prisma. Database claim/recovery integration coverage is gated on an explicitly designated local disposable `WORKER_TEST_DATABASE_URL`; it was skipped because none was supplied. Worker unit regressions pass 17 tests; build passes; lint retains the existing 33 warnings. No migration or database access was made.
