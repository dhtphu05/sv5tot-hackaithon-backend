# 5TOT Backend

Production-ready modular monolith backend for the 5TOT Platform.

## Local Setup

```bash
npm install
cp .env.example .env
# update DATABASE_URL and JWT secrets
npm run prisma:generate
npm run prisma:migrate -- --name phase1_auth_rbac_schema
npm run seed
npm run dev
```

## Demo Accounts

Default password: `Password@123`

- `student@dut.udn.vn`
- `classrep@dut.udn.vn`
- `officer.academic@dut.udn.vn`
- `officer.volunteer@dut.udn.vn`
- `officer.ethics@dut.udn.vn`
- `officer.physical@dut.udn.vn`
- `officer.integration@dut.udn.vn`
- `manager@dut.udn.vn`
- `committee@dut.udn.vn`
- `admin@dut.udn.vn`

## Implemented Endpoints

- `GET /health`
- `GET /api/version`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`
- `PATCH /api/me`
- `GET /api/users`
- `GET /api/applications/current`
- `POST /api/applications/current/start`
- `PATCH /api/applications/:id/target-level`
- `PATCH /api/applications/:id/draft`
- `GET /api/applications/:id/timeline`
- `POST /api/applications/:id/submit`
- `POST /api/applications/:id/reopen-supplement`
- `POST /api/applications/:id/metrics`
- `PATCH /api/metrics/:metricId`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `GET /api/docs`

## Phase 2 Quick Flow

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@dut.udn.vn","password":"Password@123"}' | jq -r '.data.accessToken')

curl "http://localhost:8080/api/applications/current?schoolYear=2025-2026" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:8080/api/applications/current/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schoolYear":"2025-2026","targetLevel":"school"}'
```

## Manual Checklist

1. `npm run prisma:migrate -- --name phase1_auth_rbac_schema`
2. `npm run prisma:generate`
3. `npm run seed`
4. Login `student@dut.udn.vn / Password@123`
5. Login with wrong password returns `401 INVALID_CREDENTIALS`
6. `GET /api/me` without token returns `401 UNAUTHORIZED`
7. `GET /api/me` with token returns a safe user object
8. Student calling `GET /api/users` returns `403 FORBIDDEN`
9. Manager calling `GET /api/users` succeeds
10. Refresh token rotates
11. Logout revokes refresh token
12. Placeholder route such as `GET /api/applications/current` returns `501 NOT_IMPLEMENTED` with a valid token
13. Swagger opens at `/api/docs`
14. No Supabase Auth or Supabase Storage is used
