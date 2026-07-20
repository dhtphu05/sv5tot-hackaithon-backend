# Criteria Completion Post-Implementation Audit

Date: 2026-07-18

Scope: audit the implemented Requirement Tree, Criteria Completion, Precheck, Overview, Submit, Supplement, backfill, and frontend integration for the five student criteria. This pass did not perform a visual redesign.

## Repository State

Backend:
- Repo: `D:\02_PROJECTS\5TOT\sv5tot-hackaithon-backend`
- Branch: `feat/sth`
- HEAD: `6dc2db70ad167f6eae5b318d5e81bfce05b4f577`
- New key areas: `src/modules/criteria-completion`, `prisma/migrations/20260717110000_requirement_completion`, `prisma/migrations/20260717123000_metric_metadata`, `scripts/backfill-requirement-responses.ts`
- Existing dirty worktree was preserved. No unrelated changes were reverted.

Frontend:
- Repo: `D:\02_PROJECTS\5TOT\namtot`
- Branch: `feat/sth`
- HEAD: `088e7d798d68c6f375e129b10d3e13353a660218`
- New key areas: completion-aware student overview/action workspace, admin workspace routes, completion API types and hooks.
- Existing dirty worktree was preserved. No unrelated changes were reverted.

## Fixes Applied During Audit

Backend:
- Fixed student evidence warning compatibility in `src/shared/dto/evidence-student-status.ts`.
- `official_match_not_found` now maps to the legacy official-match-not-found label/message instead of the generic manual-upload copy.
- Verified by rerunning focused backend unit tests.

Frontend:
- Fixed stale completion cache after official event/evidence imports.
- Updated:
  - `D:\02_PROJECTS\5TOT\namtot\src\features\event\hooks\useEvents.ts`
  - `D:\02_PROJECTS\5TOT\namtot\src\features\event\hooks\useEvent.ts`
  - `D:\02_PROJECTS\5TOT\namtot\src\features\event\hooks\useApprovedEvidenceSearch.ts`
- These hooks now invalidate `applicationKeys.criteriaCompletion(applicationId)` after import success.

Earlier fixes still relevant to this audit:
- `src/modules/audit/audit.service.ts`: switched audit create input to connect workspace relation.
- `src/modules/resolution/resolution.service.ts`: added view authorization before resolving a case.

## Migration Audit

Reviewed migrations:
- `20260717110000_requirement_completion`
- `20260717123000_metric_metadata`

Result:
- No destructive `DROP`, `RENAME`, or data-loss migration found.
- `ApplicationRequirementResponse` is a new table with workspace/application/metric/evidence/user foreign keys.
- `ApplicationMetric` receives nullable metadata columns: `schoolYear`, `source`, `supportingEvidenceId`.
- Existing data is not forced through new non-null columns.

Risk:
- `ApplicationRequirementResponse.updatedAt` is Prisma-managed. Raw SQL inserts must provide it.
- There is no DB-level uniqueness constraint for idempotent backfill rows. Script-level `findFirst` prevents duplicates in normal reruns, but concurrent backfill runs could still duplicate.

Current DB status:
- `npx prisma migrate status` against the configured `.env` database reported schema up to date.
- The configured database is a remote Supabase pooler endpoint. No non-dry-run backfill or data update was executed during this audit.

## Backfill Audit

Reviewed `scripts/backfill-requirement-responses.ts`.

Observed behavior:
- Supports `--dry-run`.
- Links legacy GPA and conduct-score metrics to `academic_gpa` and `conduct_score`.
- Maps old `volunteer_days` style data to a requirement response with `needs_verification`; it is not treated as verified.
- Maps legacy language metric to generic `foreign_language`; it does not assume IELTS/TOEIC.
- Uses `legacy_unclassified` when evidence cannot be safely classified.
- Populates/fixes `workspaceId` on requirement responses and related files.
- Does not log raw OCR, file URLs, or obvious PII in the reporting path observed.

