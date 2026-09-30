# Pilot Bootstrap

This is separate from the legacy QA fixture seed. `npm run seed` and `npm run seed:qa` both execute `prisma/seed.ts`, which creates demo users and QA workspaces; never run either against a pilot database. Pilot commands are additive and do not reset/delete data.

## Safety boundary

Both pilot commands require `PILOT_DATABASE_URL` and accept only PostgreSQL URLs on `localhost`, `127.0.0.1`, or `::1` whose database name contains `pilot`. The server must be PostgreSQL 16. They ignore the normal `DATABASE_URL` and refuse `NODE_ENV=production`. Do not point them at Supabase, shared development, staging, or production. No pilot script runs migrations; first provision a fresh disposable local database, then run `DATABASE_URL="$PILOT_DATABASE_URL" npm run migrate:deploy` after reviewing the local migration set.

`bootstrap:pilot` additionally requires `PILOT_BOOTSTRAP_CONFIRM=true`, a 8–128 character `PILOT_BOOTSTRAP_PASSWORD`, and a complete environment-supplied roster. The bootstrap password is never printed or stored in documentation. Newly created operational accounts share this temporary bootstrap password; set it through a local secret manager/environment and have an administrator reset each account after handoff. Existing accounts are never re-passworded, renamed, reactivated, or reassigned by a rerun.

## Required configuration

- `PILOT_DATABASE_URL`: local disposable PostgreSQL 16 URL with `pilot` in its database name.
- `PILOT_BOOTSTRAP_CONFIRM=true`: explicit write confirmation (bootstrap only).
- `PILOT_BOOTSTRAP_PASSWORD`: temporary password for newly created staff, 8–128 characters.
- `PILOT_SCHOOL_YEAR`: season/application year in `YYYY-YYYY` format.
- `DEFAULT_SCHOOL_YEAR`: must equal `PILOT_SCHOOL_YEAR` for this runtime.
- `PILOT_SCHOOLS_JSON`: non-empty JSON list of selected real schools only. Each item is `{ "code", "name", "shortName"?, "parentCode" }`; parent is `UDN` or `DANANG_CITY`. Codes must be unique and cannot use reserved root codes.
- `PILOT_STAFF_JSON`: non-empty JSON list of actual assigned operating staff. Each item has `email`, `fullName`, `role`, and `workspaceCode` where applicable. Allowed roles are `admin`, `data_uploader`, `city_officer`, `city_manager`, and `city_committee`. Admin is global; all City staff belong to `DANANG_CITY`; uploaders belong to `UDN` or a configured school. City officers need `specializations` drawn only from the five canonical criteria. The configured City Officer accounts collectively cover exactly ethics, academic, physical, volunteer, and integration. At least one account for every operational role is required. Do not use example/demo identities for real staff.
- `PILOT_SEASON_DATES_JSON`: required JSON containing ISO-8601 `submissionOpensAt` and `submissionClosesAt` where close is later than open. Optional fields: `reviewDeadlineAt`, `supplementDeadlineAt`, `finalizationDeadlineAt`.

The command creates/validates the fixed `DANANG_CITY` and `UDN` roots, then only the schools and staff supplied above. New school registrations start closed; the bootstrap never opens student registration. It creates the configured `CityReviewSeason`, active City `CriteriaVersion` rules from the existing City criteria, and the existing normalized City criteria config. Criteria policy is reused, not changed. No students, applications, evidence, review tasks, Award recipients, resolutions, finals, or histories are created.

## Commands

After exporting the required values in the shell or setting them in a local secret store:

```sh
npm run bootstrap:pilot
npm run bootstrap:pilot:verify
npm run bootstrap:pilot
npm run bootstrap:pilot:verify
```

The verification command is read-only. It checks the local PostgreSQL major version, City → UDN → configured school hierarchy, active City season dates, current City criteria, configured staff role/workspace/activity, exactly the five active City Officer specializations, and registration choices containing only configured active schools. It reports current student/application counts for context; it does not infer whether existing student data is fake. Bootstrap code itself has no student/application creation path.

The second bootstrap must report reused staff and no additional rows. It does not overwrite an existing season if dates differ, change workspace activation/registration state, or reactivate a specialization; instead it fails with a configuration mismatch so an operator can inspect through the Admin APIs.

## Opening and closing registration

After verification, Admin opens or closes registration school-by-school using `PATCH /api/admin/workspaces/:workspaceId/status` with `{ "registrationEnabled": true }` or `false`. Opening requires an active SCHOOL workspace with active criteria. Public signup choices immediately follow active + open + SCHOOL state. Closing registration blocks only new signups; existing students continue to log in. The City submission window is a separate control on `CityReviewSeason` and must be configured independently.

Use Admin APIs for later staff operations: `POST /api/admin/users` creates staff with role/workspace validation; `PUT /api/admin/users/:userId/specializations` manages City Officer criteria; `POST /api/admin/users/:userId/reset-password` safely resets a password and revokes refresh sessions. Admin-created students are available to authorized admin workflows, but public pilot signup remains student-only.

## QA fixture separation

`npm run seed:qa` is for disposable QA databases only; legacy `npm run seed` remains an alias to the same fixture seed for compatibility. It includes fake students and demo workspaces. Never run it on a pilot database. Pilot bootstrap does not call or import the QA seed entry point.

## Rehearsal record

This branch has unit coverage for configuration validation and auth behavior. A fresh-database `migrate deploy → bootstrap → verify → bootstrap again → verify`, HTTP canary registration/login/logout/refresh, and PostgreSQL concurrency rehearsal have not been run because no `PILOT_DATABASE_URL` local PostgreSQL 16 disposable DB was supplied. No production database was used or modified.
