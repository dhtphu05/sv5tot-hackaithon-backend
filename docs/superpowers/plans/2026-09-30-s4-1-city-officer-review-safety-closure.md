# S4.1 City Officer Review Safety Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the S4.1 contract and safety gaps for City Officer review without starting the S4 Review Workspace visual implementation.

**Architecture:** Preserve the existing ReviewTask API and persistence model. Extract/reuse the canonical ReviewTask visibility policy for evidence-file authorization, resolve reviewer requirements from the existing `CriteriaVersion`/`CriteriaRule` loader, and enforce supplement/claim invariants in backend mutations. Keep FE changes limited to response typing/normalization needed to consume the authoritative criteria contract.

**Tech Stack:** TypeScript, Express, Prisma, Vitest, TanStack Start/React, Zod.

**Spec:** S4.1 prompt attached at `C:\Users\GTC\.codex\attachments\ea2248b4-ac88-4516-8c0c-d5cd3d82299b\Pasted text.txt`.

## Global Constraints

- Work only on branch `feat/staff-review` at the S4.1 FE/BE checkpoints; do not stash, reset, clean, rebase, merge, or push.
- City individual review has exactly five criteria: ethics, academic, physical, volunteer, integration; `priority` is not a sixth criterion and collective review stays separate.
- Human review remains canonical; AI/OCR/rules are advisory and five accepted criteria do not auto-finalize an application.
- Original evidence must be available to an authorized City reviewer before a decision, including a valid unclaimed/viewable task, but never through unrelated evidence/file enumeration or signed-URL bypass.
- `supplement_required` means “Đang chờ sinh viên bổ sung.” A normal City Officer cannot accept, reject, request another decision, or escalate that task until the student resubmits the same task into `waiting`.
- Claim is an atomic CAS on claimable status, unassigned state, no decision, and freshness; a CAS miss returns the existing `409` conflict semantics and never falls back to an overwrite.
- `loadCriteriaRules` and its resolved `CriteriaVersion`/`CriteriaRule` data are authoritative for City reviewer requirements, checklist, and corresponding backend assessment; do not retain conflicting hardcoded City thresholds beside configured rules.
- No S4 UI redesign, Resolution/finalization/committee redesign, shared staff shell, school filter, season UI, notification redesign, KB N+1 work, migration, or new endpoint.

## Review Focus

- An authorized City Officer opens an original evidence file for a linked unclaimed task before claim; covered by the file authorization regression task.
- A file linked to an evidence with no task, wrong specialization, wrong school scope, or unrelated City Officer remains denied; covered by the same authorization matrix.
- A configured criterion rule that has no metric/heuristic support is surfaced as unresolved/advisory rather than fabricated as an authoritative pass/fail requirement; covered by the criteria contract tests.
- A supplement task cannot be mutated through any decision route before the student resubmits the same task; covered by supplement decision tests.
- A stale claim after status/freshness changes cannot overwrite the task, while two simultaneous claims yield one success and one `409`; covered by claim CAS tests.

---

### Task 1: Canonical ReviewTask visibility for original evidence files

**Files:**

- Create or modify: `src/modules/review/review-access.policy.ts` for the shared task visibility/scope decision.
- Modify: `src/modules/review/review.service.ts` to consume the shared policy without changing the public permission response.
- Modify: `src/modules/files/files.repository.ts` to load the linked task scope fields required by the policy.
- Modify: `src/modules/files/files.service.ts` to authorize evidence files through the shared policy, retaining signed URL expiry and owner rules.
- Test: `tests/unit/files.service.test.ts` and `tests/unit/review-task-detail.test.ts`.

**Interfaces:**

- Consumes: existing `AuthenticatedUser`, `ReviewTaskStatus`, role/specialization rules, and `assertReviewWorkspaceAccess` semantics.
- Produces: one policy entry point that answers whether a user can view a specific linked ReviewTask; FilesService must require both policy approval and exact evidence-to-task linkage.

- [ ] **Step 1: Write failing tests** for matrix A–H: assigned authorized City Officer, authorized unclaimed/viewable task, unlinked evidence, wrong specialization, wrong workspace, unrelated City Officer, accepted/rejected read-only access, and student/file-owner regression.
- [ ] **Step 2: Run the focused file/review tests** and verify the new pre-claim/accepted/rejected expectations fail for the current role/status-only authorization.
- [ ] **Step 3: Implement the shared policy** so workspace/role/specialization/task assignment and status decisions match the existing canonical ReviewTask `canView` behavior; do not authorize from role alone and do not weaken global student ownership rules.
- [ ] **Step 4: Make FilesService use exact linked-task policy results** for metadata and signed URLs, while preserving 404 behavior for unauthorized enumeration and the 300-second signed URL.
- [ ] **Step 5: Run the focused tests** and verify all matrix cases pass.
- [ ] **Step 6: Commit** only the authorization slice after its focused tests pass: `fix: close review evidence authorization gap`.

### Task 2: CriteriaVersion-backed City reviewer contract

**Files:**

- Create or modify: `src/modules/review/review-criteria.ts` for deterministic criteria resolution and reviewer-facing projection.
- Modify: `src/modules/rules/criteria.loader.ts` only if a narrowly scoped resolver/result extension is required; preserve existing callers.
- Modify: `src/modules/review/review.service.ts` to resolve criteria for the reviewed application and use it for checklist/assessment/detail output.
- Modify: `src/modules/review/review.dto.ts` or review types only if the repository has a response DTO boundary for the new contract.
- Test: `tests/unit/review-task-detail.test.ts`, `tests/unit/rules-engine.test.ts` or a focused new `tests/unit/review-criteria-contract.test.ts`.

