# Criteria Completion Contract Freeze

Date: 2026-07-18

Status: frozen for the next UI refactor pass. Any change to this document should be treated as a business contract change, not a visual refactor.

## Sources

- Prisma domain: `prisma/schema.prisma`
- Requirement tree and completion DTOs: `src/modules/criteria-completion/*`
- Criteria routes: `src/modules/applications/applications.routes.ts`
- Precheck integration: `src/modules/precheck/precheck.service.ts`
- Submit gate: `src/modules/applications/applications.service.ts`
- Post implementation audit: `docs/criteria-completion-post-implementation-audit.md`

## Application Contract

- An individual application is scoped by `workspaceId`, `studentId`, `schoolYear`, and `applicationType`.
- `targetLevel` lives on the application and can change without creating a new application.
- Existing requirement responses and evidence are not deleted when `targetLevel` changes. The completion engine decides whether they apply to the active requirement tree.
- Precheck may move `draft`, `prechecked`, or `ready_to_submit` to `prechecked` or `ready_to_submit`.
- Submit accepts `draft`, `prechecked`, `ready_to_submit`, or `supplement_required`, then moves the application to `under_review`.
- Review flow can move the application to `supplement_required`, `resolution_needed`, `under_review`, `rejected`, or final states through the existing review/finalization services.
- Precheck never writes the final result.

## Requirement Response Contract

`ApplicationRequirementResponse` is the durable link between an application and one requirement path.

Required scope fields:

- `workspaceId`
- `applicationId`
- `criterion`
- `requirementKey`

Response kinds:

- `metric`
- `evidence`
- `official_event`
- `system_confirmation`

Statuses:

- `declared`
- `processing`
- `needs_verification`
- `verified`
- `rejected`
- `superseded`

Rules:

- Student-created manual data can be `declared` or `needs_verification`, but cannot be treated as officially `verified`.
- Officer, manager, admin, or authorized system flows can create verification confirmations.
- `superseded` responses are retained for audit but excluded from completion satisfaction.
- Workspace isolation is mandatory for reading, linking, updating, and evaluating responses.

## Requirement Tree Operators

Supported group operators:

- `all_of`
- `one_of`
- `at_least_n`

Supported requirement types:

- `metric`
- `evidence`
- `system_confirmation`
- `activity_aggregation`

Supported source types:

- `system_data`
- `official_event`
- `manual_evidence`
- `manual_metric`

Criterion completion statuses:

- `not_started`
- `in_progress`
- `needs_verification`
- `ready_for_precheck`
- `precheck_warning`
- `supplement_required`
- `under_review`
- `accepted`
- `rejected`

Student-facing status labels in precheck:

- `Đáp ứng ngưỡng sơ bộ`
- `Cần xác minh`
- `Chưa có dữ liệu`
- `Cần bổ sung`

Forbidden student-facing wording:

- `Đã đạt chính thức`
- `AI xác nhận đạt`
- confidence percentage as a decision signal

## Five Criteria Contract

### Ethics

Required foundation group: `ethics_foundation`, operator `all_of`.

- `conduct_score`: metric, `metricType=conduct_score`, accepted sources `system_data`, `manual_metric`, `manual_evidence`.
- `no_violation`: system confirmation, accepted sources `system_data`, `manual_evidence`.

Optional school-level achievement group: `ethics_additional_achievements`, operator `one_of`, optional unless a criteria version says otherwise.

Achievement keys:

- `political_theory_competition`
- `exemplary_youth`
- `good_person_good_deed`
- `recognized_courageous_action`
- `other_ethics_achievement`

Students cannot self-verify `no_violation`.

### Academic

Required foundation group: `academic_foundation`, operator `all_of`.

- `academic_gpa`: metric, `metricType=gpa`, supports scale `4` and `10`.
- `no_f_grade`: system confirmation or verified boolean-like response.
- `academic_period_valid`: confirms the metric/evidence applies to the application school year.

Optional or required additional group: `academic_additional_achievement`, operator determined by criteria version.

Achievement keys:

- `student_research`
- `academic_competition`
- `journal_article`
- `conference_paper`
- `thesis_or_capstone`
- `innovation_product`
- `academic_team`
- `academic_award`
- `other_academic_achievement`

GPA stores raw value, raw scale, school year, source, verification status, nullable supporting evidence, and normalized evaluation value.

