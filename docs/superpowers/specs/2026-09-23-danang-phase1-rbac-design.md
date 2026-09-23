# 5TOT Đà Nẵng Phase 1 — Workspace & RBAC Refactor Design

**Date:** 2026-09-23  
**Status:** Proposed for implementation  
**Basis:** `phase-1-organization-rbac-audit.md` + business decisions for the Đà Nẵng-only deployment.

## 1. Goal

Refactor authorization for the Đà Nẵng deployment without rewriting the review engine.

The deployment has one city review authority: **Hội Sinh viên Thành phố Đà Nẵng**. Schools and Đại học Đà Nẵng provide upstream award/decision data but do not review applications in 5TOT.

Core principle:

> Rút cấp xét, không rút luồng xét.

The following workflows remain intact: evidence/OCR, Evidence Card, rules/precheck, review tasks by criterion, officer specialization, assignment/reassignment, supplement, Resolution Hub, committee/final decision, notifications, audit, and exports.

## 2. Scope

Phase 1 changes authorization boundaries and role/workspace semantics only.

### In scope

- Fix current high-risk resource-scope gaps found by the audit.
- Extend `Workspace` to model Đà Nẵng business units.
- Refactor roles to the Đà Nẵng runtime actors.
- Centralize workspace/resource authorization.
- Allow city review roles to review applications/tasks from all school workspaces in this deployment.
- Restrict school/UDN `data_uploader` accounts to their own workspace and data-upload capabilities.
- Preserve review routing, specialization, supplement, resolution, committee and finalization behavior.
- Update tests, seeds and backend/frontend role contracts required by the role changes.

### Out of scope

- No general multi-province/multi-city platform model.
- No `organizations` table.
- No `organization_memberships` table.
- No active organization switcher.
- No Award Decision Registry implementation yet; Phase 1 only creates the authorization boundary needed for it.
- No eligibility engine implementation yet.
- No removal of `targetLevel` or Cascade Review schema in Phase 1.
- No rewrite of ReviewTask, Evidence Card, Rules Engine, Resolution Hub or Knowledge Base core.

## 3. Deployment Model

The system is deployed only for Đà Nẵng.

`Workspace` remains the data-partition and business-unit abstraction.

### Workspace types

```text
CITY
UNIVERSITY_SYSTEM
SCHOOL
```

### Hierarchy

```text
HSV Thành phố Đà Nẵng       type=CITY

Đại học Đà Nẵng             type=UNIVERSITY_SYSTEM
├── Trường ĐH Bách khoa     type=SCHOOL
├── Trường ĐH Kinh tế       type=SCHOOL
└── ...

Other Đà Nẵng schools       type=SCHOOL, parentWorkspaceId=null
```

`parentWorkspaceId` expresses business hierarchy only. It does not grant review permissions.

## 4. Target Workspace Schema

Extend the existing `Workspace` model additively:

```text
Workspace
- id
- code
- name
- shortName
- type                  WorkspaceType
- parentWorkspaceId     nullable UUID
- isActive
- registrationEnabled
- createdAt
- updatedAt
```

New enum:

```text
WorkspaceType
- CITY
- UNIVERSITY_SYSTEM
- SCHOOL
```

The existing workspace relationships and `workspaceId` columns remain unchanged in Phase 1.

## 5. Target Role Model

The runtime role set for the Đà Nẵng deployment becomes:

```text
student
data_uploader
city_officer
city_manager
city_committee
admin
```

`class_representative` is not part of the city-review actor model. Existing collective-SV5T behavior must not be deleted as a destructive migration in Phase 1; compatibility handling is required until the collective scope is explicitly migrated.

### Role semantics

#### student

- Belongs to one school workspace through `User.workspaceId`.
- Can operate only on own student resources.
- Can prepare, precheck, submit and supplement own application.
- Has no review permissions.

#### data_uploader

- Belongs to exactly one school or UDN workspace through `User.workspaceId`.
- May access only data-uploader resources owned by that workspace.
- Must not access review queues, review decisions, supplement requests, Resolution Hub, workload or final decisions.
- Phase 1 prepares this role for the later Award Decision Registry.

#### city_officer

- Belongs to the Đà Nẵng city workspace.
- May review city-submitted tasks originating from any `SCHOOL` workspace in this deployment.
- Review access still depends on criterion specialization and task assignment/business rules.
- May request supplements and escalate resolution where currently supported.

#### city_manager

- Belongs to the Đà Nẵng city workspace.
- May view city review workload across all school workspaces.
- May assign/reassign tasks and operate manager aggregation/finalization actions allowed by business rules.
- Is not an admin and must not receive global system-configuration bypasses.

#### city_committee

