# Repository Guidance

This is the backend repo for the 5TOT platform.

## Required Context

Before meaningful work, read:

- `docs/CODEBASE_CONTEXT.md`

Update `docs/CODEBASE_CONTEXT.md` in place after meaningful implementation work. Do not create duplicate or timestamped context files.

## Backend Rules

- Follow the existing Express module structure: `validation`, `routes`, `controller`, `service`, `repository`, `dto` when applicable.
- Mount routes in `src/app.ts`.
- Use `requireAuth`, `requireRole`, `validate`, and `asyncHandler` consistently.
- Reuse the Prisma singleton from `src/infrastructure/database/prisma.ts`.
- Do not change `prisma/schema.prisma` unless the feature truly needs persistence changes.
- Keep API responses in the existing envelope style.
- Keep errors routed through `AppError` and existing error codes where possible.
- Do not log secrets, tokens, raw OCR payloads, or private user data.

## Verification

Use the narrowest relevant checks:

- `npm run build`
- `npx prisma validate` after Prisma schema changes
- `npx prisma generate` after Prisma schema/client changes
- `npx prisma migrate status` when migration state matters
- `npm test` for broad test runs, noting that integration tests require a local PostgreSQL test database at `localhost:5432` unless `DATABASE_URL` is overridden

If a check cannot be run or fails for pre-existing reasons, report that clearly.

