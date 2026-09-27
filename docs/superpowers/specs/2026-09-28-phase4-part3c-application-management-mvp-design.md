# Phase 4 Part 3C — Application Management MVP

**Status:** Approved for implementation planning
**Inspected:** 2026-09-28
**Backend main:** `8260bfd01186623dbc69fb8fe7d0077cb8f067ad`
**Frontend main:** `4689f0e29a6781b87842098e8ff1b7694ea02101`

## 1. Goal and scope

Give City Managers an auditable way to stop, reopen, and archive submitted individual City applications while preserving the underlying application, its five review tasks, decisions, evidence, resolutions, and historical final decisions. Admin may perform the same lifecycle actions. The existing manager result list and detail page remain the management surface.

The lifecycle state is an overlay on `Application`; it does not add `cancelled` or `archived` to `ApplicationStatus`. Cancellation is a hard stop for all application-bound adjudication writes. Archive changes list visibility only. A cancelled prior final is historical and must not appear as an official current result.

The change is limited to individual applications with `targetLevel=city` in active school workspaces. It does not change student-submitted content, the five-criterion review model, eligibility rules, award data, collective applications, or finalization authority beyond preserving final history and enforcing the cancellation stop.

## 2. Non-scope

- No generic lifecycle/workflow engine, event sourcing, pause state, bulk action, or approval chain.
- No application hard delete and no manager editing of GPA, conduct/training scores, achievements, declarations, or evidence contents.
- No `ApplicationStatus` or `ReviewTaskStatus` enum additions.
- No new review task, including for priority; the City individual application remains exactly five tasks: ethics, academic, physical, volunteer, and integration.
- No new analytics/reporting subsystem, OCR cancellation subsystem, or email template requirement.
- No changes to Award Registry, eligibility/manual verification, initial-submission eligibility gate, review decision semantics, or collective workflow.

## 3. Current-state findings

### Backend

Inspection was read-only on backend `main` at the SHA above.