- Belongs to the Đà Nẵng city workspace.
- May operate Resolution Hub and committee/final-decision actions allowed by business rules across school workspaces.
- Is distinct from `city_manager` even when UI shares surfaces.

#### admin

- System-level administrative role.
- Existing global bypass semantics may remain for explicit admin-only operations.

## 6. Authorization Model

Authorization must be evaluated in this order:

```text
WHO
→ authenticated user

CAN DO WHAT
→ role/capability

ON WHICH RESOURCE
→ owner / assignment / parent relation

IN WHICH SCOPE
→ workspace policy
```

A frontend role check is never a security boundary.

### Workspace access policy

Conceptually:

```text
student
→ own-resource checks only

data_uploader
→ same workspace only

city_officer / city_manager / city_committee
→ city review actions may target resources from any active SCHOOL workspace in this Đà Nẵng deployment
→ this does NOT imply unrestricted access to every resource type

admin
→ explicit global system scope
```

Do not solve city-wide review by promoting city users to `admin`.

## 7. Centralized Authorization Helpers

Phase 1 should replace scattered direct workspace comparisons with focused helpers/policies.

Target conceptual interfaces:

```ts
canAccessWorkspace(user, resourceWorkspace, action)
canReviewTask(user, task)
canManageReviewTask(user, task)
canResolveCase(user, resolutionCase)
canManageWorkspaceData(user, resourceWorkspaceId)
```

Exact function names may follow current project conventions, but authorization logic must not be duplicated independently in each service.

Every ID-based mutation must validate the resource and its parent relation before side effects.

## 8. Security Baseline — Audit Findings

The following existing findings must be fixed before or while changing roles.

### F-01 — Evidence upload cross-workspace

Staff file upload must verify the evidence/application resource scope before storing files or starting OCR.

Expected Phase 1 rule:

- student: only evidence in own application/supplement window.
- city review roles: only if the action is actually part of an allowed city review workflow.
- data_uploader: no evidence-upload review capability.
- admin: explicit admin policy.

### F-02 — Ensure review tasks cross-workspace

`ensureReviewTasks` must not accept an arbitrary application ID from another scope.

Normal business flow should prefer task creation as an internal/submit-side operation. If the endpoint remains public to staff, it must require city manager/admin scope and validate the target application is reviewable by the city workflow.

### F-03 — Claim review task cross-workspace

A city officer may claim only when:

- user has `city_officer` capability;
- task originates from an allowed school workspace;
- task is unassigned;
- criterion specialization allows the task;
- any other existing review-state conditions are satisfied.

### F-04 — Resolution status/reopen cross-workspace

All resolution mutations must use the same scope guard pattern as normal case resolution.

City manager/committee can operate school-originated cases because the case is in the city review workflow; data uploaders cannot.

### F-05 — Event confirm-index relation integrity

Before confirming roster data:

```text
eventFile.eventId === targetEvent.id
```

must be enforced in addition to authorization.

### F-07 — Automatic assignment candidate scope

Automatic assignment must not choose candidates by criterion across arbitrary workspaces.

For the Đà Nẵng runtime, candidate reviewers are active city review officers, not school/UDN data users.

### F-08 — `facultyScope`

Decision: `facultyScope` is an **assignment preference**, not an authorization boundary.

Security is based on city role + criterion specialization + assignment/resource rules.

Any existing code that treats `facultyScope` inconsistently must be normalized so it cannot silently become a security boundary.

### F-09 — demo email heuristic

Production authorization must not depend on an email pattern such as `officer.*@dut.udn.vn`.

If retained for demo compatibility, it must be guarded by an explicit environment flag defaulting to disabled outside demo/dev environments.

### F-06 — approved evidence names / Knowledge Base scope

Decision: the city-review Knowledge Base is city-shared, not school-private.

However visibility must distinguish safe reference data from internal review data. Phase 1 should not solve F-06 by blindly applying same-workspace filtering if the endpoint intentionally exposes city-shared reference names. It must instead document and enforce an explicit public-reference vs internal-city policy where relevant.

## 9. Review Engine Preservation

The following behavior is intentionally preserved:

```text
Application submit
→ create review tasks by criterion
→ specialized officer queue
→ assignment / reassignment
→ accept / reject / request supplement / escalate resolution
→ supplement / resubmission
→ Resolution Hub
→ aggregation
→ final decision
→ audit + notifications
```

Phase 1 changes who may enter these flows and across which school workspaces, not the flow itself.

## 10. Officer Specialization

Keep the existing `OfficerSpecialization` concept.

- Criterion specialization remains a review capability signal.
- `facultyScope` remains metadata/assignment preference.
- Candidate selection must use only city reviewers in production city review routing.
- A school/UDN `data_uploader` must never become review-eligible merely because old specialization rows exist.

