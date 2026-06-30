# Nghiep vu quan ly va hoi dong

## Quan ly ho so ca nhan

| Method | URL                                          | Role                      | Request                |
| ------ | -------------------------------------------- | ------------------------- | ---------------------- |
| `GET`  | `/api/manager/applications`                  | manager, committee, admin | Filters                |
| `GET`  | `/api/manager/workloads`                     | manager, admin            | -                      |
| `POST` | `/api/manager/review-tasks/:id/assign`       | manager, admin            | `{ officerId, note? }` |
| `GET`  | `/api/manager/applications/:id/aggregation`  | manager, committee, admin | -                      |
| `POST` | `/api/manager/applications/:id/finalize`     | manager, committee, admin | Final result           |
| `POST` | `/api/manager/applications/:id/reopen-final` | committee, admin          | Reopen                 |

Application filters:

```ts
interface ManagerApplicationFilters {
  status?: ApplicationStatus;
  targetLevel?: Level;
  faculty?: string;
  schoolYear?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

Assign:

```json
{
  "officerId": "officer-uuid",
  "note": "Phan cong theo chuyen mon."
}
```

Finalize:

```ts
interface FinalizeApplicationInput {
  finalStatus: 'passed' | 'failed' | 'partially_passed';
  finalLevel?: Level | null;
  finalNote: string;
  overrideAggregation?: boolean;
  notifyStudent?: boolean;
}
```

`finalLevel` bat buoc theo nghiep vu khi passed/partially passed va phai `null` khi
failed. UI phai hien aggregation va blocker truoc nut finalize. Neu override, yeu cau
confirm ro rang va van gui `finalNote`.

Reopen:

```json
{
  "reason": "Can xem xet lai ket qua.",
  "status": "under_review"
}
```

`status` chi nhan `under_review` hoac `supplement_required`.

## Quan ly ho so tap the

| Method | URL                                                | Role                      | Request      |
| ------ | -------------------------------------------------- | ------------------------- | ------------ |
| `GET`  | `/api/manager/collective-profiles`                 | manager, committee, admin | Filters      |
| `GET`  | `/api/manager/collective-profiles/:id/aggregation` | manager, committee, admin | -            |
| `POST` | `/api/manager/collective-profiles/:id/finalize`    | manager, committee, admin | Final result |

Filters:

```ts
interface ManagerCollectiveFilters {
  schoolYear?: string;
  targetLevel?: Level;
  status?: CollectiveStatus;
  className?: string;
  faculty?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

Finalize:

```json
{
  "finalStatus": "passed",
  "finalLevel": "school",
  "finalNote": "Tap the dat cac tieu chi.",
  "overrideAggregation": false,
  "notifyRepresentative": true
}
```

## Resolution Hub

| Method | URL                                  | Role                      | Request      |
| ------ | ------------------------------------ | ------------------------- | ------------ |
| `GET`  | `/api/resolution/cases`              | manager, committee, admin | Filters      |
| `GET`  | `/api/resolution/cases/:id`          | manager, committee, admin | -            |
| `POST` | `/api/resolution/cases/:id/decision` | manager, committee, admin | Decision     |
| `POST` | `/api/resolution/cases/:id/reopen`   | committee, admin          | `{ reason }` |

Filters:

```ts
interface ResolutionFilters {
  status?: ResolutionStatus;
  criterion?: Criterion;
  applicationId?: string;
  evidenceId?: string;
  q?: string;
  page?: number;
  limit?: number;
}
```

Decision:

```ts
interface ResolutionDecisionInput {
  decision: KnowledgeDecision;
  committeeNote: string;
  updateRelatedTask?: boolean;
  saveToKnowledgeBase?: boolean;
  knowledgeBase?: {
    decision: KnowledgeDecision;
    reason: string;
    requiredFields?: string[];
    commonErrors?: string[];
  };
}
```

Neu bat `saveToKnowledgeBase`, frontend phai thu thap du thong tin `knowledgeBase`.
Sau decision, refetch case, task lien quan va aggregation.
