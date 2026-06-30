# Nghiep vu can bo xet duyet

Role: `officer`, `manager`, `committee`, `admin` tuy action.

## Review task

| Method | URL                                         | Role                    | Request    |
| ------ | ------------------------------------------- | ----------------------- | ---------- |
| `GET`  | `/api/review/tasks`                         | reviewer roles          | Filters    |
| `GET`  | `/api/review/tasks/:id`                     | reviewer roles          | -          |
| `POST` | `/api/review/tasks/:id/decision`            | officer, manager, admin | Decision   |
| `POST` | `/api/review/tasks/:id/request-supplement`  | officer, manager, admin | Supplement |
| `POST` | `/api/review/tasks/:id/escalate-resolution` | officer, manager, admin | Escalation |

Filters:

```ts
interface ReviewTaskFilters {
  status?: ReviewTaskStatus;
  criterion?: Criterion;
  assignedToMe?: boolean;
  applicationId?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

Task co the thuoc application ca nhan hoac collective profile. UI detail phai kiem
tra resource nao ton tai, khong gia dinh `applicationId` luon co.

## Decision

```ts
interface TaskDecisionInput {
  decision: ReviewDecision;
  officerNote?: string;
  evidenceDecisions?: Array<{
    evidenceId: string;
    status: EvidenceStatus;
    note?: string;
  }>;
}
```

Vi du:

```json
{
  "decision": "accepted",
  "officerNote": "Minh chung hop le.",
  "evidenceDecisions": [
    {
      "evidenceId": "evidence-uuid",
      "status": "accepted",
      "note": "Da doi chieu."
    }
  ]
}
```

UI nen bat buoc note theo context du backend chi bat buoc mot so quyet dinh. Sau
decision, invalidate task detail, task list va application/collective aggregation.

## Yeu cau bo sung

```ts
interface SupplementInput {
  reason: string;
  requestedEvidenceName?: string;
  allowedCriteria?: Criterion[];
  deadline?: string;
}
```

Vi du:

```json
{
  "reason": "Can bo sung ban co dau xac nhan.",
  "requestedEvidenceName": "Giay xac nhan",
  "allowedCriteria": ["volunteer"],
  "deadline": "2026-07-10T17:00:00.000Z"
}
```

## Escalate Resolution Hub

```json
{
  "reason": "Minh chung co ket qua danh gia mau thuan.",
  "evidenceId": "optional-evidence-uuid"
}
```

Sau escalation, task/application co the chuyen `resolution_needed`. UI phai chuyen
nguoi co quyen den Resolution Hub, khong tiep tuc cho decision thong thuong tren task
da khoa.

## UX states

- `waiting`: cho tiep nhan/phan cong.
- `reviewing`: dang xu ly.
- `supplement_required`: cho nguoi nop bo sung.
- `resolution_needed`: cho hoi dong xu ly.
- `accepted`, `rejected`: terminal cho task.

AI/OCR/precheck chi la du lieu tham khao. Nut decision phai la thao tac ro rang cua
can bo, khong tu dong kich hoat tu ket qua AI.