| Area | Current implementation and consequence |
|---|---|
| Application schema | `prisma/schema.prisma:73` defines the existing workflow statuses; `:430-474` has current final fields (`finalStatus`, `finalLevel`, `finalNote`, `finalizedAt`, `finalizedById`) but no cancellation/archive overlay or final-history relation. `User.finalizedApplications` is the existing inverse relation. |
| Five City tasks | `src/modules/applications/applications.service.ts:836-910` creates the five named City criteria on initial submit. `src/modules/review/review.service.ts:1625-1640` also fixes `ensureReviewTasks` to those five for an individual City application. Reopen must retain these rows and never call a task-creation path. |
| Manager list/detail | `src/modules/manager/manager.routes.ts:80-180` exposes `/applications`, `/results`, `/results/:applicationId`, application summary/aggregation, assignment, aggregate, finalize, and reopen-final. `src/modules/manager/manager.service.ts:486-552` implements the paginated result list; `:614-687` implements its detail and audit timeline. The detailed response already includes student, five tasks and assigned officers, resolutions, final result, and audit timeline. |
| Finalize and reopen-final | `src/modules/manager/manager.service.ts:1031-1304` validates and persists a final result, cascade snapshot, audit, optional notification, and email outbox entry in one transaction. Individual City finalization uses an atomic `updateMany` guard for `finalStatus=pending` and `finalizedAt=null`. `:1307-1373` currently resets final fields directly in `reopenFinal`; it does not snapshot the old final decision. The existing route permits City Manager, City Committee, and admin to reopen City results; legacy manager/committee retain their existing non-City behavior. |
| Assignment and aggregation | `manager.service.ts:814-955` assigns/reassigns a task and writes audit/notification; `:958-1029` reads or applies aggregation. These are independent write paths and need the same cancellation check as a task decision. |
| Review | `src/modules/review/review.routes.ts:46-168` exposes task ensure, claim, decision, supplement request, and resolution escalation. `review.service.ts:441-500`, `:552-1125`, `:1127-1231`, and `:1573-1735` implement the relevant writes, including evidence status, task status, supplement records, resolution creation, notifications, and task creation. `src/modules/review/review.repository.ts:63-197` builds queues without a cancellation filter; `review-assignment.service.ts:69-90` counts active task workload without one. |
| Resolution | `src/modules/resolution/resolution.routes.ts:60-86` exposes resolve/decision, status update, and reopen. `resolution.service.ts:212-409` updates the case, linked task/evidence, application status, audit, knowledge base, and notifications in a transaction; `:412-493` updates/reopens cases and may mutate application status. All are application-bound workflow writes. |
| Student application edits | `src/modules/applications/applications.routes.ts:96-115`, `:165-261`, and `:263-269` expose target-level/draft edits, criterion declarations, initial submit, and supplement reopen/resubmit. Corresponding writes live in `applications.service.ts` and `criteria-completion.service.ts`. The five-task invariant and initial City eligibility gate are already enforced in these services and must remain unchanged. |
| Evidence and criteria inputs | `src/modules/evidences/evidences.routes.ts:46-65`, `:80-92`, and `:120-132` expose evidence creation/file upload/indexing/card corrections/card confirmation/update/delete. `src/modules/criteria-completion/criteria-completion.routes.ts:15-25` exposes requirement-response update/delete; the other criterion mutations are routed through `applications.routes.ts`. Reads remain available after cancellation; new mutations must be stopped server-side. |
| Eligibility verification | `applications.routes.ts:130-135` exposes the City Manager verification mutation. It is pre-submit by design; retain its eligibility behavior and ensure a canceled application cannot be changed through an unexpected direct call. |
| City analytics | `src/modules/analytics/city-analytics.service.ts:64-117` builds summary from `cityApplicationWhere`; `:119-230` builds the drill-down list; `:248-260` currently scopes by individual/City and active School workspace but not cancellation. `:323-419` counts workflow, five-criterion progress, final status, resolution, and officers. Cancellation must be excluded from those official/active metrics, while a separate cancelled count remains visible. Archive must not affect analytics. |
| Manager results/dashboard | `manager.service.ts:277-484` groups application/final/task/resolution states and workload; `:486-612` builds result and committee inbox lists. These application/task aggregates must not treat cancelled City items as current workflow/results. Archive remains included in official result and analytics totals. |
| Exports | `src/modules/exports/exports.routes.ts:22-49` exposes applications JSON/CSV, review-task CSV, and review-result export. `exports.service.ts:190-253` creates official review-result rows; `:255-289` creates application-management rows. Official result export has no cancellation exclusion today. Add a mandatory exclusion there; management export defaults to active/non-cancelled and may opt into cancelled rows explicitly. |
| Audit/notification | `src/modules/applications/application.helpers.ts:72-110` writes application audit records using a transaction client; `AuditLog` in `schema.prisma:1308-1344` already has actor, action, application, before/after JSON, and note. `NotificationType.application_updated` and `.review_updated` already exist (`schema.prisma:180-191`); `NotificationsService.create` accepts a transaction (`src/modules/notifications/notifications.service.ts:10-51`). No new notification enum or subsystem is needed. |
| Approved Part 3C hardening | `GET /api/manager/applications/:id/aggregation` currently writes `APPLICATION_AGGREGATED` audit data; cancelled applications must remain readable there but must not receive that audit, including when cancellation wins a race. Existing criteria mutation authorization also permits manager/admin writes that can alter student-owned City application content; Part 3C must deny those writes for City individual applications while preserving non-City compatibility and authorized staff verification actions. |
| Deadline/season dependency | Part 3B is present on both synced `main` branches (backend `73cdeed`, frontend `4689f0e`). Backend defines `CityReviewSeason` and `CitySubmissionWindowException` in `prisma/schema.prisma:495-526`, with additive migration `prisma/migrations/20260927120000_city_review_seasons_and_submission_exceptions/migration.sql`. `manager.routes.ts:58-96` exposes season and manager deadline/exception APIs; `applications.routes.ts:132` exposes the student deadline read. `CityReviewSeasonsService` is the server authority for opening/closing, per-application extensions, and supplement resubmission deadlines. Frontend reuses `CityDeadlineStatusCard`, `CityReviewSeasonAdministration`, and `CitySubmissionDeadlineExceptionPanel`. Part 3C must preserve and extend these flows where cancellation applies; it must not add duplicate season models, deadline APIs, or UI. |

### Frontend

Inspection was read-only on frontend `main` at the SHA above.

- `src/routes/app.manager.results.tsx` is the existing paginated/searchable result list. It calls `useManagerResults` and links to the detail route. It currently has final-status/result filters but no cancellation or archive filters.
- `src/routes/app.manager.results.$applicationId.tsx` is the existing detail/decision console. It renders lifecycle-adjacent workflow data through `HeaderCard`, `CriterionDecisionBoard`, `ResolutionSection`, and `AuditSection`; `DecisionPanel` and `ReopenFinalDialog` already provide finalization/reopen interactions and reason entry. It also renders `CitySubmissionDeadlineExceptionPanel` for the existing City Manager/admin initial-City-draft flow; Part 3C must keep this panel and its server APIs working.
- `src/features/manager/api/manager.ts` contains the result-list/detail/finalize/reopen API calls; `src/features/manager/hooks/useManager.ts` owns React Query keys, invalidation, and user feedback. Extend these rather than introducing a new management API client.
- Part 3B season administration is already embedded in `CityAnalyticsDashboard` through `CityReviewSeasonAdministration`. Student deadline display is implemented by `CityDeadlineStatusCard` in `StudentApplicationWorkspaceV2`; the API and query hooks are in `src/features/manager/api/city-season.ts`, `src/features/manager/hooks/useCitySeason.ts`, and `src/features/application/hooks/useApplication.ts`. The student card uses the server-provided active-exception state. Do not duplicate these components or introduce alternate client-side deadline calculations.
- The detail page already shows the assigned officer for each criterion and the audit timeline. `src/components/audit/AuditTimeline.tsx` is also an existing generic timeline component. Add lifecycle and immutable final-history display to the existing management detail.
- Existing route-level role checks include `city_manager`, `city_committee`, and `admin` for results. Lifecycle controls must be narrower: only `city_manager` and `admin` for City individual applications.

