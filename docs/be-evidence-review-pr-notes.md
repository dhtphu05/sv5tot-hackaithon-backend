# Backend Evidence & Review PR Notes

## Summary

Hoan thien scope backend Person 2 cho MVP non-AI: evidence/event import, review task workflow, notifications, Resolution Hub co ban, manager workspace va export CSV/JSON. Scope giu logic manual, khong goi AI/OCR/LLM trong upload path.

## Scope

- Evidence upload/create/update/delete voi sourceType dung contract: `manual_upload`, `metric_input`, `event_import`, `collective_import`.
- Event Registry: tao event confirmed, import participant JSON, student check participant va import event thanh evidence.
- Review: ensure tasks, list/detail task, decision, request supplement, escalate resolution.
- Notifications: list ca nhan, mark read, read-all, helper noi bo `createNotification`.
- Resolution Hub: list/detail, resolve, update status, audit, notification, optional KB item tu note user nhap.
- Manager workspace: application list/summary, workload, reassign, aggregate non-AI.
- Export: applications JSON, applications CSV, review tasks CSV.
- Demo docs/script: curl tests va seed demo rieng, khong sua `prisma/seed.ts`.

## Non-AI Limitations

- `POST /api/evidences/:id/files` chi luu file metadata/storage va set manual evidence sang `indexed`; khong tao job `evidence_ocr`.
- `POST /api/evidences/:id/start-indexing` tra `mode="non_ai_disabled"`.
- Evidence card co the la mock/manual metadata; khong dung SmartReader/chatbot/smartux.
- Event roster indexing chi parse/import participant list, khong thay the quyet dinh cua officer.
- KB item tu resolution dung `note` va `knowledgeBaseTitle` cua user, khong sinh summary bang AI.

## Out Of Scope For Person 2 PR

```txt
[ ] Khong lam AI precheck.
[ ] Khong lam OCR that.
[ ] Khong goi VNPT SmartReader.
[ ] Khong lam chatbot/RAG.
[ ] Khong lam SmartUX AI analytics.
[ ] Khong sua frontend.
[ ] Khong refactor auth/application/metrics cua Nguoi 1.
[ ] Khong doi response contract chung.
[ ] Khong doi enum sang tieng Viet.
[ ] Khong doi route da thong nhat neu khong co ly do rat manh.
```

## API List

- `GET /api/events`
- `GET /api/events/:id`
- `POST /api/events`
- `POST /api/events/:id/participants/import`
- `POST /api/events/:id/check-participant`
- `POST /api/events/:id/import-to-application`
- `GET /api/applications/:id/evidences`
- `POST /api/applications/:id/evidences`
- `PATCH /api/evidences/:id`
- `DELETE /api/evidences/:id`
- `POST /api/evidences/:id/files`
- `GET /api/evidences/:id/card`
- `POST /api/evidences/:id/start-indexing`
- `POST /api/review/applications/:applicationId/tasks/ensure`
- `GET /api/review/tasks`
- `GET /api/review/tasks/:id`
- `POST /api/review/tasks/:id/decision`
- `POST /api/review/tasks/:id/request-supplement`
- `POST /api/review/tasks/:id/escalate-resolution`
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `PATCH /api/notifications/read-all`
- `GET /api/resolution/cases`
- `GET /api/resolution/cases/:id`
- `POST /api/resolution/cases/:id/resolve`
- `PATCH /api/resolution/cases/:id/status`
- `GET /api/manager/applications`
- `GET /api/manager/applications/:id/summary`
- `GET /api/manager/workload`
- `PATCH /api/manager/review-tasks/:id/reassign`
- `POST /api/manager/applications/:id/aggregate`
- `GET /api/exports/applications.json`
- `GET /api/exports/applications.csv`
- `GET /api/exports/review-tasks.csv`

## Handoff Cho Người 3 - Frontend Student Flow

Nguoi 3 co the noi cac API sau:

```txt
GET    /api/applications/:applicationId/evidences
POST   /api/applications/:applicationId/evidences
PATCH  /api/evidences/:id
DELETE /api/evidences/:id
POST   /api/evidences/:id/files
POST   /api/evidences/:id/start-indexing   // compatibility only, non-AI
GET    /api/events
GET    /api/events/:id
POST   /api/events/:id/check-participant
POST   /api/events/:id/import-to-application
GET    /api/notifications
PATCH  /api/notifications/:id/read
```

Luu y cho FE Student:

- Khong doc `data.jobId` nhu bat buoc. Sprint non-AI tra `jobId: null`.
- Upload xong evidence da san sang cho manual review.
- `sourceType` phai gui dung, backend khong tu doan.

