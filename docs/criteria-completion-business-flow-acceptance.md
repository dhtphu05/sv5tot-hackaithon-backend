# Criteria Completion Business Flow Acceptance

Date: 2026-07-18

Result: SIGN-OFF BLOCKED.

Reason: static contract, source audit, and build/unit verification can be run, but the disposable local PostgreSQL/Docker environment required for database fixture, full integration, and browser E2E acceptance is not available in this pass. No remote production database was used.

## Scope

This pass validates that the implemented five-criteria business flow is internally consistent before a visual UI refactor. It does not intentionally redesign UI, add rules, or change business behavior unless a blocking bug is found.

Frozen contract:

- `docs/criteria-completion-contract-freeze.md`

## Git State

Backend:

- Repo: `D:\02_PROJECTS\5TOT\sv5tot-hackaithon-backend`
- Branch: `feat/sth`
- HEAD: `6dc2db70ad167f6eae5b318d5e81bfce05b4f577`
- Worktree: dirty; includes requirement completion, precheck, backfill, tests, OpenAPI, and context updates from the current feature work.

Frontend:

- Repo: `D:\02_PROJECTS\5TOT\namtot`
- Branch: `feat/sth`
- HEAD: `088e7d798d68c6f375e129b10d3e13353a660218`
- Worktree: dirty; includes application overview/action workspace, route, hooks, admin workspace, package, and context updates from the current feature work.

## Database And Fixture

Status: BLOCKED.

Observed local environment:

- `localhost:5432`: not listening.
- `docker`: command not available.
- Process `DATABASE_URL`: not set.

Actions not performed:

- No `prisma migrate reset`.
- No non-dry-run backfill.
- No remote Supabase or production database use.
- No database integration PASS is claimed.

Fixture requirement:

- Idempotent business-flow fixture is NOT VERIFIED in this pass because there is no disposable PostgreSQL target.
- Existing code has integration tests and backfill support, but they were not run against a local disposable DB during this acceptance pass.

## Contract Review

Status: VERIFIED BY SOURCE INSPECTION.

Confirmed:

- Completion DTO supports requirement groups, requirement statuses, aggregation totals, current responses, and criterion-level next action.
- Requirement tree supports `all_of`, `one_of`, and `at_least_n`.
- Requirement types include metric, evidence, system confirmation, and activity aggregation.
- Five criteria are represented as multi-requirement trees rather than single fixed metric inputs.
- Precheck is built from completion output through `buildPrecheckFromCompletion`.
- Precheck includes requirement groups, satisfied/missing/needs-verification details, warnings, next action, and `humanConfirmationRequired=true`.
- Student-facing precheck labels avoid official pass wording.
- Submit gate can rerun stale precheck, block processing uploads, return warning summaries, and does not write final result.
- Student routes cannot call ethics `no_violation` or academic `no_f_grade` confirmation routes because those routes are restricted to officer/manager/admin.

Compatibility retained:

- `readinessScore`
- `nextBestAction`
- Legacy metric types and OCR aliases
- Legacy views/exports/smartbot hooks

## Required Scenario Matrix

The table below is intentionally strict: a scenario is PASS only if it was exercised against a disposable database or equivalent automated test in this pass.

| Scenario | Status | Note |
| --- | --- | --- |
| Ethics: conduct score verified, no violation pending -> `needs_verification` | NOT VERIFIED | Requires DB fixture/integration run. |
| Academic: GPA 3.4/4, no F verified, optional academic achievement missing -> ready | NOT VERIFIED | Requires DB fixture/integration run. |
| Physical: healthy student certificate satisfies `one_of` without metric input | NOT VERIFIED | Requires DB fixture/integration run. |
| Volunteer: official Mua he xanh 2 days + blood donation 1 day -> verified total 3 | NOT VERIFIED | Requires DB fixture/integration run. |
| Volunteer: student cannot fake verified total by manually typing 3 days | NOT VERIFIED | Requires DB fixture/integration run. |
| Integration: JLPT/TOPIK saved with language and certificate type and mapped equivalent level | NOT VERIFIED | Requires DB fixture/integration run. |
| Integration: training/exchange path can satisfy school-level integration without foreign language | NOT VERIFIED | Requires DB fixture/integration run. |
| Target level change reevaluates tree without deleting old responses | NOT VERIFIED | Requires DB fixture/integration run. |
| Supplement request scoped to one requirement and resubmits same application | NOT VERIFIED | Requires DB fixture/integration run. |
| Workspace A cannot read/link workspace B responses/evidence/criteria | NOT VERIFIED | Requires DB fixture/integration run. |

## Browser Smoke Matrix

Status: NOT VERIFIED IN THIS ACCEPTANCE PASS.

Required desktop/mobile browser checks need a running local backend and frontend with fixture data. Backend and frontend dev servers were restored after verification (`8080` and `8081`), but because disposable DB setup is blocked, this pass does not claim:

- Criteria screens render dynamic path selectors against seeded data.
- No fixed wrong metric input remains in each criterion screen.
- Status is taken from completion API across all seeded states.
- No AI confidence is visible.
- Next-action bar is correct for each seeded scenario.
- Mobile path selector/forms/activity list/evidence list have no overflow.

## Officer, Manager, Resolution, And Supplement

Status: NOT VERIFIED IN THIS ACCEPTANCE PASS.

Source inspection confirms route-level role boundaries and service integration points, but the required end-to-end officer/manager/resolution/supplement flow was not executed against a disposable DB in this pass.

## Backfill

Status: NOT RUN.

Backfill support exists at:

- `scripts/backfill-requirement-responses.ts`

Required behavior from prior implementation:

- Dry-run support.
- Idempotent linking.
- No PII/raw OCR/file URL logging.
- Legacy volunteer totals remain `needs_verification`.
- Legacy language metric maps to generic `foreign_language`, not hardcoded IELTS/TOEIC.

This acceptance pass did not execute the script because no safe local database target is available.

## Current Verification Commands

Backend:

- `npx prisma validate`: PASS.
- `npx prisma generate`: PASS after stopping backend dev watch that held the Prisma engine DLL. Initial run failed with Windows `EPERM` rename on `node_modules/.prisma/client/query_engine-windows.dll.node`.
- `npm run build`: PASS.
- `npm run lint`: PASS with 18 warnings, 0 errors.
- Focused unit tests: PASS. Completion/precheck/admin/cors/evidence suite reported 6 files and 76 tests passed. Additional `auth-middleware-workspace` suite reported 1 file and 3 tests passed.
- Integration workspace tests: BLOCKED until disposable PostgreSQL is available.

Frontend:

- `npx eslint src`: PASS with 11 warnings, 0 errors. This pass fixed type-only `no-explicit-any` errors in `DraftWorkspace`, `AuditLogs`, `CollectiveWorkspace`, `EventLibrary`, and `mock-data`.
- `npm run build`: PASS, including Nitro/Vercel output generation.

Environment:

- `127.0.0.1:5432`: `TcpTestSucceeded=False`.
- `docker`: command not found.
- Backend dev server: restored on `127.0.0.1:8080`.
- Frontend dev server: still listening on `127.0.0.1:8081`.

## Exit Gate

Exit gate is BLOCKED.

Required before UI refactor sign-off:

- Disposable local PostgreSQL or CI test database available.
- Business-flow fixture loaded idempotently.
- Required scenario matrix passes.
- Workspace isolation integration passes.
- Submit/supplement/resolution flow passes.
- Desktop and mobile browser smoke pass against fixture data.

No "business flow stable" or "ready for UI refactor" sign-off is made in this document.
