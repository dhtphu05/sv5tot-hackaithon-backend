# Evidence Knowledge Migration Reconciliation

Date: 2026-07-20

## Scope

This pass reconciled Prisma migration history and verified the pending Evidence Knowledge V2 migration without applying migrations to the configured database.

No runtime code, API behavior, schema model definitions, production migration records, or remote database rows were changed.

## Local Migration History

Local migration directories after reconciliation:

1. `20260630000100_phase9_collective`
2. `20260702143000_add_application_finalization_fields`
3. `20260702162000_add_review_task_level_assessment`
4. `20260703230000_smartreader_foundation`
5. `20260704131500_evidence_ocr_pipeline`
6. `20260704170000_decision_import_center_real`
7. `20260705103000_chatbot_foundation`
8. `20260705120000_notification_context_links`
9. `20260705143000_email_outbox`
10. `20260705143000_resolution_case_review_task_link`
11. `20260716123000_workspace_foundation`
12. `20260716150000_workspace_tenant_anchors`
13. `20260717110000_requirement_completion`
14. `20260717123000_metric_metadata`
15. `20260719170000_evidence_knowledge_v2`

## Database Migration History

Read-only Prisma migration status before reconciliation reported:

- 14 local migrations.
- Last common migration: `20260717123000_metric_metadata`.
- Pending local migration: `20260719170000_evidence_knowledge_v2`.
- Database migration missing from local repo: `20260630000100_phase9_collective`.

Read-only Prisma migration status after reconciliation reported:

- 15 local migrations.
- No database migration is missing locally.
- Pending local migration: `20260719170000_evidence_knowledge_v2`.
- No migration was applied during this pass.

The configured database in Prisma status is a Supabase PostgreSQL pooler endpoint. No database credentials were printed.

## Missing Migration Source

The missing migration was found in repository history:

- Added in commit `e46f1ac36c931bb40116dea0dccb8a9c66195126` with path `prisma/migrations/20260630000100_phase9_collective/migration.sql`.
- Deleted in commit `643c497a3ef0fc36cb44e950e306acfa8e2fc5b6`.
- Branch containment showed the adding commit is reachable from the current branch and multiple local/remote branches; the deleting commit is reachable from `origin/nguoi-4` and current descendants.

The local file was restored from the exact SQL in commit `e46f1ac36c931bb40116dea0dccb8a9c66195126`. A local comparison confirmed exact content equality by length and text match.

No approximate or invented historical migration was created.

## Restored Migration Summary

`20260630000100_phase9_collective` contains Phase 9 collective profile support:

- Adds collective-related values to `CollectiveStatus`.
- Adds `collectiveProfileId` references to `Evidence`, `ReviewTask`, `AuditLog`, and `Notification`.
- Makes `Evidence.applicationId` and `ReviewTask.applicationId` nullable for collective-owned records.
- Adds finalization fields to `CollectiveProfile`.
- Adds metadata fields to `CollectiveMember` and `CollectiveEvidence`.
- Creates `CollectivePrecheckResult`.
- Uses `IF NOT EXISTS` or constraint guards for added columns, indexes, constraints, and table creation.

## Evidence Knowledge Migration Review

Pending migration: `20260719170000_evidence_knowledge_v2`.

PostgreSQL compatibility review:

- Uses PostgreSQL extensions `pgcrypto`, `unaccent`, and `pg_trgm`.
- Extension creation is guarded with `CREATE EXTENSION IF NOT EXISTS`.
- Creates Prisma enum types:
  - `ApprovedEvidenceApprovalSource`
  - `ApprovedEvidencePrecedentStatus`
  - `EventRegistryAliasType`
  - `EventRegistryAliasVerificationSource`
- Creates additive tables:
  - `EventRegistryAlias`
  - `WorkspaceAbbreviation`
  - `ApprovedEvidencePrecedent`
- Adds foreign keys to existing domains instead of duplicating them:
  - `Workspace`
  - `EventRegistry`
  - `Evidence`
  - `EvidenceCard`
  - `ReviewTask`
  - `ResolutionCase`
  - `File`
  - `CriteriaVersion`
