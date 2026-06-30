# Ho so SV5T tap the

Role so huu chinh: `class_representative`. Officer/manager/committee co quyen doc theo
tung route; manager/admin co mot so quyen sua.

## Profile

| Method  | URL                             | Role                      | Request                                     |
| ------- | ------------------------------- | ------------------------- | ------------------------------------------- |
| `GET`   | `/api/collective/current`       | class rep, admin          | `schoolYear?, className?`                   |
| `POST`  | `/api/collective/current/start` | class rep, admin          | `{ schoolYear?, className?, targetLevel? }` |
| `GET`   | `/api/collective/:id`           | reviewer roles            | -                                           |
| `PATCH` | `/api/collective/:id`           | class rep, manager, admin | `{ targetLevel?, className?, note? }`       |

Start:

```json
{
  "schoolYear": "2025-2026",
  "className": "22T1",
  "targetLevel": "school"
}
```

`GET current` tra profile `null` va `state=not_started` neu chua tao. Start la
idempotent theo dai dien/lop/nam hoc cua backend.

## Thanh vien

| Method   | URL                                     | Request                                                                           |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `GET`    | `/api/collective/:id/members`           | `q?, participationStatus?, individualSv5tLevel?, violationStatus?, page?, limit?` |
| `POST`   | `/api/collective/:id/members`           | Upsert member                                                                     |
| `POST`   | `/api/collective/:id/members/import`    | Multipart `file` CSV/XLS/XLSX                                                     |
| `PATCH`  | `/api/collective/:id/members/:memberId` | Partial member                                                                    |
| `DELETE` | `/api/collective/:id/members/:memberId` | -                                                                                 |

Member input:

```ts
interface CollectiveMemberInput {
  studentCode: string;
  studentName: string;
  className?: string;
  faculty?: string;
  participationStatus?: 'participated' | 'not_participated' | 'unknown';
  individualSv5tLevel?: 'none' | 'school' | 'university' | 'city' | 'central' | 'unknown';
  violationStatus?: 'none' | 'violated' | 'unknown';
  note?: string;
}
```

Import response can co:

```ts
interface RosterImportResult {
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  invalidRows: Array<{
    row: number;
    reason: string;
    data?: unknown;
  }>;
}
```

UI phai hien `invalidRows`, khong chi toast "thanh cong". Header importer ho tro ten
cot Anh/Viet, gom MSSV, ho ten, lop, khoa, tham gia phong trao, cap SV5T ca nhan, vi
pham va ghi chu.

## Minh chung tap the

| Method | URL                                                    | Request                                                           |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `GET`  | `/api/collective/:id/evidences`                        | `collectiveCriterion?, status?, indexingStatus?, page?, limit?`   |
| `POST` | `/api/collective/:id/evidences`                        | `{ evidenceName, criterion?, collectiveCriterion?, sourceType? }` |
| `POST` | `/api/collective/evidences/:evidenceId/files`          | Multipart `file`                                                  |
| `POST` | `/api/collective/evidences/:evidenceId/start-indexing` | `{ runMode?, force? }`                                            |
| `POST` | `/api/collective/:id/import-event`                     | `{ eventId, collectiveCriterion? }`                               |

Create:

```json
{
  "evidenceName": "Minh chung hoat dong lop",
  "criterion": "collective",
  "collectiveCriterion": "collective_activity",
  "sourceType": "manual_upload"
}
```

`criterion` cua evidence tap the phai la `collective`. `collectiveCriterion` la nhom
nghiep vu chi tiet do UI/backend thong nhat.

## Precheck va submit

| Method | URL                                   | Request                               |
| ------ | ------------------------------------- | ------------------------------------- |
| `POST` | `/api/collective/:id/precheck`        | `{ level? }`                          |
| `GET`  | `/api/collective/:id/precheck/latest` | -                                     |
| `POST` | `/api/collective/:id/submit`          | `{ allowSubmitWithWarnings?, note? }` |

Precheck data can render:

```ts
interface CollectivePrecheckView {
  collectiveProfileId: string;
  level: Level;
  readinessScore: number;
  readyToSubmit: boolean;
  criteriaResults: unknown[];
  missingItems: unknown[];
  warnings: string[];
  nextBestAction: string;
}
```

Rule summary quan trong:

- Ty le tham gia du kien toi thieu 80%.
- Ty le SV5T cap truong tuy cap dang ky.
- Ho so cap cao yeu cau thanh vien dat cap cao tuong ung.
- Vi pham/unknown va thieu minh chung tao warning/blocker.
- Ket qua may la advisory; ket qua cuoi can con nguoi xac nhan.

Submit:

```json
{
  "allowSubmitWithWarnings": false,
  "note": "Danh sach va minh chung da duoc doi chieu."
}
```

Roster rong luon bi chan. Sau submit, profile chuyen `under_review` va tao review
task; frontend refetch profile thay vi tu set state.

## Flow man hinh

```text
current/start
  -> profile info
  -> roster CRUD/import
  -> evidence upload/import event/index
  -> precheck
  -> submit
  -> review/result read-only
```
