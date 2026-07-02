# Backend Evidence & Review Curl Tests (Person 2)

Tai lieu nay giup test nhanh scope Person 2 khong can frontend: event registry, evidence, review task, notification, resolution, manager summary/export.

## 0. Chuan bi

Chay server:

```bash
npm run dev
```

Neu da chay seed chinh cua Person 1, co the them demo data rieng cho Person 2:

```bash
npx tsx scripts/seed-person2-demo.ts
```

Script demo rieng nay khong sua `prisma/seed.ts`. Script se tao/upsert:

- Event confirmed `Mua he xanh 2025`.
- 2 participants: `102220001` va `109990001`.
- 2 knowledge base items mau cho `volunteer`.

Thiet lap bien moi truong:

```bash
BASE_URL=http://localhost:8080
STUDENT_EMAIL=student@dut.udn.vn
OFFICER_EMAIL=officer.volunteer@dut.udn.vn
MANAGER_EMAIL=manager@dut.udn.vn
PASSWORD=ChangeMe123!

STUDENT_TOKEN=
OFFICER_TOKEN=
MANAGER_TOKEN=
APPLICATION_ID=
EVENT_ID=
EVIDENCE_ID=
TASK_ID=
RESOLUTION_CASE_ID=
```

Neu mat khau seed chinh khac, xem `SEED_DEFAULT_PASSWORD` trong `.env`.

## 1. Login student/officer/manager

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STUDENT_EMAIL\",\"password\":\"$PASSWORD\"}"
```

Expected: `success=true`, `data.accessToken`.

Set token:

```bash
STUDENT_TOKEN=<copy data.accessToken>
```

Lap lai cho officer va manager:

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OFFICER_EMAIL\",\"password\":\"$PASSWORD\"}"

OFFICER_TOKEN=<copy data.accessToken>

curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$MANAGER_EMAIL\",\"password\":\"$PASSWORD\"}"

MANAGER_TOKEN=<copy data.accessToken>
```

## 2. Lay application current hoac tao application

```bash
curl -s "$BASE_URL/api/applications/current?schoolYear=2025-2026" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Expected: co `data.id` neu Person 1 seed/application da co.

Neu chua co, tao application:

```bash
curl -s -X POST "$BASE_URL/api/applications/current/start" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schoolYear":"2025-2026","targetLevel":"city"}'
```

Set:

```bash
APPLICATION_ID=<copy data.id>
```

Neu buoc nay phu thuoc Person 1 chua merge, dung placeholder `APPLICATION_ID` tu DB.

## 3. Officer/manager tao event confirmed

```bash
curl -s -X POST "$BASE_URL/api/events" \
  -H "Authorization: Bearer $OFFICER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventName":"Mùa hè xanh 2025",
    "organizer":"Đoàn Trường Đại học Bách khoa - ĐHĐN",
    "organizerLevel":"school",
    "criterion":"volunteer",
    "startDate":"2025-07-01T00:00:00.000Z",
    "endDate":"2025-07-30T00:00:00.000Z",
    "status":"confirmed"
  }'
```

Expected: `data.id`, `data.status="confirmed"`.

Manager token cung duoc chap nhan neu can tao event tu workspace quan ly.

Set:

```bash
EVENT_ID=<copy data.id>
```

Neu da chay `scripts/seed-person2-demo.ts`, co the lay event:

```bash
curl -s "$BASE_URL/api/events?q=Mùa%20hè%20xanh&status=confirmed" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

## 4. Import participants JSON

```bash
curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/participants/import" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode":"upsert",
    "participants":[
      {
        "studentCode":"102220001",
        "fullName":"Nguyễn Văn Sinh",
        "className":"22T_DT1",
        "faculty":"Khoa Công nghệ Thông tin",
        "attendanceStatus":"confirmed",
        "convertedValue":10
      },
      {
        "studentCode":"109990001",
        "fullName":"Sinh viên Không Khớp",
        "className":"22T_DT2",
        "faculty":"Khoa Công nghệ Thông tin",
        "attendanceStatus":"confirmed",
        "convertedValue":8
      }
    ]
  }'
```