### Physical

Main group: `physical_path`, operator `one_of`.

Path keys:

- `physical_course_result`
- `healthy_student_title`
- `sports_activity_or_award`
- `sports_team_member`
- `regular_sports_training`

The student must choose a path before the path-specific form is rendered. Evidence paths do not create fake metrics.

### Volunteer

Main group: `volunteer_path`, operator `one_of`.

Path keys:

- `recognized_campaign`
- `accumulated_volunteer_days`
- `volunteer_award`
- `activity_count`

Volunteer activity aggregation returns:

- `verifiedTotal`
- `pendingVerificationTotal`
- `excludedTotal`
- `unit`
- `threshold`
- `activities`

Only `verifiedTotal` can satisfy a hard conclusion. Pending declared totals remain pending.

### Integration

The requirement tree must come from `CriteriaVersion`; it is not a universal hardcoded IELTS/TOEIC rule.

Current school-level default path group: `integration_path`, usually `one_of`.

Path keys:

- `foreign_language`
- `skills_or_union_training`
- `international_exchange`
- `foreign_language_or_integration_competition`
- `student_union_achievement` only if allowed by criteria version

Foreign language must support non-English languages and generic certificate/course/confirmation forms. Unknown certificate mapping is `needs_verification`, not automatic rejection.

Skills, international exchange, and competition paths can independently satisfy integration if the active criteria version allows them.

## API Surface

Completion:

- `GET /api/applications/:id/criteria-completion`

Generic response write:

- `POST /api/applications/:id/requirement-responses`

Ethics:

- `POST /api/applications/:id/ethics/conduct-score/link-metric`
- `POST /api/applications/:id/ethics/conduct-score/declare`
- `POST /api/applications/:id/ethics/no-violation/confirmation`
- `POST /api/applications/:id/ethics/additional-achievements`

Academic:

- `POST /api/applications/:id/academic/gpa/declare`
- `POST /api/applications/:id/academic/no-f-grade/confirmation`
- `POST /api/applications/:id/academic/additional-achievements`

Physical:

- `POST /api/applications/:id/physical/course-result/declare`
- `POST /api/applications/:id/physical/path-evidence`

Volunteer:

- `POST /api/applications/:id/volunteer/activities`
- `POST /api/applications/:id/volunteer/path-evidence`

Integration:

- `POST /api/applications/:id/integration/path-responses`

Submit and supplement:

- `POST /api/applications/:id/submit`
- `POST /api/applications/:id/reopen-supplement`

## Precheck Contract

`PrecheckService` must use criteria completion as its primary input.

Precheck output per criterion includes:

- `requirementGroups`
- `satisfiedRequirements`
- `missingRequirements`
- `needsVerification`
- `warnings`
- `nextAction`
- `humanConfirmationRequired=true`

Next action priority:

1. Official supplement request
2. Required rejected or missing requirement
3. Requirement needing verification
4. Required `one_of` path not selected
5. Failed evidence or processing job
6. Rerun precheck
7. Submit if minimum gate passes

Compatibility fields retained:

- `readinessScore`
- `nextBestAction`

These fields are not the source of truth for criterion completion.

## Submit Gate Contract

Submit is allowed only when:

- The application belongs to the requesting user/workspace, or the requester is an allowed admin.
- `targetLevel` is selected.
- Active criteria version can be loaded.
- No upload/OCR/indexing job is still processing.
- Required response payloads are valid.
- Precheck is fresh, or backend reruns precheck before submit.

If warnings remain, backend returns a warning summary and requires explicit confirmation. Submit does not require AI to declare all criteria officially passed and does not update final result.

## Cache And Invalidation Contract

Completion/precheck must be considered stale after:

- Metric change
- Evidence add/update/delete
- OCR completion
- Official event import
- Requirement response change
- Target level change
- Supplement update

Passive completion/precheck hot paths must not call Gemini.

## Compatibility Boundaries

Keep for compatibility until a separate cleanup task:

- Prisma `readinessScore` and `nextBestAction`
- Legacy metric types: `physical_score`, `volunteer_days`, `foreign_language_score`
- Old exports, manager readiness views, cascade/collective views, and smartbot hooks
- OCR aliases such as `conductScore`, `volunteerDays`, and `languageScore`

Do not delete migrations or historical data.