Legacy specialization rows must therefore be considered during migration/seed updates.

## 11. Application and Review Scope

Keep the current data anchor:

```text
Application.workspaceId = student's school workspace
ReviewTask.workspaceId = application workspace
```

This preserves source-school data partitioning and avoids a large migration.

City review roles receive a controlled cross-school review policy rather than rewriting every application/task to city workspace ownership.

This distinction is required:

```text
origin workspace = school
review authority = city role policy
```

No `reviewOrganizationId` field is required in Phase 1 because the deployment has only one city review authority.

## 12. Event Registry and Data Uploader Boundary

Do not give `data_uploader` the full legacy officer Event Registry permission set.

For Phase 1:

- Event Registry remains a city/admin-managed domain unless an existing student-facing read flow requires broader read access.
- School/UDN `data_uploader` is reserved for the later Award Decision Registry.
- Reuse of roster parsing infrastructure is allowed later, but domain permissions stay separate.

## 13. Backward Compatibility

Phase 1 must be additive and migration-safe.

- Do not drop workspace anchors.
- Do not drop `targetLevel` or Cascade schema.
- Do not rewrite historical `AuditLog.actorRole` values.
- Preserve historical rows and audit semantics.
- Role migration must explicitly handle existing demo/test accounts.
- Collective/class-representative behavior must not be destructively removed without a dedicated migration decision.

Because access JWTs contain only user ID and auth middleware reloads role/workspace from the database, the token format should remain unchanged unless implementation proves otherwise.

## 14. Frontend Contract

The frontend must eventually distinguish three primary workspaces:

```text
Student Workspace
Data Uploader Workspace
City Workspace
```

City UI may present different surfaces for officer, manager and committee.

Backend remains the source of truth for authorization.

Phase 1 frontend work includes:

- update Role union/API types;
- update role-to-workspace mapping;
- update route guards and navigation;
- ensure `data_uploader` has no review actions;
- preserve student flow;
- preserve city reviewer/manager/committee review features.

## 15. Testing Contract

Phase 1 requires regression tests for both isolation and city-wide review.

Minimum scenarios:

```text
School A data_uploader
✓ own data-uploader resources
✗ School B data-uploader resources
✗ review queue/tasks/resolution/final decision

Student A
✓ own application/evidence
✗ Student B application/evidence

City officer
✓ School A review task when criterion/assignment permits
✓ School B review task when criterion/assignment permits
✗ unrelated admin/data-uploader mutations

City manager
✓ assign/reassign across School A and School B
✓ view workload across school-originated city review tasks

City committee
✓ resolve city-review cases originating from multiple schools

Admin
✓ explicit global system actions
```

Specific regression tests must cover F-01, F-02, F-03, F-04, F-05, F-07, F-08 and F-09.

## 16. Migration Sequence

Safe order:

1. Fix current resource-scope/security baseline and add regression tests.
2. Add `WorkspaceType` and `parentWorkspaceId` additively.
3. Seed/identify CITY, UNIVERSITY_SYSTEM and SCHOOL workspaces.
4. Introduce/refactor target runtime roles with compatibility handling.
5. Centralize workspace/resource authorization policies.
6. Move review routing/visibility to city-role cross-school policy.
7. Enforce `data_uploader` own-workspace/no-review boundary.
8. Update frontend role contract and routing.
9. Run cross-workspace and city-wide review regression suites.
10. Only after successful pilot consider deprecating legacy role assumptions.

## 17. Definition of Done

Phase 1 is complete when all of the following hold:

- The 5 HIGH audit findings are fixed and covered by regression tests.
- Automatic review assignment cannot select school/UDN data uploaders.
- The production demo-email authorization bypass is disabled or explicitly demo-gated.
- Workspaces can represent city, UDN and schools with parent hierarchy.
- `data_uploader` is own-workspace-only and cannot enter review flows.
- City officer/manager/committee can operate city-review workflows across school-originated resources without admin privileges.
- Criterion specialization and multi-reviewer routing still work.
- Supplement, Resolution Hub, aggregation and final decision still work.
- Student ownership isolation still works.
- Existing workspace anchors, review workflow and audit history remain intact.
- Backend authorization, not frontend visibility, enforces every protected action.
- Backend and frontend automated tests for the changed contracts pass before merge.

## 18. Non-Goals for the Next Phase

Phase 2 will introduce the Award Decision Registry and roster import needed for school/UDN decisions. Phase 3 will introduce the city submission eligibility rule (UDN students require school + UDN awards; other Đà Nẵng schools submit directly). These are intentionally not implemented in Phase 1.