## 4. Domain invariants

1. `Application.status` continues to represent the workflow status. Cancellation and archive are nullable timestamped overlays, never workflow enum values.
2. `cancelledAt IS NULL` defines an official current application. A canceled application is excluded from every official current result, active review denominator, criterion completion total, and active reviewer workload.
3. Archive is organization/visibility only. It does not alter status or final decision and does not remove a non-cancelled result from analytics or official exports.
4. A canceled application retains its existing `ReviewTask`, decision, evidence, `ResolutionCase`, supplement history, and underlying status. No `ReviewTaskStatus.cancelled` is added.
5. Individual City review remains exactly one task for each of the five official criteria. Priority never creates a sixth task. Reopen reuses retained tasks and decisions.
6. Five completed task decisions are not a final result. Only the current Application final fields are the current canonical final; superseded finals appear only in immutable history.
7. Only an active City Manager in a City workspace and admin may perform lifecycle administration on City individual applications. City Manager cross-school access is through existing City review scope for active School workspaces, not admin access.
8. The backend enforces every cancellation guard. Hiding or disabling a frontend action is not an authorization or workflow guarantee.
9. No lifecycle action changes student-entered content or deletes application data.

## 5. Data model and additive migration

### Application overlay fields

Add nullable fields to `Application`:

| Field | Type | Meaning |
|---|---|---|
| `cancelledAt` | `DateTime?` | UTC time the hard stop began. |
| `cancelledById` | `String? @db.Uuid` | Actor who canceled; relation to `User` with `onDelete: SetNull`. |
| `cancelReason` | `String?` | Required and non-blank at the cancel API; nullable for existing rows. |
| `archivedAt` | `DateTime?` | UTC time the row was hidden from default manager lists. |
| `archivedById` | `String? @db.Uuid` | Actor who archived; relation to `User` with `onDelete: SetNull`. |
| `archiveReason` | `String?` | Optional operator note; nullable for existing rows. |

Add the corresponding named inverse relations on `User`. Do not add a lifecycle enum or backfill existing rows; all existing applications begin with both timestamps null. Add only indexes needed for the default manager list and active City analytics, beginning with an Application composite lookup on workspace/lifecycle timestamps; validate actual query plans before adding more.

### Final decision history

Add a narrow `ApplicationFinalDecisionHistory` table with:

- `id`, `applicationId`, `finalStatus`, `finalLevel`, `finalNote`, `finalizedAt`, `finalizedById`;
- `supersededAt`, `supersededById`, `supersedeReason`, `createdAt`.

The decision fields are immutable after insertion. `finalizedAt` and user IDs are nullable so a legacy/inconsistent current-final row can still be preserved without fabricating metadata. The application FK should restrict deletion when history exists; the two user FKs should use `SetNull`. Index by `(applicationId, supersededAt)` and by `supersededById`. Do not snapshot the whole Application and do not backfill current finals. A history row is created only when a current final is actually superseded by cancel or reopen-final.

The migration is additive: nullable Application columns, indexes, new history table, FKs, and inverse Prisma relations only. No existing enum or row is rewritten.

## 6. State transitions

“Final exists” means `finalizedAt IS NOT NULL` or `finalStatus != pending`; use both indicators so inconsistent legacy data is not silently discarded.