**Interfaces:**

- Consumes: `(workspaceId, schoolYear, targetLevel, existing unitScope)` from the reviewed Application and the existing `loadCriteriaRules` result.
- Produces: a stable response projection containing criterion identity, resolved version id/name, human-readable requirements, structured configured checks where available, grouping semantics where represented, and source/version metadata; no raw Prisma structure.

- [ ] **Step 1: Write failing tests** for deterministic application/season/target-level resolution, version metadata in detail, configured requirements in checklist/assessment, no FE matrix authority, and five-criterion City behavior without priority/collective leakage.
- [ ] **Step 2: Run the focused criteria/detail tests** and verify they fail because the detail currently uses hardcoded City thresholds and has no resolved version contract.
- [ ] **Step 3: Implement the resolver** on top of `loadCriteriaRules`; if a reviewed City application cannot deterministically resolve a non-fallback active version, return/report the exact criteria authority blocker rather than silently selecting latest or inventing a heuristic.
- [ ] **Step 4: Replace the review service’s hardcoded City threshold path** with configured rules for reviewer checklist and backend assessment. Unsupported rule types remain explicitly advisory/unresolved, never authoritative pass/fail.
- [ ] **Step 5: Keep FE changes minimal**: update API types/normalization to preserve the resolved contract and stop City review presentation from treating `criteria-matrix.ts` as authoritative; do not redesign the workspace.
- [ ] **Step 6: Run focused backend criteria/detail tests and relevant FE contract tests/build** and verify the response remains backward-compatible apart from the additive authoritative criteria metadata.
- [ ] **Step 7: Commit** the criteria contract slice if FE/BE files changed: `fix: align city review criteria contract`.

### Task 3: Supplement-required mutation guard

**Files:**

- Modify: `src/modules/review/review.service.ts` permission/action guards and resubmit transition handling only.
- Test: `tests/unit/review-task-detail.test.ts` or a focused `tests/unit/review-s4-safety.test.ts`, plus existing application supplement tests if the same-task transition is touched.

**Interfaces:**

- Consumes: existing `ReviewDecision`, `ReviewTaskStatus`, student resubmit flow, and normal City Officer permission policy.
- Produces: City Officer read-only visibility for `supplement_required`, denial of accept/reject/supplement/escalate until the same task returns to `waiting`, and normal action availability after resubmission.

- [ ] **Step 1: Write failing tests** for request supplement → `supplement_required`, all prohibited City Officer mutations while waiting, student resubmit of the same task → `waiting`, normal review resume, and unrelated criteria unaffected.
- [ ] **Step 2: Run the focused supplement tests** and verify the current assigned-officer permission path still permits mutation while `supplement_required`.
- [ ] **Step 3: Implement the backend guard** in the canonical permission/decision path; preserve manager/admin exceptions already supported by the existing contract and preserve student resubmission behavior.
- [ ] **Step 4: Run focused supplement and existing application lifecycle tests** and verify all transitions and denials pass.
- [ ] **Step 5: Commit** the supplement guard slice: `fix: guard city review supplement state`.

### Task 4: Atomic claim hardening

**Files:**

- Modify: `src/modules/review/review.service.ts` individual and collective claim mutation predicates.
- Test: `tests/unit/review-task-detail.test.ts` or a focused `tests/unit/review-s4-safety.test.ts`.

**Interfaces:**

- Consumes: existing claimable permission calculation, transaction/lock behavior, `taskClaimConflict`, and S3 FE `409` handling.
- Produces: claim CAS requiring `waiting`, `assignedOfficerId=null`, `decision=null`, and the fetched `updatedAt` (or an equivalent freshness token), with no fallback update.

- [ ] **Step 1: Write failing tests** for two officers racing, stale waiting → supplement/resolution/final status, already assigned, and successful waiting claim → reviewing + assigned.
- [ ] **Step 2: Run the focused claim tests** and verify a stale non-waiting or changed-freshness task can currently be overwritten.
- [ ] **Step 3: Implement the atomic predicates** inside the existing transaction for individual and collective tasks; map zero-row updates to the existing `409` conflict error and leave task state unchanged.
- [ ] **Step 4: Run focused claim tests and the S3 review route/list regression tests** and verify compatibility.
- [ ] **Step 5: Commit** the claim slice: `fix: harden review task claim concurrency`.

### Task 5: Contract documentation and final verification

**Files:**

- Modify: the existing relevant Staff Review contract documentation under `docs/staff-lane/` only after behavior is verified.
- Modify: no Operations artifacts.

- [ ] **Step 1: Update docs** with actual evidence authorization, criteria authority/version projection, supplement guard, and claim conflict behavior; do not document unimplemented S4 UI.
- [ ] **Step 2: Run focused BE tests, BE build, scoped BE lint, relevant FE tests/build, and then the full BE test suite.** Record command output and failure counts.
- [ ] **Step 3: Inspect diff/status** for scope, confirm no migration/new endpoint/push/merge and no unrelated repairs.
- [ ] **Step 4: Use the finishing/verification workflow** and create no additional commit unless verification requires a tested fix. Stop on `feat/staff-review` without starting S4 UI.