Operational note:
- Run dry-run first on any target DB:
  `npx tsx scripts/backfill-requirement-responses.ts --dry-run`
- Only run without `--dry-run` after confirming the target DB is intended.

## API Smoke

Ran against local backend at `http://127.0.0.1:8080`.

Student API smoke:
- `POST /api/auth/login`: OK, returns `accessToken`.
- `GET /api/applications/current`: OK.
- `GET /api/applications/:id/criteria-completion`: OK, returned 5 completion items for the current application.
- `GET /api/applications/:id/timeline`: OK, returned timeline items.
- `POST /api/applications/:id/ethics/no-violation/confirmation` as student: blocked with `403`.

This confirms the critical guard that a student cannot self-verify `no_violation`.

## Static Checks And Tests

Backend:
- `npx prisma validate`: passed.
- `npx prisma generate`: passed earlier in this pass.
- `npx prisma migrate status`: passed, schema up to date on configured DB.
- `npm run build`: passed.
- `npm run lint`: passed with existing warnings only.
- Focused unit tests passed:
  - `tests/unit/criteria-completion.test.ts`
  - `tests/unit/precheck-completion.test.ts`
  - `tests/unit/application-metric-helpers.test.ts`
  - `tests/unit/evidence-student-status.test.ts`
  - `tests/unit/review-progress.test.ts`
  - `tests/unit/review-task-detail.test.ts`
  - `tests/unit/manager-aggregation.test.ts`
  - `tests/unit/rules-engine.test.ts`
  - `tests/unit/auth-middleware-workspace.test.ts`
  - `tests/unit/admin-workspaces.routes.test.ts`
  - `tests/unit/admin-workspaces.service.test.ts`
- Result: 11 files passed, 92 tests passed.

Integration tests run earlier after the backend fixes:
- `tests/integration/non-ai-application-flow.test.ts`: passed.
- `tests/integration/workspace-isolation-flow.test.ts`: passed 8 tests.

Frontend:
- `npm run build`: client build passed, SSR build passed, Nitro/Vercel packaging failed.
- Packaging failure:
  `The requested module '@vercel/nft' does not provide an export named 'nodeFileTrace'`
- This is a deployment packaging blocker, not a source compile failure.
- Full `npm run lint` was previously not practical because it hung/ran too long.
- Source ESLint previously reported existing errors/warnings in unrelated areas such as draft/admin/event/mock code. These were not introduced by the completion-flow patch.

## Browser Smoke

Dev servers:
- Backend: `http://127.0.0.1:8080`
- Frontend: `http://127.0.0.1:8081`
- Frontend was restarted with `VITE_API_BASE_URL=http://127.0.0.1:8080`.

Unauthenticated route guard smoke:
- Checked key student, officer, manager, resolution, collective, and admin routes.
- Protected routes rendered the login shell or redirected as expected.
- No route-level error boundary was observed.

Login smoke:
- Login page renders.
- Quick-role buttons update the form, proving React handlers attach.
- Backend login API succeeds with the default student account.
- In the in-app browser, the login UI did not transition into `/app` after submit during this audit, so authenticated browser traversal of the new criterion screens was not completed.

Console:
- In-app browser showed hydration mismatch related to injected `<html>` attributes such as `data-smartux-useragent`.
- This appears connector/browser-extension related, but should be rechecked in normal Chrome before release.

Mobile smoke:
- Not completed in this audit because authenticated browser traversal was blocked.

## Compatibility Audit

Legacy concepts still present:
- `foreign_language_score`
- older student workspace component paths
- `readinessScore`
- `nextBestAction`
- older copy/status helpers

Classification:
- Keep for compatibility where older APIs/routes/components still consume it.
- New student overview/action workspace and precheck paths should consume Criteria Completion as the source of truth.
- Do not remove migrations or legacy data.

Notable compatibility behavior:
- Current frontend API normalizers still map legacy language metric aliases into `foreign_language_score`.
- Backend review/rules compatibility still accepts old metric shapes where required.
- New criteria-completion routes provide the actual requirement-tree view.