| Current state | Action | Result |
|---|---|---|
| Submitted, non-final, not canceled | Cancel with reason | Set cancellation fields; preserve `status`, tasks, decisions, cases, evidence, and supplement history. Audit and student notification commit in the same transaction. |
| Current final exists, not canceled | Cancel with reason | Insert immutable history for the current final; reset `finalStatus=pending`, final level/note/time/actor to null; set cancellation fields; preserve `status=completed` or `rejected` and all other records. |
| Canceled, not archived | Reopen canceled with reason | Clear cancellation fields; preserve underlying status, tasks, and decisions. If the canceled record retained a terminal `completed`/`rejected` status after its final was superseded, set status to `supplement_required` when an existing active supplement task/request requires it, otherwise `under_review`. Never restore a historical final. |
| Canceled and archived | Reopen canceled with reason | Apply the appropriate reopen behavior above and clear archive fields in the same transaction; audit both reopen and unarchive changes. |
| Completed/rejected or canceled, not archived | Archive | Set archive fields only. Preserve workflow status and current final. |
| Archived | Unarchive | Clear archive fields only. Preserve cancellation and final state. |
| Current final exists, active | Existing reopen-final with reason | Insert immutable final-history row, then reset current final fields and set requested status (`under_review` or `supplement_required`) atomically. Preserve existing route authority. |
| Any canceled state | Any adjudication/application business write | Return HTTP 409 `APPLICATION_CANCELLED`; make no workflow mutation. |
| Active non-terminal, not canceled | Archive | Return HTTP 409; do not hide an active workflow. |
| Unsubmitted draft/precheck | Cancel | Not supported by this MVP. The manager cannot cancel a student-owned unsubmitted draft. |

Cancellation and reopen require non-blank reasons. Archive reason is optional. An unarchive has no required reason. Repeated cancel/reopen/archive/unarchive requests must not silently create duplicate histories or audits; return a conflict when the requested transition is no longer valid.

## 7. RBAC matrix

| Role | Read existing City management detail | Cancel | Reopen canceled | Archive/unarchive | Existing reopen-final |
|---|---:|---:|---:|---:|---|
| `city_manager` in City workspace | Yes, across active School workspaces | Yes | Yes | Yes | Yes, preserve current authority |
| `admin` | Yes, global scope | Yes | Yes | Yes | Yes |
| `city_committee` | Existing read/finalization scope | No | No | No | Yes, preserve current authority |
| `city_officer` | Existing task/detail scope only | No | No | No | No lifecycle access |
| legacy `manager` / `committee` | Preserve existing routes outside City; City access remains denied by City scope/role rules | No for City applications | No | No | Preserve existing non-City behavior; no City lifecycle grant |
| `student` | Own existing student endpoints | No | No | No | No |
| `data_uploader` | No City review management access | No | No | No | No |

Every manager lifecycle handler validates role first, then loads the City individual application and applies `assertReviewWorkspaceAccess` for City Manager or the existing global admin rule. Do not create a broad `isAdminOrCity` helper that accidentally grants unrelated City data access.

## 8. Backend API contract

Use the existing manager management surface. Preserve current response envelopes and unrelated filters.

### List and detail

- Extend `GET /api/manager/results` for the existing result list with `workspaceId` (School filter), `lifecycle=active|cancelled|all`, and `archive=exclude|only|all`.
- Defaults: `lifecycle=active`, `archive=exclude`. Keep existing school year, target level, status/result, faculty/class, search, sort, and pagination semantics. Existing `search` remains accepted and searches student name/code/class/faculty. Workspace selection is constrained by City Manager review scope; admin retains global scope.
- List items include workflow status, current final status, cancellation/archive timestamps and relevant reasons, plus the existing five-criterion progress and reviewer summary. Canceled final fields are pending/null by construction; old final data is fetched from history only.
- Extend `GET /api/manager/results/:applicationId` with cancellation/archive fields and ordered `finalDecisionHistory`. Keep existing task, resolution, student, current final, and audit timeline fields. The endpoint remains read-only and supports inspection of canceled/archived rows within existing access rules.
- Keep `GET /api/manager/applications` and its eligibility-verification behavior backward compatible. The current React result-list page uses `/api/manager/results`; do not introduce a second frontend list backed by `/manager/applications`.

