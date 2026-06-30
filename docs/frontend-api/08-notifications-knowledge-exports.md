# Thong bao, kho tri thuc va export

## Notifications

| Method  | URL                           | Auth              | Request         |
| ------- | ----------------------------- | ----------------- | --------------- |
| `GET`   | `/api/notifications`          | Moi user da login | `page?, limit?` |
| `PATCH` | `/api/notifications/:id/read` | Owner             | -               |

Collection dung `meta.pagination`. Sau mark-read, update item tu response hoac
invalidate notification query. Khong optimistic update neu UI khong co rollback.

Notification type:

```ts
type NotificationType =
  | 'system'
  | 'deadline'
  | 'supplement_required'
  | 'precheck_completed'
  | 'review_updated'
  | 'result_available';
```

Notification co the tham chieu application hoac collective profile. Navigation phai
kiem tra ID nao co trong payload.

## Knowledge base

| Method  | URL                                          | Role                            | Request        |
| ------- | -------------------------------------------- | ------------------------------- | -------------- |
| `GET`   | `/api/knowledge-base/search`                 | Moi role da login               | Filters        |
| `GET`   | `/api/knowledge-base/:id`                    | Moi role da login               | -              |
| `POST`  | `/api/knowledge-base/from-reviewed-evidence` | officer/manager/committee/admin | Create         |
| `PATCH` | `/api/knowledge-base/:id`                    | manager/committee/admin         | Partial update |
| `POST`  | `/api/knowledge-base/:id/use`                | Moi role da login               | -              |

Search:

```ts
interface KnowledgeSearch {
  q?: string;
  criterion?: Criterion;
  level?: Level;
  decision?: KnowledgeDecision;
  page?: number;
  limit?: number;
}
```

Create from evidence:

```json
{
  "evidenceId": "evidence-uuid",
  "decision": "accepted",
  "reason": "Mau minh chung da duoc xac nhan.",
  "level": "school",
  "requiredFields": ["Ho ten", "MSSV", "Don vi xac nhan"],
  "commonErrors": ["Thieu dau xac nhan"],
  "anonymize": true
}
```

Mac dinh nen giu `anonymize=true`. UI khong nen hien du lieu ca nhan tu evidence goc
neu item da duoc anonymize.

## Export

| Method | URL                             | Role                      | Response                       |
| ------ | ------------------------------- | ------------------------- | ------------------------------ |
| `POST` | `/api/exports/review-results`   | manager, committee, admin | JSON inline hoac file metadata |
| `GET`  | `/api/exports/:fileId/download` | manager, committee, admin | Binary attachment              |

Request:

```ts
interface ExportReviewResultsInput {
  schoolYear?: string;
  status?: ApplicationStatus;
  targetLevel?: Level;
  faculty?: string;
  format?: 'json' | 'csv';
}
```

- `format=json`: response `data` chua `{ format: "json", data: ... }`.
- `format=csv`: response `data` chua `{ format: "csv", file }`; dung `file.id` de
  download.
- Download endpoint khong tra API envelope. Frontend phai request `blob`, doc
  `Content-Disposition` neu can ten file.

## Route chua implement

Khong render action production cho:

- Audit logs.
- Chatbot.
- SmartUX events/dashboard.

Neu frontend can giu placeholder, feature flag phai mac dinh tat va xu ly
`501 NOT_IMPLEMENTED`.
