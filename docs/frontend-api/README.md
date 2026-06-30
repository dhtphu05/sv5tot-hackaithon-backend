# Frontend API Integration

Bo tai lieu nay la diem bat dau de frontend ket noi voi 5TOT Backend. Contract runtime
van duoc quyet dinh boi route, validation va OpenAPI trong backend.

## Thu tu doc

1. [Ke hoach tich hop](./00-integration-plan.md)
2. [Quy uoc API va xac thuc](./01-conventions-auth.md)
3. [Kieu du lieu va trang thai dung chung](./02-shared-types-statuses.md)
4. [Ho so SV5T ca nhan](./03-student-application.md)
5. [Minh chung, su kien va indexing job](./04-evidence-events-jobs.md)
6. [Ho so SV5T tap the](./05-collective.md)
7. [Nghiep vu can bo xet duyet](./06-review-officer.md)
8. [Nghiep vu quan ly va hoi dong](./07-manager-committee.md)
9. [Thong bao, kho tri thuc va export](./08-notifications-knowledge-exports.md)
10. [Checklist implement frontend](./09-frontend-implementation.md)

## Nguon contract

- Swagger UI: `GET /api/docs`
- OpenAPI source: `src/docs/openapi.ts`
- Route va role: `src/modules/*/*.routes.ts`
- Request validation: `src/modules/*/*.validation.ts`
- Enum: `prisma/schema.prisma`

Neu docs va runtime khac nhau, uu tien theo thu tu: validation/route, OpenAPI, bo docs
nay. Khi backend thay contract, phai cap nhat OpenAPI va file domain lien quan trong
cung thay doi.

## Pham vi hien tai

Da co the tich hop: auth, user, application ca nhan, metric, evidence, event registry,
precheck, cascade review, collective profile, review, manager, resolution,
notification, knowledge base va export.

Chua tich hop vao UI production vi dang tra `501 NOT_IMPLEMENTED`:

- `GET /api/audit/logs`
- `POST /api/chatbot/message`
- `POST /api/smartux/events`
- `GET /api/smartux/dashboard`

OpenAPI hien con khai bao legacy path `POST /api/exports/applications`, nhung route
nay khong duoc mount trong runtime. Frontend khong duoc goi path nay.