## Issue Classification

P0 open:
- None found in this audit.

P1:
- Frontend Nitro/Vercel packaging fails due `@vercel/nft` / `nf3` export mismatch. Source client and SSR builds pass, but deploy packaging is not green.
- Authenticated browser smoke is incomplete. Backend auth/API works, but in-app browser did not navigate after login submit, so desktop/mobile criterion screen verification still needs a normal-browser pass.

P2:
- Hydration mismatch in in-app browser from injected `<html>` attributes. Recheck in Chrome without connector injection.
- Backfill idempotency is script-level, not DB-enforced. Do not run multiple backfill instances concurrently.
- Frontend source lint has pre-existing errors/warnings outside the completion integration.
- Legacy labels/code remain in compatibility paths and should be cleaned during the next UI refactor, after route usage is confirmed.

Fixed during audit:
- Stale completion cache after event/evidence import.
- Evidence warning label compatibility for `official_match_not_found`.

## Endpoint Impact Summary

Confirmed working:
- auth login
- current application
- criteria completion
- timeline
- student role guard for officer-only `no_violation` confirmation
- backend focused completion/precheck/unit contracts
- backend integration workspace isolation

Not exhaustively rechecked by direct HTTP during this audit:
- every specialized mutation for the five criteria
- officer/manager review flows through browser
- supplement scoped browser editing
- mobile authenticated screen layout

The untested areas are partly covered by unit/integration tests, but still need one manual authenticated browser pass before UI refactor begins.

## Final E2E Browser/API Pass On 2026-07-18

Scope:
- Student signup and individual application lifecycle using `vanngocnhuy30032006+test12@gmail.com`.
- Officer review decisions across the five criteria.
- Supplement request and same-application resubmit.
- Resolution Hub escalation and committee decision.
- Manager aggregation/finalization.
- Student final status and mail outbox.

Confirmed:
- Signup and application creation succeeded.
- Student cannot self-verify `no_violation`; officer-only guard returns `403`.
- Requirement completion/precheck returns requirement-specific next action labels and no longer treats inactive `one_of` alternatives as missing.
- Submit with warnings is allowed only with explicit warning confirmation.
- Review tasks were created and accepted across all five criteria.
- Physical supplement request worked; student added scoped physical evidence and resubmitted the same application.
- Volunteer resolution case was opened, resolved by committee, and propagated back to the review task.
- Manager finalized the application after all human review tasks were accepted.
- Student application API returned `completed`, `passed`, `school`.
- Email outbox had four sent messages for submit, supplement requested, resubmit, and result announced.

Fixes made during the pass:
- Added faculty normalization for officer/faculty scope checks.
- Changed completion pending selection to prioritize `needs_verification` over `declared`.
- Fixed precheck `one_of` missing/needs-verification computation and needs-verification action labels.
- Fixed manager finalize guard so an aggregation-only `completed`/`pending` application is still finalizable.
- Allowed finalization to proceed when all review tasks are human-accepted even if legacy cascade recomputation still disagrees; the mismatch is audited instead of becoming a hard blocker.

Known UX issues observed:
- Student page can show `Đã xác nhận` and still show raw completion metadata like `1 mục cần xác minh`.
- Volunteer can show `0/4 điều kiện có dữ liệu` even after human/committee acceptance, because the count is raw requirement data and not review outcome.
- In-app Browser role switching stayed on the student session, so officer/committee browser pages still need a fresh-session pass.
- Login accessible labels are ambiguous enough to make automation brittle.
- SmartUX/Statsig console noise appears in Browser but did not crash the app.

Verification:
- Backend `npx prisma validate`: passed.
- Backend `npx prisma generate`: passed after stopping backend dev watch that held the Prisma engine DLL.
- Backend `npm run build`: passed.
- Backend `npm run lint`: passed with 18 existing warnings.
- Backend focused tests passed: `faculty-utils`, `criteria-completion`, and `precheck-completion` (51 tests).
- Current shell invocation of `tests/integration/non-ai-application-flow.test.ts` failed because local PostgreSQL at `localhost:5432` was unreachable.
- Frontend `npm run build`: passed including Nitro/Vercel output.