## Handoff Cho Người 4 - Frontend Officer/Manager Flow

Nguoi 4 co the noi cac API sau:

```txt
POST  /api/review/applications/:applicationId/tasks/ensure
GET   /api/review/tasks
GET   /api/review/tasks/:id
POST  /api/review/tasks/:id/decision
POST  /api/review/tasks/:id/request-supplement
POST  /api/review/tasks/:id/escalate-resolution
GET   /api/manager/applications
GET   /api/manager/applications/:id/summary
GET   /api/manager/workload
PATCH /api/manager/review-tasks/:id/reassign
GET   /api/resolution/cases
GET   /api/resolution/cases/:id
POST  /api/resolution/cases/:id/resolve
GET   /api/exports/applications.json
GET   /api/exports/applications.csv
```

Luu y cho FE Officer/Manager:

- Neu application submit cua Nguoi 1 chua tu tao task, goi `POST /api/review/applications/:applicationId/tasks/ensure` truoc khi vao queue/demo.
- Review detail da tra evidence/metrics/application/student du de render ma khong can goi qua nhieu API phu.
- Export CSV co the la raw response, khong phai ApiResponse JSON.

## Test Checklist

- `pnpm build/test/lint`: not available locally because `pnpm` is not installed.
- `npm run build`: pass.
- `npm test`: pass, 8 files / 27 tests.
- `npm run lint`: pass, warnings only for flexible JSON/DTO `any`.
- Permission audit:
  - Student blocked from review task system list, participant import, checking another student code, resolution list, and exports.
  - Officer sees assigned/eligible review tasks and owned/criterion resolution cases.
  - Manager/committee/admin can use resolution/export; committee can aggregate; manager/admin can workload/reassign.
- State audit:
  - Supplement decision sets task/evidence/application supplement states and sends notification.
  - Escalation sets `resolution_needed` and creates/links resolution case.
  - Accepted/rejected/resolution evidence cannot be student-updated/deleted.
  - Aggregation computes from review task statuses only, no AI.
- SourceType audit:
  - `metric_input` starts under review/indexed.
  - `manual_upload` stays manual and becomes indexed after upload.
  - `event_import` is created by Event Registry import and stays under review/indexed.

## Manual Smoke Checklist

### Evidence

```txt
[ ] POST create evidence manual_upload luu dung sourceType.
[ ] POST create evidence metric_input luu dung sourceType.
[ ] evidenceName required.
[ ] GET list evidence tra data.items.
[ ] Upload PDF/JPG/PNG luu metadata.
[ ] start-indexing khong goi AI va khong lam FE cho job vo han.
[ ] Student khong sua evidence nguoi khac.
```

### Event Registry

```txt
[ ] Officer tao event confirmed duoc.
[ ] Student chi thay confirmed event.
[ ] Import participants JSON duoc.
[ ] Check participant dung true/false.
[ ] Student khong check MSSV nguoi khac.
[ ] Student import event thanh evidence event_import.
[ ] Import lap khong duplicate evidence.
```

### Review

```txt
[ ] Ensure review tasks idempotent.
[ ] Officer chi thay task dung quyen.
[ ] Manager thay toan bo task.
[ ] Detail task du application/student/evidence/metric.
[ ] Accept task cap nhat status.
[ ] Reject task yeu cau note.
[ ] Request supplement tao notification.
[ ] Escalate resolution tao case.
```

### Manager / Resolution / Export

```txt
[ ] Manager xem applications summary.
[ ] Manager xem workload.
[ ] Manager reassign task co audit.
[ ] Resolution list/detail/resolve chay duoc.
[ ] Export JSON chay duoc.
[ ] Export CSV tai duoc.
[ ] Student bi chan khoi manager/export.
```

### Non-AI Guardrail

```txt
[ ] Khong goi SmartReader/VNPT trong upload path.
[ ] Khong chatbot/RAG/LLM.
[ ] Khong semantic search.
[ ] Khong tu dong quyet dinh dat/rot bang AI.
```

## Potential Conflicts Khi Merge Với Người 1

- `prisma/schema.prisma` co enum/model changes cho notifications/event/review/resolution; can rebase can than neu Person 1 cung sua schema.
- `package-lock.json` da thay doi trong workspace npm; repo co the uu tien lockfile khac neu team dung pnpm.
- Application current/submit routes nam o module Person 1; curl docs dung placeholder neu route chua merge.
- Notification context fields can migration them neu FE can filter/query theo `evidenceId`, `reviewTaskId`, `resolutionCaseId`, `metadata`.
- Resolution status API support contract moi nhung DB enum hien normalize mot so status vao `committeeDecision.workflowStatus`.
