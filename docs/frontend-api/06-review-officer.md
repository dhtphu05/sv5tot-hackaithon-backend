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
  statuses?: ReviewTaskStatus[];
  criterion?: Criterion;
  assignedToMe?: boolean;
  applicationId?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

`statuses` la filter union server-side va duoc ap dung truoc count/pagination. Khong gui
dong thoi `status` va `statuses`; gia tri trung lap duoc trim/deduplicate va gia tri
khong hop le bi tu choi voi `400`.

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

## City review safety contract

- Shared evidence/file authorization tai review phai bat dau tu canonical
  `ReviewTask` visibility/scope. `canView=true` co the cho City Officer xem minh
  chung goc truoc khi claim, nhung evidence va file phai duoc link truc tiep voi
  task trong scope; khong duoc thay bang role-only check.
- Chi voi individual application target `city`, detail tra
  `criterionLevelAssessment.criteriaAuthority.source = "CriteriaVersion"`. Cac
  requirement, checklist va backend assessment dung rule tu `loadCriteriaRules`.
  Neu khong load duoc version thi hien `needs_review`/blocked metadata, khong roi
  ve threshold hardcoded. Rule type khong duoc evaluator ho tro cung chi la
  human-review requirement, khong duoc tu suy ra nguong authoritative.
- `supplement_required` la trang thai cho sinh vien bo sung voi normal City
  Officer: officer van co the xem nhung khong duoc `claim`, `accepted`, `rejected`
  hay `resolution_needed`. Khi sinh vien resubmit cung application/task, transaction
  reset task ve `waiting`, xoa decision cu va cho phep claim lai.
- Claim la compare-and-swap tren `status` hien tai, `assignedOfficerId = null`,
  `decision = null` va `updatedAt` cua snapshot. Khong update du phong khi CAS miss;
  miss tra `409` de client refresh.