## DB And Restart Guidance

For the currently configured DB:
- No migration update is needed right now; `migrate status` says up to date.
- Do not run non-dry-run backfill against the remote Supabase DB unless that DB is explicitly the intended target.

For a fresh/local DB:
- Run migrations first.
- Run `npx prisma generate`.
- Run the backfill with `--dry-run`.
- Review counts.
- Run without `--dry-run` only on the intended database.
- Restart backend after migration/generate.
- Restart frontend if `VITE_API_BASE_URL` or generated route/build output changed.

## Readiness For UI Refactor

Ready:
- Backend completion/precheck core is stable enough for UI refactor.
- Requirement-response model, service actions, API shape, and focused tests are in place.
- Student-facing overview/action workspace is wired to completion status.

Not yet ready to call release-complete:
- Vercel/Nitro packaging blocker remains.
- Authenticated desktop/mobile browser smoke needs a clean pass.
- Frontend lint debt should be separated from this business-flow work or cleaned before release hardening.

## Remediation Result

Date: 2026-07-18

P1 remediation completed:
- Fixed the frontend Nitro/Vercel packaging blocker by adding a direct dev dependency on `@vercel/nft@1.10.2` and pinning `nf3` to `0.3.22` through `pnpm.overrides`. `npm run build` now completes client build, SSR build, and Nitro/Vercel output generation.
- Fixed local authenticated browser login from `http://127.0.0.1:8081` by adding a development/test-only loopback-equivalent CORS origin helper. Production CORS still requires exact configured origins.
- Fixed `/app/application` route crash caused by an out-of-scope `summary` reference in `ApplicationMiniStatusBar`.
- Fixed latent route crashes in the path-based panels by passing physical/volunteer/integration mutations through `CriterionWorkspace` props and by guarding optional completion arrays from the API.

Additional cleanup:
- Replaced `any` in `src/features/event/hooks/useEvent.ts` event key typing with `GetEventsParams`.
- Formatted `src/features/application/components/StudentApplicationActionWorkspace.tsx` after the route-crash fix.

Verification after remediation:
- Backend `npx prisma validate`: passed.
- Backend `npx prisma generate`: passed after stopping the running dev server that had locked Prisma's Windows query engine DLL.
- Backend `npm run build`: passed.
- Backend `npm run lint`: passed with warnings only.
- Backend focused tests: 12 unit test files passed, 95 tests passed. The two DB integration suites were invoked but failed because local PostgreSQL at `localhost:5432` was not reachable; this was an environment/database availability failure, not a test assertion failure.
- Frontend `npm run build`: passed, including Nitro/Vercel packaging.
- Frontend scoped lint on changed source files: passed. Full `npm run lint` was stopped because `eslint .` ran too long after build output existed.
- Browser smoke with system Chrome, desktop viewport: login succeeded and `/app`, `/app/application`, `/app/application?criterion=physical`, `/app/application?criterion=volunteer`, `/app/application?criterion=integration`, `/app/feedback`, and `/app/assistant` rendered without route-level error boundary.
- Browser smoke with system Chrome, mobile viewport `390x844`: physical, volunteer, and integration application routes rendered without route-level error boundary and without document-level horizontal overflow.

Runtime status after remediation:
- Backend dev server was restarted and `GET http://127.0.0.1:8080/health` returned `200`.
- Frontend dev server remained available and `GET http://127.0.0.1:8081/login` returned `200`.

Remaining notes:
- Do not claim DB integration coverage for this remediation pass until a local PostgreSQL instance is available and the integration suites pass in the current run.
- Non-dry-run backfill was not executed.
- Current state is ready to begin the UI refactor from a route-smoke and packaging perspective, with the DB integration caveat above.
