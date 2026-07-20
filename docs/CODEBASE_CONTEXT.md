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
