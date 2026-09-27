# Phase 4 Part 3C Application Management MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe cancellation, reopening, and archival for City individual applications while preserving the five-task review and Part 3B deadline workflows.

**Architecture:** Add nullable lifecycle fields and immutable final-decision history. Centralize locking and cancellation policy in a focused application lifecycle policy/service. Enforce backend hard-stops before exposing lifecycle controls in the frontend.

**Tech Stack:** Existing Express, Prisma, PostgreSQL/Supabase, React, React Query, and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-phase4-part3c-application-management-mvp-design.md`

## Starting point and preparation

- Backend base: `8260bfd01186623dbc69fb8fe7d0077cb8f067ad`; frontend base: `4689f0e29a6781b87842098e8ff1b7694ea02101`. Work directly on `main`; no branch, worktree, PR, reset, cleanup, or force push.
- Fetch and `git pull --ff-only` each repo after recording status/branch/HEAD. Stop on unexplained tracked changes; preserve untracked artifacts such as frontend `__pycache__`.
- The spec metadata and unsubmitted-draft question were finalized in `fce257fd0f9787250bcd87943d93d025914310f4`. Approved clarifications also record the cancelled aggregation GET audit behavior and City manager/admin student-content restriction.
- Commit this plan as `docs: plan phase 4 part 3c application management mvp`; push only after implementation checks and review.

## Global constraints

- Keep exactly five City tasks (ethics, academic, physical, volunteer, integration); priority never creates task six.
- Human decisions are canonical; AI/OCR/Rules are advisory; 5/5 does not finalize. Eligibility remains a hard gate for initial submission.
- Reuse Part 3B season/deadline/exception APIs, calculations, models, tests, and UI. Do not recreate them.
- Cancellation starts only after submission or a current final exists; require a reason; never hard-delete official data.
- `cancelledAt IS NULL` defines current official results/workflow. Archive changes default manager-list visibility only and does not remove a non-cancelled result from official analytics/exports.
- Do not allow managers/admins to change student-owned content on City individual applications. Preserve non-City behavior and authorized staff workflow actions.
- Additive migration only; no ApplicationStatus/ReviewTaskStatus enum changes, generic lifecycle engine, broad refactor, or unrelated cleanup.
- Direct `main`, small cohesive commits, TDD, and no lifecycle UI before backend cancellation hard-stops are complete.

## Review Focus

1. Cancel/finalize race leaves no current final after cancellation wins — Task 13 transaction tests.
2. Any cancelled application-bound adjudication write continues — Tasks 5A/5B no-side-effect tests.
3. Superseded final leaks into current API/analytics/export — Tasks 7–9 history/exclusion tests.
4. Archived active final disappears from official results — Tasks 7–9 archive semantics tests.
5. Reopen corrupts or recreates the five tasks — Tasks 3, 6, 13, and 14 retain-ID/count tests.

## File Map / Responsibilities

**Backend:** `prisma/schema.prisma`; `src/shared/constants/application.ts`; `src/shared/errors/error-codes.ts`; `src/modules/applications/application.helpers.ts`, `applications.service.ts`; all relevant `src/modules/evidences/*` and `src/modules/criteria-completion/*`; `src/modules/review/review.service.ts`, `review.repository.ts`, `review-assignment.service.ts`; `src/modules/resolution/resolution.service.ts`; `src/modules/manager/manager.routes.ts`, `manager.controller.ts`, `manager.validation.ts`, `manager.service.ts`, `city-review-seasons.service.ts`; `src/modules/analytics/city-analytics.service.ts`, `city-analytics.dto.ts`, `city-analytics.validation.ts`; `src/modules/exports/exports.service.ts`, `exports.validation.ts`; tests named in Tasks 1–9 and existing `tests/unit/city-review-seasons.test.ts`, `manager-aggregation.test.ts`, `city-analytics.service.test.ts`, `city-analytics.routes.test.ts`, `city-resolution-audit-exports.test.ts`, `applications-city-submission-gate.test.ts`, and `applications-city-supplement.test.ts`.

**Frontend:** `src/features/manager/api/manager.ts`, `hooks/useManager.ts`, `types.ts`; `src/routes/app.manager.results.tsx`, `src/routes/app.manager.results.$applicationId.tsx`; existing detail components; `CitySubmissionDeadlineExceptionPanel`, `CityReviewSeasonAdministration`, `src/components/audit/AuditTimeline.tsx`; `tests/phase4-application-lifecycle.spec.ts`. Read `docs/CODEBASE_CONTEXT.md` in both repos and frontend `docs/UI_GUIDE.md` before edits. Do not hand-edit `src/routeTree.gen.ts`.

## Implementation tasks

### Preparation: Finalize spec and publish the plan

**Files:** Modify the approved spec only if stale; create this plan. **Interfaces:** verified repo state and business decisions → spec/plan commits.

- [ ] Verify status, branch, HEAD, fetch/pull, scripts, and preserve untracked artifacts.
- [ ] Read the full spec; update only stale metadata, closed unsubmitted-draft decision, and approved codebase clarifications.
- [ ] Run `git diff --check`; commit spec-only change as `docs: finalize part 3c application management design` if needed.
- [ ] Create this file; run `git diff --check`; commit `docs: plan phase 4 part 3c application management mvp`.
- [ ] Record actual base and documentation SHAs.

### Task 1: Add lifecycle persistence and final-decision history

**Files:** Create migration `prisma/migrations/20260928120000_application_lifecycle_overlays_and_final_history/migration.sql` and `tests/unit/application-lifecycle-schema.test.ts`; modify `prisma/schema.prisma`.

**Interfaces:** Existing Application/final fields → nullable cancellation/archive fields and immutable `ApplicationFinalDecisionHistory` per spec, with user relations/indexes.

- [ ] Test nullable lifecycle fields, all spec history fields, and additive-only SQL; run RED `pnpm exec vitest run tests/unit/application-lifecycle-schema.test.ts`.
- [ ] Add fields/model/migration only; no enum change or backfill.
- [ ] Run GREEN with the same Vitest command; nearby checks `pnpm exec prisma validate` and inspect SQL.
- [ ] Commit `feat: add application lifecycle persistence`.

### Task 2: Add the shared cancellation policy

**Files:** Create `src/modules/applications/application-lifecycle.policy.ts`, `tests/unit/application-lifecycle-policy.test.ts`; modify `src/shared/errors/error-codes.ts`.

**Interfaces:** `lockApplicationAndAssertNotCancelled(tx: Prisma.TransactionClient, applicationId: string): Promise<void>`; cancelled → HTTP 409 `APPLICATION_CANCELLED`, message `Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.`

- [ ] Test locked active pass and cancelled 409/code/message; run RED `pnpm exec vitest run tests/unit/application-lifecycle-policy.test.ts`.
- [ ] Implement parameterized Application row lock and one shared policy helper.
- [ ] Run GREEN with the same command; nearby regression `pnpm exec vitest run tests/unit/applications-city-submission-gate.test.ts`.
- [ ] Commit `feat: enforce cancelled application policy`.

### Task 3: Add lifecycle service and manager API

**Files:** Create `src/modules/applications/application-lifecycle.service.ts`, `tests/unit/application-lifecycle.service.test.ts`; modify existing manager routes/controller/validation.

**Interfaces:** City Manager/admin only, City individual scoped endpoints `/api/manager/applications/:id/{cancel,reopen-cancelled,archive,unarchive}`.

- [ ] Test role/scope, required reasons, submitted-or-final-only cancellation, repeat conflicts, atomic cancel-final snapshot/reset/audit/notification, reopen/no task recreation/no final restoration/auto-unarchive/status, and archive eligibility.
- [ ] Run RED `pnpm exec vitest run tests/unit/application-lifecycle.service.test.ts`.
- [ ] Implement focused service/routes; keep lifecycle/history/audit/notification writes transactional.
- [ ] Run GREEN with the same command; nearby `pnpm exec vitest run tests/unit/manager-city-scope.test.ts tests/unit/city-review-seasons.test.ts`.
- [ ] Commit `feat: manage City application lifecycle`.

### Task 4: Preserve history in existing reopen-final

**Files:** Modify `src/modules/manager/manager.service.ts`; create `tests/unit/manager-reopen-final-history.test.ts`.

**Interfaces:** Existing City Manager/Committee/admin authority → immutable snapshot before final reset.

- [ ] Test allowed roles, snapshot/reset, and no duplicate history; run RED `pnpm exec vitest run tests/unit/manager-reopen-final-history.test.ts`.
- [ ] Add snapshot to existing transaction without changing its authorization/workflow semantics.
- [ ] Run GREEN with the same command; nearby `pnpm exec vitest run tests/unit/manager-aggregation.test.ts`.
- [ ] Commit `fix: preserve superseded final decisions`.

### Task 5A: Hard-stop adjudication and staff workflow writes

**Files:** Modify review, resolution, manager, eligibility-verification services and tests; create `tests/unit/application-cancelled-adjudication-writes.test.ts`.

**Interfaces:** Shared cancellation policy → guarded review/manager/resolution/verification writes; reads remain available.

- [ ] Test `claimTask`, `markTaskStarted`, `decideTask`, `requestSupplement`, `escalateResolution`, `ensureReviewTasks`, `assignTask`, `reassignTask`, `aggregateApplication`, `finalizeApplication`, `resolveCase`, `updateCaseStatus`, `reopenCase`, and eligibility verification; cancelled calls return 409 with zero task/case/final/audit/notification/outbox writes.
- [ ] Test cancelled aggregation GET remains readable with no aggregation audit; active behavior stays intact. Test City manager/admin cannot edit City student-owned content, while non-City and staff verification compatibility remain.
- [ ] Run RED `pnpm exec vitest run tests/unit/application-cancelled-adjudication-writes.test.ts`.
- [ ] Apply shared guard before side effects; keep lock order Application → task/case/evidence and recheck inside finalize transaction before cascades/final/audit/notification/outbox.
- [ ] Run GREEN with the same command; nearby `pnpm exec vitest run tests/unit/review-ensure-tasks.test.ts tests/unit/review-workspace-scope.test.ts tests/unit/manager-aggregation.test.ts tests/unit/city-submission-eligibility.test.ts`.
- [ ] Commit `fix: stop City adjudication writes after cancellation`.

### Task 5B: Hard-stop student, evidence, criteria, and deadline writes

**Files:** Modify application, evidence, criteria-completion, and CityReviewSeasons services/routes/tests; create `tests/unit/application-cancelled-input-writes.test.ts`.

**Interfaces:** Ownership/workspace checks plus shared cancellation policy → guarded student-content/evidence/deadline writes; advisory OCR completion may finish without restarting workflow.

- [ ] Test target/draft update, supplement reopen/resubmit, criterion responses/declarations/deletes, evidence create/upload/update/delete/indexing/card correction/confirmation, and Part 3B exception grant/revoke; assert exact 409 and no related DB/job/audit/notification/outbox mutation.
- [ ] Test OCR can update advisory extraction metadata only; no review task/workflow restart. Test manager/admin City student-content denial and non-City compatibility.
- [ ] Run RED `pnpm exec vitest run tests/unit/application-cancelled-input-writes.test.ts`.
- [ ] Guard before mutation; preserve authorization-before-disclosure; clean up uploaded object if cancellation wins before DB commit.
- [ ] Run GREEN with the same command; nearby `pnpm exec vitest run tests/unit/applications-city-supplement.test.ts tests/unit/evidence-card-confirmation.test.ts tests/unit/criteria-completion.test.ts tests/unit/city-review-seasons.test.ts`.
- [ ] Commit `fix: block cancelled City application input writes`.

### Task 6: Exclude cancelled work from queues and workload

**Files:** Modify `review.repository.ts`, `review-assignment.service.ts`, related manager counts; create `tests/unit/application-lifecycle-queue-scope.test.ts`.

**Interfaces:** Retained ReviewTasks → hidden from active queues/workload while cancelled, visible again on reopen; collective tasks unchanged.

- [ ] Test retained task rows excluded from officer/manager queues and active workloads, and reappear with same IDs/decisions after reopen; run RED `pnpm exec vitest run tests/unit/application-lifecycle-queue-scope.test.ts`.
- [ ] Filter application-bound tasks by non-cancelled application without changing task status or collective behavior.
- [ ] Run GREEN with the same command; nearby `pnpm exec vitest run tests/unit/review-workspace-scope.test.ts`.
- [ ] Commit `fix: exclude cancelled applications from review queues`.

### Task 7: Align City analytics with current lifecycle

**Files:** Modify City analytics service/DTO/validation and `tests/unit/city-analytics.service.test.ts`.

**Interfaces:** Current official analytics exclude cancelled, report separate `cancelledCount`, and include archived non-cancelled applications.

- [ ] Test cancelled exclusion from results, denominators, 0/5–5/5, schools, supplement/resolution, and reviewer workload; archived finals remain included; run RED `pnpm exec vitest run tests/unit/city-analytics.service.test.ts`.
- [ ] Apply same filter consistently and calculate cancelled count separately.
- [ ] Run GREEN with same command; nearby `pnpm exec vitest run tests/unit/city-analytics.routes.test.ts`.
- [ ] Commit `fix: exclude cancelled applications from current City analytics`.

### Task 8: Align export lifecycle semantics

**Files:** Modify exports service/validation and tests; create `tests/unit/exports-application-lifecycle.test.ts`.

**Interfaces:** Official result export always excludes cancelled; management export defaults active with explicit lifecycle selection where supported.

- [ ] Test cancelled/superseded results omitted and archived current finals included; management export active/cancelled/all filters; run RED `pnpm exec vitest run tests/unit/exports-application-lifecycle.test.ts`.
- [ ] Add mandatory official exclusion and management filter without changing response format.
- [ ] Run GREEN with same command; nearby `pnpm exec vitest run tests/unit/city-resolution-audit-exports.test.ts`.
- [ ] Commit `fix: align application exports with lifecycle state`.

### Task 9: Extend manager list, result, and detail APIs

**Files:** Modify manager routes/controller/validation/service; create `tests/unit/manager-application-lifecycle.test.ts`.

**Interfaces:** Existing filters plus lifecycle/archive; defaults `lifecycle=active`, `archive=exclude`. Detail adds lifecycle/history and preserves existing five tasks, reviewer, supplement, Resolution, audit, deadline/exception, and current final fields.

- [ ] Test defaults, explicit discovery filters, workspace scope, detail history, and archived active finals in results; run RED `pnpm exec vitest run tests/unit/manager-application-lifecycle.test.ts`.
- [ ] Extend existing contracts additively; preserve old clients and City Manager scope.
- [ ] Run GREEN with same command; nearby `pnpm exec vitest run tests/unit/manager-city-scope.test.ts tests/unit/city-review-seasons.test.ts`.
- [ ] Commit `feat: expose application lifecycle in manager APIs`.

### Task 10: Add frontend API types and query hooks

**Files:** Modify manager API/hooks/types; create `tests/phase4-application-lifecycle.spec.ts`.

**Interfaces:** Task 9 backend contract → typed filters/mutations and invalidations for list/detail/analytics/dashboard/workloads/queues/results/deadline data.

- [ ] Add API-mock regression for filters, mutation bodies, and refetch invalidation; run RED `pnpm exec playwright test tests/phase4-application-lifecycle.spec.ts`.
- [ ] Add only contract-backed types/hooks; server remains authoritative.
- [ ] Run GREEN with same command and `pnpm exec tsc --noEmit`, compared with 193-diagnostic baseline.
- [ ] Commit `feat: add manager application lifecycle API hooks`.

### Task 11: Add lifecycle filters and visibility to manager list

**Files:** Modify `src/routes/app.manager.results.tsx`, existing list components, and lifecycle Playwright spec.

**Interfaces:** Task 10 queries → active/default list with lifecycle/archive filters and separate workflow/lifecycle badges.

- [ ] Test defaults, cancelled discoverability, and existing search/year/school/status/result filters; run RED `pnpm exec playwright test tests/phase4-application-lifecycle.spec.ts --grep "manager list"`.
- [ ] Extend existing list; do not create a new console.
- [ ] Run GREEN with same command; nearby `pnpm exec playwright test tests/phase4-city-analytics.spec.ts`.
- [ ] Commit `feat: add application lifecycle filters to manager list`.

### Task 12: Add lifecycle actions and final history to manager detail

**Files:** Create `ApplicationLifecycleActions.tsx`, `ApplicationFinalDecisionHistory.tsx`; modify manager detail route and lifecycle Playwright spec.

**Interfaces:** Task 10 contract → City Manager/admin actions and read-only history, reusing deadline, Resolution, Final, and audit UI.

- [ ] Test role visibility, reason validation, final-cancel confirmation and exact warning, exact 409 copy, archive/unarchive, refetching, Part 3B panel retention, and absence of Delete; run RED `pnpm exec playwright test tests/phase4-application-lifecycle.spec.ts --grep "manager detail"`.
- [ ] Implement focused components; City Committee and all other roles see no lifecycle controls.
- [ ] Run GREEN with same command; nearby `pnpm exec playwright test tests/phase4-city-analytics.spec.ts tests/student-application-ui-v2-acceptance.spec.ts`.
- [ ] Commit `feat: add application lifecycle controls to manager detail`.

### Task 13: Verify lifecycle concurrency with real transactions

**Files:** Create `tests/integration/application-lifecycle-concurrency.test.ts`; modify locking only if tests expose a race.

**Interfaces:** Real PostgreSQL transactions → serialized cancel/finalize/reopen/archive outcomes without duplicate history.

- [ ] Test cancel-wins/finalize-409, finalize-wins/cancel-snapshots, cancel/cancel, cancel/reopen, reopen-final/cancel, archive/reopen.
- [ ] Run RED and GREEN with `DATABASE_URL="${SUPABASE_TEST_DATABASE_URL:?Set approved hackathon/dev database URL}" pnpm exec vitest run tests/integration/application-lifecycle-concurrency.test.ts`.
- [ ] Use unique fixture prefixes; cleanup and verify only test-owned records.
- [ ] Commit `test: verify application lifecycle transaction races`.

### Task 14: Run full City rehearsal and update context docs

**Files:** Update `docs/CODEBASE_CONTEXT.md` in both repos and lifecycle integration/Playwright tests.

**Interfaces:** Tasks 1–13 → verified City end-to-end operation path and current context documentation.

- [ ] Test eligibility → initial submit → exactly five tasks → assign → human decisions → supplement/resubmit → Resolution → aggregate → Final → Cancel/history/exclusion → Reopen/re-finalize → Archive/Unarchive.
- [ ] Regress Part 3B season, submission close, exception, supplement deadline, and cancelled exception mutation.
- [ ] Run RED for uncovered integration/Playwright cases, then add the minimal regression.
- [ ] Update both context docs; mark only observed checks as passing.
- [ ] Run focused tests, Prisma validate/generate, backend/frontend build/lint, `pnpm exec tsc --noEmit`, targeted Playwright, and full unit suites.
- [ ] Run DB integration only with explicit Supabase `DATABASE_URL`, unique fixtures, and verified test-only cleanup.
- [ ] Commit docs and final rehearsal tests separately.

## Checkpoints

- **A — Lifecycle Core:** Tasks 1–5B; schema, lifecycle API/history, all critical backend write hard-stops green before UI actions.
- **B — Operational Consistency:** Tasks 6–9 and 13; queues, analytics, exports, manager APIs, and real concurrency match lifecycle semantics.
- **C — Usable Frontend:** Tasks 10–12; list/detail actions and history work, existing Part 3B/Resolution/Final/audit preserved.
- **D — Rehearsal:** Task 14; full City flow and Part 3B regressions verified.

## Deployment and compatibility

1. Apply additive nullable-field/history migration to the verified hackathon/dev Supabase database.
2. Deploy backend support for nullable lifecycle fields, then cancellation guards and endpoints.
3. Deploy queue/list/analytics/export semantics.
4. Deploy frontend controls only after backend hard-stops are live.

Keep existing endpoints, response fields, JWT, roles, workflow enums, and collective behavior compatible. Use explicit `DATABASE_URL` sourced from the approved Supabase dev credential; never let tests fall back to localhost. Repository pre-push hooks run normally. If a hook fails solely on DB fallback/credentials, manually run equivalent checks with explicit URL, capture output, and only then consider a one-time skip; never modify hooks and report any skip.

## Safe parallelism

Sequential: preparation → 1 → 2 → 3 → 4 → 5A/5B. After hard-stops, Tasks 6/7/8 may parallelize. Task 9 follows 3/6/7/8; Task 10 follows 9; Tasks 11/12 may parallelize after the frontend contract is fixed; Task 13 follows 3–5; Task 14 is last.

Dependency graph: `Preparation → 1 → 2 → 3 → 4 → (5A + 5B) → (6 + 7 + 8) → 9 → 10 → (11 + 12) → 14`; `3 + 5A → 13 → 14`.

## Completion report and self-review

Report actual backend/frontend starting and ending SHAs, spec/plan commits, exact plan path, changed files, checkpoint/task results, migration order, tests, 193-diagnostic comparison, integration environment, pre-push skip if any, and whether frontend files changed. Before completion confirm every spec requirement is mapped, no decisions remain open, shared interfaces match, all Review Focus tests exist, exactly-five behavior and Part 3B reuse are verified, archive never affects official status, cancelled/superseded finals cannot leak, backend safety precedes UI, and no broad refactor was introduced.