Expected: `data.importedCount=2`.

## 5. Student check participant

```bash
curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/check-participant" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"applicationId":"'"$APPLICATION_ID"'"}'
```

Expected: `data.isParticipant=true` voi demo student `102220001`.

Test false can dung staff token vi student khong duoc check studentCode nguoi khac:

```bash
curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/check-participant" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"studentCode":"000000000"}'
```

Expected: `data.isParticipant=false`.

## 6. Student import event thanh evidence

```bash
curl -s -X POST "$BASE_URL/api/events/$EVENT_ID/import-to-application" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "applicationId":"'"$APPLICATION_ID"'",
    "evidenceName":"Tham gia Mùa hè xanh 2025",
    "note":"Import từ Event Registry"
  }'
```

Expected: `data.evidence.id`, `data.alreadyImported=false` hoac `true` neu da import truoc do.

Set:

```bash
EVIDENCE_ID=<copy data.evidence.id>
```

## 7. Student tao manual evidence

```bash
curl -s -X POST "$BASE_URL/api/applications/$APPLICATION_ID/evidences" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "evidenceName":"Giấy chứng nhận tình nguyện upload tay",
    "criterion":"volunteer",
    "sourceType":"manual_upload",
    "description":"Bản scan giấy chứng nhận tình nguyện"
  }'
```

Expected: `data.id` hoac `data.evidence.id` tuy response controller hien tai.

Set:

```bash
MANUAL_EVIDENCE_ID=<copy evidence id>
```

## 8. Student upload file evidence

Tao file PDF test toi thieu:

```bash
printf '%s\n' '%PDF-1.4' '1 0 obj <<>> endobj' 'trailer <<>>' '%%EOF' > /tmp/person2-demo-certificate.pdf
```

Upload:

```bash
curl -s -X POST "$BASE_URL/api/evidences/$MANUAL_EVIDENCE_ID/files" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -F "file=@/tmp/person2-demo-certificate.pdf;type=application/pdf" \
  -F "displayName=demo-certificate.pdf" \
  -F "note=Upload minh chứng demo"
```

Expected: `data.file.id`, `data.mode="non_ai"`, evidence `indexingStatus="indexed"`.

## 9. Manager/officer ensure review tasks

```bash
curl -s -X POST "$BASE_URL/api/review/applications/$APPLICATION_ID/tasks/ensure" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"missing_only"}'
```

Expected: `data.ensuredCount` va `data.createdTaskIds`.

Neu route contract cua FE dung `/ensure-tasks`, backend hien tai dang expose `/tasks/ensure`.

## 10. Officer list tasks

```bash
curl -s "$BASE_URL/api/review/tasks?applicationId=$APPLICATION_ID&criterion=volunteer&limit=10" \
  -H "Authorization: Bearer $OFFICER_TOKEN"
```

Expected: `data.items[]`.

Set:

```bash
TASK_ID=<copy data.items[0].id>
```

## 11. Officer xem detail task

```bash
curl -s "$BASE_URL/api/review/tasks/$TASK_ID" \
  -H "Authorization: Bearer $OFFICER_TOKEN"
```

Expected: `data.task.id`, `data.evidences[]`.

## 12. Officer request supplement

```bash
curl -s -X POST "$BASE_URL/api/review/tasks/$TASK_ID/request-supplement" \
  -H "Authorization: Bearer $OFFICER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason":"Cần bổ sung giấy xác nhận có dấu của đơn vị tổ chức.",
    "deadline":"2026-12-31T23:59:59.000Z"
  }'
```

Expected: task/application sang `supplement_required`, student co notification `supplement_requested`.

## 13. Student list notifications va mark read

```bash
curl -s "$BASE_URL/api/notifications?isRead=false&type=supplement_requested" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Expected: `data.items[]` co notification yeu cau bo sung.

Set:

```bash
NOTIFICATION_ID=<copy data.items[0].id>
```

Mark read:

```bash
curl -s -X PATCH "$BASE_URL/api/notifications/$NOTIFICATION_ID/read" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Expected: `data.notification.isRead=true`.

