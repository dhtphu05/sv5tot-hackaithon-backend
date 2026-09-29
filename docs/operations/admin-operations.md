# Admin operations and database bootstrap

## Routine operations

Use the Admin screens in the product for workspaces, users, City Officer specializations, and City Review Seasons. The server validates role/workspace combinations and retains records that already participate in a workflow.

- Create the `CITY` workspace and a `UNIVERSITY_SYSTEM` workspace, then attach each eligible `SCHOOL` to the university system from the workspace screen. A school with no parent uses the direct-city eligibility route. Parent changes are blocked once the school has applications, because current eligibility reads the live hierarchy and the application does not hold a hierarchy snapshot.
- Deactivate used workspaces and users instead of deleting them. User role/workspace reassignment is rejected once workflow or audit references make it unsafe. City Officers can be assigned only the five canonical criteria (`ethics`, `academic`, `physical`, `volunteer`, `integration`).
- Create or edit a City Review Season in Analytics. A season may be deleted only while no application exists for its school year. A used season returns `409 CITY_REVIEW_SEASON_IN_USE`; keep its history and close or edit it instead.
- Create uploader accounts with an initial password in the user screen. There is no admin password-reset endpoint in the current application; do not expose password hashes or substitute an insecure reset flow.
- Continue to use the existing Award Registry and Application lifecycle screens. Do not delete official Award or Application history to correct configuration.

## First Admin bootstrap

An empty installation needs one initial Admin account. The existing `create-admin` script is the infrastructure bootstrap path; set a unique email and a high-entropy temporary password through the environment, then rotate it through the organization’s approved credential process:

```sh
ADMIN_EMAIL="admin@example.org" ADMIN_PASSWORD="<temporary-secret>" DATABASE_URL="<database-url>" pnpm run create-admin
```

Use this only to establish the first Admin or recover a locked bootstrap account. Normal workspace, account, season, and specialization operations happen through the product APIs/UI, without reseeding.

## PostgreSQL migration bootstrap

The checked-in history now starts with `20260629000100_initial_schema_baseline`, a schema snapshot from the repository’s pre-migration schema at `e46f1ac`. It creates `CollectiveStatus` before `20260630000100_phase9_collective` first alters that enum. The historical chain previously assumed that this base schema already existed outside the migration directory. The source of that external schema in older deployments cannot be inferred from the repository alone.

For a completely empty database, apply the migration chain:

```sh
DATABASE_URL="<empty-database-url>" pnpm exec prisma migrate deploy
DATABASE_URL="<empty-database-url>" pnpm exec prisma migrate status
```

For a database that already has the old migration history and matching schema, verify its migration status and schema first. If and only if all older migrations are already applied and the baseline schema is already represented, mark the one-time baseline as applied, then deploy pending additive migrations:

```sh
DATABASE_URL="<verified-existing-database-url>" pnpm exec prisma migrate status
DATABASE_URL="<verified-existing-database-url>" pnpm exec prisma migrate resolve --applied 20260629000100_initial_schema_baseline
DATABASE_URL="<verified-existing-database-url>" pnpm exec prisma migrate deploy
DATABASE_URL="<verified-existing-database-url>" pnpm exec prisma migrate status
```

Do not use the baseline-resolution command to adopt an unknown schema, a database with missing historical migrations, or a schema-only database without migration records. Stop and investigate any unexpected pending/failed migration or schema difference. The resolution step records an already-present schema; it does not create that schema.

`20260929100000_reconcile_migration_history_gaps` adds missing notification enum values and query indexes with `IF NOT EXISTS`. It is safe when older environments already have those objects. The Prisma model now represents the database UUID/timestamp defaults and retained custom/trigram indexes, so migration diff against a fresh migrated database reports no difference. Do not apply `prisma db push`, `prisma migrate reset`, or hand-written SQL as the deployment bootstrap strategy.

## Verification scope

Migration bootstrap checks were run only against a uniquely named disposable local PostgreSQL container. Both a fresh database and a simulated already-migrated database were tested. Supabase/production was not connected to or modified by those checks.