- Adds uniqueness and search indexes:
  - one active source mapping per `sourceEvidenceId`;
  - alias uniqueness by `workspaceId + eventId + normalizedAliasKey`;
  - abbreviation uniqueness by `workspaceId + normalizedTokenKey`;
  - btree indexes for workspace/criterion/status/year/source lookups;
  - GIN trigram indexes for normalized title, alias, abbreviation, organizer, and OCR keys.

Risk review:

- No `UPDATE`, `DELETE`, or data-copy backfill exists in the Evidence Knowledge migration.
- Existing `Evidence`, `ReviewTask`, `ResolutionCase`, `EventRegistry`, and `File` rows remain intact.
- Physical files are not copied.
- Cross-workspace data is not backfilled or merged by SQL.
- New enum creation is not idempotent if a partially applied/manual precreated enum exists; this is acceptable for a normal Prisma migration sequence but must not be retried manually after partial failure without inspection.
- `pg_trgm` and `unaccent` extension privileges must be confirmed in the target PostgreSQL environment before deployment.

## Verification Results

Completed:

- `npx prisma migrate status --schema prisma/schema.prisma`: after restoring the historical migration, only `20260719170000_evidence_knowledge_v2` is pending.
- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run build`: passed.
- `npm run lint`: passed with 18 existing warnings and 0 errors.
- Focused tests passed:
  `npx vitest run tests/unit/evidence-knowledge.service.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/review-task-detail.test.ts tests/unit/review-progress.test.ts`
  Result: 6 files passed, 26 tests passed.

Not completed:

- Applying all migrations from zero on a disposable local/test PostgreSQL database was not completed because:
  - `127.0.0.1:5432` is not listening;
  - `docker` is not installed;
  - `psql` is not installed;
  - no disposable PostgreSQL service was available in this environment.

No migration was applied to the configured Supabase database.

## Exact Blocker

The migration history mismatch is resolved locally, but the Evidence Knowledge migration is not ready to apply until the full migration chain is verified from zero on a disposable PostgreSQL database.

The smallest required resolution is to provide or start a disposable PostgreSQL database, point `DATABASE_URL` to that database only for the verification shell, and apply the full local migration directory there.

## Safe Next Command Sequence

Use a disposable database only. Do not run these commands against Supabase/shared data until the first zero-from-scratch pass succeeds.

Example sequence:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/sv5tot_migration_reconcile"
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate status --schema prisma/schema.prisma
npx prisma validate
npx prisma generate
npm run build
npm run lint
npx vitest run tests/unit/evidence-knowledge.service.test.ts tests/unit/evidence-matching.service.test.ts tests/unit/evidence-registry-matcher.test.ts tests/unit/official-import-name-match.test.ts tests/unit/review-task-detail.test.ts tests/unit/review-progress.test.ts
```

If the disposable run succeeds, then for the intended non-disposable environment:

```powershell
npx prisma migrate status --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate status --schema prisma/schema.prisma
```

Before non-disposable deployment, capture a database backup/snapshot and confirm `pgcrypto`, `unaccent`, and `pg_trgm` are allowed.

## Rollback And Recovery Notes

- The restored historical migration file should remain in source control because the database has already recorded it.
- Do not delete or edit the remote `_prisma_migrations` row for `20260630000100_phase9_collective`.
- Do not use `prisma migrate resolve` for `20260630000100_phase9_collective`; exact SQL has been restored locally.
- If `20260719170000_evidence_knowledge_v2` fails during a disposable run, drop the disposable database and inspect the failing statement before changing SQL.
- If it fails during a non-disposable deploy, stop immediately, preserve logs, inspect `_prisma_migrations`, and restore from the pre-deployment backup/snapshot if the database is left partially changed.

## New Migration Deployment Readiness

The new Evidence Knowledge migration is structurally additive and passed static/schema/build/lint/focused-test verification, but deployment readiness is blocked until a zero-from-scratch migration run succeeds on disposable PostgreSQL.

MIGRATION_READY_TO_APPLY: NO
