# Checklist implement frontend

## API client

- Base URL lay tu environment, khong hardcode trong component.
- Mot ham duy nhat unwrap `ApiResponse<T>`.
- Bearer token duoc gan trong interceptor/fetch wrapper.
- Refresh token co single-flight lock va gioi han mot retry.
- Error object giu `status`, `code`, `message`, `details`, `requestId`.
- Binary download khong di qua JSON unwrap.
- Multipart khong tu gan `Content-Type`.

## Query va cache

Query key de xuat:

```ts
['me'][('application', 'current', schoolYear)][('application', applicationId)][
  ('application', applicationId, 'evidences', filters)
][('job', jobId)][('events', filters)][('collective', 'current', schoolYear, className)][
  ('collective', collectiveId)
][('collective', collectiveId, 'members', filters)][('review-tasks', filters)][
  ('review-task', taskId)
][('manager-applications', filters)][('resolution-cases', filters)][('notifications', page)];
```

Sau mutation, invalidate resource detail va list lien quan. Khong tu sua state machine
phuc tap trong cache neu server da tra contract moi.

## Route theo role

| Khu vuc UI          | Roles                              |
| ------------------- | ---------------------------------- |
| Ho so ca nhan       | student, class_representative      |
| Ho so tap the       | class_representative               |
| Review queue        | officer, manager, committee, admin |
| Manager dashboard   | manager, committee, admin          |
| Assignment/workload | manager, admin                     |
| Resolution Hub      | manager, committee, admin          |
| Reopen final/case   | committee, admin                   |

Role guard chi phuc vu UX; khong thay authorization cua backend.

## Form

- Enum select gui value lowercase.
- School year dung `YYYY-YYYY`.
- Date-time convert sang ISO string.
- Search khong gui chuoi rong.
- `limit <= 100`.
- Client validation mirror cac rang metric va max length quan trong.
- Van hien loi backend vi client validation khong phai source of truth.

## Upload va indexing

- Validate MIME va size truoc upload.
- Field multipart ten `file`.
- Hien progress neu HTTP client ho tro.
- Sau upload, goi start-indexing rieng.
- Poll job den terminal state, co cancel/timeout.
- Refetch evidence/card khi job complete.

## State va command

- Disable nut command khi request dang chay.
- Submit/finalize/decision can confirm theo muc do anh huong.
- `completed`, `rejected` la read-only.
- `supplement_required` chi mo phan backend cho phep.
- AI/OCR/precheck khong tu dong tao human decision.

## Error UX

- `400 VALIDATION_ERROR`: field/form message.
- `401`: refresh mot lan, sau do logout.
- `403`: forbidden screen/toast, khong refresh.
- `404`: not-found state.
- `409`: refetch resource va thong bao conflict.
- `429`: thong bao thu lai sau.
- `500`: generic message kem request ID.
- `501`: feature unavailable, khong retry.

## E2E toi thieu

1. Student login, start application, autosave.
2. Student add metric, upload/index evidence, precheck, submit.
3. Class representative import roster, precheck, submit collective.
4. Officer open assigned task va request supplement/decision.
5. Manager assign task, xem aggregation va finalize.
6. Committee decide resolution case.
7. Refresh token rotation va logout.
8. CSV export/download.

## Demo accounts

Mat khau seed mac dinh: `Password@123`.

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

Tat ca email seed dung domain `@dut.udn.vn`.