### Lifecycle mutations

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/manager/applications/:id/cancel` | `{ reason: nonBlankString }` | Cancel; snapshot/reset current final if present; audit; student in-app notification. |
| `POST /api/manager/applications/:id/reopen-cancelled` | `{ reason: nonBlankString }` | Clear cancellation; restore the allowed workflow status; auto-unarchive if necessary; audit; student in-app notification. |
| `POST /api/manager/applications/:id/archive` | `{ reason?: string }` | Archive only a terminal or canceled application; audit. |
| `POST /api/manager/applications/:id/unarchive` | Empty body | Clear archive overlay; audit. |

The existing `POST /api/manager/applications/:id/reopen-final` remains in place and gains history persistence before resetting current-final fields. A canceled row must use `reopen-cancelled` first; reopen-final cannot bypass the cancellation stop.

### Error behavior

Use a single `APPLICATION_CANCELLED` error code, HTTP 409, and this user-facing message:

> Hồ sơ đã bị hủy. Mở lại hồ sơ trước khi tiếp tục xử lý.

Apply it to every canceled-application business write, regardless of which role called it. Authorization failures continue to use existing 403/404 behavior so the new APIs do not expose cross-school records.

## 9. Cancellation hard-stop strategy and write-path inventory

Use one shared transaction helper for application-bound business mutations. It locks the Application row in PostgreSQL (`SELECT ... FOR UPDATE`, using parameterized Prisma raw SQL inside the transaction), reloads lifecycle/workflow state after the lock, and raises `APPLICATION_CANCELLED` before related writes. Cancellation, reopen, archive, and all adjudication writes acquire locks in the same order: Application first, then task/case/evidence rows. Apply the same lock/check to all routes below; a pre-transaction read alone is insufficient.

| Write path found on current main | Required behavior |
|---|---|
| Application submit and supplement resubmit: `POST /api/applications/:id/submit`; `applications.service.ts:301-715` | Recheck under the Application lock before status/submission timestamp, snapshot, task reset/link, notification, or outbox mutation. Preserve the existing initial City eligibility gate and existing warning confirmation. |
| Manager reopens supplement: `POST /api/applications/:id/reopen-supplement`; `applications.service.ts:718-834` | Reject if canceled before changing status, supplement state, notification, or email outbox. |
| Review task creation: `POST /api/review/applications/:applicationId/tasks/ensure`; `review.service.ts:1573-1735` | Lock/check before task lookup/create and application status update. Do not recreate tasks on reopen. |
| Claim, decision, supplement, escalation: `/api/review/tasks/:id/claim`, `/decision`, `/request-supplement`, `/escalate-resolution`; `review.service.ts:441-500`, `:552-1125`, `:1127-1231` | Resolve owning Application, lock/check before task assignment/status, evidence status, supplement request, ResolutionCase, notification, or outbox writes. Preserve the atomic task-decision guard and decision semantics. |
| Assign/reassign: `/api/manager/review-tasks/:id/assign` and `/reassign`; `manager.service.ts:814-955` | For an application task, lock/check the owning application before assignment and notification. Collective task behavior stays unchanged. |
| Aggregate and finalize: `/api/manager/applications/:id/aggregate` and `/finalize`; `manager.service.ts:979-1304` | Aggregate writes and finalization must lock/check. Preserve the existing City atomic finalization guard and include `cancelledAt IS NULL` in its conditional write. The final transaction rereads cancellation and current-final state after locking before any cascade/final/audit/notification/outbox write. |
| Reopen-final: `/api/manager/applications/:id/reopen-final`; `manager.service.ts:1307-1373` | Reject canceled applications. Lock/check; snapshot any current final in history before resetting it; audit/notification in the same transaction. |
| Resolution decision/status/reopen: `/api/resolution/cases/:id/resolve`, `/decision`, `/status`, `/reopen`; `resolution.service.ts:212-493` | Lock/check the case’s application before case/task/evidence/status/knowledge-base/audit/notification mutations. Reads remain available. |
| Criteria and declaration writes: requirement-response routes and criterion writes in `criteria-completion.service.ts` (`createResponse`, `updateResponse`, metric declarations, confirmations, achievement/path evidence, `deleteResponse`) | Resolve application from response ID, lock/check before writes. No manager can use these routes to edit student-declared facts on submitted/final applications. |
| Evidence writes: `POST /api/evidences/applications/:applicationId/evidences`; file upload, indexing start, card corrections/confirm, evidence update/delete in `evidences.routes.ts:46-65`, `:80-92`, `:120-132` | Resolve owner application, lock/check before persistence or job enqueue. For file upload, recheck before final DB persistence and remove the just-stored object if cancellation won during storage. Existing OCR jobs may finish as advisory metadata, but cannot mutate application/review workflow or create tasks. |
| Manual eligibility verification: `POST /api/applications/:id/eligibility-verification` | Keep student-only eligibility read and City Manager verification rules. Check cancellation before any mutation; this route remains pre-submit and cannot reopen or override cancellation. |

Read-only application, evidence, task, resolution, audit, and final-history inspection remains available under existing authorization. `GET /api/manager/applications/:id/aggregation` may compute/read aggregation but cannot apply a workflow mutation; it must not reopen or bypass a canceled case. Collective-only writes remain outside the Application cancellation helper.

Active task queues and workload must filter application-bound tasks through `application.cancelledAt IS NULL`, including review queue filters in `ReviewRepository`, manager workload/unassigned counts, `ReviewAssignmentService.getOfficerWorkloads`, City Analytics reviewer counts, and manager/dashboard task aggregates. Preserve collective tasks with an explicit non-application branch in the relation filter. Historical task rows remain stored and readable from application detail/audit.

## 10. Final Decision History strategy

1. In cancel-final and reopen-final transactions, lock the Application, reload the current final fields, and decide whether a current final exists using both `finalizedAt` and `finalStatus`.
2. If present, insert one `ApplicationFinalDecisionHistory` row copying only the final decision fields and supersede actor/time/reason. Do not snapshot student/application payloads.
3. In that same transaction, clear current-final fields (`pending`, null level/note/time/actor) when cancellation supersedes a final; cancel also retains the historical `completed`/`rejected` Application status.
4. Write the domain audit with before/after state and the prior final; use `FINAL_DECISION_SUPERSEDED` in addition to `APPLICATION_CANCELLED` for cancel-final. For reopen-final, use `FINAL_DECISION_SUPERSEDED` plus the existing `FINAL_RESULT_REOPENED` action.
5. Never restore an old history row as current. A reopened canceled final must receive a new explicit finalize action to become official again.
6. No backfill is needed. Before a decision has ever been superseded, the current final remains the only record; history becomes complete from the first Part 3C supersede onward.

The manager detail returns history ordered newest supersede first, with decision, original final actor/time, superseding actor/time, and reason. Student-facing endpoints do not expose manager audit/history fields.

## 11. Analytics semantics

- City official/current analytics use the same individual + City target + active School workspace scope as today, with `cancelledAt IS NULL` added to the official application predicate.
- Keep archived, non-cancelled applications in official analytics. Archive affects manager-list visibility only.
- Exclude canceled records from created/submitted/current workflow denominators, in-review, 0/5–5/5 progress, missing/unexpected task counts, criterion status totals, supplement/resolution totals, final pass/fail/partially-passed/pending totals, school breakdowns, and active reviewer workload.
- Add a separate operational `cancelledCount`, filtered by the selected season/workspace dimensions. Do not fold it into official result totals. Available school-year options may include years represented only by canceled records so their operational count remains visible.
- Task-level historical rows stay intact. The aggregate excludes the entire canceled Application rather than interpreting retained task decisions as current results.
- Apply the same canceled exclusion to `ManagerService` result/committee queues and City-specific dashboard aggregates. Preserve legacy same-workspace manager/committee scope. No broad admin scope is introduced for City Managers.

## 12. Export semantics

- `POST /api/exports/review-results` is an official/current-result export and always adds `cancelledAt IS NULL`, regardless of caller filters. There is no override to include canceled rows in this export.
- `/api/exports/applications.json` and `.csv` are management exports. Default to active/non-cancelled; add an explicit lifecycle filter (`active|cancelled|all`) only to inspect operational records when requested. Preserve archive visibility semantics separately from official results.
- Existing review-task CSV is not a final-result export and remains a task/history representation. It must not be used as an official result source; retain the application lifecycle fields in management/detail surfaces as the canonical explanation for stopped tasks.
- Archive never excludes an active, non-cancelled final from official results exports.

## 13. Frontend UX

Reuse `/app/manager/results` and `/app/manager/results/$applicationId`; do not add a new admin console or navigation destination.

### List

- Add lifecycle filter (`active`, `cancelled`, `all`) and archive filter (`exclude`, `only`, `all`) with active/exclude defaults. Preserve current search, year/result filters, sorting, pagination, and cross-school City Manager scope.
- Show separate lifecycle and workflow badges. A canceled prior pass/fail is shown as “Đã hủy”; the current result is pending, with historical final available in detail only.
- Archived items are hidden by default, but explicit archive filters make them inspectable.

### Detail

- Add lifecycle badge/reason/actor/time to the existing header. Keep the underlying workflow status visible.
- Keep the existing five-criterion progress, assigned reviewer, supplement, Resolution, Part 3B deadline information, and current final panel. Cancellation guards must also cover deadline-exception grant/revoke mutations while preserving their existing season checks and authorization.
- Add a “Lịch sử quyết định cuối” section using the history DTO and keep the audit timeline in the existing detail. Do not merge final snapshots into a mutable audit-only representation.
- Add an “Quản lý hồ sơ” action section only for `city_manager` and `admin` on City individual applications. Reuse existing assignment and reopen-final controls.
- Cancel dialog requires a reason, explains that workflow stops and data is retained, and has the exact final-result warning when a current final exists: “Kết quả hiện tại sẽ được chuyển vào lịch sử và không còn được tính là kết quả chính thức hiện hành.” No Delete control exists.
- Reopen-cancel dialog requires a reason. For canceled-final records, explain that the old final will not be restored and the application must be finalized again. If the item is archived, explain it will be unarchived with the same action.
- Archive/unarchive require confirmation. Archive is available only for completed, rejected, or canceled rows. Archive reason is optional.
- After mutations, invalidate manager application/result lists, detail, analytics, manager dashboard, reviewer workload, review queues, and committee inbox. Render backend 409 cancellation errors as the backend’s user-facing explanation; never rely on the frontend for enforcement.
- City Committee may continue its current review/finalization screens but sees no lifecycle controls. Officer, student, uploader, and legacy roles get no new route/action privilege.

## 14. Notifications and audit

Use existing `Notification` and `AuditLog` in the lifecycle transaction.

- Cancel notification to the student: type `application_updated`, title suitable for a stopped application, exact message “Hồ sơ của bạn đã dừng xử lý.” followed by the cancellation reason.
- Reopen notification to the student: type `application_updated`, message “Hồ sơ của bạn đã được mở lại để tiếp tục xét duyệt.”
- No email template is required. Do not create a new outbox template as a Part 3C blocker.
- Audit actions: `APPLICATION_CANCELLED`, `APPLICATION_CANCELLED_REOPENED`, `APPLICATION_ARCHIVED`, `APPLICATION_UNARCHIVED`, and `FINAL_DECISION_SUPERSEDED`, alongside existing `FINAL_RESULT_REOPENED` for reopen-final.
- Each event records actor/role, application ID, before/after lifecycle and workflow fields, and reason where applicable. The final-superseded event includes the prior final values. `createApplicationAudit(tx, ...)` and notification creation both use the transaction client.
- Do not include full evidence/OCR payloads or unrelated student content in lifecycle audit metadata.

## 15. Transaction and concurrency design

All lifecycle mutations and every application-bound workflow write use the same Application-row lock before related mutations. Re-read state after acquiring the lock; validate authorization/scope before exposing details, then check cancellation under lock.

### Finalize versus cancel

- If cancel locks and commits first, it sets `cancelledAt`; finalization then acquires the row, sees cancellation, and returns 409 before writing cascade/final/audit/notification/outbox state.
- If finalize locks and commits first, cancel waits, rereads the now-current final, snapshots it, clears current-final fields, and sets cancellation atomically.
- Extend, never weaken, the current atomic finalization guard. Include `cancelledAt IS NULL` and the existing pending-final predicates in the final conditional update. No final can commit as official after cancellation wins.

### Other races

- Cancel versus cancel: first transaction wins; second observes canceled state and returns conflict without a second history/notification.
- Reopen versus cancel: both serialize on the Application row; the final committed state corresponds to one complete ordered transition, never a partial clear/set.
- Archive versus reopen: both serialize; reopening a canceled archived item clears cancellation and archive together. An archive request that sees a reopened active non-terminal workflow fails 409.
- Reopen-final versus cancel: whichever obtains the lock first completes its transition. If cancel wins, reopen-final fails with `APPLICATION_CANCELLED`; if reopen-final wins, cancel snapshots the newly current final.
- Keep transaction order consistent (Application, then task/case/evidence, then history/audit/notification) to reduce deadlocks. Use existing Prisma interactive transaction timeouts and retry handling for database serialization/deadlock errors only where the repository already supports them; no distributed lock is introduced.

## 16. Backward compatibility

- Existing rows load with null lifecycle fields; existing JWT, role enum, application status, review-task status, and API envelope remain unchanged.
- Existing student submission and eligibility behavior remain unchanged for non-canceled rows. Eligibility remains a hard gate on initial individual City submission.
- Existing review decisions, supplement-only task reset, Resolution decisions, finalization checks, and exactly-five City task creation remain unchanged.
- Existing result/detail fields stay present. New lifecycle/history fields are additive. Existing manager filters remain valid; new default list behavior excludes archived and canceled rows, while explicit filters recover them.
- `ApplicationFinalDecisionHistory` starts empty for pre-existing finals; it records future supersedes without fabricated history.
- Collective applications and their task, final, and notification behavior remain unchanged.

## 17. Test matrix

### Lifecycle and history

1. Under-review City application → cancel → verify cancellation fields, unchanged status and five existing tasks; decision, claim, assignment, supplement, resolution, aggregate, and finalize all return 409 with no partial writes; queue and active workload exclude it; reopen → same tasks and decisions remain available, with no sixth/recreated task.
2. Completed + passed → cancel → exact prior final in history; current final pending/null; status remains completed; City analytics no longer counts pass or denominator; official review-result JSON/CSV omits it; reopen to under-review → finalize again → new result is current, old history remains.
3. Completed application → archive → absent from default manager list but present in official analytics/results export; unarchive restores default list visibility.
4. Under-review application → archive → 409 and no archive fields/audit.
5. Canceled application → finalize, task decision, aggregate, Resolution mutation, assignment, deadline-exception grant/revoke, and student supplement resubmit → 409; no state, audit, notification, or outbox side effect.
6. Existing active final → reopen-final → previous final is recorded before current fields reset; authorization remains unchanged.
7. Reopen canceled final never restores historical final; status is under_review or supplement_required; archived canceled record is unarchived atomically.
8. Cancel/reopen/archive/unarchive matrix for city_manager/admin succeeds in City scope; city_committee, city_officer, student, uploader, and legacy manager/committee are denied. City Manager cannot access inactive or non-School workspace applications; admin remains global only through existing admin behavior.
9. Reason validation rejects blank cancellation/reopen reason before writes; optional archive reason behavior is stable.

### Concurrency and data boundaries

10. Race cancel versus finalize in both lock orders and assert the two allowed outcomes; no current final survives after cancellation wins.
11. Race duplicate cancel, reopen/cancel, archive/reopen, and reopen-final/cancel; assert one complete transition, no duplicate final-history row, and consistent audit/notification count.
12. Student draft/criterion/evidence writes cannot race through the cancellation boundary; file upload that loses the race removes its stored object and does not persist a File/evidence link.
13. Retained City task count remains exactly five after cancel/reopen; priority never becomes a task; collective paths are unaffected.

### Analytics, exports, and regressions

14. Cancelled rows do not affect City final results, progress 0/5–5/5, school breakdown, supplement/resolution totals, manager result queues, queue counts, or active reviewer workload; `cancelledCount` is separate. Archived non-cancelled rows still count.
15. Official result exports always omit canceled rows even with explicit lifecycle query; management export defaults active and includes canceled only with explicit filter.
16. Regression coverage: initial submit/eligibility gate; exactly five City tasks; PASS/FAIL and partially-passed finalization; supplement and selective task reset; Resolution; reopen-final; existing Part 3B season configuration, server-authoritative submission exception, and supplement-deadline behavior; City Analytics; existing role/workspace scope.

## 18. Rollout

1. The synced implementation base already includes Part 3B. Reuse its schema, migration, routes, service, tests, and frontend components; add only cancellation-specific guards and visibility behavior required by this spec.
2. Apply the additive Prisma migration before deploying backend code. Existing data receives null lifecycle fields and no backfill.
3. Deploy backend guards, lifecycle endpoints, history writes, query/export exclusions, and cancellation-aware queue/workload filters. Verify official results exclude cancellations before exposing the UI actions.
4. Deploy frontend list filters, status/history display, dialogs, and query invalidation. Old clients remain compatible and cannot bypass backend cancellation guards.
5. Verify migration status, targeted lifecycle/concurrency tests, City analytics/result exports, and the existing eligibility/review/supplement/resolution/finalization regressions before operational use.

## 19. Deferred / follow-up

- Bulk cancel/archive/reassignment, soft-delete tooling, and generic lifecycle history.
- Email templates for cancellation/reopen; in-app Notification is sufficient for this MVP.
- Backfill of final decisions that were reopened before this feature existed. The new table intentionally records only supersedes from deployment onward.
- A separate history API or reporting subsystem; the existing manager detail response is sufficient for one application.
- Background OCR cancellation. Already queued extraction may complete as advisory evidence metadata, but it cannot restart or mutate adjudication after cancellation.
- Creating or redesigning submission-season/deadline-exception infrastructure. Part 3C reuses the merged Part 3B flow and must not duplicate its model, APIs, deadline rules, or UI.

## 20. Acceptance criteria

- City Manager and admin can search, filter, inspect, cancel, reopen, archive, and unarchive City individual applications within their stated scopes.
- Cancellation preserves all historical task/evidence/resolution/supplement records and blocks every relevant backend workflow write with HTTP 409 `APPLICATION_CANCELLED`.
- Canceling a finalized application writes an immutable final-history row and clears the current final in the same transaction. Reopen-final follows the same history rule.
- Canceled applications never count as official current results or active review/workload; official result exports always exclude them. Archive alone changes only default manager-list visibility.
- Reopening reuses existing tasks and decisions; no new task is created and the five-task invariant remains exact.
- All lifecycle state, history, audit, and required in-app notification writes are transactionally consistent, including finalize/cancel races.
- Existing student, eligibility, review, supplement, Resolution, finalization, analytics, export, and collective behaviors remain intact outside cancellation filtering and additive lifecycle fields.

## 21. Implementation-plan confirmations

1. **Part 3B base (verified):** Backend `main` contains Part 3B at `73cdeed704323ebd5a6b4affc6b79441a7b6a107`; frontend `main` contains it at `4689f0e29a6781b87842098e8ff1b7694ea02101`. The model, migration, manager/student endpoints, supplement deadline enforcement, tests, and season/deadline UI are present. This is not an open dependency; Part 3C must reuse them without duplication.
2. **Unsubmitted drafts:** Managers cannot cancel unsubmitted drafts. Cancellation begins after submission, or for an application that already has a current final.
