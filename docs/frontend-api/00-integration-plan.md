# Ke hoach tich hop frontend

## Gia dinh

- Frontend chay tai origin duoc khai bao trong `CORS_ORIGIN`.
- Backend local mac dinh: `http://localhost:8080`.
- Frontend dung JSON, tru cac endpoint upload `multipart/form-data` va download file.
- Access token duoc gui bang Bearer token; refresh token hien duoc tra trong JSON.
- UI phan quyen theo `user.role`, nhung backend van la noi quyet dinh authorization.

## Muc tieu hoan thanh

- Tat ca request di qua mot API client dung chung.
- Refresh token duoc rotate va chi retry request 401 toi da mot lan.
- Cac list doc `meta.pagination`, khong suy dien pagination tu do dai mang.
- Form gui dung enum va validation backend.
- Upload gui field co ten chinh xac la `file`.
- UI phan anh dung state machine cua application, evidence, job va review task.
- Loi hien thi theo `error.code`; `requestId` duoc giu lai de doi chieu log.

## Cac dot implement

### Dot 1: API foundation

Frontend:

- Tao `apiClient`, base URL tu environment.
- Khai bao `ApiResponse<T>`, `ApiError`, `Pagination`.
- Implement login, refresh, logout, `GET /api/me`.
- Them auth guard va role guard.

Verify:

- Login bang `student@dut.udn.vn / Password@123`.
- Token het han tu refresh va request cu duoc retry dung mot lan.
- `401`, `403`, `400 VALIDATION_ERROR` hien thi dung.

### Dot 2: Luong sinh vien

Frontend:

- Application current/start/autosave/target level.
- Metric, evidence upload, indexing job polling.
- Event search/import.
- Precheck, cascade review, submit va timeline.

Verify:

- Tao ho so moi, autosave, them minh chung, index, precheck va submit.
- UI khoa edit khi ho so khong con o trang thai cho phep.

### Dot 3: Luong tap the

Frontend:

- Collective current/start/update.
- Roster CRUD/import CSV-XLSX.
- Evidence, import event, precheck, submit.

Verify:

- Login `classrep@dut.udn.vn`.
- Import roster va kiem tra `invalidRows`.
- Precheck phan anh score, missing items, warning va next action.

### Dot 4: Can bo xet duyet

Frontend:

- Danh sach/chi tiet review task.
- Decision tung minh chung va task.
- Yeu cau bo sung, chuyen Resolution Hub.

Verify:

- Task assignment va ownership duoc ton trong.
- Sau decision, status cua task/application duoc reload tu server.

### Dot 5: Quan ly va hoi dong

Frontend:

- Application/collective queue, workload, assignment.
- Aggregation, finalize, reopen final.
- Resolution case, knowledge base va export.

Verify:

- Khong cho finalize khi aggregation bi block, tru khi nguoi dung co quyen va gui
  `overrideAggregation`.
- Download CSV qua response blob.

### Dot 6: Hardening

Frontend:

- Loading/error/empty state cho moi query.
- Abort request khi unmount hoac thay filter.
- Debounce search, autosave va polling.
- Kiem tra responsive, accessibility va E2E cho cac flow chinh.

Verify:

- Khong co request loop khi refresh that bai.
- Khong upload file sai MIME/qua gioi han.
- Khong hien route/action ngoai role, nhung khong dua vao UI de bao mat.

## Thu tu phu thuoc

```text
auth -> me/role -> current profile
application -> metrics/evidences/events -> precheck -> submit
collective -> members/evidences/events -> precheck -> submit
submit -> review tasks -> aggregation/resolution -> finalize
```
