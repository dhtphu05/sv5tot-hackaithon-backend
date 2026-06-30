# Ho so SV5T ca nhan

Role chinh: `student`, `class_representative`. `admin` co quyen doc/submit mot so route.

## Application endpoints

| Method  | URL                                           | Body/query                                   | Ghi chu                             |
| ------- | --------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| `GET`   | `/api/applications/current`                   | `schoolYear?`                                | Tra `state=not_started` neu chua co |
| `POST`  | `/api/applications/current/start`             | `{ schoolYear?, targetLevel? }`              | `targetLevel` mac dinh `school`     |
| `PATCH` | `/api/applications/:id/target-level`          | `{ targetLevel }`                            | Cap nhat cap dang ky                |
| `PATCH` | `/api/applications/:id/draft`                 | Draft payload                                | Autosave, toi da 128 KiB            |
| `GET`   | `/api/applications/:id/timeline`              | `page?, limit?`                              | Audit timeline co pagination        |
| `POST`  | `/api/applications/:id/precheck`              | `{ level?, runMode?: "sync" }`               | Tao precheck                        |
| `GET`   | `/api/applications/:id/precheck/latest`       | -                                            | Precheck moi nhat                   |
| `POST`  | `/api/applications/:id/cascade-review`        | `{ includeUpgradeHints? }`                   | Danh gia cac cap                    |
| `GET`   | `/api/applications/:id/cascade-review/latest` | -                                            | Cascade moi nhat                    |
| `POST`  | `/api/applications/:id/submit`                | `{ allowSubmitWithWarnings?, studentNote? }` | Tao review tasks                    |
| `POST`  | `/api/applications/:id/reopen-supplement`     | Manager/admin                                | Mo dot bo sung                      |

Start:

```json
{
  "schoolYear": "2025-2026",
  "targetLevel": "school"
}
```

Current response khi chua co ho so co dang:

```ts
interface CurrentApplicationEmpty {
  application: null;
  state: 'not_started';
  schoolYear: string;
}
```

Frontend phai dung `data.application`/`data.state`, khong coi `404` la chua bat dau.

## Autosave

Payload chap nhan field mo rong, cac field chinh:

```ts
interface ApplicationDraftInput {
  targetLevel?: Level;
  basicInfo?: {
    fullName?: string;
    studentCode?: string | null;
    className?: string | null;
    faculty?: string | null;
    phone?: string | null;
    [key: string]: unknown;
  };
  notes?: string; // max 2000
  draftData?: Record<string, unknown>;
  [key: string]: unknown;
}
```

Khuyen nghi debounce 800-1200 ms, chi gui khi dirty, hien `saving/saved/error`. Khong
gui nhieu request autosave song song; request moi phai doi hoac huy request cu.

## Metrics

| Method  | URL                             | Body                                      |
| ------- | ------------------------------- | ----------------------------------------- |
| `POST`  | `/api/applications/:id/metrics` | `{ metricType, value, scale? }`           |
| `PATCH` | `/api/metrics/:metricId`        | `{ value?, scale?, verificationStatus? }` |

Vi du:

```json
{
  "metricType": "gpa",
  "value": 3.5,
  "scale": 4
}
```

Student/class representative khong nen hien control `verificationStatus`; field nay
phuc vu manager/admin.

## Precheck

Precheck la ket qua ho tro, khong phai quyet dinh cuoi cung. UI can render:

- Tong score/readiness.
- Ket qua tung criterion.
- Missing items.
- Warnings.
- Next best action.
- Co can human confirmation hay khong.

Sau precheck, refetch application vi status co the thanh `prechecked` hoac
`ready_to_submit`.

## Cascade review

`includeUpgradeHints=true` yeu cau them goi y nang cap. UI nen hien ket qua theo cap
`school -> university -> city -> central`, nhung khong tu suy dien eligibility neu
server khong tra.

## Submit

```json
{
  "allowSubmitWithWarnings": false,
  "studentNote": "Ho so da duoc kiem tra."
}
```

- Mac dinh khong submit khi con warning/blocker.
- Chi hien checkbox override warning khi UX da giai thich ro canh bao.
- Xu ly command idempotently o UI: disable nut khi dang submit.
- Sau thanh cong, refetch application, timeline va notification.

## Flow man hinh de xuat

```text
GET current
  -> not_started: hien Start
  -> editable: form + metrics + evidence + events
  -> precheck/cascade
  -> submit
  -> under_review: timeline/read-only
  -> supplement_required: mo lai phan duoc phep
  -> completed/rejected: ket qua cuoi
```