## 14. Officer accept task

Neu task dang supplement_required va policy hien tai chan officer accept lai, manager co the reopen/aggregate sau khi student bo sung. Neu task co the decision truc tiep:

```bash
curl -s -X POST "$BASE_URL/api/review/tasks/$TASK_ID/decision" \
  -H "Authorization: Bearer $OFFICER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision":"accepted",
    "officerNote":"Minh chứng đủ điều kiện.",
    "evidenceDecisions":[]
  }'
```

Expected: `data.task.status="accepted"` hoac review progress cap nhat.

## 15. Officer escalate resolution cho task khac

Lay task khac neu can:

```bash
curl -s "$BASE_URL/api/review/tasks?applicationId=$APPLICATION_ID&status=waiting&limit=10" \
  -H "Authorization: Bearer $OFFICER_TOKEN"
```

Set:

```bash
TASK_ID=<copy task id can escalate>
```

Escalate:

```bash
curl -s -X POST "$BASE_URL/api/review/tasks/$TASK_ID/escalate-resolution" \
  -H "Authorization: Bearer $OFFICER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Tiêu chí mập mờ, cần Hội đồng xác nhận."}'
```

Expected: application/task sang `resolution_needed`, manager co resolution notification.

## 16. Manager/committee resolve case

List cases:

```bash
curl -s "$BASE_URL/api/resolution/cases?status=open&limit=10" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Expected: `data.items[]`.

Set:

```bash
RESOLUTION_CASE_ID=<copy data.items[0].id>
```

Resolve:

```bash
curl -s -X POST "$BASE_URL/api/resolution/cases/$RESOLUTION_CASE_ID/resolve" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision":"accepted",
    "note":"Hội đồng xác nhận minh chứng được tính cho tiêu chí tình nguyện cấp Trường.",
    "updateKnowledgeBase":true,
    "knowledgeBaseTitle":"GCN tình nguyện thiếu cấp tổ chức nhưng có xác nhận Đoàn trường",
    "evidenceDecisions":[]
  }'
```

Expected: `data.resolutionCase.status="resolved"`, related task/evidence/application duoc cap nhat.

## 17. Manager xem application summary/workload

Summary:

```bash
curl -s "$BASE_URL/api/manager/applications/$APPLICATION_ID/summary" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Expected: `data.application`, `data.evidences`, `data.reviewTasks`, `data.aggregation`.

Workload:

```bash
curl -s "$BASE_URL/api/manager/workload" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Expected: `data.officers[]`, `data.unassigned`.

Manual aggregate:

```bash
curl -s -X POST "$BASE_URL/api/manager/applications/$APPLICATION_ID/aggregate" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"note":"Tổng hợp thủ công demo Person 2."}'
```

Expected: `data.application.status` theo review task statuses.

## 18. Manager export CSV/JSON

Applications JSON:

```bash
curl -s "$BASE_URL/api/exports/applications.json?schoolYear=2025-2026" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```

Expected: `data.exportedAt`, `data.filters`, `data.items[]`.

Applications CSV:

```bash
curl -L "$BASE_URL/api/exports/applications.csv?schoolYear=2025-2026" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -o sv5t-applications.csv
```

Expected: file CSV co columns `applicationId,schoolYear,applicationType,...`.

Review tasks CSV:

```bash
curl -L "$BASE_URL/api/exports/review-tasks.csv?schoolYear=2025-2026&criterion=volunteer" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -o sv5t-review-tasks.csv
```

Expected: file CSV co task volunteer va thong tin assigned officer/student.

## Permission smoke tests

Student khong duoc export:

```bash
curl -i "$BASE_URL/api/exports/applications.json" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Expected: HTTP `403`.

Student khong duoc list resolution cases:

```bash
curl -i "$BASE_URL/api/resolution/cases" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Expected: HTTP `403`.

## Final manual smoke checklist

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
